import { describe, expect, it } from 'vitest';
import { addressOf, buildRows, toCsv } from '../src/export/csv';
import type { House } from '../src/types';
import type { Model } from '../src/model';

const house = (id: string, label: string, flagged = false, street = ''): House => ({
  id, lat: 42, lon: -88, label, street, flagged, manual: false,
});

const model = {
  snaps: [{ segment: 0 }, { segment: 0 }, { segment: 1 }, { segment: 2 }],
  graph: { segments: [{ street: 'Oak Ln' }, { street: 'Elm St' }, { street: '' }] },
} as unknown as Model;

describe('toCsv', () => {
  it('writes a header and quotes commas and quotes', () => {
    const csv = toCsv([{ group: 1, order: 1, address: '12 Main, Apt "B"', lat: 42.1, lon: -88.2 }]);
    expect(csv).toBe('group,order,address,lat,lon\r\n1,1,"12 Main, Apt ""B""",42.1,-88.2\r\n');
  });

  it('quotes embedded newlines and leaves plain fields bare', () => {
    const csv = toCsv([{ group: 2, order: 3, address: 'a\nb', lat: 1, lon: 2 }]);
    expect(csv).toBe('group,order,address,lat,lon\r\n2,3,"a\nb",1,2\r\n');
  });

  it('is header-only for no rows', () => {
    expect(toCsv([])).toBe('group,order,address,lat,lon\r\n');
  });
});

describe('addressOf', () => {
  it('returns the label for addressed houses', () => {
    expect(addressOf(house('a', '10 Oak Ln'), model, 0)).toBe('10 Oak Ln');
  });
  it('falls back to the snapped segment street for a "(no address)" label, flagged or not', () => {
    expect(addressOf(house('b', '(no address)', true), model, 2)).toBe('Elm St (no address)');
    expect(addressOf(house('b', '(no address)', false), model, 2)).toBe('Elm St (no address)');
  });
  it('does not throw when the house has no snap', () => {
    expect(addressOf(house('b', '(no address)', true), model, 99)).toBe('unnamed street (no address)');
  });
  it('prefers the house own street, then "unnamed street"', () => {
    expect(addressOf(house('b', '(no address)', true, 'Pine'), model, 2)).toBe('Pine (no address)');
    expect(addressOf(house('b', '(no address)', true), model, 3)).toBe('unnamed street (no address)');
  });
});

describe('buildRows', () => {
  const houses = [house('a', '10 Oak Ln'), house('b', '(no address)', true), house('c', '5 Elm St')];

  it('orders each group by tour order and uses the street for unaddressed houses', () => {
    const rows = buildRows({
      houses,
      model,
      tours: [{ order: [1, 0], length: 10 }, { order: [2], length: 0 }],
    });
    expect(rows.map((r) => [r.group, r.order, r.address])).toEqual([
      [1, 1, 'Oak Ln (no address)'],
      [1, 2, '10 Oak Ln'],
      [2, 1, '5 Elm St'],
    ]);
  });

  it('returns no rows before a solve or without a model', () => {
    expect(buildRows({ houses, model, tours: [] })).toEqual([]);
    expect(buildRows({ houses, model: null, tours: [{ order: [0], length: 0 }] })).toEqual([]);
  });
});
