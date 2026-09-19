import { describe, it, expect, vi } from 'vitest';
import type { Polygon } from 'geojson';
import { fetchHouseData } from '../src/data/houseSource';
import { ENDPOINTS } from '../src/data/overpass';
import { KANE_URL } from '../src/data/kane';

const poly: Polygon = {
  type: 'Polygon',
  coordinates: [[[-88.3, 42.0], [-88.29, 42.0], [-88.29, 42.01], [-88.3, 42.01], [-88.3, 42.0]]],
};
const osmBody = {
  elements: [
    { type: 'node', id: 1, lat: 42.0, lon: -88.295 },
    { type: 'node', id: 2, lat: 42.0, lon: -88.294 },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential', name: 'Oak St' } },
    { type: 'node', id: 30, lat: 42.005, lon: -88.295, tags: { 'addr:housenumber': '9', 'addr:street': 'Oak St' } },
  ],
};
const kaneBody = {
  features: [{
    attributes: { PIN: '77', SiteAddress: '5 ELM ST', UseCodeDescription: 'Residential Improved Lot' },
    geometry: { rings: [[[-88.296, 42.004], [-88.295, 42.004], [-88.295, 42.005], [-88.296, 42.005], [-88.296, 42.004]]] },
  }],
};
const memCache = () => {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v) };
};
const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function router(kane: () => unknown, osm: () => unknown) {
  return vi.fn(async (url: string) => {
    if (url === KANE_URL) return kane();
    if (ENDPOINTS.includes(url)) return osm();
    throw new Error('unexpected url');
  }) as never;
}

describe('fetchHouseData', () => {
  it('prefers Kane houses and keeps OSM roads', async () => {
    const r = await fetchHouseData(poly, { fetchImpl: router(() => res(kaneBody), () => res(osmBody)), cache: memCache() });
    expect(r.source).toBe('kane');
    expect(r.houses.map((h) => h.id)).toEqual(['k77']);
    expect(r.osm.ways).toHaveLength(1);
  });

  it('falls back to OSM houses with a note when Kane is empty', async () => {
    const r = await fetchHouseData(poly, { fetchImpl: router(() => res({ features: [] }), () => res(osmBody)), cache: memCache() });
    expect(r.source).toBe('osm');
    expect(r.houses).toHaveLength(1);
    expect(r.note).toMatch(/Kane County parcels unavailable/);
  });

  it('falls back to OSM houses when Kane throws', async () => {
    const r = await fetchHouseData(poly, { fetchImpl: router(() => { throw new Error('network down'); }, () => res(osmBody)), cache: memCache() });
    expect(r.source).toBe('osm');
    expect(r.note).toMatch(/network down/);
  });

  it('throws when Overpass fails, even if Kane works', async () => {
    const fetchImpl = router(() => res(kaneBody), () => ({ ok: false, status: 504, json: async () => ({}) }));
    await expect(fetchHouseData(poly, { fetchImpl, cache: memCache() })).rejects.toThrow(/Overpass/);
  });
});
