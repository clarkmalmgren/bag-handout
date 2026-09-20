// Street names come from two sources that spell the same road differently: Kane County parcels
// ("Bealer Cir", "W Mallory Dr", "Mill Creek Cir W") and OpenStreetMap ways ("Bealer Circle",
// "West Mallory Drive"). Both are reduced to one canonical lowercase form for comparison.

const SUFFIX: Record<string, string> = {
  cir: 'circle', circle: 'circle',
  ln: 'lane', lane: 'lane',
  dr: 'drive', drive: 'drive',
  ct: 'court', court: 'court',
  sq: 'square', square: 'square',
  pl: 'place', place: 'place',
  rd: 'road', road: 'road',
  ave: 'avenue', av: 'avenue', avenue: 'avenue',
  blvd: 'boulevard', boulevard: 'boulevard',
  trl: 'trail', trail: 'trail',
  pkwy: 'parkway', pky: 'parkway', parkway: 'parkway',
  st: 'street', street: 'street',
  ter: 'terrace', terrace: 'terrace',
  hwy: 'highway', highway: 'highway',
  way: 'way',
};

const DIRECTIONAL: Record<string, string> = {
  n: 'north', north: 'north',
  s: 'south', south: 'south',
  e: 'east', east: 'east',
  w: 'west', west: 'west',
  ne: 'northeast', northeast: 'northeast',
  nw: 'northwest', northwest: 'northwest',
  se: 'southeast', southeast: 'southeast',
  sw: 'southwest', southwest: 'southwest',
};

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Canonical street name: lowercase, punctuation stripped, suffixes ("Cir" -> "circle") and directionals
 * ("W" -> "west") spelled out. A trailing directional after the suffix moves to the front, so
 * "Mill Creek Cir W" === "West Mill Creek Circle". Empty input gives "".
 */
export function normalizeStreet(s: string): string {
  const t = tokens(s).map((x) => DIRECTIONAL[x] ?? SUFFIX[x] ?? x);
  if (t.length >= 3 && Object.values(DIRECTIONAL).includes(t[t.length - 1]) && Object.values(SUFFIX).includes(t[t.length - 2])) {
    t.unshift(t.pop()!);
  }
  return t.join(' ');
}

const DIR_WORDS = new Set(Object.values(DIRECTIONAL));

/** normalizeStreet without directional words, for a looser match ("East Mallory Drive" ~ "West Mallory Drive"). */
export function streetBase(s: string): string {
  const t = normalizeStreet(s).split(' ').filter(Boolean);
  const kept = t.filter((x) => !DIR_WORDS.has(x));
  return (kept.length > 0 ? kept : t).join(' ');
}
