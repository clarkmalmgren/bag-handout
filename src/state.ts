import type { Polygon } from 'geojson';
import type { Config, House, OsmData } from './types';

export interface ProjectState {
  boundary: Polygon | null;
  osm: OsmData | null;
  /** auto-fetched houses plus manually added ones (manual: true) */
  houses: House[];
  /** ids of houses hidden/removed by the user */
  removed: string[];
  /** house id -> group index (0-based) */
  assignment: Record<string, number>;
  /** locked segment keys (see Segment.key in graph/build.ts) */
  locked: string[];
  config: Config;
}

export function defaultConfig(): Config {
  return {
    groups: 6,
    crossingPenalty: 8,
    weights: { maxRoute: 1, total: 0.3, toleranceFrac: 0.1, tolerance: 2, compact: 2.5 },
    iterations: 8000,
    seed: 1,
    walkSpeed: 1.2,
    secPerHouse: 20,
  };
}

export function emptyState(): ProjectState {
  return {
    boundary: null,
    osm: null,
    houses: [],
    removed: [],
    assignment: {},
    locked: [],
    config: defaultConfig(),
  };
}

/** The slice of state covered by undo/redo. */
type Undoable = Pick<ProjectState, 'houses' | 'removed' | 'assignment' | 'locked'>;

const MAX_HISTORY = 100;

export class Store {
  state: ProjectState;
  private listeners = new Set<() => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(initial: ProjectState) {
    this.state = initial;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private snapshot(): string {
    const { houses, removed, assignment, locked } = this.state;
    const u: Undoable = { houses, removed, assignment, locked };
    return JSON.stringify(u);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }

  update(mut: (s: ProjectState) => void, opts: { undoable?: boolean } = { undoable: true }): void {
    const undoable = opts.undoable ?? true;
    if (undoable) {
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    mut(this.state);
    this.emit();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.snapshot());
    Object.assign(this.state, JSON.parse(prev) as Undoable);
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.snapshot());
    Object.assign(this.state, JSON.parse(next) as Undoable);
    this.emit();
    return true;
  }

  replace(state: ProjectState): void {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }
}
