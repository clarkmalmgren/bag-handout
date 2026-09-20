import type { Polygon } from 'geojson';
import { defaultConfig, type ProjectState } from './state';
import type { Config, House, LatLon, OsmData } from './types';

export const PROJECT_VERSION = 1;

export function serializeProject(s: ProjectState): string {
  return JSON.stringify({ version: PROJECT_VERSION, ...s });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function fail(msg: string): never {
  throw new Error(`Invalid project file: ${msg}`);
}

function num(v: unknown): number | undefined {
  if (isNum(v)) return v;
  if (isStr(v) && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Numeric config value clamped to [lo, hi] (rounded when `int`); missing or non-finite values give the default. */
function clamp(v: unknown, lo: number, hi: number, dflt: number, int = false): number {
  const n = num(v);
  if (n === undefined) return dflt;
  const c = Math.min(hi, Math.max(lo, int ? Math.round(n) : n));
  return c;
}

function parseConfig(raw: unknown): Config {
  const d = defaultConfig();
  const c = isObj(raw) ? raw : {};
  const w = isObj(c.weights) ? c.weights : {};
  const weight = (v: unknown, dflt: number): number => {
    const n = num(v);
    return n !== undefined && n >= 0 ? n : dflt;
  };
  return {
    groups: clamp(c.groups, 2, 12, d.groups, true),
    iterations: clamp(c.iterations, 0, 200000, d.iterations, true),
    crossingPenalty: clamp(c.crossingPenalty, 0, 1000, d.crossingPenalty),
    seed: clamp(c.seed, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, d.seed, true),
    walkSpeed: clamp(c.walkSpeed, 0.1, 5, d.walkSpeed),
    secPerHouse: clamp(c.secPerHouse, 0, 600, d.secPerHouse),
    weights: {
      maxRoute: weight(w.maxRoute, d.weights.maxRoute),
      total: weight(w.total, d.weights.total),
      // Projects saved before the percentage tolerance have only `tolerance`; they keep it as the
      // floor and pick up the default percentage, so an old file still loads and stays at least as tight.
      toleranceFrac: clamp(w.toleranceFrac, 0, 1, d.weights.toleranceFrac),
      tolerance: clamp(w.tolerance, 0, 20, d.weights.tolerance),
      compact: clamp(w.compact, 0, 100, d.weights.compact),
    },
  };
}

function parseHouses(v: unknown): House[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail('houses must be an array');
  return v.map((h, i): House => {
    if (!isObj(h)) fail(`houses[${i}] is not an object`);
    if (!isNum(h.lat) || !isNum(h.lon)) fail(`houses[${i}] needs finite lat and lon`);
    if (!isStr(h.id) || !isStr(h.label) || !isStr(h.street)) fail(`houses[${i}] needs string id, label and street`);
    return { id: h.id, lat: h.lat, lon: h.lon, label: h.label, street: h.street, flagged: h.flagged === true, manual: h.manual === true };
  });
}

function parseStringArray(v: unknown, name: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every(isStr)) fail(`${name} must be an array of strings`);
  return v as string[];
}

function parseAssignment(v: unknown): Record<string, number> {
  if (v === undefined) return {};
  if (!isObj(v)) fail('assignment must be an object');
  for (const [k, g] of Object.entries(v)) {
    if (typeof g !== 'number' || !Number.isInteger(g)) fail(`assignment["${k}"] must be an integer`);
  }
  return v as Record<string, number>;
}

function parseOsm(v: unknown): OsmData | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || !Array.isArray(v.nodes) || !Array.isArray(v.ways)) fail('osm must be null or {nodes: [], ways: []}');
  v.nodes.forEach((n, i) => {
    if (!Array.isArray(n) || n.length !== 3 || !n.every(isNum)) fail(`osm.nodes[${i}] must be [id, lat, lon] numbers`);
  });
  v.ways.forEach((w, i) => {
    if (!isObj(w) || !isNum(w.id) || !isStr(w.name) || !isStr(w.highway) || !Array.isArray(w.nodes) || !w.nodes.every(isNum)) {
      fail(`osm.ways[${i}] must be {id: number, name: string, highway: string, nodes: number[]}`);
    }
  });
  return v as unknown as OsmData;
}

function parseBoundary(v: unknown): Polygon | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || v.type !== 'Polygon' || !Array.isArray(v.coordinates)) fail('boundary must be null or a GeoJSON Polygon');
  v.coordinates.forEach((ring, r) => {
    if (!Array.isArray(ring) || !ring.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]))) {
      fail(`boundary.coordinates[${r}] must be an array of [lon, lat] positions`);
    }
  });
  return v as unknown as Polygon;
}

/** Validates the whole shape and throws a descriptive Error before anything is returned (so nothing is committed). */
export function parseProject(text: string): ProjectState {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    fail('not valid JSON');
  }
  if (!isObj(o)) fail('expected a JSON object');
  if (o.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version ${String(o.version)}`);
  }
  return {
    boundary: parseBoundary(o.boundary),
    osm: parseOsm(o.osm),
    houses: parseHouses(o.houses),
    removed: parseStringArray(o.removed, 'removed'),
    assignment: parseAssignment(o.assignment),
    locked: parseStringArray(o.locked, 'locked'),
    config: parseConfig(o.config),
  };
}

/** Outer ring of a GeoJSON polygon as LatLon[] (GeoJSON is [lon, lat]). */
export function ringOf(boundary: Polygon | null): LatLon[] | null {
  if (!boundary) return null;
  const ring = boundary.coordinates[0];
  if (!ring) return null;
  return ring.map(([lon, lat]) => ({ lat, lon }));
}
