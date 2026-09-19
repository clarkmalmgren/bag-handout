import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { snapHouses, SAME_STREET_TOLERANCE_M } from '../src/graph/snap';
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

describe('snapHouses tolerance and fallback behavior', () => {
  it('snaps house with empty street name to nearest edge', () => {
    const { osm } = syntheticGrid(3, 3, 2);
    const g = buildGraph(osm);
    const emptyStreetHouse = {
      id: 'empty_street',
      lat: 42.0005,
      lon: -88.3,
      label: 'No street',
      street: '',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([emptyStreetHouse], g);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].offset).toBeGreaterThan(0);
    // Should snap to some edge even though street doesn't match
    expect(g.edges[snaps[0].edge]).toBeDefined();
  });

  it('snaps house with unmatched street name to nearest edge', () => {
    const { osm } = syntheticGrid(3, 3, 2);
    const g = buildGraph(osm);
    const unmatchedStreetHouse = {
      id: 'unmatched',
      lat: 42.0005,
      lon: -88.3,
      label: 'Fake street',
      street: 'NonExistent Avenue',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([unmatchedStreetHouse], g);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].offset).toBeGreaterThan(0);
    // Should snap to nearest edge despite street mismatch
    expect(g.edges[snaps[0].edge]).toBeDefined();
  });

  it('snaps to nearest edge when far same-street edge exceeds tolerance', () => {
    // Create a graph with one edge on a street and another edge with the same street name far away
    const g = buildGraph({
      nodes: [
        [1, 42, -88.3],
        [2, 42, -88.2988],
        [3, 42.001, -88.3],
        [4, 42.001, -88.2988],
        [5, 42.002, -88.3],
        [6, 42.002, -88.2988],
      ],
      ways: [
        { id: 1, name: 'Main St', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'Main St', highway: 'residential', nodes: [5, 6] }, // Far away, same name
        { id: 3, name: 'Other Ln', highway: 'residential', nodes: [3, 4] },
      ],
    });
    // House positioned near first Main St edge (close to nodes 1,2 at row 0)
    const house = {
      id: 'near_first',
      lat: 42.0001,
      lon: -88.299,
      label: 'Main St House',
      street: 'Main St',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // Should snap to nearby edge (0 or 2), not the far one (1)
    // The far edge (1) is at row 2 (lat ~42.002), offset ~200m, exceeds tolerance
    expect(snaps[0].offset).toBeLessThan(SAME_STREET_TOLERANCE_M + 5); // Small tolerance buffer for projection
  });

  it('keeps existing grid test behavior with tolerance rule', () => {
    // This verifies the original grid test still works with the new tolerance logic
    const { osm, houses } = syntheticGrid(5, 5, 3);
    const g = buildGraph(osm);
    const snaps = snapHouses(houses, g);
    // All houses should still snap to their own streets
    houses.forEach((h, i) => {
      expect(g.segments[snaps[i].segment].street).toBe(h.street);
    });
  });
});
