import { haversine } from '../geo';
import type { LatLon, OsmData } from '../types';

export interface GraphEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  street: string;
  segment: number;
}

export interface Segment {
  id: number;
  key: string;
  street: string;
  edgeIds: number[];
}

export interface Graph {
  coords: LatLon[];
  osmIds: number[];
  index: Map<number, number>;
  edges: GraphEdge[];
  adj: { to: number; w: number }[][];
  segments: Segment[];
}

export function buildGraph(osm: OsmData): Graph {
  const coords: LatLon[] = [];
  const osmIds: number[] = [];
  const index = new Map<number, number>();
  for (const [id, lat, lon] of osm.nodes) {
    if (index.has(id)) continue;
    index.set(id, coords.length);
    coords.push({ lat, lon });
    osmIds.push(id);
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const w of osm.ways) {
    for (let i = 0; i + 1 < w.nodes.length; i++) {
      const a = index.get(w.nodes[i]);
      const b = index.get(w.nodes[i + 1]);
      if (a === undefined || b === undefined || a === b) continue;
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ id: edges.length, a, b, length: haversine(coords[a], coords[b]), street: w.name, segment: -1 });
    }
  }

  const adj: { to: number; w: number }[][] = coords.map(() => []);
  const incident: number[][] = coords.map(() => []);
  for (const e of edges) {
    adj[e.a].push({ to: e.b, w: e.length });
    adj[e.b].push({ to: e.a, w: e.length });
    incident[e.a].push(e.id);
    incident[e.b].push(e.id);
  }

  // Union-find over edges: two edges meeting at a degree-2 node on the same street form one segment.
  const parent = edges.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const inc of incident) {
    if (inc.length !== 2) continue;
    if (edges[inc[0]].street !== edges[inc[1]].street) continue;
    parent[find(inc[0])] = find(inc[1]);
  }

  const segments: Segment[] = [];
  const segOfRoot = new Map<number, number>();
  for (const e of edges) {
    const root = find(e.id);
    let sid = segOfRoot.get(root);
    if (sid === undefined) {
      sid = segments.length;
      segOfRoot.set(root, sid);
      segments.push({ id: sid, key: '', street: e.street, edgeIds: [] });
    }
    e.segment = sid;
    segments[sid].edgeIds.push(e.id);
  }
  for (const s of segments) {
    let minId = Infinity;
    for (const eid of s.edgeIds) {
      minId = Math.min(minId, osmIds[edges[eid].a], osmIds[edges[eid].b]);
    }
    s.key = `${s.street}:${minId}`;
  }

  return { coords, osmIds, index, edges, adj, segments };
}
