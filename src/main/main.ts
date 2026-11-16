/**
 * Main process.
 *
 * Owns:
 * - Transparent, click-through overlay window (companions)
 * - Dashboard window (Wellness + Stats + Pet + Reminders + Settings)
 * - Reminder Scheduler
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
  powerMonitor,
  Notification as ElectronNotification,
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
  isCountdownActive,
  isReminderDue,
  type ReminderItem,
} from '../core/reminders';
import {
  formatDateKey,
  getLast7Days,
  buildHeatmapGrid,
  calculateCompanionDays,
  calculateFocusStreak,
  parseStats,
  type DailyStats,
} from '../core/stats';
import {
  createInitialPomodoroState,
  getPomodoroStatus,
  startPomodoro,
  pausePomodoro,
  skipPomodoro,
  resetPomodoro,
  tickPomodoro,
  type PomodoroState,
  type PomodoroStatus,
} from '../core/pomodoro';
import {
  parseTodos,
  sortTodos,
  sanitizeTodoText,
  sanitizeTodoPriority,
  MAX_TODOS_COUNT,
  type TodoItem,
  type TodoPriority,
} from '../core/todos';
import { IPC_CHANNELS, type FocusStatus, type SpeechBubbleMessage, type CountdownPayload } from '../shared/ipc-channels';
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
let pomodoroState: PomodoroState = createInitialPomodoroState(DEFAULT_SETTINGS.pomodoro);
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');
const statsFile = (): string => path.join(app.getPath('userData'), 'stats.json');
const todosFile = (): string => path.join(app.getPath('userData'), 'todos.json');
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

function showNativeNotification(title: string, body: string, silent = false): void {
  try {
    if (ElectronNotification.isSupported()) {
      new ElectronNotification({
        title,
        body,
        silent,
      }).show();
    }
  } catch (err) {
    logError('failed to show native notification', err);
  }
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
      statsCache = parseStats(fs.readFileSync(file, 'utf8'));
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

/* --------------------------------- todo store --------------------------------- */

let todosCache: TodoItem[] = [];

function loadTodos(): void {
  const file = todosFile();
  if (!fs.existsSync(file)) {
    todosCache = [];
    return;
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    todosCache = parseTodos(raw);
  } catch (error) {
    logError('could not load todos; quarantining corrupt file', error);
    try {
      const corruptFile = path.join(app.getPath('userData'), `todos.corrupt.${Date.now()}.json`);
      fs.renameSync(file, corruptFile);
    } catch {
      /* best effort */
    }
    todosCache = [];
  }
}

function saveTodos(): void {
  const file = todosFile();
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(todosCache, null, 2));
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* best effort */
    }
    logError('could not save todos', error);
  }
}

function broadcastTodosUpdated(): void {
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.webContents.send(IPC_CHANNELS.TODOS_UPDATED);
  }
}

function recordStat(type: 'pomodoros' | 'tasksDone' | 'focusMinutes' | 'distractions', delta: number): void {
  const todayKey = formatDateKey(new Date());
  if (!statsCache[todayKey]) {
    statsCache[todayKey] = {
      date: todayKey,
      pomodoros: 0,
      tasksDone: 0,
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
  // If the Dashboard window is currently open and visible, never steal focus away from it
  if (dashboardWin && !dashboardWin.isDestroyed() && dashboardWin.isVisible()) {
    foregroundAppBundleId = null;
    return;
  }
  const targetBundleId = foregroundAppBundleId;
  foregroundAppBundleId = null;
  const child = spawn('/usr/bin/open', ['-b', targetBundleId], {
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
  // Prevent any pending menu callback from stealing focus away from the dashboard
  foregroundAppBundleId = null;

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

/* ------------------------ focus & pomodoro engine ------------------------ */

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

function broadcastPomodoroStatus(): void {
  const status = getPomodoroStatus(pomodoroState, settings.pomodoro);
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.webContents.send(IPC_CHANNELS.POMODORO_STATUS_CHANGED, status);
  }
}

function handleStartPomodoro(): PomodoroStatus {
  pomodoroState = startPomodoro(pomodoroState, settings.pomodoro);
  // SINGLE SOURCE OF TRUTH FOR FOCUS: Pomodoro work phases represent dedicated focus time.
  // When a Pomodoro work phase is active, the standard Focus monitor is linked directly to the Pomodoro timer.
  // If a Pomodoro work phase completes, it logs focusMinutes directly and resets any overlapping manual session to prevent double-counting.
  if (pomodoroState.phase === 'work' && !focusActive) {
    focusActive = true;
    focusSessionEndTime = pomodoroState.targetTimestamp ?? (Date.now() + settings.pomodoro.workMinutes * 60000);
    focusTotalMinutes = settings.pomodoro.workMinutes;
    broadcastFocusState();
  }
  broadcastPomodoroStatus();
  refreshMenu();
  return getPomodoroStatus(pomodoroState, settings.pomodoro);
}

function handlePausePomodoro(): PomodoroStatus {
  pomodoroState = pausePomodoro(pomodoroState);
  if (focusActive) {
    focusActive = false;
    broadcastFocusState();
  }
  broadcastPomodoroStatus();
  refreshMenu();
  return getPomodoroStatus(pomodoroState, settings.pomodoro);
}

function handleSkipPomodoro(): PomodoroStatus {
  pomodoroState = skipPomodoro(pomodoroState, settings.pomodoro);
  if (pomodoroState.phase === 'work' && !pomodoroState.paused) {
    focusActive = true;
    focusSessionEndTime = pomodoroState.targetTimestamp ?? (Date.now() + settings.pomodoro.workMinutes * 60000);
    focusTotalMinutes = settings.pomodoro.workMinutes;
  } else {
    focusActive = false;
  }
  broadcastFocusState();
  broadcastPomodoroStatus();
  refreshMenu();
  return getPomodoroStatus(pomodoroState, settings.pomodoro);
}

function handleResetPomodoro(): PomodoroStatus {
  pomodoroState = resetPomodoro(settings.pomodoro);
  if (focusActive) {
    focusActive = false;
    broadcastFocusState();
  }
  broadcastPomodoroStatus();
  refreshMenu();
  return getPomodoroStatus(pomodoroState, settings.pomodoro);
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
    { type: 'separator' },
    {
      label: getPomodoroStatus(pomodoroState, settings.pomodoro).phase === 'idle'
        ? '🍅 Start pomodoro'
        : getPomodoroStatus(pomodoroState, settings.pomodoro).paused
          ? `🍅 Resume pomodoro (${getPomodoroStatus(pomodoroState, settings.pomodoro).formattedTime})`
          : `🍅 Pause pomodoro (${getPomodoroStatus(pomodoroState, settings.pomodoro).formattedTime})`,
      click: () => {
        const s = getPomodoroStatus(pomodoroState, settings.pomodoro);
        if (s.phase === 'idle' || s.paused) {
          handleStartPomodoro();
        } else {
          handlePausePomodoro();
        }
      },
    },
    {
      label: '⏹ Stop pomodoro',
      enabled: getPomodoroStatus(pomodoroState, settings.pomodoro).phase !== 'idle',
      click: () => handleResetPomodoro(),
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

function checkSchedulerTicker(): void {
  const now = new Date();
  const currentDateKey = formatDateKey(now);

  // Rollover fired list at midnight
  if (currentDateKey !== lastMidnightDate) {
    firedRemindersToday.clear();
    lastMidnightDate = currentDateKey;
  }

  // 1. Reminders evaluation
  let activeCountdownPayload: CountdownPayload | null = null;

  for (const reminder of settings.reminders) {
    if (!reminder.enabled) continue;

    const fireKey = `${currentDateKey}_${reminder.id}_${reminder.time}`;
    const alreadyFired = firedRemindersToday.has(fireKey);

    // 1. Due check: fires when scheduled time has arrived (never early)
    if (isReminderDue(reminder, now, alreadyFired)) {
      firedRemindersToday.add(fireKey);

      // Show alert bubble on companion
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
      showNativeNotification('DeskPals Reminder', reminder.task, false);
    } else if (!alreadyFired) {
      // If reminder was scheduled in the past today by more than 60s (e.g. app launched late),
      // mark it fired so it does not fire stale notifications or show a countdown for the past.
      const [hStr, mStr] = reminder.time.split(':');
      const targetHour = parseInt(hStr, 10);
      const targetMinute = parseInt(mStr, 10);
      if (!isNaN(targetHour) && !isNaN(targetMinute)) {
        const todayTarget = new Date(now);
        todayTarget.setHours(targetHour, targetMinute, 0, 0);
        if (now.getTime() - todayTarget.getTime() > 60000) {
          firedRemindersToday.add(fireKey);
        }
      }
    }

    // 2. Pet countdown check: only if petCountdown is enabled and not already fired today
    const countdown = isCountdownActive(reminder, now, firedRemindersToday.has(fireKey));
    if (countdown.active) {
      const msUntilTarget = countdown.nextDate.getTime() - now.getTime();
      // Only show countdown if target is strictly in the future
      if (msUntilTarget > 0) {
        const currentTarget = activeCountdownPayload?.targetTimestamp;
        if (!activeCountdownPayload || (currentTarget !== undefined && msUntilTarget < (currentTarget - now.getTime()))) {
          activeCountdownPayload = {
            taskName: reminder.task,
            minutesLeft: countdown.minutesLeft,
            formattedTime: reminder.time,
            targetTimestamp: countdown.nextDate.getTime(),
          };
        }
      }
    }
  }

  sendOverlay(IPC_CHANNELS.OVERLAY_COUNTDOWN, activeCountdownPayload);
}

// Every minute tick: focus check
function minuteTicker(): void {
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
      showNativeNotification(
        'DeskPals Focus Mode',
        `Focus session complete! Logged ${focusTotalMinutes} minutes.`,
      );
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

/* --------------------------------- Pomodoro Engine --------------------------------- */

function tickPomodoroEngine(): void {
  const now = Date.now();
  const { newState, completedPhase, completedMinutes } = tickPomodoro(pomodoroState, settings.pomodoro, now);
  pomodoroState = newState;

  if (completedPhase) {
    const lang = settings.language;
    if (completedPhase === 'work') {
      // Completed full work phase
      recordStat('pomodoros', 1);
      recordStat('focusMinutes', completedMinutes);
      focusActive = false;
      broadcastFocusState();

      showCompanionBubble({
        id: `pomo-work-${now}`,
        text: t('pomo_work_done', lang),
        kind: 'info',
        durationSeconds: settings.appearance.bubbleDurationSeconds + 2,
        subtext: t('pomo_take_break', lang),
      });

      if (settings.paused || suspendReasons.size > 0 || !win || !win.isVisible()) {
        showNativeNotification(
          'DeskPals Pomodoro',
          `${t('pomo_work_done', lang)} ${t('pomo_take_break', lang)}`,
        );
      }
    } else if (completedPhase === 'shortBreak') {
      showCompanionBubble({
        id: `pomo-short-${now}`,
        text: t('pomo_break_done', lang),
        kind: 'info',
        durationSeconds: settings.appearance.bubbleDurationSeconds + 2,
        subtext: t('pomo_back_to_work', lang),
      });

      if (settings.paused || suspendReasons.size > 0 || !win || !win.isVisible()) {
        showNativeNotification(
          'DeskPals Pomodoro',
          `${t('pomo_break_done', lang)} ${t('pomo_back_to_work', lang)}`,
        );
      }
    } else if (completedPhase === 'longBreak') {
      showCompanionBubble({
        id: `pomo-long-${now}`,
        text: t('pomo_long_break_done', lang),
        kind: 'info',
        durationSeconds: settings.appearance.bubbleDurationSeconds + 2,
        subtext: t('pomo_long_break_sub', lang),
      });

      if (settings.paused || suspendReasons.size > 0 || !win || !win.isVisible()) {
        showNativeNotification(
          'DeskPals Pomodoro',
          `${t('pomo_long_break_done', lang)} ${t('pomo_long_break_sub', lang)}`,
        );
      }
    }

    if (pomodoroState.phase === 'work' && !pomodoroState.paused) {
      focusActive = true;
      focusSessionEndTime = pomodoroState.targetTimestamp ?? (Date.now() + settings.pomodoro.workMinutes * 60000);
      focusTotalMinutes = settings.pomodoro.workMinutes;
      broadcastFocusState();
    }

    broadcastPomodoroStatus();
    refreshMenu();
  } else if (pomodoroState.phase !== 'idle' && !pomodoroState.paused) {
    broadcastPomodoroStatus();
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
  const focusStreak = calculateFocusStreak(statsCache, new Date());
  return { sevenDays, heatmap, companionDays, focusStreak };
});

ipcMain.handle(IPC_CHANNELS.STATS_RECORD, (_e, payload: { type: 'pomodoros' | 'tasksDone' | 'focus' | 'distractions'; delta: number }) => {
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

ipcMain.handle(IPC_CHANNELS.POMODORO_GET_STATUS, () => getPomodoroStatus(pomodoroState, settings.pomodoro));
ipcMain.handle(IPC_CHANNELS.POMODORO_START, () => handleStartPomodoro());
ipcMain.handle(IPC_CHANNELS.POMODORO_PAUSE, () => handlePausePomodoro());
ipcMain.handle(IPC_CHANNELS.POMODORO_SKIP, () => handleSkipPomodoro());
ipcMain.handle(IPC_CHANNELS.POMODORO_RESET, () => handleResetPomodoro());

// Todos IPC Handlers
ipcMain.handle(IPC_CHANNELS.TODOS_GET, () => {
  return sortTodos(todosCache);
});

ipcMain.handle(IPC_CHANNELS.TODOS_ADD, (_e, payload: { text: string; priority?: TodoPriority }) => {
  const text = sanitizeTodoText(payload.text);
  if (!text) return sortTodos(todosCache);

  if (todosCache.length >= MAX_TODOS_COUNT) {
    return sortTodos(todosCache);
  }

  const newItem: TodoItem = {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    priority: sanitizeTodoPriority(payload.priority),
    completed: false,
    createdAt: new Date().toISOString(),
  };

  todosCache.push(newItem);
  saveTodos();
  broadcastTodosUpdated();
  return sortTodos(todosCache);
});

ipcMain.handle(IPC_CHANNELS.TODOS_UPDATE, (_e, payload: { id: string; text: string }) => {
  if (typeof payload.id !== 'string') return sortTodos(todosCache);
  const text = sanitizeTodoText(payload.text);
  if (!text) return sortTodos(todosCache);

  const item = todosCache.find((t) => t.id === payload.id);
  if (item) {
    item.text = text;
    saveTodos();
    broadcastTodosUpdated();
  }
  return sortTodos(todosCache);
});

ipcMain.handle(IPC_CHANNELS.TODOS_TOGGLE, (_e, id: string) => {
  if (typeof id !== 'string') return sortTodos(todosCache);
  const item = todosCache.find((t) => t.id === id);
  if (!item) return sortTodos(todosCache);

  const todayKey = formatDateKey(new Date());

  if (!item.completed) {
    item.completed = true;
    item.completedAt = todayKey;
    recordStat('tasksDone', 1);

    showCompanionBubble({
      id: `todo-done-${Date.now()}`,
      text: t('todo_bubble_done', settings.language),
      kind: 'info',
      durationSeconds: 5,
    });
  } else {
    if (item.completedAt === todayKey) {
      recordStat('tasksDone', -1);
    }
    item.completed = false;
    item.completedAt = undefined;
  }

  saveTodos();
  broadcastTodosUpdated();
  return sortTodos(todosCache);
});

ipcMain.handle(IPC_CHANNELS.TODOS_DELETE, (_e, id: string) => {
  if (typeof id !== 'string') return sortTodos(todosCache);
  todosCache = todosCache.filter((t) => t.id !== id);
  saveTodos();
  broadcastTodosUpdated();
  return sortTodos(todosCache);
});

ipcMain.handle(IPC_CHANNELS.TODOS_CLEAR_COMPLETED, () => {
  todosCache = todosCache.filter((t) => !t.completed);
  saveTodos();
  broadcastTodosUpdated();
  return sortTodos(todosCache);
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
  if (dashboardWin && !dashboardWin.isDestroyed() && dashboardWin.isFocused()) {
    foregroundAppBundleId = null;
  } else {
    if (interactive && !companionGrabbed) foregroundAppBundleId = currentForegroundAppInfo().bundleId;
    if (!interactive && !companionGrabbed) foregroundAppBundleId = null;
  }
  win.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on(IPC_CHANNELS.OVERLAY_GRAB, (_e, grabbed: boolean) => {
  if (grabbed) {
    if (dashboardWin && !dashboardWin.isDestroyed() && dashboardWin.isFocused()) {
      foregroundAppBundleId = null;
    } else if (!companionGrabbed && !foregroundAppBundleId) {
      foregroundAppBundleId = currentForegroundAppInfo().bundleId;
    }
    companionGrabbed = true;
    return;
  }
  if (!companionGrabbed) return;
  companionGrabbed = false;
  restoreForegroundApp();
});

ipcMain.on(IPC_CHANNELS.OVERLAY_MENU, () => {
  if (!win || win.isDestroyed()) return;
  if (!dashboardWin || dashboardWin.isDestroyed() || !dashboardWin.isVisible()) {
    if (!foregroundAppBundleId) foregroundAppBundleId = currentForegroundAppInfo().bundleId;
  }
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
  loadTodos();
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
  setInterval(checkSchedulerTicker, 1000); // Check reminders every second for second-level accuracy
  setInterval(minuteTicker, 60000); // Check focus countdown every 1m
  setInterval(tickPomodoroEngine, 1000); // Pomodoro engine ticker every 1s
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
