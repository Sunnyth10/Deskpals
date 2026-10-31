/**
 * CatGrabLayer: pick-up / throw / drop for CatCompanion.
 *
 * Picked up by the scruff: it hangs from the nape with its body inclined, hind legs
 * dangling and swaying, front paws tucked, tail hanging, ears back. Legs stay planted
 * and extend until they run out of length, then the paws leave the floor (no floating).
 * Dropped: paws reach down, cat lands with a springy crouch (legs bend), slides, gets up.
 */
import { CompanionGrab } from './CompanionGrab';

export type CatGrabState = 'HELD' | 'FALL' | 'LAND';

export interface CatGrabInput {
  scale: number;
  floorY: number;
  minX: number;
  maxX: number;
  /** top limit for the feet (bounds.y + sprite height) */
  topY: number;
  x: number;
  hopY: number;
  /** cat is drawn mirrored when `facingRight` */
  facingRight: boolean;
}

export interface CatGrabOutput {
  active: boolean;
  state: CatGrabState;
  x: number;
  hopY: number;
  /** set while thrown fast: the cat turns to face its direction of travel */
  faceRight: boolean | null;
  ended: boolean;
  poke: boolean;
}

export interface CatPaws {
  fnX: number; fnY: number; ffX: number; ffY: number;
  hnX: number; hnY: number; hfX: number; hfY: number;
}
export interface CatBody {
  chestX: number; chestY: number; chestR: number;
  hipX: number; hipY: number; hipR: number;
  headX: number; headY: number;
}

const PAW_Y = -4.2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class CatGrabLayer {
  public readonly grab = new CompanionGrab({
    mode: 'ground',
    hit: { left: -20, right: 20, top: -46, bottom: 3 },
    pivot: { x: 8, y: -27 }, // the nape, just behind the head
    hangTilt: -0.3,
    recoverTime: 0.3,
    swing: { gain: 0.0011, k: 70, c: 5.5 },
    physics: {
      restitution: 0.16, wallRestitution: 0.3, contactFriction: 0.25, slideFriction: 10,
      bounceThreshold: 240, heavyImpactSpeed: 820, maxThrowSpeed: 1900,
    },
  });

  /** 0..1 how much the legs hang (geometric: grows as the cat leaves the floor). */
  private hang = 0;
  /** 0..1 thrown and airborne (flailing paws). */
  private fall = 0;
  private lastLift = 0;

  public get rot(): number { return this.grab.rot; }
  /** Landing compression for body lowering (0..~1.4). */
  public get crouch(): number { return this.grab.crouch; }
  /** Multiply the leg bend with this so the legs visibly fold on landing. */
  public legBend(base: number): number { return base * (1 + Math.max(0, this.grab.crouch) * 2.4); }
  /** 0..1 scruff pinch strength. */
  public get scruff(): number { return this.grab.held * clamp01(this.lastLift / 5); }

  public update(step: number, inp: CatGrabInput): CatGrabOutput {
    const g = this.grab;
    const s = inp.scale;
    const active = g.update(step, {
      scale: s,
      flip: inp.facingRight ? -1 : 1,
      x: inp.x,
      y: inp.floorY - inp.hopY,
      homeY: inp.floorY,
      bottomY: inp.floorY,
      topY: Math.min(inp.floorY - 4, inp.topY),
      minX: inp.minX,
      maxX: inp.maxX,
    });

    this.lastLift = g.lift / s;
    const held = g.phase === 'lift' || g.phase === 'hold';
    const hangT = held ? clamp01(this.lastLift / 10) : 0;
    this.hang += (hangT - this.hang) * (1 - Math.exp(-step * (held ? 18 : 14)));
    const fallT = g.phase === 'air' && g.bounces === 0 ? 1 : 0;
    this.fall += (fallT - this.fall) * (1 - Math.exp(-step * 10));

    return {
      active,
      state: held ? 'HELD' : g.phase === 'air' ? 'FALL' : 'LAND',
      x: g.x,
      hopY: g.lift,
      faceRight: g.phase === 'air' && Math.abs(g.vx) > 140 ? g.vx > 0 : null,
      ended: g.consumeEnded(),
      poke: g.consumePoke(),
    };
  }

  /**
   * Adjust the four paw targets (local units) for dangling, falling and landing.
   * Call after the normal paw positions are computed, before the legs are drawn.
   */
  public adjustPaws(p: CatPaws, b: CatBody, time: number): void {
    const g = this.grab;
    const hg = this.hang;
    if (hg > 0.001) {
      const sw = clamp(g.omega * 0.16, -2.6, 2.6); // legs lag the swing
      const jig = Math.sin(time * 2.3) * 0.5;
      const groundLocal = this.lastLift + PAW_Y; // the floor, seen from the sprite
      const front = b.chestY + b.chestR + 2.2; // front paws tucked under the chest
      const hind = b.hipY + b.hipR + 3.2; // hind legs hang long
      p.fnX = lerp(p.fnX, b.chestX - 3 + sw * 0.7 + jig * 0.4, hg);
      p.ffX = lerp(p.ffX, b.chestX - 7.5 + sw * 0.5 - jig * 0.3, hg);
      p.hnX = lerp(p.hnX, b.hipX - 1.5 + sw + jig * 0.3, hg);
      p.hfX = lerp(p.hfX, b.hipX + 3 + sw * 0.8 - jig * 0.3, hg);
      // paws stay on the floor until the legs are fully extended, then they let go
      p.fnY = Math.min(front, groundLocal);
      p.ffY = Math.min(front + 1.4, groundLocal);
      p.hnY = Math.min(hind, groundLocal);
      p.hfY = Math.min(hind + 1.2, groundLocal);
    }
    const fl = this.fall;
    if (fl > 0.001) {
      const f = Math.sin(time * 21) * fl;
      p.fnY -= fl * 1.4 + f * 1.8; p.ffY -= fl * 1.4 - f * 1.8;
      p.hnY -= fl * 1.0 - f * 1.4; p.hfY -= fl * 1.0 + f * 1.4;
      p.fnX -= fl * 2 + f * 1.2; p.ffX += fl * 1.5 - f * 1.2;
      p.hnX -= fl * 1.5 - f; p.hfX += fl * 2 + f;
    }
    const cr = Math.max(0, g.crouch);
    if (cr > 0.001) {
      p.fnX -= cr * 1.6; p.ffX -= cr * 1.6;
      p.hnX += cr * 1.4; p.hfX += cr * 1.4;
    }
  }

  /** Small fur peak where the scruff is pinched. Draw before the head. */
  public drawScruff(ctx: CanvasRenderingContext2D, b: CatBody): void {
    const sc = this.scruff;
    if (sc < 0.02) {
      return;
    }
    const bx = lerp(b.chestX, b.headX, 0.6) + 6.5;
    const by = lerp(b.chestY, b.headY, 0.55) + 2;
    const ax = lerp(bx + 1, 8, sc);
    const ay = lerp(by - 1, -27, sc);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx - 3, by + 3.2);
    ctx.quadraticCurveTo(bx - 0.5, by - 1.5, ax, ay);
    ctx.quadraticCurveTo(ax + 1.8, by - 0.5, bx + 4.2, by + 3.6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#dbb4c5';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(214,170,190,0.75)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(bx - 0.6, by + 2.4); ctx.quadraticCurveTo(bx + 0.4, by - 1, ax - 0.4, ay + 1.6);
    ctx.moveTo(bx + 1.8, by + 2.6); ctx.quadraticCurveTo(bx + 2.2, by - 0.4, ax + 0.6, ay + 2.2);
    ctx.stroke();
    ctx.restore();
  }
}
