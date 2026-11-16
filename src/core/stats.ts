/**
 * Stats data models and pure aggregation / calculation helper functions.
 */

export interface DailyStats {
  date: string; // 'YYYY-MM-DD'
  pomodoros: number;
  tasksDone: number;
  focusMinutes: number;
  distractions: number;
}

export interface DayMetricPoint {
  date: string; // 'YYYY-MM-DD'
  label: string; // 'MM/DD'
  pomodoros: number;
  tasksDone: number;
  focusMinutes: number;
  distractions: number;
}

export interface SevenDaysSummary {
  days: DayMetricPoint[];
  firstDateLabel: string; // e.g. "11/07"
  lastDateLabel: string;  // e.g. "11/13"
  today: DailyStats;
}

export interface HeatmapCell {
  date: string; // 'YYYY-MM-DD'
  focusMinutes: number;
  intensity: number; // 0, 1, 2, 3, 4
  dayOfWeek: number; // 0 = Mon, ..., 6 = Sun
}

export interface HeatmapMonthLabel {
  name: string;
  columnIndex: number;
}

export interface HeatmapGrid {
  weeks: HeatmapCell[][]; // 52 columns x 7 rows
  monthLabels: HeatmapMonthLabel[];
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatShortDate(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${m}/${d}`;
}

/**
 * Categorizes focus minutes into 5 discrete GitHub-style intensity levels (0 to 4).
 * 0: 0 mins
 * 1: 1 - 15 mins
 * 2: 16 - 30 mins
 * 3: 31 - 60 mins
 * 4: > 60 mins
 */
export function intensityLevel(minutes: number): number {
  if (!minutes || minutes <= 0) return 0;
  if (minutes <= 15) return 1;
  if (minutes <= 30) return 2;
  if (minutes <= 60) return 3;
  return 4;
}

/**
 * Computes the 7-day trend ending on referenceDate (defaults to today).
 */
export function getLast7Days(
  records: Record<string, DailyStats>,
  referenceDate: Date = new Date()
): SevenDaysSummary {
  const days: DayMetricPoint[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - i);
    const key = formatDateKey(d);
    const rec = records[key] ?? {
      date: key,
      pomodoros: 0,
      tasksDone: 0,
      focusMinutes: 0,
      distractions: 0,
    };

    days.push({
      date: key,
      label: formatShortDate(d),
      pomodoros: rec.pomodoros,
      tasksDone: rec.tasksDone,
      focusMinutes: rec.focusMinutes,
      distractions: rec.distractions,
    });
  }

  const todayKey = formatDateKey(referenceDate);
  const today = records[todayKey] ?? {
    date: todayKey,
    pomodoros: 0,
    tasksDone: 0,
    focusMinutes: 0,
    distractions: 0,
  };

  return {
    days,
    firstDateLabel: days[0].label,
    lastDateLabel: days[days.length - 1].label,
    today,
  };
}

/**
 * Builds a 52-week grid (Mon-Sun) ending on the week of referenceDate.
 */
export function buildHeatmapGrid(
  records: Record<string, DailyStats>,
  referenceDate: Date = new Date()
): HeatmapGrid {
  const weeksCount = 52;
  const weeks: HeatmapCell[][] = [];
  const monthLabels: HeatmapMonthLabel[] = [];

  // Find the Sunday of the current week (end of reference week)
  const currentEnd = new Date(referenceDate);
  const currentDay = (currentEnd.getDay() + 6) % 7; // Convert 0(Sun)..6(Sat) to 0(Mon)..6(Sun)
  const daysUntilSunday = 6 - currentDay;
  currentEnd.setDate(currentEnd.getDate() + daysUntilSunday);

  // Start date is 52 weeks prior (on Monday)
  const startDate = new Date(currentEnd);
  startDate.setDate(startDate.getDate() - (weeksCount * 7 - 1));

  let lastMonth = -1;
  const iteratingDate = new Date(startDate);

  for (let w = 0; w < weeksCount; w++) {
    const weekColumn: HeatmapCell[] = [];

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const key = formatDateKey(iteratingDate);
      const rec = records[key];
      const mins = rec?.focusMinutes ?? 0;

      weekColumn.push({
        date: key,
        focusMinutes: mins,
        intensity: intensityLevel(mins),
        dayOfWeek: dayIndex, // 0 = Mon, 6 = Sun
      });

      // Track month transitions for header
      const month = iteratingDate.getMonth();
      if (month !== lastMonth && dayIndex === 0) {
        monthLabels.push({
          name: iteratingDate.toLocaleString('default', { month: 'short' }),
          columnIndex: w,
        });
        lastMonth = month;
      }

      iteratingDate.setDate(iteratingDate.getDate() + 1);
    }

    weeks.push(weekColumn);
  }

  return { weeks, monthLabels };
}

/**
 * Calculates current consecutive days of focus activity (streak).
 * If user hasn't recorded focus minutes today yet, checks backward from yesterday.
 */
export function calculateFocusStreak(
  records: Record<string, DailyStats>,
  referenceDate: Date = new Date()
): number {
  let streak = 0;
  const d = new Date(referenceDate);
  const todayKey = formatDateKey(d);
  const todayMinutes = records[todayKey]?.focusMinutes ?? 0;

  if (todayMinutes === 0) {
    d.setDate(d.getDate() - 1);
  }

  while (true) {
    const key = formatDateKey(d);
    const mins = records[key]?.focusMinutes ?? 0;
    if (mins > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Calculates number of days companion has been with the user (minimum 1 day).
 */
export function calculateCompanionDays(
  firstLaunchDateStr?: string,
  currentDate: Date = new Date()
): number {
  if (!firstLaunchDateStr) return 1;

  const firstDate = new Date(firstLaunchDateStr);
  if (isNaN(firstDate.getTime())) return 1;

  const diffMs = currentDate.getTime() - firstDate.getTime();
  if (diffMs <= 0) return 1;

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, days);
}

/**
 * Parses stats.json contents and safely migrates legacy records.
 * Legacy records containing breaks/waters are preserved without crashing,
 * dropping the legacy fields and initializing pomodoros / tasksDone.
 */
export function parseStats(jsonString: string): Record<string, DailyStats> {
  const result: Record<string, DailyStats> = {};
  if (!jsonString || typeof jsonString !== 'string') return result;

  try {
    const raw = JSON.parse(jsonString);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return result;
    }

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') {
        continue;
      }
      const entry = value as Record<string, unknown>;
      result[key] = {
        date: typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : key,
        pomodoros:
          typeof entry.pomodoros === 'number' && Number.isFinite(entry.pomodoros)
            ? Math.max(0, Math.floor(entry.pomodoros))
            : 0,
        tasksDone:
          typeof entry.tasksDone === 'number' && Number.isFinite(entry.tasksDone)
            ? Math.max(0, Math.floor(entry.tasksDone))
            : 0,
        focusMinutes:
          typeof entry.focusMinutes === 'number' && Number.isFinite(entry.focusMinutes)
            ? Math.max(0, Math.floor(entry.focusMinutes))
            : 0,
        distractions:
          typeof entry.distractions === 'number' && Number.isFinite(entry.distractions)
            ? Math.max(0, Math.floor(entry.distractions))
            : 0,
      };
    }
  } catch {
    // Return empty record on JSON syntax errors without crashing
    return {};
  }

  return result;
}
