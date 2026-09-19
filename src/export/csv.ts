// src/export/csv.ts
import type { House } from '../types';
import type { Model } from '../model';
import type { AppView } from '../app';

export interface CsvRow {
  group: number;
  order: number;
  address: string;
  lat: number;
  lon: number;
}

const NO_ADDRESS = '(no address)';

export function addressOf(house: House, model: Model, index: number): string {
  if (!house.flagged && house.label && house.label !== NO_ADDRESS) return house.label;
  const street = house.street || model.graph.segments[model.snaps[index]?.segment ?? -1]?.street || 'unnamed street';
  return `${street} (no address)`;
}

export function buildRows(view: Pick<AppView, 'houses' | 'model' | 'tours'>): CsvRow[] {
  const { houses, model, tours } = view;
  if (!model) return [];
  const rows: CsvRow[] = [];
  tours.forEach((t, g) => {
    t.order.forEach((idx, k) => {
      const h = houses[idx];
      rows.push({ group: g + 1, order: k + 1, address: addressOf(h, model, idx), lat: h.lat, lon: h.lon });
    });
  });
  return rows;
}

/**
 * Neutralise spreadsheet formula injection: a text value starting with = + @ tab CR, or with - followed by a
 * non-digit, gets a leading single quote. Ordinary addresses (and negative numbers) are left alone.
 */
export function neutralise(s: string): string {
  return /^([=+@\t\r]|-(?!\d))/.test(s) ? `'${s}` : s;
}

const quote = (v: string | number): string => {
  const s = typeof v === 'string' ? neutralise(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: CsvRow[]): string {
  const lines = ['group,order,address,lat,lon', ...rows.map((r) => [r.group, r.order, r.address, r.lat, r.lon].map(quote).join(','))];
  return lines.join('\r\n') + '\r\n';
}
