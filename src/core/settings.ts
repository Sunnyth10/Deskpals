import type { SupportedLanguage } from './i18n';
export type { SupportedLanguage };
import type { ReminderItem } from './reminders';
import { formatDateKey } from './stats';
import { DEFAULT_POMODORO_SETTINGS, type PomodoroSettings } from './pomodoro';
export type { PomodoroSettings };

export type CompanionName = 'cat' | 'fox' | 'ghost' | 'robot' | 'webhero';
export type DashboardTab = 'stats' | 'pet' | 'reminders' | 'settings';
export type RunDirection = 'left' | 'right' | 'both';

export interface AppearanceSettings {
  petSizePercent: number; // 50 - 300, default 100
  lyricsMode: boolean; // default false (permanent click-through)
  bubbleDurationSeconds: number; // 2 - 30, default 6
}

export interface MotionSettings {
  autoRun: boolean;
  runDirection: RunDirection;
  runFrequencySeconds: number; // seconds between run checks (default 20)
  runDurationSeconds: number; // seconds to run for (default 4)
  idleMotionFrequencySeconds: number; // seconds between idle shifts (default 8)
}

export interface FocusSettings {
  enabled: boolean;
  sessionDurationMinutes: number; // default 25
  blockedApps: string[];
  blockedKeywords: string[];
}

export interface Settings {
  companion: CompanionName;
  companionScales: Record<CompanionName, number>; // per-companion scale in percent (50 - 300)
  displayId: number | null;
  paused: boolean;
  activeTab: DashboardTab;
  firstLaunchDate: string; // 'YYYY-MM-DD'
  firstLaunchShown: boolean;
  language: SupportedLanguage;
  appearance: AppearanceSettings;
  motion: MotionSettings;
  reminders: ReminderItem[];
  focus: FocusSettings;
  pomodoro: PomodoroSettings;
}

export const COMPANION_NAMES: readonly CompanionName[] = ['cat', 'fox', 'ghost', 'robot', 'webhero'];

export const DEFAULT_SETTINGS: Settings = {
  companion: 'cat',
  companionScales: {
    cat: 100,
    fox: 100,
    ghost: 100,
    robot: 100,
    webhero: 100,
  },
  displayId: null,
  paused: false,
  activeTab: 'stats',
  firstLaunchDate: formatDateKey(new Date()),
  firstLaunchShown: false,
  language: 'en',
  appearance: {
    petSizePercent: 100,
    lyricsMode: false,
    bubbleDurationSeconds: 6,
  },
  motion: {
    autoRun: true,
    runDirection: 'both',
    runFrequencySeconds: 20,
    runDurationSeconds: 4,
    idleMotionFrequencySeconds: 8,
  },
  reminders: [],
  focus: {
    enabled: false,
    sessionDurationMinutes: 25,
    blockedApps: ['Twitter', 'X', 'Reddit', 'Discord', 'YouTube', 'Steam', 'TikTok'],
    blockedKeywords: ['twitter', 'reddit', 'facebook', 'instagram', 'youtube', 'netflix', 'game'],
  },
  pomodoro: DEFAULT_POMODORO_SETTINGS,
};

/** Enforce the one-companion renderer contract; invalid or empty IPC data falls back to cat. */
export function selectSingleCompanion(names: readonly string[]): CompanionName {
  const candidate = names[0];
  return COMPANION_NAMES.includes(candidate as CompanionName)
    ? (candidate as CompanionName)
    : DEFAULT_SETTINGS.companion;
}

const VALID_TABS = new Set<DashboardTab>(['stats', 'pet', 'reminders', 'settings']);
const VALID_RUN_DIRECTIONS = new Set<RunDirection>(['left', 'right', 'both']);
const VALID_LANGUAGES = new Set<SupportedLanguage>(['en', 'es']);

/** Parse settings and safely migrate previous formats with complete schema defaults. */
export function parseSettings(contents: string): Settings {
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('settings must contain a JSON object');
  }

  const raw = parsed as Record<string, unknown>;
  const validCompanions = new Set<string>(COMPANION_NAMES);

  // Companion selection migration (legacy companions array -> companion string)
  const hasCurrentSelection = Object.prototype.hasOwnProperty.call(raw, 'companion');
  const candidate = hasCurrentSelection
    ? raw.companion
    : Array.isArray(raw.companions)
      ? raw.companions[0]
      : undefined;
  const selected =
    typeof candidate === 'string' && validCompanions.has(candidate)
      ? (candidate as CompanionName)
      : DEFAULT_SETTINGS.companion;

  // Tab migration
  const tabCandidate = raw.activeTab as DashboardTab;
  const activeTab = VALID_TABS.has(tabCandidate) ? tabCandidate : DEFAULT_SETTINGS.activeTab;

  // Language migration
  const langCandidate = raw.language as SupportedLanguage;
  const language = VALID_LANGUAGES.has(langCandidate) ? langCandidate : DEFAULT_SETTINGS.language;

  // Appearance migration
  const rawApp = (raw.appearance && typeof raw.appearance === 'object'
    ? raw.appearance
    : {}) as Record<string, unknown>;
  const appearance: AppearanceSettings = {
    petSizePercent:
      typeof rawApp.petSizePercent === 'number' && Number.isFinite(rawApp.petSizePercent)
        ? Math.min(300, Math.max(50, rawApp.petSizePercent))
        : DEFAULT_SETTINGS.appearance.petSizePercent,
    lyricsMode: rawApp.lyricsMode === true,
    bubbleDurationSeconds:
      typeof rawApp.bubbleDurationSeconds === 'number' && Number.isFinite(rawApp.bubbleDurationSeconds)
        ? Math.min(30, Math.max(2, rawApp.bubbleDurationSeconds))
        : DEFAULT_SETTINGS.appearance.bubbleDurationSeconds,
  };

  // Companion scales
  const rawScales = (raw.companionScales && typeof raw.companionScales === 'object'
    ? raw.companionScales
    : {}) as Record<string, unknown>;
  const companionScales: Record<CompanionName, number> = { ...DEFAULT_SETTINGS.companionScales };
  for (const name of COMPANION_NAMES) {
    if (typeof rawScales[name] === 'number' && Number.isFinite(rawScales[name])) {
      companionScales[name] = Math.min(300, Math.max(50, rawScales[name] as number));
    }
  }

  // Motion migration
  const rawMotion = (raw.motion && typeof raw.motion === 'object'
    ? raw.motion
    : {}) as Record<string, unknown>;
  const dirCandidate = rawMotion.runDirection as RunDirection;
  const motion: MotionSettings = {
    autoRun: rawMotion.autoRun !== false,
    runDirection: VALID_RUN_DIRECTIONS.has(dirCandidate) ? dirCandidate : DEFAULT_SETTINGS.motion.runDirection,
    runFrequencySeconds:
      typeof rawMotion.runFrequencySeconds === 'number' && Number.isFinite(rawMotion.runFrequencySeconds)
        ? Math.max(2, rawMotion.runFrequencySeconds)
        : DEFAULT_SETTINGS.motion.runFrequencySeconds,
    runDurationSeconds:
      typeof rawMotion.runDurationSeconds === 'number' && Number.isFinite(rawMotion.runDurationSeconds)
        ? Math.max(1, rawMotion.runDurationSeconds)
        : DEFAULT_SETTINGS.motion.runDurationSeconds,
    idleMotionFrequencySeconds:
      typeof rawMotion.idleMotionFrequencySeconds === 'number' && Number.isFinite(rawMotion.idleMotionFrequencySeconds)
        ? Math.max(2, rawMotion.idleMotionFrequencySeconds)
        : DEFAULT_SETTINGS.motion.idleMotionFrequencySeconds,
  };

  // Reminders migration
  const reminders: ReminderItem[] = Array.isArray(raw.reminders)
    ? raw.reminders.filter((r): r is ReminderItem =>
        r &&
        typeof r === 'object' &&
        typeof (r as ReminderItem).id === 'string' &&
        typeof (r as ReminderItem).task === 'string' &&
        typeof (r as ReminderItem).time === 'string'
      ).map((r) => ({
        id: r.id,
        task: r.task,
        time: r.time,
        enabled: r.enabled !== false,
        petCountdown: r.petCountdown === true,
        showBeforeMinutes:
          typeof r.showBeforeMinutes === 'number' && Number.isFinite(r.showBeforeMinutes)
            ? Math.max(1, r.showBeforeMinutes)
            : 10,
        enlargeOnAlert: r.enlargeOnAlert === true,
      }))
    : [];

  // Focus migration
  const rawFocus = (raw.focus && typeof raw.focus === 'object'
    ? raw.focus
    : {}) as Record<string, unknown>;
  const focus: FocusSettings = {
    enabled: rawFocus.enabled === true,
    sessionDurationMinutes:
      typeof rawFocus.sessionDurationMinutes === 'number' && Number.isFinite(rawFocus.sessionDurationMinutes)
        ? Math.max(1, rawFocus.sessionDurationMinutes)
        : DEFAULT_SETTINGS.focus.sessionDurationMinutes,
    blockedApps: Array.isArray(rawFocus.blockedApps)
      ? rawFocus.blockedApps.filter((a): a is string => typeof a === 'string')
      : [...DEFAULT_SETTINGS.focus.blockedApps],
    blockedKeywords: Array.isArray(rawFocus.blockedKeywords)
      ? rawFocus.blockedKeywords.filter((k): k is string => typeof k === 'string')
      : [...DEFAULT_SETTINGS.focus.blockedKeywords],
  };

  // Pomodoro migration
  const rawPomo = (raw.pomodoro && typeof raw.pomodoro === 'object'
    ? raw.pomodoro
    : {}) as Record<string, unknown>;
  const pomodoro: PomodoroSettings = {
    workMinutes:
      typeof rawPomo.workMinutes === 'number' && Number.isFinite(rawPomo.workMinutes)
        ? Math.min(120, Math.max(1, Math.round(rawPomo.workMinutes)))
        : DEFAULT_SETTINGS.pomodoro.workMinutes,
    shortBreakMinutes:
      typeof rawPomo.shortBreakMinutes === 'number' && Number.isFinite(rawPomo.shortBreakMinutes)
        ? Math.min(60, Math.max(1, Math.round(rawPomo.shortBreakMinutes)))
        : DEFAULT_SETTINGS.pomodoro.shortBreakMinutes,
    longBreakMinutes:
      typeof rawPomo.longBreakMinutes === 'number' && Number.isFinite(rawPomo.longBreakMinutes)
        ? Math.min(90, Math.max(1, Math.round(rawPomo.longBreakMinutes)))
        : DEFAULT_SETTINGS.pomodoro.longBreakMinutes,
    roundsBeforeLongBreak:
      typeof rawPomo.roundsBeforeLongBreak === 'number' && Number.isFinite(rawPomo.roundsBeforeLongBreak)
        ? Math.min(12, Math.max(1, Math.round(rawPomo.roundsBeforeLongBreak)))
        : DEFAULT_SETTINGS.pomodoro.roundsBeforeLongBreak,
    autoStartNext: rawPomo.autoStartNext === true,
  };

  return {
    companion: selected,
    companionScales,
    displayId:
      typeof raw.displayId === 'number' && Number.isFinite(raw.displayId) ? raw.displayId : null,
    paused: raw.paused === true,
    activeTab,
    firstLaunchDate:
      typeof raw.firstLaunchDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.firstLaunchDate)
        ? raw.firstLaunchDate
        : DEFAULT_SETTINGS.firstLaunchDate,
    firstLaunchShown: raw.firstLaunchShown === true,
    language,
    appearance,
    motion,
    reminders,
    focus,
    pomodoro,
  };
}
