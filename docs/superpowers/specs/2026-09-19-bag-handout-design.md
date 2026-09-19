# Bag Handout Route Planner — Design Spec

## Context

The Cub Scout den runs an annual food-drive bag handout. The organizer splits an assigned area (Mill Creek subdivision, Geneva IL; excluding everything on or north of Hughes Rd / Fabyan Pkwy) among den members by hand-counting houses on a satellite view. This is slow and the splits are uneven in walking effort.

Goal: a static, single-page web tool that (1) takes a drawn boundary, (2) pulls house + road data from OpenStreetMap, (3) splits houses into N groups with equal house counts and short, contiguous closed-loop walking routes, (4) lets the organizer hand-tune by reassigning streets with live counts, and (5) exports a printable per-group packet. Reusable next year for any area.

Only file in the folder today: `Screenshot From 2026-09-19 15-08-02.png` (reference imagery of the area). It is not an input to the tool.

## Decisions already made (with user)

| Topic | Decision |
|---|---|
| House data | OpenStreetMap (Overpass), verified against satellite; manual add/remove of houses |
| Runtime | Single static web page, no backend, no install |
| Boundary | Draw polygon on map; save/load as GeoJSON |
| Algorithm | Cluster first, then closed-loop TSP per group, then local-search mutations moving houses/small clusters between groups |
| Route start | Tool chooses each group's own start/end (cheapest loop) |
| Objective | House balance first (hard ±2 of mean), then minimize longest route + 0.3 × total distance |
| Editing | Interactive map; click a street segment to reassign to another group, live counts/lengths |
| Output | Interactive map + printable per-group pages |

## Stack

- Vanilla ES modules + Vite (dev server, build to static `dist/`). TypeScript for the solver modules (pure functions, easy to test).
- Leaflet + Leaflet.draw (boundary), Esri World Imagery tiles (satellite, free for light use) with an OSM street toggle.
- Overpass API via `fetch`, cached in IndexedDB and exportable in the project file.
- Vitest for unit tests; Playwright for one end-to-end smoke test.
- Solver runs in a Web Worker so the UI stays responsive.
- No routing service dependency: Dijkstra on our own graph.

## Repository layout

```
bag-handout/
  index.html
  package.json, vite.config.ts, tsconfig.json
  src/
    main.ts                    # app bootstrap, wires modules
    state.ts                   # single project state + undo stack
    project.ts                 # save/load project JSON (boundary, houses, edits, assignments)
    data/
      overpass.ts              # query builder + fetch + cache
      parse.ts                 # OSM JSON -> houses[] and ways[]
      houses.ts                # dedupe address nodes vs building footprints -> one point/house
    graph/
      build.ts                 # ways -> nodes/edges, split at intersections, edge lengths
      snap.ts                  # snap each house to nearest edge, record side of street
      shortest.ts              # Dijkstra + cached house-to-house distance matrix
      segments.ts              # street segments (intersection to intersection) = unit of manual edit
    solver/
      seed.ts                  # size-capped k-means (or balanced) initial partition
      tsp.ts                   # nearest-neighbor + 2-opt + Or-opt, closed loop, best-start
      cost.ts                  # objective + hard constraint
      anneal.ts                # simulated annealing over house/cluster moves
      worker.ts                # Web Worker entry: run(problem) -> progress + result
    ui/
      map.ts                   # Leaflet setup, layers, boundary drawing
      groups.ts                # group colors, legend, per-group stats panel
      edit.ts                  # click street segment -> reassign; re-solve routes for touched groups
      houseEdit.ts             # add/remove house markers
      controls.ts              # N groups, Solve, weights (config), save/load
    export/
      print.ts                 # print stylesheet + per-group page renderer
      csv.ts                   # per-group address list
  tests/
    fixtures/                  # small hand-made OSM JSON (a cul-de-sac, a loop, a split by water)
    graph.test.ts  tsp.test.ts  cost.test.ts  anneal.test.ts  parse.test.ts
  e2e/smoke.spec.ts
  docs/superpowers/specs/2026-09-19-bag-handout-design.md   # written after plan approval
```

## Module details

### 1. Data (`data/`)
- Overpass query for the polygon: `node/way["addr:housenumber"]`, `way[building~"house|residential|detached|semidetached_house|terrace"]`, plus `way[highway]` excluding `motorway|motorway_link|construction|proposed|abandoned` and `access=private` only when not a subdivision street. Include footways/paths/sidewalks for walkability.
- `houses.ts`: a house = building centroid; if an address node lies inside a footprint, merge them (keep the address). Address nodes without footprints become houses. Buildings without address are kept but flagged (needs a decision; default include residential-tagged, exclude `garage|shed|service|roof`).
- Show total house count immediately on the map; that is the sanity check versus satellite. Missing houses can be added and false ones removed by click; edits persist in the project file.
- Cache keyed by polygon hash.

### 2. Graph (`graph/`)
- Build undirected graph; split ways at shared nodes; edge weight = haversine length in metres.
- Snap each house to nearest edge (projected point); record `edgeId`, position along edge, and side (left/right by cross product). Walking cost: entering a house = distance to snapped point; visiting the opposite side of a street from the previous stop adds a fixed crossing penalty (default 8 m equivalent, configurable). Adjacent houses on the same edge and side cost only their along-edge separation.
- Street segments: maximal chains between intersection nodes (degree ≠ 2), labelled with street name. Each house belongs to one segment. This is the click-to-reassign unit.
- Connected-components check: warn if a house snaps to a component disconnected from the rest (e.g. across the creek).
- Distances: Dijkstra from each house's snap point; store a house-to-house matrix only within a group during solving (avoid an O(H²) global matrix at start; compute lazily and memoize).

### 3. Solver (`solver/`)
- **Seed:** balanced k-means on projected coordinates with cluster size cap `ceil(H/N)`; then reassign entire street segments where a segment is split, to its majority cluster, and repair to within ±2.
- **TSP per group:** treat as closed tour over group houses using graph walking distance. Nearest-neighbor construction from each candidate start (cap to ~10 candidates for speed), then 2-opt and Or-opt until no improvement. Return ordered houses, loop length, start house. Tours are cached per group and invalidated on membership change.
- **Cost:** hard constraint `|size_g − H/N| ≤ 2`. Score = `max(routeLen) + 0.3 × Σ routeLen` (weights in config). Infeasible states are rejected, not penalized, once seeding has repaired them.
- **Anneal:** move types (a) single house to an adjacent group, (b) a same-street contiguous run (≤5 houses or a cul-de-sac) to an adjacent group, (c) swap two boundary houses between groups to hold balance. "Adjacent" = the group owns a house within a small walking distance. After each move, re-solve only the two touched tours with a warm-started 2-opt (reuse old order minus/plus the moved houses, cheapest insertion). Geometric cooling, fixed seed for reproducibility, ~20k iterations default, progress posted to UI.
- **Contiguity guard:** reject moves that leave a group's houses split across disconnected regions (>1 connected component over the road graph within a threshold), so groups stay walkable.
- Runs in `worker.ts`; the main thread receives `{assignments, tours, stats}`.

### 4. UI (`ui/`)
- Top bar: draw boundary / load project / N groups / Solve / weights (advanced) / export.
- Map: satellite base, houses as small dots coloured by group, street segments as coloured polylines, route loops drawn as thin dashed lines with start markers.
- Side panel: per group — colour, house count, loop length, estimated time (distance ÷ 1.2 m/s + 20 s/house, constants configurable), and delta from the mean.
- **Street reassignment:** click a segment → menu of groups → its houses move; the two affected tours re-solve in the worker (fast path, no annealing) and stats update live. Balance violations show as a red badge but are allowed (manual override wins). A "Re-optimize" button re-runs annealing from the current state while pinning segments the user has locked (lock icon).
- Undo/redo for edits.

### 5. Export (`export/`)
- Print view: page 1 overview map with all groups and a legend/table; then one page per group with a zoomed map, numbered stops along the loop, start point, address list (house number + street), house count and distance. Uses a print stylesheet and `window.print()` (Save as PDF). Map screenshots come from Leaflet with tiles rendered at print size.
- CSV: `group,order,address,lat,lon`.
- Project JSON: boundary, houses (with manual edits), assignments, locked segments, config; enables re-load and next-year reuse.

## Build order (milestones, each independently testable)

1. **Scaffold** — Vite + TS + Vitest, Leaflet map with satellite, boundary draw + GeoJSON save/load.
2. **Data** — Overpass query, parse, dedupe, cache; house count + dots on map; add/remove houses. Fixtures for tests.
3. **Graph** — build, snap, segments, Dijkstra; unit tests on fixtures (cul-de-sac, ring road, water-separated component).
4. **Solver core** — seed, TSP (NN + 2-opt + Or-opt), cost; tests for TSP optimality on tiny cases and invariants (all houses assigned exactly once, sizes within ±2).
5. **Anneal + worker** — mutation moves, contiguity guard, progress; tests that cost never worsens vs seed and results are deterministic for a seed.
6. **Interactive editing** — segment click reassign, live stats, locks, undo/redo.
7. **Export** — print pages, CSV, project JSON.
8. **Real-area tuning** — run on Mill Creek, compare house count to satellite, adjust dedupe rules, weights, crossing penalty; write README with the yearly workflow.

## Risks and mitigations

- **OSM gaps / stale data:** compare count to satellite; manual add/remove; project file keeps the corrections.
- **Overpass rate limits/outages:** cache and allow importing a saved response; use a fallback mirror endpoint.
- **Water/creek separation:** graph-based distances prevent groups spanning unwalkable gaps; component warning surfaces disconnected houses (S Mill Creek Dr north/south of the pond is a known trouble spot).
- **Solver time in browser:** Web Worker, incremental tour re-solve, iteration cap; scale (~400–600 houses) is comfortable.
- **Balance vs. contiguity conflicts:** hard ±2 constraint plus contiguity guard may leave no feasible move; fall back to accepting a temporary violation during annealing and require feasibility at the end.
- **Boundary edge cases:** the Hughes/Fabyan exclusion is handled by the drawn polygon; the tool holds no street-specific logic.

## Verification

- `npm test` — Vitest suite (parse, graph, TSP, cost, anneal) green.
- `npm run build` then serve `dist/`; Playwright smoke test: load with a saved boundary + cached Overpass fixture, click Solve for N=6, assert every house is in exactly one group, sizes within ±2, no group disconnected, Export produces N+1 print pages.
- Manual acceptance on the real Mill Creek polygon: total house count within a few percent of a satellite count of a sample of streets (e.g. Preston Cir, Branford Ln, Grengs Ln); visually confirm routes are contiguous loops; reassign one street and confirm live counts update; print preview to PDF and check legibility.
- Determinism: same project + seed yields identical assignments.

## Open items to settle during implementation (with sensible defaults)

- Default N groups: prompt the user (no default); typical den size 6–10.
- Time-estimate constants (1.2 m/s, 20 s/house) — configurable.
- Whether to include unaddressed residential buildings — default include, flagged for review.

After plan approval: write the design spec to `docs/superpowers/specs/2026-09-19-bag-handout-design.md` (per the brainstorming process), then invoke writing-plans for the task-level breakdown.
