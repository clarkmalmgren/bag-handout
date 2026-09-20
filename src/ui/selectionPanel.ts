import { colorOf } from './groups';

export interface SelectionInfo {
  count: number;
  groups: number;
  counts: number[];
  unassigned: number;
  /** false before any assignment exists: hide the group buttons */
  canMove: boolean;
  allLocked: boolean;
}

export interface SelectionHandlers {
  onMove(group: number): void;
  onToggleLock(): void;
  onClear(): void;
}

/** Fills the floating selection panel (text via DOM APIs only). Hidden when nothing is selected. */
export function renderSelectionPanel(el: HTMLElement, info: SelectionInfo | null, h: SelectionHandlers): void {
  el.replaceChildren();
  el.hidden = !info || info.count === 0;
  if (!info || info.count === 0) return;
  const parts: string[] = [];
  info.counts.forEach((n, g) => { if (n > 0) parts.push(`G${g + 1}: ${n}`); });
  if (info.unassigned > 0) parts.push(`unassigned: ${info.unassigned}`);
  const title = document.createElement('div');
  title.className = 'select-title';
  title.textContent = `${info.count} house${info.count === 1 ? '' : 's'} selected (by current group: ${parts.join(', ')})`;
  el.append(title);

  const row = document.createElement('div');
  row.className = 'house-groups';
  if (!info.canMove) {
    row.textContent = 'Not assigned yet: Solve first, then move them to a group here.';
  } else {
    for (let g = 0; g < info.groups; g++) {
      const b = document.createElement('button');
      b.textContent = String(g + 1);
      b.title = `Move all selected houses to group ${g + 1}`;
      b.style.borderLeft = `10px solid ${colorOf(g)}`;
      b.addEventListener('click', () => h.onMove(g));
      row.append(b);
    }
  }
  el.append(row);

  const acts = document.createElement('div');
  acts.className = 'select-actions';
  const lock = document.createElement('button');
  lock.textContent = info.allLocked ? 'Unlock' : 'Lock';
  lock.title = info.allLocked ? 'Let Re-optimize move these houses again' : 'Re-optimize will not move these houses';
  lock.addEventListener('click', h.onToggleLock);
  const clear = document.createElement('button');
  clear.textContent = 'Clear selection';
  clear.addEventListener('click', h.onClear);
  acts.append(lock, clear);
  el.append(acts);
}
