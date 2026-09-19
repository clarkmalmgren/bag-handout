import type { LatLon, XY } from './types';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local equirectangular projection to meters around `ref` (x = east, y = north). */
export function makeProjector(ref: LatLon): (p: LatLon) => XY {
  const kx = R * Math.cos(rad(ref.lat)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  return (p) => ({ x: (p.lon - ref.lon) * kx, y: (p.lat - ref.lat) * ky });
}

/**
 * Project point p onto segment a-b.
 * t in [0,1] along a->b, dist = perpendicular distance, side = +1 if p is left of a->b, else -1.
 */
export function projectToSegment(
  p: XY,
  a: XY,
  b: XY,
): { t: number; dist: number; side: 1 | -1 } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  const dist = Math.hypot(p.x - px, p.y - py);
  const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
  // cross > 0 means p is left of a->b in a y-up frame
  const side: 1 | -1 = cross >= 0 ? 1 : -1;
  return { t, dist, side };
}

/** Ray casting; x = lon, y = lat. */
export function pointInRing(p: LatLon, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const crosses = yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Average of the ring's vertices, ignoring a closing duplicate of the first vertex. */
export function ringCentroid(ring: LatLon[]): LatLon {
  let pts = ring;
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (f.lat === l.lat && f.lon === l.lon) pts = pts.slice(0, -1);
  }
  let lat = 0;
  let lon = 0;
  for (const p of pts) {
    lat += p.lat;
    lon += p.lon;
  }
  return { lat: lat / pts.length, lon: lon / pts.length };
}
