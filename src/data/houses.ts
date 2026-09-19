import { pointInRing, ringCentroid } from '../geo';
import type { House, LatLon } from '../types';
import type { ParsedOverpass } from './parse';

const NON_HOUSE = new Set([
  'garage', 'garages', 'shed', 'service', 'roof', 'carport', 'cabin', 'hut', 'greenhouse', 'barn',
  'industrial', 'commercial', 'retail', 'church', 'school', 'public', 'civic', 'government',
]);
const HOUSE = new Set(['house', 'residential', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'apartments', 'townhouse']);

export function buildHouses(p: ParsedOverpass, boundary: LatLon[] | null): House[] {
  const inside = (pt: LatLon) => !boundary || pointInRing(pt, boundary);
  const houses: House[] = [];
  const consumed = new Set<number>();

  for (const b of p.buildings) {
    const kind = b.tags.building;
    if (kind && NON_HOUSE.has(kind)) continue;
    const c = ringCentroid(b.ring);
    if (!inside(c)) continue;
    const an = p.addrNodes.find((a) => pointInRing(a.pos, b.ring));
    if (an) consumed.add(an.id);
    const num = b.tags['addr:housenumber'] ?? an?.number;
    const street = b.tags['addr:street'] ?? an?.street ?? '';
    const hasAddr = !!num;
    const isHouse = kind ? HOUSE.has(kind) || (kind === 'yes' && hasAddr) : hasAddr;
    if (!hasAddr && !isHouse) continue;
    houses.push({
      id: `w${b.id}`, lat: c.lat, lon: c.lon,
      label: hasAddr ? `${num} ${street}`.trim() : '(no address)',
      street, flagged: !hasAddr, manual: false,
    });
  }

  for (const a of p.addrNodes) {
    if (consumed.has(a.id) || !inside(a.pos)) continue;
    houses.push({
      id: `n${a.id}`, lat: a.pos.lat, lon: a.pos.lon,
      label: `${a.number} ${a.street}`.trim(), street: a.street, flagged: false, manual: false,
    });
  }
  return houses;
}
