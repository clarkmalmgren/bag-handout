import type { Tour } from './types';
import { membersOf, routeGroup } from './solver/solve';

/**
 * Tours keyed by group index + the sorted member indices of that group. A group whose membership is unchanged
 * keeps its tour (including the solver's own tour after a solve); only changed groups are re-routed.
 * Indices refer to one house list, so the owner must clear() whenever the model is rebuilt.
 */
export class TourCache {
  private map = new Map<string, Tour>();

  static signature(group: number, members: number[]): string {
    return `${group}:${[...members].sort((a, b) => a - b).join(',')}`;
  }

  get(group: number, members: number[]): Tour | undefined {
    return this.map.get(TourCache.signature(group, members));
  }

  set(group: number, members: number[], tour: Tour): void {
    if (this.map.size >= 500) this.map.clear(); // bounded: undo/redo history is at most 100 steps
    this.map.set(TourCache.signature(group, members), tour);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Store the solver's own tours (tours[g] belongs to group g of `assign`). */
  seed(assign: number[], groups: number, tours: Tour[]): void {
    membersOf(assign, groups).forEach((m, g) => {
      if (tours[g]) this.set(g, m, tours[g]);
    });
  }

  /** One tour per group; cached ones are reused, missing ones are computed by `route` (default: the TSP heuristic). */
  routeAll(
    distMatrix: Float32Array,
    houseCount: number,
    assign: number[],
    groups: number,
    route: (members: number[]) => Tour = (m) => routeGroup(distMatrix, houseCount, m),
  ): Tour[] {
    return membersOf(assign, groups).map((m, g) => {
      let t = this.get(g, m);
      if (!t) {
        t = route(m);
        this.set(g, m, t);
      }
      return t;
    });
  }
}
