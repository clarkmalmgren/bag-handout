import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { syntheticGrid } from './fixtures/synthetic';
import type { OsmData } from '../src/types';

describe('syntheticGrid', () => {
  it('makes 120 houses for a 5x5 grid with 3 per edge per side', () => {
    expect(syntheticGrid(5, 5, 3).houses).toHaveLength(120);
  });
});

describe('buildGraph', () => {
  it('builds nodes, edges and one segment per block on a grid', () => {
    const g = buildGraph(syntheticGrid(5, 5, 3).osm);
    expect(g.coords).toHaveLength(25);
    expect(g.edges).toHaveLength(40);
    expect(g.segments).toHaveLength(40);
    g.edges.forEach((e, i) => expect(e.id).toBe(i));
    g.segments.forEach((s, i) => expect(s.id).toBe(i));
  });

  it('gives edges realistic lengths (~99 m east-west, ~100 m north-south)', () => {
    const g = buildGraph(syntheticGrid(2, 2, 1).osm);
    const lens = g.edges.map((e) => e.length).sort((a, b) => a - b);
    expect(lens[0]).toBeGreaterThan(95);
    expect(lens[lens.length - 1]).toBeLessThan(105);
  });

  it('builds symmetric adjacency', () => {
    const g = buildGraph(syntheticGrid(3, 3, 1).osm);
    for (let u = 0; u < g.adj.length; u++) {
      for (const { to, w } of g.adj[u]) {
        expect(g.adj[to].some((x) => x.to === u && Math.abs(x.w - w) < 1e-9)).toBe(true);
      }
    }
  });

  it('merges a single street through degree-2 nodes into one segment', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42, -88.298], [4, 42, -88.297]],
      ways: [{ id: 1, name: 'A', highway: 'residential', nodes: [1, 2, 3, 4] }],
    };
    const g = buildGraph(osm);
    expect(g.edges).toHaveLength(3);
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0].edgeIds).toEqual([0, 1, 2]);
    expect(g.segments[0].key).toBe('A:1-4');
    expect(g.segments[0].street).toBe('A');
  });

  it('does not merge across a name change at a degree-2 node', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42, -88.298]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [2, 3] },
      ],
    };
    expect(buildGraph(osm).segments).toHaveLength(2);
  });

  it('skips edges whose nodes are missing instead of bridging them', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [4, 42, -88.297]],
      ways: [{ id: 1, name: 'A', highway: 'residential', nodes: [1, 2, 3, 4] }],
    };
    const g = buildGraph(osm);
    expect(g.edges).toHaveLength(1);
    expect(g.index.get(4)).toBe(2);
  });

  it('does not duplicate an edge shared by two ways', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'A', highway: 'footway', nodes: [2, 1] },
      ],
    };
    expect(buildGraph(osm).edges).toHaveLength(1);
  });

  describe('segment keys', () => {
    const keys = (osm: OsmData) => buildGraph(osm).segments.map((s) => s.key);

    it('are unique on the 5x5 grid', () => {
      const k = keys(syntheticGrid(5, 5, 3).osm);
      expect(new Set(k).size).toBe(k.length);
    });

    it('are unique when one street is split by a side street', () => {
      const osm: OsmData = {
        nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42, -88.298], [4, 42, -88.297], [5, 42, -88.296], [6, 42.001, -88.298]],
        ways: [
          { id: 1, name: 'Main St', highway: 'residential', nodes: [1, 2, 3, 4, 5] },
          { id: 2, name: 'Side St', highway: 'residential', nodes: [3, 6] },
        ],
      };
      const g = buildGraph(osm);
      const main = g.segments.filter((s) => s.street === 'Main St');
      expect(main).toHaveLength(2);
      expect(main[0].key).not.toBe(main[1].key);
      expect(main.map((s) => s.key).sort()).toEqual(['Main St:1-3', 'Main St:3-5']);
      expect(new Set(g.segments.map((s) => s.key)).size).toBe(g.segments.length);
    });

    it('get a deterministic ordinal when two parallel segments share both ends', () => {
      const mk = (order: number[]): OsmData => {
        const all = [
          { id: 1, name: 'Loop', highway: 'residential', nodes: [1, 2, 3] },
          { id: 2, name: 'Loop', highway: 'residential', nodes: [1, 4, 3] },
          { id: 3, name: 'Stub', highway: 'residential', nodes: [1, 5] },
          { id: 4, name: 'Stub2', highway: 'residential', nodes: [3, 6] },
        ];
        return {
          nodes: [[1, 42, -88.3], [2, 42.0005, -88.299], [3, 42, -88.298], [4, 41.9995, -88.299], [5, 42, -88.301], [6, 42, -88.297]],
          ways: order.map((i) => all[i]),
        };
      };
      const k1 = keys(mk([0, 1, 2, 3]));
      const k2 = keys(mk([3, 1, 2, 0]));
      const loops = (k: string[]) => k.filter((x) => x.startsWith('Loop')).sort();
      expect(loops(k1)).toEqual(['Loop:1-3', 'Loop:1-3#1']);
      expect(new Set(k1).size).toBe(k1.length);
      // Same segments get the same keys regardless of way order (compare via the OSM ids of their edges).
      const byShape = (osm: OsmData) => {
        const g = buildGraph(osm);
        return g.segments
          .map((s) => `${s.key}=${s.edgeIds.map((e) => [g.osmIds[g.edges[e].a], g.osmIds[g.edges[e].b]].sort().join('-')).sort().join(',')}`)
          .sort();
      };
      expect(byShape(mk([3, 1, 2, 0]))).toEqual(byShape(mk([0, 1, 2, 3])));
      expect(loops(k2)).toEqual(loops(k1));
    });

    it('are unchanged by shuffling way order on the grid', () => {
      const { osm } = syntheticGrid(5, 5, 3);
      const rev: OsmData = { nodes: [...osm.nodes].reverse(), ways: [...osm.ways].reverse().map((w) => ({ ...w, nodes: [...w.nodes] })) };
      expect(keys(rev).sort()).toEqual(keys(osm).sort());
    });
  });
});
