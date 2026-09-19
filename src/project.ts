import type { Polygon } from 'geojson';
import { defaultConfig, type ProjectState } from './state';
import type { LatLon } from './types';

export const PROJECT_VERSION = 1;

export function serializeProject(s: ProjectState): string {
  return JSON.stringify({ version: PROJECT_VERSION, ...s });
}

export function parseProject(text: string): ProjectState {
  const o = JSON.parse(text);
  if (o.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version ${o.version}`);
  }
  const base = defaultConfig();
  return {
    boundary: o.boundary ?? null,
    osm: o.osm ?? null,
    houses: o.houses ?? [],
    removed: o.removed ?? [],
    assignment: o.assignment ?? {},
    locked: o.locked ?? [],
    config: {
      ...base,
      ...(o.config ?? {}),
      weights: { ...base.weights, ...(o.config?.weights ?? {}) },
    },
  };
}

/** Outer ring of a GeoJSON polygon as LatLon[] (GeoJSON is [lon, lat]). */
export function ringOf(boundary: Polygon | null): LatLon[] | null {
  if (!boundary) return null;
  const ring = boundary.coordinates[0];
  if (!ring) return null;
  return ring.map(([lon, lat]) => ({ lat, lon }));
}
