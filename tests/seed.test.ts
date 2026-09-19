import { describe, it, expect } from 'vitest';
import { seedPartition, rebalance } from '../src/solver/seed';
import { violation } from '../src/solver/cost';
import { mulberry32 } from '../src/rng';
import type { XY } from '../src/types';

function blob(cx: number, cy: number, n: number, rng: () => number): XY[] {
  return Array.from({ length: n }, () => ({
    x: cx + (rng() - 0.5) * 10,
    y: cy + (rng() - 0.5) * 10,
  }));
}
const sizesOf = (assign: number[], n: number) => {
  const s = new Array<number>(n).fill(0);
  assign.forEach((g) => s[g]++);
  return s;
};

describe('seedPartition', () => {
  it('splits two separated blobs of 10 into two groups of 10', () => {
    const rng = mulberry32(7);
    const xy = [...blob(0, 0, 10, rng), ...blob(1000, 0, 10, rng)];
    const a = seedPartition(xy, 2, mulberry32(1), 2);
    expect(sizesOf(a, 2)).toEqual([10, 10]);
    expect(new Set(a.slice(0, 10)).size).toBe(1);
    expect(new Set(a.slice(10)).size).toBe(1);
    expect(a[0]).not.toBe(a[10]);
  });

  it('rebalances unequal blobs (30/10/10) to within tolerance', () => {
    const rng = mulberry32(3);
    const xy = [...blob(0, 0, 30, rng), ...blob(1000, 0, 10, rng), ...blob(0, 1000, 10, rng)];
    const a = seedPartition(xy, 3, mulberry32(2), 2);
    expect(violation(sizesOf(a, 3), 2)).toBe(0);
    expect(a).toHaveLength(50);
    a.forEach((g) => expect(g).toBeGreaterThanOrEqual(0));
  });

  it('returns all zeros for a single group', () => {
    const xy = blob(0, 0, 7, mulberry32(1));
    expect(seedPartition(xy, 1, mulberry32(1), 2)).toEqual(new Array(7).fill(0));
  });

  it('is deterministic for a given seed', () => {
    const xy = [...blob(0, 0, 20, mulberry32(5)), ...blob(300, 200, 20, mulberry32(6))];
    expect(seedPartition(xy, 3, mulberry32(9), 2)).toEqual(seedPartition(xy, 3, mulberry32(9), 2));
  });
});

describe('rebalance', () => {
  it('moves houses from the largest to the smallest group until feasible', () => {
    const xy: XY[] = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 0 }));
    const skewed = [...new Array(16).fill(0), ...new Array(4).fill(1)];
    const out = rebalance(skewed, xy, 2, 2);
    expect(violation(sizesOf(out, 2), 2)).toBe(0);
    expect(skewed.slice(0, 16)).toEqual(new Array(16).fill(0)); // input not mutated
  });
});
