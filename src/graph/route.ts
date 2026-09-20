import type { House, LatLon } from '../types';
import type { Graph } from './build';
import { Oracle, bestCombo } from './shortest';
import type { Snap } from './snap';

interface RouteModel {
  houses: House[];
  graph: Graph;
  snaps: Snap[];
  oracle: Oracle;
}

const at = (h: House): LatLon => ({ lat: h.lat, lon: h.lon });

/**
 * Walking polyline from house a to house b (both endpoints included), following the same route that
 * houseDistance measures: same edge and side -> straight beside the road; opposite sides -> across the street
 * via the two snap points; different edges -> door, street snap point, graph nodes of the shortest path, street
 * snap point, door. Unreachable pairs fall back to a straight line.
 */
export function legPolyline(m: RouteModel, a: number, b: number): LatLon[] {
  const ha = at(m.houses[a]);
  const hb = at(m.houses[b]);
  const sa = m.snaps[a];
  const sb = m.snaps[b];
  if (sa.edge === sb.edge) {
    return sa.side === sb.side ? [ha, hb] : [ha, sa.point, sb.point, hb];
  }
  const c = bestCombo(m.oracle, m.graph, sa, sb);
  if (!c) return [ha, hb];
  const nodes = m.oracle.path(c.na, c.nb).map((n) => m.graph.coords[n]);
  return [ha, sa.point, ...nodes, sb.point, hb];
}

/**
 * Closed-loop polyline for an ordered tour (last stop connects back to the first), following the road network.
 * Consecutive duplicate points are dropped. One stop gives just that house; an empty tour gives [].
 */
export function tourPolyline(m: RouteModel, order: number[]): LatLon[] {
  if (order.length === 0) return [];
  const out: LatLon[] = [at(m.houses[order[0]])];
  if (order.length === 1) return out;
  for (let i = 0; i < order.length; i++) {
    const leg = legPolyline(m, order[i], order[(i + 1) % order.length]);
    for (let k = 1; k < leg.length; k++) {
      const p = leg[k];
      const last = out[out.length - 1];
      if (p.lat !== last.lat || p.lon !== last.lon) out.push(p);
    }
  }
  return out;
}
