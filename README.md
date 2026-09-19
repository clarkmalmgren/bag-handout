# Bag Handout Route Planner

Splits a neighborhood into equal-house-count groups, each with a short closed walking loop, for a Cub Scout food-drive bag handout. It is a static page (Vite + strict TypeScript + Leaflet) and runs entirely in the browser; there is no server.

## Yearly workflow

1. `npm install && npm run dev` and open the printed URL (or serve a built copy from `dist/` after `npm run build`).
2. Either **Load project** (last year's saved JSON) or draw a boundary polygon on the map with the polygon tool. Keep the polygon on the residential streets and leave the busy through-roads outside it.
3. **Fetch houses** (houses from Kane County parcels, roads from OpenStreetMap via Overpass; if any assignment exists you are asked to confirm, since a fetch clears assignments and Undo restores them; **Re-fetch (ignore cache)** bypasses the browser cache). Check the house count against the satellite layer. Click a dot and choose **Remove** to delete a false positive; use **Add house** and click the map to add a missing one.
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

The e2e test needs a Chromium that Playwright can find (`npx playwright install chromium` once). To use an already-installed browser instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path, for example `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome-headless-shell npm run e2e`. The test loads a synthetic project, so it does not need Overpass; map tiles are optional to it.

## How it splits

Streets come from OpenStreetMap; houses come from Kane County parcel data when available (OpenStreetMap buildings are the fallback). Each house is snapped to the nearest street segment, and walking distances between houses follow the street graph (`crossingPenalty` is the walking-distance penalty in metres for visiting the opposite side of the same street edge; creeks and ponds are handled by the walking-graph distances themselves, since houses cut off from the network are blocked, see below, plus the contiguity guard). A starting split is made by clustering house locations into balanced groups. Each group's loop is a nearest-neighbour tour improved with 2-opt and Or-opt. Simulated annealing (in a Web Worker) then moves whole street segments or individual houses between groups. Group sizes must stay within the tolerance (mean plus or minus 2 houses); among balanced splits it minimizes the longest group loop plus 0.3 times the total distance. A contiguity guard rejects any move that would increase a group's number of connected components; "connected" means houses within a hard-coded 150 m link distance, and the starting clustering uses straight-line distance, not walking distance. The random seed is fixed in the config, so the same input gives the same result. If the tolerance cannot be met the status says so and you can fix it by hand.

Advanced tuning (`crossingPenalty`, `weights`, `iterations`, `seed`, `secPerHouse`, `walkSpeed`) has no UI; edit the `config` object in the saved project JSON and load it again.

## Data caveats

- House source: Kane County's public parcel layer (Residential Improved Lots with a site address) is preferred; each house is placed at the lot centroid and is never flagged. OpenStreetMap is used for roads, and for houses only as a fallback when the parcel service is empty, unreachable or the boundary is outside Kane County (only Kane County is covered). The status line says which source was used.
- OpenStreetMap coverage varies (this matters mainly for the fallback and for roads): new houses can be missing, and garages, sheds and pool buildings can appear as houses. Always compare with the satellite layer and use Add house / Remove.
- Buildings with no address are still included but flagged: they are drawn with an orange outline and the panel shows a warning count. Decide for each whether it is a house. Unaddressed stops appear in the CSV and print list as "<street> (no address)".
- Houses that cannot be connected to the main street network (for example when the connecting road lies outside the drawn boundary) are drawn with a red ring and reported in the panel. **Solve and Re-optimize are blocked** until they are removed (button **Remove N disconnected houses**, undoable; or remove them one by one in the house popup) or the boundary is fixed.
- The house-to-street snap offset (about 15-20 m from the house to the street centreline) is not added to walking distance. Loop lengths are uniformly under-reported; balance between groups is unaffected.
- A townhome/terrace block with several address nodes inside one building footprint counts as one house, and a `building=yes` without an address is ignored. Compare the house count with the satellite view (workflow step 3) and add houses manually where needed.
- If `addr:street` is spelled differently from the street's `name` in OSM, the house loses its same-street snap preference and may attach to a neighbouring street.
- The annealer tries up to 4 tour starts per group (the original plan said about 10).
- Manually added houses and every house you removed survive a re-fetch (hand-pruned OSM houses stay removed). Houses that lack an assignment (added by hand, or restored by undo) join the nearest assigned house's group until you re-solve.
- A saved project stores the street data, so it opens and re-solves without network access (only map tiles need a connection).

## Usage notes

- The Kane County parcel service (`gistech.countyofkane.org`) is queried with the boundary polygon and results are cached like Overpass results.
- Overpass (`overpass-api.de`, with `overpass.kumi.systems` as fallback) is a shared free service. Fetch results are cached in the browser (IndexedDB) per boundary polygon; avoid repeated re-fetches and keep the boundary small.
- Satellite tiles come from Esri World Imagery and street tiles from OpenStreetMap, both meant for light use. The print view loads satellite tiles for one map per group; its Print button enables when they load or after an 8 second timeout at worst.

## Known limitations

- The dashed loops on the map and in the packet are straight-line sketches through the stops in order, not the exact street path. Distances and minutes are computed from the street graph, so they do not equal the drawn line length.
- Tours are closed loops that start at the marked first stop; they do not model a starting depot, one-way streets or which side of the street to walk.
- Solve and Re-optimize disable their buttons while running, and a result is discarded if the group count, house set, project, assignment, locks or removals change meanwhile (an edit or Undo during a solve therefore discards it).
- Tunable solver settings are JSON-only (see above); the group count is limited to 2 to 12.
- Rendering and printing depend on tiles; offline you still get the lists and loops but a blank map background.

## Real-area acceptance runbook

See [docs/acceptance-runbook.md](docs/acceptance-runbook.md). **This runbook has NOT been executed**: it needs live Overpass access and a person judging the results against satellite imagery. The automated smoke test covers only the synthetic 120-house grid.

## Hosting

Live site: https://clarkmalmgren.github.io/bag-handout/

Pushing to `main` runs `.github/workflows/pages.yml`, which tests, builds and deploys `dist/` to GitHub Pages. In the repository, Settings > Pages > Source must be set to "GitHub Actions". To build for a sub-path locally, run `VITE_BASE=/bag-handout/ npm run build` (the default base is `/`).

## Data and tile attribution

Roads (and fallback houses) come from OpenStreetMap contributors via the Overpass API (ODbL). House locations and addresses come from Kane County GIS parcel data (Kane County, Illinois; public GIS Technologies service). Satellite tiles are Esri World Imagery and street tiles are OpenStreetMap's tile servers; both services have their own usage terms. This app is intended for light, occasional use by a small group. Anyone running it at scale should use their own tile provider and key.

## License

MIT; see [LICENSE.md](LICENSE.md).
