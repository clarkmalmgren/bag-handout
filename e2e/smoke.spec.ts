// e2e/smoke.spec.ts
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syntheticGrid } from '../tests/fixtures/synthetic';
import { emptyState } from '../src/state';
import { serializeProject } from '../src/project';
import { buildModel } from '../src/model';
import { solve } from '../src/solver/solve';
import { effectiveTolerance } from '../src/solver/cost';

const groupLengths = (page: Page) =>
  page.locator('.group-row').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.length)));

const groupCounts = (page: Page) =>
  page.locator('.group-row').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.houses)));

test('load synthetic project, solve into 4 balanced groups, edit a street, open print view', async ({ page }) => {
  const { osm, houses } = syntheticGrid(5, 5, 3);
  expect(houses).toHaveLength(120);
  const s = emptyState();
  s.osm = osm;
  s.houses = houses;
  s.config.groups = 4;
  s.config.iterations = 400;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bag-e2e-')), 'synthetic-project.json');
  fs.writeFileSync(file, serializeProject(s));

  page.on('dialog', (d) => void d.accept()); // e.g. the "Fetching replaces all group assignments" confirm

  await page.goto('/');
  await page.setInputFiles('#load-input', file);
  await expect(page.locator('#status')).toContainText('120 houses');
  await expect(page.locator('#groups')).toHaveValue('4');

  await page.click('#solve');
  await expect(page.locator('#status')).toContainText('Done', { timeout: 60_000 });

  await expect(page.locator('.group-row')).toHaveCount(4);
  const counts = await groupCounts(page);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(120);
  const tol = effectiveTolerance(30, s.config.weights); // mean 30, +-10% -> 3
  for (const c of counts) expect(Math.abs(c - 30)).toBeLessThanOrEqual(tol);

  // The panel must show the solver's own tours: repeat the (deterministic) solve in node and compare loop lengths.
  const model = buildModel(houses, osm, s.config.crossingPenalty);
  const sol = solve({
    distMatrix: model.dist, houseCount: houses.length, groups: 4, segmentOf: model.segmentOf, xy: model.xy,
    weights: s.config.weights, seed: s.config.seed, iterations: s.config.iterations,
  });
  const lengths = await groupLengths(page);
  sol.tours.forEach((t, g) => expect(Math.abs(lengths[g] - Math.round(t.length))).toBeLessThanOrEqual(1));

  // Manual edit: click a street segment, move it to a group other than its current majority, then Undo.
  // The map draws on a canvas (no per-street DOM nodes), so click by position. The grid's streets run horizontally
  // near the vertical middle of the map after fitBounds; probe a few y offsets until a street segment menu opens.
  const menu = page.locator('.seg-menu').last();
  const box = (await page.locator('#map').boundingBox())!;
  const cx = box.x + box.width / 2 - 60;
  const cy = box.y + box.height / 2;
  let pt = { x: cx, y: cy };
  for (const dy of [0, -13, 13, -6, 6, -20, 20, -26, 26]) {
    pt = { x: cx, y: cy + dy };
    await page.mouse.click(pt.x, pt.y);
    if (await menu.isVisible()) break;
  }
  await expect(menu).toBeVisible();
  const moved = Number((await menu.locator('strong').innerText()).match(/(\d+) houses/)![1]);
  expect(moved).toBeGreaterThan(0);

  // Choose the group with the smallest count that the segment is not (entirely) in; verify sizes shift by exactly `moved`.
  let changed = false;
  let after: number[] = counts;
  for (let g = 0; g < 4 && !changed; g++) {
    await menu.getByRole('button', { name: `Group ${g + 1}`, exact: true }).click();
    after = await groupCounts(page);
    changed = after.some((c, i) => c !== counts[i]);
    if (!changed) {
      await page.mouse.click(pt.x, pt.y); // segment already wholly in that group: reopen the menu, try the next
      await expect(menu).toBeVisible();
    }
  }
  expect(changed).toBe(true);
  expect(after.reduce((a, b) => a + b, 0)).toBe(120);
  const diffs = after.map((c, i) => c - counts[i]);
  expect(diffs.filter((d) => d > 0)).toHaveLength(1);
  const gained = Math.max(...diffs);
  expect(gained).toBeGreaterThan(0);
  expect(gained).toBeLessThanOrEqual(moved);
  expect(diffs.reduce((a, d) => a + Math.max(0, -d), 0)).toBe(gained);

  await page.click('#undo');
  await expect.poll(() => groupCounts(page)).toEqual(counts);
  expect(await groupLengths(page)).toEqual(lengths); // returning to the old membership reuses the cached tours

  // Single-house move: click house dots until a house popup opens (NOT RUN in the authoring environment).
  const hm = page.locator('.house-menu').last();
  let opened = false;
  for (let dx = -200; dx <= 200 && !opened; dx += 7) {
    for (const dy of [-10, 0, 10]) {
      await page.mouse.click(cx + dx, cy + dy);
      if (await hm.isVisible()) { opened = true; break; }
    }
  }
  if (opened) {
    const target = hm.locator('.house-groups button:not([disabled])').first();
    await target.click();
    expect((await groupCounts(page)).reduce((a, b) => a + b, 0)).toBe(120);
    await page.click('#undo');
    await expect.poll(() => groupCounts(page)).toEqual(counts);
  }

  await page.click('#export-print');
  await expect(page.locator('.print-page')).toHaveCount(5); // overview + 4 groups
});

test('disconnected houses block solving until they are removed (undoable)', async ({ page }) => {
  const { osm, houses } = syntheticGrid(5, 5, 3);
  const s = emptyState();
  s.osm = { nodes: [...osm.nodes, [900, 42.05, -88.3], [901, 42.05, -88.2985]], ways: [...osm.ways, { id: 999, name: 'Island Rd', highway: 'residential', nodes: [900, 901] }] };
  s.houses = [
    ...houses,
    ...[0, 1, 2].map((k) => ({ id: `o${k}`, lat: 42.05005, lon: -88.2999 + k * 0.0004, label: `${k + 1} Island Rd`, street: 'Island Rd', flagged: false, manual: false })),
  ];
  s.config.groups = 4;
  s.config.iterations = 400;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bag-e2e-')), 'disconnected-project.json');
  fs.writeFileSync(file, serializeProject(s));

  await page.goto('/');
  await page.setInputFiles('#load-input', file);
  await expect(page.locator('#status')).toContainText('123 houses');
  await expect(page.locator('#remove-disc')).toBeVisible();
  await expect(page.locator('#remove-disc')).toHaveText('Remove 3 disconnected houses');

  await page.click('#solve');
  await expect(page.locator('#status')).toContainText('Solving is blocked');
  await expect(page.locator('.group-row')).toHaveCount(0);

  await page.click('#remove-disc');
  await expect(page.locator('#remove-disc')).toBeHidden();
  await page.click('#solve');
  await expect(page.locator('#status')).toContainText('Done', { timeout: 60_000 });
  const counts = await groupCounts(page);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(120);

  await page.click('#undo'); // undoes the solve
  await page.click('#undo'); // restores the 3 removed houses
  await expect(page.locator('#remove-disc')).toBeVisible();
});
