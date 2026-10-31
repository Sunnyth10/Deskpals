# Companion Desk

Five desktop companions (cat, fox, ghost, robot, web hero) in a transparent Electron overlay for macOS and Windows. The tray menu selects exactly one companion at a time.

## Run

```sh
npm install
npm start
```

`npm start` builds the TypeScript with esbuild before launching Electron. The launcher removes an inherited `ELECTRON_RUN_AS_NODE` setting that would otherwise start Electron as plain Node.

## Test and build

```sh
npm run typecheck
npm test
npm run build
npm run debug
```

The smoke test covers the five companions, grab/throw/landing, one-at-a-time switching and disposal, settings parsing and legacy migration, and display resizing/floor updates. Debug mode prints aggregate CPU use and renderer FPS/state every five seconds.

Create installers with `npm run dist:mac` or `npm run dist:win`. The macOS target creates DMGs for arm64 and x64; Windows creates an x64 NSIS installer. Build on the target operating system for the most reliable result. Cross-building Windows installers on macOS requires Wine. The Windows fullscreen monitor script and `assets/tray.png` are included in the package.

## Tray menu

Choose one companion from the radio list, trigger a reaction, choose a display, pause/resume, toggle launch at login, open the main log, or quit. The tray icon and menu remain available if the overlay has a renderer error or the companion is temporarily hidden.

## Settings and logs

Settings are stored in Electron’s `userData/settings.json` directory. Old `companions` arrays migrate using their first entry. Missing, empty, invalid, or corrupt settings fall back to the cat. Updates use a temporary file and rename so a partial write cannot replace the last complete settings file.

Errors are written to `userData/logs/main.log`, with one rotated backup at `main.log.1` (each file is capped at about 1 MB). Use **Show log** in the tray menu to open it.

## Focus and input

The overlay uses `focusable: false`, `showInactive()`, and macOS panel window type. It never calls `win.focus()` or `app.focus()`. The native `@akiflow/electron-panel-window` helper was tested against Electron 33: its native module rebuilt, but the app crashed at runtime with `-[PROPanel setDisableKeyOrMainWindow:]: unrecognized selector`, so it is not included.

As a macOS fallback, the app records the frontmost app before making the companion interactive and reopens that app after a grab ends. Right-click popup menus on companions are disabled; use the tray menu. Please manually verify that a WhatsApp or other text caret keeps blinking while you grab, throw, and release a companion.

## Troubleshooting

- **Blank overlay:** The app falls back to the cat for invalid settings. Choose a companion in the tray menu; if needed, quit and remove `settings.json` from `userData` to reset the selection.
- **Focus changes after a throw:** Check `userData/logs/main.log`. The macOS fallback depends on reading the frontmost app and reopening it after release; this behavior still needs manual verification on macOS. On Windows, `focusable: false` and click-through toggling are configured, but need manual verification there.
- **Window missing after display or sleep changes:** The overlay retargets the saved display, falls back to primary if it was unplugged, and resets to click-through while repositioning. Power suspend and lock/unlock events stop and resume rendering.
- Electron 33 exposes system suspend and lock events, but no display-only sleep event. If a monitor powers off while the computer stays awake, separate render-loop suspension is not currently detected.
- **macOS blocks an unsigned build:** Allow the app in Privacy & Security if Gatekeeper blocks the local build. This project does not configure signing or notarization.
- **Windows fullscreen:** A foreground window covering a monitor hides the overlay until fullscreen ends. If PowerShell is restricted, inspect the main log.

## Packaging and signing

Code signing is not configured. macOS distribution needs an Apple Developer ID Application certificate and notarization credentials. Windows distribution needs an Authenticode code-signing certificate. Configure those only when you are ready to distribute signed installers.

There is no size menu option: companion scale is currently owned by each companion implementation, and changing it consistently would require editing the protected companion files.
