import type { DashboardApi } from '../../preload/dashboardPreload';
import type { DashboardTab, Settings } from '../../core/settings';
import { t } from '../../core/i18n';
import { renderStatsTab } from './tabStats';
import { renderPetTab } from './tabPet';
import { renderTodoTab } from './tabTodo';
import { renderRemindersTab } from './tabReminders';
import { renderSettingsTab } from './tabSettings';

declare global {
  interface Window {
    deskpals: DashboardApi;
  }
}

let currentSettings: Settings | null = null;
let currentTab: DashboardTab = 'stats';
let cleanupCurrentTab: (() => void) | null = null;

const tabContent = document.getElementById('tab-content') as HTMLElement;
const tabBar = document.getElementById('tab-bar') as HTMLElement;

function updateTabButtons(active: DashboardTab, lang: Settings['language']): void {
  const labelStats = document.getElementById('label-tab-stats');
  const labelPet = document.getElementById('label-tab-pet');
  const labelTodo = document.getElementById('label-tab-todo');
  const labelReminders = document.getElementById('label-tab-reminders');
  const labelSettings = document.getElementById('label-tab-settings');

  if (labelStats) labelStats.innerText = t('nav_stats', lang);
  if (labelPet) labelPet.innerText = t('nav_pet', lang);
  if (labelTodo) labelTodo.innerText = t('nav_todo', lang);
  if (labelReminders) labelReminders.innerText = t('nav_reminders', lang);
  if (labelSettings) labelSettings.innerText = t('nav_settings', lang);

  const buttons = tabBar.querySelectorAll<HTMLButtonElement>('.tab-btn');
  buttons.forEach((btn) => {
    const tabName = btn.dataset.tab as DashboardTab;
    if (tabName === active) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

async function switchTab(tab: DashboardTab): Promise<void> {
  if (!currentSettings) return;

  if (cleanupCurrentTab) {
    cleanupCurrentTab();
    cleanupCurrentTab = null;
  }

  currentTab = tab;
  updateTabButtons(tab, currentSettings.language);
  window.deskpals.setTab(tab);

  switch (tab) {
    case 'stats':
      cleanupCurrentTab = await renderStatsTab(tabContent, currentSettings);
      break;
    case 'pet':
      renderPetTab(tabContent, currentSettings, (updated) => {
        currentSettings = updated;
      });
      break;
    case 'todo':
      cleanupCurrentTab = renderTodoTab(tabContent, currentSettings);
      break;
    case 'reminders':
      cleanupCurrentTab = renderRemindersTab(tabContent, currentSettings);
      break;
    case 'settings':
      cleanupCurrentTab = renderSettingsTab(tabContent, currentSettings, (updated) => {
        const langChanged = currentSettings?.language !== updated.language;
        currentSettings = updated;
        if (langChanged) {
          updateTabButtons(currentTab, updated.language);
          switchTab('settings');
        }
      });
      break;
  }
}

function renderUpdateBanner(status: import('../../shared/ipc-channels').UpdateStatusPayload): void {
  const banner = document.getElementById('update-banner');
  if (!banner) return;

  if (!status.hasUpdate && status.status !== 'downloading' && status.status !== 'ready' && status.status !== 'error') {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = 'flex';

  if (status.status === 'available') {
    banner.innerHTML = `
      <div class="update-pill">
        <span>✨ ${status.latestVersion} Available</span>
        <button class="update-btn-action" id="btn-header-update">Update</button>
      </div>
    `;
    const btn = document.getElementById('btn-header-update');
    btn?.addEventListener('click', () => {
      void window.deskpals.startUpdate();
    });
    return;
  }

  if (status.status === 'downloading') {
    const pct = status.progressPercent ?? 0;
    banner.innerHTML = `
      <div class="update-progress-container">
        <span>Downloading ${pct}%</span>
        <div class="update-progress-track">
          <div class="update-progress-fill" style="width: ${pct}%;"></div>
        </div>
      </div>
    `;
    return;
  }

  if (status.status === 'ready') {
    banner.innerHTML = `
      <div class="update-pill" style="border-color: var(--accent-green); box-shadow: 0 0 10px rgba(74, 222, 128, 0.3);">
        <span>🔄 Launching Installer...</span>
      </div>
    `;
    return;
  }

  if (status.status === 'error') {
    banner.innerHTML = `
      <div class="update-pill" style="border-color: var(--accent-red);">
        <span>⚠️ Update failed</span>
        <button class="update-btn-action" id="btn-header-retry">Retry</button>
      </div>
    `;
    const btn = document.getElementById('btn-header-retry');
    btn?.addEventListener('click', () => {
      void window.deskpals.startUpdate();
    });
    return;
  }
}

async function init(): Promise<void> {
  currentSettings = await window.deskpals.getSettings();
  currentTab = currentSettings.activeTab ?? 'stats';

  tabBar.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.tab-btn');
    if (!target || !target.dataset.tab) return;
    const tab = target.dataset.tab as DashboardTab;
    if (tab !== currentTab) {
      void switchTab(tab);
    }
  });

  window.deskpals.onSettingsUpdated((newSettings) => {
    currentSettings = newSettings;
  });

  window.deskpals.onUpdateStatus((status) => {
    renderUpdateBanner(status);
  });
  window.deskpals.getUpdateStatus().then((status) => {
    renderUpdateBanner(status);
  });

  void switchTab(currentTab);
}

document.addEventListener('DOMContentLoaded', () => {
  void init();
});
