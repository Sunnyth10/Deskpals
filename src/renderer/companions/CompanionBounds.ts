import { CompanionType, ZoneBounds } from '../../core/types';

const HALF_WIDTH_LOCAL: Partial<Record<CompanionType, number>> = {
  cat: 44,
  fox: 44,
  ghost: 30,
  webhero: 30,
  robot: 40,
};

const MAX_SCALE: Partial<Record<CompanionType, number>> = {
  cat: 1.2,
  fox: 0.95,
  ghost: 1.3,
  webhero: 1.3,
  robot: 1.15,
};

export function companionHalfWidth(companion: CompanionType): number {
  return (HALF_WIDTH_LOCAL[companion] ?? 0) * (MAX_SCALE[companion] ?? 1);
}

export function companionXBounds(companion: CompanionType, zone: ZoneBounds): { minX: number; maxX: number } {
  const margin = Math.min(companionHalfWidth(companion), zone.width / 2);
  return { minX: zone.x + margin, maxX: zone.x + zone.width - margin };
}

export function clampCompanionX(companion: CompanionType, x: number, zone: ZoneBounds): number {
  const { minX, maxX } = companionXBounds(companion, zone);
  return Math.min(maxX, Math.max(minX, x));
}
