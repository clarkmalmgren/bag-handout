import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import type { Polygon } from 'geojson';
import { fetchHouseData, type HouseData } from '../src/data/houseSource';
import { buildModel } from '../src/model';
import { solve } from '../src/solver/solve';
import { defaultConfig } from '../src/state';
import { evalNorm, overlapMetric } from './metrics';
import { effectiveTolerance } from '../src/solver/cost';
import { streetChanges } from '../src/stats';

// Evaluation on the real Mill Creek data. Run with `npm run eval`; the CSV is only used for its bounding box.
// Set EVAL_OUT=path to also write the report to a file.
const here = dirname(fileURLToPath(import.meta.url));
const CSV = resolve(here, '../bag-handout-groups.csv');
const CACHE = resolve(here, 'cache/millcreek.json');
const MARGIN = 0.0005;

function boundingPolygon(): Polygon {
  const rows = readFileSync(CSV, 'utf8').trim().split(/\r?\n/).slice(1);
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const r of rows) {
    const c = r.split(',');
    const lat = Number(c[c.length - 2]);
    const lon = Number(c[c.length - 1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  }
  minLat -= MARGIN; maxLat += MARGIN; minLon -= MARGIN; maxLon += MARGIN;
  return {
    type: 'Polygon',
    coordinates: [[[minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]]],
  };
}

const evalFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', 'bag-handout-eval/0.1');
  return fetch(input, { ...init, headers });
};

async function loadData(): Promise<HouseData> {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8')) as HouseData;
  const mem = new Map<string, unknown>();
  const data = await fetchHouseData(boundingPolygon(), {
    fetchImpl: evalFetch,
    cache: { get: async (k: string) => mem.get(k), set: async (k: string, v: unknown) => { mem.set(k, v); } },
  });
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

const f = (x: number, d = 1) => x.toFixed(d);

it('millcreek evaluation', async () => {
  const data = await loadData();
  const cfg = defaultConfig();
  let model = buildModel(data.houses, data.osm, cfg.crossingPenalty);
  // Like the app's "Remove disconnected houses" button: solving is blocked while any exist.
  const dropped = model.disconnected.length;
  if (dropped > 0) {
    const bad = new Set(model.disconnected);
    model = buildModel(data.houses.filter((_, i) => !bad.has(i)), data.osm, cfg.crossingPenalty);
  }
  const n = model.houses.length;
  const t0 = Date.now();
  const sol = solve({
    distMatrix: model.dist,
    houseCount: n,
    groups: cfg.groups,
    segmentOf: model.segmentOf,
    xy: model.xy,
    weights: cfg.weights,
    seed: cfg.seed,
    iterations: cfg.iterations,
  });
  const secs = (Date.now() - t0) / 1000;
  const G = cfg.groups;

  const counts = new Array<number>(G).fill(0);
  sol.assign.forEach((g) => counts[g]++);
  const lengths = sol.tours.map((t) => t.length);

  const streetGroups = new Map<string, Set<number>>();
  const streetHouses = new Map<string, number>();
  const segGroups = new Map<number, Set<number>>();
  let wrong = 0;
  let unnamed = 0;
  let offsetSum = 0;
  model.houses.forEach((h, i) => {
    const key = evalNorm(h.street);
    (streetGroups.get(key) ?? streetGroups.set(key, new Set()).get(key)!).add(sol.assign[i]);
    streetHouses.set(key, (streetHouses.get(key) ?? 0) + 1);
    const sn = model.snaps[i];
    (segGroups.get(sn.segment) ?? segGroups.set(sn.segment, new Set()).get(sn.segment)!).add(sol.assign[i]);
    offsetSum += sn.offset;
    const es = model.graph.edges[sn.edge].street;
    if (es === '') unnamed++;
    if (evalNorm(es) !== key) wrong++;
  });
  let splitStreets = 0;
  let splitStreetHouses = 0;
  for (const [k, s] of streetGroups) {
    if (s.size > 1) { splitStreets++; splitStreetHouses += streetHouses.get(k)!; }
  }
  const splitSegs = [...segGroups.values()].filter((s) => s.size > 1).length;
  const usedSegs = segGroups.size;

  const total = lengths.reduce((a, b) => a + b, 0);
  const tol = effectiveTolerance(n / G, cfg.weights);
  const changes = sol.tours.map((t) => streetChanges(t.order, model.houses.map((h) => h.street)));

  const lines = [
    `source=${data.source} houses=${n} (dropped ${dropped} disconnected) streets=${streetGroups.size} groups=${G} seed=${cfg.seed} iterations=${cfg.iterations} solve=${f(secs)}s feasible=${sol.feasible}`,
    `weights            : maxRoute=${cfg.weights.maxRoute} total=${cfg.weights.total} compact=${cfg.weights.compact} tolerance=+-${(100 * cfg.weights.toleranceFrac).toFixed(0)}% (min ${cfg.weights.tolerance}) -> +-${tol} houses`,
    `houses per group   : ${counts.join(' ')}`,
    `loop length (m)    : ${lengths.map((l) => Math.round(l)).join(' ')}`,
    `loop max / total   : ${f(Math.max(...lengths), 0)} / ${f(total, 0)} m (max / mean = ${f(Math.max(...lengths) / (total / G), 2)})`,
    `street changes     : ${changes.join(' ')}`,
    `kNN cut links      : ${sol.cut}`,
    `split street names : ${splitStreets} of ${streetGroups.size} (${splitStreetHouses} houses on them)`,
    `split segments     : ${splitSegs} of ${usedSegs} occupied`,
    `overlap (hull)     : ${f(overlapMetric(model.xy, sol.assign, G), 3)}`,
    `mean snap offset   : ${f(offsetSum / n)} m`,
    `wrong-street rate  : ${f((100 * wrong) / n)} % (${wrong} of ${n}; ${unnamed} of those on unnamed footway/service edges)`,
  ];
  const out = lines.join('\n') + '\n';
  process.stdout.write('\n' + out);
  if (process.env.EVAL_OUT) writeFileSync(resolve(process.env.EVAL_OUT), out);
}, 600_000);
