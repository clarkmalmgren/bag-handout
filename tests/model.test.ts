import { describe, it, expect } from 'vitest';
import { buildModel } from '../src/model';
import { syntheticGrid } from './fixtures/synthetic';
import { UNREACHABLE } from '../src/graph/shortest';
import type { House, OsmData } from '../src/types';

describe('buildModel', () => {
  const { osm, houses } = syntheticGrid(5, 5, 3);
  const m = buildModel(houses, osm, 8);

  it('produces per-house arrays of matching length', () => {
    expect(m.houses).toHaveLength(120);
    expect(m.snaps).toHaveLength(120);
    expect(m.segmentOf).toHaveLength(120);
    expect(m.xy).toHaveLength(120);
    expect(m.dist).toHaveLength(120 * 120);
  });

  it('reports no disconnected houses on a connected grid', () => {
    expect(m.disconnected).toEqual([]);
  });

  it('segmentOf matches the snapped segment and names the right street', () => {
    m.segmentOf.forEach((s, i) => {
      expect(s).toBe(m.snaps[i].segment);
      expect(m.graph.segments[s].street).toBe(houses[i].street);
    });
  });

  it('projects houses to metres around the first house', () => {
    expect(m.xy[0]).toEqual({ x: 0, y: 0 });
    const far = m.xy[m.xy.length - 1];
    expect(Math.hypot(far.x, far.y)).toBeGreaterThan(300);
  });

  it('has finite distances everywhere', () => {
    for (let i = 0; i < m.dist.length; i++) expect(m.dist[i]).toBeLessThan(UNREACHABLE);
  });

  it('flags a house that snaps to a disconnected island', () => {
    const island: OsmData = {
      nodes: [...osm.nodes, [900, 42.05, -88.3], [901, 42.05, -88.2985]],
      ways: [...osm.ways, { id: 999, name: 'Island Rd', highway: 'residential', nodes: [900, 901] }],
    };
    const stray: House = { id: 'x', lat: 42.05005, lon: -88.2992, label: '1 Island Rd', street: 'Island Rd', flagged: false, manual: false };
    const m2 = buildModel([...houses, stray], island, 8);
    expect(m2.disconnected).toEqual([120]);
  });

  it('handles an empty house list', () => {
    const m3 = buildModel([], osm, 8);
    expect(m3.houses).toEqual([]);
    expect(m3.dist).toHaveLength(0);
    expect(m3.disconnected).toEqual([]);
  });
});
