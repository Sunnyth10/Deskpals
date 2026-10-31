import { IEntity, LivingEventType, ZoneBounds, ZoneType } from '../../core/types';
import { clampCompanionX, companionXBounds } from './CompanionBounds';
import { ParticleEngine } from '../../engine/particles/ParticleEngine';
import {
  DEFAULT_PHYSICS_CONFIG,
  PhysicsBody,
  PhysicsConfig,
  PhysicsWorld,
  PointerSample,
  applyFloorFriction,
  stepPhysics,
  throwVelocity,
} from './CompanionPhysics';

export type HeroState =
  | 'IDLE' | 'RUN' | 'FLIP' | 'SWING' | 'SHOOT' | 'SENSE' | 'CHEER' | 'SCARED'
  | 'GRABBED' | 'THROWN' | 'POKE';
export type HeroAction = 'swing' | 'flip' | 'shoot' | 'run';

/* -------------------------------------------------------------------------- */
/*  Constants & helpers                                                        */
/* -------------------------------------------------------------------------- */

const TAU = Math.PI * 2;
const DESIGN_HEIGHT = 56; // standing height incl. head, in local units
const FOOT_DROP = 16.8; // pelvis -> floor when standing
const BOOT_R = 2.8;
const L_LEG = 6.7;
const L_UP = 5.6;
const L_FORE = 5.2;
const MAX_PARTICLES = 100;

// Interaction tuning (grab / throw / poke)
const NECK = 12; // pelvis -> scruff distance (local units); the hero hangs from here
const PRESS_HOLD_TIME = 0.12; // s: press longer than this (or drag > DRAG_THRESHOLD) = grab, shorter = poke
const DRAG_THRESHOLD = 4; // px
const LIFT_TIME = 0.28; // s: the "picked up" transition before the dangle loop
const HIT_HALF_WIDTH = 13; // local units, hit box around the body
const HIT_TOP = -44;
const HIT_BOTTOM = 20;

// Red and blue suit with a pale chest emblem, inspired by the supplied reference.
const SUIT = '#168fc7';
const SUIT_HI = '#56c4ef';
const SUIT_DK = '#07527f';
const OUT = '#24232b';
const ACCENT_DK = '#a81727';
const GLOW = '#fffdf8';
const MASK = '#df2634';
const MASK_HI = '#ff5962';
const MASK_DK = '#a61124';
const HERO_FACE_COLORS: HeroFaceColors = {
  main: MASK,
  mainDark: MASK_DK,
  mainLight: MASK_HI,
  accent: SUIT,
  frame: OUT,
  lens: '#ffffff',
  lensEdge: '#d9d6d0',
  pattern: 'rgba(77,12,25,0.58)',
};

export interface HeroFaceColors {
  main: string;
  mainDark: string;
  mainLight: string;
  accent: string;
  frame: string;
  lens: string;
  lensEdge: string;
  pattern: string;
}

export type HeroFaceExpression = 'NEUTRAL' | 'SHARP' | 'FRIENDLY' | 'SLEEPY' | 'HAPPY' | 'SHOCK';

const FACE_EXPRESSIONS: Record<HeroFaceExpression, { size: number; width: number; slant: number }> = {
  NEUTRAL: { size: 1.38, width: 1.12, slant: 0.55 },
  SHARP: { size: 1.1, width: 1.12, slant: 2.2 },
  FRIENDLY: { size: 1.42, width: 1.12, slant: 0.35 },
  SLEEPY: { size: 0.12, width: 1, slant: 0.4 },
  HAPPY: { size: 0.52, width: 1, slant: 0.4 },
  SHOCK: { size: 1.38, width: 1.12, slant: 0.05 },
};

class FaceState {
  public size = 1;
  public width = 1;
  public slant = 0.55;
  public happy = 0;
  public headRotation = 0;
  public blinkProgress = 0;
  public blinkTimer = 2 + Math.random() * 2;
  public expression: HeroFaceExpression = 'NEUTRAL';
  private doubleBlinkQueued = false;

  public update(dt: number): void {
    const target = FACE_EXPRESSIONS[this.expression];
    this.size = damp(this.size, target.size, 12, dt);
    this.width = damp(this.width, target.width, 12, dt);
    this.slant = damp(this.slant, target.slant, 10, dt);
    this.happy = damp(this.happy, this.expression === 'HAPPY' ? 1 : 0, 10, dt);
    const sharpTurn = this.expression === 'SHARP' ? Math.sin(performance.now() * 0.0016) * 0.28 : 0;
    this.headRotation = damp(this.headRotation, sharpTurn, 6, dt);
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkProgress === 0) this.blinkProgress = 0.001;
    if (this.blinkProgress > 0) {
      this.blinkProgress += dt / 0.16;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = 0;
        if (this.doubleBlinkQueued) {
          this.doubleBlinkQueued = false;
          this.blinkTimer = 2 + Math.random() * 3;
        } else if (Math.random() < 0.18) {
          this.doubleBlinkQueued = true;
          this.blinkTimer = 0.14;
        } else {
          this.blinkTimer = 2 + Math.random() * 3;
        }
      }
    }
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

interface Pose {
  lean: number; headTilt: number; crouch: number;
  aRa: number; aRb: number; aLa: number; aLb: number;
  lRa: number; lRb: number; lLa: number; lLb: number;
  eye: number; happy: number; open: number; smile: number; pupil: number; squint: number;
}
const POSE_KEYS: (keyof Pose)[] = [
  'lean', 'headTilt', 'crouch', 'aRa', 'aRb', 'aLa', 'aLb', 'lRa', 'lRb', 'lLa', 'lLb',
  'eye', 'happy', 'open', 'smile', 'pupil', 'squint',
];

interface Particle {
  kind: 'puff' | 'spark' | 'ring' | 'star';
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; col: string; a: number;
}

/**
 * WebHeroCompanion
 * A small chibi web hero with a round web-pattern mask, sharp lenses, compact limbs,
 * and a red-and-blue suit. Build errors trigger the upside-down thread hang.
 *
 *  - Idle: breathing, looking around, waving, hands-on-hips pose.
 *  - Run, ground front/back flips, web shots at the ceiling, and full web-swings
 *    (leap -> pendulum swing -> release -> mid-air flip -> hero landing).
 *  - save         -> hero-sense tingle, shoots a web, snags a glowing orb and pulls it in
 *  - buildSuccess -> web swing + flip, hero landing, victory hops, confetti
 *  - buildError   -> startled leap, hangs upside-down by a thread, shivers, peeks
 *
 * Direct interaction (pointer API, host forwards pointer events):
 *  - tap              -> POKE (happy hop + wave)
 *  - press + drag     -> GRABBED (lift animation, then dangles from the scruff, swinging
 *                        like a pendulum with the cursor)
 *  - release          -> THROWN (real gravity, bounces off floor/walls, landing squash,
 *                        slide, get-up animation, back to idle). Can be caught mid-air.
 *
 * @param maxScale optional upper bound for the size multiplier (default 1.3).
 */
export class WebHeroCompanion implements IEntity {
  public readonly id: string;
  public readonly zone: ZoneType;
  public x: number; // pelvis (centre of mass)
  public y: number;
  public isDisposed = false;

  public state: HeroState = 'IDLE';

  /** Tunable physics constants (see CompanionPhysics.ts). Safe to edit live. */
  public physics: PhysicsConfig = { ...DEFAULT_PHYSICS_CONFIG };
  /** `null` follows the OS `prefers-reduced-motion`; `true`/`false` forces it. */
  public reducedMotion: boolean | null = null;

  private readonly maxScale: number;
  private scale = 1;
  private floorY = 0;
  private standY = 0;
  private ceilY = 0;
  private bounds?: ZoneBounds;
  private inited = false;
  private time = 0;
  private stateT = 0;
  private phase = '';
  private phaseT = 0;

  // Motion
  private vx = 0;
  private vy = 0;
  private rot = 0;
  private runPhase = 0;
  private runAmt = 0;
  private runVelocity = 0;
  private runDirection = 1;
  private runDustTimer = 0;
  private targetX = 0;
  private idleTimer = 2;
  private gesture = '';
  private squash = 0;
  private flightT = 0;
  private flightDur = 1;
  private rotFrom = 0;
  private rotSign = 0;
  private flipFront = true;

  // Swing / web data
  private ax = 0;
  private ay = 0;
  private lp = 0;
  private th0 = 0;
  private th1 = 0;
  private dir = 1;
  private startX = 0;
  private startY = 0;
  private p0x = 0;
  private p0y = 0;
  private cheerAfter = false;
  private hangX = 0;
  private hangY = 0;
  private web = { on: false, ax: 0, ay: 0, k: 0, from: 'hand' as 'hand' | 'feet', side: 1 };
  private orb = { on: false, x: 0, y: 0, a: 0 };
  private sense = 0;
  private exclaim = 0;
  private pulse = 0;
  private faceState = new FaceState();
  private faceExpressionOverride: HeroFaceExpression | null = null;

  // Interaction (grab / throw / poke)
  private press: { x: number; y: number; t: number } | null = null;
  private cursor = { x: 0, y: 0 };
  private hold = { x: 0, y: 0, ox: 0, oy: 0, vx: 0, vy: 0 };
  private pointerSamples: PointerSample[] = [];
  private body: PhysicsBody = { x: 0, y: 0, vx: 0, vy: 0 };
  private activeCfg: PhysicsConfig = this.physics;
  private reduceNow = false;
  private omega = 0; // angular velocity of the dangle / tumble tilt
  private heldStretch = 0;
  private bounces = 0;
  private maxImpact = 0;
  private landIntensity = 0;
  private recoverDur = 0.5;
  // landing / collision reactions
  private py = 0; // physical pelvis height while thrown (this.y adds the landing compression)
  private landSpring = { x: 0, v: 0 }; // springy crouch on every floor impact: legs bend, then extend
  private wallSpring = { x: 0, v: 0 }; // squash + lean when it hits a wall
  private wallSide = 0;
  private wallT = 0;
  private queuedEvent: LivingEventType | null = null;

  private margins(): { minX: number; maxX: number } {
    const bounds = this.bounds ?? { x: this.x, y: this.y, width: 0, height: 0 };
    return companionXBounds('webhero', bounds);
  }

  // Pose + face
  private pose: Pose = {
    lean: 0, headTilt: 0, crouch: 0,
    aRa: 0.45, aRb: 0.25, aLa: 0.45, aLb: 0.25,
    lRa: 0.25, lRb: -0.1, lLa: 0.25, lLb: -0.1,
    eye: 1, happy: 0, open: 0, smile: 0.6, pupil: 1, squint: 0,
  };
  private lookX = 0;
  private lookY = 0;
  private lookTX = 0;
  private lookTY = 0;
  private lookTimer = 0;
  private blinkTimer = 2;
  private blinkProgress = 0;

  private particles: Particle[] = [];
  private particleEngine?: ParticleEngine;

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

  /** Set a temporary face expression, used by the companion preview controls. */
  public setFaceExpression(expression: HeroFaceExpression | null): void {
    this.faceExpressionOverride = expression;
  }

  /** Trigger a move by hand (handy for previews / easter eggs). */
  public perform(action: HeroAction): void {
    if (this.isDisposed || this.state === 'GRABBED' || this.state === 'THROWN') {
      return;
    }
    this.resetMotion();
    if (action === 'swing') {
      this.startSwing(false);
    } else if (action === 'flip') {
      this.startFlip();
    } else if (action === 'shoot') {
      this.startShoot();
    } else {
      this.startRun();
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Pointer interaction API                                                  */
  /*  The host forwards canvas-space pointer coordinates (CSS px).             */
  /* ------------------------------------------------------------------------ */

  /** Hit test in world space; rotation and scale aware. Use for hover cursors. */
  public containsPoint(px: number, py: number): boolean {
    if (this.isDisposed || !this.inited) {
      return false;
    }
    const dx = px - this.x;
    const dy = py - this.y;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const lx = (dx * c + dy * s) / this.scale;
    const ly = (-dx * s + dy * c) / this.scale;
    return Math.abs(lx) <= HIT_HALF_WIDTH && ly >= HIT_TOP && ly <= HIT_BOTTOM;
  }

  public isGrabbed(): boolean {
    return this.state === 'GRABBED';
  }

  /** True while a press or grab is in progress (the host should keep pointer capture). */
  public isPointerEngaged(): boolean {
    return this.state === 'GRABBED' || this.press !== null;
  }

  public isAirborne(): boolean {
    return this.state === 'GRABBED' || this.state === 'THROWN';
  }

  public setReducedMotion(v: boolean | null): void { this.reducedMotion = v; }

  /** Returns true if the press landed on the hero and the event should be captured. */
  public pointerDown(px: number, py: number): boolean {
    if (!this.interactive || this.isDisposed || this.state === 'GRABBED' || !this.containsPoint(px, py)) {
      return false;
    }
    this.cursor.x = px;
    this.cursor.y = py;
    this.press = { x: px, y: py, t: 0 };
    return true;
  }

  public pointerMove(px: number, py: number): void {
    if (this.isDisposed) {
      return;
    }
    this.cursor.x = px;
    this.cursor.y = py;
    if (this.state === 'GRABBED') {
      this.pointerSamples.push({ x: px, y: py, t: performance.now() });
      if (this.pointerSamples.length > 16) {
        this.pointerSamples.shift();
      }
    } else if (this.press && Math.hypot(px - this.press.x, py - this.press.y) > DRAG_THRESHOLD) {
      this.beginGrab();
    }
  }

  public pointerUp(): void {
    if (this.state === 'GRABBED') {
      this.releaseGrab();
    } else if (this.press) {
      this.press = null;
      if (this.state !== 'THROWN') {
        this.startPoke();
      }
    }
  }

  /** Window blur, pointercancel, theme switch, interactivity turned off... */
  public cancelInteraction(): void {
    this.press = null;
    if (this.state === 'GRABBED') {
      this.pointerSamples.length = 0;
      this.releaseGrab();
    }
  }

  /** Turn the interaction layer on/off (e.g. `livingTheme.companions.interactive`). */
  public setInteractive(on: boolean): void {
    this.interactive = on;
    if (!on) {
      this.cancelInteraction();
    }
  }

  private interactive = true;

  private get reduced(): boolean {
    if (this.reducedMotion !== null) {
      return this.reducedMotion;
    }
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private beginGrab(): void {
    this.press = null;
    this.reduceNow = this.reduced;
    // Stop whatever it was doing, but keep position + rotation so nothing teleports.
    this.web.on = false;
    this.orb.on = false;
    this.sense = 0;
    this.cheerAfter = false;
    this.gesture = '';
    this.vx = 0;
    this.vy = 0;
    this.rot = wrapAngle(this.rot);
    if (this.state !== 'THROWN') {
      this.omega = 0;
    }
    // Hang from the scruff. The offset between that point and the cursor melts away
    // during the lift, so the hero is pulled up smoothly instead of snapping.
    const neck = this.toWorld(0, -NECK, false);
    this.hold.x = neck.x;
    this.hold.y = neck.y;
    this.hold.ox = neck.x - this.cursor.x;
    this.hold.oy = neck.y - this.cursor.y;
    this.hold.vx = 0;
    this.hold.vy = 0;
    this.pointerSamples.length = 0;
    this.pointerSamples.push({ x: this.cursor.x, y: this.cursor.y, t: performance.now() });

    const s = this.scale;
    if (this.y > this.standY - 4 * s && !this.reduceNow) {
      for (let i = 0; i < 4; i++) {
        this.spawn('puff', {
          x: this.x + rand(-7, 7) * s, y: this.floorY - 2 * s,
          vx: rand(-20, 20) * s, vy: -rand(4, 12) * s,
          life: rand(0.3, 0.5), max: 0.5, size: rand(2, 3.4) * s, col: '220,215,255',
        });
      }
    }
    this.exclaim = 1.4;
    this.setState('GRABBED', 'lift');
  }

  private releaseGrab(): void {
    const v = throwVelocity(this.pointerSamples, performance.now(), this.physics);
    this.pointerSamples.length = 0;
    this.reduceNow = this.reduced;
    this.activeCfg = this.reduceNow
      ? { ...this.physics, restitution: 0, wallRestitution: 0.1 }
      : this.physics;
    this.vx = v.vx;
    this.vy = v.vy;
    this.py = this.y;
    this.bounces = 0;
    this.maxImpact = 0;
    this.landIntensity = 0;
    this.exclaim = 0;
    this.setState('THROWN', 'air');
  }

  private startPoke(): void {
    this.resetMotion();
    this.omega = 0;
    this.setState('POKE', '');
    this.squash = 0.45;
    const s = this.scale;
    for (let i = 0; i < 3; i++) {
      this.spawn('star', {
        x: this.x + rand(-16, 16) * s, y: this.y - rand(26, 44) * s, life: rand(0.6, 0.9), max: 0.9,
        size: rand(2, 3.4) * s, col: '255,214,120', a: rand(0, TAU),
      });
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Events                                                                   */
  /* ------------------------------------------------------------------------ */

  public reactToEvent(eventName: LivingEventType): void {
    if (this.isDisposed) {
      return;
    }
    if (this.state === 'GRABBED' || this.state === 'THROWN') {
      // Don't yank the hero out of your hand: play it once it has landed.
      this.queuedEvent = eventName;
      return;
    }
    this.resetMotion();
    if (eventName === 'save') {
      this.startSense();
    } else if (eventName === 'buildSuccess') {
      this.startSwing(true);
    } else if (eventName === 'buildError') {
      this.startScared();
    }
  }

  private resetMotion(): void {
    // Snap to the ground so a new move always starts from a clean state
    if (this.inited) {
      this.y = this.standY;
    }
    this.rot = 0;
    this.vx = 0;
    this.vy = 0;
    this.web.on = false;
    this.orb.on = false;
    this.sense = 0;
    this.cheerAfter = false;
    this.gesture = '';
  }

  private setState(s: HeroState, phase: string): void {
    this.state = s;
    this.stateT = 0;
    this.phase = phase;
    this.phaseT = 0;
    this.lookTimer = 0;
  }

  private toIdle(): void {
    this.setState('IDLE', '');
    this.idleTimer = rand(2, 4);
    this.web.on = false;
  }

  /* ------------------------------------------------------------------------ */
  /*  Update                                                                   */
  /* ------------------------------------------------------------------------ */

  public update(dt: number, bounds: ZoneBounds): void {
    if (this.isDisposed) {
      return;
    }
    const step = clamp(dt, 0, 0.05);
    this.bounds = bounds;
    this.time += step;
    this.stateT += step;
    this.phaseT += step;
    this.scale = clamp((bounds.height - 4) / DESIGN_HEIGHT, 0.5, this.maxScale);
    this.floorY = bounds.y + bounds.height - 4;
    this.standY = this.floorY - FOOT_DROP * this.scale;
    this.ceilY = Math.min(bounds.y + 40 * this.scale, this.standY - 2 * this.scale);
    if (!this.inited) {
      this.inited = true;
      this.y = this.standY;
    }

    // A press that turns into a hold becomes a grab.
    if (this.press) {
      this.press.t += step;
      if (this.press.t >= PRESS_HOLD_TIME) {
        this.beginGrab();
      }
    }

    // Brace while pressed (before it is a grab) so the hero doesn't wander off.
    const bracing = this.press !== null && (this.state === 'IDLE' || this.state === 'RUN');
    if (bracing) {
      this.y = this.standY;
    } else {
      this.runBehaviour(step, bounds);
    }
    this.updatePose(step);
    this.updateFace(step);
    this.faceState.expression = this.faceExpressionOverride ?? this.expressionForState();
    this.faceState.update(step);
    this.updateParticles(step);
    this.squash = Math.max(0, this.squash - step * 4);
    this.landSpring.v += (-300 * this.landSpring.x - 20 * this.landSpring.v) * step;
    this.landSpring.x = clamp(this.landSpring.x + this.landSpring.v * step, -0.15, 1.6);
    this.wallSpring.v += (-260 * this.wallSpring.x - 15 * this.wallSpring.v) * step;
    this.wallSpring.x = clamp(this.wallSpring.x + this.wallSpring.v * step, -0.5, 1.2);
    this.wallT = Math.max(0, this.wallT - step);
    this.exclaim = Math.max(0, this.exclaim - step);
    this.pulse *= Math.exp(-step * 4);
    this.runAmt += ((this.state === 'RUN' ? 1 : 0) - this.runAmt) * (1 - Math.exp(-step * 10));
    // Carried, not stretched: the body keeps its natural proportions while held.
    this.heldStretch = damp(this.heldStretch, 0, 12, step);
  }

  private expressionForState(): HeroFaceExpression {
    switch (this.state) {
      case 'SCARED':
        return 'SHOCK';
      case 'RUN':
      case 'SHOOT':
        return 'SHARP';
      case 'CHEER':
      case 'POKE':
        return 'HAPPY';
      case 'SWING':
        return 'FRIENDLY';
      case 'GRABBED':
        return this.phase === 'lift' ? 'SHOCK' : 'NEUTRAL';
      case 'THROWN':
        if (this.phase === 'air') {
          if (this.wallT > 0) {
            return 'SHOCK';
          }
          if (this.bounces > 0) {
            return 'NEUTRAL';
          }
          return this.vy < -40 * this.scale ? 'HAPPY' : 'SHOCK';
        }
        if (this.phase === 'land') {
          return this.landIntensity > 0.7 ? 'SLEEPY' : 'SHOCK';
        }
        return this.landIntensity > 0.7 && this.phaseT < this.recoverDur * 0.6 ? 'SLEEPY' : 'NEUTRAL';
      default:
        return 'NEUTRAL';
    }
  }

  private get G(): number {
    return 440 * this.scale;
  }

  private runBehaviour(step: number, bounds: ZoneBounds): void {
    const s = this.scale;

    switch (this.state) {
      case 'IDLE': {
        this.y = this.standY + this.pose.crouch * 4.5 * s;
        this.rot += (0 - this.rot) * (1 - Math.exp(-step * 10));
        this.idleTimer -= step;
        if (this.idleTimer <= 0) {
          this.pickNext();
        }
        break;
      }

      case 'RUN': {
        const dx = this.targetX - this.x;
        this.runDirection = Math.sign(dx) || this.runDirection;
        this.runVelocity += (78 * s - this.runVelocity) * (1 - Math.exp(-step * 5.5));
        const distance = Math.min(Math.abs(dx), this.runVelocity * step);
        this.x += this.runDirection * distance;
        this.runPhase += step * (8.5 + (this.runVelocity / s) * 0.045);
        this.y = this.standY - Math.max(0, Math.sin(this.runPhase * 2)) * 2.6 * s;
        this.runDustTimer -= step;
        if (this.runDustTimer <= 0) {
          this.runDustTimer = 0.13;
          this.spawn('puff', {
            x: this.x - this.runDirection * 5 * s,
            y: this.floorY - 2 * s,
            vx: -this.runDirection * rand(5, 18) * s,
            vy: -rand(5, 15) * s,
            life: rand(0.28, 0.46), max: 0.46, size: rand(2.2, 3.8) * s, col: '220,232,240',
          });
        }
        if (Math.abs(dx) < 3 || this.stateT > 8) {
          this.toIdle();
        }
        break;
      }

      case 'FLIP': {
        if (this.phase === 'wind') {
          this.y = this.standY + this.pose.crouch * 4.5 * s;
          if (this.phaseT >= 0.2) {
            const h = 28 * s;
            const sp = rand(22, 38) * s;
            this.launch(this.dir * sp, -Math.sqrt(2 * this.G * h), this.flipFront ? this.dir : -this.dir);
            this.phase = 'air';
            this.phaseT = 0;
          }
        } else if (this.phase === 'air') {
          if (this.stepFlight(step)) {
            this.land();
          }
        } else if (this.phaseT >= 0.3) {
          this.toIdle();
        }
        break;
      }

      case 'SWING':
        this.runSwing(step);
        break;

      case 'SHOOT': {
        const w = this.web;
        this.y = this.standY;
        if (this.phase === 'aim') {
          if (this.phaseT >= 0.25) {
            this.phase = 'fire';
            this.phaseT = 0;
            w.on = true;
            this.burst(this.handWorld(w.side).x, this.handWorld(w.side).y, 5, '201,255,77');
          }
        } else if (this.phase === 'fire') {
          w.k = clamp01(this.phaseT / 0.22);
          if (this.phaseT >= 0.22) {
            this.phase = 'hold';
            this.phaseT = 0;
            this.spawn('ring', { x: w.ax, y: w.ay, life: 0.4, max: 0.4, size: 9 * s, col: '255,255,255' });
          }
        } else if (this.phase === 'hold') {
          if (this.phaseT >= 0.7) {
            this.phase = 'retract';
            this.phaseT = 0;
          }
        } else {
          w.k = 1 - clamp01(this.phaseT / 0.3);
          if (this.phaseT >= 0.3) {
            this.toIdle();
          }
        }
        break;
      }

      case 'SENSE':
        this.runSense(step);
        break;

      case 'CHEER': {
        this.y = this.standY - Math.abs(Math.sin(this.phaseT * 7)) * 9 * s;
        this.rot = 0;
        if (this.stateT >= 2.4) {
          this.toIdle();
        }
        break;
      }

      case 'SCARED':
        this.runScared(step, bounds);
        break;

      case 'GRABBED':
        this.runGrabbed(step);
        break;

      case 'THROWN':
        this.runThrown(step);
        break;

      case 'POKE': {
        const t = this.phaseT;
        const fade = Math.max(0, 1 - t / 0.9);
        this.y = this.standY - Math.abs(Math.sin(t * 9)) * 8 * s * fade;
        this.rot = Math.sin(t * 16) * 0.07 * fade;
        if (t >= 0.9) {
          this.rot = 0;
          this.toIdle();
        }
        break;
      }
    }
    this.x = clampCompanionX('webhero', this.x, this.bounds as ZoneBounds);
  }

  /* ---- grabbed: lifted, then dangling from the scruff ----------------------------- */

  private runGrabbed(step: number): void {
    const s = this.scale;
    const h = this.hold;

    // The grab offset melts away so the hero is lifted to the cursor, never snapped.
    const melt = Math.exp(-step * 9);
    h.ox *= melt;
    h.oy *= melt;

    // The hold point follows the cursor with a little lag (feels carried, not glued).
    const px = h.x;
    const py = h.y;
    const follow = 1 - Math.exp(-step * 22);
    h.x += (this.cursor.x + h.ox - h.x) * follow;
    h.y += (this.cursor.y + h.oy - h.y) * follow;
    const inv = 1 / Math.max(step, 1e-4);
    const kv = 1 - Math.exp(-step * 14);
    h.vx += ((h.x - px) * inv - h.vx) * kv;
    h.vy += ((h.y - py) * inv - h.vy) * kv;

    // Pendulum: the body swings opposite to the carrying direction, then settles.
    const gain = this.reduceNow ? 0.0004 : 0.0013;
    const idleSway = this.reduceNow ? 0 : Math.sin(this.time * 2.4) * 0.05;
    const target = clamp(h.vx * gain, -0.9, 0.9) + idleSway;
    this.omega += (110 * (target - this.rot) - 7 * this.omega) * step;
    this.rot += this.omega * step;

    // Rotate about the scruff: pelvis hangs NECK below the hold point.
    this.x = h.x - Math.sin(this.rot) * NECK * s;
    this.y = clamp(h.y + Math.cos(this.rot) * NECK * s, this.ceilY, this.standY);

    if (this.phase === 'lift' && this.phaseT >= LIFT_TIME) {
      this.phase = 'hold';
      this.phaseT = 0;
    }
  }

  /* ---- thrown: gravity, bounces, landing, slide, get-up ----------------------------- */

  private physicsWorld(): PhysicsWorld {
    const { minX, maxX } = this.margins();
    return { minX, maxX, floorY: this.standY, ceilY: this.ceilY };
  }

  private impactFx(speed: number): number {
    const s = this.scale;
    const k = clamp(speed / (this.physics.heavyImpactSpeed * s), 0.12, 1.5);
    const calm = this.reduceNow ? 0.35 : 1;
    this.squash = Math.max(this.squash, k * calm);
    this.landSpring.v = Math.max(this.landSpring.v, clamp(speed / (this.physics.heavyImpactSpeed * s), 0.15, 1.3) * 48 * calm);
    const n = Math.round((2 + 6 * k) * (this.reduceNow ? 0.4 : 1));
    for (let i = 0; i < n; i++) {
      this.spawn('puff', {
        x: this.x + rand(-8, 8) * s, y: this.floorY - 2 * s,
        vx: rand(-30, 30) * s * (0.5 + k), vy: -rand(4, 16) * s * (0.5 + k),
        life: rand(0.35, 0.65), max: 0.65, size: rand(2.5, 5) * s * (0.6 + 0.5 * k), col: '220,215,255',
      });
    }
    if (k > 0.35 && !this.reduceNow) {
      this.spawn('ring', { x: this.x, y: this.floorY, a: 1, life: 0.45, max: 0.45, size: (10 + 16 * k) * s, col: '200,190,255' });
    }
    return k;
  }

  private runThrown(step: number): void {
    const s = this.scale;
    const cfg = this.activeCfg;

    if (this.phase === 'air') {
      const b = this.body;
      b.x = this.x;
      b.y = this.py;
      b.vx = this.vx;
      b.vy = this.vy;
      const hit = stepPhysics(b, this.physicsWorld(), cfg, step, s);
      this.x = b.x;
      this.py = b.y;
      this.vx = b.vx;
      this.vy = b.vy;
      // the pelvis sinks into the landing crouch (legs bend) and rises again as the spring rebounds
      const near = clamp01(1 - (this.standY - this.py) / (10 * s));
      this.y = this.py + this.landSpring.x * 7 * s * near;

      // Tilt into the direction of travel (and carry over the swing from being held).
      const tilt = this.reduceNow ? 0 : clamp(this.vx * 0.0008, -0.5, 0.5);
      this.omega += (34 * (tilt - this.rot) - 6 * this.omega) * step;
      this.rot += this.omega * step;

      if (hit.wallImpact > 90 * s) {
        const wk = clamp(hit.wallImpact / (cfg.heavyImpactSpeed * s), 0.2, 1.2);
        this.wallSide = hit.wallSide;
        this.wallT = 0.45;
        this.wallSpring.v = Math.max(this.wallSpring.v, wk * 34 * (this.reduceNow ? 0.4 : 1));
        if (!this.reduceNow) {
          const cxw = this.x - hit.wallSide * 11 * s;
          this.spawn('ring', { x: cxw, y: this.y - 6 * s, life: 0.35, max: 0.35, size: (8 + 10 * wk) * s, col: '255,255,255', a: 0 });
          this.burst(cxw, this.y - 6 * s, 4 + Math.round(4 * wk), '255,255,255');
        }
      }
      if (hit.wallImpact > 90 * s && !this.reduceNow) {
        for (let i = 0; i < 3; i++) {
          this.spawn('puff', {
            x: this.x - hit.wallSide * 9 * s, y: this.y + rand(-12, 6) * s,
            vx: hit.wallSide * rand(10, 34) * s, vy: rand(-12, 8) * s,
            life: rand(0.25, 0.45), max: 0.45, size: rand(2, 3.4) * s, col: '220,215,255',
          });
        }
        this.omega += -hit.wallSide * (3 + 5 * clamp(hit.wallImpact / (cfg.heavyImpactSpeed * s), 0.2, 1.2));
      }

      if (hit.floorImpact > 45 * s) {
        this.impactFx(hit.floorImpact);
        this.maxImpact = Math.max(this.maxImpact, hit.floorImpact);
        if (!hit.settled) {
          this.bounces++;
        }
      }

      if (hit.settled) {
        this.landIntensity = clamp01(this.maxImpact / (cfg.heavyImpactSpeed * s));
        this.y = this.standY;
        this.phase = 'land';
        this.phaseT = 0;
        this.runDustTimer = 0;
        if (this.landIntensity > 0.7 && !this.reduceNow) {
          // dazed stars circling the head on a heavy landing
          for (let i = 0; i < 3; i++) {
            this.spawn('star', {
              x: this.x + Math.cos((i / 3) * TAU) * 13 * s, y: this.y - 36 * s + Math.sin((i / 3) * TAU) * 3 * s,
              life: 0.9, max: 0.9, size: 3 * s, col: '255,214,120', a: i,
            });
          }
        }
      }
    } else if (this.phase === 'land') {
      this.y = this.standY + (this.pose.crouch * (2.5 + 2 * this.landIntensity) + this.landSpring.x * 7) * s;
      this.vx = applyFloorFriction(this.vx, cfg, step);
      this.x += this.vx * step;
      const { minX, maxX } = this.margins();
      if (this.x < minX || this.x > maxX) {
        this.x = clamp(this.x, minX, maxX);
        this.vx *= -0.35;
      }
      this.rot += (0 - this.rot) * (1 - Math.exp(-step * 14));
      this.omega = 0;
      this.runDustTimer -= step;
      if (Math.abs(this.vx) > 45 * s && this.runDustTimer <= 0 && !this.reduceNow) {
        const d = Math.sign(this.vx);
        this.runDustTimer = 0.07;
        this.spawn('puff', {
          x: this.x - d * 6 * s, y: this.floorY - 2 * s,
          vx: -d * rand(6, 20) * s, vy: -rand(4, 12) * s,
          life: rand(0.25, 0.4), max: 0.4, size: rand(2, 3.4) * s, col: '220,215,255',
        });
      }
      if (this.phaseT >= 0.16 + 0.22 * this.landIntensity && Math.abs(this.vx) < 14 * s) {
        this.vx = 0;
        this.phase = 'recover';
        this.phaseT = 0;
        this.recoverDur = 0.42 + 0.35 * this.landIntensity;
      }
    } else {
      this.y = this.standY + (this.pose.crouch * (2.5 + 2 * this.landIntensity) + this.landSpring.x * 7) * s;
      this.rot += (0 - this.rot) * (1 - Math.exp(-step * 14));
      if (this.phaseT >= this.recoverDur) {
        this.rot = 0;
        this.omega = 0;
        this.toIdle();
        if (this.landIntensity > 0.6) {
          this.gesture = 'hips';
          this.idleTimer = rand(1.6, 2.4);
        }
        if (this.queuedEvent) {
          const e = this.queuedEvent;
          this.queuedEvent = null;
          this.reactToEvent(e);
        }
      }
    }
  }

  private pickNext(): void {
    const r = Math.random();
    if (r < 0.3) {
      this.startRun();
    } else if (r < 0.5) {
      this.startFlip();
    } else if (r < 0.7) {
      this.startSwing(false);
    } else if (r < 0.85) {
      this.startShoot();
    } else {
      this.gesture = Math.random() < 0.5 ? 'wave' : 'hips';
      this.idleTimer = rand(2.2, 3.6);
    }
  }

  private pickDir(): number {
    const { minX, maxX } = this.margins();
    const mid = (minX + maxX) / 2;
    let d = this.x < mid ? 1 : -1;
    if (Math.random() < 0.25) {
      d = -d;
    }
    const room = d > 0 ? maxX - this.x : this.x - minX;
    return room < 40 * this.scale ? -d : d;
  }

  /* ---- run / flip ----------------------------------------------------------- */

  private startRun(): void {
    const { minX, maxX } = this.margins();
    let tx = rand(minX, maxX);
    if (Math.abs(tx - this.x) < 50 * this.scale) {
      tx = this.x < (minX + maxX) / 2 ? maxX : minX;
    }
    this.targetX = tx;
    this.runVelocity = 0;
    this.runDirection = Math.sign(tx - this.x) || 1;
    this.runDustTimer = 0;
    this.runPhase = 0;
    this.setState('RUN', '');
  }

  private startFlip(): void {
    this.dir = this.pickDir();
    this.flipFront = Math.random() < 0.5;
    this.setState('FLIP', 'wind');
  }

  private launch(vx: number, vy: number, rotSign: number): void {
    this.vx = vx;
    this.vy = vy;
    const c = this.y - this.standY;
    this.flightDur = Math.max(0.2, (-vy + Math.sqrt(Math.max(0, vy * vy - 2 * this.G * c))) / this.G);
    this.flightT = 0;
    this.rotFrom = this.rot;
    this.rotSign = rotSign;
  }

  /** Ballistic step. Returns true on landing. */
  private stepFlight(step: number): boolean {
    const { minX, maxX } = this.margins();
    this.flightT += step;
    this.vy += this.G * step;
    this.x += this.vx * step;
    this.y += this.vy * step;
    if (this.x < minX || this.x > maxX) {
      this.x = clamp(this.x, minX, maxX);
      this.vx = 0;
    }
    const u = clamp01(this.flightT / this.flightDur);
    this.rot = this.rotFrom + (this.rotSign * TAU - this.rotFrom) * easeInOutQuad(u);
    return this.flightT >= this.flightDur;
  }

  private land(): void {
    this.y = this.standY;
    this.rot = 0;
    this.vx = 0;
    this.vy = 0;
    this.squash = 1;
    this.phase = 'land';
    this.phaseT = 0;
    const s = this.scale;
    for (let i = 0; i < 7; i++) {
      this.spawn('puff', {
        x: this.x + rand(-9, 9) * s, y: this.floorY - 2 * s,
        vx: rand(-26, 26) * s, vy: rand(-12, -3) * s,
        life: rand(0.4, 0.7), max: 0.7, size: rand(3, 5.5) * s, col: '220,215,255',
      });
    }
    this.spawn('ring', { x: this.x, y: this.floorY, a: 1, life: 0.5, max: 0.5, size: 22 * s, col: '200,190,255' });
  }

  /* ---- web swing -------------------------------------------------------------- */

  private startSwing(cheer: boolean): void {
    const b = this.bounds as ZoneBounds;
    const s = this.scale;
    const { minX, maxX } = this.margins();
    this.dir = this.pickDir();
    const room = this.dir > 0 ? maxX - this.x : this.x - minX;
    this.ay = b.y + 3 * s;
    this.lp = Math.max(28 * s, this.standY - 9 * s - this.ay);
    const sinT = clamp((room * 0.8) / (2 * this.lp), 0.22, 0.85);
    const th = Math.asin(sinT);
    this.th0 = -this.dir * th;
    this.th1 = this.dir * th;
    this.ax = this.x - Math.sin(this.th0) * this.lp;
    this.p0x = this.x;
    this.p0y = this.ay + this.lp * Math.cos(this.th0);
    this.startX = this.x;
    this.startY = this.y;
    this.cheerAfter = cheer;
    this.flipFront = true;
    this.web.ax = this.ax;
    this.web.ay = this.ay;
    this.web.side = this.dir;
    this.web.from = 'hand';
    this.setState('SWING', 'leap');
  }

  private swingPos(u: number): { x: number; y: number } {
    const th = this.th0 + (this.th1 - this.th0) * ((1 - Math.cos(Math.PI * u)) / 2);
    return { x: this.ax + this.lp * Math.sin(th), y: this.ay + this.lp * Math.cos(th) };
  }

  private runSwing(step: number): void {
    const s = this.scale;
    const w = this.web;
    const swingDur = 1.25;
    const rot0 = -this.th0 * 0.6;

    if (this.phase === 'leap') {
      const u = clamp01(this.phaseT / 0.34);
      this.x = lerp(this.startX, this.p0x, u);
      this.y = lerp(this.startY, this.p0y, easeOutCubic(u)) - Math.sin(Math.PI * u) * 12 * s;
      this.rot = rot0 * u;
      w.on = u > 0.1;
      w.k = clamp01((u - 0.1) * 2.4);
      if (this.phaseT >= 0.34) {
        this.phase = 'swing';
        this.phaseT = 0;
        w.k = 1;
        this.burst(this.web.ax, this.web.ay, 4, '255,255,255');
      }
    } else if (this.phase === 'swing') {
      const u = clamp01(this.phaseT / swingDur);
      const pos = this.swingPos(u);
      this.x = pos.x;
      this.y = pos.y;
      const th = this.th0 + (this.th1 - this.th0) * ((1 - Math.cos(Math.PI * u)) / 2);
      this.rot = -th * 0.6 + Math.sin(this.time * 6) * 0.04;
      w.side = this.ax > this.x + 4 * s ? 1 : this.ax < this.x - 4 * s ? -1 : w.side;
      if (u >= 0.78) {
        const du = 0.02;
        const nx = this.swingPos(u + du);
        this.launch(
          ((nx.x - pos.x) / (du * swingDur)) * 1.05,
          ((nx.y - pos.y) / (du * swingDur)) * 1.05 - 40 * s,
          this.flipFront ? this.dir : -this.dir
        );
        this.phase = 'fall';
        this.phaseT = 0;
      }
    } else if (this.phase === 'fall') {
      w.k = Math.max(0, w.k - step * 6);
      if (w.k <= 0) {
        w.on = false;
      }
      if (this.stepFlight(step)) {
        this.land();
      }
    } else if (this.phaseT >= 0.34) {
      if (this.cheerAfter) {
        this.cheerAfter = false;
        this.startCheer();
      } else {
        this.toIdle();
      }
    }
  }

  private startCheer(): void {
    this.setState('CHEER', '');
    const s = this.scale;
    this.pulse = 1;
    const cols = ['255,214,120', '255,160,200', '150,255,210', '160,200,255', '201,255,77'];
    for (let i = 0; i < 24; i++) {
      const an = rand(-Math.PI, 0);
      const sp = rand(40, 110) * s;
      this.spawn('spark', {
        x: this.x, y: this.y - 16 * s, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp,
        life: rand(0.9, 1.7), max: 1.7, size: rand(1.2, 2.4) * s, col: cols[i % cols.length],
      });
    }
    for (let i = 0; i < 6; i++) {
      this.spawn('star', {
        x: this.x + rand(-34, 34) * s, y: this.y - rand(10, 44) * s, life: rand(0.8, 1.4), max: 1.4,
        size: rand(2.5, 4.5) * s, col: cols[i % cols.length], a: rand(0, TAU),
      });
    }
    this.particleEngine?.spawnGlitterBurst(this.x, this.y - 12 * s, 8, ['#fbbf24', '#f9a8d4', '#86efac', '#ffffff']);
  }

  /* ---- shoot (idle style) ------------------------------------------------------ */

  private startShoot(): void {
    const b = this.bounds as ZoneBounds;
    const s = this.scale;
    const { minX, maxX } = this.margins();
    const side = Math.random() < 0.5 ? -1 : 1;
    this.web.ax = clamp(this.x + side * rand(40, 90) * s, minX, maxX);
    this.web.ay = b.y + rand(4, 16) * s;
    this.web.side = this.web.ax >= this.x ? 1 : -1;
    this.web.from = 'hand';
    this.web.k = 0;
    this.setState('SHOOT', 'aim');
  }

  /* ---- hero-sense + orb (save) --------------------------------------------------- */

  private startSense(): void {
    const b = this.bounds as ZoneBounds;
    const s = this.scale;
    const { minX, maxX } = this.margins();
    const side = this.x < (minX + maxX) / 2 ? 1 : -1;
    this.orb.x = clamp(this.x + side * rand(55, 85) * s, minX, maxX);
    this.orb.y = clamp(this.floorY - rand(42, 58) * s, b.y + 10 * s, this.floorY - 30 * s);
    this.orb.a = 0;
    this.orb.on = false;
    this.web.side = this.orb.x >= this.x ? 1 : -1;
    this.web.from = 'hand';
    this.web.k = 0;
    this.web.on = false;
    this.sense = 1;
    this.setState('SENSE', 'tingle');
  }

  private runSense(step: number): void {
    const s = this.scale;
    const w = this.web;
    const o = this.orb;
    this.y = this.standY;
    const hand = this.handWorld(w.side);

    if (this.phase === 'tingle') {
      this.sense = 1;
      o.on = this.phaseT > 0.45;
      o.a = clamp01((this.phaseT - 0.45) / 0.35);
      if (this.phaseT >= 0.85) {
        this.phase = 'shoot';
        this.phaseT = 0;
        w.on = true;
        w.ax = o.x;
        w.ay = o.y;
        this.burst(hand.x, hand.y, 5, '201,255,77');
      }
    } else if (this.phase === 'shoot') {
      this.sense = Math.max(0, this.sense - step * 3);
      w.k = clamp01(this.phaseT / 0.22);
      if (this.phaseT >= 0.22) {
        this.phase = 'pull';
        this.phaseT = 0;
        this.burst(o.x, o.y, 6, '201,255,77');
      }
    } else if (this.phase === 'pull') {
      const u = easeInOutQuad(clamp01(this.phaseT / 0.8));
      const hx = hand.x;
      const hy = hand.y - 3 * s;
      o.x = lerp(w.ax, hx, u);
      o.y = lerp(w.ay, hy, u);
      w.ax = o.x;
      w.ay = o.y;
      if (this.phaseT >= 0.8) {
        this.phase = 'hold';
        this.phaseT = 0;
        this.pulse = 1;
        this.burst(o.x, o.y, 10, '150,240,255');
        w.on = false;
      }
    } else if (this.phase === 'hold') {
      o.x = hand.x;
      o.y = hand.y - 5 * s;
      if (this.phaseT >= 0.9) {
        this.phase = 'absorb';
        this.phaseT = 0;
      }
    } else {
      const u = easeInOutQuad(clamp01(this.phaseT / 0.35));
      const c = this.toWorld(0, -6, true);
      o.x = lerp(hand.x, c.x, u);
      o.y = lerp(hand.y - 5 * s, c.y, u);
      o.a = 1 - u;
      if (this.phaseT >= 0.35) {
        o.on = false;
        this.pulse = 1;
        this.particleEngine?.spawnGlitterBurst(this.x, this.y - 10 * s, 8, ['#c9ff4d', '#7dd3fc', '#ffffff']);
        this.burst(c.x, c.y, 14, '201,255,77');
        this.toIdle();
      }
    }
  }

  /* ---- scared: leap, hang upside-down, shiver (error) --------------------------- */

  private startScared(): void {
    const b = this.bounds as ZoneBounds;
    const s = this.scale;
    this.hangX = this.x;
    this.hangY = clamp(this.floorY - 40.5 * s, b.y + 19 * s, b.y + 31 * s);
    this.startX = this.x;
    this.startY = this.y;
    this.ax = this.x;
    this.ay = b.y + 1;
    this.web.ax = this.ax;
    this.web.ay = this.ay;
    this.web.from = 'feet';
    this.web.k = 0;
    this.web.on = false;
    this.exclaim = 1.4;
    this.setState('SCARED', 'up');
    for (let i = 0; i < 10; i++) {
      this.spawn('spark', {
        x: this.x, y: this.y - 12 * s, vx: Math.cos((i / 10) * TAU) * 70 * s, vy: Math.sin((i / 10) * TAU) * 70 * s,
        life: 0.4, max: 0.4, size: 1.4 * s, col: '255,120,140',
      });
    }
  }

  private runScared(step: number, bounds: ZoneBounds): void {
    const s = this.scale;
    const w = this.web;
    void bounds;
    if (this.phase === 'up') {
      const u = clamp01(this.phaseT / 0.45);
      const e = easeOutCubic(u);
      this.x = this.startX;
      this.y = lerp(this.startY, this.hangY, e) - Math.sin(Math.PI * u) * 10 * s;
      this.rot = Math.PI * easeInOutQuad(u);
      w.on = true;
      w.k = clamp01(u * 2);
      if (this.phaseT >= 0.45) {
        this.phase = 'hang';
        this.phaseT = 0;
      }
    } else if (this.phase === 'hang') {
      const t = this.phaseT;
      const sway = Math.sin(t * 2.6) * 0.12;
      this.rot = Math.PI + sway + Math.sin(t * 50) * 0.02;
      this.x = this.hangX + Math.sin(t * 2.6) * 4 * s + Math.sin(t * 47) * 0.5 * s;
      this.y = this.hangY + Math.sin(t * 5.2) * 1.2 * s;
      if (t >= 2.2) {
        this.phase = 'lower';
        this.phaseT = 0;
      }
    } else if (this.phase === 'lower') {
      const u = easeInOutQuad(clamp01(this.phaseT / 0.55));
      this.x = this.hangX;
      this.y = lerp(this.hangY, this.standY, u);
      this.rot = Math.PI + Math.PI * u;
      w.k = 1 - u * 0.2;
      if (this.phaseT >= 0.55) {
        this.rot = 0;
        this.y = this.standY;
        this.squash = 0.6;
        w.on = false;
        this.phase = 'recover';
        this.phaseT = 0;
      }
    } else {
      this.y = this.standY;
      this.rot = 0;
      if (this.phaseT >= 0.5) {
        this.toIdle();
      }
    }
    void step;
  }

  /* ------------------------------------------------------------------------ */
  /*  Pose / face                                                              */
  /* ------------------------------------------------------------------------ */

  private groundFoot(): number {
    return (this.floorY - this.y) / this.scale - BOOT_R;
  }

  /** Two-bone IK for a leg (front view): returns thigh angle + knee bend. */
  private legIK(side: number, fx: number, fy: number): [number, number] {
    const tx = side * fx - 3;
    const ty = fy - 1;
    const d = clamp(Math.hypot(tx, ty), 1, 2 * L_LEG * 0.999);
    const at = Math.atan2(tx, ty);
    const k = Math.acos(clamp(d / (2 * L_LEG), -1, 1));
    return [at + k, at - k - (at + k)];
  }

  /** Angle that makes an arm point at a world position. */
  private pointArm(side: number, wx: number, wy: number): number {
    const sh = this.toWorld(side * 5.8, -9.2, true);
    const dx = wx - sh.x;
    const dy = wy - sh.y;
    const r = this.rot + this.pose.lean;
    const lx = dx * Math.cos(r) + dy * Math.sin(r);
    const ly = -dx * Math.sin(r) + dy * Math.cos(r);
    return Math.atan2(side * lx, ly);
  }

  private targetPose(): Pose {
    const t = this.time;
    const g = this.groundFoot();
    const T: Pose = {
      lean: 0, headTilt: 0, crouch: 0,
      aRa: 0.45, aRb: 0.25, aLa: 0.45, aLb: 0.25,
      lRa: 0, lRb: 0, lLa: 0, lLb: 0,
      eye: 1, happy: 0.1, open: 0, smile: 0.6, pupil: 1, squint: 0,
    };
    const stand = (spread: number, ys = g): void => {
      [T.lRa, T.lRb] = this.legIK(1, 3.4 + spread, ys);
      [T.lLa, T.lLb] = this.legIK(-1, -(3.4 + spread), ys);
    };
    const arms = (a: number, b: number): void => {
      T.aRa = a; T.aRb = b; T.aLa = a; T.aLb = b;
    };
    stand(0.6);

    switch (this.state) {
      case 'IDLE':
        if (this.gesture === 'wave') {
          T.aRa = 2.7;
          T.aRb = 0.25 + Math.sin(t * 9) * 0.5;
          T.headTilt = 0.1;
          T.happy = 0.6;
        } else if (this.gesture === 'hips') {
          arms(0.95, -1.55);
          T.headTilt = -0.06;
          T.smile = 1;
          stand(1.8);
        }
        break;

      case 'RUN': {
        const ph = this.runPhase;
        const dirS = Math.sign(this.targetX - this.x) || 1;
        T.lean = dirS * (0.2 + Math.max(0, Math.sin(ph * 2)) * 0.05);
        for (const side of [1, -1]) {
          const o = side > 0 ? 0 : Math.PI;
          const lift = Math.max(0, Math.sin(ph + o));
          const [a, b] = this.legIK(side, side * (3.8 + Math.cos(ph + o) * 2.2), g - lift * 7.4);
          if (side > 0) { T.lRa = a; T.lRb = b; } else { T.lLa = a; T.lLb = b; }
          const sw = 0.48 + Math.sin(ph + o + Math.PI) * 0.95;
          const elbow = 0.75 + Math.max(0, Math.sin(ph + o)) * 0.35;
          if (side > 0) { T.aRa = sw; T.aRb = elbow; } else { T.aLa = sw; T.aLb = elbow; }
        }
        T.eye = 1.04 + Math.max(0, Math.sin(ph * 2)) * 0.08;
        T.squint = 0.08;
        break;
      }

      case 'FLIP':
        if (this.phase === 'wind') {
          T.crouch = 1;
          stand(3.5);
          arms(0.35, 0.3);
        } else if (this.phase === 'air') {
          const u = clamp01(this.flightT / this.flightDur);
          const tuck = Math.sin(Math.PI * clamp01(u * 1.15)) ;
          arms(lerp(2.4, 0.7, tuck), lerp(0.2, 2.2, tuck));
          T.lRa = T.lLa = lerp(0.3, 0.95, tuck);
          T.lRb = T.lLb = lerp(-0.3, -1.9, tuck);
          T.happy = 1;
          T.open = 0.7;
          T.smile = 1;
        } else {
          T.crouch = 1;
          stand(4);
          arms(1.25, 0.1);
          T.headTilt = 0.05;
        }
        break;

      case 'SWING': {
        const w = this.web;
        if (this.phase === 'land') {
          T.crouch = 1;
          stand(4.2);
          arms(1.25, 0.1);
          T.happy = 0.8;
          T.open = 0.3;
        } else if (this.phase === 'fall') {
          const u = clamp01(this.flightT / this.flightDur);
          const tuck = Math.sin(Math.PI * clamp01(u * 1.15));
          arms(lerp(2.4, 0.7, tuck), lerp(0.2, 2.2, tuck));
          T.lRa = T.lLa = lerp(0.3, 0.95, tuck);
          T.lRb = T.lLb = lerp(-0.3, -1.9, tuck);
          T.happy = 1;
          T.open = 0.7;
        } else {
          const holdSide = w.side;
          const a = this.pointArm(holdSide, w.ax, w.ay);
          if (holdSide > 0) { T.aRa = a; T.aRb = 0; T.aLa = 1.4; T.aLb = 0.4; }
          else { T.aLa = a; T.aLb = 0; T.aRa = 1.4; T.aRb = 0.4; }
          T.lRa = 0.2; T.lRb = -0.7;
          T.lLa = 0.6; T.lLb = -1.1;
          T.happy = 0.9;
          T.open = 0.6;
          T.smile = 1;
        }
        break;
      }

      case 'SHOOT': {
        const w = this.web;
        const a = this.pointArm(w.side, w.ax, w.ay);
        if (w.side > 0) { T.aRa = a; T.aRb = 0; } else { T.aLa = a; T.aLb = 0; }
        T.squint = 0.5;
        T.happy = 0;
        T.smile = 0.4;
        T.lean = -w.side * 0.06;
        break;
      }

      case 'SENSE': {
        const w = this.web;
        if (this.phase === 'tingle') {
          arms(2.45, 1.5);
          T.eye = 1.25;
          T.pupil = 0.6;
          T.open = 0.3;
          T.smile = -0.2;
          T.happy = 0;
        } else if (this.phase === 'shoot' || this.phase === 'pull') {
          const a = this.pointArm(w.side, this.orb.x, this.orb.y);
          const pull = this.phase === 'pull' ? 0.5 * Math.sin(this.phaseT * 14) : 0;
          if (w.side > 0) { T.aRa = a; T.aRb = pull; } else { T.aLa = a; T.aLb = pull; }
          T.squint = 0.45;
          T.lean = -w.side * 0.12;
          stand(2.2);
        } else {
          if (w.side > 0) { T.aRa = 2.4; T.aRb = 0.3; } else { T.aLa = 2.4; T.aLb = 0.3; }
          T.happy = 0.9;
          T.open = 0.4;
          T.smile = 1;
        }
        break;
      }

      case 'CHEER': {
        const hop = Math.abs(Math.sin(this.phaseT * 7));
        arms(2.7, 0.15 + Math.sin(t * 10) * 0.2);
        stand(1.5, 11 + hop * 1.5);
        T.happy = 1;
        T.open = 0.8;
        T.smile = 1;
        T.headTilt = Math.sin(t * 7) * 0.08;
        break;
      }

      case 'SCARED': {
        const tr = Math.sin(t * 52) * 0.06;
        const peek = this.phase === 'hang' ? Math.pow(Math.sin(Math.PI * clamp01((this.phaseT - 1.2) / 0.7)), 2) : 0;
        arms(3.0 + tr, 0.1);
        T.aRa = 3.0 - peek * 0.6 + tr;
        T.lRa = 0.15; T.lRb = -0.2; T.lLa = 0.15; T.lLb = -0.2;
        T.eye = 1.3;
        T.pupil = 0.55;
        T.open = 0.6;
        T.smile = -0.8;
        T.happy = 0;
        break;
      }

      case 'GRABBED': {
        const sway = this.omega;
        if (this.phase === 'lift') {
          // startled as the feet leave the ground: arms flare out, legs tuck and kick a little
          const f = Math.sin(t * 28);
          arms(1.35 + f * 0.12, 0.35);
          T.lRa = 0.3 + f * 0.18; T.lRb = -0.45;
          T.lLa = 0.3 - f * 0.18; T.lLb = -0.45;
          T.headTilt = 0.06;
        } else {
          // limp dangle: arms drift out when swinging, legs trail the motion
          const spread = clamp(Math.abs(sway) * 0.05, 0, 0.5);
          arms(0.32 + spread + Math.sin(t * 3.1) * 0.05, 0.18 + spread * 0.5);
          const kick = Math.sin(t * 3.4) * 0.09 + clamp(sway * 0.035, -0.3, 0.3);
          T.lRa = 0.1 + kick; T.lRb = -0.16 + Math.sin(t * 3.4 + 1) * 0.1;
          T.lLa = 0.1 - kick; T.lLb = -0.16 - Math.sin(t * 3.4 + 1) * 0.1;
          T.headTilt = clamp(sway * 0.012, -0.14, 0.14);
        }
        break;
      }

      case 'THROWN': {
        if (this.phase === 'air') {
          const f = Math.sin(t * 27);
          if (this.bounces > 0) {
            // bouncing around, limp
            arms(1.0, 0.45);
            T.lRa = 0.3; T.lRb = -0.5; T.lLa = 0.3; T.lLb = -0.5;
            T.headTilt = 0.05;
          } else if (this.vy < -40 * this.scale) {
            // rising: "wheee"
            arms(1.9 + f * 0.15, 0.3);
            T.lRa = 0.4 + f * 0.15; T.lRb = -0.7;
            T.lLa = 0.4 - f * 0.15; T.lLb = -0.7;
          } else {
            // falling: arms up, legs flailing
            arms(2.75 + f * 0.28, 0.2);
            T.lRa = 0.3 + f * 0.4; T.lRb = -0.6;
            T.lLa = 0.3 - f * 0.4; T.lLb = -0.6;
          }
          T.headTilt = clamp(this.omega * 0.01, -0.12, 0.12);
          // reaching for the floor: legs extend and spread before touchdown, then absorb it
          const nearFloor = clamp01(1 - (this.standY - this.py) / this.scale / 28);
          const reach = this.vy > 40 * this.scale || this.bounces > 0 ? nearFloor : 0;
          if (reach > 0.01) {
            const [ra, rb] = this.legIK(1, 3.4 + 2.6, g);
            const [la, lb] = this.legIK(-1, -(3.4 + 2.6), g);
            T.lRa = lerp(T.lRa, ra, reach); T.lRb = lerp(T.lRb, rb, reach);
            T.lLa = lerp(T.lLa, la, reach); T.lLb = lerp(T.lLb, lb, reach);
            T.aRa = lerp(T.aRa, 1.5, reach); T.aRb = lerp(T.aRb, 0.25, reach);
            T.aLa = lerp(T.aLa, 1.5, reach); T.aLb = lerp(T.aLb, 0.25, reach);
          }
          // wall bump: arms flung out, legs tucked, head whips away from the wall
          if (this.wallT > 0) {
            const w = clamp01(this.wallT / 0.45);
            T.aRa = lerp(T.aRa, 2.5 + f * 0.25, w); T.aRb = lerp(T.aRb, 0.3, w);
            T.aLa = lerp(T.aLa, 2.5 - f * 0.25, w); T.aLb = lerp(T.aLb, 0.3, w);
            T.lRa = lerp(T.lRa, 0.9, w); T.lLa = lerp(T.lLa, 0.9, w);
            T.lRb = lerp(T.lRb, -1.4, w); T.lLb = lerp(T.lLb, -1.4, w);
            T.headTilt = this.wallSide * 0.22 * w;
          }
        } else if (this.phase === 'land') {
          T.crouch = 0.6;
          stand(3.6 + this.landIntensity * 1.2); // wide, braced stance
          arms(1.4 + this.landIntensity * 0.5 + Math.max(0, this.landSpring.x) * 0.4, 0.2);
          T.lean = clamp(this.vx * 0.0011, -0.25, 0.25);
        } else {
          // get up and dust off
          const u = clamp01(this.phaseT / this.recoverDur);
          T.crouch = 1 - easeOutCubic(u);
          stand(lerp(4, 0.6, u));
          arms(0.9 + Math.sin(this.phaseT * 18) * 0.35 * (1 - u), 0.8);
          T.headTilt = Math.sin(this.phaseT * 12) * 0.08 * (1 - u) * (1 + this.landIntensity);
        }
        break;
      }

      case 'POKE': {
        T.aRa = 2.7;
        T.aRb = 0.25 + Math.sin(this.phaseT * 12) * 0.5;
        stand(1.4, 10.5);
        T.headTilt = 0.1;
        break;
      }
    }
    return T;
  }

  private updatePose(step: number): void {
    const T = this.targetPose();
    const k = 1 - Math.exp(-step * 16);
    const kf = 1 - Math.exp(-step * 10);
    const p = this.pose;
    for (const key of POSE_KEYS) {
      const face = key === 'eye' || key === 'happy' || key === 'open' || key === 'smile' || key === 'pupil' || key === 'squint';
      p[key] += (T[key] - p[key]) * (face ? kf : k);
    }
  }

  private updateFace(step: number): void {
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
      if (this.state === 'RUN') {
        this.lookTX = Math.sign(this.targetX - this.x) * 0.9;
        this.lookTY = 0;
      } else if (this.state === 'SHOOT' || this.state === 'SENSE' || this.state === 'SWING') {
        const tx = this.state === 'SENSE' ? this.orb.x : this.web.ax;
        this.lookTX = clamp((tx - this.x) / (40 * this.scale), -1, 1);
        this.lookTY = -0.5;
      } else {
        this.lookTX = rand(-0.8, 0.8);
        this.lookTY = rand(-0.4, 0.4);
      }
      this.lookTimer = rand(1, 2.6);
    }
    const lk = 1 - Math.exp(-step * 9);
    this.lookX += (this.lookTX - this.lookX) * lk;
    this.lookY += (this.lookTY - this.lookY) * lk;
  }

  /* ------------------------------------------------------------------------ */
  /*  Particles                                                                */
  /* ------------------------------------------------------------------------ */

  private spawn(kind: Particle['kind'], init: Partial<Particle>): void {
    this.particles.push({ kind, x: 0, y: 0, vx: 0, vy: 0, life: 1, max: 1, size: 1, col: '255,255,255', a: 0, ...init });
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.shift();
    }
  }

  private burst(x: number, y: number, n: number, col: string): void {
    const s = this.scale;
    for (let i = 0; i < n; i++) {
      const an = rand(0, TAU);
      const sp = rand(20, 60) * s;
      this.spawn('spark', {
        x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp,
        life: rand(0.3, 0.6), max: 0.6, size: rand(0.8, 1.6) * s, col,
      });
    }
  }

  private updateParticles(step: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= step;
      if (p.kind === 'spark') {
        p.vx *= Math.exp(-step * 1.6);
        p.vy = p.vy * Math.exp(-step * 1.6) + 60 * step;
        p.x += p.vx * step;
        p.y += p.vy * step;
      } else if (p.kind === 'puff') {
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.size += step * 8 * this.scale;
      }
      if (p.life <= 0) {
        const last = this.particles.pop();
        if (last && last !== p) {
          this.particles[i] = last;
        }
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Geometry helpers                                                         */
  /* ------------------------------------------------------------------------ */

  /** Local (pelvis-space) point -> world. `upper` applies the torso lean. */
  private toWorld(lx: number, ly: number, upper: boolean): { x: number; y: number } {
    let x = lx;
    let y = ly;
    if (upper) {
      const c = Math.cos(this.pose.lean);
      const s = Math.sin(this.pose.lean);
      [x, y] = [x * c - y * s, x * s + y * c];
    }
    const c2 = Math.cos(this.rot);
    const s2 = Math.sin(this.rot);
    return { x: this.x + (x * c2 - y * s2) * this.scale, y: this.y + (x * s2 + y * c2) * this.scale };
  }

  private armPoints(side: number, a: number, b: number): { p1: [number, number]; p2: [number, number] } {
    const sx = side * 5.8;
    const sy = -9.2;
    const p1: [number, number] = [sx + side * Math.sin(a) * L_UP, sy + Math.cos(a) * L_UP];
    const p2: [number, number] = [p1[0] + side * Math.sin(a + b) * L_FORE, p1[1] + Math.cos(a + b) * L_FORE];
    return { p1, p2 };
  }

  private handWorld(side: number): { x: number; y: number } {
    const p = this.pose;
    const a = side > 0 ? p.aRa : p.aLa;
    const b = side > 0 ? p.aRb : p.aLb;
    const h = this.armPoints(side, a, b).p2;
    return this.toWorld(h[0], h[1], true);
  }

  /* ------------------------------------------------------------------------ */
  /*  Render                                                                   */
  /* ------------------------------------------------------------------------ */

  public render(ctx: CanvasRenderingContext2D): void {
    if (this.isDisposed) {
      return;
    }
    const s = this.scale;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    this.renderShadow(ctx);
    this.renderWeb(ctx);

    // ---- body -----------------------------------------------------------------
    const bob = -Math.abs(Math.sin(this.runPhase)) * 1.1 * this.runAmt;
    const sway = Math.sin(this.time * 1.3) * 0.3 * (1 - this.runAmt);
    const sq = this.squash;
    const stretch = clamp(Math.abs(this.vy) / (260 * s), 0, 1) * 0.1 + this.heldStretch;
    ctx.translate(this.x, this.y);
    const wl = this.wallSpring.x;
    ctx.rotate(this.rot + this.wallSide * 0.28 * wl); // head whips away from the wall
    const lStretch = Math.max(0, -this.landSpring.x) * 0.9; // rebound: springs back up
    ctx.scale(
      s * (1 + sq * 0.14 - (stretch + lStretch) * 0.5) * (1 - 0.18 * wl),
      s * (1 - sq * 0.18 + stretch + lStretch) * (1 + 0.08 * wl)
    );
    ctx.translate(sway, bob);
    if (this.state === 'RUN' && this.runDirection < 0) {
      ctx.scale(-1, 1);
    }
    this.renderCharacter(ctx);
    ctx.restore();

    this.renderOrb(ctx);
    this.renderParticles(ctx);
    this.renderSenseLines(ctx);
    this.renderExclaim(ctx);
  }

  private renderCharacter(ctx: CanvasRenderingContext2D): void {
    const p = this.pose;
    const breath = Math.sin(this.time * 2.2) * 0.25;
    this.drawLeg(ctx, -1, p.lLa, p.lLb);
    this.drawLeg(ctx, 1, p.lRa, p.lRb);
    ctx.save();
    ctx.rotate(p.lean);
    this.drawArm(ctx, -1, p.aLa, p.aLb);
    this.drawArm(ctx, 1, p.aRa, p.aRb);
    this.drawBody(ctx, HERO_FACE_COLORS, breath);
    // Keep the arms behind the torso, while bringing only the red mitts forward.
    this.drawHand(ctx, -1, p.aLa, p.aLb);
    this.drawHand(ctx, 1, p.aRa, p.aRb);
    this.drawHead(ctx, this.faceState, HERO_FACE_COLORS, breath);
    ctx.restore();
  }

  private addCapsule(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number, r1: number,
    x2: number, y2: number, r2: number
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    if (d <= Math.abs(r1 - r2) + 0.001) {
      ctx.moveTo(x1 + r1, y1);
      ctx.arc(x1, y1, r1, 0, TAU);
      ctx.moveTo(x2 + r2, y2);
      ctx.arc(x2, y2, r2, 0, TAU);
      return;
    }
    const a = Math.atan2(dy, dx);
    const t = Math.acos((r1 - r2) / d);
    ctx.moveTo(x1 + Math.cos(a + t) * r1, y1 + Math.sin(a + t) * r1);
    ctx.arc(x1, y1, r1, a + t, a + TAU - t, false);
    ctx.arc(x2, y2, r2, a - t, a + t, false);
    ctx.closePath();
  }

  private suitGrad(ctx: CanvasRenderingContext2D, x0: number, x1: number): CanvasGradient {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, SUIT_HI);
    g.addColorStop(0.45, SUIT);
    g.addColorStop(1, SUIT_DK);
    return g;
  }

  private drawLeg(ctx: CanvasRenderingContext2D, side: number, a: number, b: number): void {
    const rx = side * 3.6;
    const ry = 1;
    const p1x = rx + side * Math.sin(a) * L_LEG;
    const p1y = ry + Math.cos(a) * L_LEG;
    const p2x = p1x + side * Math.sin(a + b) * L_LEG;
    const p2y = p1y + Math.cos(a + b) * L_LEG;

    ctx.beginPath();
    this.addCapsule(ctx, rx, ry, 4.1, p1x, p1y, 3.8);
    this.addCapsule(ctx, p1x, p1y, 3.8, p2x, p2y, 3.5);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.fillStyle = this.suitGrad(ctx, rx - 4, rx + 4);
    ctx.fill();

    // boot
    ctx.save();
    ctx.translate(p2x, p2y + 0.6);
    ctx.rotate(side * (a + b) * 0.4);
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.4, 3.5, 0, 0, TAU);
    const bg = ctx.createLinearGradient(0, -3, 0, 3);
    bg.addColorStop(0, '#ff6670');
    bg.addColorStop(1, ACCENT_DK);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(74,12,25,0.65)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(0, 0, 2.7, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(-1.3, -1.2, 1.1, 0.7, -0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawArm(ctx: CanvasRenderingContext2D, side: number, a: number, b: number): void {
    const sx = side * 6.2;
    const sy = -9.6;
    const { p1, p2 } = this.armPoints(side, a, b);

    ctx.beginPath();
    this.addCapsule(ctx, sx, sy, 3.4, p1[0], p1[1], 3.1);
    this.addCapsule(ctx, p1[0], p1[1], 3.1, p2[0], p2[1], 2.9);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.fillStyle = this.suitGrad(ctx, sx - 4, sx + 4);
    ctx.fill();

    // wrist web-shooter
    const wx = lerp(p1[0], p2[0], 0.72);
    const wy = lerp(p1[1], p2[1], 0.72);
    ctx.fillStyle = GLOW;
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(wx, wy, 1.35, 0, TAU);
    ctx.fill();
    ctx.stroke();

  }

  private drawHand(ctx: CanvasRenderingContext2D, side: number, a: number, b: number): void {
    const { p2 } = this.armPoints(side, a, b);
    ctx.beginPath();
    ctx.arc(p2[0], p2[1], 3.1, 0, TAU);
    const mg = ctx.createRadialGradient(p2[0] - 1, p2[1] - 1.2, 0.3, p2[0], p2[1], 3.4);
    mg.addColorStop(0, '#ff7278');
    mg.addColorStop(1, ACCENT_DK);
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(p2[0] - 1, p2[1] - 1.1, 0.8, 0, TAU);
    ctx.fill();
  }

  private drawBody(ctx: CanvasRenderingContext2D, colors: HeroFaceColors, breath: number): void {
    const c = colors;
    ctx.save();
    ctx.translate(0, 15.4);
    ctx.scale(0.82, -0.69);
    const rx = 9.4 + breath * 0.2;
    const ry = 11.2 + breath * 0.3;
    ctx.beginPath(); ctx.ellipse(0, 31, rx, ry, 0, 0, TAU); ctx.clip();
    const torso = ctx.createLinearGradient(-9, 0, 9, 0);
    torso.addColorStop(0, c.mainDark);
    torso.addColorStop(0.5, c.main);
    torso.addColorStop(1, c.mainDark);
    ctx.fillStyle = torso;
    ctx.fillRect(-12, 18, 24, 26);
    ctx.fillStyle = c.accent;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(side * 10.5, 31, 3.6, 12, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = c.mainLight;
    ctx.fillRect(-12, 20.5, 24, 3);
    ctx.fillStyle = c.frame;
    ctx.fillRect(-1.6, 20.3, 3.2, 3.4);
    ctx.strokeStyle = c.pattern;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 18, 12, 0.3, 2.8);
    ctx.arc(0, 18, 19, 0.5, 2.6);
    ctx.moveTo(0, 24); ctx.lineTo(0, 42);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = c.frame;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -6.0, rx * 0.82, ry * 0.69, 0, 0, TAU); ctx.stroke();
  }

  private drawHead(
    ctx: CanvasRenderingContext2D,
    faceState: FaceState,
    colors: HeroFaceColors,
    breath: number
  ): void {
    const c = colors;
    ctx.save();
    ctx.translate(0, 15.4);
    ctx.scale(0.82, -0.69);
    // Bring the oversized mask down into the shoulder line so it clearly sits
    // in front of the suit and arms in the final paint pass.
    ctx.translate(0, 59 + breath * 0.3);
    ctx.rotate(Math.PI + faceState.headRotation);

    const radius = 22.5;
    const sphere = ctx.createRadialGradient(-6, -8, 2, 0, 0, 22);
    sphere.addColorStop(0, c.mainLight);
    sphere.addColorStop(0.6, c.main);
    sphere.addColorStop(1, c.mainDark);
    ctx.fillStyle = sphere;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();

    // Mask webbing is clipped to the sphere and stays behind the lenses.
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.clip();
    ctx.strokeStyle = c.pattern;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const angle = 0.45 + (i * (Math.PI - 0.9)) / 6;
      ctx.moveTo(0, -radius);
      ctx.lineTo(Math.cos(angle) * 40, -radius + Math.sin(angle) * 40);
    }
    for (const ring of [10, 19, 29]) {
      ctx.moveTo(Math.cos(0.35) * ring, -radius + Math.sin(0.35) * ring);
      ctx.quadraticCurveTo(0, -radius + ring * 1.18, -Math.cos(0.35) * ring, -radius + Math.sin(0.35) * ring);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = c.frame;
    ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();

    const blink = 1 - Math.sin(faceState.blinkProgress * Math.PI);
    const eyeHeight = faceState.expression === 'SLEEPY'
      ? faceState.size
      : faceState.size * clamp(blink, 0.04, 1);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 10.4, 1.5);
      if (faceState.happy > 0.5) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = c.frame;
        ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.arc(0, 2.5, 5.4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        ctx.strokeStyle = c.lens;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      } else {
        ctx.scale(side < 0 ? faceState.width : -faceState.width, Math.max(0.08, eyeHeight));
        ctx.beginPath();
        ctx.moveTo(6.2, 3 + faceState.slant * 0.4);
        ctx.quadraticCurveTo(-1.5, 6.4, -8.8, -3.4 - faceState.slant);
        ctx.quadraticCurveTo(-0.5, -4.8, 6.2, -0.4);
        ctx.closePath();
        const lens = ctx.createLinearGradient(-8, -4, 6, 4);
        lens.addColorStop(0, c.lens);
        lens.addColorStop(1, c.lensEdge);
        ctx.fillStyle = lens;
        ctx.fill();
        ctx.lineJoin = 'round';
        ctx.strokeStyle = c.frame;
        ctx.lineWidth = 3.4 / Math.max(0.35, eyeHeight);
        ctx.stroke();
        ctx.fillStyle = c.lens;
        ctx.beginPath(); ctx.ellipse(-2.4, -0.8, 2.2, 0.9, -0.3, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /* ---- ground, web, effects ----------------------------------------------------- */

  private renderShadow(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    const above = Math.max(0, (this.floorY - this.y) / s - FOOT_DROP);
    const k = 1 / (1 + above / 24);
    const rx = 14 * s * (0.8 + 0.4 * k);
    ctx.save();
    ctx.translate(this.x + above * 0.1 * s, this.floorY);
    ctx.scale(1, 0.22);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 1.4);
    g.addColorStop(0, `rgba(6,8,30,${(0.4 * k).toFixed(3)})`);
    g.addColorStop(0.6, `rgba(6,8,30,${(0.18 * k).toFixed(3)})`);
    g.addColorStop(1, 'rgba(6,8,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 1.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private webStart(): { x: number; y: number } {
    if (this.web.from === 'feet') {
      return this.toWorld(0, 15, false);
    }
    return this.handWorld(this.web.side);
  }

  private renderWeb(ctx: CanvasRenderingContext2D): void {
    const w = this.web;
    if (!w.on || w.k <= 0.01) {
      return;
    }
    const s = this.scale;
    const a = this.webStart();
    const ex = lerp(a.x, w.ax, w.k);
    const ey = lerp(a.y, w.ay, w.k);
    const sag = (w.k < 1 ? 7 * Math.sin(this.time * 40) : 1.6 * Math.sin(this.time * 3)) * s;
    const cx = (a.x + ex) / 2;
    const cy = (a.y + ey) / 2 + sag;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(190,180,255,0.18)';
    ctx.lineWidth = 3.4 * s;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();

    if (w.k >= 0.98) {
      // little web splat where the thread sticks
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.9 * s;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const an = (i / 6) * TAU;
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(an) * 4.5 * s, ey + Math.sin(an) * 4.5 * s);
      }
      for (let i = 0; i < 6; i++) {
        const a1 = (i / 6) * TAU;
        const a2 = ((i + 1) / 6) * TAU;
        ctx.moveTo(ex + Math.cos(a1) * 2.6 * s, ey + Math.sin(a1) * 2.6 * s);
        ctx.lineTo(ex + Math.cos(a2) * 2.6 * s, ey + Math.sin(a2) * 2.6 * s);
      }
      ctx.stroke();
    }
  }

  private renderOrb(ctx: CanvasRenderingContext2D): void {
    const o = this.orb;
    if (!o.on || o.a <= 0.01) {
      return;
    }
    const s = this.scale;
    const bob = Math.sin(this.time * 4) * 1.2 * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(o.x, o.y + bob, 0, o.x, o.y + bob, 14 * s);
    g.addColorStop(0, `rgba(160,245,255,${(0.7 * o.a).toFixed(3)})`);
    g.addColorStop(1, 'rgba(160,245,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y + bob, 14 * s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${o.a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(o.x, o.y + bob, 3.4 * s, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(201,255,77,${(0.8 * o.a).toFixed(3)})`;
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    ctx.arc(o.x, o.y + bob, 6.5 * s, this.time * 3, this.time * 3 + Math.PI * 1.3);
    ctx.stroke();
    ctx.restore();
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const u = clamp01(1 - p.life / p.max);
      const fade = 1 - u;
      if (p.kind === 'puff') {
        ctx.fillStyle = `rgba(${p.col},${(0.35 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(${p.col},${(0.3 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === 'ring') {
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.a === 1) {
          ctx.scale(1, 0.28);
        }
        ctx.strokeStyle = `rgba(${p.col},${(0.6 * fade).toFixed(3)})`;
        ctx.lineWidth = 2 * fade + 0.4;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0.1, p.size * easeOutCubic(u)), 0, TAU);
        ctx.stroke();
        ctx.restore();
      } else {
        const r = p.size * Math.sin(Math.PI * u);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a + u);
        ctx.fillStyle = `rgba(${p.col},0.95)`;
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
      }
    }
  }

  /** Hero-sense tingle lines radiating from the head. */
  private renderSenseLines(ctx: CanvasRenderingContext2D): void {
    if (this.sense <= 0.02) {
      return;
    }
    const s = this.scale;
    const head = this.toWorld(0, -23, true);
    const flick = 0.6 + 0.4 * Math.sin(this.time * 38);
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const an = -Math.PI / 2 + (i - 3) * 0.42;
      const r0 = (15 + (i % 2) * 2) * s;
      const r1 = r0 + (6 + 3 * Math.sin(this.time * 30 + i)) * s;
      ctx.strokeStyle = `rgba(201,255,77,${(0.9 * this.sense * flick).toFixed(3)})`;
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.moveTo(head.x + Math.cos(an) * r0, head.y + Math.sin(an) * r0);
      ctx.lineTo(head.x + Math.cos(an) * r1, head.y + Math.sin(an) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderExclaim(ctx: CanvasRenderingContext2D): void {
    if (this.exclaim <= 0) {
      return;
    }
    const s = this.scale;
    const t = 1 - this.exclaim / 1.4;
    const pop = easeOutBack(clamp01(t * 5));
    const a = Math.min(1, this.exclaim / 0.4);
    const head = this.toWorld(0, -23, true);
    ctx.save();
    ctx.translate(head.x + 15 * s, head.y - 14 * s);
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
    this.cancelInteraction();
    this.isDisposed = true;
    this.press = null;
    this.pointerSamples.length = 0;
    this.particles = [];
  }
}
