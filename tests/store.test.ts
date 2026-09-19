import { describe, expect, it, vi } from 'vitest';
import { Store, defaultConfig, emptyState } from '../src/state';

describe('defaultConfig / emptyState', () => {
  it('has the agreed defaults', () => {
    const c = defaultConfig();
    expect(c.groups).toBe(6);
    expect(c.crossingPenalty).toBe(8);
    expect(c.weights).toEqual({ maxRoute: 1, total: 0.3, tolerance: 2 });
    expect(c.iterations).toBe(8000);
    expect(c.seed).toBe(1);
    expect(c.walkSpeed).toBe(1.2);
    expect(c.secPerHouse).toBe(20);
  });
  it('starts empty', () => {
    const s = emptyState();
    expect(s.boundary).toBeNull();
    expect(s.osm).toBeNull();
    expect(s.houses).toEqual([]);
    expect(s.removed).toEqual([]);
    expect(s.assignment).toEqual({});
    expect(s.locked).toEqual([]);
  });
});

describe('Store', () => {
  it('update mutates state and notifies subscribers', () => {
    const store = new Store(emptyState());
    const fn = vi.fn();
    store.subscribe(fn);
    store.update((s) => {
      s.assignment.a = 1;
    });
    expect(store.state.assignment).toEqual({ a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', () => {
    const store = new Store(emptyState());
    const fn = vi.fn();
    const off = store.subscribe(fn);
    off();
    store.update((s) => {
      s.locked.push('x');
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('undo and redo restore assignment/locked/removed/houses', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    store.update((s) => {
      s.assignment.a = 2;
      s.locked.push('seg1');
      s.removed.push('h1');
    });
    expect(store.undo()).toBe(true);
    expect(store.state.assignment).toEqual({ a: 1 });
    expect(store.state.locked).toEqual([]);
    expect(store.state.removed).toEqual([]);
    expect(store.redo()).toBe(true);
    expect(store.state.assignment).toEqual({ a: 2 });
    expect(store.state.locked).toEqual(['seg1']);
    expect(store.state.removed).toEqual(['h1']);
  });

  it('undo returns false when nothing to undo; redo likewise', () => {
    const store = new Store(emptyState());
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('a new undoable update clears the redo stack', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    store.undo();
    store.update((s) => {
      s.assignment.b = 2;
    });
    expect(store.redo()).toBe(false);
  });

  it('non-undoable updates are not recorded', () => {
    const store = new Store(emptyState());
    store.update(
      (s) => {
        s.config.groups = 9;
      },
      { undoable: false },
    );
    expect(store.undo()).toBe(false);
    expect(store.state.config.groups).toBe(9);
  });

  it('undo does not touch config or boundary', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    store.update(
      (s) => {
        s.config.groups = 9;
      },
      { undoable: false },
    );
    store.undo();
    expect(store.state.config.groups).toBe(9);
  });

  it('replace swaps the state and clears history', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    const next = emptyState();
    next.config.groups = 4;
    store.replace(next);
    expect(store.state.config.groups).toBe(4);
    expect(store.undo()).toBe(false);
  });
});
