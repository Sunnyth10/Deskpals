import { IEntity, LivingEventType, ZoneBounds, ZoneType } from '../../core/types';
import { ParticleEngine } from '../../engine/particles/ParticleEngine';
import { clampCompanionX, companionXBounds } from './CompanionBounds';
import { FoxGrabLayer } from './FoxGrab';

export type FoxState = 'IDLE' | 'SIT' | 'SLEEP' | 'WALK' | 'RUN' | 'JUMP' | 'HELD' | 'FALL' | 'LAND';
interface Pt { x: number; y: number }
interface Dust { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number }
interface Spring { x: number; v: number }

const TAU = Math.PI * 2;
const SCALE = 0.95;
const LIMB = 8.5;
const WALK_SPEED = 28;
const RUN_SPEED = 135;
const GRAVITY = 950;
const FLOOR_INSET = 4;

const C = {
  fur: '#eba35c', furDark: '#c47634', furLight: '#f9d3a0',
  cream: '#fff4de', creamShade: '#ecd8b4',
  earTip: '#7c4420', earIn: '#46284f',
  eye: '#241624', iris: '#a85c2d', pink: '#ff8fa6', nose: '#4a2a22', mouth: '#6b2336',
};

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const damp = (c: number, t: number, r: number, dt: number): number => c + (t - c) * (1 - Math.exp(-r * dt));
const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const spring = (s: Spring, target: number, k: number, c: number, dt: number): void => {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
};

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number,
  light: string, dark: string, rot = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(-rx * 0.28, -rx * 0.38, rx * 0.08, 0, 0, rx * 1.08);
  g.addColorStop(0, light);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function smoothLeg(
  ctx: CanvasRenderingContext2D,
  hx: number, hy: number, kx: number, ky: number, fx: number, fy: number,
  bend: number, r0: number, r1: number, r2: number,
  fill: string | CanvasGradient, outline = ''
): void {
  const mx = (hx + fx) / 2, my = (hy + fy) / 2;
  const cx = lerp(mx, kx, bend), cy = lerp(my, ky, bend);
  const n = 14;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * hx + 2 * u * t * cx + t * t * fx;
    const y = u * u * hy + 2 * u * t * cy + t * t * fy;
    const dx = 2 * u * (cx - hx) + 2 * t * (fx - cx);
    const dy = 2 * u * (cy - hy) + 2 * t * (fy - cy);
    const d = Math.hypot(dx, dy) || 1;
    const r = t < 0.55
      ? lerp(r0, r1, smooth(t / 0.55))
      : lerp(r1, r2, smooth((t - 0.55) / 0.45));
    left.push({ x: x - (dy / d) * r, y: y + (dx / d) * r });
    right.push({ x: x + (dy / d) * r, y: y - (dx / d) * r });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i <= n; i++) ctx.lineTo(left[i].x, left[i].y);
  ctx.arc(fx, fy, r2, Math.atan2(left[n].y - fy, left[n].x - fx), Math.atan2(right[n].y - fy, right[n].x - fx), true);
  for (let i = n; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.arc(hx, hy, r0, Math.atan2(right[0].y - hy, right[0].x - hx), Math.atan2(left[0].y - hy, left[0].x - hx), true);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
}

function solveLimb(hx: number, hy: number, tx: number, ty: number): { kx: number; ky: number; fx: number; fy: number } {
  let dx = tx - hx, dy = ty - hy;
  let d = Math.hypot(dx, dy) || 0.0001;
  const max = LIMB * 2 - 0.05;
  let fx = tx, fy = ty;
  if (d > max) { fx = hx + (dx / d) * max; fy = hy + (dy / d) * max; dx = fx - hx; dy = fy - hy; d = max; }
  const h = Math.sqrt(Math.max(0, LIMB * LIMB - (d / 2) * (d / 2)));
  return { kx: hx + dx / 2 + (-dy / d) * h, ky: hy + dy / 2 + (dx / d) * h, fx, fy };
}

function footCycle(u: number, stance: number): { s: number; lift: number } {
  if (u < stance) return { s: 1 - 2 * (u / stance), lift: 0 };
  const p = (u - stance) / (1 - stance);
  return { s: -1 + 2 * smooth(p), lift: Math.sin(p * Math.PI) };
}

export class FoxCompanion implements IEntity {
  public readonly id: string;
  public readonly zone: ZoneType;
  public x: number;
  public y: number;
  public isDisposed = false;
  public state: FoxState = 'IDLE';
  public autonomous = true;

  private bounds?: ZoneBounds;
  private time = 0;
  private stateTimer = 0;
  private stateDuration = 3;
  private dir = 1;
  private faceScale = 1;
  private targetX: number | null = null;

  private speed = 0;
  private accel = 0;
  private walkPhase = 0;
  private legU = [0, 0, 0, 0];
  private prevU = [0, 0, 0, 0];
  private runJumpAt = 0;

  private hopY = 0;
  private hopV = 0;
  private airborne = false;
  private crouchT = 0;
  private jumpV = 260;
  private jumpVx = 0;
  private flip = false;
  private flipAngle = 0;
  private returnState: FoxState = 'IDLE';
  private returnDur = 3;

  private sit = 0; private lie = 0; private crouch = 0; private run = 0;
  private air = 0; private lean = 0; private sq = 0; private sqV = 0;

  private breathPhase = Math.random() * TAU;
  private tailPhase = Math.random() * TAU;
  private ear: Spring = { x: -0.12, v: 0 };
  private tailSw: Spring = { x: 0, v: 0 };

  private eyeOpen = 1;
  private blinkT = -1;
  private blinkC = 0;
  private blinkTimer = rand(2, 4);
  private happy = 0;
  private happyT = 0;
  private mouth = 0;
  private yawnT = 0;
  private yawnEnv = 0;
  private alertT = 0;
  private fearT = 0;
  private lookX = 1; private lookY = 0;
  private lookTX = 1; private lookTY = 0;
  private lookTimer = 1;

  private dust: Dust[] = [];
  private markT = 0;
  private markChar = '!';
  private zAlpha = 0;

  private particleEngine?: ParticleEngine;

  // interaction
  private readonly gl = new FoxGrabLayer();
  private interactive = true;
  private queuedEvent: LivingEventType | null = null;
  private grabbedLast = false;

  constructor(id: string, zone: ZoneType, startX: number, startY: number, particleEngine?: ParticleEngine) {
    this.id = id;
    this.zone = zone;
    this.x = startX;
    this.y = startY;
    this.particleEngine = particleEngine;
  }

  public setParticleEngine(engine: ParticleEngine): void { this.particleEngine = engine; }

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

  public setState(s: FoxState, duration = 4): void {
    this.targetX = null;
    if (s === 'JUMP') { this.jump(); return; }
    if (this.state === 'JUMP') return;
    if (this.state === 'SLEEP' && s !== 'SLEEP') this.yawnT = 2.2;
    this.begin(s, duration);
  }

  public goTo(x: number, run = false): void {
    if (this.state === 'JUMP') return;
    this.targetX = x;
    this.begin(run ? 'RUN' : 'WALK', 99);
    this.dir = x >= this.x ? 1 : -1;
  }

  public jump(power = 260, flip = false): void {
    if (this.state === 'JUMP') return;
    this.returnState = this.state === 'RUN' || this.state === 'WALK' ? this.state : 'IDLE';
    this.returnDur = Math.max(1, this.stateDuration - this.stateTimer);
    this.jumpV = power;
    this.flip = flip;
    this.jumpVx = this.returnState === 'RUN' ? RUN_SPEED : this.returnState === 'WALK' ? WALK_SPEED * 1.8 : flip ? 0 : 38;
    this.state = 'JUMP';
    this.stateTimer = 0;
    this.stateDuration = 99;
    this.crouchT = 0.17;
    this.airborne = false;
  }

  public reactToEvent(eventName: LivingEventType): void {
    if (this.isDisposed) return;
    if (this.gl.grab.active) { this.queuedEvent = eventName; return; }
    const px = this.x, py = this.y - 34 * SCALE;
    if (eventName === 'save') {
      this.alertT = 1.6; this.markT = 1.1; this.markChar = '♥';
      this.lookTX = 1; this.lookTY = -0.2; this.lookTimer = 1.5;
      this.jump(190);
      this.particleEngine?.spawnGlitterBurst(px, py, 3, ['#fbbf24', '#ffffff']);
    } else if (eventName === 'buildSuccess') {
      this.happyT = 2.4; this.markT = 1.4; this.markChar = '♪';
      this.jump(340, true);
      this.particleEngine?.spawnGlitterBurst(px, py, 8, ['#4ade80', '#fbbf24', '#ffffff']);
    } else if (eventName === 'buildError') {
      this.fearT = 2.4; this.markT = 1.1; this.markChar = '!';
      this.jump(240);
    }
  }

  public update(dt: number, bounds: ZoneBounds): void {
    if (this.isDisposed) return;
    dt = Math.min(dt, 0.05);
    this.bounds = bounds;
    this.time += dt;
    this.stateTimer += dt;
    const grabbed = this.updateGrab(dt, bounds);
    if (!grabbed) {
      this.think();
      this.move(dt, bounds);
    }
    this.blend(dt);
    this.face(dt);
    this.updateFx(dt);
    this.y = bounds.y + bounds.height - FLOOR_INSET;
  }

  /** Runs the pick-up / throw / drop driver. Returns true while it controls the fox. */
  private updateGrab(dt: number, bounds: ZoneBounds): boolean {
    const floorY = bounds.y + bounds.height - FLOOR_INSET;
    const { minX, maxX } = companionXBounds('fox', bounds);
    const g = this.gl.grab;
    const o = this.gl.update(dt, {
      scale: SCALE, floorY, minX, maxX, topY: bounds.y + 56 * SCALE,
      x: this.x, hopY: this.hopY, dir: this.dir,
    });

    if (o.poke && !o.active) {
      this.markT = 1.1; this.markChar = '♥'; this.happyT = 1.6; this.alertT = 0.8;
      this.jump(190);
    }

    if (o.active) {
      if (this.state !== o.state) {
        this.state = o.state; this.stateTimer = 0; this.stateDuration = 999; this.targetX = null;
        if (o.state === 'HELD') { this.markT = 1.1; this.markChar = '!'; this.alertT = 0.7; }
      }
      this.x = o.x;
      this.hopY = o.hopY;
      this.hopV = o.hopV;
      this.airborne = o.airborne;
      this.jumpV = 260;
      this.speed = damp(this.speed, 0, 10, dt);
      this.accel = 0;
      if (o.dir !== null) { this.dir = o.dir; }
      this.faceScale = damp(this.faceScale, this.dir, 16, dt);
      if (g.landed > 0) {
        this.sqV = Math.min(14, this.sqV + 3 + 4 * g.intensity);
        this.puff(this.x, 3 + Math.round(5 * g.intensity), 2);
      }
    } else if (this.grabbedLast) {
      this.airborne = false; this.hopY = 0; this.hopV = 0;
      this.begin('IDLE', rand(2, 4));
      if (this.queuedEvent) {
        const e = this.queuedEvent;
        this.queuedEvent = null;
        this.reactToEvent(e);
      }
    }
    this.grabbedLast = o.active;
    return o.active;
  }

  private begin(s: FoxState, dur: number): void {
    this.state = s;
    this.stateTimer = 0;
    this.stateDuration = dur;
    this.runJumpAt = 0;
    if ((s === 'WALK' || s === 'RUN') && this.targetX === null) {
      let d = Math.random() > 0.5 ? 1 : -1;
      const b = this.bounds;
      if (b) {
        if (this.x - b.x < 90) d = 1;
        else if (b.x + b.width - this.x < 90) d = -1;
      }
      this.dir = d;
    }
    if (s === 'RUN' && dur < 50 && Math.random() < 0.45) this.runJumpAt = rand(0.8, Math.max(1, dur * 0.75));
  }

  private think(): void {
    if (this.state === 'JUMP' || this.targetX !== null || this.stateTimer < this.stateDuration) return;
    if (!this.autonomous && this.state !== 'WALK' && this.state !== 'RUN') { this.stateTimer = 0; return; }
    const r = Math.random();
    switch (this.state) {
      case 'IDLE':
        if (r < 0.28) this.begin('WALK', rand(4, 8));
        else if (r < 0.5) this.begin('RUN', rand(2.2, 4));
        else if (r < 0.62) this.jump(220 + Math.random() * 60);
        else if (r < 0.82) this.begin('SIT', rand(4, 7));
        else this.begin('IDLE', rand(2, 4));
        break;
      case 'SIT':
        if (r < 0.45) this.begin('IDLE', rand(2, 4));
        else { this.yawnT = 2.2; this.begin('SLEEP', rand(12, 22)); }
        break;
      case 'SLEEP':
        this.yawnT = 2.2;
        this.begin('SIT', rand(2.5, 4));
        break;
      case 'WALK':
        this.begin(r < 0.5 ? 'IDLE' : 'RUN', rand(2, 4));
        break;
      default:
        this.begin('IDLE', rand(2, 4));
        break;
    }
  }

  private move(dt: number, b: ZoneBounds): void {
    const st = this.state;
    let target = st === 'RUN' ? RUN_SPEED : st === 'WALK' ? WALK_SPEED : st === 'JUMP' ? this.jumpVx : 0;

    if (this.targetX !== null && st !== 'JUMP') {
      const dx = this.targetX - this.x;
      this.dir = dx >= 0 ? 1 : -1;
      if (Math.abs(dx) < (st === 'RUN' ? 26 : 3)) { this.targetX = null; this.begin('IDLE', rand(2, 4)); target = 0; }
    }
    if (st === 'RUN' && this.runJumpAt > 0 && this.stateTimer > this.runJumpAt) { this.runJumpAt = 0; this.jump(250); }

    if (this.state === 'JUMP') {
      if (!this.airborne) {
        this.crouchT -= dt;
        if (this.crouchT <= 0) { this.airborne = true; this.hopV = this.jumpV; this.puff(this.x, 6, 1); }
      } else {
        this.hopY += this.hopV * dt;
        this.hopV -= GRAVITY * dt;
        const p = clamp((this.jumpV - this.hopV) / (2 * this.jumpV), 0, 1);
        this.flipAngle = this.flip ? -TAU * smooth(p) : 0;
        if (this.hopY <= 0) {
          this.sqV = Math.min(14, this.sqV + 6 + -this.hopV * 0.012);
          this.hopY = 0; this.hopV = 0; this.airborne = false; this.flip = false; this.flipAngle = 0;
          this.puff(this.x, 9, 2);
          const d = this.dir;
          this.begin(this.returnState, this.returnDur);
          this.dir = d;
        }
      }
    }

    const prev = this.speed;
    this.speed = damp(this.speed, target, target > this.speed ? 4.5 : 8, dt);
    if (target === 0 && this.speed < 0.5) this.speed = 0;
    this.accel = (this.speed - prev) / dt;
    this.x += this.speed * dt * this.dir;

    const clampedX = clampCompanionX('fox', this.x, b);
    if (this.x !== clampedX) {
      this.x = clampedX;
      if (st === 'WALK' || st === 'RUN') { this.targetX = null; this.begin('IDLE', rand(1.5, 3)); }
    }
    if (this.accel < -160 && this.speed > 35 && !this.airborne && Math.random() < 0.5) this.puff(this.x, 1, 0);

    const stride = lerp(5.2, 11.5, this.run), stance = lerp(0.6, 0.45, this.run);
    if (!this.airborne) this.walkPhase += (this.speed / SCALE) * dt * stance / (2 * stride);
    const wo = [0, 0.25, 0.5, 0.75], ro = [0.5, 0, 0.6, 0.1];
    for (let i = 0; i < 4; i++) {
      this.prevU[i] = this.legU[i];
      this.legU[i] = (((this.walkPhase + lerp(wo[i], ro[i], this.run)) % 1) + 1) % 1;
      if (this.legU[i] < this.prevU[i] && this.speed > 55 && !this.airborne && Math.random() < 0.8) {
        this.puff(this.x + this.dir * (i % 2 ? 9 : -9), 1, 0);
      }
    }
    this.faceScale = damp(this.faceScale, this.dir, 16, dt);
  }

  private blend(dt: number): void {
    const st = this.state;
    this.sit = damp(this.sit, st === 'SIT' || st === 'SLEEP' || st === 'HELD' ? 1 : 0, 5, dt);
    this.lie = damp(this.lie, st === 'SLEEP' ? 1 : 0, 3, dt);
    this.crouch = damp(this.crouch, st === 'JUMP' && !this.airborne ? 1 : 0, 24, dt);
    this.run = damp(this.run, st === 'RUN' || (st === 'JUMP' && this.returnState === 'RUN') ? 1 : 0, 6, dt);
    this.air = damp(this.air, this.airborne ? 1 : 0, 22, dt);
    this.lean = damp(this.lean, clamp(this.accel / 350, -1, 1) * 0.9 + (this.speed / RUN_SPEED) * 0.35, 10, dt);
    this.sqV += (-300 * this.sq - 14 * this.sqV) * dt;
    this.sq += this.sqV * dt;

    this.breathPhase += dt * (st === 'SLEEP' ? 1.6 : 2.6);
    this.tailPhase += dt * (2 + this.run * 10);

    let base = -0.12;
    if (this.alertT > 0) base = 0.25;
    if (this.fearT > 0) base = -1.05;
    if (st === 'SLEEP') base = -0.8;
    else if (st === 'SIT') base = -0.05;
    if (this.crouchT > 0 && !this.airborne && st === 'JUMP') base = -0.7;
    const a = this.airborne ? clamp(this.hopV / this.jumpV, -1, 1) : 0;
    base += -(this.speed / RUN_SPEED) * 0.95 - a * 0.5 - this.yawnEnv * 0.5;
    base = this.gl.earBase(base);
    spring(this.ear, base, 170, 11, dt);
    if (Math.random() < dt * 0.25) this.ear.v += 6;
    spring(this.tailSw, clamp(-this.accel / 700, -0.6, 0.6) - a * 0.35, 90, 7, dt);
  }

  private face(dt: number): void {
    const st = this.state;
    this.blinkTimer -= dt;
    if (this.blinkT < 0 && this.blinkTimer <= 0) this.blinkT = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const p = this.blinkT / 0.17;
      if (p >= 1) { this.blinkT = -1; this.blinkC = 0; this.blinkTimer = Math.random() < 0.2 ? 0.12 : rand(2, 5); }
      else this.blinkC = Math.sin(p * Math.PI);
    }
    this.lookTimer -= dt;
    if (this.lookTimer <= 0) { this.lookTX = rand(-0.3, 1); this.lookTY = rand(-0.5, 0.5); this.lookTimer = rand(1, 3); }
    let tx = this.lookTX, ty = this.lookTY;
    if (st === 'RUN' || st === 'WALK') { tx = 1; ty = 0; }
    if (this.airborne) { tx = 1; ty = this.hopV > 0 ? -0.5 : 0.5; }
    this.lookX = damp(this.lookX, tx, 16, dt);
    this.lookY = damp(this.lookY, ty, 16, dt);

    if (this.yawnT > 0) { this.yawnT -= dt; this.yawnEnv = Math.sin(clamp(1 - this.yawnT / 2.2, 0, 1) * Math.PI); }
    else this.yawnEnv = 0;
    this.happyT -= dt; this.alertT -= dt; this.fearT -= dt; this.markT -= dt;

    const eye = st === 'SLEEP' ? 0 : this.yawnEnv > 0.3 ? 0.1 : 1;
    this.eyeOpen = damp(this.eyeOpen, eye, 14, dt);
    this.happy = damp(this.happy, this.happyT > 0 ? 1 : 0, 8, dt);
    const amp = clamp(this.speed / 18, 0, 1);
    const m = Math.max(this.yawnEnv, this.run * 0.55 * amp, this.air * 0.7, this.happy * 0.8);
    this.mouth = damp(this.mouth, m, 10, dt);
    this.zAlpha = damp(this.zAlpha, st === 'SLEEP' ? 1 : 0, 3, dt);
  }

  private puff(x: number, n: number, kind: number): void {
    for (let i = 0; i < n; i++) {
      this.dust.push({
        x: x + rand(-3, 3), y: this.y - 1,
        vx: kind === 0 ? -this.dir * rand(10, 40) : rand(-60, 60),
        vy: -rand(10, 35), life: 0, max: rand(0.35, 0.6), size: rand(2.5, 5) + kind * 1.5,
      });
    }
  }

  private updateFx(dt: number): void {
    for (const d of this.dust) { d.life += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.94; d.vy *= 0.94; }
    this.dust = this.dust.filter((d) => d.life < d.max);
  }

  public render(ctx: CanvasRenderingContext2D): void {
    if (this.isDisposed) return;
    this.renderFxBack(ctx);

    ctx.save();
    ctx.translate(this.x, this.y);
    const sh = 1 - clamp(this.hopY / 60, 0, 0.6);
    ctx.fillStyle = `rgba(0,0,0,${(0.25 * sh).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, (20 + this.lie * 8) * SCALE * sh, 3.6 * SCALE, 0, 0, TAU);
    ctx.fill();

    ctx.translate(0, -this.hopY * SCALE);
    ctx.rotate(this.gl.rot);
    let fs = this.faceScale;
    if (Math.abs(fs) < 0.04) fs = 0.04;
    ctx.scale(SCALE * fs, SCALE);
    const stretch = this.air * clamp(Math.abs(this.hopV) / 320, 0, 1) * 0.17;
    ctx.scale(1 - stretch * 0.45 + 0.2 * this.sq + 0.06 * this.crouch, 1 + stretch - 0.28 * this.sq - 0.12 * this.crouch);
    if (this.flipAngle !== 0) { ctx.translate(0, -16); ctx.rotate(this.flipAngle); ctx.translate(0, 16); }

    this.drawFox(ctx);
    ctx.restore();
    this.renderFxFront(ctx);
  }

  private drawFox(ctx: CanvasRenderingContext2D): void {
    const { sit, lie, crouch: cr, run, air } = this;
    const amp = clamp(this.speed / 18, 0, 1);
    const cyc = this.walkPhase * TAU;
    const breath = Math.sin(this.breathPhase) * (lie > 0.5 ? 1 : 0.6);
    const a = this.airborne ? clamp(this.hopV / this.jumpV, -1, 1) : 0;
    const lc = Math.max(0, this.gl.crouch); // landing compression: hips drop, the two-bone legs fold

    const Sx = lerp(lerp(10, 7, sit), 8, lie);
    let Sy = lerp(lerp(-17, -23, sit), -8, lie);
    const Hx = lerp(lerp(-10, -11, sit), -9, lie);
    let Hy = lerp(lerp(-16, -7, sit), -7, lie);
    const bob = -Math.abs(Math.sin(cyc)) * (1 + 2.4 * run) * amp;
    Sy += cr * 6 + this.lean * 8 + Math.sin(cyc) * 2 * run * amp + bob - a * 6 * air + lc * 7;
    Hy += cr * 5 - this.lean * 3 - Math.sin(cyc) * 2 * run * amp + bob + a * 4 * air + lc * 6;

    const stride = lerp(5.2, 11.5, run) * amp;
    const stance = lerp(0.6, 0.45, run);
    const liftH = lerp(3.5, 8, run) * amp;

    const drawLeg = (i: number): void => {
      const front = i % 2 === 1, far = i >= 2;
      const off = far ? 2.5 : 0;
      const hipX = (front ? Sx - 1.5 : Hx + 1) + off;
      const hipY = front ? Sy + 3.5 : Hy + 2.5;
      const f = footCycle(this.legU[i], stance);
      const wx = hipX + f.s * stride, wy = -1.6 - f.lift * liftH;
      const sx = front ? Sx + 0.5 + off : Hx + 7 + off;
      const lx = front ? Sx + 7 + off : Hx + 8 + off;
      const aa = (a + 1) / 2;
      const ax = front ? Sx + lerp(7, 10, aa) + off : Hx + lerp(-3, -12, aa) + off;
      const ay = front ? Sy + lerp(13, 5, aa) : Hy + lerp(13, 4, aa);
      let tx = lerp(lerp(lerp(wx, sx, sit), lx, lie), ax, air);
      let ty = lerp(lerp(lerp(wy, -1.4, sit), -1.4, lie), ay, air);
      ty = Math.min(ty, -1.4);
      const lt = this.gl.legTarget(i, tx, ty, hipX, hipY, this.time);
      tx = lt.tx; ty = lt.ty;
      const ik = solveLimb(hipX, hipY, tx, ty);
      const hind = !front;
      const limbGrad = ctx.createLinearGradient(hipX - 3, hipY, ik.fx + 2, ik.fy);
      limbGrad.addColorStop(0, far ? '#a35e2d' : '#d9904a');
      limbGrad.addColorStop(0.55, far ? '#a35e2d' : '#e39a52');
      limbGrad.addColorStop(1, far ? '#c58a52' : C.furLight);
      smoothLeg(
        ctx, hipX, hipY, ik.kx, ik.ky, ik.fx, ik.fy,
        hind ? 0.62 : 0.45,
        hind ? 3.9 : 3.3, hind ? 2.1 : 1.9, hind ? 2.0 : 1.85,
        limbGrad
      );
      this.drawPaw(ctx, ik.fx + 1.1, ik.fy + 0.9, far, front);
    };

    drawLeg(2); drawLeg(3);

    const ang = Math.atan2(Sy - Hy, Sx - Hx);
    const bodyX = (Sx + Hx) / 2, bodyY = (Sy + Hy) / 2;
    const bodyRx = Math.hypot(Sx - Hx, Sy - Hy) / 2 + 6.8;
    const bodyRy = 8.8 + breath * 0.35 + sit * 1.2;
    const bodyTop = bodyY - bodyRy - 4, bodyBottom = bodyY + bodyRy + 5;
    const bg = ctx.createLinearGradient(0, bodyTop, 0, bodyBottom);
    bg.addColorStop(0, '#9d532d');
    bg.addColorStop(0.3, C.furDark);
    bg.addColorStop(0.63, C.fur);
    bg.addColorStop(1, C.furLight);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.ellipse(bodyX, bodyY, bodyRx, bodyRy, ang, 0, TAU);
    ctx.ellipse(Sx - 1, Sy + 0.5, 8.2 + sit * 0.5, 7.7, 0.1, 0, TAU);
    ctx.ellipse(Hx + 1, Hy + 1.4, 9.8 + lie * 0.8, 8.5 + sit, -0.08, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(111,54,31,0.12)';
    ctx.beginPath();
    ctx.ellipse(Hx + 3, Hy + 6.1, 7.1, 3.7, -0.2, 0, TAU);
    ctx.ellipse(Hx + 8, Hy + 5.4, 4.8, 3.2, 0.2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,226,177,0.42)';
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(Hx - 7, Hy - 5.2);
    ctx.quadraticCurveTo((Hx + Sx) / 2, Math.min(Hy, Sy) - 9, Sx + 3, Sy - 6.8);
    ctx.stroke();
    ctx.fillStyle = C.fur;
    ctx.beginPath();
    ctx.moveTo(Hx - 7, Hy - 5);
    ctx.lineTo(Hx - 11, Hy - 8);
    ctx.lineTo(Hx - 10, Hy - 3.5);
    ctx.lineTo(Hx - 14, Hy - 3.2);
    ctx.lineTo(Hx - 10, Hy - 0.7);
    ctx.lineTo(Hx - 12, Hy + 2.4);
    ctx.lineTo(Hx - 6.5, Hy + 1.8);
    ctx.closePath(); ctx.fill();

    const N = 26;
    const tailHang = this.gl.tail(
      lerp(lerp(lerp(-2.45, -3.02, run), -3.2, sit), -3.38, lie) + this.tailSw.x,
      lerp(lerp(lerp(1.1, 0.12, run), 0.9, sit), 3.0, lie) / N
    );
    const ta = tailHang.ta;
    const curl = tailHang.curl;
    let tx = Hx - 7, ty = Hy - 1, tAng = ta;
    const pts: Pt[] = [{ x: tx, y: ty }];
    for (let i = 0; i < N; i++) {
      tAng += curl + Math.sin(this.tailPhase - i * 0.35) * (0.03 + 0.02 * (1 - run)) * (0.4 + i / N);
      tx += Math.cos(tAng) * 1.8; ty += Math.sin(tAng) * 1.8;
      pts.push({ x: tx, y: ty });
    }
    const tailRadius = (t: number): number => 2.8 + 7.2 * Math.sin(Math.PI * (0.06 + 0.84 * t));
    for (let i = 0; i <= N; i++) {
      const r = tailRadius(i / N);
      ctx.fillStyle = '#965328';
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, r + 1.2, 0, TAU); ctx.fill();
    }
    for (let i = 0; i <= N; i++) {
      const t = i / N, r = tailRadius(t);
      const zig = (i % 2 === 0 ? -0.035 : 0.035) + (i % 5 === 0 ? -0.018 : 0.018);
      ctx.fillStyle = t > 0.75 + zig ? C.cream : C.fur;
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, r, 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = C.furLight;
    ctx.lineWidth = 0.75;
    for (let i = 2; i < N - 2; i += 3) {
      const p0 = pts[i], p1 = pts[i + 2];
      const nx = -(p1.y - p0.y), ny = p1.x - p0.x;
      const len = Math.hypot(nx, ny) || 1;
      ctx.beginPath();
      ctx.moveTo(p0.x + nx / len * 2, p0.y + ny / len * 2);
      ctx.lineTo(p1.x + nx / len * 2, p1.y + ny / len * 2);
      ctx.stroke();
    }
    ctx.restore();

    drawLeg(0); drawLeg(1);

    this.drawRuff(ctx, Sx + 4.5, Sy + 4, amp);

    this.gl.drawScruff(ctx, Sx, Sy);

    const hx = Sx + lerp(lerp(9, 7, sit), 11, lie);
    const hy = Sy + lerp(lerp(-10, -11, sit), -2, lie) - this.yawnEnv * 1.5;
    const tilt = lie * 0.28 - this.yawnEnv * 0.3 + this.lean * 0.35 + this.lookY * 0.12 - a * 0.2 * air;
    this.drawHead(ctx, hx, hy, tilt);
  }

  private drawEar(ctx: CanvasRenderingContext2D, bx: number, by: number, ang: number, L: number): void {
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, 0, -L);
    g.addColorStop(0, C.fur); g.addColorStop(0.65, C.fur); g.addColorStop(1, C.earTip);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-4.4, 1.5);
    ctx.quadraticCurveTo(-6, -L * 0.55, 0.6, -L);
    ctx.quadraticCurveTo(6.4, -L * 0.5, 4.4, 1.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.earIn;
    ctx.beginPath();
    ctx.moveTo(-2.6, -1);
    ctx.quadraticCurveTo(-3.8, -L * 0.5, 0.5, -L * 0.82);
    ctx.quadraticCurveTo(4, -L * 0.45, 2.7, -1);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,226,190,0.7)';
    ctx.lineWidth = 0.55;
    for (let i = 0; i < 3; i++) {
      const y = -3 - i * 2.8;
      ctx.beginPath();
      ctx.moveTo(-1.6 + i * 0.15, y);
      ctx.quadraticCurveTo(0, y - 2, 1.5 - i * 0.15, y - 4.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRuff(ctx: CanvasRenderingContext2D, cx: number, cy: number, run: number): void {
    const sway = Math.sin(this.time * 2.6) * 0.3 - run * 0.45;
    const bob = Math.sin(this.breathPhase * 0.7) * 0.25;
    ctx.save();
    ctx.translate(sway, bob);
    const g = ctx.createLinearGradient(cx - 5, cy - 5, cx + 7, cy + 9);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(0.58, C.cream);
    g.addColorStop(1, C.creamShade);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - 4.8, cy - 6.5);
    ctx.quadraticCurveTo(cx, cy - 9.2, cx + 5.5, cy - 5.5);
    ctx.quadraticCurveTo(cx + 8.8, cy - 1, cx + 6.4, cy + 4);
    ctx.quadraticCurveTo(cx + 5.8, cy + 8.1, cx + 3.9, cy + 5.7);
    ctx.quadraticCurveTo(cx + 2.9, cy + 9.4, cx + 1.3, cy + 6.1);
    ctx.quadraticCurveTo(cx - 0.3, cy + 9.2, cx - 1.2, cy + 5.7);
    ctx.quadraticCurveTo(cx - 3.4, cy + 8.2, cx - 3.6, cy + 4.5);
    ctx.quadraticCurveTo(cx - 7.7, cy + 1, cx - 4.8, cy - 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,145,91,0.38)';
    ctx.lineWidth = 0.55;
    ctx.stroke();
    ctx.restore();
  }

  private drawPaw(ctx: CanvasRenderingContext2D, x: number, y: number, far: boolean, front: boolean): void {
    const contactY = y - 0.9;
    const shade = far ? '#854b29' : '#a85f32';
    const light = far ? '#a56a43' : '#d08a50';
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(x, contactY, front ? 4.1 : 4.5, 1.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(x - 0.9, contactY - 1.2, 1.8, 0.65, -0.25, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = far ? 'rgba(58,31,24,0.5)' : 'rgba(82,43,31,0.56)';
    ctx.lineWidth = 0.42;
    for (let i = -1; i <= 1; i++) {
      const toeX = x + 1.7 + i * 0.85;
      ctx.beginPath();
      ctx.moveTo(toeX, contactY - 1.15);
      ctx.quadraticCurveTo(toeX + 0.7, contactY - 0.1, toeX + 0.15, contactY + 0.85);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,235,202,0.76)';
    ctx.lineWidth = 0.48;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(x - 1.8 + i * 1.15, contactY - 2.2);
      ctx.lineTo(x - 2.4 + i * 1.15, contactY - 3.7);
      ctx.stroke();
    }
  }

  private drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
    const open = clamp(this.eyeOpen * (1 - this.blinkC), 0, 1);
    ctx.lineCap = 'round';
    if (this.happy > 0.5 || open < 0.14) {
      ctx.strokeStyle = C.eye;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (this.happy > 0.5) ctx.arc(x, y + ry * 0.5, rx * 0.95, Math.PI * 1.1, Math.PI * 1.9);
      else ctx.arc(x, y - ry * 0.25, rx * 0.95, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      return;
    }
    const ex = x + this.lookX * rx * 0.25, ey = y + this.lookY * ry * 0.2;
    const alert = Math.max(clamp(this.alertT / 1.6, 0, 1), clamp(this.fearT / 2.4, 0, 1));
    const pupilWide = lerp(0.22, 0.52, alert);
    ctx.fillStyle = C.eye;
    ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry * open, 0, 0, TAU); ctx.fill();
    const iris = ctx.createRadialGradient(ex - rx * 0.18, ey - ry * 0.02, 0.2, ex, ey + ry * 0.18, rx * 0.8);
    iris.addColorStop(0, '#e9a451');
    iris.addColorStop(0.58, C.iris);
    iris.addColorStop(1, '#583021');
    ctx.fillStyle = iris;
    ctx.beginPath(); ctx.ellipse(ex, ey + ry * 0.22 * open, rx * 0.72, ry * 0.57 * open, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#160f13';
    ctx.beginPath(); ctx.ellipse(ex + this.lookX * 0.25, ey + ry * 0.22 * open, rx * pupilWide, ry * 0.46 * open, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex - rx * 0.28, ey - ry * 0.35 * open, rx * 0.34, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(ex + rx * 0.34, ey + ry * 0.36 * open, rx * 0.16, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex + rx * 0.55, ey - ry * 0.36 * open, rx * 0.085, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#512b20';
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(ex, ey, rx * 0.96, Math.PI * 1.08, Math.PI * 1.9); ctx.stroke();
  }

  private drawHead(ctx: CanvasRenderingContext2D, hx: number, hy: number, tilt: number): void {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(tilt);

    const wobble = Math.sin(this.time * 38) * 0;
    const e = this.ear.x + wobble;
    this.drawEar(ctx, 3.5, -7.4, e * 0.9 + 0.12, 21);

    blob(ctx, 0, 0, 11, 9.4, C.furLight, C.fur);
    ctx.fillStyle = C.furLight;
    ctx.beginPath();
    ctx.moveTo(-4.8, -7.2); ctx.quadraticCurveTo(-2.6, -11.2, -0.8, -13.2);
    ctx.lineTo(0.4, -9.2); ctx.lineTo(3.1, -12); ctx.lineTo(3.4, -7.4);
    ctx.quadraticCurveTo(-0.2, -8.8, -4.8, -7.2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.creamShade;
    ctx.beginPath();
    ctx.moveTo(-8, 1); ctx.lineTo(-12.5, 4.4); ctx.lineTo(-9.2, 5.3); ctx.lineTo(-11, 8.2); ctx.lineTo(-5.1, 7.3);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.cream;
    ctx.beginPath();
    ctx.moveTo(-7.6, 0.8); ctx.lineTo(-10.2, 4.3); ctx.lineTo(-7.3, 4.8); ctx.lineTo(-8.5, 7.1); ctx.lineTo(-3.9, 6.2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6.4, 2.1); ctx.lineTo(10.1, 3.6); ctx.lineTo(8.1, 5.1); ctx.lineTo(10.3, 6.3); ctx.lineTo(5.8, 7.1);
    ctx.closePath(); ctx.fill();
    blob(ctx, 8.8, 3.2, 4.5, 3.5, '#fff9eb', C.creamShade);
    ctx.fillStyle = C.nose;
    ctx.beginPath(); ctx.ellipse(12.1, 1.3, 1.35, 1.05, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.ellipse(11.75, 0.98, 0.42, 0.23, -0.35, 0, TAU); ctx.fill();

    ctx.fillStyle = 'rgba(112,69,49,0.7)';
    for (const [fx, fy, r] of [[9.5, 3.1, 0.28], [10.4, 3.6, 0.24], [8.9, 4.0, 0.22]] as const) {
      ctx.beginPath(); ctx.arc(fx, fy, r, 0, TAU); ctx.fill();
    }

    ctx.fillStyle = C.pink;
    ctx.globalAlpha = 0.25 + this.happy * 0.42;
    ctx.beginPath(); ctx.ellipse(5.8, 4.4, 2.0, 1.25, -0.15, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(179,82,75,0.58)';
    ctx.lineWidth = 0.38;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(5 + i * 0.8, 4.2); ctx.lineTo(4.6 + i * 0.8, 4.8); ctx.stroke();
    }

    this.drawEye(ctx, 3.7, -1.4, 3.25, 3.9);
    this.drawEye(ctx, 9.0, -1.8, 2.45, 3.15);

    const brow = Math.max(clamp(this.alertT / 1.6, 0, 1), clamp(this.fearT / 2.4, 0, 1));
    ctx.strokeStyle = '#9c5b35';
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.quadraticCurveTo(2.2, -6.6 - brow * 1.1, 5.5, -6.1 - brow * 1.8);
    ctx.moveTo(8.1, -6.5 - brow * 0.8);
    ctx.quadraticCurveTo(9.4, -7 - brow * 1.6, 10.7, -6.6 - brow * 1.2);
    ctx.stroke();

    const m = this.mouth;
    if (m > 0.08) {
      ctx.fillStyle = C.mouth;
      ctx.beginPath();
      ctx.moveTo(11.3, 4.4);
      ctx.quadraticCurveTo(9.4, 4.9, 7.6, 4.8);
      ctx.quadraticCurveTo(8.2, 4.8 + 4.5 * m, 11.3, 4.4);
      ctx.fill();
      ctx.fillStyle = '#ff8fa6';
      ctx.beginPath(); ctx.ellipse(9.4, 5 + 2.2 * m, 1.25, 0.8 * m + 0.2, 0, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = C.nose;
      ctx.lineWidth = 0.75;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(11.2, 4.2);
      ctx.quadraticCurveTo(10.3, 5.2, 9.5, 4.7);
      ctx.quadraticCurveTo(8.7, 5.5, 7.8, 4.8);
      ctx.stroke();
    }

    this.drawEar(ctx, -3.5, -6.8, e, 21);
    ctx.restore();
  }

  private renderFxBack(ctx: CanvasRenderingContext2D): void {
    const sp = clamp((this.speed - 60) / 75, 0, 1);
    if (sp > 0.05) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const seed = Math.floor(this.time * 14) * 7 + i * 13;
        const yy = this.y - 6 - ((seed * 37) % 30) * SCALE - this.hopY * SCALE * 0.5;
        const off = 22 + ((seed * 53) % 40);
        const len = (14 + ((seed * 29) % 22)) * sp;
        const x0 = this.x - this.dir * off * SCALE;
        ctx.globalAlpha = 0.55 * sp;
        ctx.lineWidth = 1.2 + (i % 3) * 0.5;
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 - this.dir * len, yy); ctx.stroke();
      }
      ctx.restore();
    }
    for (const d of this.dust) {
      const t = d.life / d.max;
      ctx.fillStyle = `rgba(255,244,225,${(0.55 * (1 - t)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.size * (0.6 + t), 0, TAU); ctx.fill();
    }
  }

  private renderFxFront(ctx: CanvasRenderingContext2D): void {
    const headX = this.x + this.dir * 14 * SCALE;
    if (this.markT > 0) {
      const age = 1.1 - this.markT;
      const s = age < 0.25 ? 1 + 0.5 * Math.sin((age / 0.25) * Math.PI) * (1 - age / 0.25) + (age / 0.25) * 0 : 1;
      const pop = clamp(age / 0.18, 0, 1);
      ctx.save();
      ctx.translate(headX, this.y - 56 * SCALE - this.hopY * SCALE - Math.sin(clamp(age, 0, 1) * 3) * 3);
      ctx.scale(pop * s, pop * s);
      ctx.globalAlpha = clamp(this.markT / 0.3, 0, 1);
      ctx.font = 'bold 22px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#46284f';
      ctx.strokeText(this.markChar, 0, 0);
      ctx.fillStyle = this.markChar === '♪' ? '#7CF0A8' : this.markChar === '♥' ? '#ff5c8a' : '#ffd23f';
      ctx.fillText(this.markChar, 0, 0);
      ctx.restore();
    }
    if (this.zAlpha > 0.02) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#cfd8ff';
      for (let i = 0; i < 3; i++) {
        const t = (this.time * 0.35 + i / 3) % 1;
        ctx.globalAlpha = Math.sin(t * Math.PI) * this.zAlpha * 0.9;
        ctx.font = `bold ${(7 + t * 8).toFixed(1)}px "Trebuchet MS", sans-serif`;
        ctx.fillText('z', headX + t * 10 + Math.sin(t * 6) * 2, this.y - 26 * SCALE - t * 26);
      }
      ctx.restore();
    }
  }

  public dispose(): void { this.gl.grab.cancelInteraction(); this.isDisposed = true; }
}
