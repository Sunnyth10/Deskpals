/**
 * Main process.
 *
 * Owns:
 * - Transparent, click-through overlay window (companions)
 * - Dashboard window (Wellness + Stats + Pet + Reminders + Settings)
 * - Reminder Scheduler & Health Nudges (breaks, water)
 * - Focus Mode & Distraction Monitor
 * - Daily Stats Store & Settings Persistence
 */
import {
  app,
  BrowserWindow,
  Display,
  Menu,
  MenuItemConstructorOptions,
  Tray,
  ipcMain,
  nativeImage,
  screen,
  shell,
  powerMonitor,
  Notification,
} from 'electron';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  COMPANION_NAMES,
  DEFAULT_SETTINGS,
  parseSettings,
  type CompanionName,
  type DashboardTab,
  type Settings,
} from '../core/settings';
import {
  calculateNextOccurrence,
  isCountdownActive,
  type ReminderItem,
} from '../core/reminders';
import {
  formatDateKey,
  getLast7Days,
  buildHeatmapGrid,
  calculateCompanionDays,
  type DailyStats,
} from '../core/stats';
import { IPC_CHANNELS, type FocusStatus, type SpeechBubbleMessage } from '../shared/ipc-channels';
import { t } from '../core/i18n';

type LivingEvent = 'save' | 'run' | 'buildSuccess' | 'buildError';

const LABELS: Record<CompanionName, string> = {
  cat: 'Cat',
  fox: 'Fox',
  ghost: 'Ghost',
  robot: 'Robot',
  webhero: 'Web Hero',
};
const COMPANIONS = COMPANION_NAMES.map((id) => ({ id, label: LABELS[id] }));

const DEBUG = process.argv.includes('--debug') || process.env.COMPANION_DESK_DEBUG === '1';

if (!app.requestSingleInstanceLock()) {
  process.exit(0);
}

/* ------------------------------- settings & logs ------------------------------- */

let settings: Settings = { ...DEFAULT_SETTINGS };
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');
const statsFile = (): string => path.join(app.getPath('userData'), 'stats.json');
const logFile = (): string => path.join(app.getPath('userData'), 'logs', 'main.log');

function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error ?? '');
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
  } catch {
    /* keep the app running if logging fails */
  }
  console.error(line.trim());
}

process.on('uncaughtException', (error) => {
  logError('uncaught exception', error);
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
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* best effort */
    }
    logError('could not save settings', error);
  }
}

/* --------------------------------- stats store --------------------------------- */

let statsCache: Record<string, DailyStats> = {};

function loadStats(): void {
  try {
    const file = statsFile();
    if (fs.existsSync(file)) {
      statsCache = JSON.parse(fs.readFileSync(file, 'utf8'));
    } else {
      statsCache = {};
    }
  } catch (error) {
    logError('could not load stats; starting clean', error);
    statsCache = {};
  }
}

function saveStats(): void {
  const file = statsFile();
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(statsCache, null, 2));
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* best effort */
    }
    logError('could not save stats', error);
  }
}

function recordStat(type: 'breaks' | 'waters' | 'focusMinutes' | 'distractions', delta: number): void {
  const todayKey = formatDateKey(new Date());
  if (!statsCache[todayKey]) {
    statsCache[todayKey] = {
      date: todayKey,
      breaks: 0,
      waters: 0,
      focusMinutes: 0,
      distractions: 0,
    };
  }
  statsCache[todayKey][type] = Math.max(0, statsCache[todayKey][type] + delta);
  saveStats();

  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.webContents.send(IPC_CHANNELS.STATS_UPDATED);
  }
}

/* -------------------------------- overlay window -------------------------------- */

let win: BrowserWindow | null = null;
let dashboardWin: BrowserWindow | null = null;
let breakOverlayWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let foregroundAppBundleId: string | null = null;
let companionGrabbed = false;
let recreatingOverlay = false;
const suspendReasons = new Set<string>();
let fullscreenWatcher: ReturnType<typeof spawn> | null = null;

function currentForegroundAppInfo(): { bundleId: string | null; name: string | null } {
  if (process.platform === 'darwin') {
    try {
      const script =
        'ObjC.import("AppKit"); const app = $.NSWorkspace.sharedWorkspace.frontmostApplication; ' +
        'app ? ObjC.unwrap(app.bundleIdentifier) + "|" + ObjC.unwrap(app.localizedName) + "|" + app.processIdentifier : ""';
      const result = execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const [bundleId, name, pid] = result.split('|');
      if (!bundleId || bundleId === 'undefined' || Number(pid) === process.pid) {
        return { bundleId: null, name: null };
      }
      return { bundleId, name: name || bundleId };
    } catch {
      return { bundleId: null, name: null };
    }
  } else if (process.platform === 'win32') {
    try {
      const ps =
        'Add-Type @"\nusing System; using System.Runtime.InteropServices; using System.Text;\n' +
        'public class Win { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n' +
        '[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count); }\n' +
        '"@\n$h = [Win]::GetForegroundWindow(); $b = New-Object System.Text.StringBuilder 256; [Win]::GetWindowText($h, $b, 256) | Out-Null; $b.ToString()';
      const title = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return { bundleId: null, name: title || null };
    } catch {
      return { bundleId: null, name: null };
    }
  }
  return { bundleId: null, name: null };
}

function restoreForegroundApp(): void {
  if (process.platform !== 'darwin' || !foregroundAppBundleId) return;
  const child = spawn('/usr/bin/open', ['-b', foregroundAppBundleId], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (error) => console.warn('could not restore foreground app', error));
  child.unref();
}

function targetDisplay(): Display {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === settings.displayId) ?? screen.getPrimaryDisplay();
}

function sendOverlay(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function showCompanionBubble(msg: SpeechBubbleMessage): void {
  sendOverlay(IPC_CHANNELS.OVERLAY_BUBBLE, msg);
}

function triggerCompanionEnlarge(multiplier = 1.6, durationSeconds = 3.5): void {
  sendOverlay(IPC_CHANNELS.OVERLAY_ENLARGE, multiplier, durationSeconds);
}

function createOverlay(): void {
  const wa = targetDisplay().workArea;

  const overlay = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
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

  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === 'darwin') app.dock?.hide();

  void overlay.loadFile(path.join(__dirname, 'index.html'), {
    query: DEBUG ? { debug: '1' } : undefined,
  });

  overlay.once('ready-to-show', () => {
    if (!settings.paused && suspendReasons.size === 0) overlay.showInactive();
    sendOverlay(IPC_CHANNELS.SETTINGS_UPDATED, settings);
  });
  overlay.on('closed', () => {
    if (win === overlay) win = null;
  });
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

/* ------------------------------- dashboard window ------------------------------ */

function openDashboard(tab?: DashboardTab): void {
  if (tab) {
    settings.activeTab = tab;
    saveSettings();
  }

  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.show();
    dashboardWin.focus();
    dashboardWin.webContents.send(IPC_CHANNELS.SETTINGS_UPDATED, settings);
    return;
  }

  dashboardWin = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 680,
    minHeight: 500,
    title: 'DeskPals',
    backgroundColor: '#121316',
    titleBarStyle: 'hiddenInset',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'dashboardPreload.js'),
      contextIsolation: true,
      backgroundThrottling: true,
    },
  });

  dashboardWin.loadFile(path.join(__dirname, 'dashboard.html'));

  dashboardWin.once('ready-to-show', () => {
    dashboardWin?.show();
  });

  dashboardWin.on('closed', () => {
    dashboardWin = null;
  });
}

function openFullscreenBreak(): void {
  if (breakOverlayWin && !breakOverlayWin.isDestroyed()) return;

  const display = targetDisplay();
  breakOverlayWin = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    fullscreen: true,
    skipTaskbar: true,
    backgroundColor: '#121316ee',
    webPreferences: { contextIsolation: true },
  });

  const lang = settings.language;
  const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { margin:0; height:100vh; display:flex; flex-direction:column; align-items:center;
          justify-content:center; color:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,sans-serif;
          cursor:pointer; user-select:none; }
        h1 { font-size:32px; font-weight:800; color:#a855f7; margin-bottom:8px; }
        p { font-size:16px; color:#9ca3af; margin-bottom:24px; max-width:440px; text-align:center; line-height:1.5; }
        .dismiss-badge { font-size:12px; background:rgba(255,255,255,0.1); padding:6px 14px; border-radius:20px; color:#cbd5e1; }
      </style>
    </head>
    <body>
      <div style="font-size: 54px; margin-bottom: 12px;">🌿</div>
      <h1>${t('nudge_break_title', lang)}</h1>
      <p>${t('nudge_break_desc', lang)}</p>
      <div class="dismiss-badge">Click anywhere or press ESC to dismiss</div>
      <script>
        window.addEventListener('click', () => window.close());
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
      </script>
    </body>
    </html>
  `;

  breakOverlayWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

/* ---------------------------------- menu --------------------------------- */

function buildMenu(): Menu {
  const displays = screen.getAllDisplays();
  const target = targetDisplay();

  const template: MenuItemConstructorOptions[] = [
    {
      label: '🐾 Open DeskPals',
      click: () => openDashboard(settings.activeTab),
    },
    { type: 'separator' },
    { label: 'Companions', enabled: false },
    ...COMPANIONS.map((c): MenuItemConstructorOptions => ({
      label: c.label,
      type: 'radio',
      checked: settings.companion === c.id,
      click: () => {
        settings.companion = c.id;
        saveSettings();
        sendOverlay(IPC_CHANNELS.COMPANIONS_SET, [settings.companion]);
        sendOverlay(IPC_CHANNELS.SETTINGS_UPDATED, settings);
        refreshMenu();
      },
    })),
    { type: 'separator' },
    {
      label: 'Trigger reaction',
      enabled: !settings.paused,
      submenu: ([
        ['Save', 'save'],
        ['Run', 'run'],
        ['Build success', 'buildSuccess'],
        ['Build error', 'buildError'],
      ] as Array<[string, LivingEvent]>).map(([label, ev]): MenuItemConstructorOptions => ({
        label,
        click: () => sendOverlay('companions:event', ev),
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
        click: () => {
          settings.displayId = d.id;
          saveSettings();
          placeOverlay();
          refreshMenu();
        },
      })),
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: settings.paused ? 'Resume' : 'Pause (hide)',
      click: () => {
        settings.paused = !settings.paused;
        saveSettings();
        if (win && !win.isDestroyed()) {
          win.setIgnoreMouseEvents(true, { forward: true });
          if (settings.paused || suspendReasons.size > 0) win.hide();
          else win.showInactive();
        }
        sendOverlay(IPC_CHANNELS.OVERLAY_PAUSE, settings.paused || suspendReasons.size > 0);
        refreshMenu();
      },
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
          void shell.openPath(logFile()).then((error) => {
            if (error) logError('could not open log', error);
          });
        } catch (error) {
          logError('could not open log', error);
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  );
  return Menu.buildFromTemplate(template);
}

function refreshMenu(): void {
  try {
    tray?.setContextMenu(buildMenu());
  } catch (error) {
    logError('could not refresh tray menu', error);
  }
}

/* ------------------------ scheduler, nudges & focus ------------------------ */

const firedRemindersToday = new Set<string>();
let lastMidnightDate = formatDateKey(new Date());

let breakTimerMinutes = 0;
let waterTimerMinutes = 0;

// Focus session state
let focusActive = false;
let focusSessionEndTime = 0;
let focusTotalMinutes = 25;
let focusDistractions = 0;
let lastDistractionCheckTime = 0;

function broadcastFocusState(): void {
  const remaining = focusActive
    ? Math.max(0, Math.ceil((focusSessionEndTime - Date.now()) / (60 * 1000)))
    : 0;
  const payload: FocusStatus = {
    active: focusActive,
    minutesRemaining: remaining,
    totalSessionMinutes: focusTotalMinutes,
    currentDistractions: focusDistractions,
  };
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.webContents.send(IPC_CHANNELS.FOCUS_STATE_CHANGED, payload);
  }
}

function checkSchedulerTicker(): void {
  const now = new Date();
  const currentDateKey = formatDateKey(now);

  // Rollover fired list at midnight
  if (currentDateKey !== lastMidnightDate) {
    firedRemindersToday.clear();
    lastMidnightDate = currentDateKey;
  }

  // 1. Reminders evaluation
  let activeCountdownPayload: { taskName: string; minutesLeft: number; formattedTime: string } | null = null;

  for (const reminder of settings.reminders) {
    if (!reminder.enabled) continue;

    const nextDate = calculateNextOccurrence(reminder.time, now);
    const msUntil = nextDate.getTime() - now.getTime();
    const minsUntil = Math.ceil(msUntil / (60 * 1000));

    // Pet countdown check
    const countdown = isCountdownActive(reminder, now);
    if (countdown.active && !activeCountdownPayload) {
      activeCountdownPayload = {
        taskName: reminder.task,
        minutesLeft: countdown.minutesLeft,
        formattedTime: reminder.time,
      };
    }

    // Due check: within 0 to 45 seconds of scheduled time
    const fireKey = `${currentDateKey}_${reminder.id}_${reminder.time}`;
    if (minsUntil === 0 || (msUntil >= 0 && msUntil <= 45000)) {
      if (!firedRemindersToday.has(fireKey)) {
        firedRemindersToday.add(fireKey);

        // Show bubble on companion
        showCompanionBubble({
          id: `alert-${reminder.id}`,
          text: reminder.task,
          kind: 'alert',
          durationSeconds: settings.appearance.bubbleDurationSeconds,
          subtext: `Scheduled for ${reminder.time}`,
        });

        // Optional enlargement
        if (reminder.enlargeOnAlert) {
          triggerCompanionEnlarge(1.6, 4.0);
        }

        // Native notification fallback
        if (Notification.isSupported()) {
          new Notification({
            title: 'DeskPals Reminder',
            body: reminder.task,
            silent: false,
          }).show();
        }
      }
    }
  }

  sendOverlay(IPC_CHANNELS.OVERLAY_COUNTDOWN, activeCountdownPayload);
}

// Every minute tick: health nudges & focus check
function minuteTicker(): void {
  const lang = settings.language;

  // Break nudges
  if (settings.health.breakEnabled) {
    breakTimerMinutes++;
    if (breakTimerMinutes >= settings.health.breakIntervalMinutes) {
      breakTimerMinutes = 0;
      recordStat('breaks', 1);

      showCompanionBubble({
        id: `break-${Date.now()}`,
        text: t('nudge_break_title', lang),
        kind: 'break',
        durationSeconds: settings.appearance.bubbleDurationSeconds + 2,
        subtext: t('nudge_break_desc', lang),
      });

      if (settings.health.breakModeFullscreen) {
        openFullscreenBreak();
      }
    }
  }

  // Water nudges
  if (settings.health.waterEnabled) {
    waterTimerMinutes++;
    if (waterTimerMinutes >= settings.health.waterIntervalMinutes) {
      waterTimerMinutes = 0;
      recordStat('waters', 1);

      showCompanionBubble({
        id: `water-${Date.now()}`,
        text: t('nudge_water_title', lang),
        kind: 'water',
        durationSeconds: settings.appearance.bubbleDurationSeconds + 2,
        subtext: t('nudge_water_desc', lang),
      });
    }
  }

  // Focus mode countdown
  if (focusActive) {
    const now = Date.now();
    if (now >= focusSessionEndTime) {
      focusActive = false;
      recordStat('focusMinutes', focusTotalMinutes);
      showCompanionBubble({
        id: `focus-end-${now}`,
        text: 'Focus session complete! 🎉',
        kind: 'info',
        durationSeconds: 8,
        subtext: `Logged ${focusTotalMinutes} minutes of deep work.`,
      });
      if (Notification.isSupported()) {
        new Notification({
          title: 'DeskPals Focus Mode',
          body: `Focus session complete! Logged ${focusTotalMinutes} minutes.`,
        }).show();
      }
      broadcastFocusState();
    } else {
      broadcastFocusState();
    }
  }
}

// Focus distraction poller (every 4 seconds during active focus)
function checkDistractions(): void {
  if (!focusActive || !settings.focus.enabled) return;

  const now = Date.now();
  if (now - lastDistractionCheckTime < 15000) return; // 15 second debounce between distraction warnings

  const appInfo = currentForegroundAppInfo();
  const target = (appInfo.name || '').toLowerCase();
  if (!target) return;

  const isBlockedApp = settings.focus.blockedApps.some((a) => target.includes(a.toLowerCase()));
  const isBlockedKw = settings.focus.blockedKeywords.some((k) => target.includes(k.toLowerCase()));

  if (isBlockedApp || isBlockedKw) {
    lastDistractionCheckTime = now;
    focusDistractions++;
    recordStat('distractions', 1);

    showCompanionBubble({
      id: `distract-${now}`,
      text: t('nudge_distraction', settings.language),
      kind: 'alert',
      durationSeconds: 5,
      subtext: `Active window: ${appInfo.name}`,
    });

    broadcastFocusState();
  }
}

/* --------------------------------- IPC Handlers --------------------------------- */

ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, () => settings);

ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_e, partial: Partial<Settings>) => {
  settings = { ...settings, ...partial };
  saveSettings();
  sendOverlay(IPC_CHANNELS.SETTINGS_UPDATED, settings);
  sendOverlay(IPC_CHANNELS.COMPANIONS_SET, [settings.companion]);
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.webContents.send(IPC_CHANNELS.SETTINGS_UPDATED, settings);
  }
  refreshMenu();
  return settings;
});

ipcMain.handle(IPC_CHANNELS.STATS_GET, () => {
  const sevenDays = getLast7Days(statsCache, new Date());
  const heatmap = buildHeatmapGrid(statsCache, new Date());
  const companionDays = calculateCompanionDays(settings.firstLaunchDate, new Date());
  return { sevenDays, heatmap, companionDays };
});

ipcMain.handle(IPC_CHANNELS.STATS_RECORD, (_e, payload: { type: 'breaks' | 'waters' | 'focus' | 'distractions'; delta: number }) => {
  const mapKey = payload.type === 'focus' ? 'focusMinutes' : payload.type;
  recordStat(mapKey, payload.delta);
});

ipcMain.handle(IPC_CHANNELS.REMINDERS_GET, () => settings.reminders);

ipcMain.handle(IPC_CHANNELS.REMINDERS_SAVE, (_e, reminder: ReminderItem) => {
  const existingIdx = settings.reminders.findIndex((r) => r.id === reminder.id);
  if (existingIdx !== -1) {
    settings.reminders[existingIdx] = reminder;
  } else {
    settings.reminders.push(reminder);
  }
  saveSettings();
  return settings.reminders;
});

ipcMain.handle(IPC_CHANNELS.REMINDERS_DELETE, (_e, id: string) => {
  settings.reminders = settings.reminders.filter((r) => r.id !== id);
  saveSettings();
  return settings.reminders;
});

ipcMain.handle(IPC_CHANNELS.REMINDERS_TRIGGER, (_e, payload: { text: string; kind?: string }) => {
  showCompanionBubble({
    id: `test-${Date.now()}`,
    text: payload.text,
    kind: payload.kind as SpeechBubbleMessage['kind'],
    durationSeconds: settings.appearance.bubbleDurationSeconds,
  });
});

ipcMain.handle(IPC_CHANNELS.FOCUS_START, () => {
  focusActive = true;
  focusTotalMinutes = settings.focus.sessionDurationMinutes;
  focusSessionEndTime = Date.now() + focusTotalMinutes * 60 * 1000;
  focusDistractions = 0;
  lastDistractionCheckTime = 0;

  showCompanionBubble({
    id: `focus-start-${Date.now()}`,
    text: 'Focus session started! 🎯',
    kind: 'info',
    durationSeconds: 5,
    subtext: `${focusTotalMinutes} minutes of focused work ahead.`,
  });

  broadcastFocusState();
  return {
    active: true,
    minutesRemaining: focusTotalMinutes,
    totalSessionMinutes: focusTotalMinutes,
    currentDistractions: 0,
  };
});

ipcMain.handle(IPC_CHANNELS.FOCUS_STOP, () => {
  focusActive = false;
  broadcastFocusState();
  return {
    active: false,
    minutesRemaining: 0,
    totalSessionMinutes: focusTotalMinutes,
    currentDistractions: focusDistractions,
  };
});

ipcMain.handle(IPC_CHANNELS.FOCUS_STATUS, () => {
  const remaining = focusActive
    ? Math.max(0, Math.ceil((focusSessionEndTime - Date.now()) / (60 * 1000)))
    : 0;
  return {
    active: focusActive,
    minutesRemaining: remaining,
    totalSessionMinutes: focusTotalMinutes,
    currentDistractions: focusDistractions,
  };
});

ipcMain.handle(IPC_CHANNELS.APP_GET_ACTIVE_APP, () => {
  return currentForegroundAppInfo().name;
});

ipcMain.on(IPC_CHANNELS.DASHBOARD_TAB_CHANGED, (_e, tab: DashboardTab) => {
  settings.activeTab = tab;
  saveSettings();
});

ipcMain.on(IPC_CHANNELS.OVERLAY_READY, () => {
  sendOverlay(IPC_CHANNELS.COMPANIONS_SET, [settings.companion]);
  sendOverlay(IPC_CHANNELS.SETTINGS_UPDATED, settings);
  sendOverlay(IPC_CHANNELS.OVERLAY_PAUSE, settings.paused || suspendReasons.size > 0);
});

ipcMain.on(IPC_CHANNELS.OVERLAY_INTERACTIVE, (_e, interactive: boolean) => {
  if (!win || win.isDestroyed()) return;
  if (interactive && !companionGrabbed) foregroundAppBundleId = currentForegroundAppInfo().bundleId;
  if (!interactive && !companionGrabbed) foregroundAppBundleId = null;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on(IPC_CHANNELS.OVERLAY_GRAB, (_e, grabbed: boolean) => {
  if (grabbed) {
    if (!companionGrabbed && !foregroundAppBundleId) foregroundAppBundleId = currentForegroundAppInfo().bundleId;
    companionGrabbed = true;
    return;
  }
  if (!companionGrabbed) return;
  companionGrabbed = false;
  restoreForegroundApp();
});

ipcMain.on(IPC_CHANNELS.OVERLAY_MENU, () => {
  if (!win || win.isDestroyed()) return;
  if (!foregroundAppBundleId) foregroundAppBundleId = currentForegroundAppInfo().bundleId;
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

/* ------------------------------- boot & lifecycle ------------------------------- */

function setSuspendReason(reason: string, active: boolean): void {
  if (active) suspendReasons.add(reason);
  else suspendReasons.delete(reason);
  const suspended = suspendReasons.size > 0;
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(true, { forward: true });
    if (suspended || settings.paused) win.hide();
    else win.showInactive();
  }
  sendOverlay(IPC_CHANNELS.OVERLAY_PAUSE, suspended || settings.paused);
}

function onDisplaysChanged(): void {
  const displays = screen.getAllDisplays();
  if (settings.displayId !== null && !displays.some((d) => d.id === settings.displayId)) {
    settings.displayId = screen.getPrimaryDisplay().id;
    saveSettings();
  }
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
  placeOverlay();
  sendOverlay('overlay:display-change');
  refreshMenu();
}

function startWindowsFullscreenWatcher(): void {
  const monitorPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'windows-fullscreen-monitor.ps1')
    : path.join(app.getAppPath(), 'scripts', 'windows-fullscreen-monitor.ps1');
  fullscreenWatcher = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', monitorPath],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
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
  loadStats();
  createOverlay();

  const icon = nativeImage
    .createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('DeskPals');
  tray.on('double-click', () => openDashboard(settings.activeTab));
  refreshMenu();

  // First launch behavior: Open dashboard automatically to welcome user
  if (!settings.firstLaunchShown) {
    settings.firstLaunchShown = true;
    saveSettings();
    openDashboard('stats');
  }

  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  powerMonitor.on('suspend', () => setSuspendReason('suspend', true));
  powerMonitor.on('resume', () => {
    setSuspendReason('suspend', false);
    onDisplaysChanged();
    // Recompute schedule on resume
    checkSchedulerTicker();
  });
  powerMonitor.on('lock-screen', () => setSuspendReason('lock-screen', true));
  powerMonitor.on('unlock-screen', () => {
    setSuspendReason('lock-screen', false);
    onDisplaysChanged();
  });

  if (process.platform === 'win32') startWindowsFullscreenWatcher();

  // Active timers
  setInterval(checkSchedulerTicker, 10000); // Check reminders every 10s
  setInterval(minuteTicker, 60000); // Check breaks, water, focus countdown every 1m
  setInterval(checkDistractions, 4000); // Check distraction poller during focus

  if (DEBUG) {
    setInterval(() => sendOverlay('overlay:telemetry-request'), 5000);
  }
});

// Tray application behavior: Closing windows does NOT quit the background companion
app.on('window-all-closed', () => {
  // Stay resident in system tray
});

app.on('before-quit', () => {
  fullscreenWatcher?.kill();
});
