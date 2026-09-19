import type { House } from './types';

/**
 * Give every unassigned/out-of-range entry the group of its nearest (by dist) assigned house.
 * Returns the changed indices. Leaves everything alone when nothing is assigned yet.
 */
export function adoptNearest(a: number[], dist: Float32Array, groups: number): number[] {
  const valid = (g: number) => g >= 0 && g < groups;
  const n = a.length;
  const anchors: number[] = [];
  a.forEach((g, i) => { if (valid(g)) anchors.push(i); });
  if (anchors.length === 0 || anchors.length === n) return [];
  const changed: number[] = [];
  const src = a.slice(); // adopt only from originally assigned houses
  for (let i = 0; i < n; i++) {
    if (valid(src[i])) continue;
    let best = anchors[0];
    let bd = Infinity;
    for (const j of anchors) {
      const d = dist[i * n + j];
      if (d < bd) { bd = d; best = j; }
    }
    a[i] = src[best];
    changed.push(i);
  }
  return changed;
}

export interface SolveContext {
  state: object;
  groups: number;
  modelKey: string;
  osm: unknown;
}

/** True when the world a solve started in is gone (different project, group count, house set or road data). */
export function solveIsStale(start: SolveContext, now: SolveContext): boolean {
  return start.state !== now.state || start.groups !== now.groups || start.modelKey !== now.modelKey || start.osm !== now.osm;
}

/** Result of a re-fetch: fresh houses plus the manual ones, keeping removals of manual houses. */
export function mergeFetched(fetched: House[], oldHouses: House[], oldRemoved: string[]): { houses: House[]; removed: string[] } {
  const manual = oldHouses.filter((h) => h.manual);
  const manualIds = new Set(manual.map((h) => h.id));
  return { houses: [...fetched, ...manual], removed: oldRemoved.filter((id) => manualIds.has(id)) };
}
