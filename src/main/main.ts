/**
 * Main process.
 *
 * One transparent, click-through, non-focusable overlay window covers the work area of
 * one display (work area = screen minus Dock/taskbar/menu bar). The renderer runs your
 * companions inside it with their original canvas physics; the floor of the physics
 * world is the bottom of the work area, so they stand on the Dock / taskbar.
 *
 * The window is click-through everywhere except on a companion's own pixels: the renderer
 * hit-tests the cursor and asks us to toggle `setIgnoreMouseEvents`.
 */
import {
  app, BrowserWindow, Display, Menu, MenuItemConstructorOptions, Tray, ipcMain, nativeImage, screen,
  shell, powerMonitor,
} from 'electron';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { COMPANION_NAMES, DEFAULT_SETTINGS, parseSettings, type CompanionName, type Settings } from '../core/settings';

type LivingEvent = 'save' | 'run' | 'buildSuccess' | 'buildError';

const LABELS: Record<CompanionName, string> = {
  cat: 'Cat', fox: 'Fox', ghost: 'Ghost', robot: 'Robot', webhero: 'Web Hero',
};
const COMPANIONS = COMPANION_NAMES.map((id) => ({ id, label: LABELS[id] }));

const DEBUG = process.argv.includes('--debug') || process.env.COMPANION_DESK_DEBUG === '1';

if (!app.requestSingleInstanceLock()) {
  process.exit(0);
}

/* ------------------------------- settings ------------------------------- */

let settings: Settings = { ...DEFAULT_SETTINGS };
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');
const logFile = (): string => path.join(app.getPath('userData'), 'logs', 'main.log');

function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error ?? '');
  const line = `[${new Date().toISOString()}] ERROR ${message}${detail ? `: ${detail}` : ''}\n`;
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > 1024 * 1024) {
      const previous = `${file}.1`;
      if (fs.existsSync(previous)) fs.unlinkSync(previous);
      fs.renameSync(file, previous);
    }
    fs.appendFileSync(file, line);
  } catch { /* keep the app running if logging itself fails */ }
  console.error(line.trim());
}

process.on('uncaughtException', (error) => {
  logError('uncaught exception', error);
  app.quit();
});
process.on('unhandledRejection', (reason) => logError('unhandled rejection', reason));

function loadSettings(): void {
  try {
    settings = parseSettings(fs.readFileSync(settingsFile(), 'utf8'));
  } catch (error) {
    logError('could not load settings; using defaults', error);
    settings = { ...DEFAULT_SETTINGS };
  }
  const debugCompanion = process.env.COMPANION_DESK_DEBUG_COMPANION;
  if (DEBUG && COMPANION_NAMES.includes(debugCompanion as CompanionName)) {
    settings.companion = debugCompanion as CompanionName;
  }
}

function saveSettings(): void {
  const file = settingsFile();
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    logError('could not save settings', error);
  }
}

/* -------------------------------- overlay -------------------------------- */

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let foregroundAppBundleId: string | null = null;
let companionGrabbed = false;
let recreatingOverlay = false;
const suspendReasons = new Set<string>();
let fullscreenWatcher: ReturnType<typeof spawn> | null = null;

function currentForegroundAppBundleId(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const script = 'ObjC.import("AppKit"); const app = $.NSWorkspace.sharedWorkspace.frontmostApplication; app ? ObjC.unwrap(app.bundleIdentifier) + "|" + app.processIdentifier : ""';
    const result = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
      encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const [bundleId, pid] = result.split('|');
    if (!bundleId || bundleId === 'undefined' || Number(pid) === process.pid) return null;
    return bundleId;
  } catch (error) {
    console.warn('could not read foreground app', error);
    return null;
  }
}

function restoreForegroundApp(): void {
  if (process.platform !== 'darwin' || !foregroundAppBundleId) return;
  const child = spawn('/usr/bin/open', ['-b', foregroundAppBundleId], {
    detached: true, stdio: 'ignore',
  });
  child.on('error', (error) => console.warn('could not restore foreground app', error));
  child.unref();
}

function targetDisplay(): Display {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === settings.displayId) ?? screen.getPrimaryDisplay();
}

function debugWindowEvent(overlay: BrowserWindow, event: string): void {
  if (!DEBUG) return;
  console.log(`[${new Date().toISOString()}] [main] window ${event} visible=${overlay.isVisible()}`);
}

function createOverlay(): void {
  const wa = targetDisplay().workArea;

  const overlay = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#00000000',
    // Never take keyboard focus from the app you are typing in. On macOS BOTH are needed:
    // a non-activating panel AND focusable:false (Chromium also tries to focus on click).
    focusable: false,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: true,
    },
  });
  win = overlay;
  overlay.setFocusable(false);

  overlay.on('show', () => debugWindowEvent(overlay, 'show'));
  overlay.on('hide', () => debugWindowEvent(overlay, 'hide'));
  overlay.on('blur', () => debugWindowEvent(overlay, 'blur'));
  overlay.on('focus', () => debugWindowEvent(overlay, 'focus'));
  overlay.webContents.on('did-stop-loading', () => debugWindowEvent(overlay, 'did-stop-loading'));

  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') app.dock?.hide(); // after setVisibleOnAllWorkspaces
  void overlay.loadFile(path.join(__dirname, 'index.html'), {
    query: DEBUG ? { debug: '1' } : undefined,
  });
  overlay.once('ready-to-show', () => {
    if (!settings.paused && suspendReasons.size === 0) overlay.showInactive();
  });
  overlay.on('closed', () => { if (win === overlay) win = null; });
  overlay.on('unresponsive', () => recreateOverlay('overlay window became unresponsive'));
  overlay.webContents.on('render-process-gone', (_event, details) => {
    recreateOverlay(`renderer process exited: ${details.reason}`);
  });
}

function recreateOverlay(reason: string): void {
  if (recreatingOverlay) return;
  recreatingOverlay = true;
  logError(reason);
  const old = win;
  win = null;
  if (old && !old.isDestroyed()) old.destroy();
  createOverlay();
  recreatingOverlay = false;
}

function placeOverlay(): void {
  if (!win || win.isDestroyed()) return;
  win.setBounds(targetDisplay().workArea);
}

const send = (channel: string, ...args: unknown[]): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};

function applyCompanions(): void {
  saveSettings();
  send('companions:set', [settings.companion]);
  refreshMenu();
}

function selectCompanion(id: CompanionName): void {
  settings.companion = id;
  applyCompanions();
}

function setPaused(paused: boolean): void {
  settings.paused = paused;
  saveSettings();
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(true, { forward: true });
    if (paused || suspendReasons.size > 0) win.hide();
    else win.showInactive();
  }
  send('overlay:pause', paused || suspendReasons.size > 0);
  refreshMenu();
}

function setDisplay(id: number): void {
  settings.displayId = id;
  saveSettings();
  placeOverlay();
  refreshMenu();
}

/* ---------------------------------- menu --------------------------------- */

function buildMenu(): Menu {
  const displays = screen.getAllDisplays();
  const target = targetDisplay();

  const template: MenuItemConstructorOptions[] = [
    { label: 'Companions', enabled: false },
    ...COMPANIONS.map((c): MenuItemConstructorOptions => ({
      label: c.label,
      type: 'radio',
      checked: settings.companion === c.id,
      click: () => selectCompanion(c.id),
    })),
    { type: 'separator' },
    {
      label: 'Trigger reaction',
      enabled: !settings.paused,
      submenu: ([
        ['Save', 'save'], ['Run', 'run'], ['Build success', 'buildSuccess'], ['Build error', 'buildError'],
      ] as Array<[string, LivingEvent]>).map(([label, ev]): MenuItemConstructorOptions => ({
        label, click: () => send('companions:event', ev),
      })),
    },
  ];

  if (displays.length > 1) {
    template.push({
      label: 'Display',
      submenu: displays.map((d, i): MenuItemConstructorOptions => ({
        label: `Display ${i + 1} (${d.bounds.width}×${d.bounds.height})`,
        type: 'radio',
        checked: d.id === target.id,
        click: () => setDisplay(d.id),
      })),
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: settings.paused ? 'Resume' : 'Pause (hide)',
      click: () => setPaused(!settings.paused),
    },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      label: 'Show log',
      click: () => {
        try {
          fs.mkdirSync(path.dirname(logFile()), { recursive: true });
          if (!fs.existsSync(logFile())) fs.writeFileSync(logFile(), '');
          void shell.openPath(logFile()).then((error) => { if (error) logError('could not open log', error); });
        } catch (error) { logError('could not open log', error); }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  );
  return Menu.buildFromTemplate(template);
}

function refreshMenu(): void {
  try { tray?.setContextMenu(buildMenu()); }
  catch (error) { logError('could not refresh tray menu', error); }
}

/* ---------------------------------- boot --------------------------------- */

ipcMain.on('overlay:ready', () => {
  send('companions:set', [settings.companion]);
  send('overlay:pause', settings.paused || suspendReasons.size > 0);
});

ipcMain.on('overlay:interactive', (_e, interactive: boolean) => {
  if (!win || win.isDestroyed()) return;
  if (interactive && !companionGrabbed) foregroundAppBundleId = currentForegroundAppBundleId();
  if (!interactive && !companionGrabbed) foregroundAppBundleId = null;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('overlay:grab', (_e, grabbed: boolean) => {
  if (grabbed) {
    if (!companionGrabbed && !foregroundAppBundleId) foregroundAppBundleId = currentForegroundAppBundleId();
    companionGrabbed = true;
    return;
  }
  if (!companionGrabbed) return;
  companionGrabbed = false;
  restoreForegroundApp();
});

ipcMain.on('overlay:menu', () => {
  if (!win || win.isDestroyed()) return;
  if (!foregroundAppBundleId) foregroundAppBundleId = currentForegroundAppBundleId();
  buildMenu().popup({
    window: win,
    callback: () => restoreForegroundApp(),
  });
});

ipcMain.on('overlay:telemetry', (_e, t: unknown) => {
  if (!DEBUG) return;
  const cpu = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
  console.log(`[debug] cpu=${cpu.toFixed(1)}%`, JSON.stringify(t));
});
ipcMain.on('overlay:frame-error', (_e, message: string) => logError('renderer frame error', message));
ipcMain.on('overlay:debug-log', (_e, message: string) => {
  if (DEBUG) console.log(message);
});

function setSuspendReason(reason: string, active: boolean): void {
  if (active) suspendReasons.add(reason);
  else suspendReasons.delete(reason);
  const suspended = suspendReasons.size > 0;
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(true, { forward: true });
    if (suspended || settings.paused) win.hide();
    else win.showInactive();
  }
  send('overlay:pause', suspended || settings.paused);
}

function onDisplaysChanged(): void {
  const displays = screen.getAllDisplays();
  if (settings.displayId !== null && !displays.some((d) => d.id === settings.displayId)) {
    settings.displayId = screen.getPrimaryDisplay().id;
    saveSettings();
  }
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
  placeOverlay();
  send('overlay:display-change');
  refreshMenu();
}

function startWindowsFullscreenWatcher(): void {
  const monitorPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'windows-fullscreen-monitor.ps1')
    : path.join(app.getAppPath(), 'scripts', 'windows-fullscreen-monitor.ps1');
  fullscreenWatcher = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', monitorPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  fullscreenWatcher.stdout?.setEncoding('utf8');
  fullscreenWatcher.stdout?.on('data', (chunk: string) => {
    output += chunk;
    const lines = output.split(/\r?\n/);
    output = lines.pop() ?? '';
    for (const line of lines) {
      if (line === 'fullscreen' || line === 'normal') setSuspendReason('fullscreen-app', line === 'fullscreen');
    }
  });
  fullscreenWatcher.stderr?.on('data', (chunk: Buffer) => logError('fullscreen monitor', chunk.toString()));
  fullscreenWatcher.on('error', (error) => logError('could not start fullscreen monitor', error));
}

app.whenReady().then(() => {
  loadSettings();
  createOverlay();

  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Companions');
  refreshMenu();

  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  powerMonitor.on('suspend', () => setSuspendReason('suspend', true));
  powerMonitor.on('resume', () => { setSuspendReason('suspend', false); onDisplaysChanged(); });
  powerMonitor.on('lock-screen', () => setSuspendReason('lock-screen', true));
  powerMonitor.on('unlock-screen', () => {
    setSuspendReason('lock-screen', false);
    onDisplaysChanged();
  });
  if (process.platform === 'win32') startWindowsFullscreenWatcher();

  if (DEBUG) {
    // Ask the renderer for a snapshot every 5 s; main adds CPU and logs it.
    setInterval(() => send('overlay:telemetry-request'), 5000);
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { fullscreenWatcher?.kill(); });
