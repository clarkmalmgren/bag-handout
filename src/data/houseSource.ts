import type { Polygon } from 'geojson';
import type { House, OsmData } from '../types';
import { fetchOverpass, type Cache } from './overpass';
import { fetchKaneHouses } from './kane';

export interface HouseDataOptions { fetchImpl?: typeof fetch; cache?: Cache; force?: boolean }
export interface HouseData { osm: OsmData; houses: House[]; source: 'kane' | 'osm'; note?: string }

/** Roads always come from OpenStreetMap; houses prefer Kane County parcels, falling back to OSM buildings. */
export async function fetchHouseData(polygon: Polygon, opts: HouseDataOptions = {}): Promise<HouseData> {
  const r = await fetchOverpass(polygon, opts);
  let reason: string;
  try {
    const kane = await fetchKaneHouses(polygon, opts);
    if (kane.length > 0) return { osm: r.osm, houses: kane, source: 'kane' };
    reason = 'no residential parcels found';
  } catch (e) {
    reason = (e as Error).message;
  }
  return { osm: r.osm, houses: r.houses, source: 'osm', note: `Kane County parcels unavailable (${reason})` };
}
