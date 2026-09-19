import type { Polygon } from 'geojson';
import type { House, OsmData } from '../types';
import { ringOf } from '../project';
import { parseOverpass } from './parse';
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

export function hashPolygon(polygon: Polygon): string {
  const s = polyString(polygon);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

async function idbCache(): Promise<Cache> {
  const { get, set } = await import('idb-keyval');
  return { get: (k) => get(k), set: (k, v) => set(k, v) };
}

export async function fetchOverpass(polygon: Polygon, opts: FetchOptions = {}): Promise<FetchResult> {
  const cache = opts.cache ?? (await idbCache());
  const key = `overpass:${hashPolygon(polygon)}`;
  if (!opts.force) {
    const hit = (await cache.get(key)) as FetchResult | undefined;
    if (hit) return hit;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const body = `data=${encodeURIComponent(buildQuery(polygon))}`;
  let lastError = 'no endpoints tried';
  for (const url of ENDPOINTS) {
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
      const parsed = parseOverpass(await res.json());
      const result: FetchResult = { osm: parsed.osm, houses: buildHouses(parsed, ringOf(polygon)) };
      await cache.set(key, result);
      return result;
    } catch (e) {
      lastError = `${url}: ${(e as Error).message}`;
    }
  }
  throw new Error(`Overpass request failed (${lastError})`);
}
