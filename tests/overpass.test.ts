import { describe, it, expect, vi } from 'vitest';
import type { Polygon } from 'geojson';
import { buildQuery, polyString, hashPolygon, fetchOverpass, cacheKey, CACHE_VERSION } from '../src/data/overpass';

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

  const ok = { ok: true, status: 200, json: async () => body };
  const soft = { ok: true, status: 200, json: async () => ({ remark: 'runtime error: Query timed out in "query" at line 1', elements: [] }) };
  const softWithData = { ok: true, status: 200, json: async () => ({ remark: 'runtime error: Query ran out of memory', elements: body.elements }) };
  const empty = { ok: true, status: 200, json: async () => ({ elements: [] }) };

  it('treats a soft failure (runtime-error remark) as a failed mirror, does not cache it, and tries the next', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(soft).mockResolvedValueOnce(ok);
    const cache = memCache();
    const r = await fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.houses).toHaveLength(1);
    expect(await cache.get(cacheKey(poly))).toEqual(r); // the good result, not the soft failure
  });

  it('rejects a remark about errors even when elements are present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(softWithData);
    const cache = memCache();
    await expect(fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache })).rejects.toThrow(/out of memory/);
    expect(await cache.get(cacheKey(poly))).toBeUndefined();
  });

  it('never caches an empty result and throws when all mirrors return it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(empty);
    const cache = memCache();
    await expect(fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache })).rejects.toThrow(/empty result/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await cache.get(cacheKey(poly))).toBeUndefined();
  });

  it('throws a clear error for a malformed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ hello: 1 }) });
    await expect(fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache: memCache() })).rejects.toThrow(/malformed response/);
    const nul = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null });
    await expect(fetchOverpass(poly, { fetchImpl: nul as never, cache: memCache() })).rejects.toThrow(/malformed response/);
  });

  it('force bypasses the cache read but refreshes the entry', async () => {
    const cache = memCache();
    await cache.set(cacheKey(poly), { osm: { nodes: [], ways: [] }, houses: [] });
    const fetchImpl = vi.fn().mockResolvedValue(ok);
    const r = await fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r.houses).toHaveLength(1);
    expect(await cache.get(cacheKey(poly))).toEqual(r);
  });

  it('prefixes the cache key with a version', () => {
    expect(cacheKey(poly)).toBe(`overpass:${CACHE_VERSION}:${hashPolygon(poly)}`);
    expect(CACHE_VERSION).toMatch(/^v\d+$/);
  });

  it('still returns a successful fetch when the cache write throws', async () => {
    const cache = { get: async () => undefined, set: async () => { throw new Error('quota'); } };
    const fetchImpl = vi.fn().mockResolvedValue(ok);
    const r = await fetchOverpass(poly, { fetchImpl: fetchImpl as never, cache });
    expect(r.houses).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fetches when the cache read throws', async () => {
    const cache = { get: async () => { throw new Error('idb'); }, set: async () => {} };
    const r = await fetchOverpass(poly, { fetchImpl: vi.fn().mockResolvedValue(ok) as never, cache });
    expect(r.houses).toHaveLength(1);
  });

  it('fetches uncached when IndexedDB is unavailable', async () => {
    vi.resetModules();
    vi.doMock('idb-keyval', () => { throw new Error('IndexedDB unavailable'); });
    const mod = await import('../src/data/overpass');
    const r = await mod.fetchOverpass(poly, { fetchImpl: vi.fn().mockResolvedValue(ok) as never });
    expect(r.houses).toHaveLength(1);
    vi.doUnmock('idb-keyval');
  });
});
