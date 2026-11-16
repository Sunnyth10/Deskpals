import type { SpeechBubbleMessage, CountdownPayload } from '../shared/ipc-channels';
import type { ZoneBounds } from '../core/types';

export interface ActiveBubble {
  id: string;
  text: string;
  subtext?: string;
  kind?: string;
  durationMs: number;
  createdAt: number;
  alpha: number;
  width: number;
  height: number;
}

export class SpeechBubbleManager {
  private queue: SpeechBubbleMessage[] = [];
  private active: ActiveBubble | null = null;
  private countdown: CountdownPayload | null = null;

  public showMessage(msg: SpeechBubbleMessage, defaultDurationSec = 6): void {
    const durationSec = msg.durationSeconds ?? defaultDurationSec;
    const item: SpeechBubbleMessage = { ...msg, durationSeconds: durationSec };

    if (!this.active) {
      this.activate(item);
    } else {
      this.queue.push(item);
    }
  }

  public setCountdown(cd: CountdownPayload | null): void {
    this.countdown = cd;
  }

  public dismiss(): void {
    this.active = null;
    if (this.queue.length > 0) {
      this.activate(this.queue.shift()!);
    }
  }

  private activate(msg: SpeechBubbleMessage): void {
    this.active = {
      id: msg.id,
      text: msg.text,
      subtext: msg.subtext,
      kind: msg.kind,
      durationMs: (msg.durationSeconds ?? 6) * 1000,
      createdAt: performance.now(),
      alpha: 0,
      width: 160,
      height: 48,
    };
  }

  public update(now: number = performance.now()): void {
    if (!this.active) {
      if (this.queue.length > 0) {
        this.activate(this.queue.shift()!);
      }
      return;
    }

    const elapsed = now - this.active.createdAt;
    const fadeMs = 250;

    // Fade in
    if (elapsed < fadeMs) {
      this.active.alpha = elapsed / fadeMs;
    } else if (elapsed > this.active.durationMs - fadeMs) {
      // Fade out
      this.active.alpha = Math.max(0, (this.active.durationMs - elapsed) / fadeMs);
    } else {
      this.active.alpha = 1;
    }

    if (elapsed >= this.active.durationMs) {
      this.dismiss();
    }
  }

  public hasContent(): boolean {
    return this.active !== null || this.countdown !== null;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    anchorX: number,
    anchorY: number,
    bounds?: ZoneBounds
  ): void {
    const now = performance.now();
    this.update(now);

    // Render Countdown pill if active and no priority modal bubble
    if (this.countdown && !this.active) {
      if (this.countdown.targetTimestamp && Date.now() >= this.countdown.targetTimestamp + 1000) {
        // Countdown has elapsed; yield so the alert bubble displays cleanly at 00
      } else {
        this.renderCountdownPill(ctx, anchorX, anchorY, this.countdown, bounds);
        return;
      }
    }

    if (!this.active || this.active.alpha <= 0) return;

    const bubble = this.active;
    const pad = 12;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, bubble.alpha));

    // Measure text
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const mainWidth = ctx.measureText(bubble.text).width;
    let subWidth = 0;
    if (bubble.subtext) {
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      subWidth = ctx.measureText(bubble.subtext).width;
    }

    const contentWidth = Math.max(mainWidth, subWidth);
    const boxW = Math.max(120, Math.min(300, contentWidth + pad * 2 + 16));
    const boxH = bubble.subtext ? 46 : 34;

    // Position above the anchor point
    let boxX = anchorX - boxW / 2;
    let boxY = anchorY - 14 - boxH;

    // Clamp inside stage bounds so the bubble doesn't get clipped off-screen
    if (bounds) {
      boxX = Math.max(bounds.x + 8, Math.min(bounds.x + bounds.width - boxW - 8, boxX));
      if (boxY < bounds.y + 4) {
        boxY = Math.max(bounds.y + 4, boxY);
      }
    }

    // Draw speech bubble body with shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    ctx.fillStyle = '#1c1e24';
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 1.5;

    // Rounded rectangle path
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxW - r, boxY);
    ctx.quadraticCurveTo(boxX + boxW, boxY, boxX + boxW, boxY + r);
    ctx.lineTo(boxX + boxW, boxY + boxH - r);
    ctx.quadraticCurveTo(boxX + boxW, boxY + boxH, boxX + boxW - r, boxY + boxH);

    // Anchor tail pointing to companion head
    const tailBaseX = Math.max(boxX + 16, Math.min(boxX + boxW - 16, anchorX));
    const tailTipX = Math.max(boxX + 8, Math.min(boxX + boxW - 8, anchorX));
    const tailTipY = Math.max(boxY + boxH + 2, Math.min(boxY + boxH + 12, anchorY - 2));

    ctx.lineTo(tailBaseX + 7, boxY + boxH);
    ctx.lineTo(tailTipX, tailTipY);
    ctx.lineTo(tailBaseX - 7, boxY + boxH);

    ctx.lineTo(boxX + r, boxY + boxH);
    ctx.quadraticCurveTo(boxX, boxY + boxH, boxX, boxY + boxH - r);
    ctx.lineTo(boxX, boxY + r);
    ctx.quadraticCurveTo(boxX, boxY, boxX + r, boxY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Reset shadow for crisp text
    ctx.shadowColor = 'transparent';

    // Kind icon prefix
    let icon = '💬';
    if (bubble.kind === 'alert') icon = '⏰';

    // Draw main text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${icon} ${bubble.text}`, boxX + pad, boxY + (bubble.subtext ? 16 : boxH / 2));

    // Draw subtext
    if (bubble.subtext) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(bubble.subtext, boxX + pad + 18, boxY + 32);
    }

    ctx.restore();
  }

  private renderCountdownPill(
    ctx: CanvasRenderingContext2D,
    anchorX: number,
    anchorY: number,
    cd: CountdownPayload,
    bounds?: ZoneBounds
  ): void {
    ctx.save();
    let timeStr = `${cd.minutesLeft}m`;
    if (cd.targetTimestamp && typeof cd.targetTimestamp === 'number') {
      const diffSec = Math.max(0, Math.floor((cd.targetTimestamp - Date.now()) / 1000));
      const hours = Math.floor(diffSec / 3600);
      const minutes = Math.floor((diffSec % 3600) / 60);
      const seconds = diffSec % 60;
      if (hours > 0) {
        timeStr = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      } else {
        timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      }
    }
    const label = `⏰ ${cd.taskName}: ${timeStr}`;
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textW = ctx.measureText(label).width;

    const pillW = textW + 18;
    const pillH = 22;
    let pillX = anchorX - pillW / 2;
    let pillY = anchorY - 10 - pillH;

    if (bounds) {
      pillX = Math.max(bounds.x + 8, Math.min(bounds.x + bounds.width - pillW - 8, pillX));
      if (pillY < bounds.y + 4) {
        pillY = Math.max(bounds.y + 4, pillY);
      }
    }

    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = 'rgba(28, 30, 36, 0.92)';
    ctx.strokeStyle = '#38bdf8'; // Cyan countdown border
    ctx.lineWidth = 1.2;

    const r = pillH / 2;
    ctx.beginPath();
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(pillX, pillY, pillW, pillH, r);
    } else {
      ctx.moveTo(pillX + r, pillY);
      ctx.lineTo(pillX + pillW - r, pillY);
      ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
      ctx.lineTo(pillX + pillW, pillY + pillH - r);
      ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
      ctx.lineTo(pillX + r, pillY + pillH);
      ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
      ctx.lineTo(pillX, pillY + r);
      ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
    }
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#f3f4f6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pillX + pillW / 2, pillY + pillH / 2);

    ctx.restore();
  }

  public containsPoint(
    px: number,
    py: number,
    anchorX: number,
    anchorY: number,
    bounds?: ZoneBounds
  ): boolean {
    if (!this.active || this.active.alpha < 0.2) return false;
    const boxW = 160;
    const boxH = 46;
    let boxX = anchorX - boxW / 2;
    let boxY = anchorY - 14 - boxH;
    if (bounds) {
      boxX = Math.max(bounds.x + 8, Math.min(bounds.x + bounds.width - boxW - 8, boxX));
      if (boxY < bounds.y + 4) boxY = Math.max(bounds.y + 4, boxY);
    }
    return px >= boxX && px <= boxX + boxW && py >= boxY && py <= boxY + boxH + 10;
  }
}
