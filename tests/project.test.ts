import { describe, expect, it } from 'vitest';
import { PROJECT_VERSION, parseProject, ringOf, serializeProject } from '../src/project';
import { emptyState } from '../src/state';
import type { Polygon } from 'geojson';

describe('project serialize/parse', () => {
  it('round-trips a populated state', () => {
    const s = emptyState();
    s.boundary = {
      type: 'Polygon',
      coordinates: [
        [
          [-88.3, 41.88],
          [-88.29, 41.88],
          [-88.29, 41.89],
          [-88.3, 41.88],
        ],
      ],
    };
    s.osm = { nodes: [[1, 41.88, -88.3]], ways: [{ id: 5, name: 'Main St', highway: 'residential', nodes: [1] }] };
    s.houses = [
      { id: 'w1', lat: 41.881, lon: -88.299, label: '1 Main St', street: 'Main St', flagged: false, manual: false },
    ];
    s.removed = ['w9'];
    s.assignment = { w1: 2 };
    s.locked = ['Main St:1'];
    s.config.groups = 8;
    const parsed = parseProject(serializeProject(s));
    expect(parsed).toEqual(s);
  });

  it('writes the current version', () => {
    expect(JSON.parse(serializeProject(emptyState())).version).toBe(PROJECT_VERSION);
  });

  it('rejects an unsupported version', () => {
    const bad = JSON.stringify({ version: 999 });
    expect(() => parseProject(bad)).toThrow(/Unsupported project version 999/);
  });

  it('fills defaults for missing optional fields', () => {
    const parsed = parseProject(JSON.stringify({ version: PROJECT_VERSION, config: { groups: 3 } }));
    expect(parsed.boundary).toBeNull();
    expect(parsed.houses).toEqual([]);
    expect(parsed.config.groups).toBe(3);
    expect(parsed.config.crossingPenalty).toBe(8);
  });
});

describe('ringOf', () => {
  it('returns null without a boundary', () => {
    expect(ringOf(null)).toBeNull();
  });
  it('converts the outer ring from [lon,lat] to LatLon', () => {
    const p: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-88.3, 41.88],
          [-88.29, 41.88],
          [-88.29, 41.89],
          [-88.3, 41.88],
        ],
      ],
    };
    expect(ringOf(p)).toEqual([
      { lat: 41.88, lon: -88.3 },
      { lat: 41.88, lon: -88.29 },
      { lat: 41.89, lon: -88.29 },
      { lat: 41.88, lon: -88.3 },
    ]);
  });
});

describe('locks with unknown keys', () => {
  it('load without throwing and match no segment', async () => {
    const { buildModel } = await import('../src/model');
    const { syntheticGrid } = await import('./fixtures/synthetic');
    const g = syntheticGrid(3, 3, 2);
    const s = emptyState();
    s.osm = g.osm;
    s.houses = g.houses;
    s.locked = ['Main St:1', 'Row 0:9999-9998'];
    const parsed = parseProject(serializeProject(s));
    const m = buildModel(parsed.houses, parsed.osm!, 8);
    const locked = new Set(parsed.locked);
    expect(m.snaps.map((sn) => locked.has(m.graph.segments[sn.segment].key)).some(Boolean)).toBe(false);
  });
});
