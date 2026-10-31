/** Trimmed from the VS Code extension: only the types the companions and particle engine need. */

export type ZoneType = 'TOP' | 'LEFT' | 'RIGHT' | 'BOTTOM' | 'BACKGROUND';

export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CompanionType = 'cat' | 'webhero' | 'fox' | 'robot' | 'dragon' | 'ghost' | 'none';

export type EffectType =
  | 'glitters' | 'fireflies' | 'leaves' | 'stars' | 'rain' | 'embers'
  | 'sakura' | 'bubbles' | 'snow' | 'sand' | 'bats';

export type LivingEventType = 'save' | 'run' | 'buildSuccess' | 'buildError';

export interface IEntity {
  readonly id: string;
  readonly zone: ZoneType;
  x: number;
  y: number;
  isDisposed: boolean;

  update(dt: number, bounds: ZoneBounds): void;
  render(ctx: CanvasRenderingContext2D): void;
  dispose(): void;
}
