/**
 * Renderer entry. Glue between the overlay window (Electron) and the Stage (your companions).
 * The loop is demand-driven: it runs at a tiered frame rate and stops completely when there is
 * nothing to draw, the window is hidden, or the app is paused.
 */
import type { OverlayApi } from '../preload/preload';
import { LivingEventType } from '../core/types';
import { FPS_SLEEP, Stage } from './Stage';
import { OverlayPointerHost } from './OverlayPointerHost';

declare global {
  interface Window { overlay: OverlayApi }
}

const api = window.overlay;
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = new Stage();

let dpr = 1;
let paused = false;
let running = false;
let last = 0;
let timer: number | undefined;
let raf = 0;
let framesSince = 0;
let telemetryAt = performance.now();

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  stage.resize(w, h);
  wake();
}

function clear(): void {
  ctx.clearRect(0, 0, stage.bounds.width, stage.bounds.height);
}

function stop(): void {
  running = false;
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  cancelAnimationFrame(raf);
  clear();
}

function wake(): void {
  console.info('[renderer] wake', JSON.stringify({ running, paused, hidden: document.hidden, companions: stage.list().length }));
  if (running || paused || document.hidden) return;
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(loop);
}

function loop(): void {
  const now = performance.now();
  const fps = stage.targetFps();
  const interval = 1000 / fps;

  // At 60 fps on a 120 Hz display, skip the in-between vsync instead of running double speed.
  if (interval < 20 && now - last < interval - 4) { raf = requestAnimationFrame(loop); return; }

  const dt = Math.min((now - last) / 1000, fps <= FPS_SLEEP ? 0.1 : 0.05);
  last = now;

  stage.update(dt);
  host.recheck();
  clear();
  stage.render(ctx);
  framesSince++;

  if (!stage.needsFrames() || paused || document.hidden) { stop(); return; }

  const delay = interval - (performance.now() - now);
  if (delay > 8) {
    timer = window.setTimeout(() => { timer = undefined; raf = requestAnimationFrame(loop); }, delay - 8);
  } else {
    raf = requestAnimationFrame(loop);
  }
}

const host = new OverlayPointerHost(
  canvas,
  () => stage.list(),
  { setInteractive: (v) => api.setInteractive(v), openMenu: () => api.openMenu() },
  (c) => stage.bringToFront(c),
  wake,
);

api.onCompanions((names) => {
  console.info('[renderer] companions:set', JSON.stringify(names));
  stage.setCompanions(names);
  wake();
});
api.onEvent((name) => { stage.trigger(name as LivingEventType); wake(); });
api.onPause((p) => {
  paused = p;
  if (p) { host.release(); stop(); } else { wake(); }
});
api.onTelemetryRequest(() => {
  const now = performance.now();
  const secs = (now - telemetryAt) / 1000;
  api.telemetry({ fps: +(framesSince / secs).toFixed(1), states: stage.states(), running });
  framesSince = 0;
  telemetryAt = now;
});

window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else wake(); });

resize();
api.ready();
