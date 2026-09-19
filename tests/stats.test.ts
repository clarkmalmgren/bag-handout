import { describe, it, expect } from 'vitest';
import { groupStats } from '../src/stats';

describe('groupStats', () => {
  it('computes minutes and delta from the mean', () => {
    const s = groupStats([10, 20], [1200, 600], { walkSpeed: 1.2, secPerHouse: 20 });
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ group: 0, houses: 10, length: 1200, delta: -5 });
    expect(s[0].minutes).toBeCloseTo(20, 9);
    expect(s[1]).toMatchObject({ group: 1, houses: 20, length: 600, delta: 5 });
    expect(s[1].minutes).toBeCloseTo(15, 9);
  });
});
