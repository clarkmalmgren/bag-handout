import type { Weights } from '../types';

export const DEFAULT_WEIGHTS: Weights = {
  maxRoute: 1,
  total: 0.3,
  toleranceFrac: 0.1,
  tolerance: 2,
  compact: 2.5,
};

/**
 * Metres charged for one cut link of the k-nearest-neighbour graph (see compact.ts). Houses in this
 * kind of subdivision sit about 25-30 m apart door to door, so one cut link is priced at 30 m and
 * `weights.compact` scales that: compact = 1 means "a boundary link costs as much as walking 30 m".
 * Making the term metre-valued keeps it comparable with the route-length terms of the objective.
 */
export const COMPACT_SPACING_M = 30;

/**
 * Metres charged per house of deviation from the mean group size. Tie-break only: at the default
 * weights a whole house off the mean is worth 3 m of walking, far below a typical move delta,
 * so sizes drift to the mean only when the routes are otherwise equally good.
 */
export const SIZE_SOFT_M = 3;

/** Hard house-count tolerance for a given mean group size: max(tolerance, floor(toleranceFrac * mean)). */
export function effectiveTolerance(mean: number, w: Pick<Weights, 'tolerance' | 'toleranceFrac'>): number {
  const frac = Number.isFinite(w.toleranceFrac) ? Math.max(0, w.toleranceFrac) : 0;
  const floorTol = Number.isFinite(w.tolerance) ? Math.max(0, w.tolerance) : 0;
  return Math.max(floorTol, Math.floor(frac * Math.max(0, mean)));
}

/** Objective (lower is better): longest route plus a fraction of the total distance. */
export function score(lengths: number[], w: Weights): number {
  if (lengths.length === 0) return 0;
  let max = 0;
  let sum = 0;
  for (const l of lengths) {
    if (l > max) max = l;
    sum += l;
  }
  return w.maxRoute * max + w.total * sum;
}

/** Sum over groups of |size - mean|, the raw (unweighted) soft balance term. */
export function sizeSpread(sizes: number[]): number {
  if (sizes.length === 0) return 0;
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  let v = 0;
  for (const s of sizes) v += Math.abs(s - mean);
  return v;
}

/**
 * Full objective in metres: routes (score) + compactness (cut kNN links) + a tie-break size term.
 * `cut` is the number of cut links of the kNN graph; see compact.ts.
 */
export function objective(lengths: number[], sizes: number[], cut: number, w: Weights): number {
  return score(lengths, w) + w.compact * COMPACT_SPACING_M * cut + SIZE_SOFT_M * sizeSpread(sizes);
}

/** Total house-count excess beyond `tolerance` of the mean; 0 means the split is feasible. */
export function violation(sizes: number[], tolerance: number): number {
  if (sizes.length === 0) return 0;
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  let v = 0;
  for (const s of sizes) v += Math.max(0, Math.abs(s - mean) - tolerance);
  return v;
}
