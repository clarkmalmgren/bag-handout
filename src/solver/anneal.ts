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

  const T0 = Math.max(1, curScore * 0.02);
  const Tend = T0 * 0.001;

  for (let it = 0; it < inp.iterations && H > 0 && N > 1; it++) {
    if (inp.onProgress && it % 200 === 0) inp.onProgress(it, best ? best.score : curScore);
    const temp = T0 * Math.pow(Tend / T0, it / Math.max(1, inp.iterations - 1));

    const h = Math.floor(rng() * H);
    if (inp.locked[h]) continue;
    const g = assign[h];
    const foreign = near[h].filter((j) => assign[j] !== g);
    if (foreign.length === 0) continue;
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
      if (inp.locked[j]) continue;
      moves = [[h, t], [j, g]];
    }

    const out = new Set(moves.map((m) => m[0]));
    const intoG = moves.filter((m) => m[1] === g).map((m) => m[0]);
    const intoT = moves.filter((m) => m[1] === t).map((m) => m[0]);
    const newG = members[g].filter((x) => !out.has(x)).concat(intoG);
    const newT = members[t].filter((x) => !out.has(x)).concat(intoT);
    if (newG.length === 0) continue;

    // Hard balance rule: a move must not leave the split infeasible unless it reduces the violation.
    const newSizes = sizes();
    newSizes[g] = newG.length;
    newSizes[t] = newT.length;
    const newViol = violation(newSizes, weights.tolerance);
    if (newViol > 0 && newViol >= curViol) continue;

    // Contiguity guard: never split a group into more walkable pieces than it had.
    const cg = countComponents(newG, dist, linkDistance);
    if (cg > comps[g]) continue;
    const ct = countComponents(newT, dist, linkDistance);
    if (ct > comps[t]) continue;

    // Re-solve only the two touched tours, warm-started from their previous order.
    const tg = solveTour(newG, dist, { initial: warmStart(tours[g].order, newG, dist) });
    const tt = solveTour(newT, dist, { initial: warmStart(tours[t].order, newT, dist) });
    const newLengths = lengths();
    newLengths[g] = tg.length;
    newLengths[t] = tt.length;
    const newScore = score(newLengths, weights);

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
    if (newViol === 0 && (!best || newScore < best.score)) {
      best = { assign: assign.slice(), tours: tours.map(cloneTour), score: newScore };
    }
  }

  const final = best ?? { assign: assign.slice(), tours: tours.map(cloneTour), score: curScore };
  const rotated = final.tours.map((t) => ({ order: rotateToStart(t.order, dist), length: t.length }));
  if (inp.onProgress) inp.onProgress(inp.iterations, final.score);
  return { assign: final.assign, tours: rotated, score: final.score, feasible: best !== null };
}
