import type { Dist, Tour, Weights, XY } from '../types';
import { mulberry32 } from '../rng';
import { seedPartition } from './seed';
import { effectiveTolerance } from './cost';
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

/**
 * Walking metres within which two houses count as "next door" for the contiguity guard.
 *
 * Measured on the Mill Creek data the door-to-door distance to a house's nearest neighbour is about
 * 27 m (p50) and 58 m (p90), so 80 m links a house to its neighbours and their neighbours without
 * bridging a block, a creek or a pond. It used to be 150 m, which linked houses two streets apart
 * and let the guard pass badly interleaved groups (measured: dropping 150 -> 80 more than halves the
 * hull-overlap metric). Below about 70 m the guard becomes self-defeating on this data: a boundary
 * house's nearest house in another group is often farther than that, so *every* move would add a
 * component and be rejected, and the annealer stops moving at all.
 */
export const DEFAULT_LINK_DISTANCE = 80;

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
  const link = p.linkDistance ?? DEFAULT_LINK_DISTANCE;
  const tol = effectiveTolerance(p.groups > 0 ? p.houseCount / p.groups : 0, p.weights);
  const initial = valid
    ? p.initial!
    : seedPartition(p.xy, p.groups, rng, tol);
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
    linkDistance: link,
    xy: p.xy,
    onProgress,
  });
}

/** Route one group (closed loop over `members`, house indices). */
export function routeGroup(distMatrix: Float32Array, houseCount: number, members: number[]): Tour {
  const dist = matrixDist(distMatrix, houseCount);
  const tour = solveTour(members, dist, { maxStarts: 6 });
  return { order: rotateToStart(tour.order, dist), length: tour.length };
}

/** Fast path used after manual edits: re-route every group without changing membership. */
export function routeGroups(
  distMatrix: Float32Array,
  houseCount: number,
  assign: number[],
  groups: number,
): Tour[] {
  return membersOf(assign, groups).map((m) => routeGroup(distMatrix, houseCount, m));
}

export function membersOf(assign: number[], groups: number): number[][] {
  const members: number[][] = Array.from({ length: groups }, () => []);
  assign.forEach((g, h) => {
    if (g >= 0 && g < groups) members[g].push(h);
  });
  return members;
}
