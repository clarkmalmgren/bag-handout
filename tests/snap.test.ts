import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { snapHouses } from '../src/graph/snap';
import { syntheticGrid } from './fixtures/synthetic';

describe('snapHouses', () => {
  const { osm, houses } = syntheticGrid(5, 5, 3);
  const g = buildGraph(osm);
  const snaps = snapHouses(houses, g);

  it('returns one snap per house in order', () => {
    expect(snaps).toHaveLength(houses.length);
  });

  it('snaps each house to a block of its own street', () => {
    houses.forEach((h, i) => {
      expect(g.segments[snaps[i].segment].street).toBe(h.street);
    });
  });

  it('records about 16.7 m offset from the street', () => {
    for (const s of snaps) {
      expect(s.offset).toBeGreaterThan(15);
      expect(s.offset).toBeLessThan(18.5);
    }
  });

  it('puts houses on opposite sides of a block on opposite sides', () => {
    const plus = houses.findIndex((h) => h.id === 'h1_1_0_+');
    const minus = houses.findIndex((h) => h.id === 'h1_1_0_-');
    expect(snaps[plus].edge).toBe(snaps[minus].edge);
    expect(snaps[plus].side).not.toBe(snaps[minus].side);
  });

  it('keeps along within the edge length', () => {
    for (const s of snaps) {
      expect(s.along).toBeGreaterThanOrEqual(0);
      expect(s.along).toBeLessThanOrEqual(g.edges[s.edge].length + 1e-6);
    }
  });

  it('returns an empty array for no houses and throws on an empty graph', () => {
    expect(snapHouses([], g)).toEqual([]);
    expect(() => snapHouses(houses.slice(0, 1), buildGraph({ nodes: [], ways: [] }))).toThrow(/no edges/);
  });
});
