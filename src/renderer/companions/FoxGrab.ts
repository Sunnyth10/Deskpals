/**
 * FoxGrabLayer: pick-up / throw / drop for FoxCompanion.
 *
 * Picked up by the scruff: the fox hangs from the back of its neck (sitting skeleton,
 * body inclined), legs dangle and sway, tail and ears hang, small fur pinch at the nape.
 * Feet stay planted while it is lifted and only leave the floor once the legs are fully
 * extended. Dropped: it reuses the in-air pose of the jump, lands with a springy crouch
 * (hips drop, the two-bone legs fold), skids, then gets up.
 */
import { CompanionGrab } from './CompanionGrab';

export type FoxGrabState = 'HELD' | 'FALL' | 'LAND';

export interface FoxGrabInput {
  scale: number; // SCALE
  floorY: number;
  minX: number;
  maxX: number;
  topY: number;
  x: number;
  /** current lift in local units (the fox's hopY) */
  hopY: number;
  dir: number;
}

export interface FoxGrabOutput {
  active: boolean;
  state: FoxGrabState;
  x: number;
  /** local units, ready for FoxCompanion.hopY */
  hopY: number;
  /** vertical velocity in local units/s, up is positive (for hopV) */
  hopV: number;
  airborne: boolean;
  dir: number | null;
  ended: boolean;
  poke: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class FoxGrabLayer {
  public readonly grab = new CompanionGrab({
    mode: 'ground',
    hit: { left: -26, right: 26, top: -54, bottom: 3 },
    pivot: { x: 1.5, y: -36.5 }, // nape, behind the head
    hangTilt: -0.2,
    recoverTime: 0.3,
    swing: { gain: 0.0011, k: 75, c: 5.5 },
    physics: {
      restitution: 0.2, wallRestitution: 0.35, contactFriction: 0.2, slideFriction: 9,
      bounceThreshold: 230, heavyImpactSpeed: 820, maxThrowSpeed: 2000,
    },
  });

  /** 0..1, ramps up as the fox leaves the floor; drives dangling legs, tail and ears. */
  public held = 0;
  private liftLocal = 0;

  public get rot(): number { return this.grab.rot; }
  public get crouch(): number { return this.grab.crouch; }
  public get scruff(): number { return this.grab.held * clamp01(this.liftLocal / 4); }

  public update(step: number, inp: FoxGrabInput): FoxGrabOutput {
    const g = this.grab;
    const s = inp.scale;
    const active = g.update(step, {
      scale: s,
      flip: inp.dir >= 0 ? 1 : -1,
      x: inp.x,
      y: inp.floorY - inp.hopY * s,
      homeY: inp.floorY,
      bottomY: inp.floorY,
      topY: Math.min(inp.floorY - 4, inp.topY),
      minX: inp.minX,
      maxX: inp.maxX,
    });
    this.liftLocal = g.lift / s;
    const isHeld = g.phase === 'lift' || g.phase === 'hold';
    const t = isHeld ? clamp01(this.liftLocal / 4) : 0;
    this.held += (t - this.held) * (1 - Math.exp(-step * (isHeld ? 14 : 10)));
    return {
      active,
      state: isHeld ? 'HELD' : g.phase === 'air' ? 'FALL' : 'LAND',
      x: g.x,
      hopY: this.liftLocal,
      hopV: -g.vy / s,
      airborne: g.phase === 'air',
      dir: g.phase === 'air' && Math.abs(g.vx) > 120 ? (g.vx > 0 ? 1 : -1) : null,
      ended: g.consumeEnded(),
      poke: g.consumePoke(),
    };
  }

  /**
   * Foot target for leg `i` (0 near hind, 1 near front, 2 far hind, 3 far front), local units.
   * Pass the target the fox already computed; get back the dangling / planted version.
   */
  public legTarget(
    i: number, tx: number, ty: number, hipX: number, hipY: number, time: number
  ): { tx: number; ty: number } {
    const hd = this.held;
    if (hd < 0.001) {
      return { tx, ty };
    }
    const front = i % 2 === 1;
    const sw = clamp(this.grab.omega * 0.18, -2.8, 2.8);
    const jig = Math.sin(time * 2.2 + i) * 0.5;
    const dx = front ? hipX + 1.6 + sw * 0.6 + jig * 0.4 : hipX + 0.4 - sw * 0.9 + jig * 0.3;
    const dy = front ? hipY + 15.2 : hipY + 16.2;
    const ground = this.liftLocal - 1.4; // the floor, seen from the sprite
    return {
      tx: lerp(tx, dx, hd),
      // planted on the floor until fully extended, then they let go
      ty: lerp(ty, Math.min(dy, ground), hd),
    };
  }

  /** Tail angle / curl while hanging (tail falls straight down and sways). */
  public tail(ta: number, curl: number): { ta: number; curl: number } {
    const hd = this.held;
    return { ta: lerp(ta, 1.72, hd), curl: lerp(curl, 0.1 / 26, hd) };
  }

  /** Ears pinned back while held. */
  public earBase(base: number): number {
    return lerp(base, -0.55, this.held);
  }

  /** Small fur pinch at the nape. Draw before the head. */
  public drawScruff(ctx: CanvasRenderingContext2D, sx: number, sy: number): void {
    const sc = this.scruff;
    if (sc < 0.02) {
      return;
    }
    const bx = sx - 2.5;
    const by = sy - 4.5;
    const ax = lerp(bx - 0.5, 1.5, sc);
    const ay = lerp(by - 1, -36.5, sc);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx - 3.2, by + 4);
    ctx.quadraticCurveTo(bx - 2, by - 3, ax, ay);
    ctx.quadraticCurveTo(ax + 3, by - 4, bx + 4.2, by + 4.4);
    ctx.closePath();
    ctx.fillStyle = '#e39a52';
    ctx.fill();
    ctx.strokeStyle = '#c47634';
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,226,177,0.6)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(bx - 0.4, by + 3); ctx.quadraticCurveTo(bx - 0.6, by - 2, ax + 0.4, ay + 1.8);
    ctx.stroke();
    ctx.restore();
  }
}
