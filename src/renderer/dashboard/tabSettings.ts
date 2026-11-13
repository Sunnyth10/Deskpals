import type { DashboardApi } from '../../preload/dashboardPreload';
import type { Settings, SupportedLanguage, RunDirection } from '../../core/settings';
import { t } from '../../core/i18n';
import { createCard, createStepper, createToggle } from './components';

declare global {
  interface Window {
    deskpals: DashboardApi;
  }
}

export function renderSettingsTab(
  container: HTMLElement,
  settings: Settings,
  onSettingsChange: (s: Settings) => void
): () => void {
  container.innerHTML = '';
  const lang = settings.language;

  // 1. Language Card
  const { card: langCard, body: langBody } = createCard(t('settings_language', lang));
  const langRow = document.createElement('div');
  langRow.className = 'setting-row';

  const langInfo = document.createElement('div');
  langInfo.className = 'setting-info';
  const langLabel = document.createElement('div');
  langLabel.className = 'setting-label';
  langLabel.innerText = t('settings_language', lang);
  langInfo.appendChild(langLabel);

  const langSelect = document.createElement('select');
  const optEn = document.createElement('option');
  optEn.value = 'en';
  optEn.innerText = 'English';
  optEn.selected = settings.language === 'en';
  const optEs = document.createElement('option');
  optEs.value = 'es';
  optEs.innerText = 'Español';
  optEs.selected = settings.language === 'es';
  langSelect.appendChild(optEn);
  langSelect.appendChild(optEs);

  langSelect.addEventListener('change', async () => {
    const newLang = langSelect.value as SupportedLanguage;
    const updated = await window.deskpals.updateSettings({ language: newLang });
    onSettingsChange(updated);
  });

  langRow.appendChild(langInfo);
  langRow.appendChild(langSelect);
  langBody.appendChild(langRow);
  container.appendChild(langCard);

  // 2. Appearance Card
  const { card: appCard, body: appBody } = createCard(t('settings_appearance', lang));

  // Global Pet Size
  const sizeRow = document.createElement('div');
  sizeRow.className = 'setting-row';
  sizeRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_pet_size', lang)}</div>
      <div class="setting-desc">Scale the base rendering size of all companions.</div>
    </div>
  `;
  const sizeStepper = createStepper({
    value: settings.appearance.petSizePercent,
    min: 50,
    max: 300,
    step: 10,
    unit: '%',
    onChange: async (val) => {
      const appearance = { ...settings.appearance, petSizePercent: val };
      const updated = await window.deskpals.updateSettings({ appearance });
      onSettingsChange(updated);
    },
  });
  sizeRow.appendChild(sizeStepper);
  appBody.appendChild(sizeRow);

  // Lyrics Mode (Permanent Click-Through)
  const lyricsRow = document.createElement('div');
  lyricsRow.className = 'setting-row';
  lyricsRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_lyrics_mode', lang)}</div>
      <div class="setting-desc">${t('settings_lyrics_desc', lang)}</div>
    </div>
  `;
  const lyricsToggle = createToggle({
    checked: settings.appearance.lyricsMode,
    onChange: async (checked) => {
      const appearance = { ...settings.appearance, lyricsMode: checked };
      const updated = await window.deskpals.updateSettings({ appearance });
      onSettingsChange(updated);
    },
  });
  lyricsRow.appendChild(lyricsToggle);
  appBody.appendChild(lyricsRow);

  // Bubble Duration
  const bubbleRow = document.createElement('div');
  bubbleRow.className = 'setting-row';
  bubbleRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_bubble_duration', lang)}</div>
      <div class="setting-desc">How long countdown and notification speech bubbles remain visible.</div>
    </div>
  `;
  const bubbleStepper = createStepper({
    value: settings.appearance.bubbleDurationSeconds,
    min: 2,
    max: 30,
    step: 1,
    unit: 's',
    onChange: async (val) => {
      const appearance = { ...settings.appearance, bubbleDurationSeconds: val };
      const updated = await window.deskpals.updateSettings({ appearance });
      onSettingsChange(updated);
    },
  });
  bubbleRow.appendChild(bubbleStepper);
  appBody.appendChild(bubbleRow);

  container.appendChild(appCard);

  // 3. Pet Motion Card
  const { card: motionCard, body: motionBody } = createCard(t('settings_motion', lang));

  // Auto Run
  const autoRunRow = document.createElement('div');
  autoRunRow.className = 'setting-row';
  autoRunRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_auto_run', lang)}</div>
      <div class="setting-desc">Allow companions to spontaneously run across your screen.</div>
    </div>
  `;
  const autoRunToggle = createToggle({
    checked: settings.motion.autoRun,
    onChange: async (checked) => {
      const motion = { ...settings.motion, autoRun: checked };
      const updated = await window.deskpals.updateSettings({ motion });
      onSettingsChange(updated);
    },
  });
  autoRunRow.appendChild(autoRunToggle);
  motionBody.appendChild(autoRunRow);

  // Run Direction
  const dirRow = document.createElement('div');
  dirRow.className = 'setting-row';
  dirRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_run_direction', lang)}</div>
      <div class="setting-desc">Allowed running directions.</div>
    </div>
  `;
  const dirSelect = document.createElement('select');
  const dirOptions: Array<[RunDirection, string]> = [
    ['both', t('settings_run_dir_both', lang)],
    ['left', t('settings_run_dir_left', lang)],
    ['right', t('settings_run_dir_right', lang)],
  ];
  for (const [val, label] of dirOptions) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.innerText = label;
    opt.selected = settings.motion.runDirection === val;
    dirSelect.appendChild(opt);
  }
  dirSelect.addEventListener('change', async () => {
    const motion = { ...settings.motion, runDirection: dirSelect.value as RunDirection };
    const updated = await window.deskpals.updateSettings({ motion });
    onSettingsChange(updated);
  });
  dirRow.appendChild(dirSelect);
  motionBody.appendChild(dirRow);

  // Run Frequency
  const runFreqRow = document.createElement('div');
  runFreqRow.className = 'setting-row';
  runFreqRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_run_freq', lang)}</div>
      <div class="setting-desc">Interval between running impulses.</div>
    </div>
  `;
  const runFreqStepper = createStepper({
    value: settings.motion.runFrequencySeconds,
    min: 5,
    max: 120,
    step: 5,
    unit: 's',
    onChange: async (val) => {
      const motion = { ...settings.motion, runFrequencySeconds: val };
      const updated = await window.deskpals.updateSettings({ motion });
      onSettingsChange(updated);
    },
  });
  runFreqRow.appendChild(runFreqStepper);
  motionBody.appendChild(runFreqRow);

  // Run Duration
  const runDurRow = document.createElement('div');
  runDurRow.className = 'setting-row';
  runDurRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_run_dur', lang)}</div>
      <div class="setting-desc">Duration of sprint cycles.</div>
    </div>
  `;
  const runDurStepper = createStepper({
    value: settings.motion.runDurationSeconds,
    min: 1,
    max: 15,
    step: 1,
    unit: 's',
    onChange: async (val) => {
      const motion = { ...settings.motion, runDurationSeconds: val };
      const updated = await window.deskpals.updateSettings({ motion });
      onSettingsChange(updated);
    },
  });
  runDurRow.appendChild(runDurStepper);
  motionBody.appendChild(runDurRow);

  // Idle Motion Frequency
  const idleFreqRow = document.createElement('div');
  idleFreqRow.className = 'setting-row';
  idleFreqRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_idle_freq', lang)}</div>
      <div class="setting-desc">How often the companion shifts posture while idle.</div>
    </div>
  `;
  const idleFreqStepper = createStepper({
    value: settings.motion.idleMotionFrequencySeconds,
    min: 2,
    max: 30,
    step: 2,
    unit: 's',
    onChange: async (val) => {
      const motion = { ...settings.motion, idleMotionFrequencySeconds: val };
      const updated = await window.deskpals.updateSettings({ motion });
      onSettingsChange(updated);
    },
  });
  idleFreqRow.appendChild(idleFreqStepper);
  motionBody.appendChild(idleFreqRow);

  container.appendChild(motionCard);

  // 4. Health Nudges Card
  const { card: healthCard, body: healthBody } = createCard(t('settings_health', lang));

  // Break Reminder
  const breakRow = document.createElement('div');
  breakRow.className = 'setting-row';
  breakRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_break_interval', lang)}</div>
      <div class="setting-desc">Nudge to rest eyes and step away from the desk.</div>
    </div>
  `;
  const breakControls = document.createElement('div');
  breakControls.style.display = 'flex';
  breakControls.style.alignItems = 'center';
  breakControls.style.gap = '10px';
  const breakToggle = createToggle({
    checked: settings.health.breakEnabled,
    onChange: async (checked) => {
      const health = { ...settings.health, breakEnabled: checked };
      const updated = await window.deskpals.updateSettings({ health });
      onSettingsChange(updated);
    },
  });
  const breakStepper = createStepper({
    value: settings.health.breakIntervalMinutes,
    min: 10,
    max: 120,
    step: 5,
    unit: 'm',
    onChange: async (val) => {
      const health = { ...settings.health, breakIntervalMinutes: val };
      const updated = await window.deskpals.updateSettings({ health });
      onSettingsChange(updated);
    },
  });
  breakControls.appendChild(breakToggle);
  breakControls.appendChild(breakStepper);
  breakRow.appendChild(breakControls);
  healthBody.appendChild(breakRow);

  // Fullscreen Break Mode Toggle
  const fsBreakRow = document.createElement('div');
  fsBreakRow.className = 'setting-row';
  fsBreakRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_break_fullscreen', lang)}</div>
      <div class="setting-desc">Show an easy-to-dismiss calming full-screen overlay during break times.</div>
    </div>
  `;
  const fsBreakToggle = createToggle({
    checked: settings.health.breakModeFullscreen,
    onChange: async (checked) => {
      const health = { ...settings.health, breakModeFullscreen: checked };
      const updated = await window.deskpals.updateSettings({ health });
      onSettingsChange(updated);
    },
  });
  fsBreakRow.appendChild(fsBreakToggle);
  healthBody.appendChild(fsBreakRow);

  // Water Reminder
  const waterRow = document.createElement('div');
  waterRow.className = 'setting-row';
  waterRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_water_interval', lang)}</div>
      <div class="setting-desc">Hydration reminder intervals throughout your workday.</div>
    </div>
  `;
  const waterControls = document.createElement('div');
  waterControls.style.display = 'flex';
  waterControls.style.alignItems = 'center';
  waterControls.style.gap = '10px';
  const waterToggle = createToggle({
    checked: settings.health.waterEnabled,
    onChange: async (checked) => {
      const health = { ...settings.health, waterEnabled: checked };
      const updated = await window.deskpals.updateSettings({ health });
      onSettingsChange(updated);
    },
  });
  const waterStepper = createStepper({
    value: settings.health.waterIntervalMinutes,
    min: 15,
    max: 180,
    step: 15,
    unit: 'm',
    onChange: async (val) => {
      const health = { ...settings.health, waterIntervalMinutes: val };
      const updated = await window.deskpals.updateSettings({ health });
      onSettingsChange(updated);
    },
  });
  waterControls.appendChild(waterToggle);
  waterControls.appendChild(waterStepper);
  waterRow.appendChild(waterControls);
  healthBody.appendChild(waterRow);

  // Water Goal
  const waterGoalRow = document.createElement('div');
  waterGoalRow.className = 'setting-row';
  waterGoalRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_water_goal', lang)}</div>
      <div class="setting-desc">Daily target number of glasses.</div>
    </div>
  `;
  const waterGoalStepper = createStepper({
    value: settings.health.waterDailyGoal,
    min: 1,
    max: 20,
    step: 1,
    unit: 'cups',
    onChange: async (val) => {
      const health = { ...settings.health, waterDailyGoal: val };
      const updated = await window.deskpals.updateSettings({ health });
      onSettingsChange(updated);
    },
  });
  waterGoalRow.appendChild(waterGoalStepper);
  healthBody.appendChild(waterGoalRow);

  container.appendChild(healthCard);

  // 5. Focus Mode Card
  const { card: focusCard, body: focusBody } = createCard(t('settings_focus', lang));

  // Focus Mode Enabled
  const focusRow = document.createElement('div');
  focusRow.className = 'setting-row';
  focusRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_focus_enable', lang)}</div>
      <div class="setting-desc">Monitor distractions and track dedicated deep work intervals.</div>
    </div>
  `;
  const focusToggle = createToggle({
    checked: settings.focus.enabled,
    onChange: async (checked) => {
      const focus = { ...settings.focus, enabled: checked };
      const updated = await window.deskpals.updateSettings({ focus });
      onSettingsChange(updated);
    },
  });
  focusRow.appendChild(focusToggle);
  focusBody.appendChild(focusRow);

  // Focus Session Duration
  const focusDurRow = document.createElement('div');
  focusDurRow.className = 'setting-row';
  focusDurRow.innerHTML = `
    <div class="setting-info">
      <div class="setting-label">${t('settings_focus_duration', lang)}</div>
      <div class="setting-desc">Default Pomodoro / Focus session length.</div>
    </div>
  `;
  const focusDurStepper = createStepper({
    value: settings.focus.sessionDurationMinutes,
    min: 5,
    max: 120,
    step: 5,
    unit: 'm',
    onChange: async (val) => {
      const focus = { ...settings.focus, sessionDurationMinutes: val };
      const updated = await window.deskpals.updateSettings({ focus });
      onSettingsChange(updated);
    },
  });
  focusDurRow.appendChild(focusDurStepper);
  focusBody.appendChild(focusDurRow);

  // Blocked Apps input
  const appsRow = document.createElement('div');
  appsRow.className = 'setting-row';
  appsRow.style.flexDirection = 'column';
  appsRow.style.alignItems = 'stretch';
  appsRow.style.gap = '6px';
  appsRow.innerHTML = `
    <div class="setting-label">${t('settings_blocked_apps', lang)}</div>
    <div class="setting-desc">Process or window names that trigger distraction alerts during focus.</div>
  `;
  const appsInput = document.createElement('input');
  appsInput.type = 'text';
  appsInput.value = settings.focus.blockedApps.join(', ');
  appsInput.addEventListener('change', async () => {
    const list = appsInput.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const focus = { ...settings.focus, blockedApps: list };
    const updated = await window.deskpals.updateSettings({ focus });
    onSettingsChange(updated);
  });
  appsRow.appendChild(appsInput);
  focusBody.appendChild(appsRow);

  // Blocked Keywords input
  const kwRow = document.createElement('div');
  kwRow.className = 'setting-row';
  kwRow.style.flexDirection = 'column';
  kwRow.style.alignItems = 'stretch';
  kwRow.style.gap = '6px';
  kwRow.innerHTML = `
    <div class="setting-label">${t('settings_blocked_keywords', lang)}</div>
    <div class="setting-desc">Window titles containing any of these keywords will be flagged.</div>
  `;
  const kwInput = document.createElement('input');
  kwInput.type = 'text';
  kwInput.value = settings.focus.blockedKeywords.join(', ');
  kwInput.addEventListener('change', async () => {
    const list = kwInput.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const focus = { ...settings.focus, blockedKeywords: list };
    const updated = await window.deskpals.updateSettings({ focus });
    onSettingsChange(updated);
  });
  kwRow.appendChild(kwInput);
  focusBody.appendChild(kwRow);

  // Focus Session Controls & Status
  const sessionBox = document.createElement('div');
  sessionBox.style.padding = '12px';
  sessionBox.style.background = 'var(--bg-input)';
  sessionBox.style.borderRadius = '8px';
  sessionBox.style.border = '1px solid var(--border)';
  sessionBox.style.display = 'flex';
  sessionBox.style.alignItems = 'center';
  sessionBox.style.justifyContent = 'space-between';

  const statusLabel = document.createElement('div');
  statusLabel.style.fontWeight = '600';
  statusLabel.style.fontSize = '13px';
  statusLabel.innerText = 'Ready for Focus';

  const sessionBtn = document.createElement('button');
  sessionBtn.type = 'button';
  sessionBtn.className = 'btn-primary';
  sessionBtn.innerText = t('settings_start_focus', lang);

  let currentFocusActive = false;

  const updateFocusUI = (status: { active: boolean; minutesRemaining: number; currentDistractions: number }) => {
    currentFocusActive = status.active;
    if (status.active) {
      statusLabel.innerHTML = `🔥 <span style="color:var(--primary)">${status.minutesRemaining} min(s) remaining</span> (${status.currentDistractions} distractions)`;
      sessionBtn.innerText = t('settings_stop_focus', lang);
      sessionBtn.className = 'btn-secondary';
    } else {
      statusLabel.innerText = 'Ready for Focus';
      sessionBtn.innerText = t('settings_start_focus', lang);
      sessionBtn.className = 'btn-primary';
    }
  };

  sessionBtn.addEventListener('click', async () => {
    if (currentFocusActive) {
      const status = await window.deskpals.stopFocus();
      updateFocusUI(status);
    } else {
      const status = await window.deskpals.startFocus();
      updateFocusUI(status);
    }
  });

  sessionBox.appendChild(statusLabel);
  sessionBox.appendChild(sessionBtn);
  focusBody.appendChild(sessionBox);

  container.appendChild(focusCard);

  // Query initial focus status
  window.deskpals.getFocusStatus().then(updateFocusUI);
  const unbindFocus = window.deskpals.onFocusStatus(updateFocusUI);

  return unbindFocus;
}
