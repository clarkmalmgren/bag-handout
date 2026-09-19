import { describe, it, expect } from 'vitest';
import { DEFAULT_WEIGHTS, score, violation } from '../src/solver/cost';

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
    expect(DEFAULT_WEIGHTS).toEqual({ maxRoute: 1, total: 0.3, tolerance: 2 });
    expect(score([100, 200], DEFAULT_WEIGHTS)).toBeCloseTo(290, 9);
  });
  it('is 0 for no routes', () => {
    expect(score([], DEFAULT_WEIGHTS)).toBe(0);
  });
});
