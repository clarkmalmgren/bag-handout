import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { snapHouses, type Snap } from '../src/graph/snap';
import { Oracle, houseDistance, buildDistMatrix, connectedComponents, UNREACHABLE } from '../src/graph/shortest';
import { syntheticGrid } from './fixtures/synthetic';

const { osm, houses } = syntheticGrid(5, 5, 3);
const g = buildGraph(osm);

describe('Oracle', () => {
  it('measures opposite grid corners at about 800 m', () => {
    const o = new Oracle(g);
    const a = g.index.get(1)!;
    const b = g.index.get(25)!;
    const d = o.nodeDist(a, b);
    expect(d).toBeGreaterThan(780);
    expect(d).toBeLessThan(810);
    expect(o.nodeDist(b, a)).toBeCloseTo(d, 3);
    expect(o.nodeDist(a, a)).toBe(0);
  });

  it('returns Infinity between disconnected nodes', () => {
    const island = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42.1, -88.3], [4, 42.1, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [3, 4] },
      ],
    });
    expect(new Oracle(island).nodeDist(0, 2)).toBe(Infinity);
  });
});

describe('houseDistance', () => {
  const o = new Oracle(g);
  const base = { edge: 0, segment: 0, point: { lat: 0, lon: 0 }, offset: 0 };
  const s = (along: number, side: 1 | -1): Snap => ({ ...base, along, side });

  it('uses along-edge distance on the same side of one edge', () => {
    expect(houseDistance(o, g, s(10, 1), s(30, 1), 8)).toBeCloseTo(20, 6);
  });

  it('adds the crossing penalty on opposite sides of the same edge', () => {
    expect(houseDistance(o, g, s(10, 1), s(30, -1), 8)).toBeCloseTo(28, 6);
  });

  it('routes between different edges through the graph', () => {
    const snaps = snapHouses(houses, g);
    const first = 0;
    const last = houses.length - 1;
    const d = houseDistance(o, g, snaps[first], snaps[last], 8);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(1000);
  });

  it('is symmetric', () => {
    const snaps = snapHouses(houses, g);
    expect(houseDistance(o, g, snaps[3], snaps[77], 8)).toBeCloseTo(houseDistance(o, g, snaps[77], snaps[3], 8), 3);
  });

  it('caps unreachable pairs at UNREACHABLE', () => {
    const two = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42.1, -88.3], [4, 42.1, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [3, 4] },
      ],
    });
    const oo = new Oracle(two);
    const sa: Snap = { ...base, edge: 0, along: 5, side: 1 };
    const sb: Snap = { ...base, edge: 1, along: 5, side: 1 };
    expect(houseDistance(oo, two, sa, sb, 8)).toBe(UNREACHABLE);
  });
});

describe('buildDistMatrix', () => {
  const snaps = snapHouses(houses, g);
  const H = houses.length;
  const m = buildDistMatrix(new Oracle(g), g, snaps, 8);

  it('has H*H entries', () => {
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(H * H);
  });

  it('has a zero diagonal and is symmetric', () => {
    for (let i = 0; i < H; i += 7) {
      expect(m[i * H + i]).toBe(0);
      for (let j = 0; j < H; j += 11) expect(m[i * H + j]).toBe(m[j * H + i]);
    }
  });

  it('is finite everywhere on a connected grid', () => {
    for (let i = 0; i < m.length; i++) expect(m[i]).toBeLessThan(UNREACHABLE);
  });
});

describe('connectedComponents', () => {
  it('labels a connected grid as one component', () => {
    expect(new Set(connectedComponents(g)).size).toBe(1);
  });

  it('labels separate islands differently', () => {
    const two = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42.1, -88.3], [4, 42.1, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [3, 4] },
      ],
    });
    const c = connectedComponents(two);
    expect(c[0]).toBe(c[1]);
    expect(c[2]).toBe(c[3]);
    expect(c[0]).not.toBe(c[2]);
  });
});
