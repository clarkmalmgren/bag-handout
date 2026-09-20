import { makeProjector } from './geo';
import { buildGraph, type Graph } from './graph/build';
import { snapHouses, type Snap } from './graph/snap';
import { Oracle, buildDistMatrix, connectedComponents } from './graph/shortest';
import type { House, OsmData, XY } from './types';

export interface Model {
  houses: House[];
  graph: Graph;
  snaps: Snap[];
  dist: Float32Array;
  /** shortest-path oracle over `graph`, kept for reconstructing route geometry */
  oracle: Oracle;
  segmentOf: number[];
  xy: XY[];
  disconnected: number[];
}

export function buildModel(houses: House[], osm: OsmData, crossingPenalty: number): Model {
  const graph = buildGraph(osm);
  const snaps = snapHouses(houses, graph);
  const oracle = new Oracle(graph);
  const dist = buildDistMatrix(oracle, graph, snaps, crossingPenalty);

  const ref = houses[0] ?? graph.coords[0] ?? { lat: 0, lon: 0 };
  const proj = makeProjector(ref);
  const xy = houses.map(proj);

  const comp = connectedComponents(graph);
  // Main component = the one holding the most snapped houses (ties: lowest index); node counts only
  // decide when there are no houses at all, so house-free detached ways never count as the network.
  const sizes = new Map<number, number>();
  if (snaps.length > 0) {
    for (const s of snaps) {
      const c = comp[graph.edges[s.edge].a];
      sizes.set(c, (sizes.get(c) ?? 0) + 1);
    }
  } else {
    for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  }
  let main = -1;
  let mainSize = -1;
  for (const [c, n] of [...sizes].sort((x, y) => x[0] - y[0])) {
    if (n > mainSize) {
      mainSize = n;
      main = c;
    }
  }
  const disconnected: number[] = [];
  snaps.forEach((s, i) => {
    if (comp[graph.edges[s.edge].a] !== main) disconnected.push(i);
  });

  return { houses, graph, snaps, dist, oracle, segmentOf: snaps.map((s) => s.segment), xy, disconnected };
}

/**
 * Solving is blocked while any house is snapped to a road component that is cut off from the main
 * network: its ~1e6 m "unreachable" distance would swamp the objective. Pure helper so it is testable.
 */
export function canSolve(model: Model | null): { ok: boolean; message: string } {
  if (!model) return { ok: false, message: 'Load or fetch houses first' };
  const n = model.disconnected.length;
  if (n > 0) {
    return {
      ok: false,
      message: `${n} house${n === 1 ? ' is' : 's are'} not connected to the main street network (shown with a red ring). ` +
        `Solving is blocked: remove them (button "Remove ${n} disconnected house${n === 1 ? '' : 's'}") or fix the boundary so the connecting road is inside it.`,
    };
  }
  return { ok: true, message: '' };
}
