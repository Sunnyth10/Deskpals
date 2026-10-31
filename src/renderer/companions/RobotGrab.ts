/**
 * RobotGrabLayer: pick-up / throw / drop for RobotCompanion (hovering droid).
 * Held by the top of the head: thrusters cut out, arms hang, antenna whips with the swing.
 * Thrown: it tumbles with flickering thrusters (FLY), bumps off walls with sparks, and when it
 * reaches the floor it touches down in a burst of dust (no bounce). Then the stabilisers
 * flare (RECOVER) and it floats back to its station and locks in.
 */
import { CompanionGrab } from './CompanionGrab';

export type RobotGrabState = 'HELD' | 'FLY' | 'RECOVER';

export interface RobotGrabInput {
  scale: number;
  x: number;
  y: number;
  /** omit to stay where it was dropped (free roaming) */
  homeX?: number;
  homeY: number;
  /** lowest centre y: nozzle touching the floor */
  bottomY: number;
  topY: number;
  minX: number;
  maxX: number;
}

export interface RobotGrabOutput {
  active: boolean;
  state: RobotGrabState;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  speed: number;
  ended: boolean;
  poke: boolean;
}

export class RobotGrabLayer {
  public readonly grab = new CompanionGrab({
    mode: 'float',
    hit: { left: -15, right: 15, top: -26, bottom: 18 },
    pivot: { x: 0, y: -18 },
    liftTime: 0.28,
    recoverTime: 0.5,
    swing: { gain: 0.0007, k: 45, c: 6 },
    floatReturn: { k: 20, c: 8.5, speedCap: 1400, coast: 0.28, spin: 0.0035, spinMax: 4, stabilise: 1, gravity: 1100 },
    physics: { heavyImpactSpeed: 520 }, // floaters squash easily on touch-down
  });
  private flying = false;

  public update(step: number, inp: RobotGrabInput): RobotGrabOutput {
    const g = this.grab;
    const active = g.update(step, {
      scale: inp.scale, flip: 1, x: inp.x, y: inp.y,
      homeX: inp.homeX, homeY: inp.homeY, bottomY: inp.bottomY, topY: inp.topY,
      minX: inp.minX, maxX: inp.maxX,
    });
    const speed = Math.hypot(g.vx, g.vy) / inp.scale;
    if (g.phase === 'return') {
      if (speed > 70) { this.flying = true; } else if (speed < 40) { this.flying = false; }
    } else {
      this.flying = false;
    }
    return {
      active,
      state: g.isGrabbed() ? 'HELD' : this.flying ? 'FLY' : 'RECOVER',
      x: g.x, y: g.y, rot: g.rot, vx: g.vx, vy: g.vy, speed,
      ended: g.consumeEnded(),
      poke: g.consumePoke(),
    };
  }
}
