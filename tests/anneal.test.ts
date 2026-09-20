import { describe, it, expect } from 'vitest';
import { syntheticGrid } from './fixtures/synthetic';
import { buildModel } from '../src/model';
import { solve, matrixDist, type SolveProblem } from '../src/solver/solve';
import { DEFAULT_WEIGHTS, effectiveTolerance } from '../src/solver/cost';
import { buildKnn, cutLinks, cutDelta, COMPACT_K } from '../src/solver/compact';

const GROUPS = 4;
const { osm, houses } = syntheticGrid(5, 5, 3);
const model = buildModel(houses, osm, 8);
const H = houses.length;

function problem(iterations: number, extra: Partial<SolveProblem> = {}): SolveProblem {
  return {
    distMatrix: model.dist,
    houseCount: H,
    groups: GROUPS,
    segmentOf: model.segmentOf,
    xy: model.xy,
    weights: DEFAULT_WEIGHTS,
    seed: 1,
    iterations,
    ...extra,
  };
}
const sizesOf = (assign: number[]) => {
  const s = new Array<number>(GROUPS).fill(0);
  assign.forEach((g) => s[g]++);
  return s;
};

describe('compactness term', () => {
  it('reports a cut count that matches a fresh recount of the kNN graph', () => {
    // Guards the incremental cutDelta bookkeeping: the running count must not drift from the truth.
    const knn = buildKnn(H, matrixDist(model.dist, H), COMPACT_K, model.xy);
    for (const seed of [1, 2, 3]) {
      const sol = solve(problem(2000, { seed }));
      expect(sol.cut).toBe(cutLinks(knn, sol.assign));
    }
  });

  it('lowers the mixing measure compared with compact = 0, across seeds', () => {
    const seeds = [1, 2, 3, 4, 5];
    let off = 0;
    let on = 0;
    for (const seed of seeds) {
      off += solve(problem(3000, { seed, weights: { ...DEFAULT_WEIGHTS, compact: 0 } })).cut;
      on += solve(problem(3000, { seed, weights: { ...DEFAULT_WEIGHTS, compact: 6 } })).cut;
    }
    // Non-vacuous: the two runs really differ, and the compact weight is what lowers the mixing.
    expect(off).toBeGreaterThan(0);
    expect(on).toBeLessThan(off * 0.95);
  });

  it('cutDelta equals a full recount for single, run and swap moves', () => {
    const knn = buildKnn(H, matrixDist(model.dist, H), COMPACT_K, model.xy);
    const assign = solve(problem(0)).assign;
    const base = cutLinks(knn, assign);
    const moves: [number, number][][] = [
      [[0, (assign[0] + 1) % GROUPS]],
      [[5, (assign[5] + 1) % GROUPS], [6, (assign[6] + 1) % GROUPS], [7, (assign[7] + 2) % GROUPS]],
      [[10, assign[100]], [100, assign[10]]],
    ];
    for (const m of moves) {
      const after = assign.slice();
      for (const [h, g] of m) after[h] = g;
      expect(base + cutDelta(knn, assign, m)).toBe(cutLinks(knn, after));
    }
  });
});

describe('percentage house-count tolerance', () => {
  it('derives the tolerance from the mean, with the absolute value as a floor', () => {
    const w = { tolerance: 2, toleranceFrac: 0.1 };
    expect(effectiveTolerance(78, w)).toBe(7);
    expect(effectiveTolerance(30, w)).toBe(3);
    expect(effectiveTolerance(12, w)).toBe(2); // 1.2 -> the floor of 2 wins
    expect(effectiveTolerance(78, { tolerance: 2, toleranceFrac: 0 })).toBe(2);
  });

  it('is respected as a hard bound by the solver', () => {
    const mean = H / GROUPS;
    const tol = effectiveTolerance(mean, DEFAULT_WEIGHTS);
    expect(tol).toBe(3); // mean 30, 10% -> 3
    for (const seed of [1, 2, 3]) {
      const sol = solve(problem(3000, { seed }));
      expect(sol.feasible).toBe(true);
      sizesOf(sol.assign).forEach((s) => expect(Math.abs(s - mean)).toBeLessThanOrEqual(tol));
    }
  });

  it('honours a tighter tolerance when asked', () => {
    const weights = { ...DEFAULT_WEIGHTS, toleranceFrac: 0, tolerance: 1 };
    const sol = solve(problem(2000, { weights }));
    sizesOf(sol.assign).forEach((s) => expect(Math.abs(s - H / GROUPS)).toBeLessThanOrEqual(1));
  });
});

describe('determinism', () => {
  it('gives the same assignment, cut and score for the same seed', () => {
    const a = solve(problem(2000, { seed: 7 }));
    const b = solve(problem(2000, { seed: 7 }));
    expect(a.assign).toEqual(b.assign);
    expect(a.cut).toBe(b.cut);
    expect(a.score).toBeCloseTo(b.score, 9);
  });
});

describe('street-run moves', () => {
  it('moves whole street segments, not only single houses', () => {
    // Every house of a segment in the same group is the signature of segment-sized moves; with
    // single-house moves only, the boundary segments end up split.
    const sol = solve(problem(6000, { seed: 3 }));
    const bySeg = new Map<number, Set<number>>();
    model.segmentOf.forEach((s, i) => {
      const set = bySeg.get(s) ?? new Set<number>();
      set.add(sol.assign[i]);
      bySeg.set(s, set);
    });
    const whole = [...bySeg.values()].filter((s) => s.size === 1).length;
    expect(whole).toBeGreaterThan(bySeg.size / 2);
  });
});
