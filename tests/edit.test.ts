import { describe, it, expect, vi } from 'vitest';
import { Store, emptyState } from '../src/state';
import { adoptNearest, moveHouse, toggleHouseLock, lockedFlags, solveIsStale, mergeFetched, inputSignature, visibleHouses, confirmFetchReplaces, housesInBounds, moveHouses, toggleHousesLock, selectionSummary } from '../src/edit';
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
  const inputs = { assignment: { a: 0, b: 1 } as Record<string, number>, locked: ['Row 0:1-2'], removed: ['x'], lockedHouses: [] as string[] };
  const ctx = (i = inputs) => ({ state: s, groups: 4, modelKey: 'k', osm: null, inputs: inputSignature(i) });
  const base = ctx();
  it('is fresh when nothing changed', () => expect(solveIsStale(base, ctx({ ...inputs, assignment: { ...inputs.assignment } }))).toBe(false));
  it('detects group count, model key, osm and project change', () => {
    expect(solveIsStale(base, { ...base, groups: 5 })).toBe(true);
    expect(solveIsStale(base, { ...base, modelKey: 'k2' })).toBe(true);
    expect(solveIsStale(base, { ...base, osm: {} })).toBe(true);
    expect(solveIsStale(base, { ...base, state: {} })).toBe(true);
  });
  it('detects an assignment change', () => {
    expect(solveIsStale(base, ctx({ ...inputs, assignment: { a: 1, b: 1 } }))).toBe(true);
  });
  it('detects a lock change', () => {
    expect(solveIsStale(base, ctx({ ...inputs, locked: [] }))).toBe(true);
  });
  it('detects a house lock change', () => {
    expect(solveIsStale(base, ctx({ ...inputs, lockedHouses: ['a'] }))).toBe(true);
  });
  it('detects a removed change', () => {
    expect(solveIsStale(base, ctx({ ...inputs, removed: ['x', 'y'] }))).toBe(true);
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

describe('single-house move and lock', () => {
  it('moves one house as one undoable edit and lock toggles undo too', () => {
    const store = new Store(emptyState());
    store.update((s) => { s.assignment = { a: 0, b: 0, c: 1 }; });
    store.update((s) => moveHouse(s, 'b', 1));
    expect(store.state.assignment).toEqual({ a: 0, b: 1, c: 1 });
    // group sizes (the inputs of stats/tour re-routing) change only for the two touched groups
    const sizes = (a: Record<string, number>) => [0, 1].map((g) => Object.values(a).filter((x) => x === g).length);
    expect(sizes(store.state.assignment)).toEqual([1, 2]);
    expect(store.undo()).toBe(true);
    expect(store.state.assignment).toEqual({ a: 0, b: 0, c: 1 });
    expect(sizes(store.state.assignment)).toEqual([2, 1]);
    store.update((s) => { toggleHouseLock(s, 'a'); });
    expect(store.state.lockedHouses).toEqual(['a']);
    store.undo();
    expect(store.state.lockedHouses).toEqual([]);
    store.redo();
    expect(store.state.lockedHouses).toEqual(['a']);
  });
  it('toggleHouseLock reports the new state', () => {
    const s = { lockedHouses: [] as string[] };
    expect(toggleHouseLock(s, 'x')).toBe(true);
    expect(toggleHouseLock(s, 'x')).toBe(false);
    expect(s.lockedHouses).toEqual([]);
  });
  it('lockedFlags ORs segment locks and house locks', () => {
    const hs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(lockedFlags(hs, ['s1', 's1', 's2'], ['s1'], ['c'])).toEqual([true, true, true]);
    expect(lockedFlags(hs, ['s1', 's1', 's2'], [], ['b'])).toEqual([false, true, false]);
    expect(lockedFlags(hs, ['s1', 's1', 's2'], [], [])).toEqual([false, false, false]);
  });
});

describe('area selection', () => {
  const at = (id: string, lat: number, lon: number): House => ({ ...h(id, false), lat, lon });
  const hs = [at('a', 1, 1), at('b', 2, 2), at('c', 5, 5), at('d', 0, 0)];
  const box = { south: 0, west: 0, north: 2, east: 2 };
  it('selects inside and on the edge, not outside', () => {
    expect(housesInBounds(hs, box)).toEqual(['a', 'b', 'd']);
  });
  it('excludes removed houses', () => {
    expect(housesInBounds(hs, box, ['b'])).toEqual(['a', 'd']);
  });
  it('moveHouses is one undo step', () => {
    const store = new Store(emptyState());
    store.state.assignment = { a: 0, b: 0, c: 1 };
    store.update((s) => moveHouses(s, ['a', 'b'], 1));
    expect(store.state.assignment).toEqual({ a: 1, b: 1, c: 1 });
    expect(store.undo()).toBe(true);
    expect(store.state.assignment).toEqual({ a: 0, b: 0, c: 1 });
  });
  it('moveHouses assigns unassigned houses', () => {
    const s = { assignment: {} as Record<string, number> };
    moveHouses(s, ['x'], 2);
    expect(s.assignment).toEqual({ x: 2 });
  });
  it('toggleHousesLock locks all unless all are locked', () => {
    const s = { lockedHouses: ['a'] };
    expect(toggleHousesLock(s, ['a', 'b'])).toBe(true);
    expect(s.lockedHouses.sort()).toEqual(['a', 'b']);
    expect(toggleHousesLock(s, ['a', 'b'])).toBe(false);
    expect(s.lockedHouses).toEqual([]);
    expect(toggleHousesLock(s, [])).toBe(false);
  });
  it('toggleHousesLock unlock keeps other locks; undoable', () => {
    const store = new Store(emptyState());
    store.state.lockedHouses = ['z'];
    store.update((s) => { toggleHousesLock(s, ['a', 'b']); });
    expect(store.state.lockedHouses).toEqual(['z', 'a', 'b']);
    store.update((s) => { toggleHousesLock(s, ['a', 'b']); });
    expect(store.state.lockedHouses).toEqual(['z']);
    store.undo(); store.undo();
    expect(store.state.lockedHouses).toEqual(['z']);
  });
  it('selectionSummary counts groups and unassigned', () => {
    expect(selectionSummary(['a', 'b', 'c', 'd'], { a: 0, b: 2, c: 2 }, 3)).toEqual({ counts: [1, 0, 2], unassigned: 1 });
  });
});
