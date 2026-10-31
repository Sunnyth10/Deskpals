# companion-desk

Your five companions (cat, fox, ghost, robot, web hero) running on the desktop in a
transparent, click-through Electron overlay. macOS and Windows.

## Run
    npm install
    npm start            # builds, then launches
    npm run debug        # same, and prints CPU + fps + companion states every 5 s
    npm run typecheck    # tsc, strict
    npm test             # headless smoke test (idle, grab, throw, land, events, all five)

Control everything from the menu-bar / tray icon (or right-click a companion):
pick which companions are out (several at once), trigger reactions (save / run /
build success / build error), choose the display, pause, launch at login, quit.

## What was reused vs. new
Unchanged (only two import paths edited): `src/renderer/companions/*` (all five companions,
their Grab layers, `CompanionGrab`, `CompanionPhysics`, `CompanionBounds`) and
`src/engine/particles/ParticleEngine.ts`. `src/core/types.ts` is trimmed to the 5 types they use.

New:
- `src/renderer/Stage.ts`: hosts the companions exactly like the extension's CanvasRenderer
  (full-canvas physics world, floor 4 px above the bottom, X clamp unless held/airborne),
  plus the frame-rate tiers. No Electron/DOM dependency.
- `src/renderer/OverlayPointerHost.ts`: replaces CompanionPointerHost. Toggles window
  click-through over the companion's pixels instead of toggling CSS pointer-events.
- `src/main/main.ts`: overlay window, tray menu, settings (saved in userData/settings.json).

## Architecture
One transparent overlay window per run, covering the work area of one display (screen minus
Dock/taskbar/menu bar), so the Dock/taskbar is the floor. The window is
`focusable: false` (+ `type: 'panel'` on macOS) so clicking/throwing a companion never steals
keyboard focus from the app you are typing in. It is click-through except over a companion.

## Power
- Frame tiers in `Stage.ts`: 60 fps while held/thrown, 30 fps awake and calm, 12 fps when all
  are asleep. Tune `FPS_ACTIVE / FPS_CALM / FPS_SLEEP`.
- The loop stops completely when no companion is selected, when paused, or when the window is
  hidden (macOS hides it in other apps' fullscreen Spaces).
- Canvas DPR is capped at 2.
- Measure with `npm run debug`.

## Known limits / next steps
- Companions live on one display at a time (menu: Display). Crossing displays is not done.
- No detection of fullscreen apps on Windows yet (macOS hides the overlay in fullscreen Spaces).
- Click-through toggling can miss the very first pixel of a hover at a companion's edge.
- The VS Code `editorCompanion` code was not included (only its compiled `out/` was in the zip).
