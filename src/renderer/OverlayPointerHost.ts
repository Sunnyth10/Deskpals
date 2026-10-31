/**
 * OverlayPointerHost
 * Electron replacement for the VS Code CompanionPointerHost. Same idea, different trick:
 * the overlay window is click-through (setIgnoreMouseEvents + forward), so mouse-move events
 * still reach us; when the cursor is over a companion we ask the main process to make the
 * window clickable, and when it leaves (or the companion flies away) we make it click-through
 * again. While a companion is held the window stays interactive and pointer capture keeps
 * pointerup coming even if the cursor leaves the window.
 */
export interface InteractiveCompanion {
  containsPoint(x: number, y: number): boolean;
  pointerDown(x: number, y: number): boolean;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
  cancelInteraction(): void;
  isGrabbed(): boolean;
}

export interface OverlayHostApi {
  setInteractive(interactive: boolean): void;
  openMenu(): void;
}

export class OverlayPointerHost {
  private active: InteractiveCompanion | null = null;
  private interactive = false;
  private cursor: { x: number; y: number } | null = null;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getCompanions: () => readonly InteractiveCompanion[],
    private readonly api: OverlayHostApi,
    private readonly onGrab: (c: InteractiveCompanion) => void,
    private readonly onChange: () => void,
  ) {
    window.addEventListener('mousemove', this.onHover, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onCancel, true);
    window.addEventListener('contextmenu', this.onContext, true);
    window.addEventListener('blur', this.onBlur);
  }

  private topmostAt(x: number, y: number): InteractiveCompanion | null {
    const list = this.getCompanions();
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].containsPoint(x, y)) return list[i];
    }
    return null;
  }

  private setInteractive(on: boolean): void {
    if (on === this.interactive) return;
    this.interactive = on;
    this.api.setInteractive(on);
  }

  /** Re-evaluate hover with the last known cursor position (call once per frame). */
  public recheck(): void {
    if (this.active || !this.cursor) return;
    const over = this.topmostAt(this.cursor.x, this.cursor.y) !== null;
    this.setInteractive(over);
    this.canvas.style.cursor = over ? 'grab' : '';
  }

  public isHolding(): boolean {
    return this.active !== null;
  }

  private readonly onHover = (e: MouseEvent): void => {
    this.cursor = { x: e.clientX, y: e.clientY };
    if (!this.active) this.recheck();
  };

  private readonly onMove = (e: PointerEvent): void => {
    this.cursor = { x: e.clientX, y: e.clientY };
    if (!this.active) return;
    this.active.pointerMove(e.clientX, e.clientY);
    this.canvas.style.cursor = this.active.isGrabbed() ? 'grabbing' : 'grab';
    e.preventDefault();
    this.onChange();
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (this.active || e.button !== 0) return;
    const hero = this.topmostAt(e.clientX, e.clientY);
    if (!hero || !hero.pointerDown(e.clientX, e.clientY)) return;
    this.active = hero;
    this.onGrab(hero);
    e.preventDefault();
    this.setInteractive(true);
    this.canvas.style.cursor = 'grabbing';
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* optional */ }
    this.onChange();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.active) return;
    e.preventDefault();
    this.active.pointerUp();
    this.finish(e);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (!this.active) return;
    this.active.cancelInteraction();
    this.finish(e);
  };

  private readonly onBlur = (): void => {
    if (!this.active) return;
    this.active.cancelInteraction();
    this.finish();
  };

  private readonly onContext = (e: MouseEvent): void => {
    if (this.topmostAt(e.clientX, e.clientY)) {
      e.preventDefault();
      this.api.openMenu();
    }
  };

  private finish(e?: PointerEvent): void {
    if (e) {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    this.active = null;
    this.canvas.style.cursor = '';
    this.recheck();
    this.onChange();
  }

  /** Drop any held companion and go click-through (used when pausing). */
  public release(): void {
    if (this.active) {
      this.active.cancelInteraction();
      this.finish();
    }
    this.setInteractive(false);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    window.removeEventListener('mousemove', this.onHover, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onCancel, true);
    window.removeEventListener('contextmenu', this.onContext, true);
    window.removeEventListener('blur', this.onBlur);
  }
}
