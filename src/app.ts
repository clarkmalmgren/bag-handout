import L from 'leaflet';
import type { Store } from './state';
import type { House, Tour } from './types';
import { buildModel, type Model } from './model';
import { routeGroups, type SolveProblem } from './solver/solve';
import { runSolve } from './ui/solveClient';
import { groupStats } from './stats';
import { Overlays, type OverlayHandlers } from './ui/overlays';
import { renderPanel } from './ui/groups';
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
}): { getView(): AppView } {
  const { store, map, removeHouse } = ctx;
  const overlays = new Overlays(map);
  const plainDots = L.layerGroup().addTo(map); // houses before a road model exists
  let model: Model | null = null;
  let modelKey = '';
  let modelOsm: unknown = null;
  let visible: House[] = [];
  let tours: Tour[] = [];

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = (t: string) => { $('status').textContent = t; };

  function visibleHouses(): House[] {
    const removed = new Set(store.state.removed);
    return store.state.houses.filter((h) => !removed.has(h.id));
  }

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
    visible = visibleHouses();
    if (key === modelKey && s.osm === modelOsm) return;
    modelKey = key;
    modelOsm = s.osm;
    model = s.osm && visible.length > 0 ? buildModel(visible, s.osm, s.config.crossingPenalty) : null;
  }

  function refresh(): void {
    const s = store.state;
    ensureModel();
    ($('groups') as HTMLInputElement).value = String(s.config.groups);
    const a = assignIdx();
    const groups = s.config.groups;
    // Tours are always recomputed here (main thread) so the display is identical after a solve and after a manual edit.
    tours = model && a.length > 0 && a.every((g) => g >= 0 && g < groups)
      ? routeGroups(model.dist, visible.length, a, groups)
      : [];
    draw(a);
  }

  function draw(a: number[]): void {
    const s = store.state;
    const tol = s.config.weights.tolerance;
    if (!model) {
      overlays.clear();
      renderHouseDots(plainDots, visible, removeHouse);
      renderPanel($('panel'), [], 0, tol, []);
      return;
    }
    plainDots.clearLayers();
    const handlers: OverlayHandlers = { onRemoveHouse: removeHouse };
    overlays.render(model, a, tours, new Set(s.locked), handlers);

    const groups = s.config.groups;
    const sizes: number[] = Array(groups).fill(0);
    a.forEach((g) => { if (g >= 0 && g < groups) sizes[g]++; });
    const lengths = Array.from({ length: groups }, (_, g) => tours[g]?.length ?? 0);
    const stats = tours.length > 0 ? groupStats(sizes, lengths, s.config) : [];

    const warnings: string[] = [];
    if (model.disconnected.length > 0) {
      warnings.push(`${model.disconnected.length} houses are not connected to the main street network (creek/pond gap?).`);
    }
    const flagged = visible.filter((h) => h.flagged).length;
    if (flagged > 0) warnings.push(`${flagged} buildings have no address — review them on the map.`);
    renderPanel($('panel'), stats, visible.length / groups, tol, warnings);
  }

  async function solveNow(fresh: boolean): Promise<void> {
    const m = model;
    if (!m) { status('Load or fetch houses first'); return; }
    const s = store.state;
    const houses = visible;
    const a = assignIdx();
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

  $('solve').addEventListener('click', () => void solveNow(true));
  $('reopt').addEventListener('click', () => void solveNow(false));
  $('undo').addEventListener('click', () => store.undo());
  $('redo').addEventListener('click', () => store.redo());
  $('groups').addEventListener('change', (ev) => {
    const n = Math.max(2, Math.min(12, Number((ev.target as HTMLInputElement).value) || 6));
    store.update((st) => { st.config.groups = n; }, { undoable: false });
  });

  store.subscribe(refresh);
  refresh();

  return { getView: () => ({ model, houses: visible, assign: assignIdx(), tours }) };
}
