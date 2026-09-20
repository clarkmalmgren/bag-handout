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

  it('includes the door-to-street legs and does not double count them on one side', () => {
    const so = (along: number, side: 1 | -1, offset: number): Snap => ({ ...base, along, side, offset });
    // same side, same offsets: the shared door-to-street distance cancels
    expect(houseDistance(o, g, so(10, 1, 15), so(30, 1, 15), 8)).toBeCloseTo(20, 6);
    // same side, different offsets: diagonal
    expect(houseDistance(o, g, so(10, 1, 10), so(40, 1, 50), 8)).toBeCloseTo(50, 6);
    // opposite sides: both legs plus the crossing penalty, never less than the same-side value
    const opp = houseDistance(o, g, so(10, 1, 15), so(30, -1, 15), 8);
    expect(opp).toBeCloseTo(20 + 15 + 15 + 8, 6);
    expect(opp).toBeGreaterThanOrEqual(houseDistance(o, g, so(10, 1, 15), so(30, 1, 15), 8));
  });

  it('adds both offsets to a path across different edges', () => {
    const snaps = snapHouses(houses, g);
    const a = snaps[0];
    const b = snaps[houses.length - 1];
    const bare = houseDistance(o, g, { ...a, offset: 0 }, { ...b, offset: 0 }, 8);
    expect(houseDistance(o, g, { ...a, offset: 12 }, { ...b, offset: 7 }, 8)).toBeCloseTo(bare + 19, 6);
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

describe('back-to-back houses', () => {
  // Two parallel east-west streets 44 m apart joined at both ends; one house on each, at the same x.
  // Houses stand ~15 m off their own street on the sides facing each other (the backyards).
  const par = buildGraph({
    nodes: [[1, 42, -88.3], [2, 42, -88.298], [3, 42.0004, -88.3], [4, 42.0004, -88.298]],
    ways: [
      { id: 1, name: 'Front St', highway: 'residential', nodes: [1, 2] },
      { id: 2, name: 'Back St', highway: 'residential', nodes: [3, 4] },
      { id: 3, name: 'West St', highway: 'residential', nodes: [1, 3] },
      { id: 4, name: 'East St', highway: 'residential', nodes: [2, 4] },
    ],
  });
  const mk = (id: string, lat: number, lon: number, street: string) => ({ id, lat, lon, label: id, street, flagged: false, manual: false });
  const hs = [
    mk('front', 42.00013, -88.299, 'Front St'),
    mk('back', 42.00027, -88.299, 'Back St'),
    mk('front2', 42.00013, -88.29892, 'Front St'), // ~9 m along the same street from `front`
  ];
  const sn = snapHouses(hs, par);
  const oo = new Oracle(par);

  it('costs far more than neighbours on one street', () => {
    const neighbours = houseDistance(oo, par, sn[0], sn[2], 8);
    const backToBack = houseDistance(oo, par, sn[0], sn[1], 8);
    expect(sn[0].edge).not.toBe(sn[1].edge);
    expect(neighbours).toBeLessThan(15);
    // straight-line they are only ~15 m apart, but walking means going around a block end (~90+ m)
    expect(backToBack).toBeGreaterThan(5 * neighbours);
    expect(backToBack).toBeGreaterThan(sn[0].offset + sn[1].offset + 100);
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
