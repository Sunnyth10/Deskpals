/**
 * CompanionGrab
 * Shared "pick up / carry / throw / drop" driver for companions.
 *
 *  - mode 'ground' (cat, fox): carried by the scruff, thrown with real gravity, lands
 *    with a springy compression (`crouch`) so the legs bend, slides to a stop, recovers.
 *  - mode 'float'  (ghost, robot): carried by the top of the body, thrown with momentum
 *    that fades through drag, then floats gently back to its home position. No bounce.
 *
 * The driver owns the companion's reference point (x, y) while `active`. The reference
 * point is the feet for ground companions and the body centre for floating ones.
 * Coordinates are canvas px, +y is down.
 */
import {
  DEFAULT_PHYSICS_CONFIG,
  PhysicsBody,
  PhysicsConfig,
  PointerSample,
  applyFloorFriction,
  stepPhysics,
  throwVelocity,
} from './CompanionPhysics';

export type GrabMode = 'ground' | 'float';
export type GrabPhase = 'idle' | 'lift' | 'hold' | 'air' | 'land' | 'recover' | 'return';

export interface GrabConfig {
  mode: GrabMode;
  /** Hit box in local units around the reference point (sprite facing +x, unflipped). */
  hit: { left: number; right: number; top: number; bottom: number };
  /** Point the sprite is held by, local units relative to the reference point. */
  pivot: { x: number; y: number };
  /** Equilibrium tilt while held, local radians (positive = clockwise when unflipped). */
  hangTilt?: number;
  liftTime?: number;
  recoverTime?: number;
  /** Pendulum feel while carried. */
  swing?: { gain: number; k: number; c: number };
  /** Ground mode physics overrides. */
  physics?: Partial<PhysicsConfig>;
  /** Float mode: spring back home + cap on throw speed. */
  floatReturn?: {
    k: number; c: number; speedCap: number; coast: number;
    /** tumble kick per px/s of horizontal throw speed, and its cap (rad/s) */
    spin?: number; spinMax?: number;
    /** how strongly it re-stabilises its tilt while floating back */
    stabilise?: number;
    /** px/s² of 'loss of support' right after release; fades as the spring catches it */
    gravity?: number;
  };
}

export interface GrabEnv {
  /** px per local unit (the companion's current scale) */
  scale: number;
  /** +1 / -1: which way the sprite is mirrored right now */
  flip: number;
  /** current reference point (include any hop/lift: this is where the sprite really is) */
  x: number;
  y: number;
  /** where the reference point rests: floor (ground) or natural hover height (float) */
  homeY: number;
  /** float mode: x to drift back to (omit to stay where it was dropped) */
  homeX?: number;
  /** lowest / highest allowed reference y, leftmost / rightmost allowed x */
  bottomY: number;
  topY: number;
  minX: number;
  maxX: number;
}

const PRESS_HOLD_TIME = 0.12;
const DRAG_THRESHOLD = 4;
const CROUCH_K = 300;
const CROUCH_C = 20;
const CROUCH_IMPULSE = 48; // peak compression ≈ 1.0 for a hard landing (a = 1)

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export class CompanionGrab {
  public phase: GrabPhase = 'idle';
  public phaseT = 0;
  public x = 0;
  public y = 0;
  public vx = 0;
  public vy = 0;
  public rot = 0;
  public omega = 0;
  /** Ground mode: height of the reference point above the floor, px. */
  public lift = 0;
  /** Landing compression, 0..~1.4 (springy; dips slightly below 0 on the rebound). */
  public crouch = 0;
  /** 0..1, how firmly it is being held (eases in/out). */
  public held = 0;
  /** Fastest floor impact this frame in px/s (0 = none). */
  public landed = 0;
  /** 0..1.5 strength of the last landing. */
  public intensity = 0;
  public bounces = 0;
  /** Fastest wall hit this frame in px/s (0 = none) and which wall (1 = left, -1 = right). */
  public wallImpact = 0;
  public wallSide = 0;
  /** Float mode: speed (px/s) at which it caught itself after sinking this frame (0 = none). */
  public caught = 0;
  /** Float mode: 0..1, how close it is to its home position. */
  public settle = 1;

  public physics: PhysicsConfig;
  /** `null` follows the OS `prefers-reduced-motion`; `true`/`false` forces it. */
  public reducedMotion: boolean | null = null;

  private crouchV = 0;
  private reduceNow = false;
  private interactive = true;
  private pokeFlag = false;
  private endedFlag = false;
  private maxImpact = 0;
  private peakFall = 0;
  private caughtDone = false;
  private press: { x: number; y: number; t: number } | null = null;
  private cursor = { x: 0, y: 0 };
  private hold = { x: 0, y: 0, ox: 0, oy: 0, oyRest: 0, vx: 0, vy: 0 };
  private samples: PointerSample[] = [];
  private body: PhysicsBody = { x: 0, y: 0, vx: 0, vy: 0 };
  private activeCfg: PhysicsConfig;
  private time = 0;
  private env: GrabEnv = { scale: 1, flip: 1, x: 0, y: 0, homeY: 0, bottomY: 0, topY: 0, minX: 0, maxX: 0 };

  constructor(private readonly cfg: GrabConfig) {
    this.physics = { ...DEFAULT_PHYSICS_CONFIG, ...(cfg.physics ?? {}) };
    this.activeCfg = this.physics;
  }

  /** True while the driver controls the companion (held, thrown, landing or floating back). */
  public get active(): boolean {
    return this.phase !== 'idle';
  }
  public isGrabbed(): boolean {
    return this.phase === 'lift' || this.phase === 'hold';
  }
  public isPointerEngaged(): boolean {
    return this.isGrabbed() || this.press !== null;
  }
  /** True once after a tap (press shorter than the hold time, no drag). */
  public consumePoke(): boolean {
    const p = this.pokeFlag;
    this.pokeFlag = false;
    return p;
  }
  /** True once on the frame control is handed back to the companion. */
  public consumeEnded(): boolean {
    const e = this.endedFlag;
    this.endedFlag = false;
    return e;
  }
  public setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.cancelInteraction();
    }
  }

  private get reduced(): boolean {
    if (this.reducedMotion !== null) {
      return this.reducedMotion;
    }
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ------------------------------------------------------------------------ */
  /*  Pointer API (canvas px)                                                  */
  /* ------------------------------------------------------------------------ */

  public containsPoint(px: number, py: number): boolean {
    const e = this.env;
    const s = e.scale || 1;
    const rx = this.active ? this.x : e.x;
    const ry = this.active ? this.y : e.y;
    const dx = px - rx;
    const dy = py - ry;
    const c = Math.cos(this.rot);
    const sn = Math.sin(this.rot);
    const lx = ((dx * c + dy * sn) / s) * e.flip;
    const ly = (-dx * sn + dy * c) / s;
    const h = this.cfg.hit;
    return lx >= h.left && lx <= h.right && ly >= h.top && ly <= h.bottom;
  }

  public pointerDown(px: number, py: number): boolean {
    if (!this.interactive || this.isGrabbed() || !this.containsPoint(px, py)) {
      return false;
    }
    this.cursor.x = px;
    this.cursor.y = py;
    this.press = { x: px, y: py, t: 0 };
    return true;
  }

  public pointerMove(px: number, py: number): void {
    this.cursor.x = px;
    this.cursor.y = py;
    if (this.isGrabbed()) {
      this.samples.push({ x: px, y: py, t: performance.now() });
      if (this.samples.length > 16) {
        this.samples.shift();
      }
    } else if (this.press && Math.hypot(px - this.press.x, py - this.press.y) > DRAG_THRESHOLD) {
      this.begin();
    }
  }

  public pointerUp(): void {
    if (this.isGrabbed()) {
      this.release();
    } else if (this.press) {
      this.press = null;
      if (!this.active) {
        this.pokeFlag = true;
      }
    }
  }

  public cancelInteraction(): void {
    this.press = null;
    if (this.isGrabbed()) {
      this.samples.length = 0;
      this.release();
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Per-frame update                                                         */
  /* ------------------------------------------------------------------------ */

  /** Call once per frame. Returns true while the companion should follow (x, y, rot). */
  public update(step: number, env: GrabEnv): boolean {
    this.time += step;
    this.env = env;
    this.landed = 0;
    this.wallImpact = 0;
    this.wallSide = 0;
    this.caught = 0;

    if (this.press) {
      this.press.t += step;
      if (this.press.t >= PRESS_HOLD_TIME) {
        this.begin();
      }
    }

    // landing compression spring (runs even after control is handed back)
    this.crouchV += (-CROUCH_K * this.crouch - CROUCH_C * this.crouchV) * step;
    this.crouch = clamp(this.crouch + this.crouchV * step, -0.15, 1.6);

    if (!this.active) {
      this.held += (0 - this.held) * (1 - Math.exp(-step * 10));
      this.rot = 0;
      this.omega = 0;
      this.lift = Math.max(0, env.homeY - env.y);
      return false;
    }

    this.phaseT += step;
    this.held += ((this.isGrabbed() ? 1 : 0) - this.held) * (1 - Math.exp(-step * 10));

    switch (this.phase) {
      case 'lift':
      case 'hold':
        this.runHeld(step);
        break;
      case 'air':
        this.runAir(step);
        break;
      case 'land':
        this.runLand(step);
        break;
      case 'return':
        this.runReturn(step);
        break;
      case 'recover':
        this.runRecover(step);
        break;
      default:
        break;
    }
    this.lift = Math.max(0, env.homeY - this.y);
    return this.active;
  }

  /* ---- grab / carry ------------------------------------------------------------ */

  private begin(): void {
    const e = this.env;
    const s = e.scale;
    this.press = null;
    this.reduceNow = this.reduced;
    if (!this.active) {
      this.x = e.x;
      this.y = e.y;
      this.rot = 0;
      this.omega = 0;
      this.vx = 0;
      this.vy = 0;
    }
    const px = this.cfg.pivot.x * e.flip * s;
    const py = this.cfg.pivot.y * s;
    const c = Math.cos(this.rot);
    const sn = Math.sin(this.rot);
    const h = this.hold;
    h.x = this.x + c * px - sn * py;
    h.y = this.y + sn * px + c * py;
    h.ox = h.x - this.cursor.x;
    h.oy = h.y - this.cursor.y;
    // grabbed below the handle: keep part of the offset so it is lifted at once
    h.oyRest = clamp(h.oy, -12 * s, 0);
    h.vx = 0;
    h.vy = 0;
    this.samples.length = 0;
    this.samples.push({ x: this.cursor.x, y: this.cursor.y, t: performance.now() });
    this.bounces = 0;
    this.maxImpact = 0;
    this.phase = 'lift';
    this.phaseT = 0;
  }

  private runHeld(step: number): void {
    const e = this.env;
    const s = e.scale;
    const h = this.hold;
    const sw = this.cfg.swing ?? { gain: 0.0012, k: 80, c: 6 };

    // the offset between handle and cursor melts away, so it is lifted, never snapped
    const melt = Math.exp(-step * 9);
    h.ox *= melt;
    h.oy = h.oyRest + (h.oy - h.oyRest) * melt;

    const px = h.x;
    const py = h.y;
    const follow = 1 - Math.exp(-step * 22);
    h.x += (this.cursor.x + h.ox - h.x) * follow;
    h.y += (this.cursor.y + h.oy - h.y) * follow;
    const inv = 1 / Math.max(step, 1e-4);
    const kv = 1 - Math.exp(-step * 14);
    h.vx += ((h.x - px) * inv - h.vx) * kv;
    h.vy += ((h.y - py) * inv - h.vy) * kv;

    // pendulum about the handle, settling toward its natural hanging tilt
    const liftT = this.cfg.liftTime ?? 0.26;
    const ramp = this.phase === 'lift' ? smooth(0, liftT, this.phaseT) : 1;
    const gain = this.reduceNow ? sw.gain * 0.3 : sw.gain;
    const idle = this.reduceNow ? 0 : Math.sin(this.time * 2.4) * 0.04;
    // ground companions only tilt once they are actually off the floor
    const offFloor = this.cfg.mode === 'ground' ? smooth(0, 14 * s, e.homeY - this.y) : 1;
    const hang = (this.cfg.hangTilt ?? 0) * e.flip * ramp * offFloor;
    const target = clamp(h.vx * gain, -0.9, 0.9) + idle + hang;
    this.omega += (sw.k * (target - this.rot) - sw.c * this.omega) * step;
    this.rot += this.omega * step;

    // reference point hangs below the handle
    const ox = this.cfg.pivot.x * e.flip * s;
    const oy = this.cfg.pivot.y * s;
    const c = Math.cos(this.rot);
    const sn = Math.sin(this.rot);
    this.x = clamp(h.x - (c * ox - sn * oy), e.minX, e.maxX);
    this.y = clamp(h.y - (sn * ox + c * oy), Math.min(e.topY, e.bottomY - 2), e.bottomY);
    this.vx = h.vx;
    this.vy = h.vy;

    if (this.phase === 'lift' && this.phaseT >= liftT) {
      this.phase = 'hold';
      this.phaseT = 0;
    }
  }

  private release(): void {
    const v = throwVelocity(this.samples, performance.now(), this.physics);
    this.samples.length = 0;
    this.reduceNow = this.reduced;
    this.phaseT = 0;
    if (this.cfg.mode === 'ground') {
      this.activeCfg = this.reduceNow ? { ...this.physics, restitution: 0, wallRestitution: 0.1 } : this.physics;
      this.vx = v.vx;
      this.vy = v.vy;
      this.bounces = 0;
      this.maxImpact = 0;
      this.phase = 'air';
    } else {
      const fr = this.cfg.floatReturn ?? { k: 24, c: 9, speedCap: 900, coast: 0.2 };
      const sp = Math.hypot(v.vx, v.vy);
      const k = sp > fr.speedCap ? fr.speedCap / sp : 1;
      this.vx = v.vx * k;
      this.vy = v.vy * k;
      if (!this.reduceNow) {
        const spinMax = fr.spinMax ?? 7;
        this.omega += clamp(v.vx * (fr.spin ?? 0.004), -spinMax, spinMax);
      }
      this.peakFall = 0;
      this.caughtDone = false;
      this.phase = 'return';
    }
  }

  /* ---- ground: thrown, landing, recovery --------------------------------------- */

  private runAir(step: number): void {
    const e = this.env;
    const s = e.scale;
    const cfg = this.activeCfg;
    const b = this.body;
    b.x = this.x;
    b.y = this.y;
    b.vx = this.vx;
    b.vy = this.vy;
    const hit = stepPhysics(
      b,
      { minX: e.minX, maxX: e.maxX, floorY: e.bottomY, ceilY: Math.min(e.topY, e.bottomY - 2) },
      cfg, step, s
    );
    this.x = b.x;
    this.y = b.y;
    this.vx = b.vx;
    this.vy = b.vy;

    // lean into the direction of travel; the held tilt fades out
    const tilt = this.reduceNow ? 0 : clamp(this.vx * 0.0005, -0.35, 0.35);
    this.omega += (30 * (tilt - this.rot) - 6 * this.omega) * step;
    this.rot += this.omega * step;

    if (hit.wallImpact > 120 * s) {
      this.wallImpact = hit.wallImpact;
      this.wallSide = hit.wallSide;
    }
    if (hit.floorImpact > 45 * s) {
      this.maxImpact = Math.max(this.maxImpact, hit.floorImpact);
      this.landed = hit.floorImpact;
      this.impactSpring(hit.floorImpact);
      if (!hit.settled) {
        this.bounces++;
      }
    }
    if (hit.settled) {
      this.intensity = clamp(this.maxImpact / (cfg.heavyImpactSpeed * s), 0, 1.5);
      this.y = e.bottomY;
      this.phase = 'land';
      this.phaseT = 0;
    }
  }

  private impactSpring(speed: number): void {
    const s = this.env.scale;
    const a = clamp(speed / (this.physics.heavyImpactSpeed * s), 0.15, 1.3) * (this.reduceNow ? 0.4 : 1);
    this.crouch = Math.max(this.crouch, 0);
    this.crouchV = Math.max(this.crouchV, a * CROUCH_IMPULSE);
  }

  private runLand(step: number): void {
    const e = this.env;
    const s = e.scale;
    this.y = e.bottomY;
    this.vy = 0;
    this.vx = applyFloorFriction(this.vx, this.activeCfg, step);
    this.x += this.vx * step;
    if (this.x < e.minX || this.x > e.maxX) {
      this.x = clamp(this.x, e.minX, e.maxX);
      this.vx *= -0.3;
    }
    this.rot += (0 - this.rot) * (1 - Math.exp(-step * 14));
    this.omega = 0;
    if (this.phaseT >= 0.12 + 0.2 * this.intensity && Math.abs(this.vx) < 12 * s) {
      this.vx = 0;
      this.phase = 'recover';
      this.phaseT = 0;
    }
  }

  private runRecover(step: number): void {
    const e = this.env;
    this.rot += (0 - this.rot) * (1 - Math.exp(-step * 12));
    this.omega = 0;
    if (this.cfg.mode === 'ground') {
      this.y = e.bottomY;
    } else {
      this.y = e.homeY;
      this.x += ((e.homeX ?? this.x) - this.x) * (1 - Math.exp(-step * 6));
    }
    const dur = (this.cfg.recoverTime ?? 0.35) + (this.cfg.mode === 'ground' ? this.intensity * 0.3 : 0);
    if (this.phaseT >= dur) {
      this.rot = 0;
      this.phase = 'idle';
      this.endedFlag = true;
    }
  }

  /* ---- float: coast, then drift gently back ------------------------------------ */

  private runReturn(step: number): void {
    const e = this.env;
    const s = e.scale;
    const fr = this.cfg.floatReturn ?? { k: 24, c: 9, speedCap: 900, coast: 0.2 };
    // coast on the throw first, then ease the spring in: no bounce, no snap
    const g = smooth(fr.coast, fr.coast + 0.55, this.phaseT);
    const k = fr.k * g;
    const c = 1.9 + (fr.c - 1.9) * g;
    const ax = (e.homeX !== undefined ? k * (e.homeX - this.x) : 0) - c * this.vx;
    const ay = k * (e.homeY - this.y) - c * this.vy + (fr.gravity ?? 0) * s * (1 - g) * clamp01((e.homeY - this.y) / (25 * s));
    this.vx += ax * step;
    this.vy += ay * step;
    this.x += this.vx * step;
    this.y += this.vy * step;

    // walls / ceiling: a soft bumper (tiny recoil, reported so the companion can react)
    if (this.x < e.minX) {
      this.x = e.minX;
      if (this.vx < 0) { this.reportWall(-this.vx, 1); this.vx = -this.vx * 0.2; }
    }
    if (this.x > e.maxX) {
      this.x = e.maxX;
      if (this.vx > 0) { this.reportWall(this.vx, -1); this.vx = -this.vx * 0.2; }
    }
    const top = Math.min(e.topY, e.bottomY - 2);
    if (this.y < top) {
      this.y = top;
      if (this.vy < 0) { this.vy = -this.vy * 0.2; }
    }
    // floor: cushioned touch-down (squash + dust events), then it lifts off again. No bounce.
    if (this.y > e.bottomY) {
      this.y = e.bottomY;
      if (this.vy > 0) {
        const imp = this.vy;
        if (imp > 110 * s) {
          this.landed = imp;
          this.intensity = clamp(imp / (this.physics.heavyImpactSpeed * s), 0, 1.5);
          this.impactSpring(imp);
        }
        this.caughtDone = true;
        this.vy = 0;
        this.vx *= 0.6;
      }
    }

    // it lost its support for a moment: when the spring finally catches it, that is a 'catch'
    if (this.vy > this.peakFall) { this.peakFall = this.vy; }
    if (!this.caughtDone && this.peakFall > 170 * s && this.vy < this.peakFall * 0.4) {
      this.caughtDone = true;
      this.caught = this.peakFall;
      this.intensity = clamp(this.peakFall / (this.physics.heavyImpactSpeed * s), 0, 1.5);
      this.impactSpring(this.peakFall * 0.55);
    }

    // tumble from the throw, unwinding as the stabilisers come online
    const stab = fr.stabilise ?? 1;
    const tilt = this.reduceNow ? 0 : clamp(this.vx * 0.0006, -0.25, 0.25);
    const kk = 2 + (26 * stab - 2) * g;
    const cc = 0.7 + (6.5 - 0.7) * g;
    this.omega += (kk * (tilt - this.rot) - cc * this.omega) * step;
    this.rot += this.omega * step;
    this.rot = Math.atan2(Math.sin(this.rot), Math.cos(this.rot));

    const dist = Math.hypot(e.homeY - this.y, e.homeX !== undefined ? e.homeX - this.x : 0);
    this.settle = clamp01(1 - dist / (60 * e.scale));
    const speed = Math.hypot(this.vx, this.vy);
    if ((g >= 1 && dist < 1.5 && speed < 8 && Math.abs(this.rot) < 0.03) || this.phaseT > 3.5) {
      this.phase = 'recover';
      this.phaseT = 0;
      this.vx = 0;
      this.vy = 0;
    }
  }

  private reportWall(speed: number, side: number): void {
    if (speed > 120 * this.env.scale) {
      this.wallImpact = speed;
      this.wallSide = side;
    }
  }
}
