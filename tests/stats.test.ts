import { describe, it, expect } from 'vitest';
import { groupStats, splitStreetCount, streetChanges } from '../src/stats';

describe('groupStats', () => {
  it('computes minutes and delta from the mean', () => {
    const s = groupStats([10, 20], [1200, 600], { walkSpeed: 1.2, secPerHouse: 20 });
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ group: 0, houses: 10, length: 1200, delta: -5, streetChanges: -1 });
    expect(s[0].minutes).toBeCloseTo(20, 9);
    expect(s[1]).toMatchObject({ group: 1, houses: 20, length: 600, delta: 5 });
    expect(s[1].minutes).toBeCloseTo(15, 9);
  });
});

describe('streetChanges', () => {
  const streets = ['Oak St', 'Oak Street', 'Elm Ln', 'Elm Lane'];
  it('counts changes around the closed loop, by canonical name', () => {
    // Oak, Oak, Elm, Elm: one change at the Oak->Elm step and one closing the loop.
    expect(streetChanges([0, 1, 2, 3], streets)).toBe(2);
    // Interleaved: every step changes street.
    expect(streetChanges([0, 2, 1, 3], streets)).toBe(4);
    expect(streetChanges([0, 1], streets)).toBe(0);
    expect(streetChanges([0], streets)).toBe(0);
    expect(streetChanges([], streets)).toBe(0);
  });
});

describe('splitStreetCount', () => {
  it('counts street names whose houses land in more than one group', () => {
    const streets = ['Oak St', 'Oak Street', 'Elm Ln', 'Elm Ln', 'Ash Ct'];
    expect(splitStreetCount(streets, [0, 1, 2, 2, 0])).toEqual({ split: 1, total: 3 });
    expect(splitStreetCount(streets, [0, 0, 1, 1, 1])).toEqual({ split: 0, total: 3 });
  });
  it('ignores unassigned houses and nameless streets', () => {
    expect(splitStreetCount(['Oak St', 'Oak St', ''], [0, -1, 1])).toEqual({ split: 0, total: 1 });
    expect(splitStreetCount([], [])).toEqual({ split: 0, total: 0 });
  });
});

describe('groupStats with tours', () => {
  it('reports street changes per group when tours and streets are given', () => {
    const streets = ['Oak St', 'Oak St', 'Elm Ln', 'Elm Ln'];
    const tours = [{ order: [0, 1], length: 100 }, { order: [2, 3], length: 100 }];
    const s = groupStats([2, 2], [100, 100], { walkSpeed: 1.2, secPerHouse: 20 }, { tours, streets });
    expect(s.map((x) => x.streetChanges)).toEqual([0, 0]);
    const mixed = groupStats([2, 2], [100, 100], { walkSpeed: 1.2, secPerHouse: 20 }, { tours: [{ order: [0, 2], length: 100 }, { order: [1, 3], length: 100 }], streets });
    expect(mixed[0].streetChanges).toBe(2);
  });
});
