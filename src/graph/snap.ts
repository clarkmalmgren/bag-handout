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
    // First pass: find closest edge on the same street
    for (const e of g.edges) {
      if (e.street !== h.street) continue;
      const r = projectToSegment(p, P[e.a], P[e.b]);
      if (r.dist < bd) {
        bd = r.dist;
        best = e.id;
        bt = r.t;
        bs = r.side;
      }
    }
    // If no edge on the street found, search all edges (shouldn't happen)
    if (best === -1) {
      for (const e of g.edges) {
        const r = projectToSegment(p, P[e.a], P[e.b]);
        if (r.dist < bd) {
          bd = r.dist;
          best = e.id;
          bt = r.t;
          bs = r.side;
        }
      }
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
