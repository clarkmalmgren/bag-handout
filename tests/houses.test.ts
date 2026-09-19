import { describe, it, expect } from 'vitest';
import { buildHouses } from '../src/data/houses';
import type { ParsedOverpass, Building, AddrNode } from '../src/data/parse';
import type { LatLon } from '../src/types';

const square = (lat: number, lon: number, s = 0.0001): LatLon[] => [
  { lat, lon }, { lat, lon: lon + s }, { lat: lat + s, lon: lon + s }, { lat: lat + s, lon }, { lat, lon },
];
const bld = (id: number, lat: number, lon: number, tags: Record<string, string>): Building => ({ id, ring: square(lat, lon), tags });
const parsed = (buildings: Building[], addrNodes: AddrNode[] = []): ParsedOverpass => ({
  osm: { nodes: [], ways: [] }, buildings, addrNodes,
});

describe('buildHouses', () => {
  it('keeps an addressed house with its label', () => {
    const h = buildHouses(parsed([bld(1, 42, -88.3, { building: 'house', 'addr:housenumber': '12', 'addr:street': 'Oak St' })]), null);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: 'w1', label: '12 Oak St', street: 'Oak St', flagged: false, manual: false });
  });

  it('drops garages and sheds', () => {
    const h = buildHouses(parsed([bld(1, 42, -88.3, { building: 'garage' }), bld(2, 42, -88.301, { building: 'shed' })]), null);
    expect(h).toHaveLength(0);
  });

  it('drops generic building=yes without an address', () => {
    expect(buildHouses(parsed([bld(1, 42, -88.3, { building: 'yes' })]), null)).toHaveLength(0);
  });

  it('keeps residential buildings without an address and flags them', () => {
    const h = buildHouses(parsed([bld(1, 42, -88.3, { building: 'house' })]), null);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ label: '(no address)', flagged: true });
  });

  it('merges an address node inside a footprint (counted once, address kept)', () => {
    const b = bld(1, 42, -88.3, { building: 'house' });
    const a: AddrNode = { id: 50, pos: { lat: 42.00005, lon: -88.29995 }, number: '7', street: 'Elm St' };
    const h = buildHouses(parsed([b], [a]), null);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ label: '7 Elm St', flagged: false });
  });

  it('turns address nodes outside any building into houses', () => {
    const a: AddrNode = { id: 51, pos: { lat: 42.01, lon: -88.31 }, number: '3', street: 'Elm St' };
    const h = buildHouses(parsed([], [a]), null);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: 'n51', label: '3 Elm St', lat: 42.01, lon: -88.31 });
  });

  it('excludes houses outside the boundary ring', () => {
    const boundary = square(41.9, -88.4, 0.05); // nowhere near lat 42
    const h = buildHouses(parsed([bld(1, 42, -88.3, { building: 'house', 'addr:housenumber': '1' })]), boundary);
    expect(h).toHaveLength(0);
  });
});
