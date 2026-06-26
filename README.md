# Loud Talker

_If you work from home and the whole house can hear you, this is for you_

Use biofeedback to learn how to talk just a little quieter.

A MacOS menu-bar app that gives you hard-to-ignore visual feedback when you're
talking too loudly. 

* App lives in menu bar and watches microphone
* Uses auto-gain and crest factor to fiilter out other sounds like typing, etc.
* Stores separate thresholds per device (built-in mic vs headphones)
* Allows tuning specific thresholds

When triggered it flashes a yellow or red border around your whole screen, so you see it even when an app is in full-screen mode.

Built with Electron + TypeScript.

<img width="434" height="440" alt="image" src="https://github.com/user-attachments/assets/033494b5-f233-4061-93d7-7b25b5f9abfe" />

<img width="420" height="526" alt="image" src="https://github.com/user-attachments/assets/5b29e14c-a97b-46ac-b354-2874ca59fc00" />

## Features

- **Menu-bar app** — no dock icon, no window clutter. Click the menu-bar icon for
  a popover with a live volume graph and threshold dial.
- **Live volume meter** — a scrolling graph of your mic level with a dashed
  threshold line.
- **Full-screen red flash** when you're too loud, via a transparent,
  always-on-top, click-through overlay. It works **even when the popover is
  closed** and floats above fullscreen apps like Zoom.
- **Hidden from screen sharing** — the overlay uses macOS content protection, so
  call participants never see your flash; only you do.
- **Never steals input** — the overlay is click-through and non-focusable; every
  click and keystroke passes to the app underneath.
- **Auto-listen on start** (toggleable) and a **persisted threshold** that
  survives restarts.

## Requirements

- macOS (primary target; Electron is cross-platform, so other platforms are a
  future bonus).
- Node.js 20+ and npm.

## Quick start

```sh
make run
```

`make run` installs dependencies (idempotently), builds, and launches the app.

### Make targets

| Target         | What it does                                                        |
| -------------- | ------------------------------------------------------------------- |
| `make install` | Set up the full build environment (`npm install`). Idempotent.      |
| `make build`   | Compile TypeScript and copy renderer assets into `dist/`.           |
| `make run`     | Depends on `install`; builds and launches the app.                  |
| `make start`   | Alias for `make run`.                                               |
| `make clean`   | Remove `dist/` and `node_modules/`.                                 |
| `make reset`   | `clean` + clear Electron's global download cache. Use if Electron won't install. |

`make install` self-heals a common Electron hiccup: if Electron's binary
download didn't complete (so `node_modules/electron` is missing its `path.txt`
or `dist/`), the next `make install`/`make run` re-fetches the binary
automatically. If it's still wedged, run `make reset` then `make run`.

You can also use the npm scripts directly: `npm install`, `npm run build`,
`npm start`.

## Usage

1. Run `make run`. A small circle icon appears in your **menu bar** (no dock
   icon, no window).
2. By default the app starts listening immediately. The first launch prompts for
   **microphone access** — allow it.
3. Click the menu-bar icon to open the popover. Drag the **Threshold** dial just
   above your normal speaking level (the dashed orange line on the graph).
4. Talk louder than the threshold and the whole screen flashes a red border; the
   menu-bar icon also shows 🔴. The flash keeps working after you close the
   popover.
5. Right-click the menu-bar icon (or use the popover's **Quit** button) to exit.

### Settings

- **Listen on start** — checkbox in the popover (default on). Controls whether
  the meter auto-starts on launch.
- **Threshold** — the dial value; both settings persist across runs (stored in
  the renderer's `localStorage`).

## How it works

Three pieces communicate over a small typed IPC bridge (`src/preload.ts`):

- **Main process** (`src/main.ts`) — owns the menu-bar `Tray`, the frameless
  popover window, and the always-on-top flash overlay. It forwards the
  "too loud" signal from the meter to the overlay and updates the tray title.
- **Popover renderer** (`src/renderer/main_renderer.ts`) — captures the mic via
  the Web Audio API (`getUserMedia` → `AnalyserNode`), computes a smoothed RMS
  level on a timer (so it keeps running while the popover is hidden), draws the
  graph, and reports threshold crossings.
- **Overlay renderer** (`src/renderer/overlay_renderer.ts`) — toggles the
  pulsing red border in response to loud-state messages.

The popover window uses `backgroundThrottling: false` and a `setInterval` sample
loop (rather than `requestAnimationFrame`) specifically so the meter keeps
measuring — and the flash keeps firing — while the popover is closed during a
call.

## Project structure

```
src/
  main.ts                  # main process: tray, popover, overlay, IPC
  preload.ts               # contextBridge IPC API
  global.d.ts              # window.loudTalker type
  renderer/
    index.html             # popover UI
    main_renderer.ts       # mic capture, meter, graph, dial
    overlay.html           # full-screen flash window
    overlay_renderer.ts    # red-border toggle
    styles.css             # popover + overlay styles
assets/
  trayTemplate.png         # menu-bar icon (generated)
scripts/
  gen-tray-icon.js         # regenerates the tray icon PNGs
```

## License

MIT
