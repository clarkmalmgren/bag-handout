import type { Dist, Tour, Weights, XY } from '../types';
import { objective, effectiveTolerance, score, violation } from './cost';
import { buildKnn, cutLinks, cutDelta, COMPACT_K, type KnnGraph } from './compact';
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
  /** house positions; when given the compactness graph uses spatial neighbours (see compact.ts) */
  xy?: XY[];
  onProgress?: (iter: number, best: number) => void;
}

export interface Solution {
  assign: number[];
  tours: Tour[];
  /** full objective: routes + compactness + the size tie-break term */
  score: number;
  /** the route part of the objective alone (maxRoute * longest + total * sum) */
  routeScore: number;
  /** cut links of the kNN graph: the mixing measure the compactness term charges for */
  cut: number;
  feasible: boolean;
}

const NEIGHBORS = 8;
/** Longest run of houses a single "street run" move may carry. */
const MAX_RUN = 6;
const cloneTour = (t: Tour): Tour => ({ order: t.order.slice(), length: t.length });

export function anneal(inp: AnnealInput): Solution {
  const { dist, houseCount: H, groups: N, weights, rng, linkDistance } = inp;
  const assign = inp.assign.slice();
  const members: number[][] = Array.from({ length: N }, () => []);
  assign.forEach((g, h) => members[g].push(h));
  const tours: Tour[] = members.map((m) => solveTour(m, dist));
  const comps = members.map((m) => countComponents(m, dist, linkDistance));
  const tol = effectiveTolerance(N > 0 ? H / N : 0, weights);

  // K nearest houses (by walking distance) for each house: the candidate boundary neighbours.
  const ranked: number[][] = [];
  const K = Math.max(NEIGHBORS, COMPACT_K);
  for (let h = 0; h < H; h++) {
    const idx: number[] = [];
    for (let i = 0; i < H; i++) if (i !== h) idx.push(i);
    idx.sort((a, b) => dist(h, a) - dist(h, b) || a - b);
    ranked.push(idx.slice(0, K));
  }
  const near = ranked.map((r) => r.slice(0, NEIGHBORS));
  const knn: KnnGraph = buildKnn(H, dist, COMPACT_K, inp.xy);

  // Street segments, and each house's segment mates ordered by walking distance, so a "run" move
  // picks up the tail of a segment at the group boundary rather than a scatter of houses.
  const segHouses = new Map<number, number[]>();
  for (let h = 0; h < H; h++) {
    const s = inp.segmentOf[h];
    const list = segHouses.get(s);
    if (list) list.push(h);
    else segHouses.set(s, [h]);
  }
  const segMates: number[][] = [];
  for (let h = 0; h < H; h++) {
    const mates = (segHouses.get(inp.segmentOf[h]) ?? []).filter((x) => x !== h);
    mates.sort((a, b) => dist(h, a) - dist(h, b) || a - b);
    segMates.push(mates);
  }

  const sizes = () => members.map((m) => m.length);
  const lengths = () => tours.map((t) => t.length);
  let curCut = cutLinks(knn, assign);
  let curScore = objective(lengths(), sizes(), curCut, weights);
  let curViol = violation(sizes(), tol);
  let best: { assign: number[]; tours: Tour[]; score: number; cut: number } | null =
    curViol === 0 ? { assign: assign.slice(), tours: tours.map(cloneTour), score: curScore, cut: curCut } : null;

  // Invariant: a group that becomes empty can never be refilled (moves are proposed from a house's
  // neighbours, and an empty group has no houses to be a neighbour), so any move that would empty
  // either touched group is rejected outright. solve() likewise refuses an initial with an empty group.
  interface Candidate {
    moves: [number, number][];
    g: number;
    t: number;
    newG: number[];
    newT: number[];
    newSizes: number[];
    newViol: number;
    newCut: number;
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

  /** Houses of h's own segment that are in h's group and movable, nearest first, h included. */
  const runFrom = (h: number, limit: number): number[] => {
    const g = assign[h];
    const run = [h];
    for (const k of segMates[h]) {
      if (run.length >= limit) break;
      if (assign[k] === g && !inp.locked[k]) run.push(k);
    }
    return run;
  };

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
    if (r < 0.45) {
      moves = [[h, t]];
    } else if (r < 0.7) {
      // Tail run: h plus its 1..MAX_RUN-1 nearest mates on the same street segment.
      const limit = 2 + Math.floor(rng() * (MAX_RUN - 1));
      moves = runFrom(h, limit).map((x) => [x, t] as [number, number]);
    } else if (r < 0.9) {
      // Whole street segment (the movable part of it that is still in g).
      const whole = runFrom(h, Infinity);
      moves = whole.map((x) => [x, t] as [number, number]);
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
    const newViol = violation(newSizes, tol);
    if (newViol > 0 && newViol >= curViol) return null;
    return { moves, g, t, newG, newT, newSizes, newViol, newCut: curCut + cutDelta(knn, assign, moves) };
  };

  const evaluate = (c: Candidate) => {
    const tg = solveTour(c.newG, dist, { initial: warmStart(tours[c.g].order, c.newG, dist) });
    const tt = solveTour(c.newT, dist, { initial: warmStart(tours[c.t].order, c.newT, dist) });
    const newLengths = lengths();
    newLengths[c.g] = tg.length;
    newLengths[c.t] = tt.length;
    return { tg, tt, newScore: objective(newLengths, c.newSizes, c.newCut, weights) };
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
    curCut = best.cut;
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
    curCut = c.newCut;
    curViol = newViol;
    refreshBoundary();
    if (newViol === 0 && (!best || newScore < best.score)) {
      best = { assign: assign.slice(), tours: tours.map(cloneTour), score: newScore, cut: curCut };
    }
  }

  const final = best ?? { assign: assign.slice(), tours: tours.map(cloneTour), score: curScore, cut: curCut };
  const rotated = final.tours.map((t) => ({ order: rotateToStart(t.order, dist), length: t.length }));
  if (inp.onProgress) inp.onProgress(inp.iterations, final.score);
  return {
    assign: final.assign,
    tours: rotated,
    score: final.score,
    routeScore: score(final.tours.map((t) => t.length), weights),
    cut: final.cut,
    feasible: best !== null,
  };
}
