// src/export/print.ts
import L from 'leaflet';
import type { AppView } from '../app';
import type { Config } from '../types';
import { groupStats } from '../stats';
import { colorOf } from '../ui/groups';
import { disposeAll } from './dispose';
import { fitBox, type LatLngPair } from './bounds';
import { tourPolyline } from '../graph/route';

const liveMaps = new Set<L.Map>();
function disposeMaps(): void {
  disposeAll(liveMaps);
}

const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const fmtDist = (m: number) => `${(m / 1609.344).toFixed(2)} mi (${Math.round(m)} m)`;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Fit the map, then add the satellite layer so its tiles load; resolves on 'load' or after 8 s. */
function mountMap(div: HTMLElement, points: LatLngPair[]): { map: L.Map; ready: Promise<void> } {
  const map = L.map(div, { zoomControl: false, attributionControl: false, preferCanvas: true, zoomSnap: 0.25, maxZoom: 19 });
  liveMaps.add(map);
  map.fitBounds(fitBox(points), { maxZoom: 18, padding: [16, 16] });
  const tiles = L.tileLayer(SAT, { maxZoom: 19, crossOrigin: true });
  const ready = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 8000);
    tiles.once('load', () => { clearTimeout(timer); resolve(); });
  });
  tiles.addTo(map);
  return { map, ready };
}

function table(rows: string[][], header: string[]): HTMLTableElement {
  const t = h('table', 'print-table');
  const head = t.createTHead().insertRow();
  header.forEach((c) => head.append(Object.assign(document.createElement('th'), { textContent: c })));
  const body = t.createTBody();
  rows.forEach((r) => {
    const tr = body.insertRow();
    r.forEach((c) => (tr.insertCell().textContent = c));
  });
  return t;
}

export async function openPrintView(root: HTMLElement, view: AppView, cfg: Config): Promise<void> {
  const { model, houses, assign, tours } = view;
  if (!model || tours.length === 0) throw new Error('Solve first');
  disposeMaps();
  root.replaceChildren();
  root.hidden = false;

  const bar = h('div', 'print-bar');
  const printBtn = h('button', undefined, 'Loading map tiles…');
  printBtn.disabled = true;
  printBtn.addEventListener('click', () => window.print());
  const closeBtn = h('button', undefined, 'Close');
  closeBtn.addEventListener('click', () => { disposeMaps(); root.hidden = true; root.replaceChildren(); });
  bar.append(printBtn, closeBtn);
  root.append(bar);

  const groups = tours.length;
  const sizes = tours.map((t) => t.order.length);
  const stats = groupStats(sizes, tours.map((t) => t.length), cfg);
  const ready: Promise<void>[] = [];
  const latlng = (i: number) => [houses[i].lat, houses[i].lon] as LatLngPair;

  // Page 1: overview map + legend table.
  const overview = h('section', 'print-page');
  overview.append(h('h2', undefined, 'Bag handout — overview'));
  const overviewMap = h('div', 'print-map');
  overview.append(overviewMap);
  overview.append(
    table(
      stats.map((s) => [`Group ${s.group + 1}`, String(s.houses), fmtDist(s.length), `${Math.round(s.minutes)} min`]),
      ['Group', 'Houses', 'Loop', 'Est. time'],
    ),
  );
  root.append(overview);
  const om = mountMap(overviewMap, houses.map((_, i) => latlng(i)));
  ready.push(om.ready);
  houses.forEach((_, i) => {
    L.circleMarker(latlng(i), { radius: 3, color: '#fff', weight: 1, fillColor: colorOf(assign[i]), fillOpacity: 1 }).addTo(om.map);
  });
  tours.forEach((t, g) => {
    if (t.order.length === 0) return;
    const route = tourPolyline(model, t.order).map((p) => [p.lat, p.lon] as LatLngPair);
    L.polyline(route, { color: colorOf(g), weight: 2, dashArray: '5 5' }).addTo(om.map);
  });

  // One page per group.
  for (let g = 0; g < groups; g++) {
    const t = tours[g];
    const page = h('section', 'print-page');
    const s = stats[g];
    page.append(h('h2', undefined, `Group ${g + 1} — ${s.houses} houses`));
    page.append(h('p', undefined, `Loop ${fmtDist(s.length)}, about ${Math.round(s.minutes)} min. Start at stop 1 (outlined) and follow the numbers.`));
    if (t.order.length === 0) {
      page.append(h('p', undefined, 'No houses assigned.'));
      root.append(page);
      continue;
    }
    const mapDiv = h('div', 'print-map group-map');
    page.append(mapDiv);
    root.append(page);

    const route = tourPolyline(model, t.order).map((p) => [p.lat, p.lon] as LatLngPair);
    const gm = mountMap(mapDiv, route);
    ready.push(gm.ready);
    L.polyline(route, { color: colorOf(g), weight: 3, opacity: 0.95, dashArray: '6 6' }).addTo(gm.map);
    t.order.forEach((idx, k) => {
      const icon = L.divIcon({
        className: 'stop-icon',
        html: `<div class="stop${k === 0 ? ' start' : ''}" style="background:${colorOf(g)}">${k + 1}</div>`,
        iconSize: [22, 22],
      });
      L.marker(latlng(idx), { icon, interactive: false, zIndexOffset: k === 0 ? 1000 : 0 }).addTo(gm.map);
    });
  }

  await Promise.all(ready);
  printBtn.textContent = 'Print / Save as PDF';
  printBtn.disabled = false;
}
