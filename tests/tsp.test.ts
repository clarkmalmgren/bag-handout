import { describe, it, expect } from 'vitest';
import { solveTour, tourLength, warmStart, rotateToStart } from '../src/solver/tsp';
import { countComponents } from '../src/solver/contiguity';

const euclid = (pts: { x: number; y: number }[]) => (i: number, j: number) =>
  Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);

describe('solveTour', () => {
  it('finds the polygon perimeter for shuffled points on a circle', () => {
    const pts = Array.from({ length: 12 }, (_, k) => ({
      x: Math.cos((2 * Math.PI * k) / 12) * 100,
      y: Math.sin((2 * Math.PI * k) / 12) * 100,
    }));
    const dist = euclid(pts);
    const shuffled = [0, 7, 3, 10, 1, 8, 5, 2, 11, 4, 9, 6];
    const tour = solveTour(shuffled, dist, { maxStarts: 6 });
    expect(tour.length).toBeCloseTo(12 * dist(0, 1), 3);
    expect([...tour.order].sort((a, b) => a - b)).toEqual([...shuffled].sort((a, b) => a - b));
    expect(tourLength(tour.order, dist)).toBeCloseTo(tour.length, 6);
  });

  it('handles 0, 1 and 2 members', () => {
    const dist = euclid([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 9, y: 9 }]);
    expect(solveTour([], dist)).toEqual({ order: [], length: 0 });
    expect(solveTour([2], dist)).toEqual({ order: [2], length: 0 });
    const two = solveTour([0, 1], dist);
    expect(two.order).toEqual([0, 1]);
    expect(two.length).toBeCloseTo(10, 6);
  });

  it('improves a supplied initial order without changing the member set', () => {
    const pts = Array.from({ length: 8 }, (_, k) => ({
      x: Math.cos((2 * Math.PI * k) / 8) * 50,
      y: Math.sin((2 * Math.PI * k) / 8) * 50,
    }));
    const dist = euclid(pts);
    const bad = [0, 4, 1, 5, 2, 6, 3, 7];
    const tour = solveTour(bad, dist, { initial: bad });
    expect(tour.length).toBeLessThan(tourLength(bad, dist));
    expect([...tour.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('warmStart', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 1.5, y: 1 },
  ];
  const dist = euclid(pts);

  it('keeps previous order and inserts new members', () => {
    const out = warmStart([0, 1, 2, 3], [0, 1, 2, 3, 4], dist);
    expect(out).toHaveLength(5);
    expect(out.filter((x) => x !== 4)).toEqual([0, 1, 2, 3]);
    expect(out).toContain(4);
  });

  it('drops members that left the group', () => {
    expect(warmStart([0, 1, 2, 3], [0, 2, 3], dist)).toEqual([0, 2, 3]);
  });

  it('builds from nothing', () => {
    expect([...warmStart([], [0, 1, 2], dist)].sort()).toEqual([0, 1, 2]);
  });
});

describe('rotateToStart', () => {
  it('starts right after the longest leg and keeps the same set', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 11 }, { x: 0, y: 1 }];
    const dist = euclid(pts);
    const out = rotateToStart([0, 1, 2, 3], dist);
    expect(out).toEqual([1, 2, 3, 0]);
    expect(tourLength(out, dist)).toBeCloseTo(tourLength([0, 1, 2, 3], dist), 9);
  });

  it('leaves tiny tours alone', () => {
    const dist = () => 1;
    expect(rotateToStart([4, 5], dist)).toEqual([4, 5]);
  });
});

describe('countComponents', () => {
  const pts = [
    ...Array.from({ length: 5 }, (_, i) => ({ x: i * 10, y: 0 })),
    ...Array.from({ length: 5 }, (_, i) => ({ x: 1000 + i * 10, y: 0 })),
  ];
  const dist = euclid(pts);
  const all = pts.map((_, i) => i);

  it('counts two separated blobs', () => {
    expect(countComponents(all, dist, 50)).toBe(2);
  });
  it('merges when the link distance is large', () => {
    expect(countComponents(all, dist, 5000)).toBe(1);
  });
  it('returns 0 for an empty group', () => {
    expect(countComponents([], dist, 50)).toBe(0);
  });
});
