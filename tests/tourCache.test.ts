import { describe, it, expect, vi } from 'vitest';
import { TourCache } from '../src/tourCache';
import { syntheticGrid } from './fixtures/synthetic';
import { buildModel } from '../src/model';
import { solve } from '../src/solver/solve';
import { DEFAULT_WEIGHTS } from '../src/solver/cost';
import type { Tour } from '../src/types';

const fakeRoute = (m: number[]): Tour => ({ order: [...m], length: m.length });

describe('TourCache', () => {
  const dist = new Float32Array(0);

  it('misses first, then hits for the same membership (order-insensitive)', () => {
    const c = new TourCache();
    const route = vi.fn(fakeRoute);
    c.routeAll(dist, 4, [0, 0, 1, 1], 2, route);
    expect(route).toHaveBeenCalledTimes(2);
    c.routeAll(dist, 4, [0, 0, 1, 1], 2, route);
    expect(route).toHaveBeenCalledTimes(2);
  });

  it('re-routes only groups whose membership changed', () => {
    const c = new TourCache();
    const route = vi.fn(fakeRoute);
    c.routeAll(dist, 6, [0, 0, 0, 1, 1, 1], 2, route);
    route.mockClear();
    c.routeAll(dist, 6, [0, 0, 1, 1, 1, 1], 2, route); // house 2 moved 0 -> 1: both groups change
    expect(route).toHaveBeenCalledTimes(2);
    route.mockClear();
    c.routeAll(dist, 6, [0, 0, 1, 1, 1, 2], 3, route); // group 0 {0,1} was cached above; groups 1 and 2 are new
    expect(route.mock.calls.map((x) => x[0])).toEqual([[2, 3, 4], [5]]);
  });

  it('hits again when returning to a previous membership (undo)', () => {
    const c = new TourCache();
    const route = vi.fn(fakeRoute);
    c.routeAll(dist, 4, [0, 0, 1, 1], 2, route);
    c.routeAll(dist, 4, [0, 1, 1, 1], 2, route);
    route.mockClear();
    c.routeAll(dist, 4, [0, 0, 1, 1], 2, route);
    expect(route).not.toHaveBeenCalled();
  });

  it('keys by group index as well as members', () => {
    const c = new TourCache();
    const route = vi.fn(fakeRoute);
    c.routeAll(dist, 2, [0, 1], 2, route);
    route.mockClear();
    c.routeAll(dist, 2, [1, 0], 2, route); // same sets, swapped group indices
    expect(route).toHaveBeenCalledTimes(2);
  });

  it('clear() invalidates everything', () => {
    const c = new TourCache();
    const route = vi.fn(fakeRoute);
    c.routeAll(dist, 4, [0, 0, 1, 1], 2, route);
    c.clear();
    route.mockClear();
    c.routeAll(dist, 4, [0, 0, 1, 1], 2, route);
    expect(route).toHaveBeenCalledTimes(2);
  });

  it('after seeding from solver output returns exactly the solver tours without routing', () => {
    const { osm, houses } = syntheticGrid(5, 5, 3);
    const m = buildModel(houses, osm, 8);
    const sol = solve({
      distMatrix: m.dist, houseCount: houses.length, groups: 4, segmentOf: m.segmentOf, xy: m.xy,
      weights: DEFAULT_WEIGHTS, seed: 1, iterations: 300,
    });
    const c = new TourCache();
    c.seed(sol.assign, 4, sol.tours);
    const route = vi.fn(fakeRoute);
    const tours = c.routeAll(m.dist, houses.length, sol.assign, 4, route);
    expect(route).not.toHaveBeenCalled();
    tours.forEach((t, g) => {
      expect(t).toBe(sol.tours[g]);
      expect(t.length).toBe(sol.tours[g].length);
    });
  });
});
