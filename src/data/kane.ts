import type { Polygon } from 'geojson';
import type { House, LatLon } from '../types';
import { pointInRing, ringCentroid } from '../geo';
import { ringOf } from '../project';
import { hashPolygon, idbCache, type Cache } from './overpass';

export const KANE_URL = 'https://gistech.countyofkane.org/arcgis/rest/services/KanePINList/MapServer/0/query';
export const KANE_PAGE_SIZE = 1000;
const RESIDENTIAL = 'Residential Improved Lot';

export interface KaneFeature {
  attributes?: { PIN?: string | number | null; SiteAddress?: string | null; UseCodeDescription?: string | null };
  geometry?: { rings?: number[][][] };
}
export interface KaneOptions { fetchImpl?: typeof fetch; cache?: Cache; force?: boolean }

export function kaneCacheKey(polygon: Polygon): string {
  return `kane:v1:${hashPolygon(polygon)}`;
}

const DIRECTIONAL = /^(N|S|E|W|NE|NW|SE|SW)$/i;
const ROMAN = /^(II|III|IV|VI|VII|VIII|IX|XI|XII)$/i;
const ORDINAL = /^\d+(ST|ND|RD|TH)$/i;

function titleToken(t: string): string {
  if (ORDINAL.test(t)) return t.toLowerCase();
  if (/\d/.test(t) || DIRECTIONAL.test(t) || ROMAN.test(t)) return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** "39W514 BEALER CIR" -> label "39W514 Bealer Cir", street "Bealer Cir". */
export function formatAddress(raw: string): { label: string; street: string } {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length - 1 && /^\d/.test(tokens[i]) && !ORDINAL.test(tokens[i])) i++;
  return {
    label: tokens.map(titleToken).join(' '),
    street: tokens.slice(i).map(titleToken).join(' '),
  };
}

function ringArea(r: LatLon[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].lon * r[i].lat - r[i].lon * r[j].lat;
  return Math.abs(a / 2);
}

export function parseKaneFeatures(features: KaneFeature[], boundary: LatLon[] | null): House[] {
  const houses: House[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const a = f.attributes;
    if (!a || a.UseCodeDescription !== RESIDENTIAL) continue;
    const address = typeof a.SiteAddress === 'string' ? a.SiteAddress.trim() : '';
    const pin = a.PIN == null ? '' : String(a.PIN).trim();
    if (!address || !pin || seen.has(pin)) continue;
    const rings = (f.geometry?.rings ?? [])
      .map((r) => r.map(([lon, lat]) => ({ lat, lon })))
      .filter((r) => r.length >= 3);
    if (rings.length === 0) continue;
    const outer = rings.reduce((best, r) => (ringArea(r) > ringArea(best) ? r : best));
    const c = ringCentroid(outer);
    if (boundary && !pointInRing(c, boundary)) continue;
    seen.add(pin);
    const { label, street } = formatAddress(address);
    houses.push({ id: `k${pin}`, lat: c.lat, lon: c.lon, label, street, flagged: false, manual: false });
  }
  return houses;
}

async function fetchPage(doFetch: typeof fetch, polygon: Polygon, offset: number): Promise<{ features: KaneFeature[]; more: boolean }> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ rings: [polygon.coordinates[0]], spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'PIN,SiteAddress,UseCodeDescription',
    returnGeometry: 'true',
    resultOffset: String(offset),
    resultRecordCount: String(KANE_PAGE_SIZE),
  });
  const res = await doFetch(KANE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Kane County parcel service returned HTTP ${res.status}`);
  const body = (await res.json()) as { error?: { message?: string; code?: number }; features?: unknown; exceededTransferLimit?: boolean };
  if (typeof body !== 'object' || body === null) throw new Error('Kane County parcel service: malformed response');
  if (body.error) throw new Error(`Kane County parcel service error: ${body.error.message ?? body.error.code ?? 'unknown'}`);
  if (!Array.isArray(body.features)) throw new Error('Kane County parcel service: malformed response (no features array)');
  return { features: body.features as KaneFeature[], more: body.exceededTransferLimit === true && body.features.length > 0 };
}

export async function fetchKaneHouses(polygon: Polygon, opts: KaneOptions = {}): Promise<House[]> {
  // Best-effort cache, as in fetchOverpass.
  let cache: Cache | null = null;
  try {
    cache = opts.cache ?? (await idbCache());
  } catch (e) {
    console.warn('Kane cache unavailable; fetching uncached', e);
  }
  const key = kaneCacheKey(polygon);
  if (cache && !opts.force) {
    try {
      const hit = (await cache.get(key)) as House[] | undefined;
      if (hit) return hit;
    } catch (e) {
      console.warn('Kane cache read failed', e);
    }
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const features: KaneFeature[] = [];
  for (let offset = 0; ; offset += KANE_PAGE_SIZE) {
    const page = await fetchPage(doFetch, polygon, offset);
    features.push(...page.features);
    if (!page.more) break;
  }
  const houses = parseKaneFeatures(features, ringOf(polygon));
  if (cache) {
    try {
      await cache.set(key, houses);
    } catch (e) {
      console.warn('Kane cache write failed', e);
    }
  }
  return houses;
}
