import { makeProjector, projectToSegment } from '../geo';
import type { House, LatLon } from '../types';
import type { Graph } from './build';
import { normalizeStreet, streetBase } from './streetName';

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
  const edgeName = g.edges.map((e) => normalizeStreet(e.street));
  const edgeBase = g.edges.map((e) => streetBase(e.street));
  return houses.map((h) => {
    const p = proj(h);
    // Parcel and OSM spell streets differently ("Bealer Cir" / "Bealer Circle"), so compare canonical forms.
    // An exact canonical match beats one that only agrees once directionals are dropped.
    const own = normalizeStreet(h.street);
    const ownBase = streetBase(h.street);
    let best = -1;
    let bd = Infinity;
    let bt = 0;
    let bs: 1 | -1 = 1;
    // Best candidate on the house's own street: [edge, dist, t, side] for the exact and the base-name match.
    let exact: [number, number, number, 1 | -1] | null = null;
    let loose: [number, number, number, 1 | -1] | null = null;

    for (const e of g.edges) {
      const r = projectToSegment(p, P[e.a], P[e.b]);
      if (r.dist < bd) {
        bd = r.dist;
        best = e.id;
        bt = r.t;
        bs = r.side;
      }
      if (own === '') continue;
      if (edgeName[e.id] === own && (!exact || r.dist < exact[1])) exact = [e.id, r.dist, r.t, r.side];
      else if (edgeBase[e.id] === ownBase && (!loose || r.dist < loose[1])) loose = [e.id, r.dist, r.t, r.side];
    }

    // Use a same-street edge only if within tolerance of the best overall distance.
    const same = exact && exact[1] <= bd + SAME_STREET_TOLERANCE_M ? exact
      : loose && loose[1] <= bd + SAME_STREET_TOLERANCE_M ? loose
      : null;
    if (same) [best, bd, bt, bs] = same;

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
