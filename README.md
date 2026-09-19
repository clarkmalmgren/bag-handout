# Bag Handout Route Planner

Splits a neighborhood into equal-house-count groups, each with a short closed walking loop, for a Cub Scout food-drive bag handout. It is a static page (Vite + strict TypeScript + Leaflet) and runs entirely in the browser; there is no server.

## Yearly workflow

1. `npm install && npm run dev` and open the printed URL (or serve a built copy from `dist/` after `npm run build`).
2. Either **Load project** (last year's saved JSON) or draw a boundary polygon on the map with the polygon tool. Keep the polygon on the residential streets and leave the busy through-roads outside it.
3. **Fetch houses** (OpenStreetMap via Overpass). Check the house count against the satellite layer. Click a dot and choose **Remove** to delete a false positive; use **Add house** and click the map to add a missing one.
4. Set **Groups** (1 group per den or per driver team; 2 to 12) and click **Solve**. The side panel lists each group's house count, loop length, estimated minutes, and difference from the mean.
5. Adjust by hand: click a colored street segment, pick a group to move all of that segment's houses there, or lock it. Then **Re-optimize** to let the solver improve everything that is not locked. **Undo** / **Redo** (buttons, or Ctrl+Z / Ctrl+Shift+Z) step through edits.
6. Export: **Print view** opens the packet (an overview page plus one page per group with a map, numbered stops and an address list) with a **Print / Save as PDF** button; **Export CSV** writes group, stop order, address and coordinates; **Save project** downloads the project JSON, which contains the boundary, street data, houses, assignments, locks and config, so next year (or an offline session) starts from it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc --noEmit` then static build into `dist/` |
| `npm test` | unit tests (Vitest; only `tests/**/*.test.ts`) |
| `npm run e2e` | Playwright smoke test (starts `vite` on port 4173) |
| `npx vite-node scripts/make-synthetic.ts out.json` | writes a synthetic 120-house project for demos (see the script header for its usage) |

The e2e test needs a Chromium that Playwright can find (`npx playwright install chromium` once). To use an already-installed browser instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path, for example `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell npm run e2e`. The test loads a synthetic project, so it does not need Overpass; map tiles are optional to it.

## How it splits

Houses and streets come from OpenStreetMap. Each house is snapped to the nearest street segment, and walking distances between houses follow the street graph (crossing an unbridged pond or creek is penalized by `crossingPenalty`, so groups do not straddle them). A starting split is made by clustering house locations into balanced groups. Each group's loop is a nearest-neighbour tour improved with 2-opt and Or-opt. Simulated annealing (in a Web Worker) then moves whole street segments or individual houses between groups. Group sizes must stay within the tolerance (mean plus or minus 2 houses); among balanced splits it minimizes the longest group loop plus 0.3 times the total distance. A guard discourages moves that break a group into disconnected pieces. The random seed is fixed in the config, so the same input gives the same result. If the tolerance cannot be met the status says so and you can fix it by hand.

Advanced tuning (`crossingPenalty`, `weights`, `iterations`, `seed`, `secPerHouse`, `walkSpeed`) has no UI; edit the `config` object in the saved project JSON and load it again.

## Data caveats

- OpenStreetMap coverage varies: new houses can be missing, and garages, sheds and pool buildings can appear as houses. Always compare with the satellite layer and use Add house / Remove.
- Buildings with no address are still included but flagged: they are drawn with an orange outline and the panel shows a warning count. Decide for each whether it is a house. Unaddressed stops appear in the CSV and print list as "<street> (no address)".
- Houses that cannot be connected to the main street network (for example across a creek) are reported in a panel warning.
- Manually added or removed houses survive a re-fetch. Houses that lack an assignment (added by hand, or restored by undo) join the nearest assigned house's group until you re-solve.
- A saved project stores the street data, so it opens and re-solves without network access (only map tiles need a connection).

## Usage notes

- Overpass (`overpass-api.de`, with `overpass.kumi.systems` as fallback) is a shared free service. Fetch results are cached in the browser (IndexedDB) per boundary polygon; avoid repeated re-fetches and keep the boundary small.
- Satellite tiles come from Esri World Imagery and street tiles from OpenStreetMap, both meant for light use. The print view loads satellite tiles for one map per group; its Print button enables when they load or after an 8 second timeout at worst.

## Known limitations

- The dashed loops on the map and in the packet are straight-line sketches through the stops in order, not the exact street path. Distances and minutes are computed from the street graph, so they do not equal the drawn line length.
- Tours are closed loops that start at the marked first stop; they do not model a starting depot, one-way streets or which side of the street to walk.
- Solve and Re-optimize disable their buttons while running, and a result is discarded if the group count, house set or project is replaced meanwhile. Manual edits or Undo during a solve are not guarded: when the solve finishes it overwrites the assignment. Wait for "Done" before editing.
- Tunable solver settings are JSON-only (see above); the group count is limited to 2 to 12.
- Rendering and printing depend on tiles; offline you still get the lists and loops but a blank map background.

## Real-area acceptance runbook

See [docs/acceptance-runbook.md](docs/acceptance-runbook.md). **This runbook has NOT been executed**: it needs live Overpass access and a person judging the results against satellite imagery. The automated smoke test covers only the synthetic 120-house grid.
