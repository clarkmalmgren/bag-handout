import { createMap, showBoundary } from './ui/map';
import { parseProject, serializeProject } from './project';
import { Store, emptyState } from './state';
import { fetchOverpass } from './data/overpass';
import { HouseEditor } from './ui/houseEdit';
import { initApp } from './app';
import { wireExports } from './export/wire';
import { mergeFetched, visibleHouses, confirmFetchReplaces } from './edit';
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

const houseEditor = new HouseEditor(map, store, () => setStatus(`Loaded: ${visibleHouses(store.state).length} houses`));

const app = initApp({ store, map, removeHouse: (id) => houseEditor.remove(id), isAdding: () => houseEditor.isAdding });
wireExports(app, store);

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
    setStatus(`Loaded: ${visibleHouses(store.state).length} houses`);
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

async function fetchHouses(force: boolean): Promise<void> {
  const boundary = store.state.boundary;
  if (!boundary) {
    setStatus('Draw a boundary first');
    return;
  }
  if (!confirmFetchReplaces(store.state.assignment)) {
    setStatus('Fetch cancelled.');
    return;
  }
  setStatus(force ? 'Re-fetching from OpenStreetMap (ignoring cache)…' : 'Fetching from OpenStreetMap…');
  try {
    const r = await fetchOverpass(boundary, { force });
    store.update((s) => {
      s.osm = r.osm;
      const merged = mergeFetched(r.houses, s.houses, s.removed);
      s.houses = merged.houses;
      s.removed = merged.removed;
      s.assignment = {}; // Undo restores this
    });
    const flagged = r.houses.filter((h) => h.flagged).length;
    setStatus(`Loaded: ${visibleHouses(store.state).length} houses (${flagged} without an address, shown in orange)`);
  } catch (e) {
    setStatus(`Fetch failed: ${(e as Error).message}`);
  }
}

document.getElementById('fetch')!.addEventListener('click', () => void fetchHouses(false));
document.getElementById('refetch')!.addEventListener('click', () => void fetchHouses(true));
