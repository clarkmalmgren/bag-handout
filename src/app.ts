import L from 'leaflet';
import type { Store } from './state';
import type { House, Tour } from './types';
import { buildModel, canSolve, type Model } from './model';
import { TourCache } from './tourCache';
import { type SolveProblem } from './solver/solve';
import { runSolve } from './ui/solveClient';
import { groupStats } from './stats';
import { Overlays, type OverlayHandlers } from './ui/overlays';
import { colorOf, renderPanel } from './ui/groups';
import { adoptNearest, solveIsStale, visibleHouses } from './edit';
import { renderHouseDots } from './ui/houseEdit';

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
}): { getView(): AppView } {
  const { store, map, removeHouse } = ctx;
  const isAdding = ctx.isAdding ?? (() => false);
  const overlays = new Overlays(map);
  const plainDots = L.layerGroup().addTo(map); // houses before a road model exists
  let model: Model | null = null;
  let modelKey = '';
  let modelOsm: unknown = null;
  let visible: House[] = [];
  let tours: Tour[] = [];
  const tourCache = new TourCache();

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
    const a = prepareAssignments();
    const groups = s.config.groups;
    // Only groups whose membership changed are re-routed; after a solve the cache holds the solver's own tours.
    tours = model && a.length > 0 && a.every((g) => g >= 0 && g < groups)
      ? tourCache.routeAll(model.dist, visible.length, a, groups)
      : [];
    draw(a);
  }

  function draw(a: number[]): void {
    const s = store.state;
    const tol = s.config.weights.tolerance;
    ($('remove-disc') as HTMLButtonElement).hidden = true;
    if (!model) {
      overlays.clear();
      renderHouseDots(plainDots, visible, removeHouse);
      renderPanel($('panel'), [], 0, tol, []);
      return;
    }
    plainDots.clearLayers();
    const handlers: OverlayHandlers = { onRemoveHouse: removeHouse, onSegment: openSegmentMenu };
    overlays.render(model, a, tours, new Set(s.locked), handlers, new Set(model.disconnected));

    const groups = s.config.groups;
    const sizes: number[] = Array(groups).fill(0);
    a.forEach((g) => { if (g >= 0 && g < groups) sizes[g]++; });
    const lengths = Array.from({ length: groups }, (_, g) => tours[g]?.length ?? 0);
    const stats = tours.length > 0 ? groupStats(sizes, lengths, s.config) : [];

    const warnings: string[] = [];
    if (model.disconnected.length > 0) {
      warnings.push(`${model.disconnected.length} houses are not connected to the main street network (red rings on the map). Solve is blocked until they are removed.`);
    }
    const rd = $('remove-disc') as HTMLButtonElement;
    rd.hidden = model.disconnected.length === 0;
    rd.textContent = `Remove ${model.disconnected.length} disconnected house${model.disconnected.length === 1 ? '' : 's'}`;
    const flagged = visible.filter((h) => h.flagged).length;
    if (flagged > 0) warnings.push(`${flagged} buildings have no address — review them on the map.`);
    renderPanel($('panel'), stats, visible.length / groups, tol, warnings);
  }

  async function solveNow(fresh: boolean): Promise<void> {
    const m = model;
    const gate = canSolve(m);
    if (!m || !gate.ok) { status(gate.message); return; }
    const s = store.state;
    const houses = visible;
    const a = prepareAssignments();
    const start = { state: store.state as object, groups: s.config.groups, modelKey, osm: modelOsm };
    // solve() reseeds when any group is empty but would still apply locks, so only
    // treat the current assignment as usable when every group has at least one house.
    const complete = a.every((g) => g >= 0 && g < s.config.groups) && new Set(a).size === s.config.groups;
    const usable = !fresh && complete;
    const lockedKeys = new Set(s.locked);
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
      locked: usable ? m.snaps.map((sn) => lockedKeys.has(m.graph.segments[sn.segment].key)) : undefined,
    };
    const iterations = s.config.iterations;
    const note = !fresh && !complete ? 'No valid current assignment — solving from scratch. ' : '';
    ($('solve') as HTMLButtonElement).disabled = true;
    ($('reopt') as HTMLButtonElement).disabled = true;
    status(note + 'Solving…');
    try {
      const sol = await runSolve(problem, (iter) => status(`${note}Solving… ${iter}/${iterations}`));
      if (solveIsStale(start, { state: store.state, groups: store.state.config.groups, modelKey, osm: modelOsm })) {
        status('Result discarded: the project, group count or house set changed while solving. Solve again.');
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

  function reassignSegment(segmentId: number, group: number): void {
    const m = model;
    if (!m) return;
    const houses = visible;
    store.update((st) => {
      m.snaps.forEach((sn, i) => {
        if (sn.segment === segmentId) st.assignment[houses[i].id] = group;
      });
    });
    const sizes: number[] = Array(store.state.config.groups).fill(0);
    assignIdx().forEach((g) => { if (g >= 0 && g < sizes.length) sizes[g]++; });
    const mean = houses.length / sizes.length;
    const off = sizes.findIndex((n) => Math.abs(n - mean) > store.state.config.weights.tolerance);
    status(off >= 0 ? `Group ${off + 1} is now ${sizes[off]} houses (mean ${mean.toFixed(1)}) — allowed, but unbalanced` : 'Moved');
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
    if (!m || isAdding()) return;
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
