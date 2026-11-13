import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type SpeechBubbleMessage, type CountdownPayload } from '../shared/ipc-channels';
import type { Settings } from '../core/settings';

export interface OverlayApi {
  ready(): void;
  setInteractive(interactive: boolean): void;
  setGrabbed(grabbed: boolean): void;
  openMenu(): void;
  telemetry(data: unknown): void;
  frameError(message: string): void;
  debugLog(message: string): void;
  onCompanions(cb: (names: string[]) => void): void;
  onEvent(cb: (name: string) => void): void;
  onPause(cb: (paused: boolean) => void): void;
  onTelemetryRequest(cb: () => void): void;
  onDisplayChange(cb: () => void): void;
  onBubble(cb: (msg: SpeechBubbleMessage) => void): void;
  onCountdown(cb: (payload: CountdownPayload | null) => void): void;
  onEnlarge(cb: (multiplier: number, durationSeconds: number) => void): void;
  onSettings(cb: (settings: Settings) => void): void;
}

const api: OverlayApi = {
  ready: () => ipcRenderer.send(IPC_CHANNELS.OVERLAY_READY),
  setInteractive: (interactive) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_INTERACTIVE, interactive),
  setGrabbed: (grabbed) => ipcRenderer.send(IPC_CHANNELS.OVERLAY_GRAB, grabbed),
  openMenu: () => ipcRenderer.send(IPC_CHANNELS.OVERLAY_MENU),
  telemetry: (data) => ipcRenderer.send('overlay:telemetry', data),
  frameError: (message) => ipcRenderer.send('overlay:frame-error', message),
  debugLog: (message) => ipcRenderer.send('overlay:debug-log', message),
  onCompanions: (cb) => {
    ipcRenderer.on(IPC_CHANNELS.COMPANIONS_SET, (_e, names: string[]) => cb(names));
  },
  onEvent: (cb) => {
    ipcRenderer.on('companions:event', (_e, name: string) => cb(name));
  },
  onPause: (cb) => {
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_PAUSE, (_e, paused: boolean) => cb(paused));
  },
  onTelemetryRequest: (cb) => {
    ipcRenderer.on('overlay:telemetry-request', () => cb());
  },
  onDisplayChange: (cb) => {
    ipcRenderer.on('overlay:display-change', () => cb());
  },
  onBubble: (cb) => {
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_BUBBLE, (_e, msg: SpeechBubbleMessage) => cb(msg));
  },
  onCountdown: (cb) => {
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_COUNTDOWN, (_e, payload: CountdownPayload | null) => cb(payload));
  },
  onEnlarge: (cb) => {
    ipcRenderer.on(IPC_CHANNELS.OVERLAY_ENLARGE, (_e, multiplier: number, durationSeconds: number) =>
      cb(multiplier, durationSeconds)
    );
  },
  onSettings: (cb) => {
    ipcRenderer.on(IPC_CHANNELS.SETTINGS_UPDATED, (_e, settings: Settings) => cb(settings));
  },
};

contextBridge.exposeInMainWorld('overlay', api);
