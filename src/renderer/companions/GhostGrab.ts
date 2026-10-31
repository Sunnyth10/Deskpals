/**
 * GhostGrabLayer: pick-up / throw / drop for GhostCompanion (floating).
 * Held by the top of the dome (pinched into a little peak), the skirt trails.
 * Thrown: it tumbles and streams through the air (FLY), bumps softly off walls, and when it
 * reaches the floor it touches down with a squash and a splash of mist (no bounce). Then it
 * floats gently back to its natural hover height with a relieved face (FLOAT).
 */
import { CompanionGrab } from './CompanionGrab';

export type GhostGrabState = 'HELD' | 'FLY' | 'FLOAT';

export interface GhostGrabInput {
  scale: number;
  x: number;
  y: number;
  /** natural resting y (hover height + bob) */
  homeY: number;
  /** lowest centre y: skirt touching the floor */
  bottomY: number;
  topY: number;
  minX: number;
  maxX: number;
}

export interface GhostGrabOutput {
  active: boolean;
  state: GhostGrabState;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  /** speed in local units/s */
  speed: number;
  ended: boolean;
  poke: boolean;
}

export class GhostGrabLayer {
  public readonly grab = new CompanionGrab({
    mode: 'float',
    hit: { left: -16, right: 16, top: -22, bottom: 22 },
    pivot: { x: 0, y: -17 },
    liftTime: 0.3,
    recoverTime: 0.5,
    swing: { gain: 0.0007, k: 40, c: 5.5 },
    floatReturn: { k: 18, c: 8, speedCap: 1400, coast: 0.3, spin: 0, spinMax: 0, stabilise: 0.9, gravity: 1100 }, // no tumble: a natural lean only
    physics: { heavyImpactSpeed: 520 }, // floaters squash easily on touch-down
  });
  private flying = false;

  /** 0..1 pinch of the dome while held. */
  public get pinch(): number { return this.grab.held; }

  public update(step: number, inp: GhostGrabInput): GhostGrabOutput {
    const g = this.grab;
    const active = g.update(step, {
      scale: inp.scale, flip: 1, x: inp.x, y: inp.y,
      homeY: inp.homeY, bottomY: inp.bottomY, topY: inp.topY, minX: inp.minX, maxX: inp.maxX,
    });
    const speed = Math.hypot(g.vx, g.vy) / inp.scale;
    if (g.phase === 'return') {
      if (speed > 70) { this.flying = true; } else if (speed < 40) { this.flying = false; }
    } else {
      this.flying = false;
    }
    return {
      active,
      state: g.isGrabbed() ? 'HELD' : this.flying ? 'FLY' : 'FLOAT',
      x: g.x, y: g.y, rot: g.rot, vx: g.vx, vy: g.vy, speed,
      ended: g.consumeEnded(),
      poke: g.consumePoke(),
    };
  }
}
