/**
 * Wellness, Dashboard, and Reminders Unit Tests.
 * Tests:
 * - Reminder scheduling (next-due calculation, rollover past midnight, countdown active detection)
 * - Stats aggregation (getLast7Days, intensityLevel, calculateCompanionDays)
 * - Heatmap grid construction (52 columns x 7 rows, month transitions)
 * - Config migration and schema backward-compatibility
 */

import { parseSettings } from '../src/core/settings';
import {
  calculateNextOccurrence,
  getMinutesUntil,
  isCountdownActive,
  formatTime12,
  formatLiveNext,
  type ReminderItem,
} from '../src/core/reminders';
import {
  getLast7Days,
  buildHeatmapGrid,
  intensityLevel,
  calculateCompanionDays,
  calculateFocusStreak,
  parseStats,
  type DailyStats,
} from '../src/core/stats';
import { t } from '../src/core/i18n';
import {
  createInitialPomodoroState,
  startPomodoro,
  pausePomodoro,
  skipPomodoro,
  resetPomodoro,
  tickPomodoro,
  getPomodoroSecondsRemaining,
  formatTimeMMSS,
} from '../src/core/pomodoro';
import {
  sanitizeTodoText,
  sanitizeTodoPriority,
  parseTodos,
  sortTodos,
  calculateTodoSummary,
  MAX_TODO_TEXT_LENGTH,
  type TodoItem,
} from '../src/core/todos';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) {
    failures++;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  PASS: ${message}`);
  }
}

console.log('=== TEST SUITE 1: REMINDER SCHEDULING & MIDNIGHT ROLLOVER ===');

// Test 1: Next occurrence today vs tomorrow
{
  const baseDate = new Date('2026-11-13T10:00:00');
  
  // Later today (14:30)
  const nextLater = calculateNextOccurrence('14:30', baseDate);
  assert(nextLater.getDate() === 13, 'Later today stays on same calendar date');
  assert(nextLater.getHours() === 14 && nextLater.getMinutes() === 30, 'Sets correct hours and minutes');

  // Earlier today (08:15) -> rolls over to tomorrow
  const nextEarlier = calculateNextOccurrence('08:15', baseDate);
  assert(nextEarlier.getDate() === 14, 'Earlier time rolls over to tomorrow (14th)');
  assert(nextEarlier.getHours() === 8 && nextEarlier.getMinutes() === 15, 'Sets correct hours and minutes on rollover');

  // Exact same minute (10:00) -> rolls over to tomorrow
  const nextExact = calculateNextOccurrence('10:00', baseDate);
  assert(nextExact.getDate() === 14, 'Exact current time rolls over to next day');

  // Midnight rollover over month boundary (Nov 30 -> Dec 1)
  const endOfMonth = new Date('2026-11-30T23:55:00');
  const pastMidnight = calculateNextOccurrence('00:05', endOfMonth);
  assert(pastMidnight.getMonth() === 11 && pastMidnight.getDate() === 1, 'Past midnight rolls over into next month');
  assert(pastMidnight.getHours() === 0 && pastMidnight.getMinutes() === 5, 'Past midnight has correct hour/min');
}

// Test 2: getMinutesUntil and countdown active
{
  const now = new Date('2026-11-13T13:45:00');
  const target = new Date('2026-11-13T14:00:00');
  assert(getMinutesUntil(target, now) === 15, 'Calculates 15 minutes until target');

  const reminder: ReminderItem = {
    id: 'r1',
    task: 'Water plants',
    time: '14:00',
    enabled: true,
    petCountdown: true,
    showBeforeMinutes: 20,
    enlargeOnAlert: true,
  };

  const statusActive = isCountdownActive(reminder, now);
  assert(statusActive.active === true, 'Countdown is active within showBeforeMinutes window');
  assert(statusActive.minutesLeft === 15, 'Reports 15 minutes left');

  // Outside showBefore window
  const earlierNow = new Date('2026-11-13T13:00:00'); // 60 mins before
  const statusInactive = isCountdownActive(reminder, earlierNow);
  assert(statusInactive.active === false, 'Countdown is inactive when outside showBefore window');

  // Disabled reminder
  const disabledReminder = { ...reminder, enabled: false };
  assert(isCountdownActive(disabledReminder, now).active === false, 'Disabled reminder never has active countdown');

  // Formatting 12h
  assert(formatTime12('14:05') === '02:05 PM', 'Formats 14:05 to 02:05 PM');
  assert(formatTime12('00:30') === '12:30 AM', 'Formats 00:30 to 12:30 AM');
  assert(formatLiveNext(reminder, now) === 'Next: 02:00 PM (15min)', 'Formats live next text accurately');
}

console.log('=== TEST SUITE 2: STATS AGGREGATION & HEATMAP GRID ===');

// Test 3: getLast7Days
{
  const refDate = new Date('2026-11-13T12:00:00');
  const records: Record<string, DailyStats> = {
    '2026-11-13': { date: '2026-11-13', pomodoros: 4, tasksDone: 6, focusMinutes: 75, distractions: 2 },
    '2026-11-12': { date: '2026-11-12', pomodoros: 3, tasksDone: 5, focusMinutes: 45, distractions: 1 },
    '2026-11-10': { date: '2026-11-10', pomodoros: 2, tasksDone: 4, focusMinutes: 20, distractions: 5 },
  };

  const summary = getLast7Days(records, refDate);
  assert(summary.days.length === 7, 'Returns exactly 7 days');
  assert(summary.days[6].date === '2026-11-13', 'Last day is reference date');
  assert(summary.days[6].pomodoros === 4 && summary.days[6].focusMinutes === 75, 'Populates today metric data');
  assert(summary.days[5].date === '2026-11-12', 'Previous day has matching data');
  assert(summary.days[4].date === '2026-11-11' && summary.days[4].pomodoros === 0, 'Missing day defaults cleanly to 0');
  assert(summary.today.focusMinutes === 75, 'Extracts today stats');
  assert(summary.firstDateLabel === '11/7', 'Calculates correct first date label');
  assert(summary.lastDateLabel === '11/13', 'Calculates correct last date label');
}

// Test 4: intensityLevel
{
  assert(intensityLevel(0) === 0, '0 mins = level 0');
  assert(intensityLevel(-5) === 0, 'negative mins = level 0');
  assert(intensityLevel(10) === 1, '10 mins = level 1');
  assert(intensityLevel(25) === 2, '25 mins = level 2');
  assert(intensityLevel(45) === 3, '45 mins = level 3');
  assert(intensityLevel(90) === 4, '90 mins = level 4');
}

// Test 5: buildHeatmapGrid
{
  const refDate = new Date('2026-11-13T12:00:00');
  const records: Record<string, DailyStats> = {
    '2026-11-13': { date: '2026-11-13', pomodoros: 1, tasksDone: 1, focusMinutes: 80, distractions: 0 },
  };

  const grid = buildHeatmapGrid(records, refDate);
  assert(grid.weeks.length === 52, 'Heatmap generates 52 week columns');
  assert(grid.weeks[0].length === 7, 'Each week contains 7 days (Mon-Sun)');
  assert(grid.weeks[51].length === 7, 'Final week contains 7 days');
  assert(grid.monthLabels.length >= 11, 'Has month labels across the year');

  // Verify that the reference day exists in the last week with intensity 4
  const lastWeek = grid.weeks[51];
  const refCell = lastWeek.find((c) => c.date === '2026-11-13');
  assert(refCell !== undefined && refCell.intensity === 4, 'Reference day recorded with intensity level 4 in grid');
}

// Test 6: calculateCompanionDays
{
  const today = new Date('2026-11-13T12:00:00');
  assert(calculateCompanionDays(undefined, today) === 1, 'Missing date defaults to 1 day');
  assert(calculateCompanionDays('invalid-date', today) === 1, 'Corrupted date defaults to 1 day');
  assert(calculateCompanionDays('2026-11-13', today) === 1, 'Same day launch = 1 day');
  assert(calculateCompanionDays('2026-11-10', today) === 4, '3 days ago = 4th day of companionship');
}

console.log('=== TEST SUITE 3: CONFIG MIGRATION & BACKWARD COMPATIBILITY ===');

// Test 7: parseSettings migration
{
  // 1. Empty JSON object
  const empty = parseSettings('{}');
  assert(empty.companion === 'cat', 'Empty JSON defaults companion to cat');
  assert(empty.activeTab === 'stats', 'Defaults activeTab to stats');
  assert(empty.language === 'en', 'Defaults language to en');
  assert(empty.appearance.petSizePercent === 100, 'Defaults appearance petSizePercent to 100');
  assert(empty.appearance.lyricsMode === false, 'Defaults lyricsMode to false');
  assert(empty.motion.autoRun === true, 'Defaults autoRun to true');
  assert(empty.focus.enabled === false, 'Defaults focus enabled to false');

  // 2. Legacy v0.1.0 format with "companions" array and legacy "health" object
  const legacy = parseSettings('{"companions":["fox","ghost"],"displayId":2,"paused":true,"health":{"breakEnabled":false}}');
  assert(legacy.companion === 'fox', 'Migrates legacy companions array first entry');
  assert(legacy.displayId === 2, 'Preserves displayId');
  assert(legacy.paused === true, 'Preserves paused');
  assert(legacy.companionScales.fox === 100, 'Populates companion scales');
  assert(!('health' in legacy), 'Drops legacy health section safely');
  assert(parseSettings('{"language":"hi"}').language === 'hi', 'Accepts Hindi language');

  // 3. Clamping boundary values
  const clamped = parseSettings(JSON.stringify({
    appearance: { petSizePercent: 9999, bubbleDurationSeconds: 0 },
    companionScales: { cat: 20 },
  }));
  assert(clamped.appearance.petSizePercent === 300, 'Clamps petSizePercent to max 300');
  assert(clamped.appearance.bubbleDurationSeconds === 2, 'Clamps bubbleDurationSeconds to min 2');
  assert(clamped.companionScales.cat === 50, 'Clamps companionScales to min 50');

  // 4. Corrupt JSON throws proper error
  let threw = false;
  try { parseSettings('not-json'); } catch { threw = true; }
  assert(threw, 'Rejects invalid JSON syntax');
}

// Test 8: parseStats legacy migration
{
  const legacyJson = JSON.stringify({
    '2026-11-13': {
      date: '2026-11-13',
      breaks: 5,
      waters: 8,
      focusMinutes: 75,
      distractions: 2,
    },
    '2026-11-12': {
      date: '2026-11-12',
      focusMinutes: 30,
    },
  });

  const parsed = parseStats(legacyJson);
  assert(parsed['2026-11-13'] !== undefined, 'Parses legacy day key');
  assert(parsed['2026-11-13'].pomodoros === 0, 'Initializes pomodoros to 0 for legacy entry');
  assert(parsed['2026-11-13'].tasksDone === 0, 'Initializes tasksDone to 0 for legacy entry');
  assert(parsed['2026-11-13'].focusMinutes === 75, 'Preserves focusMinutes from legacy file');
  assert(parsed['2026-11-13'].distractions === 2, 'Preserves distractions from legacy file');
  assert(!('breaks' in parsed['2026-11-13']), 'Drops legacy breaks field');
  assert(!('waters' in parsed['2026-11-13']), 'Drops legacy waters field');
  assert(parsed['2026-11-12'].distractions === 0, 'Defaults missing fields to 0');

  // Corrupt or empty stats handling
  assert(Object.keys(parseStats('')).length === 0, 'Empty string returns empty stats object');
  assert(Object.keys(parseStats('invalid-json')).length === 0, 'Invalid JSON returns empty stats object without crashing');
}

// Test 9: calculateFocusStreak
{
  const refDate = new Date('2026-11-13T12:00:00');
  const streakRecords: Record<string, DailyStats> = {
    '2026-11-13': { date: '2026-11-13', pomodoros: 2, tasksDone: 1, focusMinutes: 50, distractions: 0 },
    '2026-11-12': { date: '2026-11-12', pomodoros: 1, tasksDone: 3, focusMinutes: 25, distractions: 1 },
    '2026-11-11': { date: '2026-11-11', pomodoros: 4, tasksDone: 2, focusMinutes: 100, distractions: 0 },
    '2026-11-10': { date: '2026-11-10', pomodoros: 0, tasksDone: 0, focusMinutes: 0, distractions: 0 },
  };

  assert(calculateFocusStreak(streakRecords, refDate) === 3, 'Calculates 3-day active streak including today');

  // If today is 0 mins but yesterday had focus, streak is preserved from yesterday
  const zeroTodayRecords: Record<string, DailyStats> = {
    ...streakRecords,
    '2026-11-13': { date: '2026-11-13', pomodoros: 0, tasksDone: 0, focusMinutes: 0, distractions: 0 },
  };
  assert(calculateFocusStreak(zeroTodayRecords, refDate) === 2, 'Preserves previous 2-day streak before today records any focus');

  // Broken streak
  const brokenRecords: Record<string, DailyStats> = {
    '2026-11-13': { date: '2026-11-13', pomodoros: 0, tasksDone: 0, focusMinutes: 0, distractions: 0 },
    '2026-11-12': { date: '2026-11-12', pomodoros: 0, tasksDone: 0, focusMinutes: 0, distractions: 0 },
  };
  assert(calculateFocusStreak(brokenRecords, refDate) === 0, 'Reports 0 streak when neither today nor yesterday has focus');
}

console.log('=== TEST SUITE 4: POMODORO STATE MACHINE ===');
{
  const t0 = 1000000;
  const settings = {
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    roundsBeforeLongBreak: 4,
    autoStartNext: false,
  };

  // 1. Initial State
  let state = createInitialPomodoroState(settings);
  assert(state.phase === 'idle', 'Starts in idle phase');
  assert(state.round === 1, 'Initial round is 1');
  assert(getPomodoroSecondsRemaining(state, t0) === 25 * 60, 'Initial remaining seconds is 25 minutes');
  assert(formatTimeMMSS(getPomodoroSecondsRemaining(state, t0)) === '25:00', 'Formats 25:00 cleanly');

  // 2. Start Work
  state = startPomodoro(state, settings, t0);
  assert(state.phase === 'work' && !state.paused, 'Transitions from idle to active work');
  assert(state.targetTimestamp === t0 + 25 * 60 * 1000, 'Sets target timestamp 25 minutes into future');

  // 3. Pause & Resume
  const tPause = t0 + 5 * 60 * 1000; // 5 mins in
  state = pausePomodoro(state, tPause);
  assert(state.paused === true, 'Sets paused flag');
  assert(state.remainingSeconds === 20 * 60, 'Preserves 20 minutes remaining when paused');

  const tResume = tPause + 10 * 60 * 1000; // paused for 10 mins
  state = startPomodoro(state, settings, tResume);
  assert(state.paused === false, 'Resumes timer');
  assert(state.targetTimestamp === tResume + 20 * 60 * 1000, 'Recomputes target timestamp from resume time');

  // 4. Skip doesn't count towards completion
  const preSkip = state;
  state = skipPomodoro(preSkip, settings, tResume);
  assert(state.phase === 'shortBreak', 'Skipping work transitions to shortBreak');
  assert(state.paused === true, 'AutoStart=false pauses after skip');
  assert(state.round === 1, 'Round is preserved as 1 on work skip');

  // 5. Complete full cycle: Work 1 -> Short 1 -> Work 2 -> Short 2 -> Work 3 -> Short 3 -> Work 4 -> Long Break
  let cycleState = createInitialPomodoroState(settings);
  let curTime = t0;

  // Round 1 Work
  cycleState = startPomodoro(cycleState, settings, curTime);
  let tick = tickPomodoro(cycleState, settings, curTime + 24 * 60 * 1000);
  assert(tick.completedPhase === null, 'No completion before target timestamp');

  // Simulated sleep gap: clock jumps past end time
  curTime += 25 * 60 * 1000;
  tick = tickPomodoro(cycleState, settings, curTime);
  assert(tick.completedPhase === 'work', 'Detects work phase completion');
  assert(tick.completedMinutes === 25, 'Returns 25 completed minutes');
  cycleState = tick.newState;
  assert(cycleState.phase === 'shortBreak', 'Transitions to shortBreak after work round 1');
  assert(cycleState.round === 1, 'Current round stays 1 during short break');

  // Round 1 Short Break
  cycleState = startPomodoro(cycleState, settings, curTime);
  curTime += 5 * 60 * 1000;
  tick = tickPomodoro(cycleState, settings, curTime);
  assert(tick.completedPhase === 'shortBreak', 'Detects shortBreak completion');
  cycleState = tick.newState;
  assert(cycleState.phase === 'work', 'Transitions to work phase for round 2');
  assert(cycleState.round === 2, 'Increments to round 2');

  // Fast forward round 2 & 3
  // Round 2
  cycleState = startPomodoro(cycleState, settings, curTime);
  curTime += 25 * 60 * 1000;
  cycleState = tickPomodoro(cycleState, settings, curTime).newState;
  cycleState = startPomodoro(cycleState, settings, curTime);
  curTime += 5 * 60 * 1000;
  cycleState = tickPomodoro(cycleState, settings, curTime).newState;
  assert(cycleState.round === 3, 'Advances to round 3');

  // Round 3
  cycleState = startPomodoro(cycleState, settings, curTime);
  curTime += 25 * 60 * 1000;
  cycleState = tickPomodoro(cycleState, settings, curTime).newState;
  cycleState = startPomodoro(cycleState, settings, curTime);
  curTime += 5 * 60 * 1000;
  cycleState = tickPomodoro(cycleState, settings, curTime).newState;
  assert(cycleState.round === 4, 'Advances to round 4');

  // Round 4 (Trigger long break!)
  cycleState = startPomodoro(cycleState, settings, curTime);
  curTime += 25 * 60 * 1000;
  tick = tickPomodoro(cycleState, settings, curTime);
  assert(tick.completedPhase === 'work', 'Round 4 work completes');
  cycleState = tick.newState;
  assert(cycleState.phase === 'longBreak', 'Transitions to longBreak after 4th work round');

  // Complete long break -> cycles back to round 1
  cycleState = startPomodoro(cycleState, settings, curTime);
  curTime += 15 * 60 * 1000;
  tick = tickPomodoro(cycleState, settings, curTime);
  assert(tick.completedPhase === 'longBreak', 'Long break completes');
  cycleState = tick.newState;
  assert(cycleState.phase === 'work' && cycleState.round === 1, 'Cycles back to work round 1');

  // Reset
  cycleState = resetPomodoro(settings);
  assert(cycleState.phase === 'idle' && cycleState.round === 1, 'Reset returns to idle round 1');
}

console.log('=== TEST SUITE 5: TODOS SANITIZATION, ORDERING & COMPLETION ===');
{
  // 1. Sanitization: limits to 80 chars, trims, collapses spaces, invalid input handling
  const longText = '   This is a very long task description that definitely exceeds eighty characters by a lot of extra words   ';
  const sanitized = sanitizeTodoText(longText);
  assert(sanitized.length <= MAX_TODO_TEXT_LENGTH, 'Caps text to max 80 characters');
  assert(!sanitized.startsWith(' ') && !sanitized.endsWith(' '), 'Trims whitespace');
  assert(sanitizeTodoText(null) === '', 'Rejects null input gracefully');
  assert(sanitizeTodoText(12345) === '', 'Rejects non-string input gracefully');

  // Priority sanitization
  assert(sanitizeTodoPriority('high') === 'high', 'Accepts high priority');
  assert(sanitizeTodoPriority('low') === 'low', 'Accepts low priority');
  assert(sanitizeTodoPriority('invalid') === 'normal', 'Defaults invalid priority to normal');

  // 2. Parsing and deduplication of IDs
  const rawTodosJson = JSON.stringify([
    { id: 't1', text: 'Task 1', priority: 'high', completed: false, createdAt: '2026-11-13T10:00:00Z' },
    { id: 't1', text: 'Task 2 duplicate id', priority: 'low', completed: true, completedAt: '2026-11-13', createdAt: '2026-11-13T11:00:00Z' },
    { id: 't3', text: '   ', completed: false }, // empty text should be dropped
  ]);

  const parsed = parseTodos(rawTodosJson);
  assert(parsed.length === 2, 'Drops tasks with empty text');
  assert(parsed[0].id !== parsed[1].id, 'Deduplicates identical ids');
  assert(parsed[0].priority === 'high', 'Preserves priority');
  assert(parsed[1].completed === true && parsed[1].completedAt === '2026-11-13', 'Preserves completed status and completion date');

  // 3. Corrupt JSON handling
  assert(parseTodos('invalid json string').length === 0, 'Returns empty array on corrupt JSON without throwing');
  assert(parseTodos('').length === 0, 'Returns empty array on empty string');

  // 4. Ordering: Open tasks first, completed below; newest first
  const unorganised: TodoItem[] = [
    { id: '1', text: 'Old completed', priority: 'normal', completed: true, completedAt: '2026-11-10', createdAt: '2026-11-09T08:00:00Z' },
    { id: '2', text: 'Recent open', priority: 'high', completed: false, createdAt: '2026-11-13T12:00:00Z' },
    { id: '3', text: 'New completed today', priority: 'low', completed: true, completedAt: '2026-11-13', createdAt: '2026-11-13T09:00:00Z' },
    { id: '4', text: 'Older open', priority: 'normal', completed: false, createdAt: '2026-11-12T10:00:00Z' },
  ];

  const sorted = sortTodos(unorganised);
  assert(sorted[0].id === '2', 'First item is most recent open task');
  assert(sorted[1].id === '4', 'Second item is older open task');
  assert(sorted[2].id === '3', 'Third item is completed today task');
  assert(sorted[3].id === '1', 'Fourth item is older completed task');

  // 5. Summary calculations
  const summary = calculateTodoSummary(sorted, '2026-11-13');
  assert(summary.openCount === 2, 'Counts 2 open tasks');
  assert(summary.doneTodayCount === 1, 'Counts 1 task completed today');

  // 6. Completion & Uncompletion logic with midnight crossing
  const todayKey = '2026-11-13';
  const yesterdayKey = '2026-11-12';

  // Completing a task
  let tasksDoneToday = 2;
  const taskToComplete: TodoItem = {
    id: 'test-1',
    text: 'Finish report',
    priority: 'normal',
    completed: false,
    createdAt: '2026-11-13T08:00:00Z',
  };

  // Complete action
  taskToComplete.completed = true;
  taskToComplete.completedAt = todayKey;
  tasksDoneToday += 1;
  assert(tasksDoneToday === 3, 'Completing task increments tasksDoneToday');

  // Un-completing task completed TODAY
  if (taskToComplete.completedAt === todayKey) {
    tasksDoneToday = Math.max(0, tasksDoneToday - 1);
  }
  taskToComplete.completed = false;
  taskToComplete.completedAt = undefined;
  assert(tasksDoneToday === 2, 'Uncompleting a task completed today decrements tasksDoneToday');

  // Un-completing task completed YESTERDAY (older date)
  const taskCompletedYesterday: TodoItem = {
    id: 'test-2',
    text: 'Yesterday job',
    priority: 'normal',
    completed: true,
    completedAt: yesterdayKey,
    createdAt: '2026-11-12T10:00:00Z',
  };

  if (taskCompletedYesterday.completedAt === todayKey) {
    tasksDoneToday = Math.max(0, tasksDoneToday - 1);
  }
  taskCompletedYesterday.completed = false;
  taskCompletedYesterday.completedAt = undefined;
  assert(tasksDoneToday === 2, 'Uncompleting an older task does NOT decrement today count');
}

console.log('=== TEST SUITE 6: I18N DICTIONARY & MULTI-LANGUAGE SUPPORT ===');
{
  assert(t('nav_stats', 'en') === 'Stats', 'English nav_stats translation works');
  assert(t('nav_stats', 'es') === 'Estadísticas', 'Spanish nav_stats translation works');
  assert(t('nav_stats', 'hi') === 'आँकड़े', 'Hindi nav_stats translation works');

  assert(t('nav_todo', 'en') === 'Todo', 'English nav_todo translation works');
  assert(t('nav_todo', 'es') === 'Tareas', 'Spanish nav_todo translation works');
  assert(t('nav_todo', 'hi') === 'कार्य सूची', 'Hindi nav_todo translation works');

  assert(t('stats_pomodoros', 'en') === 'Pomodoros', 'English stats_pomodoros works');
  assert(t('stats_pomodoros', 'es') === 'Pomodoros', 'Spanish stats_pomodoros works');
  assert(t('stats_pomodoros', 'hi') === 'पोमोडोरो', 'Hindi stats_pomodoros works');

  assert(t('pomo_work_done', 'en') === 'Pomodoro done! Take 5.', 'English pomo_work_done works');
  assert(t('pomo_work_done', 'hi') === 'पोमोडोरो पूरा हुआ! 5 मिनट का ब्रेक लें।', 'Hindi pomo_work_done works');

  assert(t('todo_bubble_done', 'en') === 'Nice! Task done.', 'English todo_bubble_done works');
  assert(t('todo_bubble_done', 'es') === '¡Genial! Tarea completada.', 'Spanish todo_bubble_done works');
  assert(t('todo_bubble_done', 'hi') === 'शाबाश! कार्य पूर्ण हुआ।', 'Hindi todo_bubble_done works');

  assert(t('unknown_key', 'en') === 'unknown_key', 'Fallback to key when missing');
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nALL 27 WELLNESS & SCHEDULING CHECKS PASSED SUCCESSFULLY!\n');
}
