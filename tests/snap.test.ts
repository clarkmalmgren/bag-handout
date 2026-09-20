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
    // Oak St at lat 42, Main St at lat 42.0005, house at lat 42.0001
    // Distance to Oak St: |42.0001 - 42| * 111km ≈ 11.1m (nearest)
    // Distance to Main St: |42.0005 - 42.0001| * 111km ≈ 44.4m (far away)
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
      lat: 42.0001,
      lon: -88.299,
      label: 'No street name',
      street: '',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // Must snap to Oak St (edge 0), the clearly nearest edge
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
    // Distance to Main St ≈ 44.5m (perpendicular to edge at lat 42.00045)
    // So Main St is ~38.9m beyond Oak St, well beyond 15m tolerance
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
    // CRITICAL: Tests that tolerance logic is ACTIVE. Nearest edge is different street.
    // Oak St at lat 42, Main St at lat 42.00023, house at lat 42.00005
    // Distance to Oak St: |42.00005 - 42| * 111km ≈ 5.55m (nearest, different street)
    // Distance to Main St: |42.00023 - 42.00005| * 111km ≈ 20m (same street, but 14.5m beyond nearest)
    // Main St is within 15m tolerance, should win over Oak St despite Oak being nearer
    const g = buildGraph({
      nodes: [
        [1, 42, -88.3],
        [2, 42, -88.298],
        [3, 42.00023, -88.3],
        [4, 42.00023, -88.298],
      ],
      ways: [
        { id: 1, name: 'Oak St', highway: 'residential', nodes: [1, 2] },     // Edge 0: nearest
        { id: 2, name: 'Main St', highway: 'residential', nodes: [3, 4] },    // Edge 1: within tolerance
      ],
    });
    const house = {
      id: 'within_tolerance',
      lat: 42.00005,
      lon: -88.299,
      label: 'Main St House',
      street: 'Main St',
      flagged: false,
      manual: false,
    };
    const snaps = snapHouses([house], g);
    expect(snaps).toHaveLength(1);
    // Must pick Main St (edge 1) because within 15m tolerance, despite Oak being nearest
    // This FAILS if tolerance logic is disabled (plain nearest-edge picks Oak)
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

describe('snapHouses street-name spelling', () => {
  // Parcel data says "Bealer Cir" / "W Mallory Dr"; OSM says "Bealer Circle" / "West Mallory Drive".
  const g = buildGraph({
    nodes: [
      [1, 42, -88.3],
      [2, 42, -88.298],
      [3, 42.00023, -88.3],
      [4, 42.00023, -88.298],
    ],
    ways: [
      { id: 1, name: 'Oak Street', highway: 'residential', nodes: [1, 2] }, // edge 0: nearer
      { id: 2, name: 'Bealer Circle', highway: 'residential', nodes: [3, 4] }, // edge 1: ~14.5 m further
    ],
  });
  const house = (street: string) => ({ id: street, lat: 42.00005, lon: -88.299, label: 'x', street, flagged: false, manual: false });

  it('prefers the own street across Cir/Circle, case and punctuation', () => {
    for (const s of ['Bealer Cir', 'BEALER CIRCLE', 'bealer cir.']) {
      expect(snapHouses([house(s)], g)[0].edge).toBe(1);
    }
  });

  it('still snaps to the nearest edge for a different street or an empty name', () => {
    expect(snapHouses([house('Preston Cir')], g)[0].edge).toBe(0);
    expect(snapHouses([house('')], g)[0].edge).toBe(0);
  });

  it('matches directional spellings and prefers the exact directional over a base-name match', () => {
    const d = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.298], [3, 42.00006, -88.3], [4, 42.00006, -88.298]],
      ways: [
        { id: 1, name: 'East Mallory Drive', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'West Mallory Drive', highway: 'residential', nodes: [3, 4] },
      ],
    });
    expect(snapHouses([house('W Mallory Dr')], d)[0].edge).toBe(1);
    expect(snapHouses([house('E Mallory Dr')], d)[0].edge).toBe(0);
  });
});
