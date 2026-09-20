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
  /** inputSignature() of the mutable inputs (assignment, locked, removed) */
  inputs: string;
}

/** Cheap signature of the user-editable solver inputs; any manual edit or undo during a solve changes it. */
export function inputSignature(s: { assignment: Record<string, number>; locked: string[]; removed: string[]; lockedHouses?: string[] }): string {
  return JSON.stringify(s.assignment) + '|' + s.locked.join('\u0001') + '|' + s.removed.join('\u0001') + '|' + (s.lockedHouses ?? []).join('\u0001');
}

/** True when the world a solve started in is gone (different project, group count, house set, road data, or an edit/undo of assignment, locks or removals). */
export function solveIsStale(start: SolveContext, now: SolveContext): boolean {
  return start.state !== now.state || start.groups !== now.groups || start.modelKey !== now.modelKey || start.osm !== now.osm || start.inputs !== now.inputs;
}

/**
 * Result of a re-fetch: fresh houses plus the manual ones. ALL previously removed ids are kept (they are harmless
 * when the house is absent from the new fetch) so hand-pruned OSM houses such as garages do not come back.
 */
export function mergeFetched(fetched: House[], oldHouses: House[], oldRemoved: string[]): { houses: House[]; removed: string[] } {
  const manual = oldHouses.filter((h) => h.manual);
  return { houses: [...fetched, ...manual], removed: [...oldRemoved] };
}

/** Houses that are not in the removed list. */
export function visibleHouses(s: { houses: House[]; removed: string[] }): House[] {
  const removed = new Set(s.removed);
  return s.houses.filter((h) => !removed.has(h.id));
}

/** Fetching wipes the assignment (Undo restores it), so ask first when there is one. */
export function confirmFetchReplaces(assignment: Record<string, number>, confirmFn: (m: string) => boolean = (m) => window.confirm(m)): boolean {
  if (Object.keys(assignment).length === 0) return true;
  return confirmFn('Fetching replaces all group assignments. Undo can restore them. Continue?');
}

/** Moves one house to a group (a single undoable store update when called inside Store.update). */
export function moveHouse(s: { assignment: Record<string, number> }, id: string, group: number): void {
  s.assignment[id] = group;
}

/** Flips the per-house lock; returns true when the house is now locked. */
export function toggleHouseLock(s: { lockedHouses: string[] }, id: string): boolean {
  const i = s.lockedHouses.indexOf(id);
  if (i >= 0) {
    s.lockedHouses.splice(i, 1);
    return false;
  }
  s.lockedHouses.push(id);
  return true;
}

/** Per-house "optimizer must not move" flags: a house is locked by its own lock or by its street segment's lock. */
export function lockedFlags(houses: { id: string }[], segmentKeyOf: string[], lockedKeys: string[], lockedHouses: string[]): boolean[] {
  const keys = new Set(lockedKeys);
  const ids = new Set(lockedHouses);
  return houses.map((h, i) => keys.has(segmentKeyOf[i]) || ids.has(h.id));
}
