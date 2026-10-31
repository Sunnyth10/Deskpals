import { EffectType, ZoneBounds } from '../../core/types';

export interface BaseParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  rotation: number;
  rotationSpeed: number;
  type: EffectType;
  custom?: Record<string, number | string>;
}

/**
 * ParticleEngine
 * High-performance particle engine supporting Glitters, Fireflies, Leaves, Stars, and Rain.
 * Supports configurable density, zone clipping, and batch rendering.
 */
export class ParticleEngine {
  private particles: BaseParticle[] = [];
  private maxParticles = 120;
  private density = 1;
  private glittersEnabled = false;

  // Active effect types for the current theme
  private activeEffects: Set<EffectType> = new Set();

  constructor() {}

  public setEffects(effects: EffectType[]): void {
    this.activeEffects = new Set(effects);
  }

  public setGlittersEnabled(enabled: boolean): void {
    this.glittersEnabled = enabled;
  }

  public setDensity(density: number): void {
    this.density = Number.isFinite(density) ? Math.max(0, Math.min(2, density)) : 1;
    this.trimToLimit();
  }

  private getParticleLimit(): number {
    return Math.floor(this.maxParticles * this.density);
  }

  private trimToLimit(): void {
    const limit = this.getParticleLimit();
    if (this.particles.length > limit) {
      this.particles.splice(0, this.particles.length - limit);
    }
  }

  public getParticleCount(type?: EffectType): number {
    return type ? this.particles.filter((particle) => particle.type === type).length : this.particles.length;
  }

  public clear(): void {
    this.particles = [];
  }

  /**
   * Spawn a burst of sparkling glitters at a specific coordinate (e.g. from butterfly wings or click)
   */
  public spawnGlitterBurst(x: number, y: number, count = 8, colorPalette?: string[]): void {
    if (!this.glittersEnabled || !this.activeEffects.has('glitters')) {
      return;
    }

    const defaultColors = ['#ffd700', '#00f0ff', '#ffffff', '#ff99e6', '#c084fc'];
    const palette = colorPalette || defaultColors;

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.getParticleLimit()) {
        break;
      }
      const angle = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 17;
      const color = palette[Math.floor(Math.random() * palette.length)];
      const life = 1.2 + Math.random() * 1.8;

      this.particles.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.7 - 8, // slight upward flutter
        size: 0.8 + Math.random() * 1.5,
        color,
        alpha: 1.0,
        life,
        maxLife: life,
        rotation: Math.random() * Math.PI,
        rotationSpeed: (Math.random() - 0.5) * 6,
        type: 'glitters',
        custom: {
          shimmerSpeed: 2 + Math.random() * 3,
          shimmerPhase: Math.random() * Math.PI * 2,
        },
      });
    }
  }

  /**
   * Spawns ambient environmental particles (Leaves, Fireflies, Rain, Stars) based on active effects
   */
  public spawnAmbient(bounds: ZoneBounds): void {
    const rateMultiplier = 1.0;

    // Ambient Glitters (soft floating fairy dust in peripheral zones)
    if (this.glittersEnabled && this.activeEffects.has('glitters')) {
      if (Math.random() < 0.15 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const x = bounds.x + Math.random() * bounds.width;
        const y = bounds.y + Math.random() * bounds.height;
        this.spawnGlitterBurst(x, y, 1);
      }
    }

    // Fireflies (night jungle / ambient)
    if (this.activeEffects.has('fireflies')) {
      if (Math.random() < 0.08 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const life = 4 + Math.random() * 6;
        this.particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y + Math.random() * bounds.height,
          vx: (Math.random() - 0.5) * 15,
          vy: (Math.random() - 0.5) * 15,
          size: 3 + Math.random() * 3,
          color: Math.random() > 0.3 ? '#a3e635' : '#facc15', // Lime/Gold bioluminescence
          alpha: 0.1,
          life,
          maxLife: life,
          rotation: 0,
          rotationSpeed: 0,
          type: 'fireflies',
          custom: {
            pulsePhase: Math.random() * Math.PI * 2,
            pulseSpeed: 1.5 + Math.random() * 2,
          },
        });
      }
    }

    // Falling Leaves (jungle / cozy)
    if (this.activeEffects.has('leaves')) {
      if (Math.random() < 0.06 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const colors = ['#22c55e', '#16a34a', '#84cc16', '#eab308', '#f97316'];
        const life = 6 + Math.random() * 6;
        this.particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y - 10,
          vx: 10 + Math.random() * 20,
          vy: 20 + Math.random() * 25,
          size: 6 + Math.random() * 5,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 0.85,
          life,
          maxLife: life,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 2,
          type: 'leaves',
          custom: {
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: 1.8 + Math.random() * 1.5,
          },
        });
      }
    }

    // Rain (cozy room)
    if (this.activeEffects.has('rain')) {
      const rainCount = Math.floor(2 * rateMultiplier * this.density);
      for (let i = 0; i < rainCount; i++) {
        if (this.particles.length < this.getParticleLimit()) {
          const life = 1.2 + Math.random() * 0.8;
          this.particles.push({
            x: bounds.x + Math.random() * bounds.width,
            y: bounds.y - 15,
            vx: -30,
            vy: 280 + Math.random() * 120,
            size: 1.5,
            color: '#7dd3fc',
            alpha: 0.4 + Math.random() * 0.3,
            life,
            maxLife: life,
            rotation: Math.PI / 12, // slight wind slant
            rotationSpeed: 0,
            type: 'rain',
          });
        }
      }
    }

    // Cosmic Stars (space)
    if (this.activeEffects.has('stars')) {
      if (Math.random() < 0.1 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const life = 3 + Math.random() * 5;
        this.particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y + Math.random() * bounds.height,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          size: 1 + Math.random() * 2.5,
          color: Math.random() > 0.5 ? '#93c5fd' : '#ffffff',
          alpha: 0.1,
          life,
          maxLife: life,
          rotation: 0,
          rotationSpeed: 0,
          type: 'stars',
          custom: {
            twinkleSpeed: 2 + Math.random() * 4,
            twinklePhase: Math.random() * Math.PI * 2,
          },
        });
      }
    }

    // Sakura Petals (Japanese Garden)
    if (this.activeEffects.has('sakura')) {
      if (Math.random() < 0.12 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const colors = ['#fbcfe8', '#f472b6', '#fce7f3', '#fda4af'];
        const life = 5 + Math.random() * 5;
        this.particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y - 10,
          vx: 15 + Math.random() * 25,
          vy: 18 + Math.random() * 20,
          size: 4 + Math.random() * 3,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 0.85,
          life,
          maxLife: life,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 3,
          type: 'sakura',
          custom: {
            swayPhase: Math.random() * Math.PI * 2,
            swaySpeed: 2.2 + Math.random() * 1.5,
          },
        });
      }
    }

    // Neon embers
    if (this.activeEffects.has('embers')) {
      if (Math.random() < 0.15 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const colors = ['#00f0ff', '#f97316', '#ff0055', '#38bdf8'];
        const life = 1.5 + Math.random() * 2.0;
        this.particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y + bounds.height + 10,
          vx: (Math.random() - 0.5) * 20,
          vy: -35 - Math.random() * 45,
          size: 1.5 + Math.random() * 2.5,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 0.9,
          life,
          maxLife: life,
          rotation: 0,
          rotationSpeed: 0,
          type: 'embers',
        });
      }
    }

    // Underwater Bubbles (Ocean)
    if (this.activeEffects.has('bubbles')) {
      if (Math.random() < 0.14 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const life = 3.5 + Math.random() * 4;
        this.particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y + bounds.height,
          vx: (Math.random() - 0.5) * 12,
          vy: -(18 + Math.random() * 25),
          size: 2 + Math.random() * 4,
          color: '#bae6fd',
          alpha: 0.5,
          life,
          maxLife: life,
          rotation: 0,
          rotationSpeed: 0,
          type: 'bubbles',
          custom: {
            wobblePhase: Math.random() * Math.PI * 2,
            wobbleSpeed: 2 + Math.random() * 2.5,
          },
        });
      }
    }

    // Snow (Winter)
    if (this.activeEffects.has('snow')) {
      if (Math.random() < 0.2 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
        const life = 5 + Math.random() * 5;
        this.particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y - 5,
          vx: (Math.random() - 0.5) * 14,
          vy: 18 + Math.random() * 22,
          size: 1.5 + Math.random() * 3,
          color: '#dbeafe',
          alpha: 0.7 + Math.random() * 0.3,
          life,
          maxLife: life,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 1.5,
          type: 'snow',
          custom: { wobblePhase: Math.random() * Math.PI * 2 },
        });
      }
    }

    // Desert dust sweeps along the top and bottom edges, keeping the code area clear.
    if (this.activeEffects.has('sand') && Math.random() < 0.24 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
      const fromLeft = Math.random() < 0.5;
      const fromTop = Math.random() < 0.5;
      const bandHeight = Math.min(80, bounds.height * 0.15);
      const life = 4 + Math.random() * 3;
      this.particles.push({
        x: fromLeft ? bounds.x + 2 : bounds.x + bounds.width - 2,
        y: fromTop
          ? bounds.y + Math.random() * bandHeight
          : bounds.y + bounds.height - Math.random() * Math.min(100, bounds.height * 0.18),
        vx: (fromLeft ? 1 : -1) * (55 + Math.random() * 55),
        vy: (Math.random() - 0.5) * 10,
        size: 1.8 + Math.random() * 2.6,
        color: ['#fbbf24', '#fde68a', '#fb923c'][Math.floor(Math.random() * 3)],
        alpha: 0.9,
        life,
        maxLife: life,
        rotation: 0,
        rotationSpeed: 0,
        type: 'sand',
      });
    }

    // Bats fly inward through the top margin, rather than disappearing off-screen
    // or blending into the dark workspace.
    if (this.activeEffects.has('bats') && Math.random() < 0.09 * rateMultiplier * this.density && this.particles.length < this.getParticleLimit()) {
      const fromLeft = Math.random() < 0.5;
      const size = 9 + Math.random() * 4;
      const life = 8 + Math.random() * 4;
      const bandHeight = Math.min(80, bounds.height * 0.15);
      this.particles.push({
        x: fromLeft ? bounds.x + size : bounds.x + bounds.width - size,
        y: bounds.y + size + Math.random() * Math.max(0, bandHeight - size * 2),
        vx: (fromLeft ? 1 : -1) * (55 + Math.random() * 40),
        vy: (Math.random() - 0.5) * 12,
        size,
        color: '#c084fc',
        alpha: 0.95,
        life,
        maxLife: life,
        rotation: 0,
        rotationSpeed: 0,
        type: 'bats',
        custom: {
          wingPhase: Math.random() * Math.PI * 2,
          wingSpeed: 8 + Math.random() * 6,
        },
      });
    }
  }

  public update(dt: number, bounds: ZoneBounds): void {
    this.spawnAmbient(bounds);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // Life decay factor
      const lifeFraction = p.life / p.maxLife;

      switch (p.type) {
        case 'glitters': {
          // Slow down velocity due to air resistance & subtle gravity
          p.vx *= 0.96;
          p.vy = p.vy * 0.96 + 18 * dt; // gentle gravity
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rotation += p.rotationSpeed * dt;

          // Twinkling sparkle alpha
          const shimmerSpeed = (p.custom?.shimmerSpeed as number) || 10;
          const shimmerPhase = (p.custom?.shimmerPhase as number) || 0;
          const shimmer = 0.5 + 0.5 * Math.sin(shimmerPhase + (p.maxLife - p.life) * shimmerSpeed);
          p.alpha = lifeFraction * shimmer;
          break;
        }

        case 'fireflies': {
          // Organic sine drift
          const pulseSpeed = (p.custom?.pulseSpeed as number) || 2;
          const pulsePhase = (p.custom?.pulsePhase as number) || 0;
          const phase = pulsePhase + (p.maxLife - p.life) * pulseSpeed;

          p.vx += Math.sin(phase) * 12 * dt;
          p.vy += Math.cos(phase * 0.7) * 12 * dt;
          p.vx = Math.max(-25, Math.min(25, p.vx));
          p.vy = Math.max(-25, Math.min(25, p.vy));

          p.x += p.vx * dt;
          p.y += p.vy * dt;

          // Bioluminescent breathing glow curve
          const glow = Math.pow(Math.sin(phase), 2);
          p.alpha = Math.min(1.0, glow * 0.9 + 0.1) * Math.sin(lifeFraction * Math.PI);
          break;
        }

        case 'leaves': {
          // Pendulum sway + downward tumble
          const swaySpeed = (p.custom?.swaySpeed as number) || 2;
          const swayPhase = (p.custom?.swayPhase as number) || 0;
          const currentSway = Math.sin(swayPhase + (p.maxLife - p.life) * swaySpeed);

          p.x += (p.vx + currentSway * 30) * dt;
          p.y += p.vy * dt;
          p.rotation += p.rotationSpeed * dt;
          p.alpha = Math.min(0.9, lifeFraction * 1.5);
          break;
        }

        case 'rain': {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          break;
        }

        case 'stars': {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const twinkleSpeed = (p.custom?.twinkleSpeed as number) || 3;
          const twinklePhase = (p.custom?.twinklePhase as number) || 0;
          const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(twinklePhase + (p.maxLife - p.life) * twinkleSpeed));
          p.alpha = twinkle * Math.sin(lifeFraction * Math.PI);
          break;
        }

        case 'sakura': {
          const swaySpeed = (p.custom?.swaySpeed as number) || 2;
          const swayPhase = (p.custom?.swayPhase as number) || 0;
          const currentSway = Math.sin(swayPhase + (p.maxLife - p.life) * swaySpeed);
          p.x += (p.vx + currentSway * 24) * dt;
          p.y += p.vy * dt;
          p.rotation += p.rotationSpeed * dt;
          p.alpha = Math.min(0.9, lifeFraction * 1.3);
          break;
        }

        case 'embers': {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.alpha = lifeFraction * (0.6 + 0.4 * Math.sin(p.life * 15));
          break;
        }

        case 'bubbles': {
          const wobbleSpeed = (p.custom?.wobbleSpeed as number) || 2;
          const wobblePhase = (p.custom?.wobblePhase as number) || 0;
          p.vx += Math.sin(wobblePhase + (p.maxLife - p.life) * wobbleSpeed) * 8 * dt;
          p.vx = Math.max(-15, Math.min(15, p.vx));
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.alpha = Math.min(0.55, lifeFraction * 0.8);
          break;
        }

        case 'snow': {
          const wobblePhase = (p.custom?.wobblePhase as number) || 0;
          p.vx += Math.sin(wobblePhase + (p.maxLife - p.life) * 1.5) * 12 * dt;
          p.vx = Math.max(-20, Math.min(20, p.vx));
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rotation += p.rotationSpeed * dt;
          p.alpha = lifeFraction > 0.9 ? (1 - lifeFraction) * 10 * 0.8 : Math.min(0.85, lifeFraction * 4);
          break;
        }

        case 'sand': {
          p.vx *= Math.pow(0.998, dt * 60);
          p.vy += 3 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.alpha = lifeFraction * 0.6;
          break;
        }

        case 'bats': {
          const wingSpeed = (p.custom?.wingSpeed as number) || 8;
          const wingPhase = (p.custom?.wingPhase as number) || 0;
          p.vy += Math.sin(wingPhase + (p.maxLife - p.life) * wingSpeed) * 25 * dt;
          p.vy = Math.max(-40, Math.min(40, p.vy));
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.x < bounds.x + p.size) {
            p.x = bounds.x + p.size;
            p.vx = Math.abs(p.vx);
          } else if (p.x > bounds.x + bounds.width - p.size) {
            p.x = bounds.x + bounds.width - p.size;
            p.vx = -Math.abs(p.vx);
          }
          p.alpha = lifeFraction * 0.85;
          break;
        }
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D): void {
    if (this.particles.length === 0) {
      return;
    }

    ctx.save();

    for (const p of this.particles) {
      if (p.alpha <= 0.01) {
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));

      switch (p.type) {
        case 'glitters':
          this.renderGlitter(ctx, p);
          break;
        case 'fireflies':
          this.renderFirefly(ctx, p);
          break;
        case 'leaves':
          this.renderLeaf(ctx, p);
          break;
        case 'rain':
          this.renderRain(ctx, p);
          break;
        case 'stars':
          this.renderStar(ctx, p);
          break;
        case 'sakura':
          this.renderSakura(ctx, p);
          break;
        case 'embers':
          this.renderEmber(ctx, p);
          break;
        case 'bubbles':
          this.renderBubble(ctx, p);
          break;
        case 'snow':
          this.renderSnow(ctx, p);
          break;
        case 'sand':
          this.renderSand(ctx, p);
          break;
        case 'bats':
          this.renderBat(ctx, p);
          break;
      }

      ctx.restore();
    }

    ctx.restore();
  }

  private renderSakura(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    ctx.rotate(p.rotation);
    const flip = Math.cos(p.rotation * 1.5);
    ctx.scale(1, flip);

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, -p.size);
    ctx.bezierCurveTo(p.size * 0.7, -p.size * 0.5, p.size * 0.7, p.size * 0.5, 0, p.size);
    ctx.bezierCurveTo(-p.size * 0.7, p.size * 0.5, -p.size * 0.7, -p.size * 0.5, 0, -p.size);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(0, -p.size * 0.4, p.size * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderEmber(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /**
   * Realistic 4-point twinkling star flare with diamond core and soft glowing radial aura
   */
  private renderGlitter(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    // Soft golden points, matching the small glowing specks in the reference.
    const haloRadius = p.size * 3.5;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, haloRadius);
    gradient.addColorStop(0, 'rgba(255, 244, 166, 0.95)');
    gradient.addColorStop(0.18, p.color);
    gradient.addColorStop(1, 'rgba(255, 221, 100, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff5c4';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(0.45, p.size * 0.48), 0, Math.PI * 2);
    ctx.fill();
  }

  private renderFirefly(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    // Bioluminescent orb with dual-layer radial gradient
    const glowRadius = p.size * 3.5;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, p.color);
    grad.addColorStop(0.7, p.color.replace(')', ', 0.3)').replace('rgb', 'rgba'));
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderLeaf(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    ctx.rotate(p.rotation);
    // 3D tumble flip factor
    const tumble = Math.cos(p.rotation * 1.5);
    ctx.scale(1, tumble);

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, -p.size);
    ctx.bezierCurveTo(p.size * 0.7, -p.size * 0.4, p.size * 0.7, p.size * 0.4, 0, p.size);
    ctx.bezierCurveTo(-p.size * 0.7, p.size * 0.4, -p.size * 0.7, -p.size * 0.4, 0, -p.size);
    ctx.fill();

    // Leaf center vein
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -p.size * 0.8);
    ctx.lineTo(0, p.size * 0.8);
    ctx.stroke();
  }

  private renderRain(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    ctx.rotate(p.rotation);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.stroke();
  }

  private renderStar(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderBubble(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    // Translucent sphere with rim highlight
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, Math.PI * 2);
    ctx.stroke();

    // Highlight spec
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(-p.size * 0.3, -p.size * 0.35, p.size * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderSnow(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    ctx.rotate(p.rotation);
    // 6-pointed snowflake
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 0.8;
    for (let arm = 0; arm < 6; arm++) {
      const angle = (arm / 6) * Math.PI * 2;
      const ex = Math.cos(angle) * p.size;
      const ey = Math.sin(angle) * p.size;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ex, ey);
      // Side branches
      ctx.moveTo(ex * 0.5 + Math.cos(angle + Math.PI / 3) * p.size * 0.35, ey * 0.5 + Math.sin(angle + Math.PI / 3) * p.size * 0.35);
      ctx.lineTo(ex * 0.5, ey * 0.5);
      ctx.lineTo(ex * 0.5 + Math.cos(angle - Math.PI / 3) * p.size * 0.35, ey * 0.5 + Math.sin(angle - Math.PI / 3) * p.size * 0.35);
      ctx.stroke();
    }
    // Center dot
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  private renderSand(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    // Warm, softly glowing dust grain that remains visible against dark themes.
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private renderBat(ctx: CanvasRenderingContext2D, p: BaseParticle): void {
    const wingPhase = (p.custom?.wingPhase as number) || 0;
    const wingSpeed = (p.custom?.wingSpeed as number) || 8;
    // Wing flap angle driven by time
    const flapAngle = Math.sin(wingPhase + (p.maxLife - p.life) * wingSpeed) * 0.6;

    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 7;

    // Body
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size * 0.35, p.size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Left wing
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
      -p.size * 0.5, -p.size * flapAngle,
      -p.size, -p.size * flapAngle * 0.8,
      -p.size, p.size * 0.2
    );
    ctx.bezierCurveTo(-p.size * 0.6, p.size * 0.1, -p.size * 0.3, p.size * 0.15, 0, 0);
    ctx.fill();

    // Right wing (mirror)
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
      p.size * 0.5, -p.size * flapAngle,
      p.size, -p.size * flapAngle * 0.8,
      p.size, p.size * 0.2
    );
    ctx.bezierCurveTo(p.size * 0.6, p.size * 0.1, p.size * 0.3, p.size * 0.15, 0, 0);
    ctx.fill();

    // Ears
    ctx.beginPath();
    ctx.moveTo(-p.size * 0.2, -p.size * 0.2);
    ctx.lineTo(-p.size * 0.35, -p.size * 0.5);
    ctx.lineTo(-p.size * 0.08, -p.size * 0.22);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.size * 0.2, -p.size * 0.2);
    ctx.lineTo(p.size * 0.35, -p.size * 0.5);
    ctx.lineTo(p.size * 0.08, -p.size * 0.22);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(-p.size * 0.13, -p.size * 0.05, 0.8, 0, Math.PI * 2);
    ctx.arc(p.size * 0.13, -p.size * 0.05, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
}
