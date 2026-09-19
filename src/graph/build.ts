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
  // Segment key format (stable across rebuilds, independent of way order and edge numbering):
  //   "<street>:<loOsmId>-<hiOsmId>"  where lo/hi are the sorted OSM ids of the chain's two end nodes
  //   (a closed loop has no ends, so its smallest node id is used for both);
  //   parallel segments of one street sharing the same two ends get "#1", "#2", ... appended, ordered by
  //   their sorted edge list (the first keeps the bare key).
  // Locks saved with an older key format simply no longer match any segment and are ignored.
  const sigs: string[] = [];
  const base: string[] = [];
  for (const seg of segments) {
    const degree = new Map<number, number>();
    const pairs: string[] = [];
    for (const eid of seg.edgeIds) {
      const ia = osmIds[edges[eid].a];
      const ib = osmIds[edges[eid].b];
      degree.set(ia, (degree.get(ia) ?? 0) + 1);
      degree.set(ib, (degree.get(ib) ?? 0) + 1);
      pairs.push(ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`);
    }
    let ends = [...degree].filter(([, d]) => d !== 2).map(([n]) => n).sort((x, y) => x - y);
    if (ends.length === 0) {
      const lo = Math.min(...degree.keys());
      ends = [lo, lo];
    }
    base.push(`${seg.street}:${ends[0]}-${ends[ends.length - 1]}`);
    sigs.push(pairs.sort().join(','));
  }
  const groups = new Map<string, number[]>();
  segments.forEach((_seg, i) => {
    const l = groups.get(base[i]) ?? [];
    l.push(i);
    groups.set(base[i], l);
  });
  for (const [k, ids] of groups) {
    ids.sort((x, y) => (sigs[x] < sigs[y] ? -1 : sigs[x] > sigs[y] ? 1 : 0));
    ids.forEach((sid, n) => { segments[sid].key = n === 0 ? k : `${k}#${n}`; });
  }

  return { coords, osmIds, index, edges, adj, segments };
}
