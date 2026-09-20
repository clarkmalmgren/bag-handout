import { describe, it, expect } from 'vitest';
import { editDistance, fuzzySameStreet, normalizeStreet, streetBase } from '../src/graph/streetName';

describe('normalizeStreet', () => {
  it('expands suffixes to one canonical form', () => {
    const pairs: [string, string][] = [
      ['Bealer Cir', 'Bealer Circle'],
      ['Grengs Ln', 'Grengs Lane'],
      ['Mallory Dr', 'Mallory Drive'],
      ['Preston Ct', 'Preston Court'],
      ['Newton Sq', 'Newton Square'],
      ['Crego Pl', 'Crego Place'],
      ['Hughes Rd', 'Hughes Road'],
      ['Main Ave', 'Main Avenue'],
      ['Shannon Blvd', 'Shannon Boulevard'],
      ['Oak Trl', 'Oak Trail'],
      ['Fabyan Pkwy', 'Fabyan Parkway'],
    ];
    for (const [a, b] of pairs) expect(normalizeStreet(a)).toBe(normalizeStreet(b));
    expect(normalizeStreet('Water Way')).toBe('water way');
  });

  it('spells out directionals', () => {
    expect(normalizeStreet('W Mallory Dr')).toBe(normalizeStreet('West Mallory Drive'));
    expect(normalizeStreet('S Mathewson Ln')).toBe(normalizeStreet('South Mathewson Lane'));
    expect(normalizeStreet('N Water Way')).toBe('north water way');
  });

  it('moves a trailing directional to the front', () => {
    expect(normalizeStreet('Mill Creek Cir W')).toBe(normalizeStreet('West Mill Creek Circle'));
  });

  it('ignores case, punctuation and extra spaces', () => {
    expect(normalizeStreet('  ST. CHARLES   RD. ')).toBe('street charles road');
    expect(normalizeStreet("O'Hare-Lane")).toBe(normalizeStreet('o hare lane'));
  });

  it('tolerates empty input', () => {
    expect(normalizeStreet('')).toBe('');
    expect(normalizeStreet('  ,. ')).toBe('');
  });

  it('keeps different streets different', () => {
    expect(normalizeStreet('Preston Cir')).not.toBe(normalizeStreet('Preston Ct'));
    expect(normalizeStreet('E Mallory Dr')).not.toBe(normalizeStreet('W Mallory Dr'));
  });
});

describe('streetBase', () => {
  it('drops directionals', () => {
    expect(streetBase('E Mallory Dr')).toBe(streetBase('West Mallory Drive'));
    expect(streetBase('Mill Creek Cir W')).toBe('mill creek circle');
    expect(streetBase('')).toBe('');
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions and substitutions', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('haladay', 'halliday')).toBe(2);
    expect(editDistance('ellithorp', 'ellithorpe')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
  it('gives up early past the cap', () => {
    expect(editDistance('kitten', 'sitting', 2)).toBe(3);
    expect(editDistance('abcdef', 'zzzzzzzzzz', 2)).toBe(3);
  });
});

describe('fuzzySameStreet', () => {
  it('accepts the known parcel/OSM spelling differences', () => {
    expect(fuzzySameStreet('haladay lane', 'halliday lane')).toBe(true);
    expect(fuzzySameStreet('ellithorp lane', 'ellithorpe lane')).toBe(true);
  });
  it('rejects short names, different first letters and names more than 2 edits apart', () => {
    expect(fuzzySameStreet('oak ln', 'elm ln')).toBe(false);
    expect(fuzzySameStreet('mallory drive', 'gallory drive')).toBe(false);
    expect(fuzzySameStreet('brannon lane', 'branford lane')).toBe(false);
    expect(fuzzySameStreet('', 'anything long')).toBe(false);
  });
  it('accepts identical names and is symmetric', () => {
    expect(fuzzySameStreet('preston circle', 'preston circle')).toBe(true);
    expect(fuzzySameStreet('halliday lane', 'haladay lane')).toBe(true);
  });
});
