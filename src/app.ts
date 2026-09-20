import L from 'leaflet';
import type { Store } from './state';
import type { House, Tour } from './types';
import { buildModel, canSolve, type Model } from './model';
import { TourCache } from './tourCache';
import { type SolveProblem } from './solver/solve';
import { runSolve } from './ui/solveClient';
import { groupStats, splitStreetCount } from './stats';
import { effectiveTolerance } from './solver/cost';
import { Overlays, type OverlayHandlers } from './ui/overlays';
import { colorOf, renderPanel } from './ui/groups';
import { adoptNearest, housesInBounds, inputSignature, lockedFlags, moveHouse, moveHouses, selectionSummary, toggleHouseLock, toggleHousesLock, solveIsStale, visibleHouses } from './edit';
import { renderHouseDots } from './ui/houseEdit';
import { AreaSelect } from './ui/areaSelect';
import { renderSelectionPanel } from './ui/selectionPanel';

export interface AppView {
  model: Model | null;
  houses: House[];
  assign: number[];
  tours: Tour[];
}

export function initApp(ctx: {
  store: Store;
  map: L.Map;
  /** removes a house by id (HouseEditor.remove) */
  removeHouse: (id: string) => void;
  /** true while the add-house tool is active (street clicks then belong to the map) */
  isAdding?: () => boolean;
  /** true while the boundary is being drawn/edited (street clicks then belong to the draw tool) */
  isDrawing?: () => boolean;
}): { getView(): AppView } {
  const { store, map, removeHouse } = ctx;
  const isAdding = ctx.isAdding ?? (() => false);
  const isDrawing = ctx.isDrawing ?? (() => false);
  const overlays = new Overlays(map);
  const plainDots = L.layerGroup().addTo(map); // houses before a road model exists
  let model: Model | null = null;
  let modelKey = '';
  let modelOsm: unknown = null;
  let visible: House[] = [];
  let tours: Tour[] = [];
  const tourCache = new TourCache();
  /** ids of the houses picked with the selection rectangle */
  let selected = new Set<string>();

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = (t: string) => { $('status').textContent = t; };

  function assignIdx(): number[] {
    return visible.map((h) => store.state.assignment[h.id] ?? -1);
  }

  function modelKeyOf(): string {
    const s = store.state;
    return s.houses.map((h) => h.id).join(',') + '|' + s.removed.join(',') + '|' + s.config.crossingPenalty;
  }

  function ensureModel(): void {
    const s = store.state;
    const key = modelKeyOf();
    visible = visibleHouses(s);
    if (key === modelKey && s.osm === modelOsm) return;
    modelKey = key;
    modelOsm = s.osm;
    tourCache.clear(); // cached tours use house indices of the old model
    model = s.osm && visible.length > 0 ? buildModel(visible, s.osm, s.config.crossingPenalty) : null;
  }

  /** Assignment as indices; houses with none (added by hand, restored by undo) adopt their nearest assigned neighbour. */
  function prepareAssignments(): number[] {
    const s = store.state;
    const a = assignIdx();
    if (!model) return a;
    for (const i of adoptNearest(a, model.dist, s.config.groups)) {
      // Derived default, not a user action: write straight into state so it is not an undo step and does not re-emit.
      s.assignment[visible[i].id] = a[i];
    }
    return a;
  }

  function refresh(): void {
    const s = store.state;
    ensureModel();
    ($('groups') as HTMLInputElement).value = String(s.config.groups);
    ($('tolerance-pct') as HTMLInputElement).value = String(Math.round(s.config.weights.toleranceFrac * 100));
    ($('compact') as HTMLInputElement).value = String(s.config.weights.compact);
    const a = prepareAssignments();
    const groups = s.config.groups;
    // Only groups whose membership changed are re-routed; after a solve the cache holds the solver's own tours.
    tours = model && a.length > 0 && a.every((g) => g >= 0 && g < groups)
      ? tourCache.routeAll(model.dist, visible.length, a, groups)
      : [];
    // Drop selected houses that were removed (or vanished with a re-fetch/load).
    if (selected.size > 0) {
      const vis = new Set(visible.map((h) => h.id));
      for (const id of [...selected]) if (!vis.has(id)) selected.delete(id);
    }
    draw(a);
  }

  function draw(a: number[]): void {
    const s = store.state;
    const tol = effectiveTolerance(visible.length / Math.max(1, s.config.groups), s.config.weights);
    ($('remove-disc') as HTMLButtonElement).hidden = true;
    if (!model) {
      overlays.clear();
      renderHouseDots(plainDots, visible, removeHouse, selected);
      renderSelection(a);
      renderPanel($('panel'), [], 0, tol, []);
      return;
    }
    plainDots.clearLayers();
    const handlers: OverlayHandlers = { onRemoveHouse: removeHouse, onSegment: openSegmentMenu, onMoveHouse: reassignHouse, onToggleHouseLock: toggleLockHouse };
    overlays.render(model, a, tours, new Set(s.locked), handlers, new Set(model.disconnected), new Set(s.lockedHouses), s.config.groups, selected);
    renderSelection(a);

    const groups = s.config.groups;
    const sizes: number[] = Array(groups).fill(0);
    a.forEach((g) => { if (g >= 0 && g < groups) sizes[g]++; });
    const lengths = Array.from({ length: groups }, (_, g) => tours[g]?.length ?? 0);
    const streets = visible.map((h) => h.street);
    const stats = tours.length > 0 ? groupStats(sizes, lengths, s.config, { tours, streets }) : [];
    const split = tours.length > 0 ? splitStreetCount(streets, a) : undefined;

    const warnings: string[] = [];
    if (model.disconnected.length > 0) {
      warnings.push(`${model.disconnected.length} houses are not connected to the main street network (red rings on the map). Solve is blocked until they are removed.`);
    }
    const rd = $('remove-disc') as HTMLButtonElement;
    rd.hidden = model.disconnected.length === 0;
    rd.textContent = `Remove ${model.disconnected.length} disconnected house${model.disconnected.length === 1 ? '' : 's'}`;
    const flagged = visible.filter((h) => h.flagged).length;
    if (flagged > 0) warnings.push(`${flagged} buildings have no address — review them on the map.`);
    renderPanel($('panel'), stats, visible.length / groups, tol, warnings, split);
  }

  function renderSelection(a: number[]): void {
    const s = store.state;
    const ids = [...selected];
    const sum = selectionSummary(ids, s.assignment, s.config.groups);
    const locked = new Set(s.lockedHouses);
    renderSelectionPanel($('select-panel'), ids.length === 0 ? null : {
      count: ids.length,
      groups: s.config.groups,
      counts: sum.counts,
      unassigned: sum.unassigned,
      canMove: a.some((g) => g >= 0),
      allLocked: ids.every((id) => locked.has(id)),
    }, {
      onMove: moveSelected,
      onToggleLock: () => { store.update((st) => { toggleHousesLock(st, [...selected]); }); },
      onClear: clearSelection,
    });
  }

  function setSelection(ids: Set<string>): void {
    selected = ids;
    draw(assignIdx());
  }

  function clearSelection(): void {
    if (selected.size > 0) setSelection(new Set());
  }

  /** ONE undoable update and one refresh; the selection is cleared afterwards so the highlight does not linger on the new colours. */
  function moveSelected(group: number): void {
    const ids = [...selected];
    if (ids.length === 0) return;
    selected = new Set();
    store.update((st) => moveHouses(st, ids, group));
    const sizes: number[] = Array(store.state.config.groups).fill(0);
    assignIdx().forEach((g) => { if (g >= 0 && g < sizes.length) sizes[g]++; });
    const mean = visible.length / sizes.length;
    const tol = effectiveTolerance(mean, store.state.config.weights);
    const off = sizes.some((n) => Math.abs(n - mean) > tol);
    status(`Moved ${ids.length} house${ids.length === 1 ? '' : 's'} to Group ${group + 1} — sizes ${sizes.join('/')}${off ? '; allowed, but unbalanced' : ''}`);
  }

  const select = new AreaSelect(map, {
    isBlocked: () => isAdding() || isDrawing(),
    onSelect: (b, additive) => {
      const ids = housesInBounds(visible, { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, store.state.removed);
      setSelection(additive ? new Set([...selected, ...ids]) : new Set(ids));
      status(ids.length === 0 ? 'No houses in that area.' : `${selected.size} houses selected.`);
    },
    onClear: clearSelection,
    onModeChange: (on) => { $('select-area').classList.toggle('active', on); },
  });
  $('select-area').addEventListener('click', () => {
    if (!select.toggle()) status('Finish adding houses or drawing the boundary before selecting an area.');
  });
  const panelEl = $('select-panel');
  L.DomEvent.disableClickPropagation(panelEl);
  L.DomEvent.disableScrollPropagation(panelEl);
  map.on('click', (e) => {
    // A plain click on empty map clears the selection (clicks bubbling up from street lines do not).
    if ((e as unknown as { propagatedFrom?: unknown }).propagatedFrom) return;
    if (!isAdding() && !isDrawing()) clearSelection();
  });

  async function solveNow(fresh: boolean): Promise<void> {
    const m = model;
    const gate = canSolve(m);
    if (!m || !gate.ok) { status(gate.message); return; }
    const s = store.state;
    const houses = visible;
    const a = prepareAssignments();
    const start = { state: store.state as object, groups: s.config.groups, modelKey, osm: modelOsm, inputs: inputSignature(s) };
    // solve() reseeds when any group is empty but would still apply locks, so only
    // treat the current assignment as usable when every group has at least one house.
    const complete = a.every((g) => g >= 0 && g < s.config.groups) && new Set(a).size === s.config.groups;
    const usable = !fresh && complete;
    const problem: SolveProblem = {
      distMatrix: m.dist,
      houseCount: houses.length,
      groups: s.config.groups,
      segmentOf: m.segmentOf,
      xy: m.xy,
      weights: s.config.weights,
      seed: s.config.seed,
      iterations: s.config.iterations,
      initial: usable ? a : undefined,
      locked: usable ? lockedFlags(houses, m.snaps.map((sn) => m.graph.segments[sn.segment].key), s.locked, s.lockedHouses) : undefined,
    };
    const iterations = s.config.iterations;
    const note = !fresh && !complete ? 'No valid current assignment — solving from scratch. ' : '';
    ($('solve') as HTMLButtonElement).disabled = true;
    ($('reopt') as HTMLButtonElement).disabled = true;
    status(note + 'Solving…');
    try {
      const sol = await runSolve(problem, (iter) => status(`${note}Solving… ${iter}/${iterations}`));
      if (solveIsStale(start, { state: store.state, groups: store.state.config.groups, modelKey, osm: modelOsm, inputs: inputSignature(store.state) })) {
        status('Result discarded: the project, group count, house set, assignment, locks or removals changed while solving. Solve again.');
        return;
      }
      tourCache.seed(sol.assign, s.config.groups, sol.tours);
      store.update((st) => {
        houses.forEach((h, i) => { st.assignment[h.id] = sol.assign[i]; });
      });
      status(note + (sol.feasible ? 'Done' : 'Done (could not reach ±tolerance — adjust manually)'));
    } catch (e) {
      status('Solve failed: ' + (e as Error).message);
    } finally {
      ($('solve') as HTMLButtonElement).disabled = false;
      ($('reopt') as HTMLButtonElement).disabled = false;
    }
  }

  $('remove-disc').addEventListener('click', () => {
    const m = model;
    if (!m || m.disconnected.length === 0) return;
    const ids = m.disconnected.map((i) => m.houses[i].id);
    store.update((st) => {
      for (const id of ids) if (!st.removed.includes(id)) st.removed.push(id);
    });
    status(`Removed ${ids.length} disconnected house${ids.length === 1 ? '' : 's'} (Undo restores them).`);
  });
  $('solve').addEventListener('click', () => void solveNow(true));
  $('reopt').addEventListener('click', () => void solveNow(false));
  $('groups').addEventListener('change', (ev) => {
    const n = Math.max(2, Math.min(12, Number((ev.target as HTMLInputElement).value) || 6));
    store.update((st) => { st.config.groups = n; }, { undoable: false });
  });
  $('tolerance-pct').addEventListener('change', (ev) => {
    const pct = Math.max(0, Math.min(100, Number((ev.target as HTMLInputElement).value) || 0));
    store.update((st) => { st.config.weights.toleranceFrac = pct / 100; }, { undoable: false });
  });
  $('compact').addEventListener('change', (ev) => {
    const v = Math.max(0, Math.min(100, Number((ev.target as HTMLInputElement).value) || 0));
    store.update((st) => { st.config.weights.compact = v; }, { undoable: false });
  });

  function reassignSegment(segmentId: number, group: number): void {
    const m = model;
    if (!m) return;
    const houses = visible;
    store.update((st) => {
      m.snaps.forEach((sn, i) => {
        if (sn.segment === segmentId) st.assignment[houses[i].id] = group;
      });
    });
    reportBalance();
  }

  function reportBalance(): void {
    const sizes: number[] = Array(store.state.config.groups).fill(0);
    assignIdx().forEach((g) => { if (g >= 0 && g < sizes.length) sizes[g]++; });
    const mean = visible.length / sizes.length;
    const tol = effectiveTolerance(mean, store.state.config.weights);
    const off = sizes.findIndex((n) => Math.abs(n - mean) > tol);
    status(off >= 0 ? `Group ${off + 1} is now ${sizes[off]} houses (mean ${mean.toFixed(1)}) — allowed, but unbalanced` : 'Moved');
  }

  /** Moves ONE house to a group as a single undoable edit; refresh() re-routes only the two touched groups via the tour cache. */
  function reassignHouse(houseId: string, group: number): void {
    map.closePopup();
    store.update((st) => moveHouse(st, houseId, group));
    reportBalance();
  }

  function toggleLockHouse(houseId: string): void {
    map.closePopup();
    store.update((st) => { toggleHouseLock(st, houseId); });
  }

  function toggleLock(segmentId: number): void {
    const m = model;
    if (!m) return;
    const key = m.graph.segments[segmentId].key;
    store.update((st) => {
      const i = st.locked.indexOf(key);
      if (i >= 0) st.locked.splice(i, 1);
      else st.locked.push(key);
    });
  }

  function openSegmentMenu(segmentId: number, at: L.LatLng): void {
    const m = model;
    if (!m || isAdding() || isDrawing()) return;
    const seg = m.graph.segments[segmentId];
    const count = m.snaps.filter((sn) => sn.segment === segmentId).length;
    const box = document.createElement('div');
    box.className = 'seg-menu';
    const title = document.createElement('strong');
    title.textContent = `${seg.street || '(unnamed)'} — ${count} houses`;
    box.append(title);
    for (let g = 0; g < store.state.config.groups; g++) {
      const b = document.createElement('button');
      b.textContent = `Group ${g + 1}`;
      b.style.borderLeft = `10px solid ${colorOf(g)}`;
      b.addEventListener('click', () => { map.closePopup(); reassignSegment(segmentId, g); });
      box.append(b);
    }
    const lock = document.createElement('button');
    lock.textContent = store.state.locked.includes(seg.key) ? 'Unlock (let optimizer move it)' : 'Lock (optimizer keeps it here)';
    lock.addEventListener('click', () => { map.closePopup(); toggleLock(segmentId); });
    box.append(lock);
    L.popup().setLatLng(at).setContent(box).openOn(map);
  }

  $('undo').addEventListener('click', () => { if (!store.undo()) status('Nothing to undo'); });
  $('redo').addEventListener('click', () => { if (!store.redo()) status('Nothing to redo'); });
  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'z') return;
    if ((ev.target as HTMLElement).closest('input, textarea')) return;
    ev.preventDefault();
    if (ev.shiftKey) store.redo();
    else store.undo();
  });

  store.subscribe(refresh);
  refresh();

  return { getView: () => ({ model, houses: visible, assign: assignIdx(), tours }) };
}
