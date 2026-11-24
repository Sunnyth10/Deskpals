/**
 * Automatic In-App Updater for DeskPals.
 * Periodically checks GitHub releases, notifies the user via companion bubbles
 * and the dashboard, downloads the platform-matching binary with progress tracking,
 * and launches the installer seamlessly.
 */
import { app, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { UpdateStatusPayload } from '../shared/ipc-channels';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  assets: ReleaseAsset[];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);

  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);

  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

export function pickAssetForCurrentPlatform(
  assets: ReleaseAsset[],
  platform = process.platform,
  arch = process.arch,
): ReleaseAsset | null {
  if (!assets || assets.length === 0) return null;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      const arm = assets.find((a) => a.name.toLowerCase().includes('arm64') && a.name.endsWith('.dmg'));
      if (arm) return arm;
    }
    const x64 = assets.find(
      (a) =>
        (a.name.toLowerCase().includes('x64') || !a.name.toLowerCase().includes('arm64')) &&
        a.name.endsWith('.dmg'),
    );
    if (x64) return x64;
    return assets.find((a) => a.name.endsWith('.dmg')) || null;
  }

  if (platform === 'win32') {
    const exe = assets.find((a) => a.name.endsWith('.exe'));
    if (exe) return exe;
  }

  return null;
}

export class AppUpdater {
  private repo = 'Sunnyth10/Deskpals';
  private currentStatus: UpdateStatusPayload = {
    hasUpdate: false,
    currentVersion: app.getVersion(),
    latestVersion: app.getVersion(),
    status: 'idle',
    progressPercent: 0,
  };

  private matchedAsset: ReleaseAsset | null = null;
  private isDownloading = false;
  private checkTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onStatusChange: (status: UpdateStatusPayload) => void,
    private readonly onUpdateFound?: (latestVersion: string, releaseNotes: string) => void,
  ) {}

  public getStatus(): UpdateStatusPayload {
    return { ...this.currentStatus };
  }

  public startPeriodicChecks(intervalHours = 4): void {
    // Initial check 8 seconds after app boot so launch is completely unblocked
    setTimeout(() => {
      this.checkForUpdates().catch((err) => {
        console.warn('[updater] Initial check failed:', err?.message || err);
      });
    }, 8000);

    const ms = intervalHours * 60 * 60 * 1000;
    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch((err) => {
        console.warn('[updater] Periodic check failed:', err?.message || err);
      });
    }, ms);
  }

  public dispose(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  public async checkForUpdates(): Promise<UpdateStatusPayload> {
    if (this.isDownloading) {
      return this.getStatus();
    }

    this.updateStatus({ status: 'checking', errorMessage: undefined });

    try {
      const url = `https://api.github.com/repos/${this.repo}/releases/latest`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'DeskPals-App',
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!res.ok) {
        throw new Error(`GitHub API returned HTTP ${res.status}`);
      }

      const release = (await res.json()) as GitHubRelease;
      const latestTag = release.tag_name || release.name || '';
      const currentVer = app.getVersion();

      const hasUpdate = isNewerVersion(latestTag, currentVer);
      this.matchedAsset = hasUpdate ? pickAssetForCurrentPlatform(release.assets) : null;

      if (hasUpdate && this.matchedAsset) {
        this.updateStatus({
          hasUpdate: true,
          currentVersion: currentVer,
          latestVersion: latestTag,
          releaseNotes: release.body,
          assetName: this.matchedAsset.name,
          assetSize: this.matchedAsset.size,
          status: 'available',
        });

        if (this.onUpdateFound) {
          this.onUpdateFound(latestTag, release.body || '');
        }
      } else {
        this.updateStatus({
          hasUpdate: false,
          currentVersion: currentVer,
          latestVersion: latestTag || currentVer,
          status: 'idle',
        });
      }

      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus({
        status: 'error',
        errorMessage: message,
      });
      return this.getStatus();
    }
  }

  public async startDownloadAndInstall(): Promise<void> {
    if (this.isDownloading) return;
    if (!this.matchedAsset) {
      throw new Error('No update asset found for your platform.');
    }

    this.isDownloading = true;
    const asset = this.matchedAsset;
    const destDir = app.getPath('temp');
    const destPath = path.join(destDir, asset.name);

    this.updateStatus({
      status: 'downloading',
      progressPercent: 0,
    });

    try {
      const res = await fetch(asset.browser_download_url, {
        headers: {
          'User-Agent': 'DeskPals-App',
        },
        redirect: 'follow',
      });

      if (!res.ok || !res.body) {
        throw new Error(`Failed to download: HTTP ${res.status}`);
      }

      const contentLength = res.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : asset.size || 0;
      let downloadedBytes = 0;

      const fileStream = fs.createWriteStream(destPath);
      const reader = res.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          downloadedBytes += value.length;
          fileStream.write(Buffer.from(value));

          if (totalBytes > 0) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            this.updateStatus({
              status: 'downloading',
              progressPercent: percent,
            });
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.updateStatus({
        status: 'ready',
        progressPercent: 100,
      });

      // Launch installer
      await this.applyUpdate(destPath);
    } catch (error) {
      this.isDownloading = false;
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus({
        status: 'error',
        errorMessage: message,
      });
      throw error;
    }
  }

  private async applyUpdate(installerPath: string): Promise<void> {
    if (process.platform === 'darwin') {
      // Open the DMG installer so the user can complete the replace
      await shell.openPath(installerPath);
      setTimeout(() => {
        app.quit();
      }, 1500);
    } else if (process.platform === 'win32') {
      // On Windows, launch the NSIS installer detached and close the running app
      const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => {
        app.quit();
      }, 1000);
    } else {
      await shell.openPath(installerPath);
    }
  }

  private updateStatus(partial: Partial<UpdateStatusPayload>): void {
    this.currentStatus = {
      ...this.currentStatus,
      ...partial,
    };
    this.onStatusChange(this.getStatus());
  }
}
