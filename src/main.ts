import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from 'electron';
import * as path from 'path';

let tray: Tray | null = null;
let panel: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;

let running = false; // meter active?
let loud: LoudState = 'off';

let iconNormal: Electron.NativeImage;
let iconWarning: Electron.NativeImage;
let iconLimit: Electron.NativeImage;

const PANEL_WIDTH = 430;
const PANEL_HEIGHT = 540;

function createPanel(): void {
  panel = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Critical: keep the audio meter running while the popover is hidden,
      // so the flash still works during a call with the panel closed.
      backgroundThrottling: false,
    },
  });

  panel.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Hide when the user clicks away, like a normal menu-bar popover.
  panel.on('blur', () => {
    if (panel && !panel.webContents.isDevToolsOpened()) panel.hide();
  });
}

function createOverlayWindow(): void {
  const { bounds } = screen.getPrimaryDisplay();

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Float above everything (including fullscreen Zoom) but never grab input.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Exclude from screen capture so call participants never see the flash.
  overlayWindow.setContentProtection(true);

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.once('ready-to-show', () => overlayWindow?.showInactive());
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function showPanel(): void {
  if (!panel || !tray) return;
  const trayBounds = tray.getBounds();
  const { width } = panel.getBounds();
  const work = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  }).workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2);
  // Keep the panel on screen if the tray icon is near the right edge.
  x = Math.min(x, work.x + work.width - width - 8);
  x = Math.max(x, work.x + 8);
  const y = Math.round(trayBounds.y + trayBounds.height + 4);

  panel.setPosition(x, y, false);
  panel.show();
  panel.focus();
}

function togglePanel(): void {
  if (!panel) return;
  panel.isVisible() ? panel.hide() : showPanel();
}

function iconPath(variant: string): string {
  return path.join(app.getAppPath(), 'assets', `trayTemplate${variant}.png`);
}

function updateTray(): void {
  if (!tray) return;
  const img = loud === 'limit' ? iconLimit : loud === 'warning' ? iconWarning : iconNormal;
  tray.setImage(img);
  tray.setToolTip(
    loud === 'off'
      ? running
        ? 'Loud Talker — listening'
        : 'Loud Talker — idle'
      : loud === 'warning'
        ? 'Too loud!'
        : 'Way too loud!',
  );
}

function createTray(): void {
  iconNormal = nativeImage.createFromPath(iconPath(''));
  iconNormal.setTemplateImage(true);
  iconWarning = nativeImage.createFromPath(iconPath('Warning'));
  iconWarning.setTemplateImage(true);
  iconLimit = nativeImage.createFromPath(iconPath('Limit'));
  iconLimit.setTemplateImage(true);

  tray = new Tray(iconNormal);
  tray.setToolTip('Loud Talker');
  updateTray();

  tray.on('click', togglePanel);
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: panel?.isVisible() ? 'Hide' : 'Show', click: togglePanel },
      { type: 'separator' },
      { label: 'Quit Loud Talker', click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });
}

app.whenReady().then(() => {
  // No dock icon — this lives purely in the menu bar.
  app.dock?.hide();

  // Allow getUserMedia's permission request from the renderer.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => callback(permission === 'media'),
  );

  ipcMain.handle('request-mic', async () => {
    if (process.platform === 'darwin') {
      try {
        const status = systemPreferences.getMediaAccessStatus('microphone');
        if (status === 'denied') return false;
        if (status === 'granted') return true;
        return await systemPreferences.askForMediaAccess('microphone');
      } catch {
        return false;
      }
    }
    return true;
  });

  ipcMain.on('open-mic-settings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    }
  });

  // Forward loud-state from the meter to the flash overlay + tray title.
  ipcMain.on('loud-state', (_e, state: LoudState) => {
    loud = state;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('loud-state', state);
    }
    updateTray();
  });

  ipcMain.on('meter-running', (_e, isRunning: boolean) => {
    running = isRunning;
    updateTray();
  });

  ipcMain.on('quit', () => app.quit());

  createTray();
  createPanel();
  createOverlayWindow();
});

// Hiding the popover must not quit the app; it lives in the tray.
app.on('window-all-closed', () => {
  /* no-op: keep running in the menu bar */
});
