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

/** Levenshtein distance, giving up (returning max + 1) as soon as it is certain to exceed `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1);
    row[0] = i;
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * True when two street names look like the same street spelled differently. Parcel data and OSM
 * disagree by a letter or two on some names ("Haladay" vs "Halliday", "Ellithorp" vs "Ellithorpe"),
 * which otherwise costs those houses their same-street snap preference.
 *
 * Deliberately conservative, because a wrong match snaps a house to the wrong road: both names must
 * be at least 6 characters, start with the same letter and be within 2 edits of each other. That
 * keeps short, genuinely different names apart ("Oak Ln" / "Ash Ln") and never merges two real
 * neighbouring streets unless they are near-homographs.
 */
export function fuzzySameStreet(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false;
  if (a[0] !== b[0]) return false;
  return editDistance(a, b, 2) <= 2;
}

/** normalizeStreet without directional words, for a looser match ("East Mallory Drive" ~ "West Mallory Drive"). */
export function streetBase(s: string): string {
  const t = normalizeStreet(s).split(' ').filter(Boolean);
  const kept = t.filter((x) => !DIR_WORDS.has(x));
  return (kept.length > 0 ? kept : t).join(' ');
}
