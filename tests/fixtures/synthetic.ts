import type { House, OsmData, Way } from '../../src/types';

// A rows x cols grid of intersections about 100 m apart. Node id = r*cols + c + 1.
// Horizontal streets are named "Row r" and carry perEdge houses per side per block;
// vertical streets are named "Col c" and carry none. rows=5, cols=5, perEdge=3 gives 120 houses.
export function syntheticGrid(rows: number, cols: number, perEdge: number): { osm: OsmData; houses: House[] } {
  const LAT0 = 42;
  const LON0 = -88.3;
  const DLAT = 0.0009;
  const DLON = 0.0012;
  const OFF = 0.00015;
  const id = (r: number, c: number) => r * cols + c + 1;

  const nodes: [number, number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) nodes.push([id(r, c), LAT0 + r * DLAT, LON0 + c * DLON]);

  const ways: Way[] = [];
  let wid = 1000;
  for (let r = 0; r < rows; r++) {
    ways.push({ id: wid++, name: `Row ${r}`, highway: 'residential', nodes: Array.from({ length: cols }, (_, c) => id(r, c)) });
  }
  for (let c = 0; c < cols; c++) {
    ways.push({ id: wid++, name: `Col ${c}`, highway: 'residential', nodes: Array.from({ length: rows }, (_, r) => id(r, c)) });
  }

  const houses: House[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      for (let k = 0; k < perEdge; k++) {
        for (const side of [1, -1]) {
          const f = (k + 0.5) / perEdge;
          houses.push({
            id: `h${r}_${c}_${k}_${side > 0 ? '+' : '-'}`,
            lat: LAT0 + r * DLAT + side * OFF,
            lon: LON0 + (c + f) * DLON,
            label: `${k + 1} Row ${r}`,
            street: `Row ${r}`,
            flagged: false,
            manual: false,
          });
        }
      }
    }
  }
  return { osm: { nodes, ways }, houses };
}
