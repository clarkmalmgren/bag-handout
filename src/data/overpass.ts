import type { Polygon } from 'geojson';
import type { House, OsmData } from '../types';
import { ringOf } from '../project';
import { parseOverpass, type OverpassElement } from './parse';
import { buildHouses } from './houses';

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export interface FetchResult { osm: OsmData; houses: House[] }
export interface Cache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
export interface FetchOptions {
  fetchImpl?: typeof fetch;
  cache?: Cache;
  force?: boolean;
}

export function polyString(polygon: Polygon): string {
  let ring = polygon.coordinates[0];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring = ring.slice(0, -1);
  return ring.map(([lon, lat]) => `${lat.toFixed(6)} ${lon.toFixed(6)}`).join(' ');
}

export function buildQuery(polygon: Polygon): string {
  const p = polyString(polygon);
  return `[out:json][timeout:90];
(
  way["highway"]["highway"!~"motorway|motorway_link|construction|proposed|abandoned|raceway"](poly:"${p}");
  way["building"](poly:"${p}");
  way["addr:housenumber"](poly:"${p}");
  node["addr:housenumber"](poly:"${p}");
);
out body;
>;
out skel qt;`;
}

/** Bump when the cached FetchResult shape or the parsing changes so stale entries are ignored. */
export const CACHE_VERSION = 'v2';

/** Two independent 32-bit hashes (djb2, FNV-1a) plus the string length, to make collisions negligible. */
export function hashPolygon(polygon: Polygon): string {
  const s = polyString(polygon);
  let h1 = 5381;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = Math.imul(h2 ^ c, 0x01000193);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}-${s.length.toString(16)}`;
}

export function cacheKey(polygon: Polygon): string {
  return `overpass:${CACHE_VERSION}:${hashPolygon(polygon)}`;
}

export async function idbCache(): Promise<Cache> {
  const { get, set } = await import('idb-keyval');
  return { get: (k) => get(k), set: (k, v) => set(k, v) };
}

const SOFT_FAILURE = /error|timed out|out of memory/i;

/** Overpass can answer HTTP 200 with a runtime-error remark and/or no elements; that is a failure, not data. */
function checkBody(body: unknown): { elements: OverpassElement[] } {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { elements?: unknown }).elements)) {
    throw new Error('malformed response (no elements array)');
  }
  const b = body as { remark?: unknown; elements: OverpassElement[] };
  if (typeof b.remark === 'string' && SOFT_FAILURE.test(b.remark)) throw new Error(`server reported: ${b.remark}`);
  if (b.elements.length === 0) throw new Error('empty result (server may be overloaded, or the boundary contains no map data)');
  return b;
}

export async function fetchOverpass(polygon: Polygon, opts: FetchOptions = {}): Promise<FetchResult> {
  // The cache is best-effort: any failure of it must never block a network fetch or discard its result.
  let cache: Cache | null = null;
  try {
    cache = opts.cache ?? (await idbCache());
  } catch (e) {
    console.warn('Overpass cache unavailable; fetching uncached', e);
  }
  const key = cacheKey(polygon);
  if (cache && !opts.force) {
    try {
      const hit = (await cache.get(key)) as FetchResult | undefined;
      if (hit) return hit;
    } catch (e) {
      console.warn('Overpass cache read failed', e);
    }
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const body = `data=${encodeURIComponent(buildQuery(polygon))}`;
  let lastError = 'no endpoints tried';
  for (const url of ENDPOINTS) {
    let result: FetchResult;
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        lastError = `${url} returned HTTP ${res.status}`;
        continue;
      }
      const parsed = parseOverpass(checkBody(await res.json()));
      result = { osm: parsed.osm, houses: buildHouses(parsed, ringOf(polygon)) };
    } catch (e) {
      lastError = `${url}: ${(e as Error).message}`;
      continue;
    }
    if (cache) {
      try {
        await cache.set(key, result);
      } catch (e) {
        console.warn('Overpass cache write failed', e);
      }
    }
    return result;
  }
  throw new Error(`Overpass request failed (${lastError})`);
}
