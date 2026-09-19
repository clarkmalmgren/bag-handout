import type { Weights } from '../types';

export const DEFAULT_WEIGHTS: Weights = { maxRoute: 1, total: 0.3, tolerance: 2 };

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

/** Total house-count excess beyond `tolerance` of the mean; 0 means the split is feasible. */
export function violation(sizes: number[], tolerance: number): number {
  if (sizes.length === 0) return 0;
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  let v = 0;
  for (const s of sizes) v += Math.max(0, Math.abs(s - mean) - tolerance);
  return v;
}
