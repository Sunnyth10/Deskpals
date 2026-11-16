import type { DashboardApi } from '../../preload/dashboardPreload';
import type { Settings } from '../../core/settings';
import { t } from '../../core/i18n';
import type { DayMetricPoint, HeatmapGrid, SevenDaysSummary } from '../../core/stats';
import { createCard } from './components';

declare global {
  interface Window {
    deskpals: DashboardApi;
  }
}

const INTENSITY_COLORS = [
  '#23262f', // 0: 0m
  '#581c87', // 1: 1-15m
  '#7e22ce', // 2: 16-30m
  '#a855f7', // 3: 31-60m
  '#c084fc', // 4: >60m
];

function generateSparklineSvg(
  points: DayMetricPoint[],
  key: 'pomodoros' | 'tasksDone' | 'focusMinutes' | 'distractions',
  strokeColor: string,
  fillGradientId: string
): string {
  const w = 240;
  const h = 50;
  const padX = 6;
  const padY = 6;

  const values = points.map((p) => p[key]);
  const maxVal = Math.max(1, ...values);
  const minVal = 0;

  const coords = values.map((val, i) => {
    const x = padX + (i / (values.length - 1)) * (w - padX * 2);
    const y = h - padY - ((val - minVal) / (maxVal - minVal)) * (h - padY * 2);
    return { x, y, val };
  });

  const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const polygonPoints = `${coords[0].x},${h} ${polylinePoints} ${coords[coords.length - 1].x},${h}`;

  const circles = coords
    .map(
      (c) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="${strokeColor}"><title>${c.val}</title></circle>`
    )
    .join('');

  return `
    <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow: visible;">
      <defs>
        <linearGradient id="${fillGradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <polygon points="${polygonPoints}" fill="url(#${fillGradientId})" />
      <polyline fill="none" stroke="${strokeColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${polylinePoints}" />
      ${circles}
    </svg>
  `;
}

export async function renderStatsTab(container: HTMLElement, settings: Settings): Promise<() => void> {
  container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:40px;">Loading stats...</div>';
  const lang = settings.language;

  const data = await window.deskpals.getStats();
  const summary: SevenDaysSummary = data.sevenDays;
  const heatmap: HeatmapGrid = data.heatmap;
  const companionDays: number = data.companionDays;

  container.innerHTML = '';

  // Top Section: 4 Stat Cards
  const cardsGrid = document.createElement('div');
  cardsGrid.className = 'grid-4';

  const metricsConfig = [
    {
      title: t('stats_pomodoros', lang),
      today: summary.today.pomodoros,
      unit: '',
      color: 'var(--accent-blue)',
      key: 'pomodoros' as const,
      gradId: 'grad-pomodoro',
    },
    {
      title: t('stats_tasks_done', lang),
      today: summary.today.tasksDone,
      unit: '',
      color: 'var(--accent-green)',
      key: 'tasksDone' as const,
      gradId: 'grad-tasks',
    },
    {
      title: t('stats_focus', lang),
      today: summary.today.focusMinutes,
      unit: 'min',
      color: 'var(--primary)',
      key: 'focusMinutes' as const,
      gradId: 'grad-focus',
    },
    {
      title: t('stats_distractions', lang),
      today: summary.today.distractions,
      unit: '',
      color: 'var(--accent-red)',
      key: 'distractions' as const,
      gradId: 'grad-distract',
    },
  ];

  for (const m of metricsConfig) {
    const card = document.createElement('div');
    card.className = 'dash-card';
    card.style.padding = '14px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'baseline';

    const titleEl = document.createElement('span');
    titleEl.innerText = m.title;
    titleEl.style.fontSize = '12px';
    titleEl.style.color = 'var(--text-muted)';
    titleEl.style.fontWeight = '600';

    const todayEl = document.createElement('span');
    todayEl.innerText = m.unit ? `${m.today} ${m.unit}` : `${m.today}`;
    todayEl.style.fontSize = '22px';
    todayEl.style.fontWeight = '800';
    todayEl.style.color = m.color;

    header.appendChild(titleEl);
    header.appendChild(todayEl);
    card.appendChild(header);

    // Sparkline
    const sparklineDiv = document.createElement('div');
    sparklineDiv.innerHTML = generateSparklineSvg(summary.days, m.key, m.color, m.gradId);
    card.appendChild(sparklineDiv);

    // X-Axis range (e.g. 11/7 ... 11/13)
    const rangeEl = document.createElement('div');
    rangeEl.style.display = 'flex';
    rangeEl.style.justifyContent = 'space-between';
    rangeEl.style.fontSize = '10px';
    rangeEl.style.color = 'var(--text-dim)';
    rangeEl.style.marginTop = '4px';
    rangeEl.innerHTML = `<span>${summary.firstDateLabel}</span><span>${summary.lastDateLabel}</span>`;
    card.appendChild(rangeEl);

    cardsGrid.appendChild(card);
  }

  container.appendChild(cardsGrid);

  // Companion Days Card
  const { card: daysCard, body: daysBody } = createCard(t('stats_companion_days', lang));
  daysBody.style.flexDirection = 'row';
  daysBody.style.alignItems = 'center';
  daysBody.style.gap = '16px';

  const daysNumber = document.createElement('div');
  daysNumber.innerText = `${companionDays}`;
  daysNumber.style.fontSize = '42px';
  daysNumber.style.fontWeight = '900';
  daysNumber.style.color = 'var(--primary)';
  daysNumber.style.lineHeight = '1';

  const daysLabel = document.createElement('div');
  daysLabel.innerText = t('stats_days_active', lang);
  daysLabel.style.fontSize = '14px';
  daysLabel.style.color = 'var(--text)';
  daysLabel.style.fontWeight = '600';

  daysBody.appendChild(daysNumber);
  daysBody.appendChild(daysLabel);
  container.appendChild(daysCard);

  // Focus Heatmap Grid (GitHub style 52 weeks x 7 days)
  const { card: heatCard, body: heatBody } = createCard(t('stats_focus_heatmap', lang));

  const heatContainer = document.createElement('div');
  heatContainer.style.overflowX = 'auto';
  heatContainer.style.padding = '8px 0';

  const cellW = 11;
  const cellH = 11;
  const gap = 3;
  const leftPad = 32;
  const topPad = 18;

  const totalSvgW = leftPad + 52 * (cellW + gap);
  const totalSvgH = topPad + 7 * (cellH + gap);

  // Month labels header
  let monthLabelsSvg = '';
  for (const m of heatmap.monthLabels) {
    const x = leftPad + m.columnIndex * (cellW + gap);
    monthLabelsSvg += `<text x="${x}" y="12" fill="#9ca3af" font-size="9" font-family="system-ui">${m.name}</text>`;
  }

  // Row labels (Mon, Wed, Fri)
  const rowLabelsSvg = `
    <text x="6" y="${topPad + 1 * (cellH + gap) - 2}" fill="#6b7280" font-size="9" font-family="system-ui">${t('stats_mon', lang)}</text>
    <text x="6" y="${topPad + 3 * (cellH + gap) - 2}" fill="#6b7280" font-size="9" font-family="system-ui">${t('stats_wed', lang)}</text>
    <text x="6" y="${topPad + 5 * (cellH + gap) - 2}" fill="#6b7280" font-size="9" font-family="system-ui">${t('stats_fri', lang)}</text>
  `;

  // Grid cells
  let cellsSvg = '';
  heatmap.weeks.forEach((week, wIdx) => {
    const x = leftPad + wIdx * (cellW + gap);
    week.forEach((cell, dayIdx) => {
      const y = topPad + dayIdx * (cellH + gap);
      const color = INTENSITY_COLORS[cell.intensity];
      cellsSvg += `
        <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="2" ry="2" fill="${color}">
          <title>${cell.date}: ${cell.focusMinutes} focus min(s)</title>
        </rect>
      `;
    });
  });

  // Legend at bottom
  const legendSvg = `
    <g transform="translate(${totalSvgW - 130}, ${totalSvgH + 10})">
      <text x="0" y="9" fill="#9ca3af" font-size="10" font-family="system-ui">${t('stats_less', lang)}</text>
      ${INTENSITY_COLORS.map(
        (c, idx) => `<rect x="${32 + idx * 14}" y="0" width="10" height="10" rx="2" ry="2" fill="${c}"/>`
      ).join('')}
      <text x="106" y="9" fill="#9ca3af" font-size="10" font-family="system-ui">${t('stats_more', lang)}</text>
    </g>
  `;

  heatContainer.innerHTML = `
    <svg width="${totalSvgW}" height="${totalSvgH + 28}" viewBox="0 0 ${totalSvgW} ${totalSvgH + 28}">
      ${monthLabelsSvg}
      ${rowLabelsSvg}
      ${cellsSvg}
      ${legendSvg}
    </svg>
  `;

  heatBody.appendChild(heatContainer);
  container.appendChild(heatCard);

  // Subscribe to live stats updates
  const unsubscribe = window.deskpals.onStatsUpdated(() => {
    // Only re-render if the container is still attached and document is visible
    if (!document.hidden && container.isConnected) {
      renderStatsTab(container, settings);
    }
  });

  return unsubscribe;
}
