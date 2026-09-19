import { describe, expect, it } from 'vitest';
import { haversine, makeProjector, pointInRing, projectToSegment, ringCentroid } from '../src/geo';

describe('haversine', () => {
  it('one degree of latitude is about 111195 m', () => {
    const d = haversine({ lat: 42, lon: -88 }, { lat: 43, lon: -88 });
    expect(Math.abs(d - 111195) / 111195).toBeLessThan(0.005);
  });
  it('is zero for identical points', () => {
    expect(haversine({ lat: 1, lon: 2 }, { lat: 1, lon: 2 })).toBe(0);
  });
});

describe('makeProjector', () => {
  it('projects north as +y and east as +x in meters', () => {
    const proj = makeProjector({ lat: 42, lon: -88 });
    const n = proj({ lat: 42.001, lon: -88 });
    const e = proj({ lat: 42, lon: -87.999 });
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeGreaterThan(105);
    expect(n.y).toBeLessThan(117);
    expect(e.y).toBeCloseTo(0, 6);
    expect(e.x).toBeGreaterThan(75);
    expect(e.x).toBeLessThan(90);
  });
});

describe('projectToSegment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  it('projects onto the middle with t=0.5 and reports distance', () => {
    const r = projectToSegment({ x: 5, y: 3 }, a, b);
    expect(r.t).toBeCloseTo(0.5);
    expect(r.dist).toBeCloseTo(3);
  });
  it('reports side +1 for left of a->b and -1 for right', () => {
    expect(projectToSegment({ x: 5, y: 3 }, a, b).side).toBe(1);
    expect(projectToSegment({ x: 5, y: -3 }, a, b).side).toBe(-1);
  });
  it('clamps to the endpoints', () => {
    expect(projectToSegment({ x: -4, y: 0 }, a, b).t).toBe(0);
    expect(projectToSegment({ x: 14, y: 0 }, a, b).t).toBe(1);
  });
  it('handles a zero-length segment', () => {
    const r = projectToSegment({ x: 3, y: 4 }, a, a);
    expect(r.t).toBe(0);
    expect(r.dist).toBeCloseTo(5);
  });
});

describe('pointInRing / ringCentroid', () => {
  const ring = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 4 },
    { lat: 4, lon: 4 },
    { lat: 4, lon: 0 },
  ];
  it('detects inside and outside points', () => {
    expect(pointInRing({ lat: 2, lon: 2 }, ring)).toBe(true);
    expect(pointInRing({ lat: 5, lon: 2 }, ring)).toBe(false);
    expect(pointInRing({ lat: 2, lon: -1 }, ring)).toBe(false);
  });
  it('centroid of a square is its center, ignoring a closing duplicate', () => {
    const closed = [...ring, ring[0]];
    expect(ringCentroid(ring)).toEqual({ lat: 2, lon: 2 });
    expect(ringCentroid(closed)).toEqual({ lat: 2, lon: 2 });
  });
});
