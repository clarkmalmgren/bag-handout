import { makeProjector, projectToSegment } from '../geo';
import type { House, LatLon } from '../types';
import type { Graph } from './build';

export interface Snap {
  edge: number;
  along: number;
  side: 1 | -1;
  segment: number;
  point: LatLon;
  offset: number;
}

export const SAME_STREET_TOLERANCE_M = 15;

export function snapHouses(houses: House[], g: Graph): Snap[] {
  if (houses.length === 0) return [];
  if (g.edges.length === 0) throw new Error('graph has no edges; cannot snap houses');
  const proj = makeProjector(g.coords[0]);
  const P = g.coords.map(proj);
  return houses.map((h) => {
    const p = proj(h);
    let best = -1;
    let bd = Infinity;
    let bt = 0;
    let bs: 1 | -1 = 1;
    let bestSameStreet = -1;
    let bestSameStreetDist = Infinity;
    let btSameStreet = 0;
    let bsSameStreet: 1 | -1 = 1;

    // Single pass: track best overall and best same-street candidates
    for (const e of g.edges) {
      const r = projectToSegment(p, P[e.a], P[e.b]);

      // Track best overall edge
      if (r.dist < bd) {
        bd = r.dist;
        best = e.id;
        bt = r.t;
        bs = r.side;
      }

      // Track best same-street edge (if street matches)
      if (e.street === h.street && r.dist < bestSameStreetDist) {
        bestSameStreetDist = r.dist;
        bestSameStreet = e.id;
        btSameStreet = r.t;
        bsSameStreet = r.side;
      }
    }

    // Use same-street edge only if within tolerance of best overall distance
    if (bestSameStreet !== -1 && bestSameStreetDist <= bd + SAME_STREET_TOLERANCE_M) {
      best = bestSameStreet;
      bd = bestSameStreetDist;
      bt = btSameStreet;
      bs = bsSameStreet;
    }

    const e = g.edges[best];
    const a = g.coords[e.a];
    const b = g.coords[e.b];
    return {
      edge: best,
      along: bt * e.length,
      side: bs,
      segment: e.segment,
      point: { lat: a.lat + (b.lat - a.lat) * bt, lon: a.lon + (b.lon - a.lon) * bt },
      offset: bd,
    };
  });
}
