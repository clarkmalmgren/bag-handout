import { describe, it, expect, vi } from 'vitest';
import { adoptNearest, solveIsStale, mergeFetched, visibleHouses, confirmFetchReplaces } from '../src/edit';
import type { House } from '../src/types';

const h = (id: string, manual: boolean): House => ({ id, lat: 0, lon: 0, label: id, street: '', flagged: false, manual });

// 4 houses on a line at x = 0, 1, 10, 11; dist = |dx|
function lineDist(xs: number[]): Float32Array {
  const n = xs.length;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i * n + j] = Math.abs(xs[i] - xs[j]);
  return d;
}

describe('adoptNearest', () => {
  it('copies the nearest assigned neighbour group', () => {
    const a = [0, -1, 1, -1];
    const changed = adoptNearest(a, lineDist([0, 1, 10, 11]), 2);
    expect(a).toEqual([0, 0, 1, 1]);
    expect(changed).toEqual([1, 3]);
  });
  it('treats out-of-range groups as unassigned', () => {
    const a = [0, 5, 1, 1];
    adoptNearest(a, lineDist([0, 1, 10, 11]), 2);
    expect(a[1]).toBe(0);
  });
  it('leaves everything unassigned when nothing is assigned', () => {
    const a = [-1, -1];
    expect(adoptNearest(a, lineDist([0, 1]), 2)).toEqual([]);
    expect(a).toEqual([-1, -1]);
  });
  it('does not chain from freshly adopted houses', () => {
    const a = [0, -1, -1, 1];
    adoptNearest(a, lineDist([0, 1, 2, 30]), 2);
    expect(a).toEqual([0, 0, 0, 1]);
  });
});

describe('solveIsStale', () => {
  const s = {};
  const base = { state: s, groups: 4, modelKey: 'k', osm: null };
  it('is fresh when nothing changed', () => expect(solveIsStale(base, { ...base })).toBe(false));
  it('detects group count, model key, osm and project change', () => {
    expect(solveIsStale(base, { ...base, groups: 5 })).toBe(true);
    expect(solveIsStale(base, { ...base, modelKey: 'k2' })).toBe(true);
    expect(solveIsStale(base, { ...base, osm: {} })).toBe(true);
    expect(solveIsStale(base, { ...base, state: {} })).toBe(true);
  });
});

describe('mergeFetched', () => {
  it('keeps manual houses and ALL previous removals', () => {
    const old = [h('w1', false), h('m1', true), h('m2', true)];
    const r = mergeFetched([h('w2', false)], old, ['w1', 'm1']);
    expect(r.houses.map((x) => x.id)).toEqual(['w2', 'm1', 'm2']);
    // w1 is not in the new fetch, but if OSM returns it again later (a hand-pruned shed) it must stay removed.
    expect(r.removed).toEqual(['w1', 'm1']);
  });
  it('a hand-removed OSM house stays hidden when the re-fetch returns it', () => {
    const r = mergeFetched([h('w1', false), h('w2', false)], [h('w1', false)], ['w1']);
    expect(visibleHouses(r).map((x) => x.id)).toEqual(['w2']);
  });
});

describe('confirmFetchReplaces', () => {
  it('does not ask when nothing is assigned', () => {
    const ask = vi.fn(() => false);
    expect(confirmFetchReplaces({}, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it('asks when assigned and honours the answer', () => {
    expect(confirmFetchReplaces({ a: 0 }, () => false)).toBe(false);
    const ask = vi.fn(() => true);
    expect(confirmFetchReplaces({ a: 0 }, ask)).toBe(true);
    expect(ask).toHaveBeenCalledWith('Fetching replaces all group assignments. Undo can restore them. Continue?');
  });
});
