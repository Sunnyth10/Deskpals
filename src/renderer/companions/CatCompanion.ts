import { IEntity, LivingEventType, ZoneBounds, ZoneType } from '../../core/types';
import { ParticleEngine } from '../../engine/particles/ParticleEngine';
import { clampCompanionX, companionXBounds } from './CompanionBounds';
import { CatGrabLayer } from './CatGrab';

export type CatState = 'SLEEP' | 'IDLE' | 'LOOK' | 'STRETCH' | 'WALK' | 'PURR' | 'HELD' | 'FALL' | 'LAND';

const TAU = Math.PI * 2;
const DESIGN_HEIGHT = 48;
const PAW_Y = -4.2;
const WALK_STRIDE = 6.2;
const WALK_LIFT = 3.6;

const OUTLINE = '#dbb4c5';
const OUTLINE_RGB = '219,180,197';
const FUR = '#ffffff';
const FUR_FAR = '#f1e2ea';
const PINK_SOFT = '#fbb9d2';
const INK = '#4a3347';

type RGB = [number, number, number];
const WHITE_RGB: RGB = [255, 255, 255];
const PINK_RGB: RGB = [249, 150, 190];

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const mixRgb = (a: RGB, b: RGB, t: number): string =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(
    a[2] + (b[2] - a[2]) * t
  )})`;

interface Pose {
  hipX: number; hipY: number; hipR: number;
  chestX: number; chestY: number; chestR: number;
  headX: number; headY: number; headR: number; headTilt: number; faceShift: number;
  fpNearX: number; fpFarX: number; hpNearX: number; hpFarX: number;
  stride: number; lift: number;
  earPerk: number; earSplay: number;
  eyeOpen: number; happy: number; dilate: number;
  blush: number; smile: number;
  tailBase: number; tailCurl: number; tailSway: number; tailSpeed: number;
  shadowRx: number; shadowX: number;
}

const SIT: Pose = {
  hipX: 5, hipY: -8.5, hipR: 9,
  chestX: -0.5, chestY: -18.5, chestR: 7.3,
  headX: -1.5, headY: -30, headR: 10.5, headTilt: 0, faceShift: 0,
  fpNearX: -4, fpFarX: -9.5, hpNearX: 0, hpFarX: 9,
  stride: 0, lift: 0,
  earPerk: 1, earSplay: 0,
  eyeOpen: 1, happy: 0, dilate: 1,
  blush: 0.5, smile: 0.35,
  tailBase: 0.25, tailCurl: -0.2, tailSway: 0.2, tailSpeed: 2.2,
  shadowRx: 14, shadowX: 2,
};

const POSES: Record<CatState, Pose> = {
  IDLE: SIT,
  LOOK: { ...SIT, earPerk: 1.2, dilate: 1.28, blush: 0.38, smile: 0.15, tailSway: 0.32, tailSpeed: 4.6 },
  PURR: {
    ...SIT,
    headTilt: 0.08, earPerk: 0.9, earSplay: 0.15,
    happy: 1, blush: 0.9, smile: 1,
    tailBase: -1.15, tailCurl: -0.12, tailSway: 0.26, tailSpeed: 1.8,
  },
  SLEEP: {
    hipX: 6, hipY: -7.4, hipR: 7.6,
    chestX: -3.5, chestY: -7.4, chestR: 7.2,
    headX: -12.5, headY: -10.6, headR: 9.6, headTilt: -0.2, faceShift: -0.35,
    fpNearX: -17, fpFarX: -9.5, hpNearX: -1, hpFarX: 8,
    stride: 0, lift: 0,
    earPerk: 0.6, earSplay: 0.45,
    eyeOpen: 0, happy: 0, dilate: 0.8,
    blush: 0.6, smile: 0.5,
    tailBase: 0.12, tailCurl: -0.14, tailSway: 0.08, tailSpeed: 1.0,
    shadowRx: 22, shadowX: -1,
  },
  STRETCH: {
    hipX: 10, hipY: -18, hipR: 7.6,
    chestX: -8, chestY: -11.5, chestR: 7,
    headX: -19.5, headY: -10, headR: 9.8, headTilt: 0.15, faceShift: -0.45,
    fpNearX: -27, fpFarX: -22, hpNearX: 9, hpFarX: 12,
    stride: 0, lift: 0,
    earPerk: 0.9, earSplay: 0.2,
    eyeOpen: 1, happy: 0.85, dilate: 1,
    blush: 0.65, smile: 0.5,
    tailBase: -1.35, tailCurl: -0.05, tailSway: 0.14, tailSpeed: 2,
    shadowRx: 28, shadowX: -8,
  },
  WALK: {
    hipX: 8, hipY: -15, hipR: 7.8,
    chestX: -6, chestY: -16, chestR: 7.4,
    headX: -17, headY: -24, headR: 10, headTilt: 0.06, faceShift: -0.5,
    fpNearX: -7, fpFarX: -7, hpNearX: 9, hpFarX: 9,
    stride: WALK_STRIDE, lift: WALK_LIFT,
    earPerk: 1, earSplay: 0.1,
    eyeOpen: 1, happy: 0, dilate: 1,
    blush: 0.5, smile: 0.6,
    tailBase: -1.0, tailCurl: -0.14, tailSway: 0.24, tailSpeed: 3,
    shadowRx: 19, shadowX: -1,
  },
  HELD: {
    ...SIT,
    hipX: 3.5, hipY: -7.5, hipR: 8.4,
    chestX: -0.8, chestY: -18.8, chestR: 7,
    headX: -1.6, headY: -31, headR: 10.5, headTilt: -0.12, faceShift: 0,
    earPerk: 0.75, earSplay: 0.4,
    eyeOpen: 0.6, happy: 0, dilate: 1.2,
    blush: 0.25, smile: 0,
    tailBase: 1.4, tailCurl: 0.03, tailSway: 0.1, tailSpeed: 1.3,
    shadowRx: 12, shadowX: 0,
  },
  FALL: {
    ...SIT,
    hipX: 8, hipY: -15, hipR: 7.8,
    chestX: -6, chestY: -16, chestR: 7.4,
    headX: -17, headY: -24, headR: 10, headTilt: 0.06, faceShift: -0.5,
    fpNearX: -7, fpFarX: -7, hpNearX: 9, hpFarX: 9,
    earPerk: 0.85, earSplay: 0.5,
    eyeOpen: 1, happy: 0, dilate: 1.45,
    blush: 0.3, smile: 0,
    tailBase: -1.55, tailCurl: 0.1, tailSway: 0.4, tailSpeed: 5.5,
    shadowRx: 19, shadowX: -1,
  },
  LAND: {
    ...SIT,
    hipX: 8, hipY: -15, hipR: 7.8,
    chestX: -6, chestY: -16, chestR: 7.4,
    headX: -17, headY: -24, headR: 10, headTilt: 0.06, faceShift: -0.5,
    fpNearX: -7, fpFarX: -7, hpNearX: 9, hpFarX: 9,
    earPerk: 0.9, earSplay: 0.2,
    eyeOpen: 0.85, happy: 0, dilate: 1.1,
    blush: 0.45, smile: 0.3,
    tailBase: -0.7, tailCurl: -0.1, tailSway: 0.15, tailSpeed: 2.2,
    shadowRx: 19, shadowX: -1,
  },
};

const POSE_KEYS = Object.keys(SIT) as (keyof Pose)[];

interface Floater {
  kind: 'heart' | 'z';
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number; phase: number;
}

export class CatCompanion implements IEntity {
  public readonly id: string;
  public readonly zone: ZoneType;
  public x: number;
  public y: number;
  public isDisposed = false;

  public state: CatState = 'SLEEP';
  private stateTimer = 0;
  private stateDuration = 8;

  private readonly walkSpeed = 26;
  private readonly maxScale: number;
  private scale = 1;
  private bounds?: ZoneBounds;

  private pose: Pose = { ...POSES.SLEEP };
  private time = 0;
  private breathPhase = Math.random() * TAU;
  private breathAmp = 1;
  private tailPhase = Math.random() * TAU;
  private walkPhase = 0;

  private facingRight = false;
  private flip = 1;

  private blinkTimer = 2;
  private blinkProgress = 0;
  private lookX = 0;
  private lookY = 0;
  private lookTX = 0;
  private lookTY = 0;
  private lookTimer = 0;
  private headTurn = 0;
  private headTurnTarget = 0;
  private earTwitch = 0;
  private earFlick = 0;
  private earFlickSide = 1;
  private earTimer = 3;
  private startle = 0;
  private yawn = 0;
  private purrAmt = 0;

  private hopY = 0;
  private hopVel = 0;

  private floaters: Floater[] = [];
  private spawnTimer = 1;

  private particleEngine?: ParticleEngine;

  // Interaction (pick up / throw / drop)
  private readonly gl = new CatGrabLayer();
  private interactive = true;
  private queuedEvent: LivingEventType | null = null;
  private grabbedLast = false;

  constructor(
    id: string,
    zone: ZoneType,
    startX: number,
    startY: number,
    particleEngine?: ParticleEngine,
    maxScale = 1.2
  ) {
    this.id = id;
    this.zone = zone;
    this.x = startX;
    this.y = startY;
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
    if (this.gl.grab.active) {
      this.queuedEvent = eventName;
      return;
    }

    if (eventName === 'save') {
      this.state = 'LOOK';
      this.stateTimer = 0;
      this.stateDuration = 4.0;
      this.earTwitch = 1.0;
      this.startle = 0.5;
      this.lookTimer = 0;
      this.hopVel = 45;
      this.particleEngine?.spawnGlitterBurst(this.x, this.y - 15, 3, ['#fbbf24', '#ffffff']);
    } else if (eventName === 'buildSuccess') {
      this.state = 'PURR';
      this.stateTimer = 0;
      this.stateDuration = 5.0;
      this.hopVel = 85;
      this.spawnTimer = 0;
      this.particleEngine?.spawnGlitterBurst(this.x, this.y - 20, 6, ['#4ade80', '#fbbf24', '#ffffff']);
    } else if (eventName === 'buildError') {
      this.state = 'LOOK';
      this.stateTimer = 0;
      this.stateDuration = 3.5;
      this.earTwitch = 1.5;
      this.startle = 1;
      this.lookTimer = 0;
      this.hopVel = 105;
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

    this.scale = clamp((bounds.height - 6) / DESIGN_HEIGHT, 0.55, this.maxScale);

    const grabbed = this.updateGrab(step, bounds);
    if (!grabbed && this.stateTimer >= this.stateDuration) {
      this.transitionNextState();
    }

    this.blendPose(step);
    this.updateFace(step);
    if (!grabbed) {
      this.updateMotion(step, bounds);
    }
    this.updateFloaters(step);

    this.y = bounds.y + bounds.height - 4;
  }

  /** Runs the pick-up / throw / drop driver. Returns true while it controls the cat. */
  private updateGrab(step: number, bounds: ZoneBounds): boolean {
    const s = this.scale;
    const { minX, maxX } = companionXBounds('cat', bounds);
    const floorY = bounds.y + bounds.height - 4;
    const o = this.gl.update(step, {
      scale: s, floorY, minX, maxX, topY: bounds.y + 46 * s,
      x: this.x, hopY: this.hopY, facingRight: this.facingRight,
    });

    if (o.poke && !o.active) {
      this.state = 'PURR'; this.stateTimer = 0; this.stateDuration = 2.4;
      this.hopVel = 70; this.spawnTimer = 0; this.earTwitch = 0.6;
    }

    if (o.active) {
      if (this.state !== o.state) {
        this.state = o.state; this.stateTimer = 0; this.stateDuration = 999;
      }
      this.x = o.x;
      this.hopY = o.hopY;
      this.hopVel = 0;
      if (o.faceRight !== null && o.faceRight !== this.facingRight) {
        this.facingRight = o.faceRight;
        this.flip = this.facingRight ? -1 : 1; // turn instantly in the air (no squash through the middle)
      }
      this.flip += ((this.facingRight ? -1 : 1) - this.flip) * (1 - Math.exp(-step * 10));
      this.startle = Math.max(this.startle, o.state === 'FALL' ? 0.5 : 0.25);
    } else if (this.grabbedLast) {
      this.hopY = 0;
      this.hopVel = 0;
      this.state = 'IDLE'; this.stateTimer = 0; this.stateDuration = 2 + Math.random() * 2;
      if (this.queuedEvent) {
        const e = this.queuedEvent;
        this.queuedEvent = null;
        this.reactToEvent(e);
      }
    }
    this.grabbedLast = o.active;
    return o.active;
  }

  private blendPose(step: number): void {
    const target = POSES[this.state];
    const cur = this.pose;
    const a = 1 - Math.exp(-step * 5.5);

    for (const key of POSE_KEYS) {
      if (key === 'eyeOpen' || key === 'happy') {
        continue;
      }
      cur[key] += (target[key] - cur[key]) * a;
    }

    const eyeRate = target.eyeOpen < cur.eyeOpen ? 3 : 12;
    cur.eyeOpen += (target.eyeOpen - cur.eyeOpen) * (1 - Math.exp(-step * eyeRate));
    cur.happy += (target.happy - cur.happy) * (1 - Math.exp(-step * 7));
  }

  private updateFace(step: number): void {
    this.blinkTimer -= step;
    if (this.blinkTimer <= 0 && this.blinkProgress === 0) {
      this.blinkProgress = 0.001;
      this.blinkTimer = Math.random() < 0.18 ? 0.22 : rand(2.4, 5.5);
    }
    if (this.blinkProgress > 0) {
      this.blinkProgress += step / 0.18;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = 0;
      }
    }

    this.lookTimer -= step;
    if (this.lookTimer <= 0) {
      switch (this.state) {
        case 'LOOK':
          this.lookTX = rand(-1, 1);
          this.lookTY = rand(-0.5, 0.7);
          this.headTurnTarget = this.lookTX * 0.9;
          this.lookTimer = rand(0.8, 1.8);
          break;
        case 'IDLE':
          this.lookTX = rand(-0.7, 0.7);
          this.lookTY = rand(-0.2, 0.3);
          this.headTurnTarget = this.lookTX * 0.5;
          this.lookTimer = rand(2, 5);
          break;
        case 'WALK':
          this.lookTX = -0.7;
          this.lookTY = 0;
          this.headTurnTarget = 0;
          this.lookTimer = 1;
          break;
        default:
          this.lookTX = 0;
          this.lookTY = 0;
          this.headTurnTarget = 0;
          this.lookTimer = 1;
          break;
      }
    }
    this.lookX += (this.lookTX - this.lookX) * (1 - Math.exp(-step * 9));
    this.lookY += (this.lookTY - this.lookY) * (1 - Math.exp(-step * 9));
    this.headTurn += (this.headTurnTarget - this.headTurn) * (1 - Math.exp(-step * 4));

    this.earTimer -= step;
    if (this.earTimer <= 0) {
      this.earFlick = 1;
      this.earFlickSide = Math.random() < 0.5 ? -1 : 1;
      this.earTimer = rand(2.5, 6.5);
    }
    this.earFlick = Math.max(0, this.earFlick - step * 3.2);
    this.earTwitch = Math.max(0, this.earTwitch - step * 2);
    this.startle = Math.max(0, this.startle - step * 1.4);

    const progress = this.stateDuration > 0 ? this.stateTimer / this.stateDuration : 0;
    const yawnTarget = this.state === 'STRETCH' && progress > 0.3 && progress < 0.75 ? 1 : 0;
    this.yawn += (yawnTarget - this.yawn) * (1 - Math.exp(-step * 6));

    this.purrAmt += ((this.state === 'PURR' ? 1 : 0) - this.purrAmt) * (1 - Math.exp(-step * 4));

    const sleeping = this.state === 'SLEEP';
    this.breathPhase += step * (sleeping ? 1.9 : 2.8);
    const breathTarget = sleeping ? 1 : this.state === 'PURR' ? 0.8 : 0.5;
    this.breathAmp += (breathTarget - this.breathAmp) * (1 - Math.exp(-step * 3));
    this.tailPhase += step * this.pose.tailSpeed;
  }

  private updateMotion(step: number, bounds: ZoneBounds): void {
    const walkAmt = clamp01(this.pose.stride / WALK_STRIDE);

    this.walkPhase += (step * Math.PI * (this.walkSpeed / this.scale)) / (2 * WALK_STRIDE);

    if (walkAmt > 0.01) {
      this.x += this.walkSpeed * walkAmt * step * (this.facingRight ? 1 : -1);
    }

    const { minX, maxX } = companionXBounds('cat', bounds);
    const clampedX = clampCompanionX('cat', this.x, bounds);
    if (this.x < minX) {
      this.x = clampedX;
      this.facingRight = true;
    } else if (this.x > maxX) {
      this.x = clampedX;
      this.facingRight = false;
    }

    const flipTarget = this.facingRight ? -1 : 1;
    this.flip += (flipTarget - this.flip) * (1 - Math.exp(-step * 10));

    if (this.hopY > 0 || this.hopVel > 0) {
      this.hopVel -= 460 * step;
      this.hopY += this.hopVel * step;
      if (this.hopY <= 0) {
        this.hopY = 0;
        this.hopVel = 0;
      }
    }
  }

  private updateFloaters(step: number): void {
    this.spawnTimer -= step;
    if (this.spawnTimer <= 0) {
      const head = this.headWorld();
      if (this.state === 'PURR' && this.purrAmt > 0.5) {
        this.pushFloater({
          kind: 'heart',
          x: head.x + rand(-6, 6) * this.scale,
          y: head.y - 12 * this.scale,
          vx: rand(-5, 5),
          vy: rand(-20, -14),
          life: 1.7, maxLife: 1.7,
          size: rand(3.2, 5.2) * this.scale,
          phase: rand(0, TAU),
        });
        this.spawnTimer = rand(0.35, 0.6);
      } else if (this.state === 'SLEEP' && this.pose.eyeOpen < 0.15) {
        this.pushFloater({
          kind: 'z',
          x: head.x + 8 * this.scale,
          y: head.y - 10 * this.scale,
          vx: 6, vy: -10,
          life: 2.6, maxLife: 2.6,
          size: 6 * this.scale,
          phase: rand(0, TAU),
        });
        this.spawnTimer = rand(1.3, 1.9);
      } else {
        this.spawnTimer = 0.3;
      }
    }

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= step;
      f.x += f.vx * step;
      f.y += f.vy * step;
      if (f.life <= 0) {
        this.floaters.splice(i, 1);
      }
    }
  }

  private pushFloater(f: Floater): void {
    this.floaters.push(f);
    if (this.floaters.length > 14) {
      this.floaters.shift();
    }
  }

  private headWorld(): { x: number; y: number } {
    const s = this.scale;
    return {
      x: this.x + (this.pose.headX + this.headTurn * 1.4) * s * this.flip,
      y: this.y + this.pose.headY * s - this.hopY,
    };
  }

  private pickWalkDirection(): void {
    const b = this.bounds;
    if (!b) {
      this.facingRight = Math.random() > 0.5;
      return;
    }
    const margin = 32 * this.scale;
    const minX = b.x + margin;
    const maxX = b.x + b.width - margin;
    if (this.x < minX + 40) {
      this.facingRight = true;
    } else if (this.x > maxX - 40) {
      this.facingRight = false;
    } else {
      this.facingRight = Math.random() > 0.5;
    }
  }

  private transitionNextState(): void {
    this.stateTimer = 0;
    this.lookTimer = 0;

    switch (this.state) {
      case 'SLEEP':
        this.state = Math.random() > 0.4 ? 'STRETCH' : 'LOOK';
        this.stateDuration = 3 + Math.random() * 2;
        break;

      case 'STRETCH':
        this.state = 'IDLE';
        this.stateDuration = 3 + Math.random() * 3;
        break;

      case 'IDLE':
        if (Math.random() > 0.4) {
          this.state = 'WALK';
          this.stateDuration = 4 + Math.random() * 5;
          this.pickWalkDirection();
        } else {
          this.state = 'SLEEP';
          this.stateDuration = 12 + Math.random() * 10;
        }
        break;

      case 'WALK':
        this.state = Math.random() > 0.5 ? 'IDLE' : 'LOOK';
        this.stateDuration = 3 + Math.random() * 4;
        break;

      case 'LOOK':
      case 'PURR':
      default:
        this.state = Math.random() > 0.3 ? 'SLEEP' : 'WALK';
        this.stateDuration = 6 + Math.random() * 6;
        if (this.state === 'WALK') {
          this.pickWalkDirection();
        }
        break;
    }
  }

  public render(ctx: CanvasRenderingContext2D): void {
    if (this.isDisposed) {
      return;
    }

    this.renderFloaters(ctx);

    const p = this.pose;
    const s = this.scale;
    const walkAmt = clamp01(p.stride / WALK_STRIDE);

    ctx.save();
    ctx.translate(this.x, this.y);
    this.renderShadow(ctx, p, s);

    ctx.translate(0, -this.hopY);
    ctx.rotate(this.gl.rot);
    ctx.scale(s * this.flip, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.purrAmt > 0.02) {
      ctx.translate(
        Math.sin(this.time * 58) * 0.3 * this.purrAmt,
        Math.sin(this.time * 47) * 0.2 * this.purrAmt
      );
    }

    const breath = Math.sin(this.breathPhase) * this.breathAmp;
    const bob = -Math.abs(Math.sin(this.walkPhase)) * 1.1 * walkAmt;
    const nod = Math.sin(this.walkPhase * 2) * 0.45 * walkAmt;
    const idleSway = Math.sin(this.time * 1.4) * 0.25 * (1 - walkAmt);

    const hipR = p.hipR + breath * 0.3;
    const chestR = p.chestR + breath * 0.55;
    const cr = this.gl.crouch; // landing compression: lowers the body so the legs fold
    const hipY = p.hipY + bob + cr * 4.2;
    const chestY = p.chestY + bob - breath * 0.25 + cr * 5.4;
    const headX = p.headX + this.headTurn * 1.4;
    const headY = p.headY + bob + nod + idleSway - breath * 0.35 + cr * 6.6;
    const turn = p.faceShift + this.headTurn * 0.38;
    const awake = 1 - clamp01(1 - p.eyeOpen);
    const tilt =
      p.headTilt +
      Math.sin(this.time * 0.8) * 0.025 * awake +
      this.headTurn * 0.1 -
      this.lookY * 0.05;

    const w = this.walkPhase;
    const pawX = (base: number, phi: number): number => base - Math.cos(phi) * p.stride;
    const pawY = (phi: number): number => PAW_Y - Math.max(0, -Math.sin(phi)) * p.lift;

    const paws = {
      fnX: pawX(p.fpNearX, w), fnY: pawY(w),
      ffX: pawX(p.fpFarX, w + Math.PI), ffY: pawY(w + Math.PI),
      hnX: pawX(p.hpNearX, w + Math.PI), hnY: pawY(w + Math.PI),
      hfX: pawX(p.hpFarX, w), hfY: pawY(w),
    };
    this.gl.adjustPaws(paws, { chestX: p.chestX, chestY, chestR, hipX: p.hipX, hipY, hipR, headX, headY }, this.time);
    const { fnX, fnY, ffX, ffY, hnX, hnY, hfX, hfY } = paws;

    const frontJointY = chestY + chestR * 0.5;
    const hindJointY = hipY + hipR * 0.45;

    this.renderTail(ctx, p, hipY, hipR);

    this.drawLeg(ctx, p.hipX + 2.2, hindJointY, hfX, hfY, 5.2, FUR_FAR, -this.gl.legBend(1.4));
    this.drawLeg(ctx, p.chestX - 1.8, frontJointY, ffX, ffY, 4.4, FUR_FAR, this.gl.legBend(1.1));

    this.capsule(ctx, p.hipX, hipY, hipR, p.chestX, chestY, chestR);
    const top = Math.min(hipY - hipR, chestY - chestR);
    const bottom = Math.max(hipY + hipR, chestY + chestR);
    const bodyGrad = ctx.createLinearGradient(0, top, 0, bottom);
    bodyGrad.addColorStop(0, '#ffffff');
    bodyGrad.addColorStop(0.6, '#fffafc');
    bodyGrad.addColorStop(1, '#f7e3ec');
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    ctx.save();
    this.capsule(ctx, p.hipX, hipY, hipR, p.chestX, chestY, chestR);
    ctx.clip();
    ctx.fillStyle = 'rgba(251,168,201,0.38)';
    ctx.beginPath();
    ctx.ellipse(p.hipX + 1.5, hipY - hipR * 0.6, hipR * 0.95, hipR * 0.5, -0.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,214,230,0.55)';
    ctx.beginPath();
    ctx.ellipse(p.chestX - chestR * 0.25, chestY + chestR * 0.35, chestR * 0.55, chestR * 0.8, 0.1, 0, TAU);
    ctx.fill();
    ctx.restore();

    this.capsule(ctx, p.hipX, hipY, hipR, p.chestX, chestY, chestR);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(214,170,190,0.7)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(p.hipX - 0.5, hipY + 0.8, hipR * 0.62, Math.PI * 0.95, Math.PI * 1.75);
    ctx.stroke();

    this.drawLeg(ctx, p.hipX - 1.2, hindJointY, hnX, hnY, 5.4, FUR, -this.gl.legBend(1.4));
    this.drawLeg(ctx, p.chestX + 1.2, frontJointY, fnX, fnY, 4.6, FUR, this.gl.legBend(1.1));

    const ndx = headX - p.chestX;
    const ndy = headY - chestY;
    const nlen = Math.hypot(ndx, ndy) || 1;
    const dirX = ndx / nlen;
    const dirY = ndy / nlen;
    const neckX = headX - dirX * (p.headR * 0.96 + 1);
    const neckY = headY - dirY * (p.headR * 0.96 + 1);
    this.renderCollar(ctx, neckX, neckY, dirX, dirY, chestR * 0.88, Math.sin(this.walkPhase * 2) * 0.8 * walkAmt + this.hopVel * 0.004);

    this.gl.drawScruff(ctx, { chestX: p.chestX, chestY, chestR, hipX: p.hipX, hipY, hipR, headX, headY });

    this.renderHead(ctx, p, headX, headY, tilt, turn);

    ctx.restore();
  }

  private renderShadow(ctx: CanvasRenderingContext2D, p: Pose, s: number): void {
    const shrink = 1 - clamp01(this.hopY / 30) * 0.4;
    const rx = Math.max(1, p.shadowRx * s * shrink);
    const ry = 3.4 * s * shrink;
    ctx.save();
    ctx.translate(p.shadowX * s * this.flip, 0);
    ctx.translate(0, -0.6 * s);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private capsule(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number, r1: number,
    x2: number, y2: number, r2: number
  ): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    ctx.beginPath();
    if (d <= Math.abs(r1 - r2) + 0.001) {
      ctx.arc(x1, y1, r1, 0, TAU);
      ctx.moveTo(x2 + r2, y2);
      ctx.arc(x2, y2, r2, 0, TAU);
      return;
    }
    const a = Math.atan2(dy, dx);
    const t = Math.acos((r1 - r2) / d);
    ctx.arc(x1, y1, r1, a + t, a + TAU - t, false);
    ctx.arc(x2, y2, r2, a - t, a + t, false);
    ctx.closePath();
  }

  private drawLeg(
    ctx: CanvasRenderingContext2D,
    jx: number, jy: number,
    px: number, py: number,
    width: number,
    fill: string,
    bend: number
  ): void {
    const mx = (jx + px) / 2 + bend;
    const my = (jy + py) / 2;

    const og = ctx.createLinearGradient(jx, jy, px, py + 0.001);
    og.addColorStop(0, `rgba(${OUTLINE_RGB},0)`);
    og.addColorStop(0.45, `rgba(${OUTLINE_RGB},0)`);
    og.addColorStop(0.8, `rgba(${OUTLINE_RGB},1)`);

    ctx.lineCap = 'round';
    ctx.strokeStyle = og;
    ctx.lineWidth = width + 1.7;
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    ctx.quadraticCurveTo(mx, my, px, py);
    ctx.stroke();

    ctx.strokeStyle = fill;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(jx, jy);
    ctx.quadraticCurveTo(mx, my, px, py);
    ctx.stroke();

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(px - 0.8, py, 3.5, 2.5, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private renderTail(ctx: CanvasRenderingContext2D, p: Pose, hipY: number, hipR: number): void {
    const segs = 7;
    const segLen = 4.4;
    const pts: { x: number; y: number }[] = [];
    let x = p.hipX + hipR * 0.78;
    let y = hipY + hipR * 0.15;
    pts.push({ x, y });

    for (let i = 0; i < segs; i++) {
      const f = i / (segs - 1);
      const ang =
        p.tailBase +
        p.tailCurl * i +
        Math.sin(this.tailPhase - i * 0.55) * p.tailSway * (0.25 + f * 0.9);
      x += Math.cos(ang) * segLen;
      y = Math.min(y + Math.sin(ang) * segLen, this.hopY > 0.5 ? 40 : -1.8);
      pts.push({ x, y });
    }

    ctx.lineCap = 'round';
    for (let i = 0; i < segs; i++) {
      const f = i / (segs - 1);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 5.4 - f * 1.8 + 1.8;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
    }
    for (let i = 0; i < segs; i++) {
      const f = i / (segs - 1);
      ctx.strokeStyle = mixRgb(WHITE_RGB, PINK_RGB, smoothstep(0.55, 1, f));
      ctx.lineWidth = 5.4 - f * 1.8;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
    }
  }

  private renderCollar(
    ctx: CanvasRenderingContext2D,
    nx: number, ny: number,
    dirX: number, dirY: number,
    halfW: number,
    swing: number
  ): void {
    const perpX = -dirY;
    const perpY = dirX;
    const x1 = nx + perpX * halfW;
    const y1 = ny + perpY * halfW;
    const x2 = nx - perpX * halfW;
    const y2 = ny - perpY * halfW;
    const cx = nx - dirX * 4.4;
    const cy = ny - dirY * 4.4;

    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d9609b';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();

    ctx.strokeStyle = '#fa9ccb';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
    ctx.stroke();

    const bx = nx - dirX * 4.4 + swing;
    const by = ny - dirY * 4.4 + Math.abs(swing) * 0.3;
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#d98a06';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(bx, by, 2.2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(bx - 0.7, by - 0.7, 0.7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#b86f00';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(bx - 1.3, by + 0.7);
    ctx.lineTo(bx + 1.3, by + 0.7);
    ctx.stroke();
  }

  private renderHead(
    ctx: CanvasRenderingContext2D,
    p: Pose,
    hx: number, hy: number,
    tilt: number,
    turn: number
  ): void {
    const R = p.headR;
    const fx = turn * R * 0.42;
    const t = this.time;

    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(tilt);

    const perk = p.earPerk + this.startle * 0.25;
    const wiggle = Math.sin(this.earTwitch * 10) * 0.22 * Math.min(this.earTwitch, 1);
    const flick = Math.sin((1 - this.earFlick) * Math.PI * 4) * 0.32 * this.earFlick;

    for (const side of [-1, 1]) {
      const sc = 1 + side * turn * 0.3;
      const w = 0.3 * R * sc;
      const h = 0.85 * R * perk * sc;
      const rot = side * (0.3 + p.earSplay) + wiggle * side + (side === this.earFlickSide ? flick : 0);

      ctx.save();
      ctx.translate(side * 0.62 * R + fx * 0.4, -0.7 * R);
      ctx.rotate(rot);

      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(-w * 1.1, -h * 0.62, 0, -h);
      ctx.quadraticCurveTo(w * 1.1, -h * 0.62, w, 0);
      ctx.closePath();
      ctx.fillStyle = FUR;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.1;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-w * 0.58, -h * 0.04);
      ctx.quadraticCurveTo(-w * 0.62, -h * 0.52, 0, -h * 0.72);
      ctx.quadraticCurveTo(w * 0.62, -h * 0.52, w * 0.58, -h * 0.04);
      ctx.closePath();
      ctx.fillStyle = PINK_SOFT;
      ctx.fill();
      ctx.restore();
    }

    for (const side of [-1, 1]) {
      const sc = 1 + side * turn * 0.3;
      ctx.beginPath();
      ctx.moveTo(side * 0.9 * R, 0.1 * R);
      ctx.lineTo(side * (1.0 + 0.32 * sc) * R, 0.55 * R);
      ctx.lineTo(side * 0.72 * R, 0.78 * R);
      ctx.closePath();
      ctx.fillStyle = FUR;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.12, R * 0.96, 0, 0, TAU);
    const hg = ctx.createRadialGradient(-0.3 * R, -0.45 * R, 0.1 * R, 0, 0, 1.25 * R);
    hg.addColorStop(0, '#ffffff');
    hg.addColorStop(0.7, '#fffafc');
    hg.addColorStop(1, '#f8e4ed');
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(244,143,184,0.75)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(fx, -0.82 * R);
    ctx.lineTo(fx, -0.56 * R);
    ctx.moveTo(fx - 0.15 * R, -0.75 * R);
    ctx.lineTo(fx - 0.23 * R, -0.56 * R);
    ctx.moveTo(fx + 0.15 * R, -0.75 * R);
    ctx.lineTo(fx + 0.23 * R, -0.56 * R);
    ctx.stroke();

    const blushA = clamp01(p.blush + this.startle * 0.1);
    for (const side of [-1, 1]) {
      const sc = 1 + side * turn * 0.3;
      const rr = 0.26 * R * sc;
      ctx.save();
      ctx.translate(side * 0.68 * R + fx, 0.4 * R);
      ctx.scale(1, 0.62);
      const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
      bg.addColorStop(0, `rgba(255,120,168,${blushA})`);
      bg.addColorStop(1, 'rgba(255,120,168,0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    const blinkF = this.blinkProgress > 0 ? 1 - Math.sin(this.blinkProgress * Math.PI) : 1;
    const open = clamp01(p.eyeOpen * (1 - p.happy) * blinkF * (1 + this.startle * 0.15));
    const dil = clamp(p.dilate + this.startle * 0.35, 0.6, 1.6);

    for (const side of [-1, 1]) {
      const sc = 1 + side * turn * 0.3;
      const ex = side * 0.44 * R + fx;
      const ey = 0.08 * R;
      const ew = 0.25 * R * sc;
      const eh = 0.31 * R * sc * (1 + this.startle * 0.12);

      if (open > 0.1) {
        const h = eh * open;
        const ox = this.lookX * ew * 0.34;
        const oy = this.lookY * eh * 0.32;
        const ix = ex + ox;
        const iy = ey + oy;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ex, ey, ew, h, 0, 0, TAU);
        ctx.clip();

        ctx.fillStyle = '#f4f9ff';
        ctx.fillRect(ex - ew, ey - h, ew * 2, h * 2);

        const ig = ctx.createLinearGradient(0, iy - eh, 0, iy + eh);
        ig.addColorStop(0, '#3b6fe0');
        ig.addColorStop(0.55, '#5fb0f5');
        ig.addColorStop(1, '#a5e3fb');
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.ellipse(ix, iy, ew * 0.92, eh * 0.98, 0, 0, TAU);
        ctx.fill();

        ctx.fillStyle = '#10152b';
        ctx.beginPath();
        ctx.ellipse(ix, iy, ew * 0.4 * dil, eh * 0.58 * dil, 0, 0, TAU);
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(ex + ox * 0.4 - ew * 0.3, ey + oy * 0.4 - eh * 0.34, ew * 0.27, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(ex + ox * 0.4 + ew * 0.34, ey + oy * 0.4 + eh * 0.36, ew * 0.13, 0, TAU);
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(ex, ey, ew, h, 0, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex + side * ew * 0.98, ey - h * 0.15);
        ctx.lineTo(ex + side * (ew + 0.15 * R), ey - h * 0.4 - 0.05 * R);
        ctx.stroke();
      }

      const closedA = clamp01(1 - open / 0.35);
      if (closedA > 0.02) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.25;
        if (p.happy < 1) {
          ctx.globalAlpha = closedA * (1 - p.happy);
          ctx.beginPath();
          ctx.arc(ex, ey - ew * 0.35, ew * 0.95, Math.PI * 0.12, Math.PI * 0.88);
          ctx.stroke();
        }
        if (p.happy > 0) {
          ctx.globalAlpha = closedA * p.happy;
          ctx.beginPath();
          ctx.arc(ex, ey + ew * 0.55, ew * 0.95, Math.PI * 1.12, Math.PI * 1.88);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    const nx = fx * 1.1;
    const ny = 0.3 * R;
    ctx.fillStyle = '#f48fb8';
    ctx.strokeStyle = '#e0699c';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(nx - 0.11 * R, ny - 0.04 * R);
    ctx.quadraticCurveTo(nx, ny - 0.1 * R, nx + 0.11 * R, ny - 0.04 * R);
    ctx.quadraticCurveTo(nx + 0.07 * R, ny + 0.08 * R, nx, ny + 0.1 * R);
    ctx.quadraticCurveTo(nx - 0.07 * R, ny + 0.08 * R, nx - 0.11 * R, ny - 0.04 * R);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(nx - 0.03 * R, ny - 0.04 * R, 0.035 * R, 0.02 * R, 0, 0, TAU);
    ctx.fill();

    const smile = p.smile;
    ctx.globalAlpha = 1 - this.yawn;
    ctx.strokeStyle = '#c9809c';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(nx, ny + 0.1 * R);
    ctx.quadraticCurveTo(nx - 0.07 * R, ny + 0.27 * R, nx - 0.21 * R, ny + 0.16 * R - smile * 0.06 * R);
    ctx.moveTo(nx, ny + 0.1 * R);
    ctx.quadraticCurveTo(nx + 0.07 * R, ny + 0.27 * R, nx + 0.21 * R, ny + 0.16 * R - smile * 0.06 * R);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (this.yawn > 0.03) {
      const mh = (0.04 + 0.2 * this.yawn) * R;
      const mw = (0.1 + 0.1 * this.yawn) * R;
      ctx.globalAlpha = clamp01(this.yawn * 3);
      ctx.fillStyle = '#d9487d';
      ctx.beginPath();
      ctx.ellipse(nx, ny + 0.2 * R + mh, mw, mh, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ff9fbf';
      ctx.beginPath();
      ctx.ellipse(nx, ny + 0.2 * R + mh * 1.5, mw * 0.65, mh * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = 'rgba(222,190,206,0.95)';
    ctx.lineWidth = 0.7;
    for (const side of [-1, 1]) {
      const sc = 1 + side * turn * 0.3;
      for (let k = 0; k < 3; k++) {
        const x0 = side * 0.52 * R + fx;
        const y0 = 0.36 * R + k * 0.07 * R;
        const ang = (k - 1) * 0.28 + Math.sin(t * 1.7 + k + side) * 0.03 + (this.earFlick > 0 ? Math.sin(t * 40) * 0.03 : 0);
        const len = 0.8 * R * sc;
        const ex2 = x0 + side * Math.cos(ang) * len;
        const ey2 = y0 + Math.sin(ang) * len;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + ex2) / 2, (y0 + ey2) / 2 + 0.06 * R, ex2, ey2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private renderFloaters(ctx: CanvasRenderingContext2D): void {
    if (this.floaters.length === 0) {
      return;
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const f of this.floaters) {
      const age = f.maxLife - f.life;
      const alpha = clamp01(Math.min(f.life / 0.7, age / 0.15));
      const sway = Math.sin(age * 4 + f.phase) * 2;
      const fxp = f.x + sway;

      if (f.kind === 'heart') {
        const s = f.size;
        ctx.fillStyle = `rgba(251,113,160,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(fxp, f.y + s * 0.35);
        ctx.bezierCurveTo(fxp - s * 0.9, f.y - s * 0.25, fxp - s * 0.45, f.y - s * 0.95, fxp, f.y - s * 0.45);
        ctx.bezierCurveTo(fxp + s * 0.45, f.y - s * 0.95, fxp + s * 0.9, f.y - s * 0.25, fxp, f.y + s * 0.35);
        ctx.fill();
      } else {
        ctx.font = `bold ${(f.size + age * 2.2).toFixed(1)}px sans-serif`;
        ctx.fillStyle = `rgba(196,181,253,${alpha})`;
        ctx.fillText('z', fxp, f.y);
      }
    }
    ctx.restore();
  }

  public dispose(): void {
    this.gl.grab.cancelInteraction();
    this.isDisposed = true;
    this.floaters = [];
  }
}
