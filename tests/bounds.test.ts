import { describe, expect, it } from 'vitest';
import { fitBox } from '../src/export/bounds';

describe('fitBox', () => {
  it('gives a single point a non-degenerate box centred on it', () => {
    const [[s, w], [n, e]] = fitBox([[42, -88]]);
    expect(n - s).toBeGreaterThan(0);
    expect(e - w).toBeGreaterThan(0);
    expect((s + n) / 2).toBeCloseTo(42, 10);
    expect((w + e) / 2).toBeCloseTo(-88, 10);
  });
  it('leaves a wide spread untouched', () => {
    expect(fitBox([[42, -88], [42.01, -88.02]])).toEqual([[42, -88.02], [42.01, -88]]);
  });
  it('expands only the degenerate axis', () => {
    const [[s, w], [n, e]] = fitBox([[42, -88], [42.01, -88]]);
    expect([s, n]).toEqual([42, 42.01]);
    expect(e - w).toBeGreaterThan(0);
  });
});
