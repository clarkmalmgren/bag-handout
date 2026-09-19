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
