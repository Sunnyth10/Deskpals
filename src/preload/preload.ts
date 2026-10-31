import { contextBridge, ipcRenderer } from 'electron';

export interface OverlayApi {
  ready(): void;
  setInteractive(interactive: boolean): void;
  openMenu(): void;
  telemetry(data: unknown): void;
  onCompanions(cb: (names: string[]) => void): void;
  onEvent(cb: (name: string) => void): void;
  onPause(cb: (paused: boolean) => void): void;
  onTelemetryRequest(cb: () => void): void;
}

const api: OverlayApi = {
  ready: () => ipcRenderer.send('overlay:ready'),
  setInteractive: (interactive) => ipcRenderer.send('overlay:interactive', interactive),
  openMenu: () => ipcRenderer.send('overlay:menu'),
  telemetry: (data) => ipcRenderer.send('overlay:telemetry', data),
  onCompanions: (cb) => { ipcRenderer.on('companions:set', (_e, names: string[]) => cb(names)); },
  onEvent: (cb) => { ipcRenderer.on('companions:event', (_e, name: string) => cb(name)); },
  onPause: (cb) => { ipcRenderer.on('overlay:pause', (_e, paused: boolean) => cb(paused)); },
  onTelemetryRequest: (cb) => { ipcRenderer.on('overlay:telemetry-request', () => cb()); },
};

contextBridge.exposeInMainWorld('overlay', api);
