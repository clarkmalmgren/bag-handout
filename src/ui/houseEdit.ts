import L from 'leaflet';
import type { Store } from '../state';
import type { House } from '../types';

export class HouseEditor {
  private adding = false;

  private drawing = false;

  constructor(private map: L.Map, private store: Store, private onChange: () => void = () => {}) {
    // Boundary drawing/editing also produces map clicks; those must never add houses.
    const on = (evs: string[], v: boolean) => evs.forEach((ev) => map.on(ev, () => { this.drawing = v; }));
    on(['draw:drawstart', 'draw:editstart', 'draw:deletestart'], true);
    on(['draw:drawstop', 'draw:editstop', 'draw:deletestop'], false);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.adding && !this.drawing) this.add(e.latlng);
    });
  }

  get isAdding(): boolean {
    return this.adding;
  }

  /** true while a boundary is being drawn, edited or deleted */
  get isDrawing(): boolean {
    return this.drawing;
  }

  setAdding(on: boolean): void {
    this.adding = on;
    this.map.getContainer().style.cursor = on ? 'crosshair' : '';
  }

  toggle(): boolean {
    this.setAdding(!this.adding);
    return this.adding;
  }

  private add(ll: L.LatLng): void {
    const label = window.prompt('Address for the new house (e.g. "12 Oak St")', '');
    if (label === null) return;
    const house: House = {
      id: `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
      lat: ll.lat,
      lon: ll.lng,
      label: label.trim() || '(added)',
      street: '',
      flagged: false,
      manual: true,
    };
    this.store.update((s) => {
      s.houses.push(house);
    });
    this.onChange();
  }

  remove(id: string): void {
    this.store.update((s) => {
      if (!s.removed.includes(id)) s.removed.push(id);
    });
    this.onChange();
  }
}

// Plain dots for Task 3; the group-coloured Overlays class (Part C) supersedes this
// but keeps calling HouseEditor.remove for the popup's Remove button.
export function renderHouseDots(layer: L.LayerGroup, houses: House[], onRemove: (id: string) => void): void {
  layer.clearLayers();
  for (const h of houses) {
    const dot = L.circleMarker([h.lat, h.lon], {
      radius: 4,
      weight: 1,
      color: '#222',
      fillColor: h.flagged ? '#f59e0b' : '#38bdf8',
      fillOpacity: 0.9,
      bubblingMouseEvents: false,
    });
    const box = document.createElement('div');
    box.append(document.createTextNode(h.label));
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', () => onRemove(h.id));
    box.append(btn);
    dot.bindPopup(box);
    dot.addTo(layer);
  }
}
