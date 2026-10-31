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
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type CompanionName = 'cat' | 'fox' | 'ghost' | 'robot' | 'webhero';
type LivingEvent = 'save' | 'run' | 'buildSuccess' | 'buildError';

const COMPANIONS: ReadonlyArray<{ id: CompanionName; label: string }> = [
  { id: 'cat', label: 'Cat' },
  { id: 'fox', label: 'Fox' },
  { id: 'ghost', label: 'Ghost' },
  { id: 'robot', label: 'Robot' },
  { id: 'webhero', label: 'Web Hero' },
];

interface Settings {
  companions: CompanionName[];
  displayId: number | null;
  paused: boolean;
}

const DEBUG = process.argv.includes('--debug');
const DEFAULTS: Settings = { companions: ['cat'], displayId: null, paused: false };

if (!app.requestSingleInstanceLock()) {
  process.exit(0);
}

/* ------------------------------- settings ------------------------------- */

let settings: Settings = { ...DEFAULTS };
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');

function loadSettings(): void {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings must contain a JSON object');
    }
    const raw = parsed as Partial<Settings>;
    const valid = new Set(COMPANIONS.map((c) => c.id));
    const companions = Array.isArray(raw.companions)
      ? raw.companions.filter((c): c is CompanionName => valid.has(c as CompanionName))
      : [...DEFAULTS.companions];
    settings = {
      // An empty or fully invalid saved selection should never leave the app blank on launch.
      companions: companions.length ? companions : [...DEFAULTS.companions],
      displayId: typeof raw.displayId === 'number' ? raw.displayId : null,
      paused: raw.paused === true,
    };
  } catch (error) {
    console.warn('could not load settings; using defaults', error);
    settings = { ...DEFAULTS, companions: [...DEFAULTS.companions] };
  }
}

function saveSettings(): void {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('could not save settings', e);
  }
}

/* -------------------------------- overlay -------------------------------- */

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function targetDisplay(): Display {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === settings.displayId) ?? screen.getPrimaryDisplay();
}

function createOverlay(): void {
  const wa = targetDisplay().workArea;

  win = new BrowserWindow({
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
    acceptFirstMouse: true,
    // Never take keyboard focus from the app you are typing in. On macOS BOTH are needed:
    // a non-activating panel AND focusable:false (Chromium also tries to focus on click).
    focusable: false,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setFocusable(false);

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') app.dock?.hide(); // after setVisibleOnAllWorkspaces
  void win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    if (!settings.paused) win?.showInactive();
  });
  win.on('closed', () => { win = null; });
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
  send('companions:set', settings.companions);
  refreshMenu();
}

function toggleCompanion(id: CompanionName): void {
  const on = settings.companions.includes(id);
  settings.companions = on ? settings.companions.filter((c) => c !== id) : [...settings.companions, id];
  applyCompanions();
}

function resetToCat(): void {
  settings.companions = ['cat'];
  applyCompanions();
}

function setPaused(paused: boolean): void {
  settings.paused = paused;
  saveSettings();
  if (win && !win.isDestroyed()) {
    if (paused) win.hide();
    else win.showInactive();
  }
  send('overlay:pause', paused);
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
      type: 'checkbox',
      checked: settings.companions.includes(c.id),
      click: () => toggleCompanion(c.id),
    })),
    { label: 'Reset to cat', click: resetToCat },
    { type: 'separator' },
    {
      label: 'Trigger reaction',
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
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  );
  return Menu.buildFromTemplate(template);
}

function refreshMenu(): void {
  tray?.setContextMenu(buildMenu());
}

/* ---------------------------------- boot --------------------------------- */

ipcMain.on('overlay:ready', () => {
  send('companions:set', settings.companions);
  send('overlay:pause', settings.paused);
});

ipcMain.on('overlay:interactive', (_e, interactive: boolean) => {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('overlay:menu', () => {
  if (win && !win.isDestroyed()) buildMenu().popup({ window: win });
});

ipcMain.on('overlay:telemetry', (_e, t: unknown) => {
  if (!DEBUG) return;
  const cpu = app.getAppMetrics().reduce((n, m) => n + m.cpu.percentCPUUsage, 0);
  console.log(`[debug] cpu=${cpu.toFixed(1)}%`, JSON.stringify(t));
});

app.whenReady().then(() => {
  loadSettings();
  createOverlay();

  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Companions');
  refreshMenu();

  const onDisplaysChanged = (): void => {
    // If the saved display was unplugged, targetDisplay() falls back to the primary one.
    placeOverlay();
    refreshMenu();
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  if (DEBUG) {
    // Ask the renderer for a snapshot every 5 s; main adds CPU and logs it.
    setInterval(() => send('overlay:telemetry-request'), 5000);
  }
});

app.on('window-all-closed', () => app.quit());
