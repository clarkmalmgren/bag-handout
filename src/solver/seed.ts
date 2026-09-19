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
