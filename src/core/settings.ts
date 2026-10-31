export type CompanionName = 'cat' | 'fox' | 'ghost' | 'robot' | 'webhero';

export interface Settings {
  companion: CompanionName;
  displayId: number | null;
  paused: boolean;
}

export const COMPANION_NAMES: readonly CompanionName[] = ['cat', 'fox', 'ghost', 'robot', 'webhero'];
export const DEFAULT_SETTINGS: Settings = { companion: 'cat', displayId: null, paused: false };

/** Enforce the one-companion renderer contract; invalid or empty IPC data falls back to cat. */
export function selectSingleCompanion(names: readonly string[]): CompanionName {
  const candidate = names[0];
  return COMPANION_NAMES.includes(candidate as CompanionName)
    ? candidate as CompanionName
    : DEFAULT_SETTINGS.companion;
}

/** Parse new settings and migrate the previous `companions` array format. */
export function parseSettings(contents: string): Settings {
  const parsed: unknown = JSON.parse(contents);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('settings must contain a JSON object');
  }

  const raw = parsed as Record<string, unknown>;
  const valid = new Set<string>(COMPANION_NAMES);
  const hasCurrentSelection = Object.prototype.hasOwnProperty.call(raw, 'companion');
  const candidate = hasCurrentSelection
    ? raw.companion
    : Array.isArray(raw.companions) ? raw.companions[0] : undefined;
  const selected = typeof candidate === 'string' && valid.has(candidate)
    ? candidate as CompanionName : DEFAULT_SETTINGS.companion;

  return {
    companion: selected,
    displayId: typeof raw.displayId === 'number' && Number.isFinite(raw.displayId) ? raw.displayId : null,
    paused: raw.paused === true,
  };
}
