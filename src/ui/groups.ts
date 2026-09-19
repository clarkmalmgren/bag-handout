import type { GroupStat } from '../stats';

export const GROUP_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
  '#f032e6', '#9a6324', '#008080', '#808000', '#000075', '#e6b800',
];

export function colorOf(group: number): string {
  return group >= 0 ? GROUP_COLORS[group % GROUP_COLORS.length] : '#888888';
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderPanel(
  el: HTMLElement,
  stats: GroupStat[],
  mean: number,
  tolerance: number,
  warnings: string[],
): void {
  const rows = stats
    .map((s) => {
      const off = Math.abs(s.delta) > tolerance;
      const delta = (s.delta > 0 ? '+' : '') + s.delta.toFixed(1);
      return (
        `<div class="group-row" data-group="${s.group}" data-houses="${s.houses}" data-length="${Math.round(s.length)}">` +
        `<span class="chip" style="background:${colorOf(s.group)}"></span>` +
        `<b>Group ${s.group + 1}</b>` +
        `<span>${s.houses} houses</span>` +
        `<span>${(s.length / 1609.344).toFixed(2)} mi</span>` +
        `<span>${Math.round(s.minutes)} min</span>` +
        `<span class="delta${off ? ' bad' : ''}" title="difference from mean ${mean.toFixed(1)}">${delta}</span>` +
        `</div>`
      );
    })
    .join('');
  const warn = warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join('');
  el.innerHTML = warn + rows;
}
