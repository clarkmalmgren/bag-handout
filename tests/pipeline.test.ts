import { describe, it, expect } from 'vitest';
import { syntheticGrid } from './fixtures/synthetic';
import { buildModel } from '../src/model';
import { solve, routeGroups, type SolveProblem } from '../src/solver/solve';
import { DEFAULT_WEIGHTS, violation, score, effectiveTolerance } from '../src/solver/cost';

const GROUPS = 4;
const { osm, houses } = syntheticGrid(5, 5, 3);
const model = buildModel(houses, osm, 8);

function problem(iterations: number, extra: Partial<SolveProblem> = {}): SolveProblem {
  return {
    distMatrix: model.dist,
    houseCount: houses.length,
    groups: GROUPS,
    segmentOf: model.segmentOf,
    xy: model.xy,
    weights: DEFAULT_WEIGHTS,
    seed: 1,
    iterations,
    ...extra,
  };
}
const TOL = effectiveTolerance(120 / GROUPS, DEFAULT_WEIGHTS); // mean 30, +-10% -> 3
const sizesOf = (assign: number[]) => {
  const s = new Array<number>(GROUPS).fill(0);
  assign.forEach((g) => s[g]++);
  return s;
};

describe('solve pipeline on the synthetic grid', () => {
  it('assigns every house to a group within tolerance of the mean', () => {
    expect(houses).toHaveLength(120);
    const sol = solve(problem(400));
    expect(sol.assign).toHaveLength(120);
    sol.assign.forEach((g) => {
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(GROUPS);
    });
    expect(sol.feasible).toBe(true);
    expect(violation(sizesOf(sol.assign), TOL)).toBe(0);
    sizesOf(sol.assign).forEach((s) => expect(Math.abs(s - 30)).toBeLessThanOrEqual(TOL));
  });

  it('returns one tour per group that is a permutation of its members', () => {
    const sol = solve(problem(400));
    expect(sol.tours).toHaveLength(GROUPS);
    for (let g = 0; g < GROUPS; g++) {
      const members = sol.assign.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0);
      expect([...sol.tours[g].order].sort((a, b) => a - b)).toEqual(members);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = solve(problem(300));
    const b = solve(problem(300));
    expect(a.assign).toEqual(b.assign);
    expect(a.score).toBeCloseTo(b.score, 9);
  });

  // Holds by construction (best starts as the feasible seed), so it guards against regressions only;
  // the multi-seed test below checks real improvement.
  it('never scores worse than the seed partition', () => {
    const seedOnly = solve(problem(0));
    const annealed = solve(problem(400));
    expect(annealed.score).toBeLessThanOrEqual(seedOnly.score + 1e-6);
  });

  it('never moves locked houses', () => {
    // Seed 2 gives a start the optimizer clearly improves under door-to-door distances (12 movers).
    const start = solve(problem(0, { seed: 2 })).assign;
    const free = solve(problem(3000, { seed: 2, initial: start })).assign;
    const movers = start.map((g, i) => (free[i] !== g ? i : -1)).filter((i) => i >= 0);
    // Without locks the optimizer really does move houses, so the lock assertion below can fail.
    expect(movers.length).toBeGreaterThanOrEqual(4);
    const lockedIdx = new Set<number>([...movers.slice(0, Math.ceil(movers.length / 2)), 0, 1, 2]);
    const locked = houses.map((_, i) => lockedIdx.has(i));
    const sol = solve(problem(3000, { seed: 2, initial: start, locked }));
    for (const i of lockedIdx) expect(sol.assign[i]).toBe(start[i]);
    // and the run is not a no-op: some unlocked house did move.
    expect(sol.assign.some((g, i) => !locked[i] && g !== start[i])).toBe(true);
  });

  it('reseeds when the initial assignment is invalid', () => {
    const bad = new Array<number>(120).fill(-1);
    const sol = solve(problem(0, { initial: bad }));
    expect(sol.feasible).toBe(true);
  });

  it('routeGroups returns tours consistent with the assignment', () => {
    const sol = solve(problem(0));
    const tours = routeGroups(model.dist, houses.length, sol.assign, GROUPS);
    expect(tours).toHaveLength(GROUPS);
    const total = tours.reduce((n, t) => n + t.order.length, 0);
    expect(total).toBe(120);
  });
});

describe('anneal invariants', () => {
  it('reports a score equal to the score of its own tours, and tour lengths match the matrix', () => {
    const sol = solve(problem(400));
    // score is the full objective (routes + compactness + size tie-break); routeScore is the route part.
    expect(sol.routeScore).toBeCloseTo(score(sol.tours.map((t) => t.length), DEFAULT_WEIGHTS), 6);
    expect(sol.score).toBeGreaterThanOrEqual(sol.routeScore);
    sol.tours.forEach((t) => {
      let len = 0;
      for (let i = 0; i < t.order.length; i++) {
        len += model.dist[t.order[i] * 120 + t.order[(i + 1) % t.order.length]];
      }
      expect(t.length).toBeCloseTo(len, 3);
    });
  });

  it('does not mutate its inputs and never empties a group', () => {
    const start = solve(problem(0)).assign;
    const startCopy = start.slice();
    const locked = houses.map((_, i) => i < 5);
    const lockedCopy = locked.slice();
    const dist = model.dist.slice();
    const sol = solve(problem(300, { initial: start, locked }));
    expect(start).toEqual(startCopy);
    expect(locked).toEqual(lockedCopy);
    expect(model.dist).toEqual(dist);
    sizesOf(sol.assign).forEach((s) => expect(s).toBeGreaterThan(0));
  });

  it('improves on the seed partition by a real margin across seeds', () => {
    const seeds = [1, 2, 3, 4, 5];
    let base = 0;
    let after = 0;
    for (const seed of seeds) {
      const s0 = solve(problem(0, { seed })).score;
      const s3 = solve(problem(3000, { seed })).score;
      expect(s3).toBeLessThanOrEqual(s0 + 1e-6);
      base += s0;
      after += s3;
    }
    // Measured: about 1.4% mean improvement at 3000 iterations. Door-to-street legs are a fixed cost every
    // tour pays, so the relative gain on this symmetric grid is small; the margin still catches a no-op optimizer.
    expect(after).toBeLessThan(base * 0.995);
  });

  it('more iterations does not systematically worsen the result', () => {
    const seeds = [1, 2, 3, 4, 5];
    let s3 = 0;
    let s8 = 0;
    for (const seed of seeds) {
      s3 += solve(problem(3000, { seed })).score;
      s8 += solve(problem(8000, { seed })).score;
    }
    // Measured mean: ~8442 at 3000 vs ~8483 at 8000 under the compactness objective. The schedules
    // are not nested and the compactness term makes the landscape rougher, so the longer run is not
    // guaranteed to win on every fixture; the 1% band still catches a run that degrades with length.
    expect(s8).toBeLessThanOrEqual(s3 * 1.01);
  });
});

describe('solve pipeline at ~500 houses', () => {
  const big = syntheticGrid(8, 8, 5); // 8 rows x 7 blocks x 5 per side x 2 = 560 houses
  const bm = buildModel(big.houses, big.osm, 8);
  const n = big.houses.length;
  const bp = (iterations: number): SolveProblem => ({
    distMatrix: bm.dist, houseCount: n, groups: 6, segmentOf: bm.segmentOf, xy: bm.xy,
    weights: DEFAULT_WEIGHTS, seed: 1, iterations,
  });

  it('balances within tolerance, returns permutation tours and beats the seed by 3%+ at 8000 iterations', { timeout: 30_000 }, () => {
    expect(n).toBeGreaterThanOrEqual(400);
    const seedSol = solve(bp(0));
    const sol = solve(bp(8000));
    const sizes = new Array<number>(6).fill(0);
    sol.assign.forEach((g) => sizes[g]++);
    const tol = effectiveTolerance(n / 6, DEFAULT_WEIGHTS);
    sizes.forEach((s) => expect(Math.abs(s - n / 6)).toBeLessThanOrEqual(tol));
    for (let g = 0; g < 6; g++) {
      const members = sol.assign.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0);
      expect([...sol.tours[g].order].sort((a, b) => a - b)).toEqual(members);
    }
    expect(sol.score).toBeLessThan(0.97 * seedSol.score);
  });
});
