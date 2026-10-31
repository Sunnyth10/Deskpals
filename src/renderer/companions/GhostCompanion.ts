import { IEntity, LivingEventType, ZoneBounds, ZoneType } from '../../core/types';
import { clampCompanionX, companionXBounds } from './CompanionBounds';
import { ParticleEngine } from '../../engine/particles/ParticleEngine';
import { GhostGrabLayer } from './GhostGrab';

export type GhostState = 'IDLE' | 'DRIFT' | 'CURIOUS' | 'ENERGIZE' | 'SCARED' | 'CHEER' | 'HELD' | 'FLY' | 'FLOAT';

const TAU = Math.PI * 2;
const DESIGN_HEIGHT = 62;
const TOP = -19;
const BOTTOM = 15;
const R = 13;
const ROWS = 18;
const SPINE = 8;
const TIPS = 5;
const MAX_PARTICLES = 150;

type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const rgba = (c: RGB, a: number): string =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${clamp01(a).toFixed(3)})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const approachRgb = (cur: RGB, target: RGB, k: number): void => {
  cur[0] += (target[0] - cur[0]) * k;
  cur[1] += (target[1] - cur[1]) * k;
  cur[2] += (target[2] - cur[2]) * k;
};

interface Expr {
  eye: number; happy: number; smile: number; open: number;
  wave: number; brow: number; blush: number; fear: number;
}

const EXPR: Record<GhostState, Expr> = {
  IDLE: { eye: 1, happy: 0, smile: 0.45, open: 0, wave: 0, brow: 0, blush: 0.3, fear: 0 },
  DRIFT: { eye: 1, happy: 0, smile: 0.6, open: 0, wave: 0, brow: 0.1, blush: 0.35, fear: 0 },
  CURIOUS: { eye: 1.12, happy: 0, smile: 0.1, open: 0.35, wave: 0, brow: 0.6, blush: 0.3, fear: 0 },
  ENERGIZE: { eye: 1.15, happy: 0, smile: 0.2, open: 0.45, wave: 0, brow: 0.4, blush: 0.4, fear: 0 },
  SCARED: { eye: 1.4, happy: 0, smile: -0.6, open: 0.6, wave: 1, brow: -1, blush: 0.05, fear: 1 },
  CHEER: { eye: 1, happy: 1, smile: 1, open: 0.75, wave: 0, brow: 0.3, blush: 0.8, fear: 0 },
  HELD: { eye: 1.2, happy: 0, smile: 0, open: 0.55, wave: 0.15, brow: 0.6, blush: 0.3, fear: 0.25 },
  FLY: { eye: 1.3, happy: 0.35, smile: 0.9, open: 0.6, wave: 0.2, brow: 0.5, blush: 0.5, fear: 0.1 },
  FLOAT: { eye: 1, happy: 0.55, smile: 1, open: 0.25, wave: 0, brow: 0.3, blush: 0.6, fear: 0 },
};
const EXPR_RELIEF: Expr = { eye: 1, happy: 0.65, smile: 1, open: 0.3, wave: 0, brow: 0.3, blush: 0.6, fear: 0 };

const HAND: Record<GhostState, [number, number]> = {
  IDLE: [13, 9],
  DRIFT: [12, 7],
  CURIOUS: [11, 3],
  ENERGIZE: [17, -3],
  SCARED: [4.2, -5.5],
  CHEER: [15, -14],
  HELD: [8, -12],
  FLY: [14, -6],
  FLOAT: [13, 8],
};

const TINT: Record<GhostState, RGB> = {
  IDLE: [236, 246, 255],
  DRIFT: [236, 246, 255],
  CURIOUS: [238, 248, 255],
  ENERGIZE: [232, 250, 255],
  SCARED: [208, 232, 228],
  CHEER: [255, 240, 248],
  HELD: [238, 248, 255],
  FLY: [240, 250, 255],
  FLOAT: [236, 246, 255],
};
const AURA: Record<GhostState, RGB> = {
  IDLE: [140, 185, 255],
  DRIFT: [140, 185, 255],
  CURIOUS: [160, 190, 255],
  ENERGIZE: [110, 232, 255],
  SCARED: [120, 160, 190],
  CHEER: [255, 208, 120],
  HELD: [170, 200, 255],
  FLY: [150, 205, 255],
  FLOAT: [140, 185, 255],
};
const HOVER: Record<GhostState, number> = {
  IDLE: 11, DRIFT: 12, CURIOUS: 13, ENERGIZE: 15, SCARED: 4, CHEER: 14, HELD: 11, FLY: 11, FLOAT: 11,
};

const WISP_COLORS: RGB[] = [[120, 232, 255], [170, 150, 255], [255, 255, 255], [130, 255, 220]];
const CONFETTI_COLORS: RGB[] = [[255, 214, 120], [255, 160, 200], [150, 255, 210], [160, 200, 255], [255, 255, 255]];

type Kind = 'wisp' | 'spark' | 'mist' | 'drip' | 'orb' | 'star' | 'ring' | 'shock' | 'sweat';

interface Particle {
  kind: Kind;
  x: number; y: number;
  vx: number; vy: number;
  life: number; max: number;
  size: number;
  r: number; a: number; w: number;
  col: RGB;
  trail: number[];
}

export class GhostCompanion implements IEntity {
  public readonly id: string;
  public readonly zone: ZoneType;
  public x: number;
  public y: number;
  public isDisposed = false;

  public state: GhostState = 'IDLE';
  private stateTimer = 0;
  private stateDuration = 4;

  private readonly maxScale: number;
  private scale = 1;
  private floorY = 0;
  private bounds?: ZoneBounds;
  private time = Math.random() * 10;

  private vx = 0;
  private kickVx = 0;
  private targetX = 0;
  private hover = 11;
  private hoverVel = 0;
  private tilt = 0;
  private spinAngle = 0;
  private spX: number[] = new Array<number>(SPINE + 1).fill(0);

  private tint: RGB = [...TINT.IDLE];
  private aura: RGB = [...AURA.IDLE];
  private energy = 0;
  private pulse = 0;
  private flash = 0;
  private fear = 0;
  private released = false;
  private spawnAcc = 0;
  private exclaim = 0;

  private eye = 1;
  private happy = 0;
  private smile = 0.45;
  private open = 0;
  private wave = 0;
  private brow = 0;
  private blush = 0.3;
  private lookX = 0;
  private lookY = 0;
  private lookTX = 0;
  private lookTY = 0;
  private lookTimer = 0;
  private blinkTimer = 2;
  private blinkProgress = 0;
  private hands = { lx: -13, ly: 9, rx: 13, ry: 9 };

  private dripTimer = 1.2;
  private mistAcc = 0;

  private particles: Particle[] = [];
  private particleEngine?: ParticleEngine;

  // Interaction (pick up / throw / drop)
  private readonly gl = new GhostGrabLayer();
  private interactive = true;
  private queuedEvent: LivingEventType | null = null;
  private grabbedLast = false;

  private rowY = new Array<number>(ROWS + 1).fill(0);
  private rowR = new Array<number>(ROWS + 1).fill(0);
  private rowL = new Array<number>(ROWS + 1).fill(0);
  private notchX = new Array<number>(TIPS + 1).fill(0);
  private notchY = new Array<number>(TIPS + 1).fill(0);
  private tipX = new Array<number>(TIPS).fill(0);
  private tipLen = new Array<number>(TIPS).fill(0);

  constructor(
    id: string,
    zone: ZoneType,
    startX: number,
    startY: number,
    particleEngine?: ParticleEngine,
    maxScale = 1.3
  ) {
    this.id = id;
    this.zone = zone;
    this.x = startX;
    this.y = startY;
    this.targetX = startX;
    this.particleEngine = particleEngine;
    this.maxScale = maxScale;
  }

  public setParticleEngine(engine: ParticleEngine): void {
    this.particleEngine = engine;
  }

  /* ---- pointer interaction ---- */
  public containsPoint(px: number, py: number): boolean { return !this.isDisposed && this.interactive && this.gl.grab.containsPoint(px, py); }
  public pointerDown(px: number, py: number): boolean { return !this.isDisposed && this.interactive && this.gl.grab.pointerDown(px, py); }
  public pointerMove(px: number, py: number): void { this.gl.grab.pointerMove(px, py); }
  public pointerUp(): void { this.gl.grab.pointerUp(); }
  public cancelInteraction(): void { this.gl.grab.cancelInteraction(); }
  public isGrabbed(): boolean { return this.gl.grab.isGrabbed(); }
  public isPointerEngaged(): boolean { return this.gl.grab.isPointerEngaged(); }
  public isAirborne(): boolean { return this.gl.grab.active; }
  public setInteractive(on: boolean): void { this.interactive = on; this.gl.grab.setInteractive(on); }
  public setReducedMotion(v: boolean | null): void { this.gl.grab.reducedMotion = v; }

  public reactToEvent(eventName: LivingEventType): void {
    if (this.isDisposed) {
      return;
    }
    if (this.gl.grab.active) { this.queuedEvent = eventName; return; }
    const s = this.scale;

    if (eventName === 'save') {
      this.setState('ENERGIZE', 3.8);
      this.hoverVel += 35;
      this.particleEngine?.spawnGlitterBurst(this.x, this.y - 10 * s, 3, ['#7dd3fc', '#ffffff']);
    } else if (eventName === 'buildSuccess') {
      this.setState('CHEER', 4.4);
      this.hoverVel += 110;
      this.pulse = 0.6;
      this.flash = 0.4;
      this.spawnRing(1, 46, 0.9, [255, 214, 120]);
      for (let i = 0; i < 26; i++) {
        const an = rand(0, TAU);
        const sp = rand(30, 95);
        this.spawn('orb', {
          x: this.x, y: this.y + 3 * s,
          vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 40,
          life: rand(1.8, 3.2), max: 3.2, size: rand(1.4, 2.6) * s,
          a: rand(0, TAU), col: pick(CONFETTI_COLORS),
        });
      }
      for (let i = 0; i < 8; i++) {
        const an = rand(0, TAU);
        const rr = rand(22, 46) * s;
        this.spawn('star', {
          x: this.x + Math.cos(an) * rr, y: this.y + Math.sin(an) * rr * 0.8,
          life: rand(0.8, 1.6), max: 1.6, size: rand(2.5, 5) * s, a: rand(0, TAU),
          col: pick(CONFETTI_COLORS),
        });
      }
      this.particleEngine?.spawnGlitterBurst(this.x, this.y, 8, ['#fbbf24', '#f9a8d4', '#86efac', '#ffffff']);
    } else if (eventName === 'buildError') {
      this.setState('SCARED', 3.8);
      this.hoverVel += 150;
      this.kickVx = (Math.random() < 0.5 ? -1 : 1) * rand(70, 110);
      this.exclaim = 1.4;
      this.fear = Math.max(this.fear, 0.6);
      this.flash = 0.6;
      for (let i = 0; i < 12; i++) {
        this.spawn('shock', {
          x: this.x, y: this.y - 4 * s,
          a: (i / 12) * TAU + rand(-0.1, 0.1), r: 20 * s, vy: 120 * s,
          life: 0.45, max: 0.45, size: rand(5, 9) * s, col: [255, 120, 140],
        });
      }
    }
  }

  public update(dt: number, bounds: ZoneBounds): void {
    if (this.isDisposed) {
      return;
    }

    const step = clamp(dt, 0, 0.05);
    this.bounds = bounds;
    this.time += step;
    this.stateTimer += step;
    this.scale = clamp((bounds.height - 4) / DESIGN_HEIGHT, 0.5, this.maxScale);
    this.floorY = bounds.y + bounds.height - 4;

    const grabbed = this.updateGrab(step, bounds);
    if (!grabbed) {
      this.runStateLogic(step);
      this.updateMotion(step, bounds);
    }
    this.updateSpine(step);
    this.updateStateAppearance(step);
    this.updateFace(step);
    this.updateAmbient(step);
    this.updateParticles(step);

    if (!grabbed) {
      this.y = this.naturalY();
    }
  }

  /** Body centre sits above the floor by hover + half the body height. */
  private naturalY(): number {
    const bob = Math.sin(this.time * 1.6) * 2.2 + Math.sin(this.time * 0.9 + 1) * 1;
    return this.floorY - (this.hover + bob + 21) * this.scale;
  }

  /** Runs the pick-up / throw / float-back driver. Returns true while it controls the ghost. */
  private updateGrab(step: number, bounds: ZoneBounds): boolean {
    const s = this.scale;
    const { minX, maxX } = companionXBounds('ghost', bounds);
    const g = this.gl.grab;
    const o = this.gl.update(step, {
      scale: s, x: this.x, y: this.y, homeY: this.naturalY(),
      bottomY: this.floorY - 21 * s, topY: bounds.y + 21 * s, minX, maxX,
    });

    if (o.poke && !o.active) {
      this.setState('CURIOUS', 2.2);
      this.hoverVel += 70; this.pulse = 0.5; this.flash = 0.3;
      for (let i = 0; i < 6; i++) {
        const an = rand(0, TAU);
        this.spawn('orb', {
          x: this.x + Math.cos(an) * 20 * s, y: this.y + Math.sin(an) * 18 * s,
          vx: Math.cos(an) * rand(8, 20), vy: rand(-24, -8),
          life: rand(1, 1.6), max: 1.6, size: rand(1, 1.8) * s, a: rand(0, TAU), col: pick(CONFETTI_COLORS),
        });
      }
    }

    if (o.active) {
      if (this.state !== o.state) {
        this.setState(o.state, 999);
        if (o.state === 'HELD') { this.pulse = 0.35; this.flash = 0.3; }
        if (o.state === 'FLY') { this.pulse = 0.3; this.flash = 0.25; }
        if (o.state === 'FLOAT') { this.pulse = 0.2; }
      }
      this.x = o.x; this.y = o.y; this.vx = o.vx; this.kickVx = 0; this.tilt = o.rot; this.spinAngle = 0;

      // touch-down: squash (driver spring), splash of mist, ripple on the floor, glow
      if (g.landed > 0) {
        const k = clamp(g.intensity, 0.2, 1.4);
        this.pulse = Math.max(this.pulse, 0.5 * k); this.flash = Math.max(this.flash, 0.35 * k);
        this.spawnRing(1, 22 + 26 * k, 0.8, [150, 205, 255]);
        this.spawnRing(1, 12 + 16 * k, 0.55, [255, 255, 255]);
        for (let i = 0; i < 4 + Math.round(6 * k); i++) {
          const dir = Math.random() < 0.5 ? -1 : 1;
          this.spawn('mist', {
            x: this.x + dir * rand(4, 12) * s, y: this.floorY - rand(1, 5) * s,
            vx: dir * rand(14, 46) * (0.6 + k), vy: -rand(2, 12),
            life: rand(0.6, 1.1), max: 1.1, size: rand(4, 7) * s, col: [190, 225, 255],
          });
        }
        for (let i = 0; i < 3 + Math.round(4 * k); i++) {
          this.spawn('spark', {
            x: this.x + rand(-10, 10) * s, y: this.floorY - 2 * s,
            vx: rand(-40, 40), vy: -rand(20, 60) * k,
            life: rand(0.4, 0.8), max: 0.8, size: rand(0.8, 1.5) * s, col: pick(WISP_COLORS),
          });
        }
        this.exclaim = 0;
      }
      // caught itself after sinking: soft shimmer ring and glow
      if (g.caught > 0 && g.landed === 0) {
        this.spawnRing(0, 26, 0.5, [150, 205, 255]);
        this.pulse = Math.max(this.pulse, 0.45); this.flash = Math.max(this.flash, 0.3);
        for (let i = 0; i < 6; i++) {
          const an = rand(0, TAU);
          this.spawn('spark', { x: this.x + Math.cos(an) * 12 * s, y: this.y + Math.sin(an) * 12 * s,
            vx: Math.cos(an) * rand(10, 30), vy: Math.sin(an) * rand(10, 30) - 10, life: rand(0.4, 0.8), max: 0.8, size: rand(0.8, 1.5) * s, col: pick(WISP_COLORS) });
        }
      }
      // soft wall bump: flash, sparks, the whole body ripples away from the wall
      if (g.wallImpact > 0) {
        const wx = this.x - g.wallSide * 12 * s;
        this.flash = Math.max(this.flash, 0.4); this.pulse = Math.max(this.pulse, 0.4);
        this.spawnRing(0, 20, 0.4, [255, 255, 255]);
        for (let i = 0; i < 6; i++) {
          this.spawn('spark', {
            x: wx, y: this.y + rand(-10, 8) * s,
            vx: g.wallSide * rand(20, 70), vy: rand(-30, 20),
            life: rand(0.3, 0.6), max: 0.6, size: rand(0.8, 1.4) * s, col: [255, 255, 255],
          });
        }
        for (let i = 1; i <= SPINE; i++) { this.spX[i] += g.wallSide * 2.2 * (i / SPINE); }
      }
    } else if (this.grabbedLast) {
      this.setState('IDLE', rand(2, 4));
      this.vx = 0; this.hoverVel = 0; this.spinAngle = 0;
      this.spawnRing(1, 34, 0.7, [140, 185, 255]);
      if (this.queuedEvent) {
        const e = this.queuedEvent;
        this.queuedEvent = null;
        this.reactToEvent(e);
      }
    }
    this.grabbedLast = o.active;
    return o.active;
  }

  private setState(next: GhostState, duration: number): void {
    this.state = next;
    this.stateTimer = 0;
    this.stateDuration = duration;
    this.released = false;
    this.spawnAcc = 0;
    this.lookTimer = 0;
  }

  private runStateLogic(step: number): void {
    const t = this.stateTimer;
    const s = this.scale;

    switch (this.state) {
      case 'ENERGIZE':
        if (t < 2.1) {
          this.spawnAcc += step * 16;
          while (this.spawnAcc >= 1) {
            this.spawnAcc -= 1;
            this.spawnWisp();
          }
        }
        this.energy = Math.min(1.1, this.energy + step * 0.12);
        if (!this.released && t >= 2.6) {
          this.released = true;
          this.releaseEnergy();
        }
        break;

      case 'SCARED':
        if (t < 1.8) {
          this.spawnAcc += step * 4;
          while (this.spawnAcc >= 1) {
            this.spawnAcc -= 1;
            const side = Math.random() < 0.5 ? -1 : 1;
            this.spawn('sweat', {
              x: this.x + side * 9 * s, y: this.y - 10 * s,
              vx: side * rand(14, 34) * s, vy: rand(-40, -15) * s,
              life: 1.1, max: 1.1, size: rand(1.1, 1.7) * s, col: [190, 235, 255],
            });
          }
        }
        break;

      case 'CHEER':
        if (t < 3) {
          this.spawnAcc += step * 6;
          while (this.spawnAcc >= 1) {
            this.spawnAcc -= 1;
            const an = rand(0, TAU);
            this.spawn('orb', {
              x: this.x + Math.cos(an) * 26 * s, y: this.y + Math.sin(an) * 22 * s,
              vx: Math.cos(an) * rand(8, 24), vy: rand(-26, -8),
              life: rand(1.2, 2.2), max: 2.2, size: rand(1, 1.9) * s, a: rand(0, TAU),
              col: pick(CONFETTI_COLORS),
            });
          }
        }
        break;

      default:
        break;
    }

    this.spinAngle = this.state === 'CHEER' ? easeInOutCubic(clamp01((t - 0.35) / 1.2)) * TAU : 0;

    if (t >= this.stateDuration) {
      this.nextState();
    }
  }

  private nextState(): void {
    const b = this.bounds;
    switch (this.state) {
      case 'IDLE': {
        if (Math.random() < 0.55 && b) {
          const margin = 30 * this.scale;
          const minX = b.x + margin;
          const maxX = b.x + b.width - margin;
          let tx = rand(minX, maxX);
          if (Math.abs(tx - this.x) < 60) {
            tx = this.x < (minX + maxX) / 2 ? Math.min(maxX, this.x + 90) : Math.max(minX, this.x - 90);
          }
          this.targetX = tx;
          this.setState('DRIFT', rand(4, 7));
        } else {
          this.setState('CURIOUS', rand(3, 5));
        }
        break;
      }
      case 'DRIFT':
        this.setState(Math.random() < 0.3 ? 'CURIOUS' : 'IDLE', rand(3, 6));
        break;
      default:
        this.setState('IDLE', rand(3, 6));
        break;
    }
  }

  private updateMotion(step: number, bounds: ZoneBounds): void {
    const { minX, maxX } = companionXBounds('ghost', bounds);

    const maxV = 36;
    const desired = this.state === 'DRIFT' ? clamp((this.targetX - this.x) * 0.9, -maxV, maxV) : 0;
    this.vx += (desired - this.vx) * (1 - Math.exp(-step * 2.2));
    this.kickVx *= Math.exp(-step * 2.6);
    this.x += (this.vx + this.kickVx) * step;
    if (this.x < minX) {
      this.x = clampCompanionX('ghost', this.x, bounds);
      this.kickVx = Math.abs(this.kickVx) * 0.4;
    } else if (this.x > maxX) {
      this.x = clampCompanionX('ghost', this.x, bounds);
      this.kickVx = -Math.abs(this.kickVx) * 0.4;
    }

    const energyLift = this.state === 'ENERGIZE' ? this.energy * 4 : 0;
    const target = HOVER[this.state] + energyLift;
    this.hoverVel += ((target - this.hover) * 40 - this.hoverVel * 7) * step;
    this.hover = Math.max(1.5, this.hover + this.hoverVel * step);

    const tiltTarget = clamp((this.vx + this.kickVx) * 0.006, -0.3, 0.3);
    this.tilt += (tiltTarget - this.tilt) * (1 - Math.exp(-step * 6));
  }

  private updateSpine(step: number): void {
    const v = clamp(this.vx + this.kickVx, -70, 70); // capped: no long streaks at throw speed
    for (let i = 1; i <= SPINE; i++) {
      const f = i / SPINE;
      const target =
        -v * 0.07 * Math.pow(f, 1.4) +
        Math.sin(this.time * 1.8 - i * 0.55) * 0.9 * f * (1 + this.fear * 0.6) +
        Math.sin(this.time * 47 + i * 1.3) * 0.55 * this.fear * f;
      this.spX[i] += (target - this.spX[i]) * (1 - Math.exp(-step * (15 - i * 1.1)));
    }
  }

  private updateStateAppearance(step: number): void {
    const k = 1 - Math.exp(-step * 4);
    approachRgb(this.tint, TINT[this.state], k);
    approachRgb(this.aura, AURA[this.state], k);

    if (this.state !== 'ENERGIZE') {
      this.energy *= Math.exp(-step * (this.released ? 0.9 : 1.1));
    }
    this.pulse *= Math.exp(-step * 5);
    this.flash *= Math.exp(-step * 3.2);
    this.exclaim = Math.max(0, this.exclaim - step);
  }

  private updateFace(step: number): void {
    const e = this.state === 'ENERGIZE' && this.released ? EXPR_RELIEF : EXPR[this.state];
    const k = 1 - Math.exp(-step * 9);
    this.eye += (e.eye - this.eye) * k;
    this.happy += (e.happy - this.happy) * k;
    this.smile += (e.smile - this.smile) * k;
    this.open += (e.open - this.open) * k;
    this.wave += (e.wave - this.wave) * k;
    this.brow += (e.brow - this.brow) * k;
    this.blush += (e.blush - this.blush) * k;
    this.fear += (e.fear - this.fear) * (1 - Math.exp(-step * 14));

    this.blinkTimer -= step;
    if (this.blinkTimer <= 0 && this.blinkProgress === 0) {
      this.blinkProgress = 0.001;
      this.blinkTimer = Math.random() < 0.15 ? 0.2 : rand(2.2, 5);
    }
    if (this.blinkProgress > 0) {
      this.blinkProgress += step / 0.16;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = 0;
      }
    }

    this.lookTimer -= step;
    if (this.lookTimer <= 0) {
      if (this.state === 'CURIOUS') {
        this.lookTX = rand(-1, 1);
        this.lookTY = rand(-0.6, 0.7);
        this.lookTimer = rand(0.7, 1.5);
      } else if (this.state === 'ENERGIZE') {
        this.lookTX = 0;
        this.lookTY = -0.6;
        this.lookTimer = 1;
      } else {
        this.lookTX = rand(-0.6, 0.6);
        this.lookTY = rand(-0.3, 0.3);
        this.lookTimer = rand(1.5, 3.5);
      }
    }
    const lk = 1 - Math.exp(-step * 9);
    const shake = this.state === 'SCARED' ? Math.sin(this.time * 30) * 0.4 : 0;
    this.lookX += (this.lookTX + shake - this.lookX) * lk;
    this.lookY += (this.lookTY - this.lookY) * lk;

    const t = this.stateTimer;
    const [hx, hy] = HAND[this.state];
    let rx = hx;
    let ry = hy;
    let lx = hx;
    let ly = hy;
    if (this.state === 'IDLE') {
      ry += Math.sin(this.time * 1.5) * 0.8;
      ly += Math.sin(this.time * 1.5 + 1) * 0.8;
    } else if (this.state === 'DRIFT') {
      rx -= this.vx * 0.05;
      lx -= this.vx * 0.05;
    } else if (this.state === 'FLY') {
      const tr = clamp(this.vx * 0.012, -3.5, 3.5);
      rx -= tr; lx -= tr;
      ry += Math.sin(this.time * 20) * 1.5; ly += Math.sin(this.time * 20 + 1.7) * 1.5;
    } else if (this.state === 'CHEER') {
      rx += Math.sin(this.time * 9) * 2.2;
      ry += Math.cos(this.time * 9) * 1.2;
      lx += Math.sin(this.time * 9 + Math.PI) * 2.2;
      ly += Math.cos(this.time * 9 + Math.PI) * 1.2;
    } else if (this.state === 'SCARED') {
      const peek = Math.pow(Math.sin(Math.PI * clamp01((t - 1.5) / 0.9)), 2);
      const tr = Math.sin(this.time * 52) * 0.5 * this.fear;
      rx += tr + peek * 5;
      ry += tr + peek * 3.5;
      lx += tr;
      ly += tr;
    }
    const hk = 1 - Math.exp(-step * 8);
    const h = this.hands;
    h.rx += (rx - h.rx) * hk;
    h.ry += (ry - h.ry) * hk;
    h.lx += (-lx - h.lx) * hk;
    h.ly += (ly - h.ly) * hk;
  }

  private updateAmbient(step: number): void {
    const s = this.scale;
    const v = this.vx + this.kickVx;

    if (Math.abs(v) > 14) {
      this.mistAcc += step * (8 + Math.min(40, Math.abs(v) * 0.05));
      while (this.mistAcc >= 1) {
        this.mistAcc -= 1;
        const dir = v > 0 ? 1 : -1;
        this.spawn('mist', {
          x: this.x - dir * 6 * s, y: this.y + rand(-4, 10) * s,
          vx: -dir * 8, vy: rand(-4, 0),
          life: rand(0.9, 1.4), max: 1.4, size: 5 * s, col: this.aura.slice() as RGB,
        });
      }
    }

    this.dripTimer -= step;
    if (this.dripTimer <= 0) {
      this.dripTimer = rand(0.9, 1.7);
      const j = Math.floor(Math.random() * TIPS);
      this.spawn('drip', {
        x: this.x + this.tipX[j] * s, y: this.y + (BOTTOM + this.tipLen[j]) * s,
        vx: 0, vy: 0, life: 3, max: 3, size: 1.1 * s, col: [200, 235, 255],
      });
    }
  }

  private spawn(kind: Kind, init: Partial<Particle>): void {
    const p: Particle = {
      kind, x: 0, y: 0, vx: 0, vy: 0, life: 1, max: 1, size: 1, r: 0, a: 0, w: 0,
      col: [255, 255, 255], trail: [], ...init,
    };
    this.particles.push(p);
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.shift();
    }
  }

  private spawnRing(flat: number, radius: number, life: number, col: RGB): void {
    this.spawn('ring', {
      x: this.x, y: this.y + (flat ? 2 : 0) * this.scale,
      life, max: life, vx: radius * this.scale, a: 0, col,
    });
  }

  private spawnWisp(): void {
    const r0 = rand(44, 80);
    const life = rand(1.0, 1.6);
    this.spawn('wisp', {
      vx: r0, r: r0, a: rand(0, TAU), w: rand(2.0, 3.4),
      life, max: life, size: rand(1.4, 2.4), col: pick(WISP_COLORS),
    });
  }

  private onWispArrive(p: Particle): void {
    const s = this.scale;
    this.energy = Math.min(1.2, this.energy + 0.065);
    this.pulse = Math.max(this.pulse, 0.45);
    const wx = this.x + p.x * s;
    const wy = this.y + p.y * s;
    for (let i = 0; i < 2; i++) {
      const an = rand(0, TAU);
      this.spawn('spark', {
        x: wx, y: wy, vx: Math.cos(an) * rand(10, 30), vy: Math.sin(an) * rand(10, 30) - 8,
        life: rand(0.4, 0.8), max: 0.8, size: rand(0.8, 1.6) * s, col: p.col,
      });
    }
  }

  private releaseEnergy(): void {
    const s = this.scale;
    this.pulse = 1;
    this.flash = 1;
    this.hoverVel += 45;
    this.spawnRing(0, 54, 0.8, [150, 240, 255]);
    this.spawnRing(1, 40, 1.1, [190, 170, 255]);
    for (let i = 0; i < 26; i++) {
      const an = (i / 26) * TAU + rand(-0.1, 0.1);
      const sp = rand(35, 90);
      this.spawn('spark', {
        x: this.x, y: this.y + 2 * s, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp * 0.8,
        life: rand(0.6, 1.2), max: 1.2, size: rand(1, 2.2) * s, col: pick(WISP_COLORS),
      });
    }
    this.particleEngine?.spawnGlitterBurst(this.x, this.y, 10, ['#7dd3fc', '#c4b5fd', '#ffffff']);
  }

  private updateParticles(step: number): void {
    const s = this.scale;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= step;
      const u = clamp01(1 - p.life / p.max);

      switch (p.kind) {
        case 'wisp': {
          p.a += p.w * step * (1 + 2 * u);
          p.r = p.vx * Math.pow(1 - u, 1.5);
          p.x = Math.cos(p.a) * p.r;
          p.y = Math.sin(p.a) * p.r * 0.9 + 3;
          p.trail.push(p.x, p.y);
          if (p.trail.length > 24) {
            p.trail.splice(0, 2);
          }
          if (p.life <= 0) {
            this.onWispArrive(p);
          }
          break;
        }
        case 'spark':
          p.vx *= Math.exp(-step * 1.5);
          p.vy = p.vy * Math.exp(-step * 1.5) + 40 * step;
          p.x += p.vx * step;
          p.y += p.vy * step;
          break;
        case 'mist':
          p.x += p.vx * step;
          p.y += p.vy * step;
          p.size += step * 6 * s;
          break;
        case 'drip':
          p.vy += 140 * step;
          p.y += p.vy * step;
          if (p.y >= this.floorY) {
            p.life = 0;
            this.spawn('ring', {
              x: p.x, y: this.floorY, life: 0.55, max: 0.55, vx: 6 * s, a: 1, col: [200, 235, 255],
            });
          }
          break;
        case 'orb': {
          const damp = Math.exp(-step * 1.8);
          p.vx *= damp;
          p.vy = p.vy * damp - 6 * step;
          p.x += p.vx * step + Math.sin(this.time * 2 + p.a) * 0.15;
          p.y += p.vy * step;
          break;
        }
        case 'ring':
          p.r = p.vx * easeOutCubic(u);
          break;
        case 'shock':
          p.r += p.vy * step;
          break;
        case 'sweat':
          p.vy += 120 * s * step;
          p.x += p.vx * step;
          p.y += p.vy * step;
          break;
        case 'star':
          break;
      }

      if (p.life <= 0) {
        const last = this.particles.pop();
        if (last && last !== p) {
          this.particles[i] = last;
        }
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D): void {
    if (this.isDisposed) {
      return;
    }

    const s = this.scale;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this.renderGround(ctx);
    this.renderAura(ctx);
    this.renderParticles(ctx, true);

    const cr = clamp(this.gl.grab.crouch, -0.2, 1.4); // springy landing squash
    const vyStretch = clamp(-this.hoverVel * 0.0018, -0.1, 0.1) - cr * 0.28;
    const squashY = 1 + vyStretch;
    const squashX = 1 / Math.sqrt(Math.max(0.5, squashY));
    const spinC = Math.cos(this.spinAngle);
    const back = spinC < 0;
    const spinX = Math.max(0.05, Math.abs(spinC));
    const shrink = 1 - this.fear * 0.08;

    const jx = Math.sin(this.time * 53) * 0.55 * this.fear * s;
    const jy = Math.sin(this.time * 61) * 0.35 * this.fear * s;

    ctx.translate(this.x + jx, this.y + jy);
    ctx.rotate(this.tilt + Math.sin(this.time * 47) * 0.012 * this.fear);
    ctx.translate(0, 21 * s * cr * 0.28); // keep the skirt on the floor while it squashes
    ctx.scale(s * spinX * squashX * shrink, s * squashY * shrink);

    const flicker = this.fear > 0.3 ? 0.8 + 0.2 * Math.sin(this.time * 38) * Math.sin(this.time * 17) : 1;
    const alpha = clamp01((1 - this.fear * 0.18) * flicker + this.energy * 0.05);
    const breath = Math.sin(this.time * 1.9) * 0.015;

    this.prepareBody(breath);
    this.renderBody(ctx, alpha);

    const faceX = this.lookX * 1.6 + this.spineAt(0.3);
    if (!back) {
      this.renderFace(ctx, faceX, alpha);
    }
    this.renderArms(ctx, alpha);

    ctx.restore();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.renderParticles(ctx, false);
    this.renderExclaim(ctx);
    ctx.restore();
  }

  private renderGround(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    const above = Math.max(0, (this.floorY - (this.y + 21 * s)) / s);
    const k = 1 / (1 + above / 26);
    const sx = this.x + above * 0.22 * s - this.tilt * 8 * s;
    const rx = 15 * s * (0.75 + 0.5 * k);
    const squash = 0.2;

    ctx.save();
    ctx.translate(sx, this.floorY);
    ctx.scale(1, squash);

    ctx.globalCompositeOperation = 'lighter';
    const poolR = rx * 2.1;
    const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, poolR);
    pg.addColorStop(0, rgba(this.aura, (0.1 + this.energy * 0.14 + this.pulse * 0.12) * (0.5 + 0.5 * k)));
    pg.addColorStop(1, rgba(this.aura, 0));
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(0, 0, poolR, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.5);
    g1.addColorStop(0, `rgba(8,14,40,${(0.34 * k).toFixed(3)})`);
    g1.addColorStop(0.6, `rgba(8,14,40,${(0.16 * k).toFixed(3)})`);
    g1.addColorStop(1, 'rgba(8,14,40,0)');
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 1.5, 0, TAU);
    ctx.fill();

    const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 0.8);
    g2.addColorStop(0, `rgba(4,8,28,${(0.38 * k).toFixed(3)})`);
    g2.addColorStop(1, 'rgba(4,8,28,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 0.8, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private renderAura(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    const rad = 34 * s * (1 + this.energy * 0.5 + this.pulse * 0.2);
    const a = Math.min(0.5, 0.18 + this.energy * 0.16 + this.pulse * 0.14 + this.flash * 0.14);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(this.x, this.y, rad * 0.1, this.x, this.y, rad);
    g.addColorStop(0, rgba(this.aura, a));
    g.addColorStop(0.5, rgba(this.aura, a * 0.35));
    g.addColorStop(1, rgba(this.aura, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rad, 0, TAU);
    ctx.fill();

    for (let k = 0; k < 5; k++) {
      const an = this.time * 0.6 * (0.5 + k * 0.15) + k * 1.7;
      const rr = (28 + 6 * Math.sin(this.time * 0.8 + k)) * s;
      const mx = this.x + Math.cos(an) * rr;
      const my = this.y + Math.sin(an) * rr * 0.7;
      const ma = 0.3 + 0.25 * Math.sin(this.time * 2 + k * 2);
      ctx.fillStyle = rgba(this.aura, ma * 0.35);
      ctx.beginPath();
      ctx.arc(mx, my, 2.4 * s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba([255, 255, 255], ma);
      ctx.beginPath();
      ctx.arc(mx, my, 0.9 * s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private spineAt(u: number): number {
    const f = clamp01(u) * SPINE;
    const i = Math.min(SPINE - 1, Math.floor(f));
    return lerp(this.spX[i], this.spX[i + 1], f - i);
  }

  private prepareBody(breath: number): void {
    const dome = 0.34;
    for (let i = 0; i <= ROWS; i++) {
      const u = Math.pow(i / ROWS, 1.35);
      const kk = u / dome;
      const pinchK = this.gl.pinch * Math.max(0, 1 - u / 0.24); // held by the top: dome pulled into a peak
      const w =
        (u < dome ? R * Math.sqrt(1 - (1 - kk) * (1 - kk)) : R * (1 + 0.16 * clamp01((u - dome) / (1 - dome)))) *
        (1 + breath) * (1 - 0.5 * pinchK);
      const cx = this.spineAt(u);
      this.rowY[i] = TOP + u * (BOTTOM - TOP) - 6 * pinchK;
      this.rowR[i] = cx + w;
      this.rowL[i] = cx - w;
    }

    const xR = this.rowR[ROWS];
    const xL = this.rowL[ROWS];
    const yB = this.rowY[ROWS];
    const v = clamp(this.vx + this.kickVx, -70, 70);
    for (let k = 0; k <= TIPS; k++) {
      this.notchX[k] = xR + ((xL - xR) * k) / TIPS;
      this.notchY[k] = yB - 0.6 + Math.sin(this.time * 2.2 + k * 1.4) * 0.5;
    }
    for (let j = 0; j < TIPS; j++) {
      const speed = 2.4 + this.fear * 5;
      const sp = Math.max(0, this.gl.grab.crouch); // landing: the skirt splays out
      this.tipLen[j] = 4.2 + 1.8 * Math.sin(this.time * speed + j * 1.7) + Math.abs(v) * 0.01 + sp * 5;
      this.tipX[j] = (this.notchX[j] + this.notchX[j + 1]) / 2 - v * 0.04 + Math.sin(this.time * 1.9 + j * 2.1) * 1.2 + (j - 2) * sp * 1.8;
    }
  }

  private buildBody(ctx: CanvasRenderingContext2D): void {
    const Y = this.rowY;
    const Rr = this.rowR;
    const Ll = this.rowL;
    ctx.beginPath();
    ctx.moveTo(Rr[0], Y[0]);
    for (let i = 1; i < ROWS; i++) {
      ctx.quadraticCurveTo(Rr[i], Y[i], (Rr[i] + Rr[i + 1]) / 2, (Y[i] + Y[i + 1]) / 2);
    }
    ctx.lineTo(Rr[ROWS], Y[ROWS]);
    ctx.lineTo(this.notchX[0], this.notchY[0]);
    for (let j = 0; j < TIPS; j++) {
      const my = (this.notchY[j] + this.notchY[j + 1]) / 2;
      ctx.quadraticCurveTo(this.tipX[j], my + 2 * this.tipLen[j], this.notchX[j + 1], this.notchY[j + 1]);
    }
    ctx.lineTo(Ll[ROWS], Y[ROWS]);
    for (let i = ROWS - 1; i >= 1; i--) {
      ctx.quadraticCurveTo(Ll[i], Y[i], (Ll[i] + Ll[i - 1]) / 2, (Y[i] + Y[i - 1]) / 2);
    }
    ctx.lineTo(Ll[0], Y[0]);
    ctx.closePath();
  }

  private renderBody(ctx: CanvasRenderingContext2D, alpha: number): void {
    const tint = this.tint;
    const aura = this.aura;
    const glow = 0.5 + Math.min(0.6, this.energy * 0.4 + this.pulse * 0.25);

    this.buildBody(ctx);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(aura, 0.05 * glow * alpha);
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = rgba(aura, 0.08 * glow * alpha);
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    const g = ctx.createLinearGradient(0, TOP, 0, BOTTOM + 7);
    g.addColorStop(0, rgba(tint, 0.94 * alpha));
    g.addColorStop(0.45, rgba(mix(tint, [208, 230, 255], 0.4), 0.86 * alpha));
    g.addColorStop(0.8, rgba([196, 218, 250], 0.5 * alpha));
    g.addColorStop(1, rgba([190, 214, 250], 0.16 * alpha));
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    this.buildBody(ctx);
    ctx.clip();

    const sg = ctx.createLinearGradient(0, -2, 0, BOTTOM + 6);
    sg.addColorStop(0, 'rgba(110,130,200,0)');
    sg.addColorStop(1, `rgba(110,130,200,${(0.3 * alpha).toFixed(3)})`);
    ctx.fillStyle = sg;
    ctx.fillRect(-R - 4, -2, R * 2 + 8, BOTTOM + 12);

    const hg = ctx.createRadialGradient(-6, -12, 0.5, -6, -12, 9);
    hg.addColorStop(0, `rgba(255,255,255,${(0.7 * alpha).toFixed(3)})`);
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(-5.5, -11.5, 6.5, 3.4, -0.5, 0, TAU);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    const coreA = Math.min(0.32, 0.08 + this.energy * 0.2 + this.pulse * 0.14);
    const cg = ctx.createRadialGradient(0, 5, 0.5, 0, 5, 15);
    cg.addColorStop(0, rgba(aura, coreA));
    cg.addColorStop(1, rgba(aura, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(-R - 2, -12, R * 2 + 4, 32);
    ctx.globalCompositeOperation = 'source-over';

    ctx.strokeStyle = `rgba(255,255,255,${(0.11 * alpha).toFixed(3)})`;
    ctx.lineWidth = 0.9;
    for (let k = 0; k < 3; k++) {
      const ph = this.time * 0.35 + k * 2.1;
      ctx.beginPath();
      ctx.moveTo(-8 + k * 7, 14);
      ctx.bezierCurveTo(
        -6 + Math.sin(ph) * 5, 4,
        6 + Math.cos(ph * 1.2) * 5, -4,
        -3 + k * 4 + Math.sin(ph * 0.7) * 3, -17
      );
      ctx.stroke();
    }

    for (let k = 0; k < 14; k++) {
      const ph = (this.time * 0.12 * (0.6 + (k % 3) * 0.2) + k * 0.173) % 1;
      const dx = Math.sin(k * 12.9898) * R * 0.8;
      const dy = BOTTOM - ph * (BOTTOM - TOP);
      ctx.fillStyle = `rgba(255,255,255,${(Math.sin(ph * Math.PI) * 0.4 * alpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(dx, dy, 0.5 + (k % 3) * 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    this.buildBody(ctx);
    const rg = ctx.createLinearGradient(-R, 0, R, 0);
    rg.addColorStop(0, `rgba(255,255,255,${(0.85 * alpha).toFixed(3)})`);
    rg.addColorStop(0.55, rgba(tint, 0.5 * alpha));
    rg.addColorStop(1, rgba(aura, 0.55 * alpha));
    ctx.strokeStyle = rg;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  private renderFace(ctx: CanvasRenderingContext2D, fx: number, alpha: number): void {
    const blinkF = this.blinkProgress > 0 ? 1 - Math.sin(this.blinkProgress * Math.PI) : 1;
    const open = clamp(this.eye * blinkF * (1 - this.happy), 0, 1.5);
    const closedA = clamp01(1 - open / 0.35);

    for (const side of [-1, 1]) {
      const bx = fx + side * 8.3;
      const br = 3.8;
      const bg = ctx.createRadialGradient(bx, -0.4, 0, bx, -0.4, br);
      bg.addColorStop(0, `rgba(255,140,185,${((this.blush * 0.8 + this.happy * 0.15) * alpha).toFixed(3)})`);
      bg.addColorStop(1, 'rgba(255,140,185,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(bx, -0.4, br, br * 0.7, 0, 0, TAU);
      ctx.fill();
    }

    for (const side of [-1, 1]) {
      const ex = fx + side * 5.1;
      const ey = -6 + this.lookY * 0.8;
      const rx = 2.6 * (1 + (this.eye - 1) * 0.35);
      const ry = 3.5 * open;

      if (ry > 0.45) {
        const ox = this.lookX * 0.9;
        const eg = ctx.createRadialGradient(ex + ox - 0.6, ey - 0.8, 0.3, ex + ox, ey, ry * 1.2);
        eg.addColorStop(0, '#2b3a66');
        eg.addColorStop(1, '#0a0f22');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.ellipse(ex + ox, ey, rx, ry, 0, 0, TAU);
        ctx.fill();

        if (this.energy > 0.25) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(this.aura, 0.3 * clamp01(this.energy));
          ctx.beginPath();
          ctx.ellipse(ex + ox, ey, rx * 1.4, ry * 1.25, 0, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        }

        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(ex + ox - rx * 0.35, ey - ry * 0.38, Math.max(0.5, rx * 0.36 * (1 - this.fear * 0.3)), 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(190,225,255,0.8)';
        ctx.beginPath();
        ctx.arc(ex + ox + rx * 0.38, ey + ry * 0.4, rx * 0.17, 0, TAU);
        ctx.fill();
      }

      const arcA = Math.max(this.happy, closedA * (1 - this.happy));
      if (arcA > 0.03) {
        ctx.strokeStyle = `rgba(27,36,66,${arcA.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (this.happy > 0.5) {
          ctx.arc(ex, ey + 1.2, rx * 1.05, Math.PI * 1.1, Math.PI * 1.9);
        } else {
          ctx.arc(ex, ey - 0.6, rx * 1.05, Math.PI * 0.1, Math.PI * 0.9);
        }
        ctx.stroke();
      }

      const worried = Math.max(0, -this.brow);
      const raise = Math.max(0, this.brow) * 1.4;
      const yb = ey - 3.5 * Math.max(open, 0.6) - 1.8 - raise;
      const inner = ex - side * rx * 0.9;
      const outer = ex + side * rx * 0.9;
      ctx.strokeStyle = `rgba(60,80,130,${(0.55 * alpha).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(inner, yb - worried * 2.2);
      ctx.quadraticCurveTo(ex, yb - 0.9 - this.brow * 0.3, outer, yb + worried * 0.8);
      ctx.stroke();
    }

    this.renderMouth(ctx, fx);
  }

  private renderMouth(ctx: CanvasRenderingContext2D, fx: number): void {
    const mw = 2.2 + this.smile * 2.4 + this.open * 0.6;
    const mh = 0.6 + this.open * 3.4;
    const cy0 = 2.8 - this.smile * 1.2;
    const N = 9;
    const up: number[] = [];
    const lo: number[] = [];
    for (let k = 0; k <= N; k++) {
      const sN = (k / N) * 2 - 1;
      const par = 1 - sN * sN;
      const wob = Math.sin(sN * 6 + this.time * 38) * 0.7 * this.wave;
      const yu = cy0 + this.smile * 1.8 * par + wob;
      up.push(yu);
      lo.push(yu + 0.5 + this.open * mh * Math.pow(par, 0.8));
    }
    ctx.beginPath();
    for (let k = 0; k <= N; k++) {
      const x = fx + lerp(-mw, mw, k / N);
      if (k === 0) {
        ctx.moveTo(x, up[k]);
      } else {
        ctx.lineTo(x, up[k]);
      }
    }
    for (let k = N; k >= 0; k--) {
      ctx.lineTo(fx + lerp(-mw, mw, k / N), lo[k]);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(27,36,66,0.92)';
    ctx.fill();

    if (this.open > 0.4) {
      ctx.fillStyle = 'rgba(255,130,170,0.55)';
      ctx.beginPath();
      ctx.ellipse(fx, lo[Math.floor(N / 2)] - 0.5, mw * 0.5, Math.max(0.3, mh * 0.28), 0, 0, TAU);
      ctx.fill();
    }
  }

  private renderArms(ctx: CanvasRenderingContext2D, alpha: number): void {
    const h = this.hands;
    this.drawArm(ctx, 9.5, 3, h.rx, h.ry, 1, alpha);
    this.drawArm(ctx, -9.5, 3, h.lx, h.ly, -1, alpha);
  }

  private drawArm(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    hx: number, hy: number,
    side: number,
    alpha: number
  ): void {
    const cx = (sx + hx) / 2 + side * 4.5;
    const cy = (sy + hy) / 2 + 2;

    ctx.strokeStyle = rgba(this.aura, 0.3 * alpha);
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, hx, hy);
    ctx.stroke();

    ctx.strokeStyle = rgba(mix(this.tint, [255, 255, 255], 0.3), 0.88 * alpha);
    ctx.lineWidth = 4.1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, hx, hy);
    ctx.stroke();

    ctx.fillStyle = rgba(mix(this.tint, [255, 255, 255], 0.4), 0.95 * alpha);
    ctx.beginPath();
    ctx.arc(hx, hy, 2.6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(this.aura, 0.4 * alpha);
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${(0.7 * alpha).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(hx - 0.9, hy - 1, 0.9, 0, TAU);
    ctx.fill();
  }

  private renderParticles(ctx: CanvasRenderingContext2D, behind: boolean): void {
    const s = this.scale;
    for (const p of this.particles) {
      const isBehind = p.kind === 'mist';
      if (isBehind !== behind) {
        continue;
      }
      const u = clamp01(1 - p.life / p.max);
      const fade = 1 - u;

      switch (p.kind) {
        case 'mist': {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, rgba(p.col, 0.12 * fade));
          g.addColorStop(1, rgba(p.col, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
          break;
        }

        case 'wisp': {
          const n = p.trail.length / 2;
          if (n < 2) {
            break;
          }
          const wx = this.x;
          const wy = this.y;
          ctx.globalCompositeOperation = 'lighter';
          const passes = [0, Math.floor(n * 0.5), Math.floor(n * 0.75)];
          for (let q = 0; q < passes.length; q++) {
            ctx.strokeStyle = rgba(p.col, 0.18 + q * 0.28);
            ctx.lineWidth = (0.6 + q * 0.9) * p.size * 0.6 * s;
            ctx.beginPath();
            for (let k = passes[q]; k < n; k++) {
              const px = wx + p.trail[k * 2] * s;
              const py = wy + p.trail[k * 2 + 1] * s;
              if (k === passes[q]) {
                ctx.moveTo(px, py);
              } else {
                ctx.lineTo(px, py);
              }
            }
            ctx.stroke();
          }
          const hx = wx + p.x * s;
          const hy = wy + p.y * s;
          ctx.fillStyle = rgba(p.col, 0.16);
          ctx.beginPath();
          ctx.arc(hx, hy, p.size * 1.9 * s, 0, TAU);
          ctx.fill();
          ctx.fillStyle = rgba([255, 255, 255], 0.95);
          ctx.beginPath();
          ctx.arc(hx, hy, p.size * 0.9 * s, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }

        case 'spark': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(p.col, 0.3 * fade);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = rgba([255, 255, 255], 0.95 * fade);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 - u * 0.5), 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }

        case 'orb': {
          const tw = 0.75 + 0.25 * Math.sin(this.time * 9 + p.a * 3);
          const a = Math.min(1, p.life / 0.5) * tw;
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(p.col, 0.1 * a);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = rgba(p.col, 0.95 * a);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }

        case 'star': {
          const pulse = Math.sin(Math.PI * u);
          const r = p.size * pulse;
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(p.col, 0.95 * pulse);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.a + u * 1.2);
          ctx.beginPath();
          ctx.moveTo(0, -r * 1.5);
          ctx.lineTo(r * 0.28, -r * 0.28);
          ctx.lineTo(r * 1.5, 0);
          ctx.lineTo(r * 0.28, r * 0.28);
          ctx.lineTo(0, r * 1.5);
          ctx.lineTo(-r * 0.28, r * 0.28);
          ctx.lineTo(-r * 1.5, 0);
          ctx.lineTo(-r * 0.28, -r * 0.28);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }

        case 'ring': {
          ctx.save();
          ctx.translate(p.x, p.y);
          if (p.a === 1) {
            ctx.scale(1, 0.28);
          }
          ctx.strokeStyle = rgba(p.col, 0.55 * fade);
          ctx.lineWidth = 2 * fade * s + 0.4;
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(0.1, p.r), 0, TAU);
          ctx.stroke();
          ctx.restore();
          break;
        }

        case 'shock': {
          const ca = Math.cos(p.a);
          const sa = Math.sin(p.a);
          ctx.strokeStyle = rgba(p.col, 0.85 * fade);
          ctx.lineWidth = 1.4 * fade * s + 0.3;
          ctx.beginPath();
          ctx.moveTo(p.x + ca * p.r, p.y + sa * p.r);
          ctx.lineTo(p.x + ca * (p.r + p.size), p.y + sa * (p.r + p.size));
          ctx.stroke();
          break;
        }

        case 'sweat':
        case 'drip': {
          const a = p.kind === 'drip' ? clamp01(p.life / 0.4) : fade;
          ctx.fillStyle = rgba(p.col, 0.75 * a);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.8, p.size * 1.25, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = `rgba(255,255,255,${(0.7 * a).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x - p.size * 0.25, p.y - p.size * 0.3, p.size * 0.28, 0, TAU);
          ctx.fill();
          break;
        }
      }
    }
  }

  private renderExclaim(ctx: CanvasRenderingContext2D): void {
    if (this.exclaim <= 0) {
      return;
    }
    const s = this.scale;
    const t = 1 - this.exclaim / 1.4;
    const pop = easeOutBack(clamp01(t * 5));
    const a = Math.min(1, this.exclaim / 0.4);
    ctx.save();
    ctx.translate(this.x + 11 * s, this.y - 30 * s - Math.sin(this.time * 14) * 0.8 * s);
    ctx.scale(pop, pop);
    ctx.font = `bold ${Math.round(18 * s)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = `rgba(255,70,100,${a.toFixed(3)})`;
    ctx.strokeText('!', 0, 0);
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.fillText('!', 0, 0);
    ctx.restore();
  }

  public dispose(): void {
    this.gl.grab.cancelInteraction();
    this.isDisposed = true;
    this.particles = [];
  }
}
