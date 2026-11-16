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
  parseStats,
  type DailyStats,
} from '../src/core/stats';
import { t } from '../src/core/i18n';

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

console.log('=== TEST SUITE 4: I18N DICTIONARY ===');
{
  assert(t('nav_stats', 'en') === 'Stats', 'English translation works');
  assert(t('nav_stats', 'es') === 'Estadísticas', 'Spanish translation works');
  assert(t('unknown_key', 'en') === 'unknown_key', 'Fallback to key when missing');
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nALL 27 WELLNESS & SCHEDULING CHECKS PASSED SUCCESSFULLY!\n');
}
