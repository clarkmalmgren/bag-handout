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
    expect(g.segments[0].key).toBe('A:1');
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
});
