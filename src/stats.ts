import type { Tour } from './types';
import { normalizeStreet } from './graph/streetName';

export interface GroupStat {
  group: number;
  houses: number;
  length: number;
  minutes: number;
  delta: number;
  /**
   * How often the loop changes street, walking it in order (closed loop). A group that covers two
   * whole streets shows 2; a group that hops back and forth shows many more, which is the
   * "complicated route" the compactness term is there to avoid. -1 when no tour is known.
   */
  streetChanges: number;
}

/** Street changes around the closed loop `order`, comparing canonical street names. */
export function streetChanges(order: number[], streets: string[]): number {
  const names = order.map((i) => normalizeStreet(streets[i] ?? ''));
  if (names.length < 2) return 0;
  let changes = 0;
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== names[(i + 1) % names.length]) changes++;
  }
  return changes;
}

/** Number of street names whose houses are spread over more than one group (0 when nothing is assigned). */
export function splitStreetCount(streets: string[], assign: number[]): { split: number; total: number } {
  const groups = new Map<string, Set<number>>();
  streets.forEach((s, i) => {
    const g = assign[i];
    if (g === undefined || g < 0) return;
    const key = normalizeStreet(s);
    if (key === '') return;
    const set = groups.get(key) ?? new Set<number>();
    set.add(g);
    groups.set(key, set);
  });
  let split = 0;
  for (const s of groups.values()) if (s.size > 1) split++;
  return { split, total: groups.size };
}

export function groupStats(
  sizes: number[],
  lengths: number[],
  cfg: { walkSpeed: number; secPerHouse: number },
  detail?: { tours?: Tour[]; streets?: string[] },
): GroupStat[] {
  const mean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  return sizes.map((houses, group) => {
    const length = lengths[group] ?? 0;
    const tour = detail?.tours?.[group];
    return {
      group,
      houses,
      length,
      minutes: (length / cfg.walkSpeed + houses * cfg.secPerHouse) / 60,
      delta: houses - mean,
      streetChanges: tour && detail?.streets ? streetChanges(tour.order, detail.streets) : -1,
    };
  });
}
