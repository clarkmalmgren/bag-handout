import L from 'leaflet';
import { createMap, showBoundary } from './ui/map';
import { parseProject, serializeProject } from './project';
import { Store, emptyState } from './state';
import { fetchOverpass } from './data/overpass';
import { HouseEditor, renderHouseDots } from './ui/houseEdit';

const store = new Store(emptyState());

const mapEl = document.getElementById('map') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const groupsInput = document.getElementById('groups') as HTMLInputElement;

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

const houseLayer = L.layerGroup().addTo(map);
const houseEditor = new HouseEditor(map, store);

function status(text: string): void {
  setStatus(text);
}

function visibleHouses() {
  const removed = new Set(store.state.removed);
  return store.state.houses.filter((h) => !removed.has(h.id));
}

function render(): void {
  renderHouseDots(houseLayer, visibleHouses(), (id) => houseEditor.remove(id));
}

store.subscribe(render);

map.on('bagboundarycleared', () => {
  store.update(
    (s) => {
      s.boundary = null;
    },
    { undoable: false },
  );
  setStatus('Boundary cleared.');
});

groupsInput.addEventListener('change', () => {
  const n = Math.max(2, Math.min(20, Number(groupsInput.value) || 6));
  groupsInput.value = String(n);
  store.update(
    (s) => {
      s.config.groups = n;
    },
    { undoable: false },
  );
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
    groupsInput.value = String(store.state.config.groups);
    showBoundary(map, drawn, store.state.boundary);
    setStatus(`Loaded: ${store.state.houses.length} houses`);
  } catch (err) {
    setStatus(`Could not load project: ${(err as Error).message}`);
  } finally {
    input.value = '';
  }
});

document.getElementById('undo')!.addEventListener('click', () => store.undo());
document.getElementById('redo')!.addEventListener('click', () => store.redo());

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
      s.houses = [...r.houses, ...s.houses.filter((h) => h.manual)];
      s.removed = [];
      s.assignment = {};
    });
    const flagged = r.houses.filter((h) => h.flagged).length;
    status(`Loaded: ${visibleHouses().length} houses (${flagged} without an address, shown in orange)`);
  } catch (e) {
    status(`Fetch failed: ${(e as Error).message}`);
  }
});
