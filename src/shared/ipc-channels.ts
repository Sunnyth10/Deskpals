/**
 * Centralized typed IPC channels and payloads for DeskPals.
 * Strictly decoupled across Main and Renderers.
 */
export type { Settings } from '../core/settings';
export type { DailyStats, SevenDaysSummary, HeatmapGrid } from '../core/stats';
export type { ReminderItem, ScheduledAlert } from '../core/reminders';
export type { PomodoroStatus, PomodoroPhase } from '../core/pomodoro';
export type { TodoItem, TodoPriority } from '../core/todos';

export const IPC_CHANNELS = {
  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_UPDATED: 'settings:updated',

  // Reminders
  REMINDERS_GET: 'reminders:get',
  REMINDERS_SAVE: 'reminders:save',
  REMINDERS_DELETE: 'reminders:delete',
  REMINDERS_TRIGGER: 'reminders:trigger',

  // Stats
  STATS_GET: 'stats:get',
  STATS_RECORD: 'stats:record',
  STATS_UPDATED: 'stats:updated',

  // Focus Mode
  FOCUS_START: 'focus:start',
  FOCUS_STOP: 'focus:stop',
  FOCUS_STATUS: 'focus:status',
  FOCUS_STATE_CHANGED: 'focus:state-changed',

  // Pomodoro
  POMODORO_GET_STATUS: 'pomodoro:status',
  POMODORO_START: 'pomodoro:start',
  POMODORO_PAUSE: 'pomodoro:pause',
  POMODORO_SKIP: 'pomodoro:skip',
  POMODORO_RESET: 'pomodoro:reset',
  POMODORO_STATUS_CHANGED: 'pomodoro:status-changed',

  // Todos
  TODOS_GET: 'todos:get',
  TODOS_ADD: 'todos:add',
  TODOS_UPDATE: 'todos:update',
  TODOS_TOGGLE: 'todos:toggle',
  TODOS_DELETE: 'todos:delete',
  TODOS_CLEAR_COMPLETED: 'todos:clear-completed',
  TODOS_UPDATED: 'todos:updated',

  // Overlay interactions
  OVERLAY_READY: 'overlay:ready',
  OVERLAY_INTERACTIVE: 'overlay:interactive',
  OVERLAY_GRAB: 'overlay:grab',
  OVERLAY_MENU: 'overlay:menu',
  OVERLAY_PAUSE: 'overlay:pause',
  OVERLAY_BUBBLE: 'overlay:bubble',
  OVERLAY_COUNTDOWN: 'overlay:countdown',
  OVERLAY_ENLARGE: 'overlay:enlarge',
  COMPANIONS_SET: 'companions:set',

  // Dashboard Window
  DASHBOARD_OPEN: 'dashboard:open',
  DASHBOARD_TAB_CHANGED: 'dashboard:tab-changed',
  APP_GET_ACTIVE_APP: 'app:get-active-app',
} as const;

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

export interface FocusStatus {
  active: boolean;
  minutesRemaining: number;
  totalSessionMinutes: number;
  currentDistractions: number;
}

export interface SpeechBubbleMessage {
  id: string;
  text: string;
  kind?: 'info' | 'alert' | 'countdown';
  durationSeconds?: number;
  subtext?: string;
}

export interface CountdownPayload {
  taskName: string;
  minutesLeft: number;
  formattedTime: string;
  targetTimestamp?: number;
}
