/**
 * Renderer entry. Glue between the overlay window (Electron) and the Stage (your companions).
 * The loop is demand-driven: it runs at a tiered frame rate and stops completely when there is
 * nothing to draw, the window is hidden, or the app is paused.
 */
import type { OverlayApi } from '../preload/preload';
import { LivingEventType } from '../core/types';
import { selectSingleCompanion } from '../core/settings';
import { FPS_SLEEP, Stage } from './Stage';
import { OverlayPointerHost } from './OverlayPointerHost';

declare global {
  interface Window { overlay: OverlayApi }
}

const api = window.overlay;
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let stage = new Stage();

let dpr = 1;
let paused = false;
let running = false;
let last = 0;
let timer: number | undefined;
let raf = 0;
let framesSince = 0;
let telemetryAt = performance.now();
let consecutiveFrameErrors = 0;
let companionNames: string[] = [];

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

function debugLog(event: string, details: Record<string, unknown> = {}): void {
  if (!DEBUG) return;
  const message = `[${new Date().toISOString()}] [renderer] ${event} ${JSON.stringify(details)}`;
  console.info(message);
  api.debugLog(message);
}

function stop(clearCanvas = true): void {
  debugLog('stop()', { running, paused, hidden: document.hidden, clearCanvas, companions: stage.list().length });
  running = false;
  if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  cancelAnimationFrame(raf);
  if (clearCanvas) clear();
}

function wake(): void {
  debugLog('wake()', { running, paused, hidden: document.hidden, companions: stage.list().length });
  if (running || paused || document.hidden) return;
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(loop);
}

function loop(): void {
  try {
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
  consecutiveFrameErrors = 0;
  framesSince++;

  if (!stage.needsFrames() || paused || document.hidden) { stop(!document.hidden); return; }

  const delay = interval - (performance.now() - now);
  if (delay > 8) {
    timer = window.setTimeout(() => { timer = undefined; raf = requestAnimationFrame(loop); }, delay - 8);
  } else {
    raf = requestAnimationFrame(loop);
  }
  } catch (error) {
    consecutiveFrameErrors++;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error('[renderer] frame error', consecutiveFrameErrors, message);
    api.frameError(`${consecutiveFrameErrors}/5 consecutive frame errors: ${message}`);
    if (consecutiveFrameErrors >= 5) {
      host.release();
      stage.dispose();
      stage = new Stage();
      stage.resize(window.innerWidth, window.innerHeight);
      stage.setCompanions(companionNames);
      consecutiveFrameErrors = 0;
      stop();
      wake();
    } else {
      raf = requestAnimationFrame(loop);
    }
  }
}

const host = new OverlayPointerHost(
  canvas,
  () => stage.list(),
  {
    setInteractive: (v) => api.setInteractive(v),
    setGrabbed: (v) => api.setGrabbed(v),
    openMenu: () => api.openMenu(),
  },
  (c) => stage.bringToFront(c),
  wake,
);

api.onCompanions((names) => {
  debugLog('companions:set', { names });
  companionNames = [selectSingleCompanion(names)];
  stage.setCompanions(companionNames);
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
document.addEventListener('visibilitychange', () => {
  debugLog('visibilitychange', { hidden: document.hidden });
  if (document.hidden) stop(false); else wake();
});
api.onDisplayChange(() => {
  host.release();
  resize();
  api.setInteractive(false);
});

resize();
api.ready();
