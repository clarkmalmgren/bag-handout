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
