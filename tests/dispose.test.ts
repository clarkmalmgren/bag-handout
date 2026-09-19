import { describe, expect, it, vi } from 'vitest';
import { disposeAll } from '../src/export/dispose';

describe('disposeAll', () => {
  it('removes every item and empties the set even when one throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    const mk = (n: string, boom = false) => ({ remove: () => { calls.push(n); if (boom) throw new Error(n); } });
    const set = new Set([mk('a'), mk('b', true), mk('c')]);
    expect(() => disposeAll(set)).not.toThrow();
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(set.size).toBe(0);
    expect(() => disposeAll(set)).not.toThrow();
  });
});
