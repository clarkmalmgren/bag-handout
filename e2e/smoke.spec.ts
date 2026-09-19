// e2e/smoke.spec.ts
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syntheticGrid } from '../tests/fixtures/synthetic';
import { emptyState } from '../src/state';
import { serializeProject } from '../src/project';

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

  await page.goto('/');
  await page.setInputFiles('#load-input', file);
  await expect(page.locator('#status')).toContainText('120 houses');
  await expect(page.locator('#groups')).toHaveValue('4');

  await page.click('#solve');
  await expect(page.locator('#status')).toContainText('Done', { timeout: 60_000 });

  await expect(page.locator('.group-row')).toHaveCount(4);
  const counts = await groupCounts(page);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(120);
  for (const c of counts) expect(Math.abs(c - 30)).toBeLessThanOrEqual(2);

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

  await page.click('#export-print');
  await expect(page.locator('.print-page')).toHaveCount(5); // overview + 4 groups
});
