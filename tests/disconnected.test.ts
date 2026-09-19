import { describe, it, expect } from 'vitest';
import { syntheticGrid } from './fixtures/synthetic';
import { buildModel, canSolve } from '../src/model';
import { solve, type SolveProblem } from '../src/solver/solve';
import { DEFAULT_WEIGHTS } from '../src/solver/cost';
import type { House, OsmData } from '../src/types';

const GROUPS = 4;
const grid = syntheticGrid(5, 5, 3);
const island: OsmData = {
  nodes: [...grid.osm.nodes, [900, 42.05, -88.3], [901, 42.05, -88.2985]],
  ways: [...grid.osm.ways, { id: 999, name: 'Island Rd', highway: 'residential', nodes: [900, 901] }],
};
const orphans: House[] = [0, 1, 2].map((k) => ({
  id: `o${k}`, lat: 42.05005, lon: -88.2999 + k * 0.0004, label: `${k + 1} Island Rd`, street: 'Island Rd', flagged: false, manual: false,
}));
const all = [...grid.houses, ...orphans];

function problem(m: ReturnType<typeof buildModel>, iterations: number): SolveProblem {
  return {
    distMatrix: m.dist, houseCount: m.houses.length, groups: GROUPS, segmentOf: m.segmentOf, xy: m.xy,
    weights: DEFAULT_WEIGHTS, seed: 1, iterations,
  };
}

describe('disconnected houses', () => {
  it('are reported by buildModel and make solve() throw', () => {
    const m = buildModel(all, island, 8);
    expect(m.disconnected).toEqual([120, 121, 122]);
    expect(() => solve(problem(m, 100))).toThrow(/not connected/);
  });

  it('after removing them the same solve succeeds and improves on the seed', () => {
    const kept = all.filter((h) => !h.id.startsWith('o'));
    const m = buildModel(kept, island, 8);
    expect(m.disconnected).toEqual([]);
    const seedOnly = solve(problem(m, 0));
    const sol = solve(problem(m, 3000));
    expect(sol.score).toBeLessThan(seedOnly.score);
  });

  it('canSolve blocks with a count and reason, and allows a clean model', () => {
    const bad = canSolve(buildModel(all, island, 8));
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('3 houses');
    expect(canSolve(null).ok).toBe(false);
    expect(canSolve(buildModel(grid.houses, grid.osm, 8))).toEqual({ ok: true, message: '' });
  });
});
