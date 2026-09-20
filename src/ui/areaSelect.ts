import L from 'leaflet';

export interface AreaSelectOptions {
  /** true while the add-house tool or the boundary draw tool owns the map: select gestures are then ignored */
  isBlocked: () => boolean;
  /** rectangle released; additive when Shift was held */
  onSelect: (bounds: L.LatLngBounds, additive: boolean) => void;
  /** click without drag (or Esc): clear the selection */
  onClear: () => void;
  onModeChange?: (on: boolean) => void;
}

const MIN_DRAG_PX = 4;
const IGNORE = '.leaflet-control, .leaflet-popup, .select-panel';

/**
 * Rubber-band rectangle selection. Gestures: Ctrl (primary), Alt or Meta + drag; or plain drag while "select mode" is on.
 * The mousedown is intercepted in the capture phase and stopped, so Leaflet's map drag, box-zoom (Shift) and click
 * handlers never see it; Shift-only drag keeps zooming to the box.
 */
export class AreaSelect {
  private mode = false;
  private box: HTMLDivElement | null = null;
  private start: { x: number; y: number } | null = null;
  private moved = false;
  private additive = false;
  private dragWasOn = false;
  private suppressClick = false;

  constructor(private map: L.Map, private opts: AreaSelectOptions) {
    const c = map.getContainer();
    c.addEventListener('mousedown', this.onDown, true);
    c.addEventListener('touchstart', this.onDown, { capture: true, passive: false });
    c.addEventListener('click', this.onClickCapture, true);
    c.addEventListener('contextmenu', this.onContext, true);
    window.addEventListener('keydown', this.onKey);
  }

  get active(): boolean {
    return this.mode;
  }

  setMode(on: boolean): void {
    if (on === this.mode) return;
    this.mode = on;
    this.map.getContainer().classList.toggle('select-mode', on);
    this.opts.onModeChange?.(on);
  }

  /** Toggles select mode; refuses (returns false) while another tool owns the map. */
  toggle(): boolean {
    if (!this.mode && this.opts.isBlocked()) return false;
    this.setMode(!this.mode);
    return true;
  }

  private point(ev: MouseEvent | TouchEvent): { x: number; y: number } | null {
    const src = 'touches' in ev ? (ev.touches[0] ?? ev.changedTouches[0]) : ev;
    if (!src) return null;
    const c = this.map.getContainer();
    const r = c.getBoundingClientRect();
    const x = Math.max(0, Math.min(c.clientWidth, src.clientX - r.left - c.clientLeft));
    const y = Math.max(0, Math.min(c.clientHeight, src.clientY - r.top - c.clientTop));
    return { x, y };
  }

  private onDown = (ev: Event): void => {
    const e = ev as MouseEvent | TouchEvent;
    const touch = e.type === 'touchstart';
    if (this.start) return;
    if (touch) {
      if ((e as TouchEvent).touches.length !== 1) return;
    } else if ((e as MouseEvent).button !== 0) return;
    if ((e.target as Element | null)?.closest?.(IGNORE)) return;
    const m = e as MouseEvent;
    const modifier = !touch && (m.ctrlKey || m.altKey || m.metaKey);
    if (!this.mode && !modifier) return;
    if (this.opts.isBlocked()) return;
    const p = this.point(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    this.start = p;
    this.moved = false;
    this.additive = !!m.shiftKey;
    this.dragWasOn = this.map.dragging.enabled();
    this.map.dragging.disable();
    this.suppressClick = true;
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseup', this.onUp);
    document.addEventListener('touchmove', this.onMove, { passive: false });
    document.addEventListener('touchend', this.onUp);
    document.addEventListener('touchcancel', this.onCancel);
    window.addEventListener('blur', this.onCancel);
  };

  private onMove = (ev: Event): void => {
    if (!this.start) return;
    const p = this.point(ev as MouseEvent | TouchEvent);
    if (!p) return;
    if (ev.cancelable) ev.preventDefault();
    if (!this.moved && Math.hypot(p.x - this.start.x, p.y - this.start.y) < MIN_DRAG_PX) return;
    this.moved = true;
    if (!this.box) {
      this.box = document.createElement('div');
      this.box.className = 'area-select-box';
      this.map.getContainer().append(this.box);
    }
    const s = this.box.style;
    s.left = `${Math.min(p.x, this.start.x)}px`;
    s.top = `${Math.min(p.y, this.start.y)}px`;
    s.width = `${Math.abs(p.x - this.start.x)}px`;
    s.height = `${Math.abs(p.y - this.start.y)}px`;
  };

  private onUp = (ev: Event): void => {
    const start = this.start;
    const end = this.point(ev as MouseEvent | TouchEvent) ?? start;
    const moved = this.moved;
    const additive = this.additive;
    this.finish();
    if (!start || !end) return;
    if (!moved) { this.opts.onClear(); return; }
    const b = L.latLngBounds(this.map.containerPointToLatLng([start.x, start.y]), this.map.containerPointToLatLng([end.x, end.y]));
    this.opts.onSelect(b, additive);
  };

  private onCancel = (): void => this.finish();

  /** Removes the rubber band and listeners and gives dragging back, whatever ended the gesture. */
  private finish(): void {
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mouseup', this.onUp);
    document.removeEventListener('touchmove', this.onMove);
    document.removeEventListener('touchend', this.onUp);
    document.removeEventListener('touchcancel', this.onCancel);
    window.removeEventListener('blur', this.onCancel);
    this.box?.remove();
    this.box = null;
    if (this.start && this.dragWasOn) this.map.dragging.enable();
    this.start = null;
    // The synthetic click after mouseup must not reach Leaflet (no popups, no house added); drop the guard shortly after.
    setTimeout(() => { this.suppressClick = false; }, 60);
  }

  private onClickCapture = (ev: MouseEvent): void => {
    if (!this.suppressClick) return;
    ev.stopPropagation();
    ev.preventDefault();
  };

  private onContext = (ev: Event): void => {
    if (this.start || this.suppressClick) ev.preventDefault(); // Ctrl+click is a right-click on macOS
  };

  private onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    this.finish();
    this.setMode(false);
    this.opts.onClear();
  };
}
