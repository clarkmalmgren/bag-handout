# Bag Handout Route Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static single-page web tool that splits a drawn neighborhood boundary into N balanced groups of houses, each with a short closed-loop walking route, lets the organizer reassign streets by hand with live counts, and exports printable per-group packets.

**Architecture:** OpenStreetMap houses and roads (Overpass) feed a walkable street graph. Houses are snapped to street edges, a house-to-house walking-distance matrix is precomputed, and a solver seeds balanced clusters (k-means), routes each group as a closed-loop TSP (nearest neighbor + 2-opt + Or-opt), then improves the split with simulated annealing over house/cluster moves under a hard house-balance constraint. The solver runs in a Web Worker; the Leaflet UI shows groups, lets the user reassign street segments, and exports print pages, CSV and a project file.

**Tech Stack:** TypeScript, Vite, Vitest, Leaflet + Leaflet.draw, Esri World Imagery tiles, Overpass API, idb-keyval (IndexedDB cache), Playwright (one e2e smoke test).

**Spec:** `docs/superpowers/specs/2026-09-19-bag-handout-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- Static single-page web app: no backend, no install for the end user. Vite + TypeScript; `npm run build` emits static `dist/`.
- Map: Leaflet + Leaflet.draw; satellite basemap is Esri World Imagery with an OSM street toggle.
- House and road data from OpenStreetMap via Overpass; results cached in IndexedDB (keyed by polygon hash) and exportable in the project file.
- Solver runs in a Web Worker so the UI stays responsive. Target scale is roughly 400–600 houses.
- Hard balance constraint: every group's house count is within ±2 of the mean (`|size − H/N| ≤ 2`).
- Objective among feasible states: `score = max(routeLen) + 0.3 × Σ routeLen` (weights configurable).
- Time estimate: distance ÷ 1.2 m/s + 20 s per house (configurable).
- Crossing penalty for visiting the opposite side of a street: 8 m equivalent (configurable).
- Group start/end of each loop is chosen by the tool; each group's route is a closed loop.
- Manual editing unit is the street segment (intersection to intersection); click to reassign, live counts, undo/redo, lockable segments.
- Output: interactive map plus printable per-group pages (overview page + one page per group), CSV, and a project JSON file.
- Defaults: 6 groups, 8000 annealing iterations, seed 1.

## Deviations from spec

Small implementation decisions that differ from, or refine, the spec text:

1. **Loop start:** a closed loop's length does not depend on where it starts, so the start is defined as the house immediately after the tour's longest leg (that leg becomes the closing/return leg). Deterministic and simple.
2. **Post-edit re-routing** (after a manual segment reassignment) runs on the main thread, not in the worker. Re-solving one or two tours of ≤ ~80 houses is millisecond-scale. Only full annealing runs in the worker.
3. **Crossing penalty** applies only to consecutive stops on the same edge but opposite sides of the street. Across different edges the walking path already covers the crossing.
4. **Project file** stores parsed `OsmData` (`{ nodes: [id, lat, lon][], ways }`) rather than the raw Overpass JSON. Smaller, and sufficient to rebuild the graph offline.
5. **Route display** draws straight-line loop sketches between consecutive stops, not exact street-following paths.
6. **Extra files** beyond the spec's layout: `src/types.ts`, `src/geo.ts`, `src/rng.ts`, `src/model.ts`, `src/solver/contiguity.ts`, `src/stats.ts`, `src/solver/solve.ts`, `tests/fixtures/synthetic.ts`.

## File map

```
index.html                       toolbar (#fetch #groups #solve #reopt #undo #redo #save #load-input #export-print #export-csv #status), #map, #panel
package.json, vite.config.ts, tsconfig.json, playwright.config.ts, .gitignore
src/types.ts                     shared types (LatLon, XY, House, Way, OsmData, Weights, Config, Tour, Dist)
src/geo.ts                       haversine, local projection, point-to-segment, point-in-ring, ring centroid
src/rng.ts                       seeded RNG (mulberry32)
src/state.ts                     ProjectState, defaults, Store (subscribe/update/undo/redo/replace)
src/project.ts                   project JSON serialize/parse, boundary ring helper
src/main.ts                      app bootstrap and glue between store, model, solver, UI
src/model.ts                     buildModel(): houses + OsmData -> graph, snaps, distance matrix, segment/xy arrays
src/stats.ts                     per-group stats (houses, length, minutes, delta)
src/data/overpass.ts             Overpass query builder, fetch with mirrors, IndexedDB cache
src/data/parse.ts                Overpass JSON -> OsmData + address nodes + buildings
src/data/houses.ts               dedupe address nodes vs building footprints -> House[]
src/graph/build.ts               ways -> graph (nodes, edges, adjacency) + street segments
src/graph/snap.ts                snap each house to nearest edge (position along, side, segment)
src/graph/shortest.ts            Dijkstra oracle, house-to-house distance, distance matrix, components
src/solver/cost.ts               score, size-violation, default weights
src/solver/tsp.ts                closed-loop TSP: NN + 2-opt + Or-opt, warm start, rotate to start
src/solver/contiguity.ts         connected-component counting over walking distance
src/solver/seed.ts               size-capped k-means seed + rebalance to ±tolerance
src/solver/anneal.ts             simulated annealing over house/run/swap moves
src/solver/solve.ts              solve() and routeGroups() orchestration (pure, worker-agnostic)
src/solver/worker.ts             Web Worker entry: receives SolveProblem, posts progress + solution
src/ui/leafletDrawFix.ts         leaflet-draw `type` global workaround (imported first)
src/ui/map.ts                    Leaflet map, basemaps, boundary drawing
src/ui/overlays.ts               houses, street segments, tour lines on the map
src/ui/panel.ts                  per-group stats panel
src/ui/solveClient.ts            Promise wrapper around the worker
src/export/csv.ts                per-group address CSV
src/export/print.ts              print view (overview + per-group pages)
tests/*.test.ts                  Vitest unit tests
tests/fixtures/synthetic.ts      synthetic grid neighborhood generator
e2e/smoke.spec.ts                Playwright smoke test
```

---

### Task 1: Scaffold, shared types, geometry helpers

**Files:**
- Create: `.gitignore`, `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/types.ts`, `src/geo.ts`, `src/rng.ts`
- Test: `tests/geo.test.ts`, `tests/rng.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all later tasks rely on these exact names):
  - `src/types.ts`: `LatLon {lat, lon}`, `XY {x, y}`, `House {id, lat, lon, label, street, flagged, manual}`, `Way {id, name, highway, nodes: number[]}`, `OsmData {nodes: [number, number, number][]; ways: Way[]}`, `Weights {maxRoute, total, tolerance}`, `Config {groups, crossingPenalty, weights, iterations, seed, walkSpeed, secPerHouse}`, `Tour {order: number[]; length: number}`, `type Dist = (i: number, j: number) => number`.
  - `src/geo.ts`: `haversine(a: LatLon, b: LatLon): number`, `makeProjector(ref: LatLon): (p: LatLon) => XY`, `projectToSegment(p: XY, a: XY, b: XY): {t: number; dist: number; side: 1 | -1}`, `pointInRing(p: LatLon, ring: LatLon[]): boolean`, `ringCentroid(ring: LatLon[]): LatLon`.
  - `src/rng.ts`: `mulberry32(seed: number): () => number`.

- [ ] **Step 1: Initialize repo and dependencies**

Run from `/home/clark/dum/bag-handout`:

```bash
git init
npm init -y
npm install leaflet leaflet-draw idb-keyval
npm install -D typescript vite vitest @types/leaflet @types/leaflet-draw @types/geojson @playwright/test
```

Expected: `git init` reports an initialized repository; npm finishes with no errors. The screenshot `Screenshot From 2026-09-19 15-08-02.png` stays untracked; never use `git add -A` in this project.

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
test-results/
playwright-report/
*.png
!docs/**/*.png
```

- [ ] **Step 3: Set package scripts**

```bash
npm pkg set type=module name=bag-handout private=true version=0.1.0
npm pkg set scripts.dev="vite"
npm pkg set scripts.build="tsc --noEmit && vite build"
npm pkg set scripts.preview="vite preview"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.e2e="playwright test"
```

Verify: `npm pkg get scripts` prints an object with `dev`, `build`, `preview`, `test`, `e2e`.

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 6: Write `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bag Handout Planner</title>
    <style>
      html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
      #app { display: grid; grid-template-rows: auto 1fr; grid-template-columns: 1fr 320px; height: 100%; }
      #toolbar { grid-column: 1 / 3; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; background: #f3f4f6; border-bottom: 1px solid #d1d5db; }
      #toolbar label { font-size: 13px; }
      #toolbar input[type=number] { width: 4em; }
      #status { margin-left: auto; font-size: 13px; color: #374151; }
      #map { min-height: 0; }
      #panel { overflow: auto; padding: 8px; border-left: 1px solid #d1d5db; font-size: 13px; }
      .group-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid #e5e7eb; }
      .swatch { width: 14px; height: 14px; border-radius: 3px; flex: none; }
      #print-root { display: none; }
    </style>
  </head>
  <body>
    <div id="app">
      <div id="toolbar">
        <button id="fetch" title="Fetch houses and roads for the drawn boundary">Fetch houses</button>
        <label>Groups <input id="groups" type="number" min="2" max="20" value="6" /></label>
        <button id="solve">Solve</button>
        <button id="reopt" title="Re-optimize from current assignment, keeping locked streets">Re-optimize</button>
        <button id="undo">Undo</button>
        <button id="redo">Redo</button>
        <button id="save">Save project</button>
        <label>Load project <input id="load-input" type="file" accept="application/json,.json" /></label>
        <button id="export-print">Print view</button>
        <button id="export-csv">Export CSV</button>
        <span id="status">Draw a boundary to begin.</span>
      </div>
      <div id="map"></div>
      <div id="panel"></div>
    </div>
    <div id="print-root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Write the failing geometry tests**

`tests/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { haversine, makeProjector, pointInRing, projectToSegment, ringCentroid } from '../src/geo';

describe('haversine', () => {
  it('one degree of latitude is about 111195 m', () => {
    const d = haversine({ lat: 42, lon: -88 }, { lat: 43, lon: -88 });
    expect(Math.abs(d - 111195) / 111195).toBeLessThan(0.005);
  });
  it('is zero for identical points', () => {
    expect(haversine({ lat: 1, lon: 2 }, { lat: 1, lon: 2 })).toBe(0);
  });
});

describe('makeProjector', () => {
  it('projects north as +y and east as +x in meters', () => {
    const proj = makeProjector({ lat: 42, lon: -88 });
    const n = proj({ lat: 42.001, lon: -88 });
    const e = proj({ lat: 42, lon: -87.999 });
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeGreaterThan(105);
    expect(n.y).toBeLessThan(117);
    expect(e.y).toBeCloseTo(0, 6);
    expect(e.x).toBeGreaterThan(75);
    expect(e.x).toBeLessThan(90);
  });
});

describe('projectToSegment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  it('projects onto the middle with t=0.5 and reports distance', () => {
    const r = projectToSegment({ x: 5, y: 3 }, a, b);
    expect(r.t).toBeCloseTo(0.5);
    expect(r.dist).toBeCloseTo(3);
  });
  it('reports side +1 for left of a->b and -1 for right', () => {
    expect(projectToSegment({ x: 5, y: 3 }, a, b).side).toBe(1);
    expect(projectToSegment({ x: 5, y: -3 }, a, b).side).toBe(-1);
  });
  it('clamps to the endpoints', () => {
    expect(projectToSegment({ x: -4, y: 0 }, a, b).t).toBe(0);
    expect(projectToSegment({ x: 14, y: 0 }, a, b).t).toBe(1);
  });
  it('handles a zero-length segment', () => {
    const r = projectToSegment({ x: 3, y: 4 }, a, a);
    expect(r.t).toBe(0);
    expect(r.dist).toBeCloseTo(5);
  });
});

describe('pointInRing / ringCentroid', () => {
  const ring = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 4 },
    { lat: 4, lon: 4 },
    { lat: 4, lon: 0 },
  ];
  it('detects inside and outside points', () => {
    expect(pointInRing({ lat: 2, lon: 2 }, ring)).toBe(true);
    expect(pointInRing({ lat: 5, lon: 2 }, ring)).toBe(false);
    expect(pointInRing({ lat: 2, lon: -1 }, ring)).toBe(false);
  });
  it('centroid of a square is its center, ignoring a closing duplicate', () => {
    const closed = [...ring, ring[0]];
    expect(ringCentroid(ring)).toEqual({ lat: 2, lon: 2 });
    expect(ringCentroid(closed)).toEqual({ lat: 2, lon: 2 });
  });
});
```

`tests/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });
  it('differs across seeds and stays in [0,1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — cannot resolve `../src/geo` and `../src/rng`.

- [ ] **Step 9: Write `src/types.ts`**

```ts
export interface LatLon {
  lat: number;
  lon: number;
}

export interface XY {
  x: number;
  y: number;
}

export interface House {
  id: string;
  lat: number;
  lon: number;
  /** e.g. "123 Preston Cir" or "(no address)" */
  label: string;
  street: string;
  /** true when the house has no address and needs human review */
  flagged: boolean;
  /** true when added by hand in the UI */
  manual: boolean;
}

export interface Way {
  id: number;
  name: string;
  highway: string;
  nodes: number[];
}

export interface OsmData {
  /** [osmNodeId, lat, lon] */
  nodes: [number, number, number][];
  ways: Way[];
}

export interface Weights {
  /** weight on the longest route */
  maxRoute: number;
  /** weight on the sum of route lengths */
  total: number;
  /** hard house-count tolerance around the mean */
  tolerance: number;
}

export interface Config {
  groups: number;
  /** meters added when consecutive stops are on opposite sides of the same street edge */
  crossingPenalty: number;
  weights: Weights;
  iterations: number;
  seed: number;
  /** meters per second */
  walkSpeed: number;
  /** seconds spent at each house */
  secPerHouse: number;
}

export interface Tour {
  /** house indices in visiting order (closed loop) */
  order: number[];
  /** closed-loop length in meters */
  length: number;
}

/** Walking distance in meters between house indices i and j. */
export type Dist = (i: number, j: number) => number;
```

- [ ] **Step 10: Write `src/geo.ts`**

```ts
import type { LatLon, XY } from './types';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local equirectangular projection to meters around `ref` (x = east, y = north). */
export function makeProjector(ref: LatLon): (p: LatLon) => XY {
  const kx = R * Math.cos(rad(ref.lat)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  return (p) => ({ x: (p.lon - ref.lon) * kx, y: (p.lat - ref.lat) * ky });
}

/**
 * Project point p onto segment a-b.
 * t in [0,1] along a->b, dist = perpendicular distance, side = +1 if p is left of a->b, else -1.
 */
export function projectToSegment(
  p: XY,
  a: XY,
  b: XY,
): { t: number; dist: number; side: 1 | -1 } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  const dist = Math.hypot(p.x - px, p.y - py);
  const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
  // cross > 0 means p is left of a->b in a y-up frame
  const side: 1 | -1 = cross >= 0 ? 1 : -1;
  return { t, dist, side };
}

/** Ray casting; x = lon, y = lat. */
export function pointInRing(p: LatLon, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const crosses = yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Average of the ring's vertices, ignoring a closing duplicate of the first vertex. */
export function ringCentroid(ring: LatLon[]): LatLon {
  let pts = ring;
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (f.lat === l.lat && f.lon === l.lon) pts = pts.slice(0, -1);
  }
  let lat = 0;
  let lon = 0;
  for (const p of pts) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}
```

- [ ] **Step 11: Write `src/rng.ts`**

```ts
/** Small deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 12: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — 2 test files, all tests green (geo: 9 tests, rng: 2 tests).

- [ ] **Step 13: Type check**

Run: `npx tsc --noEmit`
Expected: no output (exit 0). `src/main.ts` doesn't exist yet; `index.html` references it but tsc doesn't read HTML.

- [ ] **Step 14: Commit**

```bash
git add .gitignore package.json package-lock.json vite.config.ts tsconfig.json index.html src/types.ts src/geo.ts src/rng.ts tests/geo.test.ts tests/rng.test.ts docs/superpowers
git commit -m "chore: scaffold Vite+TS project with shared types and geometry helpers"
```

---

### Task 2: Project state, save/load, map with boundary drawing

**Files:**
- Create: `src/state.ts`, `src/project.ts`, `src/ui/leafletDrawFix.ts`, `src/ui/map.ts`, `src/main.ts`
- Test: `tests/project.test.ts`, `tests/store.test.ts`

**Interfaces:**
- Consumes: `Config`, `House`, `OsmData`, `Weights` from `src/types.ts`.
- Produces:
  - `src/state.ts`: `interface ProjectState { boundary: Polygon | null; osm: OsmData | null; houses: House[]; removed: string[]; assignment: Record<string, number>; locked: string[]; config: Config }` (`Polygon` from `geojson`); `defaultConfig(): Config`; `emptyState(): ProjectState`; `class Store` with `state: ProjectState`, `subscribe(fn: () => void): () => void`, `update(mut: (s: ProjectState) => void, opts?: { undoable?: boolean }): void`, `undo(): boolean`, `redo(): boolean`, `replace(state: ProjectState): void`. Undo covers `houses`, `removed`, `assignment`, `locked` only.
  - `src/project.ts`: `PROJECT_VERSION = 1`, `serializeProject(s: ProjectState): string`, `parseProject(text: string): ProjectState` (throws on unsupported version), `ringOf(boundary: Polygon | null): LatLon[] | null` (outer ring as `LatLon[]`, `null` when no boundary).
  - `src/ui/map.ts`: `createMap(el: HTMLElement, onBoundary: (p: Polygon) => void): { map: L.Map; drawn: L.FeatureGroup }`, `showBoundary(map: L.Map, drawn: L.FeatureGroup, geom: Polygon | null): void`.

- [ ] **Step 1: Write the failing store tests**

`tests/store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { Store, defaultConfig, emptyState } from '../src/state';

describe('defaultConfig / emptyState', () => {
  it('has the agreed defaults', () => {
    const c = defaultConfig();
    expect(c.groups).toBe(6);
    expect(c.crossingPenalty).toBe(8);
    expect(c.weights).toEqual({ maxRoute: 1, total: 0.3, tolerance: 2 });
    expect(c.iterations).toBe(8000);
    expect(c.seed).toBe(1);
    expect(c.walkSpeed).toBe(1.2);
    expect(c.secPerHouse).toBe(20);
  });
  it('starts empty', () => {
    const s = emptyState();
    expect(s.boundary).toBeNull();
    expect(s.osm).toBeNull();
    expect(s.houses).toEqual([]);
    expect(s.removed).toEqual([]);
    expect(s.assignment).toEqual({});
    expect(s.locked).toEqual([]);
  });
});

describe('Store', () => {
  it('update mutates state and notifies subscribers', () => {
    const store = new Store(emptyState());
    const fn = vi.fn();
    store.subscribe(fn);
    store.update((s) => {
      s.assignment.a = 1;
    });
    expect(store.state.assignment).toEqual({ a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', () => {
    const store = new Store(emptyState());
    const fn = vi.fn();
    const off = store.subscribe(fn);
    off();
    store.update((s) => {
      s.locked.push('x');
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('undo and redo restore assignment/locked/removed/houses', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    store.update((s) => {
      s.assignment.a = 2;
      s.locked.push('seg1');
      s.removed.push('h1');
    });
    expect(store.undo()).toBe(true);
    expect(store.state.assignment).toEqual({ a: 1 });
    expect(store.state.locked).toEqual([]);
    expect(store.state.removed).toEqual([]);
    expect(store.redo()).toBe(true);
    expect(store.state.assignment).toEqual({ a: 2 });
    expect(store.state.locked).toEqual(['seg1']);
    expect(store.state.removed).toEqual(['h1']);
  });

  it('undo returns false when nothing to undo; redo likewise', () => {
    const store = new Store(emptyState());
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('a new undoable update clears the redo stack', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    store.undo();
    store.update((s) => {
      s.assignment.b = 2;
    });
    expect(store.redo()).toBe(false);
  });

  it('non-undoable updates are not recorded', () => {
    const store = new Store(emptyState());
    store.update(
      (s) => {
        s.config.groups = 9;
      },
      { undoable: false },
    );
    expect(store.undo()).toBe(false);
    expect(store.state.config.groups).toBe(9);
  });

  it('undo does not touch config or boundary', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    store.update(
      (s) => {
        s.config.groups = 9;
      },
      { undoable: false },
    );
    store.undo();
    expect(store.state.config.groups).toBe(9);
  });

  it('replace swaps the state and clears history', () => {
    const store = new Store(emptyState());
    store.update((s) => {
      s.assignment.a = 1;
    });
    const next = emptyState();
    next.config.groups = 4;
    store.replace(next);
    expect(store.state.config.groups).toBe(4);
    expect(store.undo()).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing project tests**

`tests/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PROJECT_VERSION, parseProject, ringOf, serializeProject } from '../src/project';
import { emptyState } from '../src/state';
import type { Polygon } from 'geojson';

describe('project serialize/parse', () => {
  it('round-trips a populated state', () => {
    const s = emptyState();
    s.boundary = {
      type: 'Polygon',
      coordinates: [
        [
          [-88.3, 41.88],
          [-88.29, 41.88],
          [-88.29, 41.89],
          [-88.3, 41.88],
        ],
      ],
    };
    s.osm = { nodes: [[1, 41.88, -88.3]], ways: [{ id: 5, name: 'Main St', highway: 'residential', nodes: [1] }] };
    s.houses = [
      { id: 'w1', lat: 41.881, lon: -88.299, label: '1 Main St', street: 'Main St', flagged: false, manual: false },
    ];
    s.removed = ['w9'];
    s.assignment = { w1: 2 };
    s.locked = ['Main St:1'];
    s.config.groups = 8;
    const parsed = parseProject(serializeProject(s));
    expect(parsed).toEqual(s);
  });

  it('writes the current version', () => {
    expect(JSON.parse(serializeProject(emptyState())).version).toBe(PROJECT_VERSION);
  });

  it('rejects an unsupported version', () => {
    const bad = JSON.stringify({ version: 999 });
    expect(() => parseProject(bad)).toThrow(/Unsupported project version 999/);
  });

  it('fills defaults for missing optional fields', () => {
    const parsed = parseProject(JSON.stringify({ version: PROJECT_VERSION, config: { groups: 3 } }));
    expect(parsed.boundary).toBeNull();
    expect(parsed.houses).toEqual([]);
    expect(parsed.config.groups).toBe(3);
    expect(parsed.config.crossingPenalty).toBe(8);
  });
});

describe('ringOf', () => {
  it('returns null without a boundary', () => {
    expect(ringOf(null)).toBeNull();
  });
  it('converts the outer ring from [lon,lat] to LatLon', () => {
    const p: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-88.3, 41.88],
          [-88.29, 41.88],
          [-88.29, 41.89],
          [-88.3, 41.88],
        ],
      ],
    };
    expect(ringOf(p)).toEqual([
      { lat: 41.88, lon: -88.3 },
      { lat: 41.88, lon: -88.29 },
      { lat: 41.89, lon: -88.29 },
      { lat: 41.88, lon: -88.3 },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/store.test.ts tests/project.test.ts`
Expected: FAIL — cannot resolve `../src/state` and `../src/project`.

- [ ] **Step 4: Write `src/state.ts`**

```ts
import type { Polygon } from 'geojson';
import type { Config, House, OsmData } from './types';

export interface ProjectState {
  boundary: Polygon | null;
  osm: OsmData | null;
  /** auto-fetched houses plus manually added ones (manual: true) */
  houses: House[];
  /** ids of houses hidden/removed by the user */
  removed: string[];
  /** house id -> group index (0-based) */
  assignment: Record<string, number>;
  /** locked segment keys (see Segment.key in graph/build.ts) */
  locked: string[];
  config: Config;
}

export function defaultConfig(): Config {
  return {
    groups: 6,
    crossingPenalty: 8,
    weights: { maxRoute: 1, total: 0.3, tolerance: 2 },
    iterations: 8000,
    seed: 1,
    walkSpeed: 1.2,
    secPerHouse: 20,
  };
}

export function emptyState(): ProjectState {
  return {
    boundary: null,
    osm: null,
    houses: [],
    removed: [],
    assignment: {},
    locked: [],
    config: defaultConfig(),
  };
}

/** The slice of state covered by undo/redo. */
type Undoable = Pick<ProjectState, 'houses' | 'removed' | 'assignment' | 'locked'>;

const MAX_HISTORY = 100;

export class Store {
  state: ProjectState;
  private listeners = new Set<() => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(initial: ProjectState) {
    this.state = initial;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private snapshot(): string {
    const { houses, removed, assignment, locked } = this.state;
    const u: Undoable = { houses, removed, assignment, locked };
    return JSON.stringify(u);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  update(mut: (s: ProjectState) => void, opts: { undoable?: boolean } = { undoable: true }): void {
    const undoable = opts.undoable ?? true;
    if (undoable) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    mut(this.state);
    this.emit();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.snapshot());
    Object.assign(this.state, JSON.parse(prev) as Undoable);
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.snapshot());
    Object.assign(this.state, JSON.parse(next) as Undoable);
    this.emit();
    return true;
  }

  replace(state: ProjectState): void {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }
}
```

- [ ] **Step 5: Write `src/project.ts`**

```ts
import type { Polygon } from 'geojson';
import { defaultConfig, type ProjectState } from './state';
import type { LatLon } from './types';

export const PROJECT_VERSION = 1;

export function serializeProject(s: ProjectState): string {
  return JSON.stringify({ version: PROJECT_VERSION, ...s });
}

export function parseProject(text: string): ProjectState {
  const o = JSON.parse(text);
  if (o.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version ${o.version}`);
  }
  const base = defaultConfig();
  return {
    boundary: o.boundary ?? null,
    osm: o.osm ?? null,
    houses: o.houses ?? [],
    removed: o.removed ?? [],
    assignment: o.assignment ?? {},
    locked: o.locked ?? [],
    config: {
      ...base,
      ...(o.config ?? {}),
      weights: { ...base.weights, ...(o.config?.weights ?? {}) },
    },
  };
}

/** Outer ring of a GeoJSON polygon as LatLon[] (GeoJSON is [lon, lat]). */
export function ringOf(boundary: Polygon | null): LatLon[] | null {
  if (!boundary) return null;
  const ring = boundary.coordinates[0];
  if (!ring) return null;
  return ring.map(([lon, lat]) => ({ lat, lon }));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS — 4 test files (`geo`, `rng`, `store`, `project`), all green.

- [ ] **Step 7: Write `src/ui/leafletDrawFix.ts`**

```ts
// leaflet-draw 1.0.4 references an undeclared global `type` in its readableArea helper,
// which throws in ES-module (strict) builds. Declaring it up front avoids the ReferenceError.
// This module must be imported BEFORE 'leaflet-draw'.
(window as unknown as { type: string }).type = '';
export {};
```

- [ ] **Step 8: Write `src/ui/map.ts`**

```ts
import './leafletDrawFix';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { Polygon } from 'geojson';

// Geneva, IL (Mill Creek) as the initial view.
const START_VIEW: L.LatLngTuple = [41.8875, -88.3054];

export function createMap(
  el: HTMLElement,
  onBoundary: (p: Polygon) => void,
): { map: L.Map; drawn: L.FeatureGroup } {
  const map = L.map(el, { preferCanvas: true }).setView(START_VIEW, 15);

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' },
  );
  const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  });
  satellite.addTo(map);
  L.control.layers({ Satellite: satellite, Streets: streets }).addTo(map);

  const drawn = new L.FeatureGroup().addTo(map);
  map.addControl(
    new L.Control.Draw({
      draw: {
        polygon: {},
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawn },
    }),
  );

  map.on(L.Draw.Event.CREATED, (e) => {
    const layer = (e as L.DrawEvents.Created).layer;
    drawn.clearLayers();
    drawn.addLayer(layer);
    onBoundary((layer as L.Polygon).toGeoJSON().geometry as Polygon);
  });
  map.on(L.Draw.Event.EDITED, () => {
    drawn.eachLayer((layer) => {
      onBoundary((layer as L.Polygon).toGeoJSON().geometry as Polygon);
    });
  });
  map.on(L.Draw.Event.DELETED, () => {
    // Boundary removal is handled by main.ts via drawn.getLayers().length === 0.
    if (drawn.getLayers().length === 0) {
      map.fire('bagboundarycleared');
    }
  });

  return { map, drawn };
}

export function showBoundary(map: L.Map, drawn: L.FeatureGroup, geom: Polygon | null): void {
  drawn.clearLayers();
  if (!geom) return;
  L.geoJSON(geom as GeoJSON.Polygon).eachLayer((layer) => drawn.addLayer(layer));
  const bounds = drawn.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds);
}
```

- [ ] **Step 9: Write minimal `src/main.ts`**

This version wires only the map, the boundary, and save/load. Later tasks extend it (fetch, model, solve, overlays, panel, export).

```ts
import { createMap, showBoundary } from './ui/map';
import { parseProject, serializeProject } from './project';
import { Store, emptyState } from './state';

const store = new Store(emptyState());

const mapEl = document.getElementById('map') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const groupsInput = document.getElementById('groups') as HTMLInputElement;

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

const { map, drawn } = createMap(mapEl, (poly) => {
  store.update(
    (s) => {
      s.boundary = poly;
    },
    { undoable: false },
  );
  setStatus('Boundary set. Fetch houses next.');
});

map.on('bagboundarycleared', () => {
  store.update(
    (s) => {
      s.boundary = null;
    },
    { undoable: false },
  );
  setStatus('Boundary cleared.');
});

groupsInput.addEventListener('change', () => {
  const n = Math.max(2, Math.min(20, Number(groupsInput.value) || 6));
  groupsInput.value = String(n);
  store.update(
    (s) => {
      s.config.groups = n;
    },
    { undoable: false },
  );
});

document.getElementById('save')!.addEventListener('click', () => {
  const blob = new Blob([serializeProject(store.state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bag-handout-project.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Project saved.');
});

document.getElementById('load-input')!.addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    store.replace(parseProject(await file.text()));
    groupsInput.value = String(store.state.config.groups);
    showBoundary(map, drawn, store.state.boundary);
    setStatus(`Loaded: ${store.state.houses.length} houses`);
  } catch (err) {
    setStatus(`Could not load project: ${(err as Error).message}`);
  } finally {
    input.value = '';
  }
});

document.getElementById('undo')!.addEventListener('click', () => store.undo());
document.getElementById('redo')!.addEventListener('click', () => store.redo());
```

- [ ] **Step 10: Type check and build**

Run: `npx tsc --noEmit && npx vite build`
Expected: tsc prints nothing; vite reports a successful build with an output `dist/` (a chunk-size warning for Leaflet is fine).

- [ ] **Step 11: Manual verification in the browser**

Run: `npm run dev` and open the printed URL (default `http://localhost:5173`).
Expected:
1. Satellite map centered near Geneva, IL, with a layer switcher (Satellite / Streets) and the polygon draw tool in the left toolbar.
2. Draw a polygon; the status text reads "Boundary set. Fetch houses next."
3. Click "Save project": a `bag-handout-project.json` downloads and contains `"version": 1` and your polygon under `"boundary"`.
4. Reload the page, use "Load project" to choose that file: the polygon reappears, the map zooms to it, and the status reads "Loaded: 0 houses".
5. Browser console shows no errors (in particular no `type is not defined` from leaflet-draw).

Stop the dev server (Ctrl+C).

- [ ] **Step 12: Commit**

```bash
git add src/state.ts src/project.ts src/ui/leafletDrawFix.ts src/ui/map.ts src/main.ts tests/store.test.ts tests/project.test.ts
git commit -m "feat: project state, save/load, and Leaflet map with boundary drawing"
```
### Task 3: Data layer (Overpass fetch, parse, houses) and house editing

**Files:**
- Create: `src/data/parse.ts`, `src/data/houses.ts`, `src/data/overpass.ts`, `src/ui/houseEdit.ts`
- Create: `tests/parse.test.ts`, `tests/houses.test.ts`, `tests/overpass.test.ts`
- Modify: `index.html` (two toolbar buttons), `src/main.ts` (fetch + add-house wiring)

**Interfaces:**
- Consumes (Part A): `types.ts` (`LatLon`, `House`, `Way`, `OsmData`), `geo.ts` (`pointInRing(p: LatLon, ring: LatLon[]): boolean`, `ringCentroid(ring: LatLon[]): LatLon`), `state.ts` (`Store` with `state`, `update(mut, {undoable?})`), `project.ts` (`ringOf(boundary: GeoJSON.Polygon): LatLon[]`), and in `src/main.ts` the module-level `store: Store`, `map: L.Map`, `status(text: string): void`, and a `render()` function called from `store.subscribe`.
- Produces:
  - `parseOverpass(json: { elements: OverpassElement[] }): ParsedOverpass` where `ParsedOverpass = { osm: OsmData; addrNodes: AddrNode[]; buildings: Building[] }`, `AddrNode = { id: number; pos: LatLon; number: string; street: string }`, `Building = { id: number; ring: LatLon[]; tags: Record<string, string> }`.
  - `buildHouses(p: ParsedOverpass, boundary: LatLon[] | null): House[]`.
  - `buildQuery(polygon: Polygon): string`, `polyString(polygon: Polygon): string`, `hashPolygon(polygon: Polygon): string`, `fetchOverpass(polygon: Polygon, opts?: FetchOptions): Promise<FetchResult>` where `FetchResult = { osm: OsmData; houses: House[] }`.
  - `HouseEditor` class (`toggle(): boolean`, `setAdding(on: boolean): void`, `remove(id: string): void`) and `renderHouseDots(layer: L.LayerGroup, houses: House[], onRemove: (id: string) => void): void`.

- [ ] **Step 1: Write the failing parse test**

Create `tests/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseOverpass } from '../src/data/parse';

const elements = [
  { type: 'node', id: 1, lat: 42.0, lon: -88.3 },
  { type: 'node', id: 2, lat: 42.0, lon: -88.299 },
  { type: 'node', id: 3, lat: 42.0, lon: -88.298 },
  { type: 'node', id: 4, lat: 42.001, lon: -88.3 },
  { type: 'node', id: 5, lat: 42.001, lon: -88.2999 },
  { type: 'node', id: 6, lat: 42.0011, lon: -88.2999 },
  { type: 'node', id: 7, lat: 42.0011, lon: -88.3 },
  { type: 'node', id: 30, lat: 42.002, lon: -88.3, tags: { 'addr:housenumber': '9', 'addr:street': 'Elm St' } },
  { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential', name: 'Oak St' } },
  { type: 'way', id: 11, nodes: [1, 3], tags: { highway: 'motorway', name: 'I-88' } },
  { type: 'way', id: 12, nodes: [1, 2], tags: { highway: 'service', service: 'driveway' } },
  { type: 'way', id: 13, nodes: [2, 3, 99], tags: { highway: 'footway' } },
  { type: 'way', id: 20, nodes: [4, 5, 6, 7, 4], tags: { building: 'house', 'addr:housenumber': '12', 'addr:street': 'Oak St' } },
  // duplicate skeleton node emitted by "out skel" (no tags) must not drop the tagged one
  { type: 'node', id: 30, lat: 42.002, lon: -88.3 },
];

describe('parseOverpass', () => {
  const p = parseOverpass({ elements: elements as never });

  it('keeps walkable ways and skips motorways and driveways', () => {
    expect(p.osm.ways.map((w) => w.id).sort()).toEqual([10, 13]);
  });

  it('filters way nodes to nodes we know about', () => {
    const w13 = p.osm.ways.find((w) => w.id === 13)!;
    expect(w13.nodes).toEqual([2, 3]);
  });

  it('only emits nodes used by kept ways', () => {
    expect(p.osm.nodes.map((n) => n[0]).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('collects buildings with rings', () => {
    expect(p.buildings).toHaveLength(1);
    expect(p.buildings[0].ring).toHaveLength(5);
    expect(p.buildings[0].tags.building).toBe('house');
  });

  it('collects address nodes', () => {
    expect(p.addrNodes).toEqual([{ id: 30, pos: { lat: 42.002, lon: -88.3 }, number: '9', street: 'Elm St' }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL — "Failed to resolve import ../src/data/parse".

- [ ] **Step 3: Implement `src/data/parse.ts`**

```ts
import type { LatLon, OsmData, Way } from '../types';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}
export interface AddrNode { id: number; pos: LatLon; number: string; street: string }
export interface Building { id: number; ring: LatLon[]; tags: Record<string, string> }
export interface ParsedOverpass { osm: OsmData; addrNodes: AddrNode[]; buildings: Building[] }

const SKIP_HIGHWAY = new Set(['motorway', 'motorway_link', 'construction', 'proposed', 'abandoned', 'raceway']);
const SKIP_SERVICE = new Set(['driveway', 'parking_aisle']);

export function parseOverpass(json: { elements: OverpassElement[] }): ParsedOverpass {
  const pos = new Map<number, LatLon>();
  const addrNodes = new Map<number, AddrNode>();
  for (const el of json.elements) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue;
    const p = { lat: el.lat, lon: el.lon };
    pos.set(el.id, p);
    const num = el.tags?.['addr:housenumber'];
    if (num) addrNodes.set(el.id, { id: el.id, pos: p, number: num, street: el.tags?.['addr:street'] ?? '' });
  }

  const ways: Way[] = [];
  const buildings: Building[] = [];
  const seen = new Set<number>();
  for (const el of json.elements) {
    if (el.type !== 'way' || !el.nodes || seen.has(el.id)) continue;
    seen.add(el.id);
    const tags = el.tags ?? {};
    if (tags.highway) {
      if (SKIP_HIGHWAY.has(tags.highway) || SKIP_SERVICE.has(tags.service ?? '')) continue;
      const nodes = el.nodes.filter((n) => pos.has(n));
      if (nodes.length >= 2) ways.push({ id: el.id, name: tags.name ?? '', highway: tags.highway, nodes });
    } else if (tags.building || tags['addr:housenumber']) {
      const ring = el.nodes.map((n) => pos.get(n)).filter((p): p is LatLon => !!p);
      if (ring.length >= 3) buildings.push({ id: el.id, ring, tags });
    }
  }

  const used = new Set<number>();
  for (const w of ways) for (const n of w.nodes) used.add(n);
  const nodes: [number, number, number][] = [];
  for (const id of used) {
    const p = pos.get(id)!;
    nodes.push([id, p.lat, p.lon]);
  }
  return { osm: { nodes, ways }, addrNodes: [...addrNodes.values()], buildings };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing houses test**

Create `tests/houses.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/houses.test.ts`
Expected: FAIL — "Failed to resolve import ../src/data/houses".

- [ ] **Step 7: Implement `src/data/houses.ts`**

```ts
import { pointInRing, ringCentroid } from '../geo';
import type { House, LatLon } from '../types';
import type { ParsedOverpass } from './parse';

const NON_HOUSE = new Set([
  'garage', 'garages', 'shed', 'service', 'roof', 'carport', 'cabin', 'hut', 'greenhouse', 'barn',
  'industrial', 'commercial', 'retail', 'church', 'school', 'public', 'civic', 'government',
]);
const HOUSE = new Set(['house', 'residential', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'apartments', 'townhouse']);

export function buildHouses(p: ParsedOverpass, boundary: LatLon[] | null): House[] {
  const inside = (pt: LatLon) => !boundary || pointInRing(pt, boundary);
  const houses: House[] = [];
  const consumed = new Set<number>();

  for (const b of p.buildings) {
    const kind = b.tags.building;
    if (kind && NON_HOUSE.has(kind)) continue;
    const c = ringCentroid(b.ring);
    if (!inside(c)) continue;
    const an = p.addrNodes.find((a) => pointInRing(a.pos, b.ring));
    if (an) consumed.add(an.id);
    const num = b.tags['addr:housenumber'] ?? an?.number;
    const street = b.tags['addr:street'] ?? an?.street ?? '';
    const hasAddr = !!num;
    const isHouse = kind ? HOUSE.has(kind) || (kind === 'yes' && hasAddr) : hasAddr;
    if (!hasAddr && !isHouse) continue;
    houses.push({
      id: `w${b.id}`, lat: c.lat, lon: c.lon,
      label: hasAddr ? `${num} ${street}`.trim() : '(no address)',
      street, flagged: !hasAddr, manual: false,
    });
  }

  for (const a of p.addrNodes) {
    if (consumed.has(a.id) || !inside(a.pos)) continue;
    houses.push({
      id: `n${a.id}`, lat: a.pos.lat, lon: a.pos.lon,
      label: `${a.number} ${a.street}`.trim(), street: a.street, flagged: false, manual: false,
    });
  }
  return houses;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run tests/houses.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Write the failing overpass test**

Create `tests/overpass.test.ts`:

```ts
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
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx vitest run tests/overpass.test.ts`
Expected: FAIL — "Failed to resolve import ../src/data/overpass".

- [ ] **Step 11: Implement `src/data/overpass.ts`**

`ringOf` is imported from Part A's `project.ts`. The default cache uses a dynamic `idb-keyval` import so unit tests in Node never touch IndexedDB.

```ts
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
```

- [ ] **Step 12: Run it to verify it passes**

Run: `npx vitest run tests/overpass.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 13: Implement `src/ui/houseEdit.ts`**

```ts
import L from 'leaflet';
import type { Store } from '../state';
import type { House } from '../types';

export class HouseEditor {
  private adding = false;

  constructor(private map: L.Map, private store: Store) {
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.adding) this.add(e.latlng);
    });
  }

  setAdding(on: boolean): void {
    this.adding = on;
    this.map.getContainer().style.cursor = on ? 'crosshair' : '';
  }

  toggle(): boolean {
    this.setAdding(!this.adding);
    return this.adding;
  }

  private add(ll: L.LatLng): void {
    const label = window.prompt('Address for the new house (e.g. "12 Oak St")', '');
    if (label === null) return;
    const house: House = {
      id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      lat: ll.lat,
      lon: ll.lng,
      label: label.trim() || '(added)',
      street: '',
      flagged: false,
      manual: true,
    };
    this.store.update((s) => {
      s.houses.push(house);
    });
  }

  remove(id: string): void {
    this.store.update((s) => {
      if (!s.removed.includes(id)) s.removed.push(id);
    });
  }
}

// Plain dots for Task 3; the group-coloured Overlays class (Part C) supersedes this
// but keeps calling HouseEditor.remove for the popup's Remove button.
export function renderHouseDots(layer: L.LayerGroup, houses: House[], onRemove: (id: string) => void): void {
  layer.clearLayers();
  for (const h of houses) {
    const dot = L.circleMarker([h.lat, h.lon], {
      radius: 4,
      weight: 1,
      color: '#222',
      fillColor: h.flagged ? '#f59e0b' : '#38bdf8',
      fillOpacity: 0.9,
    });
    const box = document.createElement('div');
    box.append(document.createTextNode(h.label));
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', () => onRemove(h.id));
    box.append(btn);
    dot.bindPopup(box);
    dot.addTo(layer);
  }
}
```

- [ ] **Step 14: Wire the buttons in `index.html` and `src/main.ts`**

In `index.html`, add inside the toolbar element next to the existing controls:

```html
<button id="fetch">Fetch houses</button>
<button id="add-house">Add house</button>
```

In `src/main.ts` add the imports:

```ts
import L from 'leaflet';
import { fetchOverpass } from './data/overpass';
import { HouseEditor, renderHouseDots } from './ui/houseEdit';
```

Add after `store` and `map` exist:

```ts
const houseLayer = L.layerGroup().addTo(map);
const houseEditor = new HouseEditor(map, store);

function visibleHouses() {
  const removed = new Set(store.state.removed);
  return store.state.houses.filter((h) => !removed.has(h.id));
}

document.getElementById('add-house')!.addEventListener('click', (e) => {
  const on = houseEditor.toggle();
  (e.currentTarget as HTMLElement).classList.toggle('active', on);
});

document.getElementById('fetch')!.addEventListener('click', async () => {
  const boundary = store.state.boundary;
  if (!boundary) {
    status('Draw a boundary first');
    return;
  }
  status('Fetching from OpenStreetMap…');
  try {
    const r = await fetchOverpass(boundary);
    store.update((s) => {
      s.osm = r.osm;
      s.houses = [...r.houses, ...s.houses.filter((h) => h.manual)];
      s.removed = [];
      s.assignment = {};
    });
    const flagged = r.houses.filter((h) => h.flagged).length;
    status(`Loaded: ${visibleHouses().length} houses (${flagged} without an address, shown in orange)`);
  } catch (e) {
    status(`Fetch failed: ${(e as Error).message}`);
  }
});
```

Inside `render()` add (Part C's Overlays replaces this line later):

```ts
renderHouseDots(houseLayer, visibleHouses(), (id) => houseEditor.remove(id));
```

- [ ] **Step 15: Manual check**

Run: `npm run dev`, open the printed URL, draw a small polygon over a few streets in Mill Creek, click **Fetch houses**.
Expected: blue dots appear on houses, the status bar shows a count, orange dots mark unaddressed buildings. Click **Add house**, click the map, enter an address: a new dot appears. Click a dot then **Remove**: it disappears. Ctrl+Z (Part A undo binding) brings it back. Reloading the page and fetching the same polygon returns instantly (cache).

- [ ] **Step 16: Run the whole suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

```bash
git add src/data/parse.ts src/data/houses.ts src/data/overpass.ts src/ui/houseEdit.ts \
  tests/parse.test.ts tests/houses.test.ts tests/overpass.test.ts index.html src/main.ts
git commit -m "feat: fetch and parse OSM houses, manual add/remove"
```

---

### Task 4: Synthetic fixture and road graph with street segments

**Files:**
- Create: `tests/fixtures/synthetic.ts`, `src/graph/build.ts`
- Test: `tests/graph.test.ts`

**Interfaces:**
- Consumes: `haversine(a: LatLon, b: LatLon): number` from `src/geo.ts`; `OsmData`, `Way`, `House`, `LatLon` from `src/types.ts`.
- Produces:
  - `syntheticGrid(rows: number, cols: number, perEdge: number): { osm: OsmData; houses: House[] }` (used by tests in Tasks 5–9 and the Playwright test).
  - `GraphEdge = { id: number; a: number; b: number; length: number; street: string; segment: number }` (`id` equals the index in `Graph.edges`; `a`/`b` are node indices).
  - `Segment = { id: number; key: string; street: string; edgeIds: number[] }` (`id` equals the index in `Graph.segments`; `key` is `${street}:${minOsmNodeId}`, stable across rebuilds of the same data, used for locks).
  - `Graph = { coords: LatLon[]; osmIds: number[]; index: Map<number, number>; edges: GraphEdge[]; adj: { to: number; w: number }[][]; segments: Segment[] }`.
  - `buildGraph(osm: OsmData): Graph`.

- [ ] **Step 1: Create the fixture generator**

Create `tests/fixtures/synthetic.ts`:

```ts
import type { House, OsmData, Way } from '../../src/types';

// A rows x cols grid of intersections about 100 m apart. Node id = r*cols + c + 1.
// Horizontal streets are named "Row r" and carry perEdge houses per side per block;
// vertical streets are named "Col c" and carry none. rows=5, cols=5, perEdge=3 gives 120 houses.
export function syntheticGrid(rows: number, cols: number, perEdge: number): { osm: OsmData; houses: House[] } {
  const LAT0 = 42;
  const LON0 = -88.3;
  const DLAT = 0.0009;
  const DLON = 0.0012;
  const OFF = 0.00015;
  const id = (r: number, c: number) => r * cols + c + 1;

  const nodes: [number, number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) nodes.push([id(r, c), LAT0 + r * DLAT, LON0 + c * DLON]);

  const ways: Way[] = [];
  let wid = 1000;
  for (let r = 0; r < rows; r++) {
    ways.push({ id: wid++, name: `Row ${r}`, highway: 'residential', nodes: Array.from({ length: cols }, (_, c) => id(r, c)) });
  }
  for (let c = 0; c < cols; c++) {
    ways.push({ id: wid++, name: `Col ${c}`, highway: 'residential', nodes: Array.from({ length: rows }, (_, r) => id(r, c)) });
  }

  const houses: House[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      for (let k = 0; k < perEdge; k++) {
        for (const side of [1, -1]) {
          const f = (k + 0.5) / perEdge;
          houses.push({
            id: `h${r}_${c}_${k}_${side > 0 ? '+' : '-'}`,
            lat: LAT0 + r * DLAT + side * OFF,
            lon: LON0 + (c + f) * DLON,
            label: `${k + 1} Row ${r}`,
            street: `Row ${r}`,
            flagged: false,
            manual: false,
          });
        }
      }
    }
  }
  return { osm: { nodes, ways }, houses };
}
```

- [ ] **Step 2: Write the failing graph test**

Create `tests/graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { syntheticGrid } from './fixtures/synthetic';
import type { OsmData } from '../src/types';

describe('syntheticGrid', () => {
  it('makes 120 houses for a 5x5 grid with 3 per edge per side', () => {
    expect(syntheticGrid(5, 5, 3).houses).toHaveLength(120);
  });
});

describe('buildGraph', () => {
  it('builds nodes, edges and one segment per block on a grid', () => {
    const g = buildGraph(syntheticGrid(5, 5, 3).osm);
    expect(g.coords).toHaveLength(25);
    expect(g.edges).toHaveLength(40);
    expect(g.segments).toHaveLength(40);
    g.edges.forEach((e, i) => expect(e.id).toBe(i));
    g.segments.forEach((s, i) => expect(s.id).toBe(i));
  });

  it('gives edges realistic lengths (~99 m east-west, ~100 m north-south)', () => {
    const g = buildGraph(syntheticGrid(2, 2, 1).osm);
    const lens = g.edges.map((e) => e.length).sort((a, b) => a - b);
    expect(lens[0]).toBeGreaterThan(95);
    expect(lens[lens.length - 1]).toBeLessThan(105);
  });

  it('builds symmetric adjacency', () => {
    const g = buildGraph(syntheticGrid(3, 3, 1).osm);
    for (let u = 0; u < g.adj.length; u++) {
      for (const { to, w } of g.adj[u]) {
        expect(g.adj[to].some((x) => x.to === u && Math.abs(x.w - w) < 1e-9)).toBe(true);
      }
    }
  });

  it('merges a single street through degree-2 nodes into one segment', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42, -88.298], [4, 42, -88.297]],
      ways: [{ id: 1, name: 'A', highway: 'residential', nodes: [1, 2, 3, 4] }],
    };
    const g = buildGraph(osm);
    expect(g.edges).toHaveLength(3);
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0].edgeIds).toEqual([0, 1, 2]);
    expect(g.segments[0].key).toBe('A:1');
    expect(g.segments[0].street).toBe('A');
  });

  it('does not merge across a name change at a degree-2 node', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42, -88.298]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [2, 3] },
      ],
    };
    expect(buildGraph(osm).segments).toHaveLength(2);
  });

  it('skips edges whose nodes are missing instead of bridging them', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [4, 42, -88.297]],
      ways: [{ id: 1, name: 'A', highway: 'residential', nodes: [1, 2, 3, 4] }],
    };
    const g = buildGraph(osm);
    expect(g.edges).toHaveLength(1);
    expect(g.index.get(4)).toBe(2);
  });

  it('does not duplicate an edge shared by two ways', () => {
    const osm: OsmData = {
      nodes: [[1, 42, -88.3], [2, 42, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'A', highway: 'footway', nodes: [2, 1] },
      ],
    };
    expect(buildGraph(osm).edges).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/graph.test.ts`
Expected: FAIL — "Failed to resolve import ../src/graph/build".

- [ ] **Step 4: Implement `src/graph/build.ts`**

```ts
import { haversine } from '../geo';
import type { LatLon, OsmData } from '../types';

export interface GraphEdge { id: number; a: number; b: number; length: number; street: string; segment: number }
export interface Segment { id: number; key: string; street: string; edgeIds: number[] }
export interface Graph {
  coords: LatLon[];
  osmIds: number[];
  index: Map<number, number>;
  edges: GraphEdge[];
  adj: { to: number; w: number }[][];
  segments: Segment[];
}

export function buildGraph(osm: OsmData): Graph {
  const coords: LatLon[] = [];
  const osmIds: number[] = [];
  const index = new Map<number, number>();
  for (const [id, lat, lon] of osm.nodes) {
    if (index.has(id)) continue;
    index.set(id, coords.length);
    coords.push({ lat, lon });
    osmIds.push(id);
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const w of osm.ways) {
    for (let i = 0; i + 1 < w.nodes.length; i++) {
      const a = index.get(w.nodes[i]);
      const b = index.get(w.nodes[i + 1]);
      if (a === undefined || b === undefined || a === b) continue;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ id: edges.length, a, b, length: haversine(coords[a], coords[b]), street: w.name, segment: -1 });
    }
  }

  const adj: { to: number; w: number }[][] = coords.map(() => []);
  const incident: number[][] = coords.map(() => []);
  for (const e of edges) {
    adj[e.a].push({ to: e.b, w: e.length });
    adj[e.b].push({ to: e.a, w: e.length });
    incident[e.a].push(e.id);
    incident[e.b].push(e.id);
  }

  // Union-find over edges: two edges meeting at a degree-2 node on the same street form one segment.
  const parent = edges.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const inc of incident) {
    if (inc.length !== 2) continue;
    if (edges[inc[0]].street !== edges[inc[1]].street) continue;
    parent[find(inc[0])] = find(inc[1]);
  }

  const segments: Segment[] = [];
  const segOfRoot = new Map<number, number>();
  for (const e of edges) {
    const root = find(e.id);
    let sid = segOfRoot.get(root);
    if (sid === undefined) {
      sid = segments.length;
      segOfRoot.set(root, sid);
      segments.push({ id: sid, key: '', street: e.street, edgeIds: [] });
    }
    e.segment = sid;
    segments[sid].edgeIds.push(e.id);
  }
  for (const s of segments) {
    let minId = Infinity;
    for (const eid of s.edgeIds) {
      minId = Math.min(minId, osmIds[edges[eid].a], osmIds[edges[eid].b]);
    }
    s.key = `${s.street}:${minId}`;
  }

  return { coords, osmIds, index, edges, adj, segments };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/graph.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/synthetic.ts src/graph/build.ts tests/graph.test.ts
git commit -m "feat: road graph with street segments and synthetic grid fixture"
```

---

### Task 5: Snapping, walking distances, and the assembled model

**Files:**
- Create: `src/graph/snap.ts`, `src/graph/shortest.ts`, `src/model.ts`
- Test: `tests/snap.test.ts`, `tests/shortest.test.ts`, `tests/model.test.ts`

**Interfaces:**
- Consumes: `Graph`, `GraphEdge` from `src/graph/build.ts` and `buildGraph(osm: OsmData): Graph`; `makeProjector(ref: LatLon): (p: LatLon) => XY` and `projectToSegment(p: XY, a: XY, b: XY): { t: number; dist: number; side: 1 | -1 }` from `src/geo.ts`; `syntheticGrid` from `tests/fixtures/synthetic.ts`.
- Produces:
  - `Snap = { edge: number; along: number; side: 1 | -1; segment: number; point: LatLon; offset: number }` (`along` = metres from the edge's `a` node; `offset` = metres from the house to the street).
  - `snapHouses(houses: House[], g: Graph): Snap[]` (same order and length as `houses`).
  - `UNREACHABLE = 1e6`; `class Oracle { constructor(g: Graph); nodeDist(a: number, b: number): number }`.
  - `houseDistance(oracle: Oracle, g: Graph, sa: Snap, sb: Snap, crossingPenalty: number): number`.
  - `buildDistMatrix(oracle: Oracle, g: Graph, snaps: Snap[], crossingPenalty: number): Float32Array` (row-major `H*H`, symmetric, zero diagonal; index with `m[i * H + j]`).
  - `connectedComponents(g: Graph): number[]` (component label per node index).
  - `Model = { houses: House[]; graph: Graph; snaps: Snap[]; dist: Float32Array; segmentOf: number[]; xy: XY[]; disconnected: number[] }` and `buildModel(houses: House[], osm: OsmData, crossingPenalty: number): Model` (`segmentOf[i]` is the segment id of house `i`; `xy` are projected metres; `disconnected` lists house indices not on the largest connected road component).

- [ ] **Step 1: Write the failing snap test**

Create `tests/snap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { snapHouses } from '../src/graph/snap';
import { syntheticGrid } from './fixtures/synthetic';

describe('snapHouses', () => {
  const { osm, houses } = syntheticGrid(5, 5, 3);
  const g = buildGraph(osm);
  const snaps = snapHouses(houses, g);

  it('returns one snap per house in order', () => {
    expect(snaps).toHaveLength(houses.length);
  });

  it('snaps each house to a block of its own street', () => {
    houses.forEach((h, i) => {
      expect(g.segments[snaps[i].segment].street).toBe(h.street);
    });
  });

  it('records about 16.7 m offset from the street', () => {
    for (const s of snaps) {
      expect(s.offset).toBeGreaterThan(15);
      expect(s.offset).toBeLessThan(18.5);
    }
  });

  it('puts houses on opposite sides of a block on opposite sides', () => {
    const plus = houses.findIndex((h) => h.id === 'h1_1_0_+');
    const minus = houses.findIndex((h) => h.id === 'h1_1_0_-');
    expect(snaps[plus].edge).toBe(snaps[minus].edge);
    expect(snaps[plus].side).not.toBe(snaps[minus].side);
  });

  it('keeps along within the edge length', () => {
    for (const s of snaps) {
      expect(s.along).toBeGreaterThanOrEqual(0);
      expect(s.along).toBeLessThanOrEqual(g.edges[s.edge].length + 1e-6);
    }
  });

  it('returns an empty array for no houses and throws on an empty graph', () => {
    expect(snapHouses([], g)).toEqual([]);
    expect(() => snapHouses(houses.slice(0, 1), buildGraph({ nodes: [], ways: [] }))).toThrow(/no edges/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/snap.test.ts`
Expected: FAIL — "Failed to resolve import ../src/graph/snap".

- [ ] **Step 3: Implement `src/graph/snap.ts`**

```ts
import { makeProjector, projectToSegment } from '../geo';
import type { House, LatLon } from '../types';
import type { Graph } from './build';

export interface Snap {
  edge: number;
  along: number;
  side: 1 | -1;
  segment: number;
  point: LatLon;
  offset: number;
}

export function snapHouses(houses: House[], g: Graph): Snap[] {
  if (houses.length === 0) return [];
  if (g.edges.length === 0) throw new Error('graph has no edges; cannot snap houses');
  const proj = makeProjector(g.coords[0]);
  const P = g.coords.map(proj);
  return houses.map((h) => {
    const p = proj(h);
    let best = 0;
    let bd = Infinity;
    let bt = 0;
    let bs: 1 | -1 = 1;
    for (const e of g.edges) {
      const r = projectToSegment(p, P[e.a], P[e.b]);
      if (r.dist < bd) {
        bd = r.dist;
        best = e.id;
        bt = r.t;
        bs = r.side;
      }
    }
    const e = g.edges[best];
    const a = g.coords[e.a];
    const b = g.coords[e.b];
    return {
      edge: best,
      along: bt * e.length,
      side: bs,
      segment: e.segment,
      point: { lat: a.lat + (b.lat - a.lat) * bt, lon: a.lon + (b.lon - a.lon) * bt },
      offset: bd,
    };
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/snap.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing shortest-path test**

Create `tests/shortest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { snapHouses, type Snap } from '../src/graph/snap';
import { Oracle, houseDistance, buildDistMatrix, connectedComponents, UNREACHABLE } from '../src/graph/shortest';
import { syntheticGrid } from './fixtures/synthetic';

const { osm, houses } = syntheticGrid(5, 5, 3);
const g = buildGraph(osm);

describe('Oracle', () => {
  it('measures opposite grid corners at about 800 m', () => {
    const o = new Oracle(g);
    const a = g.index.get(1)!;
    const b = g.index.get(25)!;
    const d = o.nodeDist(a, b);
    expect(d).toBeGreaterThan(780);
    expect(d).toBeLessThan(810);
    expect(o.nodeDist(b, a)).toBeCloseTo(d, 3);
    expect(o.nodeDist(a, a)).toBe(0);
  });

  it('returns Infinity between disconnected nodes', () => {
    const island = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42.1, -88.3], [4, 42.1, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [3, 4] },
      ],
    });
    expect(new Oracle(island).nodeDist(0, 2)).toBe(Infinity);
  });
});

describe('houseDistance', () => {
  const o = new Oracle(g);
  const base = { edge: 0, segment: 0, point: { lat: 0, lon: 0 }, offset: 0 };
  const s = (along: number, side: 1 | -1): Snap => ({ ...base, along, side });

  it('uses along-edge distance on the same side of one edge', () => {
    expect(houseDistance(o, g, s(10, 1), s(30, 1), 8)).toBeCloseTo(20, 6);
  });

  it('adds the crossing penalty on opposite sides of the same edge', () => {
    expect(houseDistance(o, g, s(10, 1), s(30, -1), 8)).toBeCloseTo(28, 6);
  });

  it('routes between different edges through the graph', () => {
    const snaps = snapHouses(houses, g);
    const first = 0;
    const last = houses.length - 1;
    const d = houseDistance(o, g, snaps[first], snaps[last], 8);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(1000);
  });

  it('is symmetric', () => {
    const snaps = snapHouses(houses, g);
    expect(houseDistance(o, g, snaps[3], snaps[77], 8)).toBeCloseTo(houseDistance(o, g, snaps[77], snaps[3], 8), 3);
  });

  it('caps unreachable pairs at UNREACHABLE', () => {
    const two = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42.1, -88.3], [4, 42.1, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [3, 4] },
      ],
    });
    const oo = new Oracle(two);
    const sa: Snap = { ...base, edge: 0, along: 5, side: 1 };
    const sb: Snap = { ...base, edge: 1, along: 5, side: 1 };
    expect(houseDistance(oo, two, sa, sb, 8)).toBe(UNREACHABLE);
  });
});

describe('buildDistMatrix', () => {
  const snaps = snapHouses(houses, g);
  const H = houses.length;
  const m = buildDistMatrix(new Oracle(g), g, snaps, 8);

  it('has H*H entries', () => {
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(H * H);
  });

  it('has a zero diagonal and is symmetric', () => {
    for (let i = 0; i < H; i += 7) {
      expect(m[i * H + i]).toBe(0);
      for (let j = 0; j < H; j += 11) expect(m[i * H + j]).toBe(m[j * H + i]);
    }
  });

  it('is finite everywhere on a connected grid', () => {
    for (let i = 0; i < m.length; i++) expect(m[i]).toBeLessThan(UNREACHABLE);
  });
});

describe('connectedComponents', () => {
  it('labels a connected grid as one component', () => {
    expect(new Set(connectedComponents(g)).size).toBe(1);
  });

  it('labels separate islands differently', () => {
    const two = buildGraph({
      nodes: [[1, 42, -88.3], [2, 42, -88.299], [3, 42.1, -88.3], [4, 42.1, -88.299]],
      ways: [
        { id: 1, name: 'A', highway: 'residential', nodes: [1, 2] },
        { id: 2, name: 'B', highway: 'residential', nodes: [3, 4] },
      ],
    });
    const c = connectedComponents(two);
    expect(c[0]).toBe(c[1]);
    expect(c[2]).toBe(c[3]);
    expect(c[0]).not.toBe(c[2]);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/shortest.test.ts`
Expected: FAIL — "Failed to resolve import ../src/graph/shortest".

- [ ] **Step 7: Implement `src/graph/shortest.ts`**

Note: Dijkstra distances are stored in `Float64Array`. A `Float32Array` would round `d[to]` below the double `k` held in the heap, so the stale-entry check `k > d[u]` would wrongly discard valid entries.

```ts
import type { Graph } from './build';
import type { Snap } from './snap';

export const UNREACHABLE = 1e6;

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(k: number, v: number): void {
    let i = this.keys.length;
    this.keys.push(k);
    this.vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const k = this.keys[0];
    const v = this.vals[0];
    const lk = this.keys.pop()!;
    const lv = this.vals.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.keys[l] < this.keys[m]) m = l;
        if (r < n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return [k, v];
  }

  private swap(i: number, j: number): void {
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
    [this.vals[i], this.vals[j]] = [this.vals[j], this.vals[i]];
  }
}

export class Oracle {
  private cache = new Map<number, Float64Array>();

  constructor(private g: Graph) {}

  private run(src: number): Float64Array {
    const d = new Float64Array(this.g.coords.length).fill(Infinity);
    d[src] = 0;
    const h = new MinHeap();
    h.push(0, src);
    while (h.size > 0) {
      const [k, u] = h.pop();
      if (k > d[u]) continue;
      for (const { to, w } of this.g.adj[u]) {
        const nd = k + w;
        if (nd < d[to]) {
          d[to] = nd;
          h.push(nd, to);
        }
      }
    }
    return d;
  }

  nodeDist(a: number, b: number): number {
    let d = this.cache.get(a);
    if (!d) {
      d = this.run(a);
      this.cache.set(a, d);
    }
    return d[b];
  }
}

// Walking distance between two snapped houses. On the same edge it is the along-edge gap, plus a
// crossing penalty when the houses face each other across the street. Across different edges it is
// the best of the four end-node combinations. Unreachable pairs are capped at UNREACHABLE so tour
// arithmetic stays finite.
export function houseDistance(oracle: Oracle, g: Graph, sa: Snap, sb: Snap, crossingPenalty: number): number {
  if (sa.edge === sb.edge) {
    return Math.abs(sa.along - sb.along) + (sa.side !== sb.side ? crossingPenalty : 0);
  }
  const ea = g.edges[sa.edge];
  const eb = g.edges[sb.edge];
  const ca: [number, number][] = [[ea.a, sa.along], [ea.b, ea.length - sa.along]];
  const cb: [number, number][] = [[eb.a, sb.along], [eb.b, eb.length - sb.along]];
  let best = Infinity;
  for (const [na, oa] of ca) {
    for (const [nb, ob] of cb) {
      const d = oa + oracle.nodeDist(na, nb) + ob;
      if (d < best) best = d;
    }
  }
  return Math.min(best, UNREACHABLE);
}

export function buildDistMatrix(oracle: Oracle, g: Graph, snaps: Snap[], crossingPenalty: number): Float32Array {
  const n = snaps.length;
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = houseDistance(oracle, g, snaps[i], snaps[j], crossingPenalty);
      m[i * n + j] = d;
      m[j * n + i] = d;
    }
  }
  return m;
}

export function connectedComponents(g: Graph): number[] {
  const label = new Array<number>(g.coords.length).fill(-1);
  let next = 0;
  for (let s = 0; s < label.length; s++) {
    if (label[s] >= 0) continue;
    label[s] = next;
    const stack = [s];
    while (stack.length > 0) {
      const u = stack.pop()!;
      for (const { to } of g.adj[u]) {
        if (label[to] < 0) {
          label[to] = next;
          stack.push(to);
        }
      }
    }
    next++;
  }
  return label;
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run tests/shortest.test.ts`
Expected: PASS (12 tests). The 120-house matrix takes well under a second.

- [ ] **Step 9: Write the failing model test**

Create `tests/model.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildModel } from '../src/model';
import { syntheticGrid } from './fixtures/synthetic';
import { UNREACHABLE } from '../src/graph/shortest';
import type { House, OsmData } from '../src/types';

describe('buildModel', () => {
  const { osm, houses } = syntheticGrid(5, 5, 3);
  const m = buildModel(houses, osm, 8);

  it('produces per-house arrays of matching length', () => {
    expect(m.houses).toHaveLength(120);
    expect(m.snaps).toHaveLength(120);
    expect(m.segmentOf).toHaveLength(120);
    expect(m.xy).toHaveLength(120);
    expect(m.dist).toHaveLength(120 * 120);
  });

  it('reports no disconnected houses on a connected grid', () => {
    expect(m.disconnected).toEqual([]);
  });

  it('segmentOf matches the snapped segment and names the right street', () => {
    m.segmentOf.forEach((s, i) => {
      expect(s).toBe(m.snaps[i].segment);
      expect(m.graph.segments[s].street).toBe(houses[i].street);
    });
  });

  it('projects houses to metres around the first house', () => {
    expect(m.xy[0]).toEqual({ x: 0, y: 0 });
    const far = m.xy[m.xy.length - 1];
    expect(Math.hypot(far.x, far.y)).toBeGreaterThan(300);
  });

  it('has finite distances everywhere', () => {
    for (let i = 0; i < m.dist.length; i++) expect(m.dist[i]).toBeLessThan(UNREACHABLE);
  });

  it('flags a house that snaps to a disconnected island', () => {
    const island: OsmData = {
      nodes: [...osm.nodes, [900, 42.05, -88.3], [901, 42.05, -88.2985]],
      ways: [...osm.ways, { id: 999, name: 'Island Rd', highway: 'residential', nodes: [900, 901] }],
    };
    const stray: House = { id: 'x', lat: 42.05005, lon: -88.2992, label: '1 Island Rd', street: 'Island Rd', flagged: false, manual: false };
    const m2 = buildModel([...houses, stray], island, 8);
    expect(m2.disconnected).toEqual([120]);
  });

  it('handles an empty house list', () => {
    const m3 = buildModel([], osm, 8);
    expect(m3.houses).toEqual([]);
    expect(m3.dist).toHaveLength(0);
    expect(m3.disconnected).toEqual([]);
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `npx vitest run tests/model.test.ts`
Expected: FAIL — "Failed to resolve import ../src/model".

- [ ] **Step 11: Implement `src/model.ts`**

```ts
import { makeProjector } from './geo';
import { buildGraph, type Graph } from './graph/build';
import { snapHouses, type Snap } from './graph/snap';
import { Oracle, buildDistMatrix, connectedComponents } from './graph/shortest';
import type { House, OsmData, XY } from './types';

export interface Model {
  houses: House[];
  graph: Graph;
  snaps: Snap[];
  dist: Float32Array;
  segmentOf: number[];
  xy: XY[];
  disconnected: number[];
}

export function buildModel(houses: House[], osm: OsmData, crossingPenalty: number): Model {
  const graph = buildGraph(osm);
  const snaps = snapHouses(houses, graph);
  const dist = buildDistMatrix(new Oracle(graph), graph, snaps, crossingPenalty);

  const ref = houses[0] ?? graph.coords[0] ?? { lat: 0, lon: 0 };
  const proj = makeProjector(ref);
  const xy = houses.map(proj);

  const comp = connectedComponents(graph);
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  let main = -1;
  let mainSize = -1;
  for (const [c, n] of sizes) {
    if (n > mainSize) {
      mainSize = n;
      main = c;
    }
  }
  const disconnected: number[] = [];
  snaps.forEach((s, i) => {
    if (comp[graph.edges[s.edge].a] !== main) disconnected.push(i);
  });

  return { houses, graph, snaps, dist, segmentOf: snaps.map((s) => s.segment), xy, disconnected };
}
```

- [ ] **Step 12: Run it to verify it passes**

Run: `npx vitest run tests/model.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 13: Run the whole suite, type-check, commit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

```bash
git add src/graph/snap.ts src/graph/shortest.ts src/model.ts \
  tests/snap.test.ts tests/shortest.test.ts tests/model.test.ts
git commit -m "feat: snap houses to streets, walking distance matrix, assembled model"
```
### Task 6: Tour solver (TSP) and contiguity check

**Files:**
- Create: `src/solver/tsp.ts`
- Create: `src/solver/contiguity.ts`
- Test: `tests/tsp.test.ts`

**Interfaces:**
- Consumes: `Dist`, `Tour` from `src/types.ts` (`type Dist = (i: number, j: number) => number`; `interface Tour { order: number[]; length: number }`). Houses are identified by their integer index; `dist` is symmetric and finite.
- Produces:
  - `tourLength(order: number[], dist: Dist): number` — closed-loop length (0 for fewer than 2 stops; `2*d` for two).
  - `solveTour(members: number[], dist: Dist, opts?: { initial?: number[]; maxStarts?: number }): Tour` — closed loop over `members`. With `initial`, only improves that order; otherwise multi-start nearest-neighbor (default `maxStarts` 4) then 2-opt + Or-opt.
  - `warmStart(prev: number[], members: number[], dist: Dist): number[]` — keep `prev` order for houses still in `members`, cheapest-insert the new ones.
  - `rotateToStart(order: number[], dist: Dist): number[]` — rotate so the tour begins at the house right after its longest leg (that leg becomes the closing return leg). Same length, same set.
  - `countComponents(members: number[], dist: Dist, link: number): number` — connected components where two houses are linked if `dist <= link`.

- [ ] **Step 1: Write the failing test**

Create `tests/tsp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { solveTour, tourLength, warmStart, rotateToStart } from '../src/solver/tsp';
import { countComponents } from '../src/solver/contiguity';

const euclid = (pts: { x: number; y: number }[]) => (i: number, j: number) =>
  Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);

describe('solveTour', () => {
  it('finds the polygon perimeter for shuffled points on a circle', () => {
    const pts = Array.from({ length: 12 }, (_, k) => ({
      x: Math.cos((2 * Math.PI * k) / 12) * 100,
      y: Math.sin((2 * Math.PI * k) / 12) * 100,
    }));
    const dist = euclid(pts);
    const shuffled = [0, 7, 3, 10, 1, 8, 5, 2, 11, 4, 9, 6];
    const tour = solveTour(shuffled, dist, { maxStarts: 6 });
    expect(tour.length).toBeCloseTo(12 * dist(0, 1), 3);
    expect([...tour.order].sort((a, b) => a - b)).toEqual([...shuffled].sort((a, b) => a - b));
    expect(tourLength(tour.order, dist)).toBeCloseTo(tour.length, 6);
  });

  it('handles 0, 1 and 2 members', () => {
    const dist = euclid([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 9, y: 9 }]);
    expect(solveTour([], dist)).toEqual({ order: [], length: 0 });
    expect(solveTour([2], dist)).toEqual({ order: [2], length: 0 });
    const two = solveTour([0, 1], dist);
    expect(two.order).toEqual([0, 1]);
    expect(two.length).toBeCloseTo(10, 6);
  });

  it('improves a supplied initial order without changing the member set', () => {
    const pts = Array.from({ length: 8 }, (_, k) => ({
      x: Math.cos((2 * Math.PI * k) / 8) * 50,
      y: Math.sin((2 * Math.PI * k) / 8) * 50,
    }));
    const dist = euclid(pts);
    const bad = [0, 4, 1, 5, 2, 6, 3, 7];
    const tour = solveTour(bad, dist, { initial: bad });
    expect(tour.length).toBeLessThan(tourLength(bad, dist));
    expect([...tour.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('warmStart', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 1.5, y: 1 },
  ];
  const dist = euclid(pts);

  it('keeps previous order and inserts new members', () => {
    const out = warmStart([0, 1, 2, 3], [0, 1, 2, 3, 4], dist);
    expect(out).toHaveLength(5);
    expect(out.filter((x) => x !== 4)).toEqual([0, 1, 2, 3]);
    expect(out).toContain(4);
  });

  it('drops members that left the group', () => {
    expect(warmStart([0, 1, 2, 3], [0, 2, 3], dist)).toEqual([0, 2, 3]);
  });

  it('builds from nothing', () => {
    expect([...warmStart([], [0, 1, 2], dist)].sort()).toEqual([0, 1, 2]);
  });
});

describe('rotateToStart', () => {
  it('starts right after the longest leg and keeps the same set', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 11 }, { x: 0, y: 1 }];
    const dist = euclid(pts);
    const out = rotateToStart([0, 1, 2, 3], dist);
    expect(out).toEqual([1, 2, 3, 0]);
    expect(tourLength(out, dist)).toBeCloseTo(tourLength([0, 1, 2, 3], dist), 9);
  });

  it('leaves tiny tours alone', () => {
    const dist = () => 1;
    expect(rotateToStart([4, 5], dist)).toEqual([4, 5]);
  });
});

describe('countComponents', () => {
  const pts = [
    ...Array.from({ length: 5 }, (_, i) => ({ x: i * 10, y: 0 })),
    ...Array.from({ length: 5 }, (_, i) => ({ x: 1000 + i * 10, y: 0 })),
  ];
  const dist = euclid(pts);
  const all = pts.map((_, i) => i);

  it('counts two separated blobs', () => {
    expect(countComponents(all, dist, 50)).toBe(2);
  });
  it('merges when the link distance is large', () => {
    expect(countComponents(all, dist, 5000)).toBe(1);
  });
  it('returns 0 for an empty group', () => {
    expect(countComponents([], dist, 50)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tsp.test.ts`
Expected: FAIL — cannot resolve `../src/solver/tsp` / `../src/solver/contiguity`.

- [ ] **Step 3: Write minimal implementation**

Create `src/solver/contiguity.ts`:

```ts
import type { Dist } from '../types';

/** Connected components of `members`, linking any two houses within `link` metres (walking distance). */
export function countComponents(members: number[], dist: Dist, link: number): number {
  const n = members.length;
  if (n === 0) return 0;
  const seen = new Array<boolean>(n).fill(false);
  let comps = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    comps++;
    seen[s] = true;
    const stack = [s];
    while (stack.length) {
      const u = stack.pop()!;
      for (let v = 0; v < n; v++) {
        if (!seen[v] && dist(members[u], members[v]) <= link) {
          seen[v] = true;
          stack.push(v);
        }
      }
    }
  }
  return comps;
}
```

Create `src/solver/tsp.ts`:

```ts
import type { Dist, Tour } from '../types';

export function tourLength(order: number[], dist: Dist): number {
  const n = order.length;
  if (n < 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) total += dist(order[i], order[(i + 1) % n]);
  return total;
}

function nearestNeighbor(members: number[], dist: Dist, start: number): number[] {
  const left = new Set(members);
  const order = [start];
  left.delete(start);
  let cur = start;
  while (left.size) {
    let best = -1;
    let bd = Infinity;
    for (const x of left) {
      const d = dist(cur, x);
      if (d < bd) {
        bd = d;
        best = x;
      }
    }
    order.push(best);
    left.delete(best);
    cur = best;
  }
  return order;
}

function reverse(t: number[], i: number, j: number): void {
  while (i < j) {
    const tmp = t[i];
    t[i] = t[j];
    t[j] = tmp;
    i++;
    j--;
  }
}

function twoOpt(t: number[], dist: Dist): boolean {
  const n = t.length;
  let any = false;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const a = t[i];
        const b = t[i + 1];
        const c = t[j];
        const d = t[(j + 1) % n];
        if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 1e-9) {
          reverse(t, i + 1, j);
          improved = true;
          any = true;
        }
      }
    }
  }
  return any;
}

function orOpt(t: number[], dist: Dist): boolean {
  const n = t.length;
  let any = false;
  for (let len = 1; len <= 3; len++) {
    if (n < len + 3) break;
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i + len <= n && !improved; i++) {
        const seg = t.slice(i, i + len);
        const prev = t[(i - 1 + n) % n];
        const next = t[(i + len) % n];
        const s0 = seg[0];
        const s1 = seg[len - 1];
        const removeGain = dist(prev, s0) + dist(s1, next) - dist(prev, next);
        const rest = t.slice(0, i).concat(t.slice(i + len));
        const m = rest.length;
        let bestCost = removeGain - 1e-9;
        let bestPos = -1;
        let bestRev = false;
        for (let p = 0; p < m; p++) {
          const a = rest[p];
          const b = rest[(p + 1) % m];
          const base = dist(a, b);
          const fwd = dist(a, s0) + dist(s1, b) - base;
          if (fwd < bestCost) {
            bestCost = fwd;
            bestPos = p;
            bestRev = false;
          }
          const rev = dist(a, s1) + dist(s0, b) - base;
          if (rev < bestCost) {
            bestCost = rev;
            bestPos = p;
            bestRev = true;
          }
        }
        if (bestPos >= 0) {
          const ins = bestRev ? seg.slice().reverse() : seg;
          const out = rest.slice(0, bestPos + 1).concat(ins, rest.slice(bestPos + 1));
          for (let k = 0; k < n; k++) t[k] = out[k];
          improved = true;
          any = true;
        }
      }
    }
  }
  return any;
}

function improve(t: number[], dist: Dist): void {
  if (t.length < 4) return;
  for (let pass = 0; pass < 50; pass++) {
    let changed = twoOpt(t, dist);
    changed = orOpt(t, dist) || changed;
    if (!changed) break;
  }
}

export function solveTour(
  members: number[],
  dist: Dist,
  opts: { initial?: number[]; maxStarts?: number } = {},
): Tour {
  const n = members.length;
  if (n <= 1) return { order: members.slice(), length: 0 };
  if (n === 2) return { order: members.slice(), length: 2 * dist(members[0], members[1]) };
  const starts: number[][] = [];
  if (opts.initial) {
    starts.push(opts.initial.slice());
  } else {
    const k = Math.min(opts.maxStarts ?? 4, n);
    for (let s = 0; s < k; s++) {
      starts.push(nearestNeighbor(members, dist, members[Math.floor((s * n) / k)]));
    }
  }
  let best: Tour | null = null;
  for (const t of starts) {
    improve(t, dist);
    const length = tourLength(t, dist);
    if (!best || length < best.length) best = { order: t, length };
  }
  return best!;
}

/** Keep `prev` order for houses still in `members`; cheapest-insert the rest. */
export function warmStart(prev: number[], members: number[], dist: Dist): number[] {
  const keep = new Set(members);
  const order = prev.filter((x) => keep.has(x));
  const have = new Set(order);
  for (const x of members) {
    if (have.has(x)) continue;
    if (order.length < 2) {
      order.push(x);
      continue;
    }
    let bp = 0;
    let bc = Infinity;
    for (let p = 0; p < order.length; p++) {
      const a = order[p];
      const b = order[(p + 1) % order.length];
      const c = dist(a, x) + dist(x, b) - dist(a, b);
      if (c < bc) {
        bc = c;
        bp = p;
      }
    }
    order.splice(bp + 1, 0, x);
  }
  return order;
}

/** Start the loop at the house right after the longest leg; that leg becomes the return leg. */
export function rotateToStart(order: number[], dist: Dist): number[] {
  const n = order.length;
  if (n < 3) return order.slice();
  let bi = 0;
  let bl = -1;
  for (let i = 0; i < n; i++) {
    const l = dist(order[i], order[(i + 1) % n]);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  const s = (bi + 1) % n;
  return order.slice(s).concat(order.slice(0, s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tsp.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/solver/tsp.ts src/solver/contiguity.ts tests/tsp.test.ts
git commit -m "feat: closed-loop TSP solver (NN + 2-opt + Or-opt) and contiguity check"
```

---

### Task 7: Cost, stats, and seed partition

**Files:**
- Create: `src/solver/cost.ts`
- Create: `src/stats.ts`
- Create: `src/solver/seed.ts`
- Test: `tests/cost.test.ts`, `tests/stats.test.ts`, `tests/seed.test.ts`

**Interfaces:**
- Consumes: `Weights`, `XY` from `src/types.ts` (`Weights = { maxRoute: number; total: number; tolerance: number }`); `mulberry32(seed: number): () => number` from `src/rng.ts`.
- Produces:
  - `DEFAULT_WEIGHTS: Weights` = `{ maxRoute: 1, total: 0.3, tolerance: 2 }`.
  - `score(lengths: number[], w: Weights): number` = `w.maxRoute * max + w.total * sum` (0 for empty).
  - `violation(sizes: number[], tolerance: number): number` = sum over groups of `max(0, |size − mean| − tolerance)`; 0 means feasible.
  - `interface GroupStat { group: number; houses: number; length: number; minutes: number; delta: number }`; `groupStats(sizes: number[], lengths: number[], cfg: { walkSpeed: number; secPerHouse: number }): GroupStat[]` — `minutes = (length/walkSpeed + houses*secPerHouse)/60`, `delta = houses − mean`.
  - `seedPartition(xy: XY[], n: number, rng: () => number, tolerance: number): number[]` — group index per house.
  - `rebalance(assign: number[], xy: XY[], n: number, tol: number): number[]` — moves houses from the largest to the smallest group (nearest to the small group's centroid) until `violation === 0`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cost.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_WEIGHTS, score, violation } from '../src/solver/cost';

describe('violation', () => {
  it('is 0 when every group is within tolerance of the mean', () => {
    expect(violation([11, 12, 13, 14], 2)).toBe(0);
  });
  it('sums the excess beyond tolerance', () => {
    // mean 12.5: |8-12.5|-2 = 2.5, |15-12.5|-2 = 0.5 twice
    expect(violation([8, 12, 15, 15], 2)).toBeCloseTo(3.5, 9);
  });
  it('is 0 for no groups', () => {
    expect(violation([], 2)).toBe(0);
  });
});

describe('score', () => {
  it('is max route plus 0.3 x total by default', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ maxRoute: 1, total: 0.3, tolerance: 2 });
    expect(score([100, 200], DEFAULT_WEIGHTS)).toBeCloseTo(290, 9);
  });
  it('is 0 for no routes', () => {
    expect(score([], DEFAULT_WEIGHTS)).toBe(0);
  });
});
```

Create `tests/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupStats } from '../src/stats';

describe('groupStats', () => {
  it('computes minutes and delta from the mean', () => {
    const s = groupStats([10, 20], [1200, 600], { walkSpeed: 1.2, secPerHouse: 20 });
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ group: 0, houses: 10, length: 1200, delta: -5 });
    expect(s[0].minutes).toBeCloseTo(20, 9);
    expect(s[1]).toMatchObject({ group: 1, houses: 20, length: 600, delta: 5 });
    expect(s[1].minutes).toBeCloseTo(15, 9);
  });
});
```

Create `tests/seed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { seedPartition, rebalance } from '../src/solver/seed';
import { violation } from '../src/solver/cost';
import { mulberry32 } from '../src/rng';
import type { XY } from '../src/types';

function blob(cx: number, cy: number, n: number, rng: () => number): XY[] {
  return Array.from({ length: n }, () => ({
    x: cx + (rng() - 0.5) * 10,
    y: cy + (rng() - 0.5) * 10,
  }));
}
const sizesOf = (assign: number[], n: number) => {
  const s = new Array<number>(n).fill(0);
  assign.forEach((g) => s[g]++);
  return s;
};

describe('seedPartition', () => {
  it('splits two separated blobs of 10 into two groups of 10', () => {
    const rng = mulberry32(7);
    const xy = [...blob(0, 0, 10, rng), ...blob(1000, 0, 10, rng)];
    const a = seedPartition(xy, 2, mulberry32(1), 2);
    expect(sizesOf(a, 2)).toEqual([10, 10]);
    expect(new Set(a.slice(0, 10)).size).toBe(1);
    expect(new Set(a.slice(10)).size).toBe(1);
    expect(a[0]).not.toBe(a[10]);
  });

  it('rebalances unequal blobs (30/10/10) to within tolerance', () => {
    const rng = mulberry32(3);
    const xy = [...blob(0, 0, 30, rng), ...blob(1000, 0, 10, rng), ...blob(0, 1000, 10, rng)];
    const a = seedPartition(xy, 3, mulberry32(2), 2);
    expect(violation(sizesOf(a, 3), 2)).toBe(0);
    expect(a).toHaveLength(50);
    a.forEach((g) => expect(g).toBeGreaterThanOrEqual(0));
  });

  it('returns all zeros for a single group', () => {
    const xy = blob(0, 0, 7, mulberry32(1));
    expect(seedPartition(xy, 1, mulberry32(1), 2)).toEqual(new Array(7).fill(0));
  });

  it('is deterministic for a given seed', () => {
    const xy = [...blob(0, 0, 20, mulberry32(5)), ...blob(300, 200, 20, mulberry32(6))];
    expect(seedPartition(xy, 3, mulberry32(9), 2)).toEqual(seedPartition(xy, 3, mulberry32(9), 2));
  });
});

describe('rebalance', () => {
  it('moves houses from the largest to the smallest group until feasible', () => {
    const xy: XY[] = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 0 }));
    const skewed = [...new Array(16).fill(0), ...new Array(4).fill(1)];
    const out = rebalance(skewed, xy, 2, 2);
    expect(violation(sizesOf(out, 2), 2)).toBe(0);
    expect(skewed.slice(0, 16)).toEqual(new Array(16).fill(0)); // input not mutated
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cost.test.ts tests/stats.test.ts tests/seed.test.ts`
Expected: FAIL — cannot resolve `../src/solver/cost`, `../src/stats`, `../src/solver/seed`.

- [ ] **Step 3: Write minimal implementation**

Create `src/solver/cost.ts`:

```ts
import type { Weights } from '../types';

export const DEFAULT_WEIGHTS: Weights = { maxRoute: 1, total: 0.3, tolerance: 2 };

/** Objective (lower is better): longest route plus a fraction of the total distance. */
export function score(lengths: number[], w: Weights): number {
  if (lengths.length === 0) return 0;
  let max = 0;
  let sum = 0;
  for (const l of lengths) {
    if (l > max) max = l;
    sum += l;
  }
  return w.maxRoute * max + w.total * sum;
}

/** Total house-count excess beyond `tolerance` of the mean; 0 means the split is feasible. */
export function violation(sizes: number[], tolerance: number): number {
  if (sizes.length === 0) return 0;
  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  let v = 0;
  for (const s of sizes) v += Math.max(0, Math.abs(s - mean) - tolerance);
  return v;
}
```

Create `src/stats.ts`:

```ts
export interface GroupStat {
  group: number;
  houses: number;
  length: number;
  minutes: number;
  delta: number;
}

export function groupStats(
  sizes: number[],
  lengths: number[],
  cfg: { walkSpeed: number; secPerHouse: number },
): GroupStat[] {
  const mean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  return sizes.map((houses, group) => {
    const length = lengths[group] ?? 0;
    return {
      group,
      houses,
      length,
      minutes: (length / cfg.walkSpeed + houses * cfg.secPerHouse) / 60,
      delta: houses - mean,
    };
  });
}
```

Create `src/solver/seed.ts`:

```ts
import type { XY } from '../types';
import { violation } from './cost';

function regret(d: number[]): number {
  const s = [...d].sort((a, b) => a - b);
  return (s[1] ?? s[0]) - s[0];
}

function centroidOf(pts: XY[]): XY {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/** Move houses from the largest to the smallest group (nearest to its centroid) until feasible. */
export function rebalance(assign: number[], xy: XY[], n: number, tol: number): number[] {
  const a = assign.slice();
  const H = a.length;
  for (let guard = 0; guard < 10 * H; guard++) {
    const sizes = new Array<number>(n).fill(0);
    a.forEach((g) => sizes[g]++);
    if (violation(sizes, tol) === 0) break;
    let L = 0;
    let S = 0;
    for (let g = 1; g < n; g++) {
      if (sizes[g] > sizes[L]) L = g;
      if (sizes[g] < sizes[S]) S = g;
    }
    const smallMembers = xy.filter((_, i) => a[i] === S);
    const cs = smallMembers.length ? centroidOf(smallMembers) : xy[0];
    let bi = -1;
    let bd = Infinity;
    a.forEach((g, i) => {
      if (g !== L) return;
      const dd = (xy[i].x - cs.x) ** 2 + (xy[i].y - cs.y) ** 2;
      if (dd < bd) {
        bd = dd;
        bi = i;
      }
    });
    if (bi < 0) break;
    a[bi] = S;
  }
  return a;
}

/** Balanced k-means (cap ceil(H/n) per cluster), then rebalance to within `tolerance`. */
export function seedPartition(xy: XY[], n: number, rng: () => number, tolerance: number): number[] {
  const H = xy.length;
  if (n <= 1 || H === 0) return new Array<number>(H).fill(0);
  const cap = Math.ceil(H / n);

  // k-means++ initialisation
  const cent: XY[] = [xy[Math.floor(rng() * H)]];
  while (cent.length < n) {
    const d2 = xy.map((p) => Math.min(...cent.map((c) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2)));
    const sum = d2.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    let pick = H - 1;
    for (let i = 0; i < H; i++) {
      r -= d2[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    cent.push(xy[pick]);
  }

  let assign = new Array<number>(H).fill(0);
  for (let iter = 0; iter < 20; iter++) {
    const d = xy.map((p) => cent.map((c) => Math.hypot(p.x - c.x, p.y - c.y)));
    const order = xy.map((_, i) => i).sort((a, b) => regret(d[b]) - regret(d[a]));
    const count = new Array<number>(n).fill(0);
    const next = new Array<number>(H).fill(0);
    for (const i of order) {
      let bg = -1;
      for (let g = 0; g < n; g++) {
        if (count[g] >= cap) continue;
        if (bg < 0 || d[i][g] < d[i][bg]) bg = g;
      }
      next[i] = bg;
      count[bg]++;
    }
    const changed = next.some((g, i) => g !== assign[i]);
    assign = next;
    for (let g = 0; g < n; g++) {
      const m = xy.filter((_, i) => assign[i] === g);
      if (m.length) cent[g] = centroidOf(m);
    }
    if (!changed) break;
  }
  return rebalance(assign, xy, n, tolerance);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cost.test.ts tests/stats.test.ts tests/seed.test.ts`
Expected: PASS (all tests in the three files).

- [ ] **Step 5: Commit**

```bash
git add src/solver/cost.ts src/stats.ts src/solver/seed.ts tests/cost.test.ts tests/stats.test.ts tests/seed.test.ts
git commit -m "feat: objective/violation, group stats, balanced k-means seed with rebalance"
```

---

### Task 8: Annealing optimizer, solve entry point, worker, and pipeline test

**Files:**
- Create: `src/solver/anneal.ts`
- Create: `src/solver/solve.ts`
- Create: `src/solver/worker.ts`
- Create: `src/ui/solveClient.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes:
  - `Dist`, `Tour`, `Weights`, `XY` from `src/types.ts`; `mulberry32` from `src/rng.ts`.
  - `solveTour`, `warmStart`, `rotateToStart` from `src/solver/tsp.ts`; `countComponents` from `src/solver/contiguity.ts`; `score`, `violation` from `src/solver/cost.ts`; `seedPartition` from `src/solver/seed.ts`.
  - `buildModel(houses: House[], osm: OsmData, crossingPenalty: number): Model` from `src/model.ts`, where `Model = { houses; graph; snaps; dist: Float32Array /* H*H row-major */; segmentOf: number[]; xy: XY[]; disconnected: number[] }`.
  - `syntheticGrid(rows, cols, perEdge): { osm: OsmData; houses: House[] }` from `tests/fixtures/synthetic.ts`.
- Produces:
  - `interface AnnealInput { dist: Dist; houseCount: number; groups: number; assign: number[]; locked: boolean[]; segmentOf: number[]; weights: Weights; iterations: number; rng: () => number; linkDistance: number; onProgress?: (iter: number, best: number) => void }`
  - `interface Solution { assign: number[]; tours: Tour[]; score: number; feasible: boolean }` and `anneal(inp: AnnealInput): Solution`.
  - `interface SolveProblem { distMatrix: Float32Array; houseCount: number; groups: number; segmentOf: number[]; xy: XY[]; weights: Weights; seed: number; iterations: number; initial?: number[]; locked?: boolean[]; linkDistance?: number }`
  - `matrixDist(m: Float32Array, n: number): Dist`, `solve(p: SolveProblem, onProgress?: (iter: number, best: number) => void): Solution` (also re-exports type `Solution`), `routeGroups(distMatrix: Float32Array, houseCount: number, assign: number[], groups: number): Tour[]`.
  - Worker messages: `{ type: 'progress'; iter: number; best: number }` and `{ type: 'done'; solution: Solution }`.
  - `runSolve(problem: SolveProblem, onProgress?: (iter: number, best: number) => void): Promise<Solution>`.

- [ ] **Step 1: Write the failing test**

Create `tests/pipeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { syntheticGrid } from './fixtures/synthetic';
import { buildModel } from '../src/model';
import { solve, routeGroups, type SolveProblem } from '../src/solver/solve';
import { DEFAULT_WEIGHTS, violation } from '../src/solver/cost';

const GROUPS = 4;
const { osm, houses } = syntheticGrid(5, 5, 3);
const model = buildModel(houses, osm, 8);

function problem(iterations: number, extra: Partial<SolveProblem> = {}): SolveProblem {
  return {
    distMatrix: model.dist,
    houseCount: houses.length,
    groups: GROUPS,
    segmentOf: model.segmentOf,
    xy: model.xy,
    weights: DEFAULT_WEIGHTS,
    seed: 1,
    iterations,
    ...extra,
  };
}
const sizesOf = (assign: number[]) => {
  const s = new Array<number>(GROUPS).fill(0);
  assign.forEach((g) => s[g]++);
  return s;
};

describe('solve pipeline on the synthetic grid', () => {
  it('assigns every house to a group within tolerance of the mean', () => {
    expect(houses).toHaveLength(120);
    const sol = solve(problem(400));
    expect(sol.assign).toHaveLength(120);
    sol.assign.forEach((g) => {
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(GROUPS);
    });
    expect(sol.feasible).toBe(true);
    expect(violation(sizesOf(sol.assign), 2)).toBe(0);
    sizesOf(sol.assign).forEach((s) => expect(Math.abs(s - 30)).toBeLessThanOrEqual(2));
  });

  it('returns one tour per group that is a permutation of its members', () => {
    const sol = solve(problem(400));
    expect(sol.tours).toHaveLength(GROUPS);
    for (let g = 0; g < GROUPS; g++) {
      const members = sol.assign.map((x, i) => (x === g ? i : -1)).filter((i) => i >= 0);
      expect([...sol.tours[g].order].sort((a, b) => a - b)).toEqual(members);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = solve(problem(300));
    const b = solve(problem(300));
    expect(a.assign).toEqual(b.assign);
    expect(a.score).toBeCloseTo(b.score, 9);
  });

  it('never scores worse than the seed partition', () => {
    const seedOnly = solve(problem(0));
    const annealed = solve(problem(400));
    expect(annealed.score).toBeLessThanOrEqual(seedOnly.score + 1e-6);
  });

  it('never moves locked houses', () => {
    const start = solve(problem(0)).assign;
    const locked = houses.map((_, i) => i < 10);
    const sol = solve(problem(400, { initial: start, locked }));
    for (let i = 0; i < 10; i++) expect(sol.assign[i]).toBe(start[i]);
  });

  it('reseeds when the initial assignment is invalid', () => {
    const bad = new Array<number>(120).fill(-1);
    const sol = solve(problem(0, { initial: bad }));
    expect(sol.feasible).toBe(true);
  });

  it('routeGroups returns tours consistent with the assignment', () => {
    const sol = solve(problem(0));
    const tours = routeGroups(model.dist, houses.length, sol.assign, GROUPS);
    expect(tours).toHaveLength(GROUPS);
    const total = tours.reduce((n, t) => n + t.order.length, 0);
    expect(total).toBe(120);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL — cannot resolve `../src/solver/solve`.

- [ ] **Step 3: Write minimal implementation**

Create `src/solver/anneal.ts`:

```ts
import type { Dist, Tour, Weights } from '../types';
import { score, violation } from './cost';
import { solveTour, warmStart, rotateToStart } from './tsp';
import { countComponents } from './contiguity';

export interface AnnealInput {
  dist: Dist;
  houseCount: number;
  groups: number;
  assign: number[];
  locked: boolean[];
  segmentOf: number[];
  weights: Weights;
  iterations: number;
  rng: () => number;
  linkDistance: number;
  onProgress?: (iter: number, best: number) => void;
}

export interface Solution {
  assign: number[];
  tours: Tour[];
  score: number;
  feasible: boolean;
}

const NEIGHBORS = 8;
const cloneTour = (t: Tour): Tour => ({ order: t.order.slice(), length: t.length });

export function anneal(inp: AnnealInput): Solution {
  const { dist, houseCount: H, groups: N, weights, rng, linkDistance } = inp;
  const assign = inp.assign.slice();
  const members: number[][] = Array.from({ length: N }, () => []);
  assign.forEach((g, h) => members[g].push(h));
  const tours: Tour[] = members.map((m) => solveTour(m, dist));
  const comps = members.map((m) => countComponents(m, dist, linkDistance));

  // K nearest houses (by walking distance) for each house: the candidate boundary neighbours.
  const near: number[][] = [];
  for (let h = 0; h < H; h++) {
    const idx: number[] = [];
    for (let i = 0; i < H; i++) if (i !== h) idx.push(i);
    idx.sort((a, b) => dist(h, a) - dist(h, b));
    near.push(idx.slice(0, NEIGHBORS));
  }

  const sizes = () => members.map((m) => m.length);
  const lengths = () => tours.map((t) => t.length);
  let curScore = score(lengths(), weights);
  let curViol = violation(sizes(), weights.tolerance);
  let best: { assign: number[]; tours: Tour[]; score: number } | null =
    curViol === 0 ? { assign: assign.slice(), tours: tours.map(cloneTour), score: curScore } : null;

  const T0 = Math.max(1, curScore * 0.02);
  const Tend = T0 * 0.001;

  for (let it = 0; it < inp.iterations && H > 0 && N > 1; it++) {
    if (inp.onProgress && it % 200 === 0) inp.onProgress(it, best ? best.score : curScore);
    const temp = T0 * Math.pow(Tend / T0, it / Math.max(1, inp.iterations - 1));

    const h = Math.floor(rng() * H);
    if (inp.locked[h]) continue;
    const g = assign[h];
    const foreign = near[h].filter((j) => assign[j] !== g);
    if (foreign.length === 0) continue;
    const j = foreign[Math.floor(rng() * foreign.length)];
    const t = assign[j];

    const r = rng();
    let moves: [number, number][];
    if (r < 0.6) {
      moves = [[h, t]];
    } else if (r < 0.85) {
      const run = [h];
      for (const k of near[h]) {
        if (run.length >= 3) break;
        if (assign[k] === g && !inp.locked[k] && inp.segmentOf[k] === inp.segmentOf[h]) run.push(k);
      }
      moves = run.map((x) => [x, t] as [number, number]);
    } else {
      if (inp.locked[j]) continue;
      moves = [[h, t], [j, g]];
    }

    const out = new Set(moves.map((m) => m[0]));
    const intoG = moves.filter((m) => m[1] === g).map((m) => m[0]);
    const intoT = moves.filter((m) => m[1] === t).map((m) => m[0]);
    const newG = members[g].filter((x) => !out.has(x)).concat(intoG);
    const newT = members[t].filter((x) => !out.has(x)).concat(intoT);
    if (newG.length === 0) continue;

    // Hard balance rule: a move must not leave the split infeasible unless it reduces the violation.
    const newSizes = sizes();
    newSizes[g] = newG.length;
    newSizes[t] = newT.length;
    const newViol = violation(newSizes, weights.tolerance);
    if (newViol > 0 && newViol >= curViol) continue;

    // Contiguity guard: never split a group into more walkable pieces than it had.
    const cg = countComponents(newG, dist, linkDistance);
    if (cg > comps[g]) continue;
    const ct = countComponents(newT, dist, linkDistance);
    if (ct > comps[t]) continue;

    // Re-solve only the two touched tours, warm-started from their previous order.
    const tg = solveTour(newG, dist, { initial: warmStart(tours[g].order, newG, dist) });
    const tt = solveTour(newT, dist, { initial: warmStart(tours[t].order, newT, dist) });
    const newLengths = lengths();
    newLengths[g] = tg.length;
    newLengths[t] = tt.length;
    const newScore = score(newLengths, weights);

    let accept: boolean;
    if (newViol < curViol) accept = true;
    else accept = newScore <= curScore || rng() < Math.exp((curScore - newScore) / temp);
    if (!accept) continue;

    for (const [x, to] of moves) assign[x] = to;
    members[g] = newG;
    members[t] = newT;
    tours[g] = tg;
    tours[t] = tt;
    comps[g] = cg;
    comps[t] = ct;
    curScore = newScore;
    curViol = newViol;
    if (newViol === 0 && (!best || newScore < best.score)) {
      best = { assign: assign.slice(), tours: tours.map(cloneTour), score: newScore };
    }
  }

  const final = best ?? { assign: assign.slice(), tours: tours.map(cloneTour), score: curScore };
  const rotated = final.tours.map((t) => ({ order: rotateToStart(t.order, dist), length: t.length }));
  if (inp.onProgress) inp.onProgress(inp.iterations, final.score);
  return { assign: final.assign, tours: rotated, score: final.score, feasible: best !== null };
}
```

Create `src/solver/solve.ts`:

```ts
import type { Dist, Tour, Weights, XY } from '../types';
import { mulberry32 } from '../rng';
import { seedPartition } from './seed';
import { anneal, type Solution } from './anneal';
import { solveTour, rotateToStart } from './tsp';

export type { Solution } from './anneal';

export interface SolveProblem {
  distMatrix: Float32Array;
  houseCount: number;
  groups: number;
  segmentOf: number[];
  xy: XY[];
  weights: Weights;
  seed: number;
  iterations: number;
  initial?: number[];
  locked?: boolean[];
  linkDistance?: number;
}

const DEFAULT_LINK_DISTANCE = 150;

export function matrixDist(m: Float32Array, n: number): Dist {
  return (i, j) => m[i * n + j];
}

export function solve(p: SolveProblem, onProgress?: (iter: number, best: number) => void): Solution {
  const dist = matrixDist(p.distMatrix, p.houseCount);
  const rng = mulberry32(p.seed);
  const valid =
    p.initial !== undefined &&
    p.initial.length === p.houseCount &&
    p.initial.every((g) => Number.isInteger(g) && g >= 0 && g < p.groups);
  const initial = valid ? p.initial! : seedPartition(p.xy, p.groups, rng, p.weights.tolerance);
  return anneal({
    dist,
    houseCount: p.houseCount,
    groups: p.groups,
    assign: initial,
    locked: p.locked ?? new Array<boolean>(p.houseCount).fill(false),
    segmentOf: p.segmentOf,
    weights: p.weights,
    iterations: p.iterations,
    rng,
    linkDistance: p.linkDistance ?? DEFAULT_LINK_DISTANCE,
    onProgress,
  });
}

/** Fast path used after manual edits: re-route every group without changing membership. */
export function routeGroups(
  distMatrix: Float32Array,
  houseCount: number,
  assign: number[],
  groups: number,
): Tour[] {
  const dist = matrixDist(distMatrix, houseCount);
  const members: number[][] = Array.from({ length: groups }, () => []);
  assign.forEach((g, h) => {
    if (g >= 0 && g < groups) members[g].push(h);
  });
  return members.map((m) => {
    const tour = solveTour(m, dist, { maxStarts: 6 });
    return { order: rotateToStart(tour.order, dist), length: tour.length };
  });
}
```

Create `src/solver/worker.ts`:

```ts
import { solve, type SolveProblem } from './solve';

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: SolveProblem }) => void) | null;
};

ctx.onmessage = (e) => {
  const solution = solve(e.data, (iter, best) => ctx.postMessage({ type: 'progress', iter, best }));
  ctx.postMessage({ type: 'done', solution });
};
```

Create `src/ui/solveClient.ts`:

```ts
import type { SolveProblem, Solution } from '../solver/solve';

export function runSolve(
  problem: SolveProblem,
  onProgress?: (iter: number, best: number) => void,
): Promise<Solution> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as
        | { type: 'progress'; iter: number; best: number }
        | { type: 'done'; solution: Solution };
      if (m.type === 'progress') {
        onProgress?.(m.iter, m.best);
      } else {
        worker.terminate();
        resolve(m.solution);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'solver worker failed'));
    };
    worker.postMessage(problem);
  });
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: PASS (all 7 tests). If the `feasible`/tolerance assertions fail, check that `seedPartition` returned a feasible split (Task 7 tests) before touching the annealer.

Run: `npx tsc --noEmit`
Expected: no errors (this type-checks the worker and `solveClient.ts`, which have no unit tests).

Run: `npx vitest run`
Expected: PASS for the whole suite.

- [ ] **Step 5: Commit**

```bash
git add src/solver/anneal.ts src/solver/solve.ts src/solver/worker.ts src/ui/solveClient.ts tests/pipeline.test.ts
git commit -m "feat: simulated-annealing optimizer, solve entry point, worker and client"
```
### Task 9: Solve wiring, overlays and stats panel

**Files:**
- Create: `src/ui/groups.ts`, `src/ui/overlays.ts`, `src/app.ts`, `scripts/make-synthetic.ts`
- Modify: `src/main.ts`, `index.html`, `src/style.css`
- Test: `tests/groups.test.ts`

**Interfaces:**
- Consumes: `Store` (`state`, `subscribe`, `update`, `undo`, `redo`, `replace`) from `src/state.ts`; `Model`, `buildModel(houses, osm, crossingPenalty)` from `src/model.ts`; `routeGroups(distMatrix, houseCount, assign, groups): Tour[]`, `SolveProblem` from `src/solver/solve.ts`; `runSolve(problem, onProgress: (iter: number, best: number) => void): Promise<Solution>` from `src/ui/solveClient.ts`; `groupStats(sizes, lengths, {walkSpeed, secPerHouse}): GroupStat[]` from `src/stats.ts`; `Segment.key`, `Graph.segments`, `Snap.segment` from the graph modules; `createMap` result `{ map, drawn }`.
- Produces:
  - `GROUP_COLORS: string[]` (12), `colorOf(group: number): string` (grey `#888888` for `< 0`), `renderPanel(el: HTMLElement, stats: GroupStat[], mean: number, tolerance: number, warnings: string[]): void` in `src/ui/groups.ts`.
  - `OverlayHandlers { onSegment?(segmentId: number, at: L.LatLng): void }` and `class Overlays { constructor(map: L.Map); render(m: Model, assign: number[], tours: Tour[], lockedKeys: Set<string>, h: OverlayHandlers): void; clear(): void }` in `src/ui/overlays.ts`.
  - `AppView { model: Model | null; houses: House[]; assign: number[]; tours: Tour[] }` and `initApp(ctx: { store: Store; map: L.Map }): { getView(): AppView }` in `src/app.ts`.
  - DOM ids this task owns: `#groups`, `#solve`, `#reopt`, `#undo`, `#redo`, `#export-csv`, `#export-print`, `#status`, `#panel`, `#print-root`. (`#load-input` and the save/fetch/draw controls come from earlier parts.)

- [ ] **Step 1: Write the failing test for the pure colour helper**

```ts
// tests/groups.test.ts
import { describe, expect, it } from 'vitest';
import { GROUP_COLORS, colorOf } from '../src/ui/groups';

describe('colorOf', () => {
  it('has 12 distinct colours', () => {
    expect(GROUP_COLORS).toHaveLength(12);
    expect(new Set(GROUP_COLORS).size).toBe(12);
  });
  it('wraps past the palette and greys out unassigned', () => {
    expect(colorOf(0)).toBe(GROUP_COLORS[0]);
    expect(colorOf(12)).toBe(GROUP_COLORS[0]);
    expect(colorOf(-1)).toBe('#888888');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/groups.test.ts`
Expected: FAIL — cannot resolve `../src/ui/groups`.

- [ ] **Step 3: Write `src/ui/groups.ts`**

```ts
// src/ui/groups.ts
import type { GroupStat } from '../stats';

export const GROUP_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
  '#f032e6', '#9a6324', '#008080', '#808000', '#000075', '#e6b800',
];

export function colorOf(group: number): string {
  return group >= 0 ? GROUP_COLORS[group % GROUP_COLORS.length] : '#888888';
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderPanel(
  el: HTMLElement,
  stats: GroupStat[],
  mean: number,
  tolerance: number,
  warnings: string[],
): void {
  const rows = stats
    .map((s) => {
      const off = Math.abs(s.delta) > tolerance;
      const delta = (s.delta > 0 ? '+' : '') + s.delta.toFixed(1);
      return (
        `<div class="group-row" data-group="${s.group}" data-houses="${s.houses}" data-length="${Math.round(s.length)}">` +
        `<span class="chip" style="background:${colorOf(s.group)}"></span>` +
        `<b>Group ${s.group + 1}</b>` +
        `<span>${s.houses} houses</span>` +
        `<span>${(s.length / 1609.344).toFixed(2)} mi</span>` +
        `<span>${Math.round(s.minutes)} min</span>` +
        `<span class="delta${off ? ' bad' : ''}" title="difference from mean ${mean.toFixed(1)}">${delta}</span>` +
        `</div>`
      );
    })
    .join('');
  const warn = warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');
  el.innerHTML = warn + rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/groups.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `src/ui/overlays.ts`**

```ts
// src/ui/overlays.ts
import L from 'leaflet';
import type { Tour } from '../types';
import type { Model } from '../model';
import { colorOf } from './groups';

export interface OverlayHandlers {
  onSegment?(segmentId: number, at: L.LatLng): void;
}

export class Overlays {
  private segs = L.layerGroup();
  private tours = L.layerGroup();
  private dots = L.layerGroup();

  constructor(map: L.Map) {
    this.segs.addTo(map);
    this.tours.addTo(map);
    this.dots.addTo(map);
  }

  clear(): void {
    this.segs.clearLayers();
    this.tours.clearLayers();
    this.dots.clearLayers();
  }

  render(m: Model, assign: number[], tours: Tour[], lockedKeys: Set<string>, h: OverlayHandlers): void {
    this.clear();

    // Majority group per street segment.
    const votes = new Map<number, Map<number, number>>();
    m.snaps.forEach((sn, i) => {
      const v = votes.get(sn.segment) ?? new Map<number, number>();
      v.set(assign[i], (v.get(assign[i]) ?? 0) + 1);
      votes.set(sn.segment, v);
    });

    for (const seg of m.graph.segments) {
      const v = votes.get(seg.id);
      if (!v) continue; // segments without houses are not interactive
      let group = -1;
      let top = 0;
      for (const [g, c] of v) if (g >= 0 && c > top) { top = c; group = g; }
      const locked = lockedKeys.has(seg.key);
      const lines = seg.edgeIds.map((id) => {
        const e = m.graph.edges[id];
        const a = m.graph.coords[e.a];
        const b = m.graph.coords[e.b];
        return [[a.lat, a.lon], [b.lat, b.lon]] as L.LatLngTuple[];
      });
      const line = L.polyline(lines, {
        color: colorOf(group),
        weight: locked ? 8 : 6,
        opacity: locked ? 0.9 : 0.45,
        dashArray: locked ? '4 6' : undefined,
      });
      line.on('click', (ev: L.LeafletMouseEvent) => h.onSegment?.(seg.id, ev.latlng));
      line.addTo(this.segs);
    }

    m.houses.forEach((house, i) => {
      L.circleMarker([house.lat, house.lon], {
        radius: 4,
        color: '#ffffff',
        weight: 1,
        fillColor: colorOf(assign[i]),
        fillOpacity: 1,
        interactive: true,
      })
        .bindTooltip(house.label)
        .addTo(this.dots);
    });

    tours.forEach((t, g) => {
      if (t.order.length === 0) return;
      const pts = t.order.map((idx) => [m.houses[idx].lat, m.houses[idx].lon] as L.LatLngTuple);
      L.polyline([...pts, pts[0]], { color: colorOf(g), weight: 2, dashArray: '6 6', opacity: 0.9, interactive: false }).addTo(this.tours);
      L.circleMarker(pts[0], { radius: 8, color: '#000', weight: 2, fillColor: colorOf(g), fillOpacity: 1 })
        .bindTooltip(`Group ${g + 1} start`)
        .addTo(this.tours);
    });
  }
}
```

- [ ] **Step 6: Write `src/app.ts`**

The loop drawn on the map is a straight-line sketch through the stops in tour order, not the exact street path.

```ts
// src/app.ts
import type L from 'leaflet';
import type { Store } from './state';
import type { House, Tour } from './types';
import { buildModel, type Model } from './model';
import { routeGroups, type SolveProblem } from './solver/solve';
import { runSolve } from './ui/solveClient';
import { groupStats } from './stats';
import { Overlays, type OverlayHandlers } from './ui/overlays';
import { renderPanel } from './ui/groups';

export interface AppView {
  model: Model | null;
  houses: House[];
  assign: number[];
  tours: Tour[];
}

export function initApp(ctx: { store: Store; map: L.Map }): { getView(): AppView } {
  const { store, map } = ctx;
  const overlays = new Overlays(map);
  let model: Model | null = null;
  let modelKey = '';
  let visible: House[] = [];
  let tours: Tour[] = [];

  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const status = (t: string) => { $('status').textContent = t; };

  function visibleHouses(): House[] {
    const removed = new Set(store.state.removed);
    return store.state.houses.filter((h) => !removed.has(h.id));
  }

  function assignIdx(): number[] {
    return visible.map((h) => store.state.assignment[h.id] ?? -1);
  }

  function prepareAssignments(): number[] { return assignIdx(); }

  function modelKeyOf(): string {
    const s = store.state;
    return s.houses.map((h) => h.id).join(',') + '|' + s.removed.join(',') + '|' + s.config.crossingPenalty + '|' + (s.osm ? s.osm.ways.length : 0);
  }

  function ensureModel(): void {
    const key = modelKeyOf();
    if (key === modelKey) return;
    modelKey = key;
    const s = store.state;
    visible = visibleHouses();
    model = s.osm && visible.length > 0 ? buildModel(visible, s.osm, s.config.crossingPenalty) : null;
    if (model) status(`Loaded: ${visible.length} houses`);
  }

  function refresh(): void {
    const s = store.state;
    ensureModel();
    ($('groups') as HTMLInputElement).value = String(s.config.groups);
    const a = prepareAssignments();
    const groups = s.config.groups;
    // Tours are always recomputed here (main thread) so the display is identical after a solve and after a manual edit.
    tours = model && a.length > 0 && a.every((g) => g >= 0 && g < groups)
      ? routeGroups(model.dist, visible.length, a, groups)
      : [];
    draw(a);
  }

  function draw(a: number[]): void {
    const s = store.state;
    const tol = s.config.weights.tolerance;
    if (!model) {
      overlays.clear();
      renderPanel($('panel'), [], 0, tol, []);
      return;
    }
    const handlers: OverlayHandlers = {};
    overlays.render(model, a, tours, new Set(s.locked), handlers);

    const groups = s.config.groups;
    const sizes: number[] = Array(groups).fill(0);
    a.forEach((g) => { if (g >= 0 && g < groups) sizes[g]++; });
    const lengths = Array.from({ length: groups }, (_, g) => tours[g]?.length ?? 0);
    const stats = tours.length > 0 ? groupStats(sizes, lengths, s.config) : [];

    const warnings: string[] = [];
    if (model.disconnected.length > 0) {
      warnings.push(`${model.disconnected.length} houses are not connected to the main street network (creek/pond gap?).`);
    }
    const flagged = visible.filter((h) => h.flagged).length;
    if (flagged > 0) warnings.push(`${flagged} buildings have no address — review them on the map.`);
    renderPanel($('panel'), stats, visible.length / groups, tol, warnings);
  }

  async function solveNow(fresh: boolean): Promise<void> {
    const m = model;
    if (!m) { status('Load or fetch houses first'); return; }
    const s = store.state;
    const houses = visible;
    const a = assignIdx();
    const usable = !fresh && a.every((g) => g >= 0 && g < s.config.groups);
    const lockedKeys = new Set(s.locked);
    const problem: SolveProblem = {
      distMatrix: m.dist,
      houseCount: houses.length,
      groups: s.config.groups,
      segmentOf: m.segmentOf,
      xy: m.xy,
      weights: s.config.weights,
      seed: s.config.seed,
      iterations: s.config.iterations,
      initial: usable ? a : undefined,
      locked: usable ? m.snaps.map((sn) => lockedKeys.has(m.graph.segments[sn.segment].key)) : undefined,
    };
    ($('solve') as HTMLButtonElement).disabled = true;
    ($('reopt') as HTMLButtonElement).disabled = true;
    status('Solving…');
    try {
      const sol = await runSolve(problem, (iter) => status(`Solving… ${iter}/${s.config.iterations}`));
      store.update((st) => {
        houses.forEach((h, i) => { st.assignment[h.id] = sol.assign[i]; });
      });
      status(sol.feasible ? 'Done' : 'Done (could not reach ±tolerance — adjust manually)');
    } catch (e) {
      status('Solve failed: ' + (e as Error).message);
    } finally {
      ($('solve') as HTMLButtonElement).disabled = false;
      ($('reopt') as HTMLButtonElement).disabled = false;
    }
  }

  $('solve').addEventListener('click', () => void solveNow(true));
  $('reopt').addEventListener('click', () => void solveNow(false));
  $('groups').addEventListener('change', (ev) => {
    const n = Math.max(2, Math.min(12, Number((ev.target as HTMLInputElement).value) || 6));
    store.update((st) => { st.config.groups = n; }, { undoable: false });
  });

  store.subscribe(refresh);
  refresh();

  return { getView: () => ({ model, houses: visible, assign: assignIdx(), tours }) };
}
```

- [ ] **Step 7: Add the synthetic-project generator script**

```ts
// scripts/make-synthetic.ts
import fs from 'node:fs';
import { syntheticGrid } from '../tests/fixtures/synthetic';
import { emptyState } from '../src/state';
import { serializeProject } from '../src/project';

const { osm, houses } = syntheticGrid(5, 5, 3);
const s = emptyState();
s.osm = osm;
s.houses = houses;
s.config.groups = 4;
s.config.iterations = 400;
fs.writeFileSync(process.argv[2] ?? 'synthetic-project.json', serializeProject(s));
console.log(`wrote ${houses.length} houses`);
```

- [ ] **Step 8: Add missing toolbar elements to `index.html` and wire `main.ts`**

Run: `grep -n 'id="' index.html`
Expected: a list of existing ids. Add whichever of these are missing (keep existing markup for `#load-input`, save, draw and fetch controls):

```html
<label>Groups <input id="groups" type="number" min="2" max="12" value="6" /></label>
<button id="solve">Solve</button>
<button id="reopt">Re-optimize</button>
<button id="undo">Undo</button>
<button id="redo">Redo</button>
<button id="export-csv">CSV</button>
<button id="export-print">Print…</button>
<span id="status"></span>
<!-- elsewhere in <body>: -->
<aside id="panel"></aside>
<div id="print-root" hidden></div>
```

In `src/main.ts`, add `import { initApp } from './app';` and, after the store and map exist (adapt the variable names if earlier parts used others), add:

```ts
const app = initApp({ store, map });
```

Append to `src/style.css`:

```css
#panel { padding: 8px; font: 13px system-ui, sans-serif; }
.group-row { display: grid; grid-template-columns: 14px 70px 80px 70px 60px 50px; gap: 6px; align-items: center; padding: 3px 0; }
.chip { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.delta.bad { background: #c62828; color: #fff; border-radius: 8px; padding: 0 6px; text-align: center; }
.warn { background: #fff4e5; border-left: 3px solid #f58231; padding: 4px 6px; margin-bottom: 6px; }
```

- [ ] **Step 9: Type-check and manually verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vite-node scripts/make-synthetic.ts /tmp/synthetic-project.json && npm run dev`
Expected: prints `wrote 120 houses`. In the browser, load `/tmp/synthetic-project.json` through the load control. The status reads `Loaded: 120 houses` and 120 grey dots appear. Click Solve: status counts iterations, then `Done`. The panel shows 4 rows, each 28–32 houses, dots and street lines are coloured by group, and each group has a dashed loop with a start marker. Click Re-optimize; the result stays balanced.

- [ ] **Step 10: Commit**

```bash
git add src/ui/groups.ts src/ui/overlays.ts src/app.ts src/main.ts index.html src/style.css scripts/make-synthetic.ts tests/groups.test.ts
git commit -m "feat: wire solver to map overlays and group stats panel"
```

---

### Task 10: Interactive editing (segment reassign, locks, undo/redo)

**Files:**
- Modify: `src/app.ts`, `src/style.css`

**Interfaces:**
- Consumes: from Task 9, `initApp` internals (`model`, `visible`, `store`, `map`, `status`, `assignIdx`); `Store.update(mut, {undoable?})`, `Store.undo(): boolean`, `Store.redo(): boolean`; `Segment.key`, `Snap.segment`, `Model.dist` (row-major `houseCount × houseCount` `Float32Array`).
- Produces: inside `initApp` — `reassignSegment(segmentId: number, group: number): void`, `toggleLock(segmentId: number): void`, `openSegmentMenu(segmentId: number, at: L.LatLng): void`, and a new-house adoption rule in `prepareAssignments()`. Locks are stored in `state.locked` as `Segment.key` strings and pin segments only against the optimizer; a manual reassign always works.

- [ ] **Step 1: Make new houses adopt the nearest assigned neighbour's group**

Houses added by hand (or restored by undo) have no assignment. Replace the one-line `prepareAssignments` in `src/app.ts`:

Old:
```ts
  function prepareAssignments(): number[] { return assignIdx(); }
```
New:
```ts
  function prepareAssignments(): number[] {
    const s = store.state;
    const groups = s.config.groups;
    const a = assignIdx();
    const valid = (g: number) => g >= 0 && g < groups;
    const anchors = a.map((g, i) => (valid(g) ? i : -1)).filter((i) => i >= 0);
    if (!model || anchors.length === 0 || anchors.length === a.length) return a; // nothing solved yet, or nothing new
    const n = visible.length;
    a.forEach((g, i) => {
      if (valid(g)) return;
      let best = anchors[0];
      let bd = Infinity;
      for (const j of anchors) {
        const d = model!.dist[i * n + j];
        if (d < bd) { bd = d; best = j; }
      }
      a[i] = a[best];
      // Derived default, not a user action: write straight into state so it is not an undo step and does not re-emit.
      s.assignment[visible[i].id] = a[best];
    });
    return a;
  }
```

- [ ] **Step 2: Add the segment menu, reassign, lock and undo/redo wiring**

In `src/app.ts`, change the handlers line:

Old:
```ts
    const handlers: OverlayHandlers = {};
```
New:
```ts
    const handlers: OverlayHandlers = { onSegment: openSegmentMenu };
```

Add `import L from 'leaflet';` in place of `import type L from 'leaflet';` (the popup needs the runtime), and import `colorOf` alongside `renderPanel`:

```ts
import { colorOf, renderPanel } from './ui/groups';
```

Then replace the line `  store.subscribe(refresh);` with:

```ts
  function reassignSegment(segmentId: number, group: number): void {
    const m = model;
    if (!m) return;
    const houses = visible;
    store.update((st) => {
      m.snaps.forEach((sn, i) => {
        if (sn.segment === segmentId) st.assignment[houses[i].id] = group;
      });
    });
    const sizes = Array(store.state.config.groups).fill(0);
    assignIdx().forEach((g) => { if (g >= 0 && g < sizes.length) sizes[g]++;});
    const mean = houses.length / sizes.length;
    const off = sizes.findIndex((n) => Math.abs(n - mean) > store.state.config.weights.tolerance);
    status(off >= 0 ? `Group ${off + 1} is now ${sizes[off]} houses (mean ${mean.toFixed(1)}) — allowed, but unbalanced` : 'Moved');
  }

  function toggleLock(segmentId: number): void {
    const m = model;
    if (!m) return;
    const key = m.graph.segments[segmentId].key;
    store.update((st) => {
      const i = st.locked.indexOf(key);
      if (i >= 0) st.locked.splice(i, 1);
      else st.locked.push(key);
    });
  }

  function openSegmentMenu(segmentId: number, at: L.LatLng): void {
    const m = model;
    if (!m) return;
    const seg = m.graph.segments[segmentId];
    const count = m.snaps.filter((sn) => sn.segment === segmentId).length;
    const box = document.createElement('div');
    box.className = 'seg-menu';
    const title = document.createElement('strong');
    title.textContent = `${seg.street || '(unnamed)'} — ${count} houses`;
    box.append(title);
    for (let g = 0; g < store.state.config.groups; g++) {
      const b = document.createElement('button');
      b.textContent = `Group ${g + 1}`;
      b.style.borderLeft = `10px solid ${colorOf(g)}`;
      b.addEventListener('click', () => { map.closePopup(); reassignSegment(segmentId, g); });
      box.append(b);
    }
    const lock = document.createElement('button');
    lock.textContent = store.state.locked.includes(seg.key) ? 'Unlock (let optimizer move it)' : 'Lock (optimizer keeps it here)';
    lock.addEventListener('click', () => { map.closePopup(); toggleLock(segmentId); });
    box.append(lock);
    L.popup().setLatLng(at).setContent(box).openOn(map);
  }

  $('undo').addEventListener('click', () => { if (!store.undo()) status('Nothing to undo'); });
  $('redo').addEventListener('click', () => { if (!store.redo()) status('Nothing to redo'); });
  window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.key.toLowerCase() !== 'z') return;
    if ((ev.target as HTMLElement).closest('input, textarea')) return;
    ev.preventDefault();
    if (ev.shiftKey) store.redo();
    else store.undo();
  });

  store.subscribe(refresh);
```

Append to `src/style.css`:

```css
.seg-menu { display: flex; flex-direction: column; gap: 4px; min-width: 190px; }
.seg-menu button { text-align: left; cursor: pointer; }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, load `/tmp/synthetic-project.json`, click Solve.
Expected:
1. Click a coloured street line. A popup lists 4 group buttons and a lock button. Choose another group: that street's houses recolour, both affected loops redraw, and the panel counts update immediately. If a group leaves ±2 of the mean its delta badge turns red and the status names it; the move is still applied.
2. Ctrl+Z restores the previous assignment and counts. Ctrl+Shift+Z re-applies it. The Undo and Redo buttons do the same.
3. Lock a street (its line becomes dashed and thicker), change other streets by hand, click Re-optimize. The locked street's houses stay in their group.
4. Remove a house with the Part B control, then add one next to a street of group 2. The new dot takes group 2's colour with no new solve, and the panel total updates.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/style.css
git commit -m "feat: street-level reassignment, locks, undo/redo, new-house adoption"
```

### Task 11: Export (CSV and printable packet)

**Files:**
- Create: `src/export/csv.ts`, `src/export/print.ts`, `src/export/wire.ts`
- Modify: `src/main.ts`, `src/style.css`
- Test: `tests/csv.test.ts`

**Interfaces:**
- Consumes: `AppView` and `initApp(...).getView()` from `src/app.ts`; `Model` (`snaps[i].segment`, `graph.segments[k].street`); `Config`; `groupStats`; `colorOf`; `Store`.
- Produces:
  - `CsvRow { group: number; order: number; address: string; lat: number; lon: number }`, `addressOf(house: House, model: Model, index: number): string`, `buildRows(view: Pick<AppView, 'houses' | 'model' | 'tours'>): CsvRow[]`, `toCsv(rows: CsvRow[]): string` in `src/export/csv.ts`. `group` is 1-based and `order` is the 1-based position in that group's loop.
  - `openPrintView(root: HTMLElement, view: AppView, cfg: Config): Promise<void>` in `src/export/print.ts`. It renders one `.print-page` overview page followed by one `.print-page` per group into `#print-root`.
  - `wireExports(app: { getView(): AppView }, store: Store): void` in `src/export/wire.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/csv.test.ts
import { describe, expect, it } from 'vitest';
import { buildRows, toCsv } from '../src/export/csv';
import type { House } from '../src/types';
import type { Model } from '../src/model';

const house = (id: string, label: string, flagged = false): House => ({
  id, lat: 42, lon: -88, label, street: '', flagged, manual: false,
});

describe('toCsv', () => {
  it('writes a header and quotes commas and quotes', () => {
    const csv = toCsv([{ group: 1, order: 1, address: '12 Main, Apt "B"', lat: 42.1, lon: -88.2 }]);
    expect(csv).toBe('group,order,address,lat,lon\r\n1,1,"12 Main, Apt ""B""",42.1,-88.2\r\n');
  });
});

describe('buildRows', () => {
  const model = {
    snaps: [{ segment: 0 }, { segment: 0 }, { segment: 1 }],
    graph: { segments: [{ street: 'Oak Ln' }, { street: 'Elm St' }] },
  } as unknown as Model;
  const houses = [house('a', '10 Oak Ln'), house('b', '(no address)', true), house('c', '5 Elm St')];

  it('orders each group by tour order and uses the street for unaddressed houses', () => {
    const rows = buildRows({
      houses,
      model,
      tours: [{ order: [1, 0], length: 10 }, { order: [2], length: 0 }],
    });
    expect(rows.map((r) => [r.group, r.order, r.address])).toEqual([
      [1, 1, 'Oak Ln (no address)'],
      [1, 2, '10 Oak Ln'],
      [2, 1, '5 Elm St'],
    ]);
  });

  it('returns no rows before a solve', () => {
    expect(buildRows({ houses, model, tours: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/csv.test.ts`
Expected: FAIL — cannot resolve `../src/export/csv`.

- [ ] **Step 3: Write `src/export/csv.ts`**

```ts
// src/export/csv.ts
import type { House } from '../types';
import type { Model } from '../model';
import type { AppView } from '../app';

export interface CsvRow {
  group: number;
  order: number;
  address: string;
  lat: number;
  lon: number;
}

export function addressOf(house: House, model: Model, index: number): string {
  if (!house.flagged) return house.label;
  const street = house.street || model.graph.segments[model.snaps[index].segment]?.street || 'unnamed street';
  return `${street} (no address)`;
}

export function buildRows(view: Pick<AppView, 'houses' | 'model' | 'tours'>): CsvRow[] {
  const { houses, model, tours } = view;
  if (!model) return [];
  const rows: CsvRow[] = [];
  tours.forEach((t, g) => {
    t.order.forEach((idx, k) => {
      const h = houses[idx];
      rows.push({ group: g + 1, order: k + 1, address: addressOf(h, model, idx), lat: h.lat, lon: h.lon });
    });
  });
  return rows;
}

const quote = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: CsvRow[]): string {
  const lines = ['group,order,address,lat,lon', ...rows.map((r) => [r.group, r.order, r.address, r.lat, r.lon].map(quote).join(','))];
  return lines.join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/csv.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `src/export/print.ts`**

```ts
// src/export/print.ts
import L from 'leaflet';
import type { AppView } from '../app';
import type { Config } from '../types';
import { groupStats } from '../stats';
import { colorOf } from '../ui/groups';
import { addressOf } from './csv';

const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const fmtDist = (m: number) => `${(m / 1609.344).toFixed(2)} mi (${Math.round(m)} m)`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Fit the map, then add the satellite layer so its tiles load; resolves on 'load' or after 8 s. */
function mountMap(div: HTMLElement, bounds: L.LatLngBounds): { map: L.Map; ready: Promise<void> } {
  const map = L.map(div, { zoomControl: false, attributionControl: false, preferCanvas: true, zoomSnap: 0.25 });
  map.fitBounds(bounds.pad(0.15));
  const tiles = L.tileLayer(SAT, { maxZoom: 19, crossOrigin: true });
  const ready = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 8000);
    tiles.once('load', () => { clearTimeout(timer); resolve(); });
  });
  tiles.addTo(map);
  return { map, ready };
}

function table(rows: string[][], header: string[]): HTMLTableElement {
  const t = h('table', 'print-table');
  const head = t.createTHead().insertRow();
  header.forEach((c) => head.append(Object.assign(document.createElement('th'), { textContent: c })));
  const body = t.createTBody();
  rows.forEach((r) => {
    const tr = body.insertRow();
    r.forEach((c) => (tr.insertCell().textContent = c));
  });
  return t;
}

export async function openPrintView(root: HTMLElement, view: AppView, cfg: Config): Promise<void> {
  const { model, houses, assign, tours } = view;
  if (!model || tours.length === 0) throw new Error('Solve first');
  root.replaceChildren();
  root.hidden = false;

  const bar = h('div', 'print-bar');
  const printBtn = h('button', undefined, 'Loading map tiles…');
  printBtn.disabled = true;
  printBtn.addEventListener('click', () => window.print());
  const closeBtn = h('button', undefined, 'Close');
  closeBtn.addEventListener('click', () => { root.hidden = true; root.replaceChildren(); });
  bar.append(printBtn, closeBtn);
  root.append(bar);

  const groups = tours.length;
  const sizes = tours.map((t) => t.order.length);
  const stats = groupStats(sizes, tours.map((t) => t.length), cfg);
  const ready: Promise<void>[] = [];
  const latlng = (i: number) => [houses[i].lat, houses[i].lon] as L.LatLngTuple;

  // Page 1: overview map + legend table.
  const overview = h('section', 'print-page');
  overview.append(h('h2', undefined, 'Bag handout — overview'));
  const overviewMap = h('div', 'print-map');
  overview.append(overviewMap);
  overview.append(
    table(
      stats.map((s) => [`Group ${s.group + 1}`, String(s.houses), fmtDist(s.length), `${Math.round(s.minutes)} min`]),
      ['Group', 'Houses', 'Loop', 'Est. time'],
    ),
  );
  root.append(overview);
  const om = mountMap(overviewMap, L.latLngBounds(houses.map((_, i) => latlng(i))));
  ready.push(om.ready);
  houses.forEach((_, i) => {
    L.circleMarker(latlng(i), { radius: 3, color: '#fff', weight: 1, fillColor: colorOf(assign[i]), fillOpacity: 1 }).addTo(om.map);
  });
  tours.forEach((t, g) => {
    if (t.order.length === 0) return;
    const pts = t.order.map(latlng);
    L.polyline([...pts, pts[0]], { color: colorOf(g), weight: 2, dashArray: '5 5' }).addTo(om.map);
  });

  // One page per group.
  for (let g = 0; g < groups; g++) {
    const t = tours[g];
    const page = h('section', 'print-page');
    const s = stats[g];
    page.append(h('h2', undefined, `Group ${g + 1} — ${s.houses} houses`));
    page.append(h('p', undefined, `Loop ${fmtDist(s.length)}, about ${Math.round(s.minutes)} min. Start at stop 1 and follow the numbers.`));
    if (t.order.length === 0) {
      page.append(h('p', undefined, 'No houses assigned.'));
      root.append(page);
      continue;
    }
    const mapDiv = h('div', 'print-map');
    page.append(mapDiv);
    const list = h('ol', 'stops');
    t.order.forEach((idx) => list.append(h('li', undefined, addressOf(houses[idx], model, idx))));
    page.append(list);
    root.append(page);

    const pts = t.order.map(latlng);
    const gm = mountMap(mapDiv, L.latLngBounds(pts));
    ready.push(gm.ready);
    L.polyline([...pts, pts[0]], { color: colorOf(g), weight: 3, dashArray: '6 6' }).addTo(gm.map);
    t.order.forEach((idx, k) => {
      const icon = L.divIcon({
        className: 'stop-icon',
        html: `<div class="stop${k === 0 ? ' start' : ''}" style="background:${colorOf(g)}">${k + 1}</div>`,
        iconSize: [20, 20],
      });
      L.marker(latlng(idx), { icon, interactive: false }).addTo(gm.map);
    });
  }

  await Promise.all(ready);
  printBtn.textContent = 'Print / Save as PDF';
  printBtn.disabled = false;
}
```

- [ ] **Step 6: Write `src/export/wire.ts`**

```ts
// src/export/wire.ts
import type { AppView } from '../app';
import type { Store } from '../state';
import { buildRows, toCsv } from './csv';
import { openPrintView } from './print';

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function wireExports(app: { getView(): AppView }, store: Store): void {
  const status = (t: string) => { document.getElementById('status')!.textContent = t; };

  document.getElementById('export-csv')!.addEventListener('click', () => {
    const view = app.getView();
    const rows = buildRows(view);
    if (rows.length === 0) { status('Solve first, then export'); return; }
    download('bag-handout-groups.csv', toCsv(rows), 'text/csv');
  });

  document.getElementById('export-print')!.addEventListener('click', async () => {
    const view = app.getView();
    if (!view.model || view.tours.length === 0) { status('Solve first, then export'); return; }
    status('Preparing print view…');
    try {
      await openPrintView(document.getElementById('print-root')!, view, store.state.config);
      status('Print view ready');
    } catch (e) {
      status('Print view failed: ' + (e as Error).message);
    }
  });
}
```

- [ ] **Step 7: Wire it in `src/main.ts` and add print CSS**

In `src/main.ts` add `import { wireExports } from './export/wire';` and directly after `const app = initApp({ store, map });` add:

```ts
wireExports(app, store);
```

Append to `src/style.css`:

```css
#print-root { position: fixed; inset: 0; background: #fff; color: #000; overflow: auto; z-index: 10000; padding: 16px; }
#print-root[hidden] { display: none; }
.print-bar { position: sticky; top: 0; background: #fff; padding: 8px 0; display: flex; gap: 8px; z-index: 1; }
.print-page { max-width: 8in; margin: 0 auto 24px; padding: 0.3in; border: 1px solid #ccc; background: #fff; }
.print-map { height: 4.6in; width: 100%; }
.print-table { border-collapse: collapse; margin-top: 8px; width: 100%; font-size: 10pt; }
.print-table th, .print-table td { border: 1px solid #999; padding: 2px 6px; text-align: left; }
.stops { column-count: 3; font-size: 9pt; margin: 8px 0 0; padding-left: 1.4em; }
.stop-icon .stop { width: 20px; height: 20px; border-radius: 50%; color: #fff; font: 700 10px/20px system-ui, sans-serif; text-align: center; border: 2px solid #fff; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.stop-icon .stop.start { border-color: #000; }
@media print {
  body > *:not(#print-root) { display: none !important; }
  #print-root { position: static; overflow: visible; padding: 0; }
  .print-bar { display: none; }
  .print-page { border: 0; margin: 0; padding: 0; page-break-after: always; break-after: page; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
```

- [ ] **Step 8: Type-check and manually verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run dev`, load `/tmp/synthetic-project.json`, Solve.
Expected:
1. CSV opens a download `bag-handout-groups.csv` with 120 data rows plus the header. Rows for group 1 are numbered 1..N in loop order and no address field breaks the columns.
2. Print… opens a full-screen white view: page 1 is the overview with a legend table, then 4 group pages, each with a map, numbered stops, a start marker with a black ring, and an address list. The button changes from `Loading map tiles…` to `Print / Save as PDF` (after at most 8 s if tiles are slow).
3. Ctrl+P (or the button) shows the print preview with one group per page and no toolbar or map controls. Close hides the overlay.

- [ ] **Step 9: Commit**

```bash
git add src/export/csv.ts src/export/print.ts src/export/wire.ts src/main.ts src/style.css tests/csv.test.ts
git commit -m "feat: CSV export and printable per-group packet"
```

### Task 12: End-to-end smoke test, real-area acceptance, README

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `syntheticGrid(rows, cols, perEdge)` from `tests/fixtures/synthetic.ts`; `emptyState()` from `src/state.ts`; `serializeProject(state)` from `src/project.ts`; DOM ids `#load-input`, `#status`, `#solve`, `#groups`, `.group-row[data-houses]`, `#export-print`, `.print-page`.
- Produces: `npm run e2e` (Playwright, chromium against `vite` on port 4173) and the written yearly workflow in `README.md`.

- [ ] **Step 1: Install the browser and confirm the scripts exist**

Run: `npx playwright install chromium && grep -n '"e2e"\|"test"\|"dev"\|"build"' package.json`
Expected: chromium downloads; `package.json` lists `dev`, `build`, `test` and `e2e` (`playwright test`). If `e2e` is missing, run `npm pkg set scripts.e2e="playwright test"`.

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx vite --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Write the smoke test**

```ts
// e2e/smoke.spec.ts
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syntheticGrid } from '../tests/fixtures/synthetic';
import { emptyState } from '../src/state';
import { serializeProject } from '../src/project';

test('load synthetic project, solve into 4 balanced groups, open print view', async ({ page }) => {
  const { osm, houses } = syntheticGrid(5, 5, 3);
  expect(houses).toHaveLength(120);
  const s = emptyState();
  s.osm = osm;
  s.houses = houses;
  s.config.groups = 4;
  s.config.iterations = 400;
  const file = path.join(os.tmpdir(), 'synthetic-project.json');
  fs.writeFileSync(file, serializeProject(s));

  await page.goto('/');
  await page.setInputFiles('#load-input', file);
  await expect(page.locator('#status')).toContainText('120 houses');
  await expect(page.locator('#groups')).toHaveValue('4');

  await page.click('#solve');
  await expect(page.locator('#status')).toContainText('Done', { timeout: 60_000 });

  const rows = page.locator('.group-row');
  await expect(rows).toHaveCount(4);
  const counts = await rows.evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.houses)));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(120);
  for (const c of counts) expect(Math.abs(c - 30)).toBeLessThanOrEqual(2);

  await page.click('#export-print');
  await expect(page.locator('.print-page')).toHaveCount(5); // overview + 4 groups
});
```

- [ ] **Step 4: Run it**

Run: `npm run e2e`
Expected: 1 passed. If the status text differs from `Loaded: 120 houses` or `Done`, fix the app text rather than the test, since both strings are specified in Task 9. If the print pages never appear, check the browser has network access to the Esri tile host; the view still opens after the 8 s tile timeout.

- [ ] **Step 5: Ignore Playwright output and commit**

Append to `.gitignore`:

```
test-results/
playwright-report/
```

```bash
git add playwright.config.ts e2e/smoke.spec.ts .gitignore
git commit -m "test: playwright smoke test for load, solve and print view"
```

- [ ] **Step 6: Real-area acceptance runbook (Mill Creek)**

Run: `npm run dev`. This is a manual check; record results in the commit message of Step 8.

1. Draw the boundary. Zoom to Mill Creek, Geneva IL, and draw a polygon around the residential streets (Preston Cir, Branford Ln, Brannon Ln, Grengs Ln, Ellithorp Ln, McNair Dr, S Mill Creek Dr, W Haladay Ln, E Mallory Dr, W/E Burnham Ln and the streets south of them). Keep the polygon **south of Hughes Rd and Fabyan Pkwy**, and leave the road itself outside the polygon. Compare with `Screenshot From 2026-09-19 15-08-02.png`.
2. Fetch houses. The status shows a house count. Expected order of magnitude: several hundred.
3. Verify the count against the satellite. Pick three streets (Preston Cir, Branford Ln, Grengs Ln), count roofs by eye on the satellite layer and compare with the dots on those streets. Target: within about 5%. Fix gaps with the add-house control and remove false positives (garages, sheds, the pool building).
4. Review flagged houses. The panel warns about buildings with no address. Click each flagged dot and decide whether it is a house; remove the ones that are not.
5. Check disconnected warnings. The panel should not report houses cut off from the street network. If it does (typically across the creek or pond), inspect the snapped street; add the missing footway in the polygon or remove the house.
6. Solve for each plausible den size: set Groups to 6, 8 and 10 and click Solve. For each result check: group sizes within ±2 of the mean, each group's dashed loop is one connected area, and the longest loop is not much longer than the others.
7. Tune. If loops are too long or straddle streets, adjust `crossingPenalty`, the `weights` (`maxRoute`, `total`) and `secPerHouse` in the project's config, then re-solve. Change one value at a time and note the effect.
8. Hand-tune. Click street segments to move them; confirm live counts, then lock the streets you are happy with and Re-optimize.
9. Print. Open Print…, check the overview and two group pages, then Save as PDF and confirm the pages are legible with numbered stops and address lists.
10. Save the project (JSON) so next year starts from it.

- [ ] **Step 7: Write `README.md`**

````markdown
# Bag Handout Route Planner

Splits a neighborhood into equal-house-count groups with short closed walking loops, for a Cub Scout food-drive bag handout. Runs entirely in the browser.

## Yearly workflow

1. `npm install && npm run dev` and open the printed URL (or open a built copy from `dist/`).
2. Load last year's project JSON, or draw a boundary polygon on the map.
3. Fetch houses (OpenStreetMap). Check the house count against the satellite view; add or remove houses by clicking.
4. Set the number of groups (usually the number of den members) and click **Solve**.
5. Adjust: click a street to move it to another group or lock it, then **Re-optimize**. Undo with Ctrl+Z.
6. Export: **Print…** for the packet (save as PDF), **CSV** for a spreadsheet, and save the project JSON.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | type-check and build static files to `dist/` |
| `npm test` | unit tests (Vitest) |
| `npm run e2e` | Playwright smoke test (needs `npx playwright install chromium` once) |
| `npx vite-node scripts/make-synthetic.ts out.json` | write a synthetic 120-house project for demos |

## How it splits

House locations and streets come from OpenStreetMap. Houses are clustered into balanced groups, each group gets a closed-loop walking route (nearest neighbour then 2-opt/Or-opt), and simulated annealing moves houses between groups. Group sizes must stay within ±2 of the mean; among balanced splits it minimizes the longest loop plus 0.3 × total distance. Walking distance follows the street graph, so a pond or creek is not crossed. The loops drawn on the map are straight-line sketches through the stops in order, not the exact street path.

## Data caveats

- OpenStreetMap coverage varies: newer houses can be missing and non-houses can appear. Always compare against the satellite view.
- Buildings with no address are flagged; decide whether each is a house.
- The project file stores the street data and your edits, so a saved project works without network access.

## Usage notes

- Overpass API (`overpass-api.de`, with a mirror fallback) is a shared free service. Results are cached per boundary; avoid repeated re-fetches.
- Satellite tiles come from Esri World Imagery and street tiles from OpenStreetMap, both intended for light use. Printing a packet loads a few dozen tiles.
````

- [ ] **Step 8: Run everything and commit**

Run: `npm test && npm run build && npm run e2e`
Expected: all unit tests pass, the build succeeds, the smoke test passes.

```bash
git add README.md
git commit -m "docs: README with yearly workflow; real-area acceptance notes"
```

---

## Self-Review

**Spec coverage.** Task numbers for Tasks 1–8 follow the part layout (A: 1–2 scaffold/map/state; B: 3 data, 4 graph, 5 snap/oracle/model; C: 6 tsp/cost, 7 seed, 8 anneal/solve/worker). Confirm against the assembled plan.

| Spec section | Task(s) |
|---|---|
| Stack (Vite, TS, Leaflet, Vitest, Playwright, Worker) | 1, 8, 12 |
| Boundary draw + GeoJSON save/load | 2 |
| Data: Overpass query, parse, dedupe, cache, manual add/remove | 3 (edit UI), 10 (adoption of new houses) |
| Graph: build, snap, segments, Dijkstra, crossing penalty, components | 4, 5 |
| Solver: seed, TSP, cost, anneal, contiguity guard, worker | 6, 7, 8 |
| UI: map, overlays, side panel, stats, warnings | 9 |
| Street reassignment, locks, re-optimize, undo/redo, balance badges | 9 (badges, Re-optimize), 10 |
| Export: print packet, CSV, project JSON | 11 (print, CSV), 2 (project JSON) |
| Verification: unit suite, e2e smoke, real-area acceptance, determinism | 6–8 (unit, determinism), 12 |
| README / yearly workflow | 12 |

**Placeholder scan.** No `TBD`/`TODO` or "similar to Task N" steps in Tasks 9–12. Task 10 edits use exact old/new blocks anchored on lines written in Task 9 (`prepareAssignments`, `const handlers: OverlayHandlers = {};`, `store.subscribe(refresh);`).

**Type consistency.**
- `AppView` fields (`model`, `houses`, `assign`, `tours`) are the same in `app.ts`, `csv.ts`, `print.ts` and `wire.ts`.
- `renderPanel(el, stats, mean, tolerance, warnings)` is called with that argument order in `app.ts`.
- `groupStats(sizes, lengths, cfg)` is passed the full `Config` (it only reads `walkSpeed` and `secPerHouse`).
- `runSolve(problem, onProgress(iter, best))` — Task 9 uses only `iter`; confirm Part C's callback signature.
- `Segment.key` is the lock identifier everywhere (`state.locked`, `Overlays`, `solveNow`).
- `Model.dist` is indexed `i * houseCount + j`, matching `matrixDist` in the solver.
- `#load-input` is created by an earlier part; Task 12 fails fast if it is missing.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-19-bag-handout.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task and review between tasks, for fast iteration.

**2. Inline Execution** — I execute the tasks in this session using executing-plans, in batches with checkpoints for review.

Which approach?
