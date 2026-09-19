import { describe, expect, it } from 'vitest';
import { GROUP_COLORS, colorOf } from '../src/ui/groups';

describe('colorOf', () => {
  it('has 12 distinct colours', () => {
    expect(GROUP_COLORS).toHaveLength(12);
    expect(new Set(GROUP_COLORS).size).toBe(12);
  });
  it('wraps past the palette and greys out unassigned', () => {
    expect(colorOf(0)).toBe(GROUP_COLORS[0]);
    expect(colorOf(12)).toBe(GROUP_COLORS[0]);
    expect(colorOf(-1)).toBe('#888888');
  });
});
