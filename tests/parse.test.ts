import { describe, it, expect } from 'vitest';
import { parseOverpass } from '../src/data/parse';

const elements = [
  { type: 'node', id: 1, lat: 42.0, lon: -88.3 },
  { type: 'node', id: 2, lat: 42.0, lon: -88.299 },
  { type: 'node', id: 3, lat: 42.0, lon: -88.298 },
  { type: 'node', id: 4, lat: 42.001, lon: -88.3 },
  { type: 'node', id: 5, lat: 42.001, lon: -88.2999 },
  { type: 'node', id: 6, lat: 42.0011, lon: -88.2999 },
  { type: 'node', id: 7, lat: 42.0011, lon: -88.3 },
  { type: 'node', id: 30, lat: 42.002, lon: -88.3, tags: { 'addr:housenumber': '9', 'addr:street': 'Elm St' } },
  { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential', name: 'Oak St' } },
  { type: 'way', id: 11, nodes: [1, 3], tags: { highway: 'motorway', name: 'I-88' } },
  { type: 'way', id: 12, nodes: [1, 2], tags: { highway: 'service', service: 'driveway' } },
  { type: 'way', id: 13, nodes: [2, 3, 99], tags: { highway: 'footway' } },
  { type: 'way', id: 20, nodes: [4, 5, 6, 7, 4], tags: { building: 'house', 'addr:housenumber': '12', 'addr:street': 'Oak St' } },
  // duplicate skeleton node emitted by "out skel" (no tags) must not drop the tagged one
  { type: 'node', id: 30, lat: 42.002, lon: -88.3 },
];

describe('parseOverpass', () => {
  const p = parseOverpass({ elements: elements as never });

  it('keeps walkable ways and skips motorways and driveways', () => {
    expect(p.osm.ways.map((w) => w.id).sort()).toEqual([10, 13]);
  });

  it('filters way nodes to nodes we know about', () => {
    const w13 = p.osm.ways.find((w) => w.id === 13)!;
    expect(w13.nodes).toEqual([2, 3]);
  });

  it('only emits nodes used by kept ways', () => {
    expect(p.osm.nodes.map((n) => n[0]).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('collects buildings with rings', () => {
    expect(p.buildings).toHaveLength(1);
    expect(p.buildings[0].ring).toHaveLength(5);
    expect(p.buildings[0].tags.building).toBe('house');
  });

  it('collects address nodes', () => {
    expect(p.addrNodes).toEqual([{ id: 30, pos: { lat: 42.002, lon: -88.3 }, number: '9', street: 'Elm St' }]);
  });
});
