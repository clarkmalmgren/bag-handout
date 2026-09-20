import type { Dist, XY } from '../types';

/** Neighbours per house in the compactness graph. */
export const COMPACT_K = 6;

export interface KnnGraph {
  /** knn[h] = the K nearest houses to h by walking distance (h excluded) */
  knn: number[][];
  /** rev[h] = the houses that have h in their knn list */
  rev: number[][];
  /** number of directed links in the graph (sum of knn lengths) */
  links: number;
}

/**
 * k-nearest-neighbour graph, built once per solve.
 *
 * Neighbours are the k spatially nearest houses (straight line) when `xy` is given, otherwise the k
 * nearest by walking distance. Spatial is the default in solve(): the mixing the user sees is houses
 * of two groups alternating along a street *and across adjacent streets*, and two houses that back
 * onto each other are 10 m apart on the map but several hundred metres apart on foot, so a
 * walking-distance graph does not charge for splitting them (measured: minimising the walking-kNN
 * cut left the hull-overlap metric unchanged, minimising the spatial cut cut it by ~4x).
 */
export function buildKnn(count: number, dist: Dist, k = COMPACT_K, xy?: XY[]): KnnGraph {
  const knn: number[][] = [];
  const d = xy
    ? (a: number, b: number) => (xy[a].x - xy[b].x) ** 2 + (xy[a].y - xy[b].y) ** 2
    : dist;
  for (let h = 0; h < count; h++) {
    const idx: number[] = [];
    for (let i = 0; i < count; i++) if (i !== h) idx.push(i);
    idx.sort((a, b) => d(h, a) - d(h, b) || a - b);
    knn.push(idx.slice(0, k));
  }
  const rev: number[][] = Array.from({ length: count }, () => []);
  let links = 0;
  for (let h = 0; h < count; h++) {
    for (const j of knn[h]) {
      rev[j].push(h);
      links++;
    }
  }
  return { knn, rev, links };
}

/**
 * Mixing measure: the number of directed kNN links whose two houses are in different groups.
 * A group whose houses are surrounded by their own group cuts no links, so lower is more compact.
 */
export function cutLinks(g: KnnGraph, assign: number[]): number {
  let cut = 0;
  for (let h = 0; h < assign.length; h++) {
    const a = assign[h];
    for (const j of g.knn[h]) if (assign[j] !== a) cut++;
  }
  return cut;
}

/**
 * Change in cutLinks if every [house, group] in `moves` were applied, without touching `assign`.
 * Only the links incident to the moved houses (out- and in-links) can change, so this is
 * O(|moves| * k) rather than O(count * k).
 */
export function cutDelta(g: KnnGraph, assign: number[], moves: readonly [number, number][]): number {
  if (moves.length === 0) return 0;
  const to = new Map<number, number>();
  for (const [h, t] of moves) to.set(h, t);
  const after = (h: number): number => to.get(h) ?? assign[h];
  const seen = new Set<number>();
  let delta = 0;
  const edge = (a: number, b: number): void => {
    const key = a * assign.length + b;
    if (seen.has(key)) return;
    seen.add(key);
    const was = assign[a] !== assign[b] ? 1 : 0;
    const now = after(a) !== after(b) ? 1 : 0;
    delta += now - was;
  };
  for (const [h] of moves) {
    for (const j of g.knn[h]) edge(h, j);
    for (const i of g.rev[h]) edge(i, h);
  }
  return delta;
}
