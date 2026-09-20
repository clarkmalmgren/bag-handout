import { describe, it, expect } from 'vitest';
import { COMPACT_SPACING_M, DEFAULT_WEIGHTS, SIZE_SOFT_M, effectiveTolerance, objective, score, sizeSpread, violation } from '../src/solver/cost';

describe('violation', () => {
  it('is 0 when every group is within tolerance of the mean', () => {
    expect(violation([11, 12, 13, 14], 2)).toBe(0);
  });
  it('sums the excess beyond tolerance', () => {
    // mean 12.5: |8-12.5|-2 = 2.5, |15-12.5|-2 = 0.5 twice
    expect(violation([8, 12, 15, 15], 2)).toBeCloseTo(3.5, 9);
  });
  it('is 0 for no groups', () => {
    expect(violation([], 2)).toBe(0);
  });
});

describe('score', () => {
  it('is max route plus 0.3 x total by default', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ maxRoute: 1, total: 0.3, toleranceFrac: 0.1, tolerance: 2, compact: 2.5 });
    expect(score([100, 200], DEFAULT_WEIGHTS)).toBeCloseTo(290, 9);
  });
  it('is 0 for no routes', () => {
    expect(score([], DEFAULT_WEIGHTS)).toBe(0);
  });
});

describe('effectiveTolerance', () => {
  it('takes the percentage of the mean once it beats the absolute floor', () => {
    expect(effectiveTolerance(78, DEFAULT_WEIGHTS)).toBe(7);
    expect(effectiveTolerance(20, DEFAULT_WEIGHTS)).toBe(2);
    expect(effectiveTolerance(0, DEFAULT_WEIGHTS)).toBe(2);
  });
  it('ignores negative or non-finite settings', () => {
    expect(effectiveTolerance(78, { tolerance: -5, toleranceFrac: Number.NaN })).toBe(0);
    expect(effectiveTolerance(78, { tolerance: 4, toleranceFrac: -1 })).toBe(4);
  });
});

describe('objective', () => {
  it('adds the compactness and size terms to the route score, in metres', () => {
    const w = { ...DEFAULT_WEIGHTS, compact: 2 };
    const lengths = [1000, 1200];
    const sizes = [10, 12];
    expect(sizeSpread(sizes)).toBe(2);
    expect(objective(lengths, sizes, 5, w)).toBeCloseTo(
      score(lengths, w) + 2 * COMPACT_SPACING_M * 5 + SIZE_SOFT_M * 2,
      9,
    );
  });
  it('is the plain route score when compact is 0 and the sizes are equal', () => {
    const w = { ...DEFAULT_WEIGHTS, compact: 0 };
    expect(objective([100, 200], [5, 5], 40, w)).toBeCloseTo(score([100, 200], w), 9);
  });
});
