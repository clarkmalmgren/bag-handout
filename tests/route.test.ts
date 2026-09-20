import { describe, it, expect } from 'vitest';
import { syntheticGrid } from './fixtures/synthetic';
import { buildModel } from '../src/model';
import { legPolyline, tourPolyline } from '../src/graph/route';
import { Oracle } from '../src/graph/shortest';
import { buildGraph } from '../src/graph/build';
import { haversine } from '../src/geo';
import type { LatLon } from '../src/types';

const { osm, houses } = syntheticGrid(5, 5, 3);
const model = buildModel(houses, osm, 8);

const len = (pts: LatLon[]) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);
const has = (pts: LatLon[], c: LatLon) => pts.some((p) => p.lat === c.lat && p.lon === c.lon);
const idx = (id: string) => houses.findIndex((h) => h.id === id);

describe('Oracle.path', () => {
  it('returns the node sequence of a shortest path', () => {
    const o = new Oracle(model.graph);
    const a = model.graph.index.get(1)!;
    const b = model.graph.index.get(25)!;
    const p = o.path(a, b);
    expect(p[0]).toBe(a);
    expect(p[p.length - 1]).toBe(b);
    let total = 0;
    for (let i = 1; i < p.length; i++) total += haversine(model.graph.coords[p[i - 1]], model.graph.coords[p[i]]);
    expect(total).toBeCloseTo(o.nodeDist(a, b), 3);
    expect(o.path(a, a)).toEqual([a]);
  });

  it('is empty when unreachable', () => {
    const g = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42.1, -88.3], [4, 42.1, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [3, 4] },
      ],
    });
    expect(new Oracle(g).path(0, 2)).toEqual([]);
  });
});

describe('legPolyline', () => {
  it('starts and ends at the houses and passes through intermediate graph nodes', () => {
    const a = idx('h0_0_0_+');
    const b = idx('h4_3_2_-');
    const pts = legPolyline(model, a, b);
    expect(pts[0]).toEqual({ lat: houses[a].lat, lon: houses[a].lon });
    expect(pts[pts.length - 1]).toEqual({ lat: houses[b].lat, lon: houses[b].lon });
    // a grid path from one corner block to the other must cross several intersections
    const nodeHits = model.graph.coords.filter((c) => has(pts, c));
    expect(nodeHits.length).toBeGreaterThanOrEqual(6);
    // length ~ walking distance (door legs are straight lines to the snap points, so allow a little slack)
    const walk = model.dist[a * houses.length + b];
    expect(len(pts)).toBeGreaterThan(walk * 0.98);
    expect(len(pts)).toBeLessThan(walk * 1.05);
  });

  it('goes straight beside the road for same-side neighbours and across for opposite sides', () => {
    const a = idx('h1_1_0_+');
    const same = idx('h1_1_1_+');
    const opp = idx('h1_1_1_-');
    expect(legPolyline(model, a, same)).toHaveLength(2);
    expect(legPolyline(model, a, opp)).toHaveLength(4);
  });
});

describe('tourPolyline', () => {
  it('closes the loop over an ordered tour and follows roads between stops', () => {
    const order = [idx('h0_0_0_+'), idx('h2_2_1_+'), idx('h4_3_2_-')];
    const pts = tourPolyline(model, order);
    expect(pts[0]).toEqual({ lat: houses[order[0]].lat, lon: houses[order[0]].lon });
    for (const i of order) expect(has(pts, { lat: houses[i].lat, lon: houses[i].lon })).toBe(true);
    // ends where it started (returns to stop 1)
    expect(pts[pts.length - 1]).toEqual(pts[0]);
    let walk = 0;
    for (let k = 0; k < order.length; k++) walk += model.dist[order[k] * houses.length + order[(k + 1) % order.length]];
    expect(len(pts)).toBeGreaterThan(walk * 0.98);
    expect(len(pts)).toBeLessThan(walk * 1.05);
    expect(pts.length).toBeGreaterThan(order.length + 1);
  });

  it('handles empty and single-stop tours', () => {
    expect(tourPolyline(model, [])).toEqual([]);
    expect(tourPolyline(model, [3])).toHaveLength(1);
  });
});
