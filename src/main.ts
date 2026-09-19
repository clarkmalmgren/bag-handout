import { createMap, showBoundary } from './ui/map';
import { parseProject, serializeProject } from './project';
import { Store, emptyState } from './state';
import { fetchOverpass } from './data/overpass';
import { HouseEditor } from './ui/houseEdit';
import { initApp } from './app';
import { mergeFetched } from './edit';
import './style.css';

const store = new Store(emptyState());

const mapEl = document.getElementById('map') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

const { map, drawn } = createMap(mapEl, (poly) => {
  store.update(
    (s) => {
      s.boundary = poly;
    },
    { undoable: false },
  );
  setStatus('Boundary set. Fetch houses next.');
});

const houseEditor = new HouseEditor(map, store, () => setStatus(`Loaded: ${visibleHouses().length} houses`));

function status(text: string): void {
  setStatus(text);
}

function visibleHouses() {
  const removed = new Set(store.state.removed);
  return store.state.houses.filter((h) => !removed.has(h.id));
}

initApp({ store, map, removeHouse: (id) => houseEditor.remove(id), isAdding: () => houseEditor.isAdding });

map.on('bagboundarycleared', () => {
  store.update(
    (s) => {
      s.boundary = null;
    },
    { undoable: false },
  );
  setStatus('Boundary cleared.');
});

document.getElementById('save')!.addEventListener('click', () => {
  const blob = new Blob([serializeProject(store.state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bag-handout-project.json';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Project saved.');
});

document.getElementById('load-input')!.addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    store.replace(parseProject(await file.text()));
    showBoundary(map, drawn, store.state.boundary);
    if (!store.state.boundary && store.state.houses.length > 0) {
      map.fitBounds(store.state.houses.map((h) => [h.lat, h.lon] as [number, number]));
    }
    setStatus(`Loaded: ${store.state.houses.length} houses`);
  } catch (err) {
    setStatus(`Could not load project: ${(err as Error).message}`);
  } finally {
    input.value = '';
  }
});

document.getElementById('add-house')!.addEventListener('click', (e) => {
  const on = houseEditor.toggle();
  (e.currentTarget as HTMLElement).classList.toggle('active', on);
});

document.getElementById('fetch')!.addEventListener('click', async () => {
  const boundary = store.state.boundary;
  if (!boundary) {
    status('Draw a boundary first');
    return;
  }
  status('Fetching from OpenStreetMap…');
  try {
    const r = await fetchOverpass(boundary);
    store.update((s) => {
      s.osm = r.osm;
      const merged = mergeFetched(r.houses, s.houses, s.removed);
      s.houses = merged.houses;
      s.removed = merged.removed;
      s.assignment = {};
    });
    const flagged = r.houses.filter((h) => h.flagged).length;
    status(`Loaded: ${visibleHouses().length} houses (${flagged} without an address, shown in orange)`);
  } catch (e) {
    status(`Fetch failed: ${(e as Error).message}`);
  }
});
