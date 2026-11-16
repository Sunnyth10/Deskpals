/**
 * Pomodoro data models and pure state machine transitions.
 * Timers and state run deterministically based on timestamps to survive sleep/wake.
 */

export type PomodoroPhase = 'idle' | 'work' | 'shortBreak' | 'longBreak';

export interface PomodoroSettings {
  workMinutes: number; // default 25
  shortBreakMinutes: number; // default 5
  longBreakMinutes: number; // default 15
  roundsBeforeLongBreak: number; // default 4
  autoStartNext: boolean; // default false
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
  autoStartNext: false,
};

export interface PomodoroState {
  phase: PomodoroPhase;
  paused: boolean;
  round: number; // 1 to roundsBeforeLongBreak
  targetTimestamp: number | null; // epoch ms when current phase ends
  remainingSeconds: number; // cached seconds when paused or idle
}

export interface PomodoroStatus {
  phase: PomodoroPhase;
  paused: boolean;
  round: number;
  totalRounds: number;
  secondsRemaining: number;
  totalSeconds: number;
  formattedTime: string; // MM:SS
}

export function createInitialPomodoroState(settings: PomodoroSettings = DEFAULT_POMODORO_SETTINGS): PomodoroState {
  return {
    phase: 'idle',
    paused: false,
    round: 1,
    targetTimestamp: null,
    remainingSeconds: settings.workMinutes * 60,
  };
}

export function formatTimeMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function getPhaseDurationSeconds(phase: PomodoroPhase, settings: PomodoroSettings): number {
  switch (phase) {
    case 'work':
      return settings.workMinutes * 60;
    case 'shortBreak':
      return settings.shortBreakMinutes * 60;
    case 'longBreak':
      return settings.longBreakMinutes * 60;
    case 'idle':
      return settings.workMinutes * 60;
  }
}

export function getPomodoroSecondsRemaining(state: PomodoroState, now = Date.now()): number {
  if (state.phase === 'idle' || state.paused || state.targetTimestamp === null) {
    return state.remainingSeconds;
  }
  const diffMs = state.targetTimestamp - now;
  return Math.max(0, Math.ceil(diffMs / 1000));
}

export function getPomodoroStatus(
  state: PomodoroState,
  settings: PomodoroSettings,
  now = Date.now()
): PomodoroStatus {
  const secondsRemaining = getPomodoroSecondsRemaining(state, now);
  const totalSeconds = getPhaseDurationSeconds(state.phase, settings);

  return {
    phase: state.phase,
    paused: state.paused,
    round: state.round,
    totalRounds: settings.roundsBeforeLongBreak,
    secondsRemaining,
    totalSeconds,
    formattedTime: formatTimeMMSS(secondsRemaining),
  };
}

export function startPomodoro(
  state: PomodoroState,
  settings: PomodoroSettings,
  now = Date.now()
): PomodoroState {
  if (state.phase === 'idle') {
    const duration = settings.workMinutes * 60;
    return {
      phase: 'work',
      paused: false,
      round: 1,
      targetTimestamp: now + duration * 1000,
      remainingSeconds: duration,
    };
  }

  if (state.paused) {
    const remaining = state.remainingSeconds;
    return {
      ...state,
      paused: false,
      targetTimestamp: now + remaining * 1000,
    };
  }

  return state;
}

export function pausePomodoro(
  state: PomodoroState,
  now = Date.now()
): PomodoroState {
  if (state.phase === 'idle' || state.paused) return state;

  const remaining = getPomodoroSecondsRemaining(state, now);
  return {
    ...state,
    paused: true,
    targetTimestamp: null,
    remainingSeconds: remaining,
  };
}

export function resetPomodoro(
  settings: PomodoroSettings
): PomodoroState {
  return createInitialPomodoroState(settings);
}

export function nextPhaseAfter(
  currentPhase: PomodoroPhase,
  currentRound: number,
  roundsBeforeLongBreak: number
): { nextPhase: PomodoroPhase; nextRound: number } {
  if (currentPhase === 'work') {
    if (currentRound >= roundsBeforeLongBreak) {
      return { nextPhase: 'longBreak', nextRound: currentRound };
    }
    return { nextPhase: 'shortBreak', nextRound: currentRound };
  } else if (currentPhase === 'shortBreak') {
    return { nextPhase: 'work', nextRound: currentRound + 1 };
  } else {
    // After longBreak
    return { nextPhase: 'work', nextRound: 1 };
  }
}

export function skipPomodoro(
  state: PomodoroState,
  settings: PomodoroSettings,
  now = Date.now()
): PomodoroState {
  if (state.phase === 'idle') return state;

  const { nextPhase, nextRound } = nextPhaseAfter(
    state.phase,
    state.round,
    settings.roundsBeforeLongBreak
  );

  const duration = getPhaseDurationSeconds(nextPhase, settings);
  if (settings.autoStartNext) {
    return {
      phase: nextPhase,
      paused: false,
      round: nextRound,
      targetTimestamp: now + duration * 1000,
      remainingSeconds: duration,
    };
  } else {
    return {
      phase: nextPhase,
      paused: true,
      round: nextRound,
      targetTimestamp: null,
      remainingSeconds: duration,
    };
  }
}

export interface TickResult {
  newState: PomodoroState;
  completedPhase: 'work' | 'shortBreak' | 'longBreak' | null;
  completedMinutes: number;
}

export function tickPomodoro(
  state: PomodoroState,
  settings: PomodoroSettings,
  now = Date.now()
): TickResult {
  if (state.phase === 'idle' || state.paused || state.targetTimestamp === null) {
    return { newState: state, completedPhase: null, completedMinutes: 0 };
  }

  if (now < state.targetTimestamp) {
    return { newState: state, completedPhase: null, completedMinutes: 0 };
  }

  // Current phase completed
  const completedPhase = state.phase as 'work' | 'shortBreak' | 'longBreak';
  const completedMinutes = Math.round(getPhaseDurationSeconds(completedPhase, settings) / 60);

  const { nextPhase, nextRound } = nextPhaseAfter(
    state.phase,
    state.round,
    settings.roundsBeforeLongBreak
  );

  const nextDuration = getPhaseDurationSeconds(nextPhase, settings);

  let newState: PomodoroState;
  if (settings.autoStartNext) {
    newState = {
      phase: nextPhase,
      paused: false,
      round: nextRound,
      targetTimestamp: now + nextDuration * 1000,
      remainingSeconds: nextDuration,
    };
  } else {
    newState = {
      phase: nextPhase,
      paused: true,
      round: nextRound,
      targetTimestamp: null,
      remainingSeconds: nextDuration,
    };
  }

  return { newState, completedPhase, completedMinutes };
}
