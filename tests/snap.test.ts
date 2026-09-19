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

describe('snapHouses tolerance and fallback behavior', () => {
  it('snaps house with empty street name to the specific nearest edge', () => {
    // Simple 2-edge fixture; house positioned near Oak St
    const g = buildGraph({
      nodes: [
        [1, 42, -88.3],
        [2, 42, -88.2988],
        [3, 42.0005, -88.3],
        [4, 42.0005, -88.2988],
      ],
      ways: [
        { id: 1, name: 'Oak St', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'Main St', highway: 'residential', nodes: [3, 4] },
      ],
    });
    const house = {
      id: 'empty_street',
      lat: 42.00025,
      lon: -88.299,
      label: 'No street name',
      street: '',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // Must snap to Oak St (edge 0), the nearest edge
    expect(snaps[0].edge).toBe(0);
    expect(g.edges[0].street).toBe('Oak St');
  });

  it('snaps house with unmatched street name to the specific nearest edge', () => {
    const g = buildGraph({
      nodes: [
        [1, 42, -88.3],
        [2, 42, -88.2988],
        [3, 42.001, -88.3],
        [4, 42.001, -88.2988],
      ],
      ways: [
        { id: 1, name: 'Oak St', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'Elm Ave', highway: 'residential', nodes: [3, 4] },
      ],
    });
    const house = {
      id: 'unmatched',
      lat: 42.00025,
      lon: -88.299,
      label: 'Fake street',
      street: 'NonExistent Avenue',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // Must snap to nearest edge (Oak St, edge 0)
    expect(snaps[0].edge).toBe(0);
    expect(g.edges[0].street).toBe('Oak St');
  });

  it('rejects far same-street edge when nearest edge is different street', () => {
    // CRITICAL: Proves the fix works. Old unbounded logic would pick same-street edge (wrong).
    // New logic with tolerance rejects it because distance exceeds best + 15m.
    // Position house close to Oak St, far from Main St to ensure clear distance difference.
    const g = buildGraph({
      nodes: [
        [1, 42, -88.3],
        [2, 42, -88.298],
        [3, 42.00045, -88.3],
        [4, 42.00045, -88.298],
      ],
      ways: [
        { id: 1, name: 'Oak St', highway: 'residential', nodes: [1, 2] },     // Edge 0: closest
        { id: 2, name: 'Main St', highway: 'residential', nodes: [3, 4] },    // Edge 1: far, same street
      ],
    });
    // House positioned at lat 42.00005 (very close to Oak St at lat 42)
    // Distance to Oak St ≈ 5.6m (perpendicular to edge)
    // Distance to Main St ≈ 49m (perpendicular to edge at lat 42.00045)
    // So Main St is >15m beyond Oak St, should be rejected by tolerance
    const house = {
      id: 'test_far_same_street',
      lat: 42.00005,
      lon: -88.299,
      label: 'Main St House',
      street: 'Main St',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // MUST snap to Oak St (edge 0), NOT to Main St (edge 1)
    // Oak St ~5.6m, Main St ~49m (43m beyond tolerance)
    expect(snaps[0].edge).toBe(0);
    expect(g.edges[0].street).toBe('Oak St');
  });

  it('accepts same-street edge within 15m tolerance of nearest edge', () => {
    // Oak St at lat 42, Main St at lat 42.00025 (=27.8m apart)
    // House at lat 42.00015 is ~16.7m from Oak St and ~11m from Main St
    // Oak St is nearer, Main St is only 11m beyond → within 15m tolerance → pick Main St
    const g = buildGraph({
      nodes: [
        [1, 42, -88.3],
        [2, 42, -88.298],
        [3, 42.00025, -88.3],
        [4, 42.00025, -88.298],
      ],
      ways: [
        { id: 1, name: 'Oak St', highway: 'residential', nodes: [1, 2] },     // Edge 0
        { id: 2, name: 'Main St', highway: 'residential', nodes: [3, 4] },    // Edge 1
      ],
    });
    const house = {
      id: 'within_tolerance',
      lat: 42.00015,
      lon: -88.299,
      label: 'Main St House',
      street: 'Main St',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // Should pick Main St (edge 1) because it's within 15m tolerance of nearest edge
    expect(snaps[0].edge).toBe(1);
    expect(g.edges[1].street).toBe('Main St');
  });

  it('rejects same-street edge beyond 15m tolerance', () => {
    // Oak St at lat 42, Main St at lat 42.00035 (=39m apart)
    // House at lat 42.0001 is ~11.1m from Oak St and ~27m from Main St
    // Main St is 27-11=16m beyond Oak St → exceeds 15m tolerance → pick Oak St
    const g = buildGraph({
      nodes: [
        [1, 42, -88.3],
        [2, 42, -88.298],
        [3, 42.00035, -88.3],
        [4, 42.00035, -88.298],
      ],
      ways: [
        { id: 1, name: 'Oak St', highway: 'residential', nodes: [1, 2] },     // Edge 0
        { id: 2, name: 'Main St', highway: 'residential', nodes: [3, 4] },    // Edge 1
      ],
    });
    const house = {
      id: 'beyond_tolerance',
      lat: 42.0001,
      lon: -88.299,
      label: 'Main St House',
      street: 'Main St',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // Should pick Oak St (edge 0) because Main St exceeds 15m tolerance
    expect(snaps[0].edge).toBe(0);
    expect(g.edges[0].street).toBe('Oak St');
  });
});
