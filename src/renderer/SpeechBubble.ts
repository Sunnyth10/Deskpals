import type { SpeechBubbleMessage, CountdownPayload } from '../shared/ipc-channels';

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

  public render(ctx: CanvasRenderingContext2D, companionX: number, companionY: number): void {
    const now = performance.now();
    this.update(now);

    // Render Countdown pill if active and no priority modal bubble
    if (this.countdown && !this.active) {
      this.renderCountdownPill(ctx, companionX, companionY - 70, this.countdown);
      return;
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

    const boxX = companionX - boxW / 2;
    const boxY = companionY - 70 - boxH;

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
    const tailX = companionX;
    const tailY = boxY + boxH + 8;
    ctx.lineTo(tailX + 7, boxY + boxH);
    ctx.lineTo(tailX, tailY);
    ctx.lineTo(tailX - 7, boxY + boxH);

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
    if (bubble.kind === 'break') icon = '☕';
    else if (bubble.kind === 'water') icon = '💧';
    else if (bubble.kind === 'alert') icon = '⏰';

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
    x: number,
    y: number,
    cd: CountdownPayload
  ): void {
    ctx.save();
    const label = `⏰ ${cd.taskName}: ${cd.minutesLeft}m`;
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textW = ctx.measureText(label).width;

    const pillW = textW + 18;
    const pillH = 22;
    const pillX = x - pillW / 2;
    const pillY = y - pillH;

    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = 'rgba(28, 30, 36, 0.92)';
    ctx.strokeStyle = '#38bdf8'; // Cyan countdown border
    ctx.lineWidth = 1.2;

    const r = pillH / 2;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, r);
    ctx.fill();
    ctx.stroke();

    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#f3f4f6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, pillY + pillH / 2);

    ctx.restore();
  }

  public containsPoint(px: number, py: number, companionX: number, companionY: number): boolean {
    if (!this.active || this.active.alpha < 0.2) return false;
    const boxW = 160;
    const boxH = 46;
    const boxX = companionX - boxW / 2;
    const boxY = companionY - 70 - boxH;
    return px >= boxX && px <= boxX + boxW && py >= boxY && py <= boxY + boxH + 10;
  }
}
