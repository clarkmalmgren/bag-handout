import { describe, it, expect } from 'vitest';
import { syntheticGrid } from './fixtures/synthetic';
import { buildModel } from '../src/model';
import { solve, routeGroups, type SolveProblem } from '../src/solver/solve';
import { DEFAULT_WEIGHTS, violation, score } from '../src/solver/cost';

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
    expect(violation(sizesOf(sol.assign), 2)).toBe(0);
    sizesOf(sol.assign).forEach((s) => expect(Math.abs(s - 30)).toBeLessThanOrEqual(2));
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

  it('never scores worse than the seed partition', () => {
    const seedOnly = solve(problem(0));
    const annealed = solve(problem(400));
    expect(annealed.score).toBeLessThanOrEqual(seedOnly.score + 1e-6);
  });

  it('never moves locked houses', () => {
    const start = solve(problem(0)).assign;
    const locked = houses.map((_, i) => i < 10);
    const sol = solve(problem(400, { initial: start, locked }));
    for (let i = 0; i < 10; i++) expect(sol.assign[i]).toBe(start[i]);
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
    expect(sol.score).toBeCloseTo(score(sol.tours.map((t) => t.length), DEFAULT_WEIGHTS), 6);
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

  it('actually improves on the seed partition', () => {
    const seedOnly = solve(problem(0));
    const annealed = solve(problem(3000));
    expect(annealed.score).toBeLessThan(seedOnly.score);
  });
});
