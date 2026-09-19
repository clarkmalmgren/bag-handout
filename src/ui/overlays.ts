import L from 'leaflet';
import type { Tour } from '../types';
import type { Model } from '../model';
import { colorOf } from './groups';

export interface OverlayHandlers {
  onSegment?(segmentId: number, at: L.LatLng): void;
  /** Remove button in a house popup (keeps the Task 3 remove-house behaviour). */
  onRemoveHouse?(houseId: string): void;
}

export class Overlays {
  private segs = L.layerGroup();
  private tours = L.layerGroup();
  private dots = L.layerGroup();

  constructor(map: L.Map) {
    this.segs.addTo(map);
    this.tours.addTo(map);
    this.dots.addTo(map);
  }

  clear(): void {
    this.segs.clearLayers();
    this.tours.clearLayers();
    this.dots.clearLayers();
  }

  render(m: Model, assign: number[], tours: Tour[], lockedKeys: Set<string>, h: OverlayHandlers, disconnected: Set<number> = new Set()): void {
    this.clear();

    // Majority group per street segment.
    const votes = new Map<number, Map<number, number>>();
    m.snaps.forEach((sn, i) => {
      const v = votes.get(sn.segment) ?? new Map<number, number>();
      v.set(assign[i], (v.get(assign[i]) ?? 0) + 1);
      votes.set(sn.segment, v);
    });

    for (const seg of m.graph.segments) {
      const v = votes.get(seg.id);
      if (!v) continue; // segments without houses are not interactive
      let group = -1;
      let top = 0;
      for (const [g, c] of v) if (g >= 0 && c > top) { top = c; group = g; }
      const locked = lockedKeys.has(seg.key);
      const lines = seg.edgeIds.map((id) => {
        const e = m.graph.edges[id];
        const a = m.graph.coords[e.a];
        const b = m.graph.coords[e.b];
        return [[a.lat, a.lon], [b.lat, b.lon]] as L.LatLngTuple[];
      });
      const line = L.polyline(lines, {
        color: colorOf(group),
        weight: locked ? 8 : 6,
        opacity: locked ? 0.9 : 0.45,
        dashArray: locked ? '4 6' : undefined,
      });
      line.on('click', (ev: L.LeafletMouseEvent) => h.onSegment?.(seg.id, ev.latlng));
      line.addTo(this.segs);
    }

    m.houses.forEach((house, i) => {
      const dot = L.circleMarker([house.lat, house.lon], {
        radius: 4,
        color: house.flagged ? '#f59e0b' : '#ffffff', // orange outline = no address, review it
        weight: house.flagged ? 3 : 1,
        fillColor: colorOf(assign[i]),
        fillOpacity: 1,
        interactive: true,
        bubblingMouseEvents: false,
      });
      if (h.onRemoveHouse) {
        const box = document.createElement('div');
        box.append(document.createTextNode(house.label));
        const btn = document.createElement('button');
        btn.textContent = 'Remove';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', () => h.onRemoveHouse!(house.id));
        box.append(btn);
        dot.bindPopup(box);
      } else {
        dot.bindTooltip(house.label);
      }
      dot.addTo(this.dots);
      if (disconnected.has(i)) {
        // Red ring: cut off from the main street network. Non-interactive so the dot above stays clickable.
        L.circleMarker([house.lat, house.lon], { radius: 10, color: '#dc2626', weight: 3, fill: false, interactive: false }).addTo(this.dots);
      }
    });

    tours.forEach((t, g) => {
      if (t.order.length === 0) return;
      const pts = t.order.map((idx) => [m.houses[idx].lat, m.houses[idx].lon] as L.LatLngTuple);
      L.polyline([...pts, pts[0]], { color: colorOf(g), weight: 2, dashArray: '6 6', opacity: 0.9, interactive: false }).addTo(this.tours);
      L.circleMarker(pts[0], { radius: 8, color: '#000', weight: 2, fillColor: colorOf(g), fillOpacity: 1 })
        .bindTooltip(`Group ${g + 1} start`)
        .addTo(this.tours);
    });
  }
}
