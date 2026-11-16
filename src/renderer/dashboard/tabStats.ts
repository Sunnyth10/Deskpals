import type { DashboardApi } from '../../preload/dashboardPreload';
import type { Settings } from '../../core/settings';
import { t } from '../../core/i18n';
import type { DayMetricPoint, HeatmapGrid, SevenDaysSummary } from '../../core/stats';
import type { PomodoroStatus } from '../../shared/ipc-channels';
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

function generateSmoothSparklineSvg(
  points: DayMetricPoint[],
  key: 'pomodoros' | 'tasksDone' | 'focusMinutes' | 'distractions',
  strokeColor: string,
  fillGradientId: string
): string {
  const w = 240;
  const h = 50;
  const padX = 6;
  const padY = 8;

  const values = points.map((p) => p[key]);
  const maxVal = Math.max(1, ...values);
  const minVal = 0;

  const coords = values.map((val, i) => {
    const x = padX + (i / (values.length - 1)) * (w - padX * 2);
    const y = h - padY - ((val - minVal) / (maxVal - minVal)) * (h - padY * 2);
    return { x, y, val, label: points[i]?.label ?? '' };
  });

  // Build smooth cubic bezier curve
  let curvePath = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[Math.max(0, i - 1)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[Math.min(coords.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    curvePath += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  const areaPath = `${curvePath} L ${coords[coords.length - 1].x.toFixed(1)} ${h} L ${coords[0].x.toFixed(1)} ${h} Z`;

  const circles = coords
    .map(
      (c) =>
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3" fill="${strokeColor}"><title>${c.label}: ${c.val}</title></circle>`
    )
    .join('');

  return `
    <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow: visible;">
      <defs>
        <linearGradient id="${fillGradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${fillGradientId})" />
      <path d="${curvePath}" fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${circles}
    </svg>
  `;
}

function formatVsYesterday(
  todayVal: number,
  yesterdayVal: number,
  lowerIsBetter = false
): { text: string; color: string; bg: string } {
  const diff = todayVal - yesterdayVal;
  if (diff === 0) {
    return {
      text: '0 vs yest',
      color: 'var(--text-muted, #9ca3af)',
      bg: 'rgba(156, 163, 175, 0.12)',
    };
  }

  const isGood = lowerIsBetter ? diff < 0 : diff > 0;
  const sign = diff > 0 ? '+' : '';
  const text = `${sign}${diff} vs yest`;

  if (isGood) {
    return {
      text,
      color: '#4ade80',
      bg: 'rgba(74, 222, 128, 0.14)',
    };
  } else {
    return {
      text,
      color: '#f87171',
      bg: 'rgba(248, 113, 113, 0.14)',
    };
  }
}

export async function renderStatsTab(container: HTMLElement, settings: Settings): Promise<() => void> {
  container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:40px;">Loading stats...</div>';
  const lang = settings.language;

  const data = await window.deskpals.getStats();
  const summary: SevenDaysSummary = data.sevenDays;
  const heatmap: HeatmapGrid = data.heatmap;
  const companionDays: number = data.companionDays;
  const focusStreak: number = data.focusStreak ?? 0;

  container.innerHTML = '';

  // Top Section: 4 Stat Cards
  const cardsGrid = document.createElement('div');
  cardsGrid.className = 'grid-4';

  const yesterdayPoint = summary.days.length >= 2 ? summary.days[summary.days.length - 2] : null;

  const metricsConfig = [
    {
      icon: '🍅',
      title: t('stats_pomodoros', lang),
      today: summary.today.pomodoros,
      yesterday: yesterdayPoint ? yesterdayPoint.pomodoros : 0,
      unit: '',
      color: '#38bdf8', // accent blue
      key: 'pomodoros' as const,
      gradId: 'grad-pomodoro',
      lowerIsBetter: false,
    },
    {
      icon: '✅',
      title: t('stats_tasks_done', lang),
      today: summary.today.tasksDone,
      yesterday: yesterdayPoint ? yesterdayPoint.tasksDone : 0,
      unit: '',
      color: '#4ade80', // accent green
      key: 'tasksDone' as const,
      gradId: 'grad-tasks',
      lowerIsBetter: false,
    },
    {
      icon: '⚡',
      title: t('stats_focus', lang),
      today: summary.today.focusMinutes,
      yesterday: yesterdayPoint ? yesterdayPoint.focusMinutes : 0,
      unit: 'm',
      color: 'var(--primary, #a855f7)', // purple
      key: 'focusMinutes' as const,
      gradId: 'grad-focus',
      lowerIsBetter: false,
    },
    {
      icon: '⚠️',
      title: t('stats_distractions', lang),
      today: summary.today.distractions,
      yesterday: yesterdayPoint ? yesterdayPoint.distractions : 0,
      unit: '',
      color: 'var(--accent-red, #f87171)', // coral
      key: 'distractions' as const,
      gradId: 'grad-distract',
      lowerIsBetter: true,
    },
  ];

  for (const m of metricsConfig) {
    const card = document.createElement('div');
    card.className = 'dash-card';
    card.style.padding = '14px';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = '8px';

    // Header: Icon + Title on left, "vs yesterday" chip on right
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const titleWrap = document.createElement('div');
    titleWrap.style.display = 'flex';
    titleWrap.style.alignItems = 'center';
    titleWrap.style.gap = '6px';

    const iconEl = document.createElement('span');
    iconEl.innerText = m.icon;
    iconEl.style.fontSize = '14px';

    const titleEl = document.createElement('span');
    titleEl.innerText = m.title;
    titleEl.style.fontSize = '12px';
    titleEl.style.color = 'var(--text-muted)';
    titleEl.style.fontWeight = '600';

    titleWrap.appendChild(iconEl);
    titleWrap.appendChild(titleEl);

    // vs yesterday chip
    const vsYest = formatVsYesterday(m.today, m.yesterday, m.lowerIsBetter);
    const chip = document.createElement('span');
    chip.innerText = vsYest.text;
    chip.style.fontSize = '10px';
    chip.style.fontWeight = '700';
    chip.style.padding = '2px 7px';
    chip.style.borderRadius = '10px';
    chip.style.color = vsYest.color;
    chip.style.background = vsYest.bg;

    header.appendChild(titleWrap);
    header.appendChild(chip);
    card.appendChild(header);

    // Large Today count
    const todayEl = document.createElement('div');
    todayEl.innerText = m.unit ? `${m.today} ${m.unit}` : `${m.today}`;
    todayEl.style.fontSize = '26px';
    todayEl.style.fontWeight = '800';
    todayEl.style.color = m.color;
    todayEl.style.lineHeight = '1';
    todayEl.style.marginTop = '2px';
    card.appendChild(todayEl);

    // Sparkline
    const sparklineDiv = document.createElement('div');
    sparklineDiv.innerHTML = generateSmoothSparklineSvg(summary.days, m.key, m.color, m.gradId);
    card.appendChild(sparklineDiv);

    // X-Axis range (e.g. 11/7 ... 11/13)
    const rangeEl = document.createElement('div');
    rangeEl.style.display = 'flex';
    rangeEl.style.justifyContent = 'space-between';
    rangeEl.style.fontSize = '10px';
    rangeEl.style.color = 'var(--text-dim)';
    rangeEl.innerHTML = `<span>${summary.firstDateLabel}</span><span>${summary.lastDateLabel}</span>`;
    card.appendChild(rangeEl);

    cardsGrid.appendChild(card);
  }

  container.appendChild(cardsGrid);

  // Pomodoro Timer Control Section
  const { card: pomoCard, body: pomoBody } = createCard('🍅 ' + t('pomo_title', lang));
  pomoBody.style.display = 'flex';
  pomoBody.style.flexDirection = 'row';
  pomoBody.style.alignItems = 'center';
  pomoBody.style.justifyContent = 'space-between';
  pomoBody.style.flexWrap = 'wrap';
  pomoBody.style.gap = '16px';
  pomoBody.style.padding = '14px 20px';

  // Left: Phase and Round badge
  const pomoInfo = document.createElement('div');
  pomoInfo.style.display = 'flex';
  pomoInfo.style.flexDirection = 'column';
  pomoInfo.style.gap = '4px';

  const pomoPhaseBadge = document.createElement('div');
  pomoPhaseBadge.style.fontSize = '13px';
  pomoPhaseBadge.style.fontWeight = '700';
  pomoPhaseBadge.style.letterSpacing = '0.5px';
  pomoPhaseBadge.style.textTransform = 'uppercase';

  const pomoRoundInfo = document.createElement('div');
  pomoRoundInfo.style.fontSize = '12px';
  pomoRoundInfo.style.color = 'var(--text-muted)';

  pomoInfo.appendChild(pomoPhaseBadge);
  pomoInfo.appendChild(pomoRoundInfo);

  // Center: Live MM:SS Countdown
  const pomoTimerEl = document.createElement('div');
  pomoTimerEl.style.fontSize = '38px';
  pomoTimerEl.style.fontWeight = '800';
  pomoTimerEl.style.fontVariantNumeric = 'tabular-nums';
  pomoTimerEl.style.letterSpacing = '-1px';
  pomoTimerEl.style.lineHeight = '1';

  // Right: Controls (Start/Pause, Skip, Reset)
  const pomoButtons = document.createElement('div');
  pomoButtons.style.display = 'flex';
  pomoButtons.style.alignItems = 'center';
  pomoButtons.style.gap = '8px';

  const startPauseBtn = document.createElement('button');
  startPauseBtn.className = 'btn-primary';
  startPauseBtn.style.minWidth = '80px';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'btn-secondary';
  skipBtn.innerText = t('pomo_skip', lang);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn-secondary';
  resetBtn.innerText = t('pomo_reset', lang);

  pomoButtons.appendChild(startPauseBtn);
  pomoButtons.appendChild(skipBtn);
  pomoButtons.appendChild(resetBtn);

  pomoBody.appendChild(pomoInfo);
  pomoBody.appendChild(pomoTimerEl);
  pomoBody.appendChild(pomoButtons);

  let currentPomoStatus: PomodoroStatus | null = null;

  function updatePomoUI(status: PomodoroStatus): void {
    currentPomoStatus = status;
    let phaseText = t('pomo_phase_idle', lang);
    let phaseColor = 'var(--text-muted)';

    if (status.phase === 'work') {
      phaseText = '🍅 ' + t('pomo_phase_work', lang);
      phaseColor = '#38bdf8';
    } else if (status.phase === 'shortBreak') {
      phaseText = '☕ ' + t('pomo_phase_short', lang);
      phaseColor = '#4ade80';
    } else if (status.phase === 'longBreak') {
      phaseText = '🌴 ' + t('pomo_phase_long', lang);
      phaseColor = '#a855f7';
    }

    pomoPhaseBadge.innerText = phaseText;
    pomoPhaseBadge.style.color = phaseColor;
    pomoTimerEl.style.color = phaseColor;

    pomoRoundInfo.innerText = `${t('pomo_round', lang)} ${status.round} / ${status.totalRounds}`;
    pomoTimerEl.innerText = status.formattedTime;

    if (status.phase === 'idle' || status.paused) {
      startPauseBtn.innerText = t('pomo_start', lang);
      startPauseBtn.className = 'btn-primary';
    } else {
      startPauseBtn.innerText = t('pomo_pause', lang);
      startPauseBtn.className = 'btn-secondary';
    }

    skipBtn.disabled = status.phase === 'idle';
    resetBtn.disabled = status.phase === 'idle' && status.secondsRemaining === status.totalSeconds;
  }

  startPauseBtn.addEventListener('click', async () => {
    if (!currentPomoStatus || currentPomoStatus.phase === 'idle' || currentPomoStatus.paused) {
      const s = await window.deskpals.startPomodoro();
      updatePomoUI(s);
    } else {
      const s = await window.deskpals.pausePomodoro();
      updatePomoUI(s);
    }
  });

  skipBtn.addEventListener('click', async () => {
    const s = await window.deskpals.skipPomodoro();
    updatePomoUI(s);
  });

  resetBtn.addEventListener('click', async () => {
    const s = await window.deskpals.resetPomodoro();
    updatePomoUI(s);
  });

  window.deskpals.getPomodoroStatus().then(updatePomoUI);
  const unbindPomo = window.deskpals.onPomodoroStatusChanged(updatePomoUI);

  container.appendChild(pomoCard);

  // Companion Days + Focus Streak Card
  const { card: daysCard, body: daysBody } = createCard(t('stats_companion_days', lang));
  daysBody.style.flexDirection = 'row';
  daysBody.style.alignItems = 'center';
  daysBody.style.justifyContent = 'space-between';
  daysBody.style.padding = '12px 18px';

  const daysLeft = document.createElement('div');
  daysLeft.style.display = 'flex';
  daysLeft.style.alignItems = 'center';
  daysLeft.style.gap = '14px';

  const daysNumber = document.createElement('div');
  daysNumber.innerText = `${companionDays}`;
  daysNumber.style.fontSize = '38px';
  daysNumber.style.fontWeight = '900';
  daysNumber.style.color = 'var(--primary)';
  daysNumber.style.lineHeight = '1';

  const daysLabel = document.createElement('div');
  daysLabel.innerText = t('stats_days_active', lang);
  daysLabel.style.fontSize = '14px';
  daysLabel.style.color = 'var(--text)';
  daysLabel.style.fontWeight = '600';

  daysLeft.appendChild(daysNumber);
  daysLeft.appendChild(daysLabel);

  // Streak badge on right
  const streakBadge = document.createElement('div');
  streakBadge.style.display = 'flex';
  streakBadge.style.alignItems = 'center';
  streakBadge.style.gap = '8px';
  streakBadge.style.padding = '8px 14px';
  streakBadge.style.borderRadius = '12px';
  streakBadge.style.background = focusStreak > 0 ? 'rgba(249, 115, 22, 0.12)' : 'rgba(156, 163, 175, 0.08)';
  streakBadge.style.border = focusStreak > 0 ? '1px solid rgba(249, 115, 22, 0.3)' : '1px solid rgba(156, 163, 175, 0.15)';

  const streakIcon = document.createElement('span');
  streakIcon.innerText = '🔥';
  streakIcon.style.fontSize = '18px';

  const streakText = document.createElement('div');
  streakText.innerHTML = `<span style="font-weight: 800; font-size: 15px; color: ${focusStreak > 0 ? '#f97316' : 'var(--text-muted)'};">${focusStreak}</span> <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">day focus streak</span>`;

  streakBadge.appendChild(streakIcon);
  streakBadge.appendChild(streakText);

  daysBody.appendChild(daysLeft);
  daysBody.appendChild(streakBadge);
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
  const unsubscribeStats = window.deskpals.onStatsUpdated(() => {
    // Only re-render if the container is still attached and document is visible
    if (!document.hidden && container.isConnected) {
      renderStatsTab(container, settings);
    }
  });

  return () => {
    unsubscribeStats();
    unbindPomo();
  };
}
