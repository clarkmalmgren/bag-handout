export interface LatLon {
  lat: number;
  lon: number;
}

export interface XY {
  x: number;
  y: number;
}

export interface House {
  id: string;
  lat: number;
  lon: number;
  /** e.g. "123 Preston Cir" or "(no address)" */
  label: string;
  street: string;
  /** true when the house has no address and needs human review */
  flagged: boolean;
  /** true when added by hand in the UI */
  manual: boolean;
}

export interface Way {
  id: number;
  name: string;
  highway: string;
  nodes: number[];
}

export interface OsmData {
  /** [osmNodeId, lat, lon] */
  nodes: [number, number, number][];
  ways: Way[];
}

export interface Weights {
  /** weight on the longest route */
  maxRoute: number;
  /** weight on the sum of route lengths */
  total: number;
  /** hard house-count tolerance around the mean, as a fraction of the mean (0.1 = +-10%) */
  toleranceFrac: number;
  /** smallest hard house-count tolerance in houses; used when the percentage works out smaller */
  tolerance: number;
  /** weight on the compactness (kNN mixing) term, in metres per cut neighbour link */
  compact: number;
}

export interface Config {
  groups: number;
  /** meters added when consecutive stops are on opposite sides of the same street edge */
  crossingPenalty: number;
  weights: Weights;
  iterations: number;
  seed: number;
  /** meters per second */
  walkSpeed: number;
  /** seconds spent at each house */
  secPerHouse: number;
}

export interface Tour {
  /** house indices in visiting order (closed loop) */
  order: number[];
  /** closed-loop length in meters */
  length: number;
}

/** Walking distance in meters between house indices i and j. */
export type Dist = (i: number, j: number) => number;
