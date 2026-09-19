export type LatLngPair = [number, number];

/** South-west / north-east corners covering the points, at least `minSpan` degrees on each axis (a single point gets a real box). */
export function fitBox(points: LatLngPair[], minSpan = 0.002): [LatLngPair, LatLngPair] {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [lat, lon] of points) {
    s = Math.min(s, lat); n = Math.max(n, lat);
    w = Math.min(w, lon); e = Math.max(e, lon);
  }
  if (!Number.isFinite(s)) return [[0, 0], [0, 0]];
  const grow = (lo: number, hi: number): [number, number] => {
    const span = hi - lo;
    if (span >= minSpan) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - minSpan / 2, mid + minSpan / 2];
  };
  const [s2, n2] = grow(s, n);
  const [w2, e2] = grow(w, e);
  return [[s2, w2], [n2, e2]];
}
