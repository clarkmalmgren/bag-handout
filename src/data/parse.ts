import type { LatLon, OsmData, Way } from '../types';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}
export interface AddrNode { id: number; pos: LatLon; number: string; street: string }
export interface Building { id: number; ring: LatLon[]; tags: Record<string, string> }
export interface ParsedOverpass { osm: OsmData; addrNodes: AddrNode[]; buildings: Building[] }

const SKIP_HIGHWAY = new Set(['motorway', 'motorway_link', 'construction', 'proposed', 'abandoned', 'raceway']);
const SKIP_SERVICE = new Set(['driveway', 'parking_aisle']);

export function parseOverpass(json: { elements: OverpassElement[] }): ParsedOverpass {
  const pos = new Map<number, LatLon>();
  const addrNodes = new Map<number, AddrNode>();
  for (const el of json.elements) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue;
    const p = { lat: el.lat, lon: el.lon };
    pos.set(el.id, p);
    const num = el.tags?.['addr:housenumber'];
    if (num) addrNodes.set(el.id, { id: el.id, pos: p, number: num, street: el.tags?.['addr:street'] ?? '' });
  }

  const ways: Way[] = [];
  const buildings: Building[] = [];
  const seen = new Set<number>();
  for (const el of json.elements) {
    if (el.type !== 'way' || !el.nodes || seen.has(el.id)) continue;
    seen.add(el.id);
    const tags = el.tags ?? {};
    if (tags.highway) {
      if (SKIP_HIGHWAY.has(tags.highway) || SKIP_SERVICE.has(tags.service ?? '')) continue;
      // A node missing from the response is a gap in the road: split the way there instead of filtering the id
      // out, which would silently bridge the gap with a bogus edge between its neighbours. Pieces share the way id.
      let run: number[] = [];
      const flush = () => {
        if (run.length >= 2) ways.push({ id: el.id, name: tags.name ?? '', highway: tags.highway!, nodes: run });
        run = [];
      };
      for (const n of el.nodes) {
        if (pos.has(n)) run.push(n);
        else flush();
      }
      flush();
    } else if (tags.building || tags['addr:housenumber']) {
      const ring = el.nodes.map((n) => pos.get(n)).filter((p): p is LatLon => !!p);
      if (ring.length >= 3) buildings.push({ id: el.id, ring, tags });
    }
  }

  const used = new Set<number>();
  for (const w of ways) for (const n of w.nodes) used.add(n);
  const nodes: [number, number, number][] = [];
  for (const id of used) {
    const p = pos.get(id)!;
    nodes.push([id, p.lat, p.lon]);
  }
  return { osm: { nodes, ways }, addrNodes: [...addrNodes.values()], buildings };
}
