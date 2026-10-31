/**
 * Stage
 * Owns the companions on one overlay and drives them exactly like the extension's
 * CanvasRenderer did: the physics world is the whole canvas, the floor is 4px above its
 * bottom edge, X is clamped by CompanionBounds unless the companion is held or airborne.
 * No Electron / DOM dependencies, so it can be smoke-tested in plain Node.
 */
import { LivingEventType, ZoneBounds } from '../core/types';
import { ParticleEngine } from '../engine/particles/ParticleEngine';
import { CatCompanion } from './companions/CatCompanion';
import { FoxCompanion } from './companions/FoxCompanion';
import { GhostCompanion } from './companions/GhostCompanion';
import { RobotCompanion } from './companions/RobotCompanion';
import { WebHeroCompanion } from './companions/WebHeroCompanion';
import { clampCompanionX } from './companions/CompanionBounds';

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

interface Entry { name: CompanionName; c: Companion }

export class Stage {
  public readonly bounds: ZoneBounds = { x: 0, y: 0, width: 800, height: 600 };
  private entries: Entry[] = [];
  private readonly particles = new ParticleEngine();

  public resize(width: number, height: number): void {
    this.bounds.width = Math.max(1, width);
    this.bounds.height = Math.max(1, height);
  }

  private make(name: CompanionName): Companion {
    const x = clampCompanionX(name, this.bounds.width * (0.2 + Math.random() * 0.6), this.bounds);
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
    const wanted = new Set(names.filter((n): n is CompanionName =>
      ['cat', 'fox', 'ghost', 'robot', 'webhero'].includes(n)));
    for (const e of this.entries) {
      if (!wanted.has(e.name)) { e.c.cancelInteraction(); e.c.dispose(); }
    }
    this.entries = this.entries.filter((e) => wanted.has(e.name));
    for (const name of wanted) {
      if (this.entries.some((e) => e.name === name)) continue;
      const c = this.make(name);
      c.setInteractive(true);
      c.setReducedMotion(null); // follow the OS "reduce motion" setting
      this.entries.push({ name, c });
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
      e.c.update(dt, this.bounds);
      // Like the extension: no X clamp while held/airborne, it may travel anywhere.
      if (!e.c.isAirborne()) e.c.x = clampCompanionX(e.name, e.c.x, this.bounds);
    }
    this.particles.update(dt, this.bounds);
  }

  public render(ctx: CanvasRenderingContext2D): void {
    for (const e of this.entries) e.c.render(ctx);
    if (this.particles.getParticleCount() > 0) this.particles.render(ctx);
  }

  /** False when there is nothing to draw: the render loop can stop completely. */
  public needsFrames(): boolean {
    return this.entries.length > 0 || this.particles.getParticleCount() > 0;
  }

  public targetFps(): number {
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
  }
}
