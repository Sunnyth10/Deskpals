/**
 * Reminders data models and pure scheduling helper functions.
 */

export interface ReminderItem {
  id: string;
  task: string;
  time: string; // "HH:mm" (24-hour format)
  enabled: boolean;
  petCountdown: boolean;
  showBeforeMinutes: number; // default 10 minutes
  enlargeOnAlert: boolean;
}

export interface ScheduledAlert {
  reminderId: string;
  task: string;
  dueTime: Date;
  enlargeOnAlert: boolean;
}

/**
 * Calculates the next Date when this "HH:mm" will occur.
 * If the time has already passed today, it rolls over to tomorrow at the same time.
 */
export function calculateNextOccurrence(timeStr: string, fromDate: Date = new Date()): Date {
  const [hourStr, minuteStr] = timeStr.split(':');
  const targetHour = parseInt(hourStr, 10);
  const targetMinute = parseInt(minuteStr, 10);

  if (isNaN(targetHour) || isNaN(targetMinute)) {
    throw new Error(`Invalid time format: "${timeStr}". Expected "HH:mm".`);
  }

  const next = new Date(fromDate);
  next.setHours(targetHour, targetMinute, 0, 0);

  // If next occurrence is earlier than or equal to current time, move to tomorrow
  if (next.getTime() <= fromDate.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

/**
 * Returns integer minutes remaining until target Date (rounded up, min 0).
 */
export function getMinutesUntil(targetDate: Date, fromDate: Date = new Date()): number {
  const diffMs = targetDate.getTime() - fromDate.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (60 * 1000));
}

/**
 * Evaluates whether a reminder should fire at `now`.
 * A reminder fires if:
 * 1. It is enabled.
 * 2. It has not already fired today.
 * 3. The current time has reached or passed its scheduled time today.
 * 4. The current time is within maxElapsedMs (default 60s) of the scheduled time.
 */
export function isReminderDue(
  reminder: ReminderItem,
  now: Date = new Date(),
  alreadyFiredToday = false,
  maxElapsedMs = 60000
): boolean {
  if (!reminder.enabled || alreadyFiredToday) return false;

  const [hStr, mStr] = reminder.time.split(':');
  const targetHour = parseInt(hStr, 10);
  const targetMinute = parseInt(mStr, 10);
  if (isNaN(targetHour) || isNaN(targetMinute)) return false;

  const todayTarget = new Date(now);
  todayTarget.setHours(targetHour, targetMinute, 0, 0);

  const diffMs = now.getTime() - todayTarget.getTime();
  return diffMs >= 0 && diffMs <= maxElapsedMs;
}

/**
 * Checks if a reminder's pet countdown should be displayed right now.
 * Active when: reminder is enabled, petCountdown is true, and minutes remaining <= showBeforeMinutes.
 */
export function isCountdownActive(
  reminder: ReminderItem,
  fromDate: Date = new Date(),
  alreadyFiredToday = false
): { active: boolean; minutesLeft: number; nextDate: Date } {
  if (!reminder.enabled || !reminder.petCountdown || alreadyFiredToday) {
    return { active: false, minutesLeft: 0, nextDate: new Date() };
  }

  const nextDate = calculateNextOccurrence(reminder.time, fromDate);
  const minutesLeft = getMinutesUntil(nextDate, fromDate);
  const active = minutesLeft > 0 && minutesLeft <= reminder.showBeforeMinutes;

  return { active, minutesLeft, nextDate };
}

/**
 * Formats a Date or "HH:mm" string into human readable 12-hour format: "02:00 PM"
 */
export function formatTime12(input: Date | string): string {
  let hours: number;
  let minutes: number;

  if (input instanceof Date) {
    hours = input.getHours();
    minutes = input.getMinutes();
  } else {
    const [h, m] = input.split(':').map((s) => parseInt(s, 10));
    hours = h;
    minutes = m;
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const padH = displayHours < 10 ? `0${displayHours}` : `${displayHours}`;
  const padM = minutes < 10 ? `0${minutes}` : `${minutes}`;

  return `${padH}:${padM} ${period}`;
}

/**
 * Generates the live status text: "Next: 02:00 PM (13min)"
 */
export function formatLiveNext(reminder: ReminderItem, fromDate: Date = new Date()): string {
  if (!reminder.enabled) {
    return 'Disabled';
  }

  const next = calculateNextOccurrence(reminder.time, fromDate);
  const mins = getMinutesUntil(next, fromDate);
  const timeFormatted = formatTime12(next);

  if (mins < 60) {
    return `Next: ${timeFormatted} (${mins}min)`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `Next: ${timeFormatted} (${hrs}h ${remMins}m)`;
}
