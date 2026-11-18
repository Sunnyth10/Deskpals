const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// We want a clean dark theme capture
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

app.whenReady().then(async () => {
  const sampleSettings = {
    companion: 'cat',
    companionScales: { cat: 100, fox: 100, ghost: 100, robot: 100, webhero: 100 },
    activeTab: 'stats',
    language: 'en',
    appearance: { petSizePercent: 100, lyricsMode: false, bubbleDurationSeconds: 6 },
    motion: { autoRun: true, runDirection: 'both', runFrequencySeconds: 20, runDurationSeconds: 4, idleMotionFrequencySeconds: 8 },
    pomodoro: { workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, roundsBeforeLongBreak: 4, autoStartNext: false },
    focus: { enabled: true, sessionDurationMinutes: 25, blockedApps: ['Twitter', 'Discord'], blockedKeywords: ['social', 'games'] },
    reminders: [
      { id: '1', task: 'Hydrate & drink water', time: '14:30', enabled: true, petCountdown: true, showBeforeMinutes: 10, enlargeOnAlert: true },
      { id: '2', task: 'Stand up and stretch', time: '16:00', enabled: true, petCountdown: true, showBeforeMinutes: 5, enlargeOnAlert: true }
    ],
    firstLaunchDate: '2026-11-01'
  };

  const days = [
    { date: '11/12', pomodoros: 2, tasksDone: 3, focusMinutes: 50, distractions: 4 },
    { date: '11/13', pomodoros: 4, tasksDone: 5, focusMinutes: 100, distractions: 2 },
    { date: '11/14', pomodoros: 3, tasksDone: 4, focusMinutes: 75, distractions: 3 },
    { date: '11/15', pomodoros: 5, tasksDone: 7, focusMinutes: 125, distractions: 1 },
    { date: '11/16', pomodoros: 4, tasksDone: 6, focusMinutes: 100, distractions: 2 },
    { date: '11/17', pomodoros: 6, tasksDone: 8, focusMinutes: 150, distractions: 1 },
    { date: '11/18', pomodoros: 5, tasksDone: 7, focusMinutes: 130, distractions: 0 }
  ];

  // Generate 52 weeks heatmap
  const weeks = [];
  for (let w = 0; w < 52; w++) {
    const daysArr = [];
    for (let d = 0; d < 7; d++) {
      const isRecent = w > 44;
      const intensity = isRecent ? ((w + d) % 5) : (w > 35 && (w + d) % 3 === 0 ? 1 + ((w + d) % 3) : 0);
      daysArr.push({
        date: `2026-W${w}-D${d}`,
        focusMinutes: intensity * 30,
        intensity: intensity
      });
    }
    weeks.push(daysArr);
  }

  const sampleStats = {
    sevenDays: {
      days,
      today: days[6],
      rangeLabel: '11/12 - 11/18',
      firstDateLabel: '11/12',
      lastDateLabel: '11/18'
    },
    heatmap: {
      weeks,
      monthLabels: [
        { name: 'Jan', columnIndex: 0 },
        { name: 'Mar', columnIndex: 8 },
        { name: 'May', columnIndex: 17 },
        { name: 'Jul', columnIndex: 26 },
        { name: 'Sep', columnIndex: 35 },
        { name: 'Nov', columnIndex: 44 }
      ]
    },
    companionDays: 18,
    focusStreak: 6
  };

  const samplePomodoro = {
    phase: 'work',
    round: 2,
    totalRounds: 4,
    formattedTime: '18:42',
    secondsRemaining: 1122,
    totalSeconds: 1500,
    paused: false,
    autoStartNext: false
  };

  // Register all required IPC mocks matching IPC_CHANNELS
  ipcMain.handle('settings:get', () => sampleSettings);
  ipcMain.handle('settings:set', (_e, s) => Object.assign(sampleSettings, s));
  ipcMain.handle('stats:get', () => sampleStats);
  ipcMain.handle('stats:record', () => {});
  ipcMain.handle('reminders:get', () => sampleSettings.reminders);
  ipcMain.handle('reminders:save', () => sampleSettings.reminders);
  ipcMain.handle('reminders:delete', () => sampleSettings.reminders);
  ipcMain.handle('reminders:trigger', () => {});
  ipcMain.handle('focus:start', () => ({ active: true, minutesRemaining: 25, totalSessionMinutes: 25, currentDistractions: 0 }));
  ipcMain.handle('focus:stop', () => ({ active: false, minutesRemaining: 0, totalSessionMinutes: 0, currentDistractions: 0 }));
  ipcMain.handle('focus:status', () => ({ active: false, minutesRemaining: 0, totalSessionMinutes: 0, currentDistractions: 0 }));
  ipcMain.handle('pomodoro:status', () => samplePomodoro);
  ipcMain.handle('pomodoro:start', () => samplePomodoro);
  ipcMain.handle('pomodoro:pause', () => samplePomodoro);
  ipcMain.handle('pomodoro:skip', () => samplePomodoro);
  ipcMain.handle('pomodoro:reset', () => samplePomodoro);
  ipcMain.handle('todos:get', () => [
    { id: '1', text: 'Ship DeskPals v1.1.0 update', completed: true, completedAt: '2026-11-18T10:00:00Z', priority: 'high', createdAt: '2026-11-18T08:00:00Z' },
    { id: '2', text: 'Finish weekly code review', completed: false, priority: 'high', createdAt: '2026-11-18T09:00:00Z' },
    { id: '3', text: 'Pet the cat for 5 minutes', completed: false, priority: 'normal', createdAt: '2026-11-18T10:30:00Z' }
  ]);
  ipcMain.handle('todos:add', () => []);
  ipcMain.handle('todos:update', () => []);
  ipcMain.handle('todos:toggle', () => []);
  ipcMain.handle('todos:delete', () => []);
  ipcMain.handle('todos:clear-completed', () => []);
  ipcMain.handle('active-app:get', () => 'Visual Studio Code');
  ipcMain.on('tab:set', () => {});

  const win = new BrowserWindow({
    width: 860,
    height: 870,
    show: false,
    frame: true,
    transparent: false,
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, '../dist/dashboardPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  await win.loadFile(path.join(__dirname, '../dist/dashboard.html'));

  // Wait 1200ms for DOM, fonts, and canvas to render completely
  setTimeout(async () => {
    try {
      const image = await win.webContents.capturePage();
      const outDir = path.join(__dirname, '../docs/images');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, 'dashboard.png');
      fs.writeFileSync(outPath, image.toPNG());
      console.log('Successfully captured dashboard to', outPath);
    } catch (err) {
      console.error('Failed to capture page:', err);
    } finally {
      app.quit();
    }
  }, 1200);
});
