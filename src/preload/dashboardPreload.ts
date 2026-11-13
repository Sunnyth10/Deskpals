import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type { Settings, DashboardTab } from '../core/settings';
import type { SevenDaysSummary, HeatmapGrid } from '../core/stats';
import type { ReminderItem } from '../core/reminders';
import type { FocusStatus } from '../shared/ipc-channels';

export interface DashboardApi {
  getSettings(): Promise<Settings>;
  updateSettings(partial: Partial<Settings>): Promise<Settings>;
  onSettingsUpdated(cb: (settings: Settings) => void): () => void;
  getStats(): Promise<{ sevenDays: SevenDaysSummary; heatmap: HeatmapGrid; companionDays: number }>;
  recordStat(type: 'breaks' | 'waters' | 'focus' | 'distractions', delta: number): Promise<void>;
  onStatsUpdated(cb: () => void): () => void;
  getReminders(): Promise<ReminderItem[]>;
  saveReminder(reminder: ReminderItem): Promise<ReminderItem[]>;
  deleteReminder(id: string): Promise<ReminderItem[]>;
  triggerTestAlert(text: string, kind?: 'info' | 'alert' | 'countdown' | 'break' | 'water'): Promise<void>;
  startFocus(): Promise<FocusStatus>;
  stopFocus(): Promise<FocusStatus>;
  getFocusStatus(): Promise<FocusStatus>;
  onFocusStatus(cb: (status: FocusStatus) => void): () => void;
  setTab(tab: DashboardTab): void;
  getActiveApp(): Promise<string | null>;
}

const api: DashboardApi = {
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  updateSettings: (partial) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, partial),
  onSettingsUpdated: (cb) => {
    const handler = (_event: unknown, settings: Settings) => cb(settings);
    ipcRenderer.on(IPC_CHANNELS.SETTINGS_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SETTINGS_UPDATED, handler);
  },
  getStats: () => ipcRenderer.invoke(IPC_CHANNELS.STATS_GET),
  recordStat: (type, delta) => ipcRenderer.invoke(IPC_CHANNELS.STATS_RECORD, { type, delta }),
  onStatsUpdated: (cb) => {
    const handler = () => cb();
    ipcRenderer.on(IPC_CHANNELS.STATS_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.STATS_UPDATED, handler);
  },
  getReminders: () => ipcRenderer.invoke(IPC_CHANNELS.REMINDERS_GET),
  saveReminder: (reminder) => ipcRenderer.invoke(IPC_CHANNELS.REMINDERS_SAVE, reminder),
  deleteReminder: (id) => ipcRenderer.invoke(IPC_CHANNELS.REMINDERS_DELETE, id),
  triggerTestAlert: (text, kind = 'info') =>
    ipcRenderer.invoke(IPC_CHANNELS.REMINDERS_TRIGGER, { text, kind }),
  startFocus: () => ipcRenderer.invoke(IPC_CHANNELS.FOCUS_START),
  stopFocus: () => ipcRenderer.invoke(IPC_CHANNELS.FOCUS_STOP),
  getFocusStatus: () => ipcRenderer.invoke(IPC_CHANNELS.FOCUS_STATUS),
  onFocusStatus: (cb) => {
    const handler = (_event: unknown, status: FocusStatus) => cb(status);
    ipcRenderer.on(IPC_CHANNELS.FOCUS_STATE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FOCUS_STATE_CHANGED, handler);
  },
  setTab: (tab) => ipcRenderer.send(IPC_CHANNELS.DASHBOARD_TAB_CHANGED, tab),
  getActiveApp: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_ACTIVE_APP),
};

contextBridge.exposeInMainWorld('deskpals', api);
