import type { Dist, Tour, Weights } from '../types';
import { score, violation } from './cost';
import { solveTour, warmStart, rotateToStart } from './tsp';
import { countComponents } from './contiguity';

export interface AnnealInput {
  dist: Dist;
  houseCount: number;
  groups: number;
  assign: number[];
  locked: boolean[];
  segmentOf: number[];
  weights: Weights;
  iterations: number;
  rng: () => number;
  linkDistance: number;
  onProgress?: (iter: number, best: number) => void;
}

export interface Solution {
  assign: number[];
  tours: Tour[];
  score: number;
  feasible: boolean;
}

const NEIGHBORS = 8;
const cloneTour = (t: Tour): Tour => ({ order: t.order.slice(), length: t.length });

export function anneal(inp: AnnealInput): Solution {
  const { dist, houseCount: H, groups: N, weights, rng, linkDistance } = inp;
  const assign = inp.assign.slice();
  const members: number[][] = Array.from({ length: N }, () => []);
  assign.forEach((g, h) => members[g].push(h));
  const tours: Tour[] = members.map((m) => solveTour(m, dist));
  const comps = members.map((m) => countComponents(m, dist, linkDistance));

  // K nearest houses (by walking distance) for each house: the candidate boundary neighbours.
  const near: number[][] = [];
  for (let h = 0; h < H; h++) {
    const idx: number[] = [];
    for (let i = 0; i < H; i++) if (i !== h) idx.push(i);
    idx.sort((a, b) => dist(h, a) - dist(h, b));
    near.push(idx.slice(0, NEIGHBORS));
  }

  const sizes = () => members.map((m) => m.length);
  const lengths = () => tours.map((t) => t.length);
  let curScore = score(lengths(), weights);
  let curViol = violation(sizes(), weights.tolerance);
  let best: { assign: number[]; tours: Tour[]; score: number } | null =
    curViol === 0 ? { assign: assign.slice(), tours: tours.map(cloneTour), score: curScore } : null;

  // Invariant: a group that becomes empty can never be refilled (moves are proposed from a house's
  // neighbours, and an empty group has no houses to be a neighbour), so any move that would empty
  // either touched group is rejected outright. solve() likewise refuses an initial with an empty group.
  interface Candidate {
    moves: [number, number][];
    g: number;
    t: number;
    newG: number[];
    newT: number[];
    newViol: number;
  }

  // Houses that have at least one nearby house in another group: the only useful ones to move.
  let boundary: number[] = [];
  const refreshBoundary = () => {
    boundary = [];
    for (let h = 0; h < H; h++) {
      if (inp.locked[h]) continue;
      const g = assign[h];
      if (near[h].some((j) => assign[j] !== g)) boundary.push(h);
    }
  };
  refreshBoundary();

  const propose = (): Candidate | null => {
    if (boundary.length === 0) return null;
    const h = boundary[Math.floor(rng() * boundary.length)];
    const g = assign[h];
    const foreign = near[h].filter((j) => assign[j] !== g);
    if (foreign.length === 0) return null;
    const j = foreign[Math.floor(rng() * foreign.length)];
    const t = assign[j];

    const r = rng();
    let moves: [number, number][];
    if (r < 0.6) {
      moves = [[h, t]];
    } else if (r < 0.85) {
      const run = [h];
      for (const k of near[h]) {
        if (run.length >= 3) break;
        if (assign[k] === g && !inp.locked[k] && inp.segmentOf[k] === inp.segmentOf[h]) run.push(k);
      }
      moves = run.map((x) => [x, t] as [number, number]);
    } else {
      if (inp.locked[j]) return null;
      moves = [[h, t], [j, g]];
    }

    const out = new Set(moves.map((m) => m[0]));
    const intoG = moves.filter((m) => m[1] === g).map((m) => m[0]);
    const intoT = moves.filter((m) => m[1] === t).map((m) => m[0]);
    const newG = members[g].filter((x) => !out.has(x)).concat(intoG);
    const newT = members[t].filter((x) => !out.has(x)).concat(intoT);
    if (newG.length === 0 || newT.length === 0) return null;

    // Hard balance rule: a move must not leave the split infeasible unless it reduces the violation.
    const newSizes = sizes();
    newSizes[g] = newG.length;
    newSizes[t] = newT.length;
    const newViol = violation(newSizes, weights.tolerance);
    if (newViol > 0 && newViol >= curViol) return null;
    return { moves, g, t, newG, newT, newViol };
  };

  const evaluate = (c: Candidate) => {
    const tg = solveTour(c.newG, dist, { initial: warmStart(tours[c.g].order, c.newG, dist) });
    const tt = solveTour(c.newT, dist, { initial: warmStart(tours[c.t].order, c.newT, dist) });
    const newLengths = lengths();
    newLengths[c.g] = tg.length;
    newLengths[c.t] = tt.length;
    return { tg, tt, newScore: score(newLengths, weights) };
  };

  // Calibrate the temperature from real move deltas (not the absolute score, which is dominated
  // by the fixed tour lengths): T0 is 0.2x the mean absolute delta of feasible candidates.
  let deltaSum = 0;
  let deltaN = 0;
  if (H > 0 && N > 1 && inp.iterations > 0) {
    for (let a = 0; a < 400 && deltaN < 50; a++) {
      const c = propose();
      if (!c) continue;
      deltaSum += Math.abs(evaluate(c).newScore - curScore);
      deltaN++;
    }
  }
  const T0 = Math.max(1e-6, deltaN > 0 ? (0.2 * deltaSum) / deltaN : Math.max(1, curScore * 0.001));
  const Tend = T0 * 0.001;

  const restartFromBest = () => {
    if (!best) return;
    for (let h = 0; h < H; h++) assign[h] = best.assign[h];
    for (let k = 0; k < N; k++) members[k] = [];
    assign.forEach((g, h) => members[g].push(h));
    for (let k = 0; k < N; k++) {
      tours[k] = cloneTour(best.tours[k]);
      comps[k] = countComponents(members[k], dist, linkDistance);
    }
    curScore = best.score;
    curViol = 0;
    refreshBoundary();
  };

  // Restart from the best feasible state R times over the run so the chain cannot drift away permanently.
  const R = 8;
  const restartAt = new Set<number>();
  for (let r = 1; r < R; r++) restartAt.add(Math.floor((r * inp.iterations) / R));
  for (let it = 0; it < inp.iterations && H > 0 && N > 1; it++) {
    if (inp.onProgress && it % 200 === 0) inp.onProgress(it, best ? best.score : curScore);
    if (it > 0 && restartAt.has(it)) restartFromBest();
    const temp = T0 * Math.pow(Tend / T0, it / Math.max(1, inp.iterations - 1));

    const c = propose();
    if (!c) continue;
    const { moves, g, t, newG, newT, newViol } = c;

    // Contiguity guard: never split a group into more walkable pieces than it had.
    const cg = countComponents(newG, dist, linkDistance);
    if (cg > comps[g]) continue;
    const ct = countComponents(newT, dist, linkDistance);
    if (ct > comps[t]) continue;

    // Re-solve only the two touched tours, warm-started from their previous order.
    const { tg, tt, newScore } = evaluate(c);

    let accept: boolean;
    if (newViol < curViol) accept = true;
    else accept = newScore <= curScore || rng() < Math.exp((curScore - newScore) / temp);
    if (!accept) continue;

    for (const [x, to] of moves) assign[x] = to;
    members[g] = newG;
    members[t] = newT;
    tours[g] = tg;
    tours[t] = tt;
    comps[g] = cg;
    comps[t] = ct;
    curScore = newScore;
    curViol = newViol;
    refreshBoundary();
    if (newViol === 0 && (!best || newScore < best.score)) {
      best = { assign: assign.slice(), tours: tours.map(cloneTour), score: newScore };
    }
  }

  const final = best ?? { assign: assign.slice(), tours: tours.map(cloneTour), score: curScore };
  const rotated = final.tours.map((t) => ({ order: rotateToStart(t.order, dist), length: t.length }));
  if (inp.onProgress) inp.onProgress(inp.iterations, final.score);
  return { assign: final.assign, tours: rotated, score: final.score, feasible: best !== null };
}
