/**
 * Headless smoke test: runs every companion through idle, pick-up, throw, landing and event
 * reactions with a fake clock and a no-op canvas context, and checks nothing throws, nothing
 * goes NaN, and a thrown companion always comes back to rest inside the stage.
 */
import { Stage, CompanionName, Companion } from '../src/renderer/Stage';

let clock = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
(globalThis as unknown as { window: unknown }).window = { matchMedia: () => ({ matches: false }) };

const gradient = { addColorStop: () => undefined };
const ctx = new Proxy({} as Record<string, unknown>, {
  get: (t, p: string) => {
    if (p in t) return t[p];
    if (p === 'measureText') return () => ({ width: 10 });
    if (p.startsWith('create')) return () => gradient;
    if (p === 'canvas') return { width: 1440, height: 800 };
    return () => undefined;
  },
  set: (t, p: string, v) => { t[p] = v; return true; },
}) as unknown as CanvasRenderingContext2D;

const W = 1440, H = 800, DT = 1 / 60;
const NAMES: CompanionName[] = ['cat', 'fox', 'ghost', 'robot', 'webhero'];
let failures = 0;
const check = (ok: boolean, msg: string): void => { if (!ok) { failures++; console.error('  FAIL', msg); } };

function step(stage: Stage, frames: number, dt = DT): void {
  for (let i = 0; i < frames; i++) {
    clock += dt * 1000;
    stage.update(dt);
    stage.render(ctx);
  }
}

function findHit(c: Companion): { x: number; y: number } | null {
  for (let dy = 0; dy >= -140; dy -= 6) {
    for (let dx = -60; dx <= 60; dx += 6) {
      if (c.containsPoint(c.x + dx, c.y + dy)) return { x: c.x + dx, y: c.y + dy };
    }
  }
  return null;
}

function finite(c: Companion): boolean {
  return Number.isFinite(c.x) && Number.isFinite(c.y);
}

for (const name of NAMES) {
  console.log(`# ${name}`);
  const stage = new Stage();
  stage.resize(W, H);
  stage.setCompanions([name]);
  const c = stage.list()[0];

  step(stage, 180); // idle / wander
  check(finite(c), 'finite after idle');

  const hit = findHit(c);
  check(hit !== null, 'has a clickable hit area');
  if (!hit) continue;

  check(c.pointerDown(hit.x, hit.y), 'pointerDown accepted');
  // drag in an arc to the upper right, fast, then release mid-motion = throw
  let px = hit.x, py = hit.y;
  for (let i = 0; i < 14; i++) {
    px += 38; py -= 22;
    clock += 16;
    c.pointerMove(px, py);
    stage.update(DT); stage.render(ctx);
  }
  check(c.isGrabbed(), 'grabbed while dragging');
  c.pointerUp();
  let airborne = false;
  for (let i = 0; i < 60; i++) { step(stage, 1); airborne ||= c.isAirborne(); }
  check(airborne, 'airborne after throw');
  check(stage.targetFps() === 60 || !c.isAirborne(), 'fps tier is ACTIVE while airborne');

  step(stage, 60 * 8); // let it fly / land / settle
  check(finite(c), 'finite after throw');
  check(c.x >= 0 && c.x <= W, `x inside stage (${c.x.toFixed(0)})`);
  check(c.y >= 0 && c.y <= H + 1, `y inside stage (${c.y.toFixed(0)})`);
  check(!c.isAirborne(), 'came to rest (not airborne after 8s)');

  // plain click (no movement) must not blow up
  const hit2 = findHit(c);
  if (hit2) { c.pointerDown(hit2.x, hit2.y); clock += 80; c.pointerUp(); step(stage, 120); }

  for (const ev of ['save', 'run', 'buildSuccess', 'buildError'] as const) {
    stage.trigger(ev); step(stage, 90);
  }
  check(finite(c), 'finite after events');
  console.log(`  state=${stage.states()[name]} x=${c.x.toFixed(0)} y=${c.y.toFixed(0)} fps-tier=${stage.targetFps()}`);
  stage.dispose();
}

console.log('# all five together');
{
  const stage = new Stage();
  stage.resize(W, H);
  stage.setCompanions(NAMES);
  step(stage, 60 * 20, 1 / 30); // 20 s at 30 fps
  stage.setCompanions(['cat']);
  check(stage.list().length === 1, 'removing companions works');
  stage.setCompanions([]);
  check(!stage.needsFrames() || stage.list().length === 0, 'empty stage');
  stage.resize(1920, 1000);
  stage.setCompanions(['fox']);
  step(stage, 120);
  check(stage.list().every(finite), 'resize + re-add ok');
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nALL OK');
