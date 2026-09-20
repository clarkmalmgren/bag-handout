import { describe, it, expect } from 'vitest';
import { normalizeStreet, streetBase } from '../src/graph/streetName';

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
