import type { DashboardApi } from '../../preload/dashboardPreload';
import type { CompanionName, Settings } from '../../core/settings';
import { COMPANION_NAMES } from '../../core/settings';
import { t } from '../../core/i18n';
import { createCard, createStepper } from './components';
import { CatCompanion } from '../companions/CatCompanion';
import { FoxCompanion } from '../companions/FoxCompanion';
import { GhostCompanion } from '../companions/GhostCompanion';
import { RobotCompanion } from '../companions/RobotCompanion';
import { WebHeroCompanion } from '../companions/WebHeroCompanion';
import { ParticleEngine } from '../../engine/particles/ParticleEngine';

declare global {
  interface Window {
    deskpals: DashboardApi;
  }
}

const COMPANION_LABELS: Record<CompanionName, string> = {
  cat: '🐱 Cat',
  fox: '🦊 Fox',
  ghost: '👻 Ghost',
  robot: '🤖 Robot',
  webhero: '🕸️ Web Hero',
};

export function renderPetTab(container: HTMLElement, settings: Settings, onSettingsChange: (s: Settings) => void): void {
  container.innerHTML = '';
  const lang = settings.language;

  const { card, body } = createCard(t('pet_title', lang), 'Select which pal accompanies your screen and adjust their individual size.');
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  grid.style.gap = '14px';

  const particles = new ParticleEngine();

  for (const name of COMPANION_NAMES) {
    const isSelected = settings.companion === name;
    const petCard = document.createElement('div');
    petCard.className = 'dash-card';
    petCard.style.alignItems = 'center';
    petCard.style.padding = '14px';
    petCard.style.cursor = 'pointer';
    petCard.style.position = 'relative';
    petCard.style.border = isSelected ? '2px solid var(--primary)' : '1px solid var(--border)';
    petCard.style.background = isSelected ? 'rgba(168, 85, 247, 0.08)' : 'var(--bg-card)';

    // Active Badge
    if (isSelected) {
      const badge = document.createElement('span');
      badge.innerText = `✓ ${t('pet_selected', lang)}`;
      badge.style.position = 'absolute';
      badge.style.top = '8px';
      badge.style.right = '8px';
      badge.style.fontSize = '10px';
      badge.style.fontWeight = '700';
      badge.style.color = 'var(--primary)';
      badge.style.background = 'rgba(168, 85, 247, 0.2)';
      badge.style.padding = '2px 6px';
      badge.style.borderRadius = '4px';
      petCard.appendChild(badge);
    }

    // Canvas Preview
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 80;
    canvas.style.display = 'block';
    petCard.appendChild(canvas);

    // Draw static preview
    const ctx = canvas.getContext('2d');
    if (ctx) {
      let previewCompanion;
      const x = 50;
      const y = 74;
      switch (name) {
        case 'cat': previewCompanion = new CatCompanion('p-cat', 'BOTTOM', x, y, particles); break;
        case 'fox': previewCompanion = new FoxCompanion('p-fox', 'BOTTOM', x, y, particles); break;
        case 'ghost': previewCompanion = new GhostCompanion('p-ghost', 'BOTTOM', x, y, particles); break;
        case 'robot': previewCompanion = new RobotCompanion('p-robot', 'BOTTOM', x, y, particles); break;
        case 'webhero': previewCompanion = new WebHeroCompanion('p-hero', 'BOTTOM', x, y, particles); break;
      }
      previewCompanion.update(0.1, { x: 0, y: 0, width: 100, height: 80 });
      previewCompanion.render(ctx);
    }

    // Name label
    const nameLabel = document.createElement('div');
    nameLabel.innerText = COMPANION_LABELS[name];
    nameLabel.style.fontWeight = '700';
    nameLabel.style.fontSize = '13px';
    nameLabel.style.marginTop = '6px';
    petCard.appendChild(nameLabel);

    // Click to select
    petCard.addEventListener('click', async (e) => {
      // Don't trigger if clicked inside the stepper
      if ((e.target as HTMLElement).closest('.stepper-group')) return;
      if (settings.companion !== name) {
        const updated = await window.deskpals.updateSettings({ companion: name });
        onSettingsChange(updated);
        renderPetTab(container, updated, onSettingsChange);
      }
    });

    // Per-companion scale stepper
    const scaleContainer = document.createElement('div');
    scaleContainer.style.display = 'flex';
    scaleContainer.style.flexDirection = 'column';
    scaleContainer.style.alignItems = 'center';
    scaleContainer.style.gap = '4px';
    scaleContainer.style.marginTop = '8px';

    const scaleTitle = document.createElement('span');
    scaleTitle.innerText = t('pet_size', lang);
    scaleTitle.style.fontSize = '10px';
    scaleTitle.style.color = 'var(--text-muted)';
    scaleContainer.appendChild(scaleTitle);

    const currentScale = settings.companionScales?.[name] ?? 100;
    const stepper = createStepper({
      value: currentScale,
      min: 50,
      max: 200,
      step: 10,
      unit: '%',
      onChange: async (newVal) => {
        const newScales = { ...settings.companionScales, [name]: newVal };
        const updated = await window.deskpals.updateSettings({ companionScales: newScales });
        onSettingsChange(updated);
      },
    });
    scaleContainer.appendChild(stepper);
    petCard.appendChild(scaleContainer);

    grid.appendChild(petCard);
  }

  body.appendChild(grid);
  container.appendChild(card);
}
