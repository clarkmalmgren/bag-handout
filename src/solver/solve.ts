import type { Dist, Tour, Weights, XY } from '../types';
import { mulberry32 } from '../rng';
import { seedPartition } from './seed';
import { anneal, type Solution } from './anneal';
import { UNREACHABLE } from '../graph/shortest';
import { solveTour, rotateToStart } from './tsp';

export type { Solution } from './anneal';

export interface SolveProblem {
  distMatrix: Float32Array;
  houseCount: number;
  groups: number;
  segmentOf: number[];
  xy: XY[];
  weights: Weights;
  seed: number;
  iterations: number;
  initial?: number[];
  locked?: boolean[];
  linkDistance?: number;
}

const DEFAULT_LINK_DISTANCE = 150;

export function matrixDist(m: Float32Array, n: number): Dist {
  return (i, j) => m[i * n + j];
}

export function solve(p: SolveProblem, onProgress?: (iter: number, best: number) => void): Solution {
  // Defence in depth: an unreachable pair (capped at UNREACHABLE) would swamp the objective and leave the
  // other groups un-optimised. The UI blocks this earlier; refuse here too.
  const m = p.distMatrix;
  for (let i = 0; i < m.length; i++) {
    if (!(m[i] < UNREACHABLE)) {
      throw new Error(
        'Some houses are not connected to the rest of the street network (unreachable distance in the matrix). ' +
          'Remove those houses or extend the boundary so the connecting road is included.',
      );
    }
  }
  const dist = matrixDist(p.distMatrix, p.houseCount);
  const rng = mulberry32(p.seed);
  const valid =
    p.initial !== undefined &&
    p.initial.length === p.houseCount &&
    p.initial.every((g) => Number.isInteger(g) && g >= 0 && g < p.groups) &&
    new Set(p.initial).size === p.groups; // an empty group can never be refilled, so reseed
  const initial = valid ? p.initial! : seedPartition(p.xy, p.groups, rng, p.weights.tolerance);
  return anneal({
    dist,
    houseCount: p.houseCount,
    groups: p.groups,
    assign: initial,
    locked: p.locked ?? new Array<boolean>(p.houseCount).fill(false),
    segmentOf: p.segmentOf,
    weights: p.weights,
    iterations: p.iterations,
    rng,
    linkDistance: p.linkDistance ?? DEFAULT_LINK_DISTANCE,
    onProgress,
  });
}

/** Fast path used after manual edits: re-route every group without changing membership. */
export function routeGroups(
  distMatrix: Float32Array,
  houseCount: number,
  assign: number[],
  groups: number,
): Tour[] {
  const dist = matrixDist(distMatrix, houseCount);
  const members: number[][] = Array.from({ length: groups }, () => []);
  assign.forEach((g, h) => {
    if (g >= 0 && g < groups) members[g].push(h);
  });
  return members.map((m) => {
    const tour = solveTour(m, dist, { maxStarts: 6 });
    return { order: rotateToStart(tour.order, dist), length: tour.length };
  });
}
