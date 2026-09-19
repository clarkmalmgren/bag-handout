import { describe, expect, it } from 'vitest';
import { PROJECT_VERSION, parseProject, ringOf, serializeProject } from '../src/project';
import { emptyState, Store } from '../src/state';
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

describe('parseProject validation', () => {
  const good = (): Record<string, unknown> => JSON.parse(serializeProject(emptyState()));
  const withH = (h: unknown) => ({ ...good(), houses: [h] });
  const house = { id: 'a', lat: 1, lon: 2, label: 'l', street: 's', flagged: false, manual: false };
  const cases: [string, Record<string, unknown> | string, RegExp][] = [
    ['not JSON', '{oops', /not valid JSON/],
    ['array root', '[]', /JSON object/],
    ['null root', 'null', /JSON object/],
    ['houses not array', { ...good(), houses: {} }, /houses must be an array/],
    ['house not object', withH(5), /houses\[0\]/],
    ['house NaN lat (null)', withH({ ...house, lat: null }), /houses\[0\] needs finite/],
    ['house string lon', withH({ ...house, lon: 'x' }), /houses\[0\] needs finite/],
    ['house numeric id', withH({ ...house, id: 7 }), /houses\[0\] needs string/],
    ['removed not strings', { ...good(), removed: [1] }, /removed must be/],
    ['removed not array', { ...good(), removed: 'a' }, /removed must be/],
    ['assignment array', { ...good(), assignment: [] }, /assignment must be an object/],
    ['assignment float', { ...good(), assignment: { a: 1.5 } }, /assignment\["a"\]/],
    ['assignment string', { ...good(), assignment: { a: '1' } }, /assignment\["a"\]/],
    ['locked not strings', { ...good(), locked: [null] }, /locked must be/],
    ['osm wrong type', { ...good(), osm: 3 }, /osm must be/],
    ['osm node shape', { ...good(), osm: { nodes: [[1, 2]], ways: [] } }, /osm.nodes\[0\]/],
    ['osm way shape', { ...good(), osm: { nodes: [], ways: [{ id: 1, name: 'x', highway: 'r', nodes: ['a'] }] } }, /osm.ways\[0\]/],
    ['boundary wrong type', { ...good(), boundary: { type: 'Point', coordinates: [] } }, /boundary must be/],
    ['boundary no coordinates', { ...good(), boundary: { type: 'Polygon' } }, /boundary must be/],
    ['boundary bad position', { ...good(), boundary: { type: 'Polygon', coordinates: [[[1]]] } }, /boundary.coordinates\[0\]/],
  ];
  it.each(cases)('rejects %s without touching an existing Store', (_name, input, msg) => {
    const store = new Store(emptyState());
    store.state.locked = ['keep'];
    let replaced = 0;
    store.subscribe(() => { replaced++; });
    const before = JSON.stringify(store.state);
    const text = typeof input === 'string' ? input : JSON.stringify({ ...input, version: PROJECT_VERSION });
    expect(() => store.replace(parseProject(text))).toThrow(msg);
    expect(JSON.stringify(store.state)).toBe(before);
    expect(replaced).toBe(0);
  });

  it('clamps config values into range', () => {
    const c = parseProject(JSON.stringify({
      version: 1,
      config: { groups: 99.6, iterations: -5, crossingPenalty: 1e9, walkSpeed: 0, secPerHouse: 601, seed: 3.7, weights: { tolerance: 50, maxRoute: 2, total: 0.5 } },
    })).config;
    expect(c.groups).toBe(12);
    expect(c.iterations).toBe(0);
    expect(c.crossingPenalty).toBe(1000);
    expect(c.walkSpeed).toBe(0.1);
    expect(c.secPerHouse).toBe(600);
    expect(c.seed).toBe(4);
    expect(c.weights).toEqual({ maxRoute: 2, total: 0.5, tolerance: 20 });
    expect(parseProject(JSON.stringify({ version: 1, config: { groups: 1 } })).config.groups).toBe(2);
  });

  it('falls back to defaults for non-finite or unparseable values', () => {
    const d = emptyState().config;
    const c = parseProject('{"version":1,"config":{"groups":"abc","iterations":null,"walkSpeed":{},"secPerHouse":[],"crossingPenalty":"","seed":true,"weights":{"maxRoute":-1,"total":"x","tolerance":null}}}').config;
    expect(c).toEqual(d);
    expect(parseProject('{"version":1,"config":"nope"}').config).toEqual(d);
    expect(parseProject('{"version":1,"config":{"groups":"4"}}').config.groups).toBe(4);
  });

  it('still round-trips a valid populated state', () => {
    const s = emptyState();
    s.houses = [{ id: 'a', lat: 1, lon: 2, label: 'l', street: 's', flagged: true, manual: true }];
    s.assignment = { a: 0 };
    s.removed = ['z'];
    s.locked = ['k'];
    s.osm = { nodes: [[1, 2, 3]], ways: [{ id: 1, name: 'n', highway: 'h', nodes: [1] }] };
    s.boundary = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    expect(parseProject(serializeProject(s))).toEqual(s);
  });
});
