import { describe, it, expect, vi } from 'vitest';
import type { Polygon } from 'geojson';
import { buildQuery, polyString, hashPolygon, fetchOverpass } from '../src/data/overpass';

const poly: Polygon = {
  type: 'Polygon',
  coordinates: [[[-88.3, 42.0], [-88.29, 42.0], [-88.29, 42.01], [-88.3, 42.01], [-88.3, 42.0]]],
};

describe('overpass query', () => {
  it('writes the poly filter as lat lon pairs without the closing duplicate', () => {
    expect(polyString(poly)).toBe('42.000000 -88.300000 42.000000 -88.290000 42.010000 -88.290000 42.010000 -88.300000');
  });

  it('builds a query covering roads, buildings and address nodes', () => {
    const q = buildQuery(poly);
    expect(q).toContain('[out:json]');
    expect(q).toContain('way["highway"]');
    expect(q).toContain('way["building"]');
    expect(q).toContain('node["addr:housenumber"]');
    expect(q).toContain(`(poly:"${polyString(poly)}")`);
    expect(q).toContain('out skel qt;');
  });

  it('hashes deterministically and differs per polygon', () => {
    const other: Polygon = { ...poly, coordinates: [[[-88.3, 42.0], [-88.28, 42.0], [-88.28, 42.01], [-88.3, 42.0]]] };
    expect(hashPolygon(poly)).toBe(hashPolygon(poly));
    expect(hashPolygon(poly)).not.toBe(hashPolygon(other));
  });
});

describe('fetchOverpass', () => {
  const body = {
    elements: [
      { type: 'node', id: 1, lat: 42.0, lon: -88.295 },
      { type: 'node', id: 2, lat: 42.0, lon: -88.294 },
      { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential', name: 'Oak St' } },
      { type: 'node', id: 30, lat: 42.005, lon: -88.295, tags: { 'addr:housenumber': '9', 'addr:street': 'Oak St' } },
    ],
  };
  const memCache = () => {
    const m = new Map<string, unknown>();
    return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v) };
  };

  it('falls back to the next mirror, then serves the second call from cache', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
    const cache = memCache();
    const r1 = await fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r1.houses).toHaveLength(1);
    expect(r1.osm.ways).toHaveLength(1);
    const r2 = await fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r2).toEqual(r1);
  });

  it('throws when every mirror fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => ({}) });
    await expect(fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache: memCache() })).rejects.toThrow(/Overpass/);
  });
});
