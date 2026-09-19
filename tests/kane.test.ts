import { describe, it, expect, vi } from 'vitest';
import type { Polygon } from 'geojson';
import { fetchKaneHouses, parseKaneFeatures, formatAddress, kaneCacheKey, KANE_PAGE_SIZE, type KaneFeature } from '../src/data/kane';

const poly: Polygon = {
  type: 'Polygon',
  coordinates: [[[-88.386, 41.857], [-88.37, 41.857], [-88.37, 41.866], [-88.386, 41.866], [-88.386, 41.857]]],
};
const boundary = poly.coordinates[0].map(([lon, lat]) => ({ lat, lon }));

const sq = (lon: number, lat: number, d = 0.0002): number[][] => [
  [lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat],
];
const feat = (pin: string | null, addr: string | null, use: string, rings: number[][][]): KaneFeature => ({
  attributes: { PIN: pin, SiteAddress: addr, UseCodeDescription: use },
  geometry: { rings },
});
const RES = 'Residential Improved Lot';

const features: KaneFeature[] = [
  feat('1111', '39W514 BEALER CIR', RES, [sq(-88.38, 41.86)]),
  feat('2222', '', 'Vacant Lots-Land', [sq(-88.379, 41.86)]),
  feat('3333', '100 MAIN ST', 'Exempt', [sq(-88.378, 41.86)]),
  feat('4444', '  ', RES, [sq(-88.377, 41.86)]),
  feat('1111', '39W514 BEALER CIR', RES, [sq(-88.38, 41.86)]),
  feat('5555', '12 N RIVER ST', RES, [sq(-88.3, 41.86)]), // outside
  // small hole listed first, large outer ring second
  feat('6666', '1 1ST ST', RES, [sq(-88.3752, 41.8602, 0.00004), sq(-88.3755, 41.86, 0.0004)]),
  feat(null, '7 OAK AVE', RES, [sq(-88.374, 41.86)]),
];

describe('formatAddress', () => {
  it('title-cases, keeping digit tokens and directionals upper', () => {
    expect(formatAddress('39W514 BEALER CIR')).toEqual({ label: '39W514 Bealer Cir', street: 'Bealer Cir' });
    expect(formatAddress('12 N RIVER ST')).toEqual({ label: '12 N River St', street: 'N River St' });
    expect(formatAddress('5 1ST ST')).toEqual({ label: '5 1st St', street: '1st St' });
  });
});

describe('parseKaneFeatures', () => {
  const houses = parseKaneFeatures(features, boundary);
  it('keeps only addressed residential lots, deduped by PIN, skipping missing PINs', () => {
    expect(houses.map((h) => h.id)).toEqual(['k1111', 'k6666']);
  });
  it('labels and flags houses', () => {
    expect(houses[0]).toMatchObject({ label: '39W514 Bealer Cir', street: 'Bealer Cir', flagged: false, manual: false });
  });
  it('puts the point at the lot centroid, inside the boundary', () => {
    expect(houses[0].lon).toBeCloseTo(-88.3799, 4);
    expect(houses[0].lat).toBeCloseTo(41.8601, 4);
  });
  it('uses the largest ring as the outer ring', () => {
    expect(houses[1].lon).toBeCloseTo(-88.3753, 4);
  });
  it('drops houses outside the boundary but keeps them when there is none', () => {
    expect(parseKaneFeatures(features, null).map((h) => h.id)).toContain('k5555');
  });
});

describe('fetchKaneHouses', () => {
  const memCache = () => {
    const m = new Map<string, unknown>();
    return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v) };
  };
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it('pages while exceededTransferLimit is set and sends esri polygon JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ features: features.slice(0, 3), exceededTransferLimit: true }))
      .mockResolvedValueOnce(json({ features: features.slice(3) }));
    const houses = await fetchKaneHouses(poly, { fetchImpl: fetchImpl as never, cache: memCache() });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(houses.map((h) => h.id)).toEqual(['k1111', 'k6666']);
    const p1 = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
    const p2 = new URLSearchParams(fetchImpl.mock.calls[1][1].body);
    expect(p1.get('resultOffset')).toBe('0');
    expect(p2.get('resultOffset')).toBe(String(KANE_PAGE_SIZE));
    expect(JSON.parse(p1.get('geometry')!)).toEqual({ rings: poly.coordinates, spatialReference: { wkid: 4326 } });
    expect(p1.get('geometryType')).toBe('esriGeometryPolygon');
  });

  it('throws on an ArcGIS error body, HTTP failure and malformed body', async () => {
    const c = () => memCache();
    await expect(fetchKaneHouses(poly, { cache: c(), fetchImpl: vi.fn().mockResolvedValue(json({ error: { code: 400, message: 'Invalid geometry' } })) as never })).rejects.toThrow(/Invalid geometry/);
    await expect(fetchKaneHouses(poly, { cache: c(), fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as never })).rejects.toThrow(/HTTP 503/);
    await expect(fetchKaneHouses(poly, { cache: c(), fetchImpl: vi.fn().mockResolvedValue(json({ nope: 1 })) as never })).rejects.toThrow(/malformed/);
  });

  it('returns [] for an empty result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ features: [] }));
    expect(await fetchKaneHouses(poly, { fetchImpl: fetchImpl as never, cache: memCache() })).toEqual([]);
  });

  it('serves from cache, and force bypasses it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ features }));
    const cache = memCache();
    const r1 = await fetchKaneHouses(poly, { fetchImpl: fetchImpl as never, cache });
    expect(await cache.get(kaneCacheKey(poly))).toEqual(r1);
    await fetchKaneHouses(poly, { fetchImpl: fetchImpl as never, cache });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await fetchKaneHouses(poly, { fetchImpl: fetchImpl as never, cache, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
