/**
 * CompanionPhysics
 * Tiny, dependency-free physics helpers for picking up / throwing companions.
 * Everything is frame-rate independent (real dt, fixed sub-steps) and every
 * tunable lives in `DEFAULT_PHYSICS_CONFIG`.
 *
 * Coordinates are canvas coordinates: +x right, +y DOWN.
 * `floorY` is the y the body's reference point (pelvis) rests at.
 */

export interface PhysicsConfig {
  /** Gravity in px/s² for a scale-1 companion (scaled with companion size). */
  gravity: number;
  /** Max fall speed in px/s (scaled with companion size). */
  terminalVelocity: number;
  /** Light air drag, 1/s. */
  airDrag: number;
  /** Floor bounce (0 = dead stop, 1 = perfectly elastic). */
  restitution: number;
  /** Wall bounce. */
  wallRestitution: number;
  /** Ceiling bounce. */
  ceilingRestitution: number;
  /** Fraction of horizontal speed lost on every floor impact. */
  contactFriction: number;
  /** Horizontal speed decay while sliding on the floor, 1/s. */
  slideFriction: number;
  /** Throw speed cap in px/s. */
  maxThrowSpeed: number;
  /** Multiplier applied to the measured pointer velocity on release. */
  throwGain: number;
  /** Pointer samples older than this (ms) are ignored when throwing. */
  throwWindowMs: number;
  /** Impacts slower than this (px/s, scaled) do not bounce. */
  bounceThreshold: number;
  /** Impact speed (px/s, scaled) that counts as a "heavy" landing. */
  heavyImpactSpeed: number;
  /** Largest integration sub-step in seconds. */
  maxSubStep: number;
}

export const DEFAULT_PHYSICS_CONFIG: Readonly<PhysicsConfig> = {
  gravity: 1350,
  terminalVelocity: 1700,
  airDrag: 0.22,
  restitution: 0.36,
  wallRestitution: 0.5,
  ceilingRestitution: 0.25,
  contactFriction: 0.14,
  slideFriction: 7,
  maxThrowSpeed: 2200,
  throwGain: 1,
  throwWindowMs: 100,
  bounceThreshold: 190,
  heavyImpactSpeed: 760,
  maxSubStep: 1 / 120,
};

export interface PhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PhysicsWorld {
  minX: number;
  maxX: number;
  floorY: number;
  ceilY: number;
}

export interface PhysicsContacts {
  /** Fastest downward speed at a floor hit this step (0 = no hit). */
  floorImpact: number;
  /** Fastest wall hit this step (0 = no hit). */
  wallImpact: number;
  /** -1 = hit the right wall, 1 = hit the left wall, 0 = none. */
  wallSide: number;
  ceilingImpact: number;
  /** True once the body is resting on the floor (no more bounce). */
  settled: boolean;
}

/** Advance a body by `dt` seconds (sub-stepped). */
export function stepPhysics(
  body: PhysicsBody,
  world: PhysicsWorld,
  cfg: PhysicsConfig,
  dt: number,
  scale: number
): PhysicsContacts {
  const out: PhysicsContacts = { floorImpact: 0, wallImpact: 0, wallSide: 0, ceilingImpact: 0, settled: false };
  const g = cfg.gravity * scale;
  const vMaxFall = cfg.terminalVelocity * scale;
  let remaining = Math.max(0, dt);

  while (remaining > 1e-6) {
    const h = Math.min(remaining, cfg.maxSubStep);
    remaining -= h;

    body.vy = Math.min(body.vy + g * h, vMaxFall);
    const drag = Math.exp(-cfg.airDrag * h);
    body.vx *= drag;
    body.vy *= drag;
    body.x += body.vx * h;
    body.y += body.vy * h;

    if (body.x < world.minX) {
      body.x = world.minX;
      if (body.vx < 0) {
        const v = -body.vx;
        if (v > out.wallImpact) { out.wallImpact = v; out.wallSide = 1; }
        body.vx = v * cfg.wallRestitution;
      }
    } else if (body.x > world.maxX) {
      body.x = world.maxX;
      if (body.vx > 0) {
        const v = body.vx;
        if (v > out.wallImpact) { out.wallImpact = v; out.wallSide = -1; }
        body.vx = -v * cfg.wallRestitution;
      }
    }

    if (body.y < world.ceilY) {
      body.y = world.ceilY;
      if (body.vy < 0) {
        out.ceilingImpact = Math.max(out.ceilingImpact, -body.vy);
        body.vy = -body.vy * cfg.ceilingRestitution;
      }
    }

    if (body.y >= world.floorY) {
      body.y = world.floorY;
      if (body.vy > 0) {
        const impact = body.vy;
        out.floorImpact = Math.max(out.floorImpact, impact);
        body.vx *= 1 - cfg.contactFriction;
        if (cfg.restitution <= 0 || impact < cfg.bounceThreshold * scale) {
          body.vy = 0;
          out.settled = true;
          break;
        }
        body.vy = -impact * cfg.restitution;
      }
    }
  }
  return out;
}

/** Horizontal friction while sliding on the floor. Returns the new vx. */
export function applyFloorFriction(vx: number, cfg: PhysicsConfig, dt: number): number {
  return vx * Math.exp(-cfg.slideFriction * dt);
}

export interface PointerSample {
  x: number;
  y: number;
  t: number; // ms
}

/**
 * Release velocity from recent pointer samples. Only the last `throwWindowMs`
 * count, and a pointer that stopped before release yields a plain drop.
 */
export function throwVelocity(
  samples: readonly PointerSample[],
  nowMs: number,
  cfg: PhysicsConfig
): { vx: number; vy: number } {
  const recent = samples.filter((p) => nowMs - p.t <= cfg.throwWindowMs);
  if (recent.length < 2) {
    return { vx: 0, vy: 0 };
  }
  const a = recent[0];
  const b = recent[recent.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt < 0.012 || nowMs - b.t > 60) {
    return { vx: 0, vy: 0 };
  }
  let vx = ((b.x - a.x) / dt) * cfg.throwGain;
  let vy = ((b.y - a.y) / dt) * cfg.throwGain;
  const speed = Math.hypot(vx, vy);
  if (speed > cfg.maxThrowSpeed) {
    const k = cfg.maxThrowSpeed / speed;
    vx *= k;
    vy *= k;
  }
  return { vx, vy };
}
