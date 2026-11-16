/**
 * Stage
 * Owns the companions on one overlay and drives them with Canvas procedural physics.
 * Extended with speech bubbles, per-companion scaling, and alert enlargement.
 */
import { LivingEventType, ZoneBounds } from '../core/types';
import { ParticleEngine } from '../engine/particles/ParticleEngine';
import { CatCompanion } from './companions/CatCompanion';
import { FoxCompanion } from './companions/FoxCompanion';
import { GhostCompanion } from './companions/GhostCompanion';
import { RobotCompanion } from './companions/RobotCompanion';
import { WebHeroCompanion } from './companions/WebHeroCompanion';
import { clampCompanionX } from './companions/CompanionBounds';
import { SpeechBubbleManager } from './SpeechBubble';
import type { SpeechBubbleMessage, CountdownPayload } from '../shared/ipc-channels';
import type { MotionSettings } from '../core/settings';

export type CompanionName = 'cat' | 'fox' | 'ghost' | 'robot' | 'webhero';
export type Companion = CatCompanion | FoxCompanion | GhostCompanion | RobotCompanion | WebHeroCompanion;

/** Frame-rate tiers (the main power lever for an always-on overlay). */
export const FPS_ACTIVE = 60; // held, thrown, or floating back
export const FPS_CALM = 30;   // walking / idling
export const FPS_SLEEP = 12;  // everyone asleep (breathing only)

const BURST: Record<string, { count: number; colors: string[] }> = {
  save: { count: 12, colors: ['#ffd700', '#00f0ff', '#ffffff'] },
  run: { count: 8, colors: ['#a5c8ff', '#ffffff'] },
  buildSuccess: { count: 20, colors: ['#4ade80', '#ffd700', '#ffffff', '#38bdf8'] },
  buildError: { count: 8, colors: ['#f87171', '#fb923c', '#ffffff'] },
};

interface Entry {
  name: CompanionName;
  c: Companion;
  scale: number;
}

export class Stage {
  public readonly bounds: ZoneBounds = { x: 0, y: 0, width: 800, height: 600 };
  public readonly bubbleManager = new SpeechBubbleManager();
  private entries: Entry[] = [];
  private readonly particles = new ParticleEngine();

  private globalScale = 1.0;
  private customScales: Partial<Record<CompanionName, number>> = {};
  private enlargeMultiplier = 1.0;
  private enlargeEndTime = 0;
  private enlargePeakTime = 0;
  private motion: MotionSettings = {
    autoRun: true,
    runDirection: 'both',
    runFrequencySeconds: 20,
    runDurationSeconds: 4,
    idleMotionFrequencySeconds: 8,
  };

  public setMotion(motion: MotionSettings): void {
    this.motion = { ...motion };
    for (const e of this.entries) {
      const c = e.c as any;
      if ('autonomous' in c) {
        c.autonomous = motion.autoRun;
      }
      if (motion.runDirection === 'left') {
        if ('facingRight' in c) c.facingRight = false;
        if ('dir' in c) c.dir = -1;
      } else if (motion.runDirection === 'right') {
        if ('facingRight' in c) c.facingRight = true;
        if ('dir' in c) c.dir = 1;
      }
    }
  }

  public resize(width: number, height: number): void {
    this.bounds.width = Math.max(1, width);
    this.bounds.height = Math.max(1, height);
    for (const entry of this.entries) {
      entry.c.x = clampCompanionX(entry.name, entry.c.x, this.bounds);
    }
  }

  public setScales(globalPercent: number, perCompanionPercent: Record<CompanionName, number>): void {
    this.globalScale = Math.max(0.5, Math.min(3.0, globalPercent / 100));
    this.customScales = {};
    for (const [k, v] of Object.entries(perCompanionPercent)) {
      this.customScales[k as CompanionName] = Math.max(0.5, Math.min(3.0, v / 100));
    }
  }

  public triggerEnlarge(multiplier = 1.6, durationSeconds = 3.5): void {
    this.enlargeMultiplier = multiplier;
    const now = performance.now();
    this.enlargeEndTime = now + durationSeconds * 1000;
    this.enlargePeakTime = now + (durationSeconds * 1000) * 0.3;
  }

  public showBubble(msg: SpeechBubbleMessage, defaultDuration = 6): void {
    this.bubbleManager.showMessage(msg, defaultDuration);
  }

  public setCountdown(cd: CountdownPayload | null): void {
    this.bubbleManager.setCountdown(cd);
  }

  private make(name: CompanionName, startX?: number): Companion {
    const x = clampCompanionX(name, startX ?? this.bounds.width * (0.2 + Math.random() * 0.6), this.bounds);
    const floor = this.bounds.y + this.bounds.height - 4;
    const id = `companion-${name}`;
    switch (name) {
      case 'cat': return new CatCompanion(id, 'BOTTOM', x, floor, this.particles);
      case 'fox': return new FoxCompanion(id, 'BOTTOM', x, floor, this.particles);
      case 'ghost': return new GhostCompanion(id, 'BOTTOM', x, floor, this.particles);
      case 'robot': return new RobotCompanion(id, 'BOTTOM', x, floor, this.particles);
      case 'webhero': return new WebHeroCompanion(id, 'BOTTOM', x, floor, this.particles);
    }
  }

  /** Make the set of companions on stage match `names` (adds/removes, keeps the rest). */
  public setCompanions(names: readonly string[]): void {
    const previousX = this.entries[0]?.c.x;
    const wanted = new Set(names.filter((n): n is CompanionName =>
      ['cat', 'fox', 'ghost', 'robot', 'webhero'].includes(n)));
    for (const e of this.entries) {
      if (!wanted.has(e.name)) { e.c.cancelInteraction(); e.c.dispose(); }
    }
    this.entries = this.entries.filter((e) => wanted.has(e.name));
    for (const name of wanted) {
      if (this.entries.some((e) => e.name === name)) continue;
      const c = this.make(name, previousX);
      c.setInteractive(true);
      c.setReducedMotion(null); // follow the OS "reduce motion" setting
      this.entries.push({ name, c, scale: 1.0 });
    }
  }

  /** Draw order, back to front (the host hit-tests from the end). */
  public list(): Companion[] {
    return this.entries.map((e) => e.c);
  }

  public bringToFront(c: unknown): void {
    const i = this.entries.findIndex((e) => e.c === c);
    if (i !== -1 && i < this.entries.length - 1) this.entries.push(this.entries.splice(i, 1)[0]);
  }

  public trigger(ev: LivingEventType): void {
    const burst = BURST[ev];
    for (const e of this.entries) {
      e.c.reactToEvent(ev);
      if (burst) this.particles.spawnGlitterBurst(e.c.x, e.c.y - 60, burst.count, burst.colors);
    }
  }

  public update(dt: number): void {
    for (const e of this.entries) {
      const c = e.c as any;
      if (this.motion.runDirection === 'left') {
        if ('facingRight' in c && c.facingRight === true) c.facingRight = false;
        if ('dir' in c && c.dir === 1) c.dir = -1;
      } else if (this.motion.runDirection === 'right') {
        if ('facingRight' in c && c.facingRight === false) c.facingRight = true;
        if ('dir' in c && c.dir === -1) c.dir = 1;
      }
      e.c.update(dt, this.bounds);
      if (!e.c.isAirborne()) e.c.x = clampCompanionX(e.name, e.c.x, this.bounds);
      const companionSpecificScale = this.customScales[e.name] ?? 1.0;
      const totalScale = this.globalScale * companionSpecificScale;
      const minCeilY = this.bounds.y + 45 * totalScale;
      if (e.c.y < minCeilY) {
        e.c.y = minCeilY;
        if ('vy' in c && typeof c.vy === 'number' && c.vy < 0) c.vy = 0;
      }
    }
    this.particles.update(dt, this.bounds);
    this.bubbleManager.update();
  }

  public render(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    let currentEnlarge = 1.0;

    if (now < this.enlargeEndTime) {
      if (now < this.enlargePeakTime) {
        // Scaling up to peak
        const t = (now - (this.enlargePeakTime - (this.enlargeEndTime - this.enlargePeakTime) / 2)) / (this.enlargePeakTime);
        currentEnlarge = 1.0 + (this.enlargeMultiplier - 1.0) * Math.min(1, Math.max(0, t));
      } else {
        // Easing down from peak
        const t = (this.enlargeEndTime - now) / (this.enlargeEndTime - this.enlargePeakTime);
        currentEnlarge = 1.0 + (this.enlargeMultiplier - 1.0) * Math.min(1, Math.max(0, t));
      }
    }

    for (const e of this.entries) {
      const companionSpecificScale = this.customScales[e.name] ?? 1.0;
      const totalScale = this.globalScale * companionSpecificScale * currentEnlarge;

      if (Math.abs(totalScale - 1.0) > 0.02) {
        ctx.save();
        ctx.translate(e.c.x, e.c.y);
        ctx.scale(totalScale, totalScale);
        ctx.translate(-e.c.x, -e.c.y);
        e.c.render(ctx);
        ctx.restore();
      } else {
        e.c.render(ctx);
      }
    }

    if (this.particles.getParticleCount() > 0) this.particles.render(ctx);

    // Render speech bubbles anchored on the lead companion
    const leadEntry = this.entries[0];
    if (leadEntry) {
      const lead = leadEntry.c;
      const companionSpecificScale = this.customScales[leadEntry.name] ?? 1.0;
      const totalScale = this.globalScale * companionSpecificScale * currentEnlarge;
      const anchor = lead.getVisualAnchor();
      const visualX = lead.x + (anchor.x - lead.x) * totalScale;
      const visualY = lead.y + (anchor.y - lead.y) * totalScale;
      this.bubbleManager.render(ctx, visualX, visualY, this.bounds);
    }
  }

  /** False when there is nothing to draw: the render loop can stop completely. */
  public needsFrames(): boolean {
    return (
      this.entries.length > 0 ||
      this.particles.getParticleCount() > 0 ||
      this.bubbleManager.hasContent() ||
      performance.now() < this.enlargeEndTime
    );
  }

  public targetFps(): number {
    if (performance.now() < this.enlargeEndTime || this.bubbleManager.hasContent()) {
      return FPS_ACTIVE;
    }
    let anyAwake = this.particles.getParticleCount() > 0;
    for (const e of this.entries) {
      if (e.c.isGrabbed() || e.c.isAirborne() || e.c.isPointerEngaged()) return FPS_ACTIVE;
      if ((e.c as { state?: string }).state !== 'SLEEP') anyAwake = true;
    }
    return anyAwake ? FPS_CALM : FPS_SLEEP;
  }

  public states(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.entries) out[e.name] = String((e.c as { state?: string }).state ?? '');
    return out;
  }

  public dispose(): void {
    for (const e of this.entries) { e.c.cancelInteraction(); e.c.dispose(); }
    this.entries = [];
    this.particles.clear();
    this.bubbleManager.dismiss();
  }
}
