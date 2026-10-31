import { IEntity, LivingEventType, ZoneBounds, ZoneType } from '../../core/types';
import { ParticleEngine } from '../../engine/particles/ParticleEngine';
import { clampCompanionX, companionXBounds } from './CompanionBounds';
import { RobotGrabLayer } from './RobotGrab';

export type RobotState = 'HOVER' | 'SCAN' | 'CELEBRATE' | 'ALERT' | 'SLEEP' | 'WAVE' | 'HELD' | 'FLY' | 'RECOVER';
type Face = 'normal' | 'happy' | 'alert' | 'sleep' | 'scan' | 'star' | 'glitch';
interface Spring { x: number; v: number }
type FxKind = 'spark' | 'confetti' | 'ring' | 'smoke' | 'badge' | 'zzz' | 'data';
interface Fx {
  kind: FxKind; x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; rot: number; vr: number; color: string; icon?: string;
}

const TAU = Math.PI * 2;
const S = 1.15;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const damp = (c: number, t: number, r: number, dt: number): number => c + (t - c) * (1 - Math.exp(-r * dt));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const backOut = (t: number): number => { const c = clamp(t, 0, 1) - 1; return 1 + c * c * (2.7 * c + 1.7); };
const spring = (s: Spring, target: number, k: number, c: number, dt: number): void => {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
};
const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
};
const rgb = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const FACE_COLOR: Record<Face, string> = {
  normal: '#38bdf8', scan: '#22d3ee', happy: '#4ade80', star: '#fde047',
  alert: '#f87171', glitch: '#f87171', sleep: '#64748b',
};

export class RobotCompanion implements IEntity {
  /** true: roams around the zone (sideways and up/down). false: parks at its bottom-right station. */
  public floatAround = true;
  public readonly id: string;
  public readonly zone: ZoneType;
  public x: number;
  public y: number;
  public isDisposed = false;

  public state: RobotState = 'HOVER';
  private stateTimer = 0;
  private stateDuration = Infinity;
  private time = 0;
  private hoverPhase = Math.random() * TAU;
  private groundY = 0;
  private vx = 0;

  private face: Face = 'normal';
  private faceAge = 1;
  private col: [number, number, number] = rgb(FACE_COLOR.normal);
  private blinkTimer = rand(2, 4);
  private blinkT = -1;
  private blinkC = 0;
  private lookX = 0; private lookY = 0;
  private lookTX = 0; private lookTY = 0;
  private lookTimer = 2;

  private ant: Spring = { x: 0, v: 0 };
  private headTilt: Spring = { x: 0, v: 0 };
  private headNod: Spring = { x: 0, v: 0 };
  private tilt: Spring = { x: 0, v: 0 };
  private sq: Spring = { x: 0, v: 0 };
  private armL: Spring = { x: 0.35, v: 0 };
  private armR: Spring = { x: 0.35, v: 0 };
  private liftY = 0; private liftV = 0; private liftT = 0; private airborne = false;
  private roll = 0;
  private shakeX = 0; private shakeY = 0;
  private glitch = 0;
  private flash = 0;

  private scanP = 0; private scanDone = false;
  private launched = false; private hopTimer = 0; private rolling = false;
  private rebooted = false; private puffTimer = 0;
  private idleTimer = rand(3, 5);
  private zTimer = 0;

  private fx: Fx[] = [];
  private particleEngine?: ParticleEngine;

  // interaction
  private readonly gl = new RobotGrabLayer();
  private interactive = true;
  private queuedEvent: LivingEventType | null = null;
  private grabbedLast = false;
  private faceResetT = 0;
  // roaming
  private roamX = 0;
  private roamV = 0;
  private roamAlt = 0;
  private alt = 0;
  private roamTimer = 0.6;
  // thrown
  private flyVx = 0;
  private flyVy = 0;

  constructor(id: string, zone: ZoneType, startX: number, startY: number, particleEngine?: ParticleEngine) {
    this.id = id;
    this.zone = zone;
    this.x = startX;
    this.y = startY;
    this.roamX = startX;
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

  public reactToEvent(eventName: LivingEventType): void {
    if (this.isDisposed) return;
    if (this.gl.grab.active) { this.queuedEvent = eventName; return; }
    const wasAsleep = this.state === 'SLEEP';
    this.stateTimer = 0;
    this.scanDone = false; this.launched = false; this.rebooted = false; this.rolling = false;
    this.airborne = false; this.liftY = Math.min(this.liftY, 0); this.liftV = 0; this.roll = 0;
    this.sq.v += wasAsleep ? 9 : 5;

    if (eventName === 'save') {
      this.state = 'SCAN'; this.stateDuration = 2.7; this.scanP = 0;
      this.setFace('scan'); this.flash = 0.6;
      this.ring(this.x, this.y - 10, '#22d3ee', 26);
      this.particleEngine?.spawnGlitterBurst(this.x, this.y, 4, ['#38bdf8', '#00f0ff', '#ffffff']);
    } else if (eventName === 'buildSuccess') {
      this.state = 'CELEBRATE'; this.stateDuration = 4.2; this.hopTimer = 0;
      this.setFace('star');
      this.particleEngine?.spawnGlitterBurst(this.x, this.y, 10, ['#a855f7', '#38bdf8', '#4ade80', '#ffffff']);
    } else if (eventName === 'buildError') {
      this.state = 'ALERT'; this.stateDuration = 3.1; this.puffTimer = 0;
      this.setFace('alert'); this.flash = 1;
      this.ring(this.x, this.y - 10, '#f87171', 34);
      this.particleEngine?.spawnGlitterBurst(this.x, this.y, 4, ['#f87171', '#fb923c']);
    }
  }

  public update(dt: number, bounds: ZoneBounds): void {
    if (this.isDisposed) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.stateTimer += dt;
    const sleeping = this.state === 'SLEEP';
    this.hoverPhase += dt * (sleeping ? 1.3 : 3);
    this.groundY = bounds.y + bounds.height - 4;

    if (this.updateGrab(dt, bounds)) {
      this.dynamics(dt);
      this.faceUpdate(dt);
      this.updateFx(dt);
      return;
    }

    this.think(dt);
    this.runState(dt);

    const px = this.x;
    if (this.floatAround) {
      this.roam(dt, bounds, sleeping);
    } else {
      const targetX = bounds.x + bounds.width * 0.85 + (sleeping ? 0 : Math.sin(this.time * 0.45) * 12);
      this.x += (targetX - this.x) * dt * 2;
    }
    this.x = clampCompanionX('robot', this.x, bounds);
    this.vx = damp(this.vx, (this.x - px) / Math.max(dt, 1e-4), 8, dt);

    if (this.airborne) {
      this.liftY += this.liftV * dt;
      this.liftV += 900 * dt;
      if (this.liftY >= 0) {
        this.liftY = 0; this.liftV = 0; this.airborne = false; this.rolling = false; this.roll = 0;
        this.sq.v += 7; this.burstDust(8);
      }
    } else {
      this.liftY = damp(this.liftY, this.liftT, 6, dt);
    }
    const bob = Math.sin(this.hoverPhase) * (sleeping ? 2.5 : 5);
    this.y = this.groundY - 16 * S + bob + (sleeping ? 7 : 0) + this.liftY - this.alt;

    this.dynamics(dt);
    this.faceUpdate(dt);
    this.updateFx(dt);
  }

  /** Wanders around the zone: glides sideways and drifts up/down to new spots, banking as it goes. */
  private roam(dt: number, bounds: ZoneBounds, sleeping: boolean): void {
    const { minX, maxX } = companionXBounds('robot', bounds);
    const active = this.state === 'HOVER' && !sleeping; // events and naps happen in place
    this.roamTimer -= dt;
    if (this.roamTimer <= 0 && active) {
      const margin = 30 * S;
      let tx = rand(minX + margin, maxX - margin);
      if (Math.abs(tx - this.x) < 90) {
        tx = this.x < (minX + maxX) / 2 ? Math.min(maxX - margin, this.x + 140) : Math.max(minX + margin, this.x - 140);
      }
      this.roamX = tx;
      const maxAlt = Math.max(0, bounds.height - 4 - 46 * S); // keep the whole droid inside the zone
      this.roamAlt = rand(0, Math.min(70, maxAlt));
      this.roamTimer = rand(4.5, 9);
    }
    const desired = active ? clamp((this.roamX - this.x) * 0.8, -52, 52) : 0;
    this.roamV += (desired - this.roamV) * (1 - Math.exp(-dt * 2.2));
    this.x += this.roamV * dt;
    this.alt = damp(this.alt, active ? this.roamAlt : 0, 1.6, dt);
  }

  /** Runs the pick-up / throw / float-back driver. Returns true while it controls the robot. */
  private updateGrab(dt: number, bounds: ZoneBounds): boolean {
    const { minX, maxX } = companionXBounds('robot', bounds);
    const homeX = this.floatAround ? undefined : bounds.x + bounds.width * 0.85 + Math.sin(this.time * 0.45) * 12;
    const g = this.gl.grab;
    const o = this.gl.update(dt, {
      scale: S, x: this.x, y: this.y, homeX,
      homeY: this.groundY - 16 * S + Math.sin(this.hoverPhase) * 5 - this.alt,
      bottomY: this.groundY - 12 * S, topY: bounds.y + 26 * S, minX, maxX,
    });

    if (this.faceResetT > 0 && !o.active) {
      this.faceResetT -= dt;
      if (this.faceResetT <= 0) { this.setFace('normal'); }
    }

    if (o.poke && !o.active) {
      this.state = 'WAVE'; this.stateDuration = 2; this.stateTimer = 0;
      this.setFace('happy'); this.sq.v += 4;
    }

    if (o.active) {
      if (this.state !== o.state) {
        this.state = o.state; this.stateTimer = 0; this.stateDuration = Infinity;
        this.airborne = false; this.liftY = 0; this.liftV = 0; this.liftT = 0;
        if (o.state === 'HELD') { this.setFace('alert'); this.flash = 0.6; this.sq.v += 5; }
        else if (o.state === 'FLY') { this.setFace('alert'); this.flash = 0.5; this.ant.v += 8; }
        else { this.setFace('scan'); this.sq.v += 3; }
      }
      if (o.state === 'HELD' && this.stateTimer > 0.5) { this.setFace('normal'); }
      this.x = o.x; this.y = o.y; this.vx = o.vx;
      this.glitch = o.state === 'FLY' && Math.random() < 0.12 ? 1 : 0;
      this.flyVx = o.state === 'FLY' ? o.vx : 0;
      this.flyVy = o.state === 'FLY' ? o.vy : 0;
      // exhaust trail while it tumbles through the air
      if (o.state === 'FLY' && o.speed > 90 && Math.random() < dt * 55) {
        const nx = this.x - Math.sin(o.rot) * 11 * S;
        const ny = this.y + Math.cos(o.rot) * 11 * S;
        const sp = Math.hypot(o.vx, o.vy) || 1;
        this.fxAdd({ kind: 'smoke', x: nx, y: ny, vx: -o.vx / sp * 30 + rand(-8, 8), vy: -o.vy / sp * 30 + rand(-8, 8), max: rand(0.35, 0.6), size: rand(2.5, 4), color: '#94a3b8' });
        this.fxAdd({ kind: 'spark', x: nx, y: ny, vx: -o.vx / sp * 60 + rand(-20, 20), vy: -o.vy / sp * 60 + rand(-20, 20), max: rand(0.25, 0.5), size: rand(1, 1.8), color: Math.random() < 0.5 ? '#38bdf8' : '#fb923c' });
      }

      // touch-down: squash, burst of dust, sparks from the nozzle, antenna and head whip
      if (g.landed > 0) {
        const k = clamp(g.intensity, 0.2, 1.4);
        this.sq.v += 6 + 8 * k;
        this.burstDust(6 + Math.round(10 * k));
        for (let i = 0; i < 5 + Math.round(5 * k); i++) this.spark(this.x + rand(-6, 6), this.groundY - 4, '#fb923c', 70 + 60 * k);
        this.flash = Math.max(this.flash, 0.5); this.ant.v += 10; this.headNod.v += 6;
        this.setFace('alert');
      }
      // caught itself after sinking: thruster flare, shock ring
      if (g.caught > 0 && g.landed === 0) {
        this.sq.v += 5; this.flash = Math.max(this.flash, 0.4); this.ant.v += 7;
        this.ring(this.x, this.y + 4, '#38bdf8', 24);
        if (this.y > this.groundY - 30 * S) this.burstDust(5);
      }
      // wall bump: jolt away from the wall, sparks, antenna whip
      if (g.wallImpact > 0) {
        this.shakeX = -g.wallSide * 4;
        this.sq.v += 3; this.ant.v += 9; this.flash = Math.max(this.flash, 0.4);
        for (let i = 0; i < 8; i++) this.spark(this.x - g.wallSide * 12 * S, this.y + rand(-10, 8), '#fde047', 90);
        this.ring(this.x - g.wallSide * 12 * S, this.y, '#fde047', 14);
      }
      this.shakeX = damp(this.shakeX, 0, 18, dt);
      this.shakeY = 0;

      // stabilisers blasting near the floor kick up dust (ground effect)
      if (o.state === 'RECOVER' && this.y > this.groundY - 26 * S && Math.random() < dt * 30) this.burstDust(1);
    } else if (this.grabbedLast) {
      this.state = 'HOVER'; this.stateDuration = Infinity; this.stateTimer = 0;
      this.idleTimer = rand(3, 6);
      this.glitch = 0; this.shakeX = 0; this.shakeY = 0; this.flyVx = 0; this.flyVy = 0;
      this.roamX = this.x; this.roamV = 0; this.roamTimer = 1.2; // carry on roaming from where it landed
      this.setFace('happy'); this.faceResetT = 0.7; this.flash = 0.4;
      this.ring(this.x, this.y - 10, '#38bdf8', 22);
      if (this.queuedEvent) {
        const e = this.queuedEvent;
        this.queuedEvent = null;
        this.reactToEvent(e);
      }
    }
    this.grabbedLast = o.active;
    return o.active;
  }

  private setFace(f: Face): void { if (f !== this.face) { this.face = f; this.faceAge = 0; } }

  private think(dt: number): void {
    if (this.stateTimer >= this.stateDuration) {
      const was = this.state;
      this.state = 'HOVER'; this.stateDuration = Infinity; this.stateTimer = 0;
      this.liftT = 0; this.setFace('normal'); this.idleTimer = rand(3, 6);
      if (was === 'SLEEP') { this.sq.v += 5; this.armL.v -= 6; this.armR.v -= 6; }
      return;
    }
    if (this.state !== 'HOVER') return;
    this.idleTimer -= dt;
    if (this.idleTimer > 0) return;
    this.idleTimer = rand(3.5, 7);
    const r = Math.random();
    if (r < 0.3) { this.lookTX = rand(-1, 0.4); this.lookTY = rand(-0.6, 0.6); this.lookTimer = rand(1.5, 3); }
    else if (r < 0.55) { this.state = 'WAVE'; this.stateDuration = 2.4; this.stateTimer = 0; this.setFace('happy'); }
    else if (r < 0.75) { this.lookTX = -1; this.lookTY = 0.2; this.lookTimer = 2.5; this.headTilt.v -= 3; }
    else if (r < 0.9) { this.state = 'SLEEP'; this.stateDuration = rand(9, 14); this.stateTimer = 0; this.setFace('sleep'); }
    else { this.sq.v += 5; this.ant.v += 8; }
  }

  private runState(dt: number): void {
    const t = this.stateTimer;
    switch (this.state) {
      case 'SCAN': {
        const p = t / this.stateDuration;
        this.liftT = -4;
        this.scanP = clamp(p / 0.7, 0, 1);
        if (!this.scanDone) {
          this.lookTX = -1; this.lookTY = 0;
          if (Math.random() < dt * 40) this.dataBit();
        }
        if (p >= 0.7 && !this.scanDone) {
          this.scanDone = true; this.setFace('happy'); this.flash = 0.5;
          this.badge('check', '#4ade80');
          this.ring(this.x, this.y - 12, '#4ade80', 30);
          for (let i = 0; i < 10; i++) this.spark(this.x, this.y - 14, '#86efac', 90);
          this.sq.v += 6;
          this.particleEngine?.spawnGlitterBurst(this.x, this.y - 20, 6, ['#4ade80', '#ffffff']);
        }
        break;
      }
      case 'CELEBRATE': {
        if (!this.launched && t >= 0.3) {
          this.launched = true; this.airborne = true; this.rolling = true;
          this.liftV = -300; this.roll = 0;
          this.confetti(this.x, this.y - 10, 36);
          this.ring(this.x, this.y, '#a855f7', 40);
        }
        if (this.rolling) this.roll = -TAU * smooth((this.liftV + 300) / 600);
        if (this.launched && !this.airborne) {
          this.hopTimer -= dt;
          if (this.hopTimer <= 0 && t < this.stateDuration - 0.8) {
            this.hopTimer = 0.62; this.airborne = true; this.liftV = -150;
            this.confetti(this.x, this.y - 14, 8);
            this.spark(this.x, this.y - 20, '#fde047', 80);
          }
          if (t > 1.6) this.setFace('happy');
        }
        if (Math.random() < dt * 8 && t > 0.3) this.confetti(this.x + rand(-30, 30), this.y - 55, 1, true);
        break;
      }
      case 'ALERT': {
        const k = Math.exp(-t * 1.3);
        this.shakeX = (Math.random() - 0.5) * 3.2 * k * 2;
        this.shakeY = (Math.random() - 0.5) * 1.6 * k * 2;
        this.liftT = t < 1.6 ? 6 : 0;
        this.glitch = t < 1.6 ? (Math.random() < 0.4 ? 1 : 0) : 0;
        if (t < 1.6) {
          this.setFace(this.glitch > 0 && Math.random() < 0.5 ? 'glitch' : 'alert');
          this.puffTimer -= dt;
          if (this.puffTimer <= 0) { this.puffTimer = 0.11; this.smoke(); }
          if (Math.random() < dt * 14) this.spark(this.x + rand(-8, 8), this.y - 14, '#fb923c', 70);
        } else if (!this.rebooted) {
          this.rebooted = true; this.setFace('scan'); this.shakeX = this.shakeY = 0;
          this.ring(this.x, this.y - 10, '#38bdf8', 22);
        } else if (t > 2.5) {
          this.setFace('normal');
        }
        if (t >= 1.6) { this.shakeX = damp(this.shakeX, 0, 20, dt); this.shakeY = damp(this.shakeY, 0, 20, dt); }
        break;
      }
      case 'SLEEP': {
        this.liftT = 0;
        this.zTimer -= dt;
        if (this.zTimer <= 0) { this.zTimer = 1.3; this.fxAdd({ kind: 'zzz', x: this.x + 12, y: this.y - 24, vx: 8, vy: -14, max: 2.4, size: 8, color: '#cbd5e1' }); }
        break;
      }
      case 'WAVE':
        this.liftT = 0;
        this.lookTX = -0.6; this.lookTY = -0.1;
        break;
      default:
        this.liftT = 0;
    }
    if (this.state !== 'ALERT') { this.shakeX = damp(this.shakeX, 0, 20, dt); this.shakeY = damp(this.shakeY, 0, 20, dt); this.glitch = 0; }
  }

  private dynamics(dt: number): void {
    const t = this.time, st = this.state, ph = this.hoverPhase;
    const dance = st === 'CELEBRATE' && this.launched && !this.airborne;
    if (this.gl.grab.active) {
      this.tilt.x = this.gl.grab.rot;
      this.tilt.v = 0;
    } else {
      spring(this.tilt, clamp(this.vx * 0.004, -0.25, 0.25) + (dance ? Math.sin(t * 9) * 0.1 : 0) + (st === 'ALERT' ? this.shakeX * 0.02 : 0), 120, 10, dt);
    }
    const antT = -this.vx * 0.01 + Math.sin(ph * 1.7) * 0.12 + (st === 'CELEBRATE' ? Math.sin(t * 16) * 0.35 : 0)
      + (st === 'ALERT' ? (Math.random() - 0.5) * 0.9 : 0) + (st === 'SLEEP' ? 0.45 : 0);
    spring(this.ant, antT, 110, 6, dt);
    const lookBias = this.lookX * 0.07;
    spring(this.headTilt, (st === 'SCAN' && !this.scanDone ? -0.12 : 0) + Math.sin(t * 0.8) * 0.05 + lookBias + (st === 'SLEEP' ? 0.12 : 0) + (dance ? Math.sin(t * 9 + 1) * 0.12 : 0), 140, 11, dt);
    spring(this.headNod, (st === 'SLEEP' ? 1.8 : 0) + (st === 'ALERT' ? -0.8 : 0) + Math.sin(ph * 1.5) * 0.3, 140, 12, dt);

    const crouch = st === 'CELEBRATE' && !this.launched && this.stateTimer < 0.3;
    const stretch = this.airborne && this.liftV < -60;
    spring(this.sq, crouch ? 0.32 : stretch ? -0.2 : 0, 300, 16, dt);

    let aL = 0.35 + Math.sin(ph * 1.2 + 1) * 0.09, aR = 0.35 + Math.sin(ph * 1.2) * 0.09;
    if (st === 'WAVE') aR = 2.55 + Math.sin(t * 13) * 0.4;
    else if (st === 'SCAN') { aL = 0.55; aR = this.scanDone ? 2.2 + Math.sin(t * 10) * 0.08 : 0.3; }
    else if (st === 'CELEBRATE') {
      const sw = Math.sin(t * 10) * 0.3;
      aL = 2.7 + sw; aR = 2.7 - sw;
      if (!this.launched) { aL = 0.1; aR = 0.1; }
    } else if (st === 'ALERT') {
      const j = this.rebooted ? 0 : (Math.random() - 0.5) * 0.5;
      aL = this.rebooted ? 0.4 : 1.7 + j; aR = this.rebooted ? 0.4 : 1.7 - j;
    } else if (st === 'SLEEP') { aL = 0.12; aR = 0.12; }
    else if (st === 'HELD') { const sw = Math.min(0.9, Math.abs(this.tilt.x) * 1.2); aL = 0.3 + sw; aR = 0.3 + sw; }
    else if (st === 'FLY') { const f = Math.sin(t * 22); aL = 1.6 + f * 0.8; aR = 1.6 - f * 0.8; }
    else if (st === 'RECOVER') { aL = 0.9 + Math.sin(t * 9) * 0.15; aR = 0.9 - Math.sin(t * 9) * 0.15; }
    spring(this.armL, aL, 150, 9, dt);
    spring(this.armR, aR, 150, 9, dt);
  }

  private faceUpdate(dt: number): void {
    this.faceAge += dt;
    this.blinkTimer -= dt;
    if (this.blinkT < 0 && this.blinkTimer <= 0 && this.state !== 'SLEEP') this.blinkT = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const p = this.blinkT / 0.16;
      if (p >= 1) { this.blinkT = -1; this.blinkC = 0; this.blinkTimer = Math.random() < 0.2 ? 0.15 : rand(2.2, 5); }
      else this.blinkC = Math.sin(p * Math.PI);
    }
    this.lookTimer -= dt;
    if (this.lookTimer <= 0 && this.state === 'HOVER') {
      this.lookTX = rand(-0.8, 0.5); this.lookTY = rand(-0.5, 0.5); this.lookTimer = rand(1.2, 3);
    }
    this.lookX = damp(this.lookX, this.lookTX, 14, dt);
    this.lookY = damp(this.lookY, this.lookTY, 14, dt);
    const tc = rgb(FACE_COLOR[this.face]);
    for (let i = 0; i < 3; i++) this.col[i] = damp(this.col[i], tc[i], 14, dt);
    this.flash = damp(this.flash, 0, 6, dt);
  }

  private fxAdd(p: Partial<Fx> & { kind: FxKind; x: number; y: number }): void {
    this.fx.push({ vx: 0, vy: 0, life: 0, max: 1, size: 3, rot: 0, vr: 0, color: '#ffffff', ...p });
  }
  private spark(x: number, y: number, color: string, speed: number): void {
    const a = rand(0, TAU), s = rand(speed * 0.4, speed);
    this.fxAdd({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, max: rand(0.35, 0.7), size: rand(1, 2), color });
  }
  private ring(x: number, y: number, color: string, size: number): void {
    this.fxAdd({ kind: 'ring', x, y, max: 0.6, size, color });
  }
  private badge(icon: string, color: string): void {
    this.fxAdd({ kind: 'badge', x: this.x, y: this.y - 40, vy: -9, max: 1.7, size: 11, color, icon });
  }
  private smoke(): void {
    this.fxAdd({ kind: 'smoke', x: this.x + rand(-5, 5), y: this.y - 20, vx: rand(-6, 10), vy: -rand(18, 34), max: rand(0.7, 1.1), size: rand(2.5, 4.5), color: '#94a3b8' });
  }
  private dataBit(): void {
    const len = 200 * this.scanP;
    this.fxAdd({ kind: 'data', x: this.x - 11 * S - rand(20, Math.max(21, len)), y: this.y - 12 * S + rand(-6, 6), max: 1.2, size: rand(1.2, 2.2), color: Math.random() < 0.5 ? '#22d3ee' : '#a5f3fc' });
  }
  private confetti(x: number, y: number, n: number, rain = false): void {
    const cols = ['#f472b6', '#a855f7', '#38bdf8', '#4ade80', '#fde047', '#fb923c'];
    for (let i = 0; i < n; i++) {
      const a = rain ? Math.PI / 2 : rand(-Math.PI, 0);
      const s = rain ? rand(5, 25) : rand(60, 170);
      this.fxAdd({ kind: 'confetti', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: rand(1.4, 2.4), size: rand(2, 3.6), rot: rand(0, TAU), vr: rand(-9, 9), color: cols[i % cols.length] });
    }
  }
  private burstDust(n: number): void {
    for (let i = 0; i < n; i++) {
      this.fxAdd({ kind: 'smoke', x: this.x + rand(-6, 6), y: this.groundY - 2, vx: rand(-40, 40), vy: -rand(4, 14), max: rand(0.3, 0.5), size: rand(2, 3.5), color: '#cbd5e1' });
    }
  }

  private updateFx(dt: number): void {
    const tx = this.x - 10 * S, ty = this.y - 12 * S;
    for (const f of this.fx) {
      f.life += dt;
      if (f.kind === 'data') {
        const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
        f.x += (dx / d) * 160 * dt; f.y += (dy / d) * 160 * dt;
        if (d < 5) f.life = f.max;
        continue;
      }
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.rot += f.vr * dt;
      if (f.kind === 'spark') f.vy += 120 * dt;
      else if (f.kind === 'confetti') { f.vy += 150 * dt; f.vx *= 0.985; f.vy *= 0.985; f.x += Math.sin(f.life * 6 + f.rot) * 0.4; }
      else if (f.kind === 'smoke') { f.vx *= 0.96; f.vy *= 0.97; }
    }
    this.fx = this.fx.filter((f) => f.life < f.max);
    if (this.fx.length > 220) this.fx.splice(0, this.fx.length - 220);
  }

  public render(ctx: CanvasRenderingContext2D): void {
    if (this.isDisposed) return;
    this.renderFxBack(ctx);

    const alt = Math.max(0, this.groundY - (this.y + 16 * S));
    const sh = 1 - clamp(alt / 70, 0, 0.65);
    ctx.fillStyle = `rgba(0,0,0,${(0.22 * sh).toFixed(3)})`;
    ctx.beginPath(); ctx.ellipse(this.x, this.groundY, 13 * S * sh, 3 * S * sh, 0, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(this.x + this.shakeX, this.y + this.shakeY);
    this.renderBeam(ctx);

    ctx.rotate(this.tilt.x + this.roll);
    const sq = this.sq.x;
    ctx.translate(0, 11.6 * S * 0.6 * sq); // keep the nozzle on the floor while it squashes
    ctx.scale(S * (1 + sq * 0.45), S * (1 - sq * 0.6));

    if (this.glitch > 0) {
      ctx.save();
      for (const [dx, c] of [[-1.8, 'rgba(255,60,80,0.38)'], [1.8, 'rgba(60,240,255,0.32)']] as const) {
        ctx.fillStyle = c;
        rr(ctx, -12 + dx, -18, 24, 14, 5); ctx.fill();
        rr(ctx, -10 + dx, -2, 20, 11, 4); ctx.fill();
      }
      ctx.restore();
    }
    this.drawBody(ctx);
    if (this.glitch > 0) {
      const sy = rand(-20, 6), sh2 = rand(3, 7);
      ctx.save();
      ctx.beginPath(); ctx.rect(-30, sy, 60, sh2); ctx.clip();
      ctx.translate(rand(-5, 5), 0);
      this.drawBody(ctx);
      ctx.restore();
    }
    ctx.restore();
    this.renderFxFront(ctx);
  }

  private colStr(a = 1): string {
    return `rgba(${Math.round(this.col[0])},${Math.round(this.col[1])},${Math.round(this.col[2])},${a})`;
  }

  private drawBody(ctx: CanvasRenderingContext2D): void {
    const st = this.state, ph = this.hoverPhase;
    const sleeping = st === 'SLEEP';

    let thrust = sleeping ? 0.35 : 1 + (this.airborne && this.liftV < 0 ? 1.4 : 0);
    if (st === 'ALERT' && !this.rebooted) thrust = Math.random() < 0.45 ? 0.1 : 0.9;
    if (st === 'HELD') thrust = 0.12 + Math.random() * 0.22; // thrusters sputter while held
    else if (st === 'FLY') thrust = Math.random() < 0.35 ? 0.2 : 0.7 + Math.random() * 0.8; // erratic while tumbling
    else if (st === 'RECOVER') thrust = 1.6; // stabilisers flare while it floats back
    const fl = (9 + Math.sin(ph * 2) * 2.5 + Math.random() * 1.2) * thrust;
    const fw = 5.6 * (0.8 + 0.2 * thrust);
    const halo = ctx.createRadialGradient(0, 10 + fl * 0.35, 0.5, 0, 10 + fl * 0.35, 10 + fl * 0.8);
    halo.addColorStop(0, this.colStr(0.5 * Math.min(1, thrust))); halo.addColorStop(1, this.colStr(0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 10 + fl * 0.35, 10 + fl * 0.8, 0, TAU); ctx.fill();
    const fg = ctx.createLinearGradient(0, 9, 0, 9 + fl);
    fg.addColorStop(0, this.colStr(1)); fg.addColorStop(0.6, this.colStr(0.6)); fg.addColorStop(1, this.colStr(0));
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(-fw, 9); ctx.quadraticCurveTo(-fw * 0.7, 9 + fl * 0.65, 0, 9 + fl); ctx.quadraticCurveTo(fw * 0.7, 9 + fl * 0.65, fw, 9); ctx.closePath(); ctx.fill();
    const cg = ctx.createLinearGradient(0, 9, 0, 9 + fl * 0.7);
    cg.addColorStop(0, 'rgba(255,255,255,1)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(-fw * 0.45, 9); ctx.quadraticCurveTo(-fw * 0.3, 9 + fl * 0.45, 0, 9 + fl * 0.7); ctx.quadraticCurveTo(fw * 0.3, 9 + fl * 0.45, fw * 0.45, 9); ctx.closePath(); ctx.fill();

    const ng = ctx.createLinearGradient(0, 8, 0, 11.5);
    ng.addColorStop(0, '#64748b'); ng.addColorStop(1, '#334155');
    ctx.fillStyle = ng; rr(ctx, -4.6, 8.4, 9.2, 3.2, 1.6); ctx.fill();

    this.drawArm(ctx, -1, this.armL.x);
    this.drawArm(ctx, 1, this.armR.x);

    const tg = ctx.createLinearGradient(0, -2, 0, 9);
    tg.addColorStop(0, '#4b5b72'); tg.addColorStop(0.55, '#334155'); tg.addColorStop(1, '#232f40');
    ctx.fillStyle = tg; ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1.1;
    rr(ctx, -10, -2, 20, 11, 4); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-6.5, -1.1); ctx.lineTo(6.5, -1.1); ctx.stroke();
    ctx.strokeStyle = 'rgba(15,23,42,0.55)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-7, 1.6); ctx.lineTo(-7, 7.2); ctx.moveTo(7, 1.6); ctx.lineTo(7, 7.2); ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    for (const [rx, ry] of [[-8.3, 0], [8.3, 0], [-8.3, 7.4], [8.3, 7.4]]) { ctx.beginPath(); ctx.arc(rx, ry, 0.55, 0, TAU); ctx.fill(); }
    this.drawChest(ctx);

    ctx.fillStyle = '#475569'; rr(ctx, -3.5, -4.6, 7, 3, 1.4); ctx.fill();
    ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-2.4, -3.6); ctx.lineTo(2.4, -3.6); ctx.stroke();

    ctx.save();
    ctx.translate(0, Math.sin(ph * 1.5) * 1.5 + this.headNod.x);
    ctx.translate(0, -4); ctx.rotate(this.headTilt.x); ctx.translate(0, 4);
    this.drawHead(ctx);
    ctx.restore();
  }

  private drawArm(ctx: CanvasRenderingContext2D, side: number, a: number): void {
    const sx = side * 10.6, sy = 2.2, L = 8.6;
    const hx = sx + side * Math.sin(a) * L, hy = sy + Math.cos(a) * L;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(sx - 0.5, sy - 0.4); ctx.lineTo(hx - 0.5, hy - 0.4); ctx.stroke();
    ctx.fillStyle = '#475569'; ctx.beginPath(); ctx.arc(sx, sy, 2, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(hx - 0.8, hy - 0.8, 0.3, hx, hy, 3.2);
    g.addColorStop(0, '#94a3b8'); g.addColorStop(1, '#475569');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 2.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(hx + side * Math.cos(a) * 1.9, hy - Math.sin(a) * 1.9 - 0.5, 1.1, 0, TAU); ctx.fill();
    ctx.fillStyle = this.colStr(0.9); ctx.beginPath(); ctx.arc(hx, hy, 0.7, 0, TAU); ctx.fill();
  }

  private drawChest(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0b1220'; ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 0.8;
    rr(ctx, -5.6, 0.2, 11.2, 7, 2); ctx.fill(); ctx.stroke();
    ctx.save();
    rr(ctx, -5.6, 0.2, 11.2, 7, 2); ctx.clip();
    const st = this.state, t = this.time;
    ctx.strokeStyle = this.colStr(1); ctx.fillStyle = this.colStr(1);
    ctx.lineWidth = 0.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (st === 'SCAN') {
      if (!this.scanDone) {
        ctx.fillStyle = '#1e293b'; rr(ctx, -4, 3.1, 8, 1.8, 0.9); ctx.fill();
        ctx.fillStyle = this.colStr(1); rr(ctx, -4, 3.1, Math.max(0.5, 8 * this.scanP), 1.8, 0.9); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(-2.6, 3.8); ctx.lineTo(-0.7, 5.6); ctx.lineTo(2.8, 1.8); ctx.lineWidth = 1.2; ctx.stroke();
      }
    } else if (st === 'CELEBRATE') {
      const p = 1 + Math.sin(t * 12) * 0.15;
      ctx.fillStyle = '#f472b6'; ctx.shadowColor = '#f472b6'; ctx.shadowBlur = 3;
      ctx.save(); ctx.translate(0, 3.9); ctx.scale(p, p);
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.bezierCurveTo(-4, -0.8, -1.6, -3, 0, -1); ctx.bezierCurveTo(1.6, -3, 4, -0.8, 0, 2); ctx.fill();
      ctx.restore(); ctx.shadowBlur = 0;
    } else if (st === 'ALERT' && !this.rebooted) {
      if (Math.floor(t * 8) % 2 === 0) {
        ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.moveTo(0, 1.3); ctx.lineTo(3, 6.3); ctx.lineTo(-3, 6.3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0b1220'; ctx.fillRect(-0.35, 2.9, 0.7, 1.9); ctx.fillRect(-0.35, 5.2, 0.7, 0.7);
      }
    } else if (st === 'ALERT') {
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = (Math.floor(t * 6) % 3 === i) ? 1 : 0.25; ctx.beginPath(); ctx.arc(-3 + i * 3, 3.8, 0.9, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    } else if (st === 'SLEEP') {
      ctx.strokeStyle = 'rgba(148,163,184,0.7)'; ctx.lineWidth = 0.6; rr(ctx, -3.6, 2.4, 6.6, 3, 0.8); ctx.stroke();
      ctx.fillStyle = Math.sin(t * 2) > 0 ? '#fbbf24' : 'rgba(251,191,36,0.2)'; ctx.fillRect(-3, 3, 1.8, 1.8);
    } else {
      ctx.beginPath();
      for (let x = -4.6; x <= 4.6; x += 0.4) {
        const k = ((((x + 4.6) / 9.2 - t * 0.5) % 1) + 1) % 1;
        const y = k < 0.07 ? -(k / 0.07) * 2.2 : k < 0.14 ? -2.2 + ((k - 0.07) / 0.07) * 3.8 : k < 0.2 ? 1.6 - ((k - 0.14) / 0.06) * 1.6 : 0;
        if (x === -4.6) ctx.moveTo(x, 3.9 + y); else ctx.lineTo(x, 3.9 + y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHead(ctx: CanvasRenderingContext2D): void {
    const st = this.state;
    const ax = Math.sin(this.ant.x) * 6, ay = -18 - Math.cos(this.ant.x) * 6.5;
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -17.5); ctx.quadraticCurveTo(ax * 0.2, -22.5, ax, ay); ctx.stroke();
    const pulse = st === 'SLEEP' ? 0.25 + 0.15 * Math.sin(this.time * 2) : 0.75 + 0.25 * Math.sin(this.time * (st === 'ALERT' ? 20 : 5));
    const glow = ctx.createRadialGradient(ax, ay, 0.3, ax, ay, 6);
    glow.addColorStop(0, this.colStr(0.9 * pulse)); glow.addColorStop(1, this.colStr(0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ax, ay, 6, 0, TAU); ctx.fill();
    ctx.fillStyle = this.colStr(1); ctx.beginPath(); ctx.arc(ax, ay, 2, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(ax - 0.6, ay - 0.6, 0.6, 0, TAU); ctx.fill();

    for (const sd of [-1, 1]) {
      ctx.fillStyle = '#334155'; ctx.strokeStyle = '#64748b'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.ellipse(sd * 12.6, -11, 2.2, 3.6, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = this.colStr(0.85); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.ellipse(sd * 12.8, -11, 0.9, 2, 0, 0, TAU); ctx.stroke();
    }

    const hg = ctx.createLinearGradient(0, -18, 0, -4);
    hg.addColorStop(0, '#34445c'); hg.addColorStop(1, '#17202e');
    ctx.fillStyle = hg; ctx.strokeStyle = '#52627a'; ctx.lineWidth = 1.1;
    rr(ctx, -12, -18, 24, 14, 5); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-7.5, -17); ctx.quadraticCurveTo(0, -18.6, 7.5, -17); ctx.stroke();
    ctx.strokeStyle = 'rgba(8,12,22,0.6)'; ctx.lineWidth = 0.5;
    for (const vx of [-2, 0, 2]) { ctx.beginPath(); ctx.moveTo(vx, -5.6); ctx.lineTo(vx, -4.6); ctx.stroke(); }

    const vg = ctx.createLinearGradient(0, -15.5, 0, -5.5);
    vg.addColorStop(0, '#0b1324'); vg.addColorStop(1, '#050913');
    ctx.fillStyle = vg; rr(ctx, -9.5, -15.5, 19, 10, 3.5); ctx.fill();
    ctx.strokeStyle = this.colStr(0.28); ctx.lineWidth = 0.6; ctx.stroke();
    ctx.save();
    rr(ctx, -9.5, -15.5, 19, 10, 3.5); ctx.clip();
    if (this.flash > 0.02) { ctx.fillStyle = this.colStr(this.flash * 0.5); ctx.fillRect(-10, -16, 20, 11); }
    this.drawFace(ctx);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.moveTo(-9, -15.5); ctx.lineTo(-2, -15.5); ctx.lineTo(-7, -5.5); ctx.lineTo(-9.5, -5.5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  private drawFace(ctx: CanvasRenderingContext2D): void {
    const f = this.face, t = this.time;
    const cy = -10.6;
    const open = 1 - this.blinkC;
    const pop = this.faceAge < 0.22 ? Math.sin((this.faceAge / 0.22) * Math.PI) * 0.35 : 0;
    const ox = this.lookX * 1.6, oy = this.lookY * 0.9;
    const c = this.colStr(1);
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = c; ctx.shadowBlur = 4;

    if (f === 'normal') {
      if (this.blinkC > 0.85) { ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(-6, cy); ctx.lineTo(-2, cy); ctx.moveTo(2, cy); ctx.lineTo(6, cy); ctx.stroke(); }
      else {
        for (const sx of [-4, 4]) {
          ctx.beginPath(); ctx.ellipse(sx + ox, cy + oy, 1.9 * (1 + pop), 2.4 * open * (1 + pop), 0, 0, TAU); ctx.fill();
        }
        ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (const sx of [-4, 4]) { ctx.beginPath(); ctx.arc(sx + ox - 0.6, cy + oy - 0.9 * open, 0.55, 0, TAU); ctx.fill(); }
      }
      ctx.shadowBlur = 0; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.6; ctx.strokeStyle = c;
      ctx.beginPath(); ctx.arc(0, -8.8, 1.6, 0.25, Math.PI - 0.25); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (f === 'happy') {
      ctx.lineWidth = 1.5;
      for (const sx of [-4, 4]) { ctx.beginPath(); ctx.arc(sx, cy + 1.2, 2.5 * (1 + pop), Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      ctx.shadowBlur = 0; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, -9.1, 2.6, 0.15, Math.PI - 0.15); ctx.stroke();
      ctx.fillStyle = 'rgba(244,114,182,0.45)';
      for (const sx of [-7.4, 7.4]) { ctx.beginPath(); ctx.ellipse(sx, -8.6, 1.6, 0.9, 0, 0, TAU); ctx.fill(); }
    } else if (f === 'star') {
      for (const sx of [-4, 4]) {
        ctx.save(); ctx.translate(sx, cy); ctx.rotate(t * 3); const s = 3.2 * (1 + pop);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.45 : s, a = (i / 10) * TAU - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.shadowBlur = 0; ctx.fillStyle = '#6b2336';
      ctx.beginPath(); ctx.ellipse(0, -8.1, 2.2, 1.3 + Math.abs(Math.sin(t * 10)) * 0.4, 0, 0, Math.PI); ctx.fill();
    } else if (f === 'alert' || f === 'glitch') {
      if (f === 'glitch') {
        ctx.lineWidth = 1.3;
        for (const sx of [-4, 4]) { ctx.beginPath(); ctx.moveTo(sx - 2, cy - 2); ctx.lineTo(sx + 2, cy + 2); ctx.moveTo(sx + 2, cy - 2); ctx.lineTo(sx - 2, cy + 2); ctx.stroke(); }
      } else {
        const w = 1 + pop;
        for (const sx of [-4.2, 4.2]) { ctx.beginPath(); ctx.roundRect(sx - 2.3 * w, cy - 2.6 * w, 4.6 * w, 5.2 * w, 1); ctx.fill(); }
        ctx.shadowBlur = 0; ctx.fillStyle = '#0b1220';
        for (const sx of [-4.2, 4.2]) { ctx.beginPath(); ctx.roundRect(sx - 0.5, cy - 1.4, 1, 2.8, 0.4); ctx.fill(); }
      }
      ctx.shadowBlur = 0; ctx.strokeStyle = c; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-7, -14.6); ctx.lineTo(-2.2, -13.2); ctx.moveTo(7, -14.6); ctx.lineTo(2.2, -13.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-3, -7.6); for (let i = 1; i <= 6; i++) ctx.lineTo(-3 + i, -7.6 + (i % 2 ? -0.9 : 0.4)); ctx.stroke();
    } else if (f === 'scan') {
      const sweep = Math.sin(t * 7) * 0.5 + 0.5;
      ctx.lineWidth = 1.2; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(-6.5, cy); ctx.lineTo(6.5, cy); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-6.5 + sweep * 9, cy); ctx.lineTo(-3.5 + sweep * 9, cy); ctx.stroke();
      ctx.shadowBlur = 0; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.6;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 2, cy - 3.6); ctx.lineTo(i * 2, cy - 2.6); ctx.stroke(); }
      ctx.globalAlpha = 1;
    } else {
      ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8;
      for (const sx of [-4, 4]) { ctx.beginPath(); ctx.arc(sx, cy - 0.6, 2.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
      ctx.globalAlpha = 0.6; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.ellipse(0, -8, 0.9 + Math.sin(t * 1.6) * 0.3, 0.7 + Math.sin(t * 1.6) * 0.3, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
  }

  private renderBeam(ctx: CanvasRenderingContext2D): void {
    if (this.state !== 'SCAN') return;
    const p = this.stateTimer / this.stateDuration;
    const vis = clamp(1 - (p - 0.7) / 0.15, 0, 1);
    if (vis <= 0.01) return;
    const len = 230 * smooth(this.scanP);
    if (len < 4) return;
    const ang = Math.PI + Math.sin(this.stateTimer * 7) * 0.2 * (1 - this.scanP * 0.3) + 0.04;
    ctx.save();
    ctx.translate(-10 * S, -12 * S);
    ctx.rotate(ang - Math.PI);
    ctx.globalAlpha = vis;
    const g = ctx.createLinearGradient(0, 0, -len, 0);
    g.addColorStop(0, 'rgba(34,211,238,0.5)'); g.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-len, -len * 0.12); ctx.lineTo(-len, len * 0.12); ctx.closePath(); ctx.fill();
    const cg = ctx.createLinearGradient(0, 0, -len, 0);
    cg.addColorStop(0, 'rgba(236,254,255,0.95)'); cg.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.strokeStyle = cg; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-len, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(165,243,252,0.5)'; ctx.lineWidth = 0.8;
    for (let i = 1; i < 8; i++) { const x = -((i * 28 + this.stateTimer * 140) % len); const h = len * 0.12 * (-x / len); ctx.beginPath(); ctx.moveTo(x, -h); ctx.lineTo(x, h); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(236,254,255,0.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-len, 0, 5, 0, TAU); ctx.moveTo(-len - 8, 0); ctx.lineTo(-len - 3, 0); ctx.moveTo(-len + 3, 0); ctx.lineTo(-len + 8, 0); ctx.stroke();
    ctx.restore();
  }

  private renderFxBack(ctx: CanvasRenderingContext2D): void {
    const fs = Math.hypot(this.flyVx, this.flyVy);
    if (this.state === 'FLY' && fs > 120) {
      // speed lines streaming behind the thrown droid
      const ux = this.flyVx / fs, uy = this.flyVy / fs, qx = -uy, qy = ux;
      ctx.save();
      ctx.strokeStyle = 'rgba(186,230,253,0.55)';
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const seed = Math.floor(this.time * 16) * 7 + i * 13;
        const off = ((seed * 37) % 30) - 15;
        const back = 14 + ((seed * 53) % 26);
        const len = Math.min(48, fs * 0.05) * (0.6 + ((seed * 29) % 10) / 20);
        const x0 = this.x - ux * back * S + qx * off * S * 0.8;
        const y0 = this.y - uy * back * S + qy * off * S * 0.8;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1 + (i % 3) * 0.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 - ux * len, y0 - uy * len); ctx.stroke();
      }
      ctx.restore();
    }
    for (const f of this.fx) {
      const t = f.life / f.max;
      if (f.kind === 'ring') {
        ctx.strokeStyle = f.color; ctx.globalAlpha = (1 - t) * 0.8; ctx.lineWidth = 2 * (1 - t) + 0.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.size * smooth(t) + 2, 0, TAU); ctx.stroke();
      } else if (f.kind === 'smoke') {
        ctx.fillStyle = f.color; ctx.globalAlpha = 0.45 * (1 - t);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.size * (0.7 + t * 1.3), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderFxFront(ctx: CanvasRenderingContext2D): void {
    for (const f of this.fx) {
      const t = f.life / f.max;
      switch (f.kind) {
        case 'spark':
          ctx.globalAlpha = 1 - t; ctx.fillStyle = f.color;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.size * (1 - t * 0.5), 0, TAU); ctx.fill(); break;
        case 'confetti':
          ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
          ctx.globalAlpha = clamp((1 - t) * 3, 0, 1); ctx.fillStyle = f.color;
          ctx.scale(1, Math.abs(Math.cos(f.life * 7 + f.rot)) * 0.8 + 0.2);
          ctx.fillRect(-f.size / 2, -f.size / 4, f.size, f.size / 2); ctx.restore(); break;
        case 'data':
          ctx.globalAlpha = 0.9 * (1 - t * 0.6); ctx.fillStyle = f.color;
          ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size); break;
        case 'zzz':
          ctx.save(); ctx.globalAlpha = Math.sin(t * Math.PI) * 0.9; ctx.fillStyle = f.color;
          ctx.font = `bold ${(f.size + t * 7).toFixed(1)}px "Trebuchet MS", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('z', f.x + Math.sin(f.life * 3) * 3, f.y); ctx.restore(); break;
        case 'badge': {
          const s = backOut(f.life / 0.35), a = clamp((1 - t) * 3, 0, 1);
          ctx.save(); ctx.translate(f.x, f.y); ctx.scale(s, s); ctx.globalAlpha = a;
          ctx.fillStyle = '#0b1220'; ctx.strokeStyle = f.color; ctx.lineWidth = 1.8;
          ctx.shadowColor = f.color; ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(0, 0, f.size, 0, TAU); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
          ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          const draw = clamp(f.life / 0.5, 0, 1);
          ctx.beginPath(); ctx.moveTo(-4.6, 0.3);
          ctx.lineTo(lerp(-4.6, -1.4, clamp(draw * 2, 0, 1)), lerp(0.3, 3.4, clamp(draw * 2, 0, 1)));
          if (draw > 0.5) ctx.lineTo(lerp(-1.4, 5, (draw - 0.5) * 2), lerp(3.4, -3.6, (draw - 0.5) * 2));
          ctx.stroke(); ctx.restore(); break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
  }

  public dispose(): void { this.gl.grab.cancelInteraction(); this.isDisposed = true; }
}
