import { contextBridge, ipcRenderer } from 'electron';

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
}

const api: OverlayApi = {
  ready: () => ipcRenderer.send('overlay:ready'),
  setInteractive: (interactive) => ipcRenderer.send('overlay:interactive', interactive),
  setGrabbed: (grabbed) => ipcRenderer.send('overlay:grab', grabbed),
  openMenu: () => ipcRenderer.send('overlay:menu'),
  telemetry: (data) => ipcRenderer.send('overlay:telemetry', data),
  frameError: (message) => ipcRenderer.send('overlay:frame-error', message),
  debugLog: (message) => ipcRenderer.send('overlay:debug-log', message),
  onCompanions: (cb) => { ipcRenderer.on('companions:set', (_e, names: string[]) => cb(names)); },
  onEvent: (cb) => { ipcRenderer.on('companions:event', (_e, name: string) => cb(name)); },
  onPause: (cb) => { ipcRenderer.on('overlay:pause', (_e, paused: boolean) => cb(paused)); },
  onTelemetryRequest: (cb) => { ipcRenderer.on('overlay:telemetry-request', () => cb()); },
  onDisplayChange: (cb) => { ipcRenderer.on('overlay:display-change', () => cb()); },
};

contextBridge.exposeInMainWorld('overlay', api);
