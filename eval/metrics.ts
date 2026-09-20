import type { XY } from '../src/types';

// Independent street-name normaliser for evaluation only (deliberately not the one in src/, so the metric
// does not move just because the implementation's own normaliser changes).
const SUFFIX: Record<string, string> = {
  cir: 'circle', circle: 'circle', ln: 'lane', lane: 'lane', dr: 'drive', drive: 'drive', ct: 'court', court: 'court',
  sq: 'square', square: 'square', pl: 'place', place: 'place', rd: 'road', road: 'road', ave: 'avenue', av: 'avenue',
  avenue: 'avenue', blvd: 'boulevard', boulevard: 'boulevard', trl: 'trail', trail: 'trail', pkwy: 'parkway',
  parkway: 'parkway', st: 'street', street: 'street', ter: 'terrace', terrace: 'terrace', hwy: 'highway', highway: 'highway',
};
// Directionals are dropped entirely (E/W Mallory Dr and "Mill Creek Cir W" all compare by their base name).
const DIRECTIONAL = new Set(['n', 'north', 's', 'south', 'e', 'east', 'w', 'west', 'ne', 'nw', 'se', 'sw']);

export function evalNorm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => !DIRECTIONAL.has(t))
    .map((t) => SUFFIX[t] ?? t).join(' ');
}

function cross(o: XY, a: XY, b: XY): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew's monotone chain; counter-clockwise hull without repeated end point. */
export function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: XY[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: XY[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function inHull(hull: XY[], q: XY): boolean {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) {
    if (cross(hull[i], hull[(i + 1) % hull.length], q) < 0) return false;
  }
  return true;
}

/** Sum over ordered group pairs (A,B), A != B, of the fraction of A's houses inside B's convex hull. */
export function overlapMetric(xy: XY[], assign: number[], groups: number): number {
  const pts: XY[][] = Array.from({ length: groups }, () => []);
  assign.forEach((g, i) => pts[g].push(xy[i]));
  const hulls = pts.map(convexHull);
  let total = 0;
  for (let a = 0; a < groups; a++) {
    if (pts[a].length === 0) continue;
    for (let b = 0; b < groups; b++) {
      if (a === b) continue;
      total += pts[a].filter((q) => inHull(hulls[b], q)).length / pts[a].length;
    }
  }
  return total;
}
