import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('loudTalker', {
  sendLoudState: (isLoud: boolean) => ipcRenderer.send('loud-state', isLoud),
  setRunning: (isRunning: boolean) => ipcRenderer.send('meter-running', isRunning),
  onLoudState: (cb: (isLoud: boolean) => void) =>
    ipcRenderer.on('loud-state', (_e, isLoud: boolean) => cb(isLoud)),
  requestMic: () => ipcRenderer.invoke('request-mic'),
  quit: () => ipcRenderer.send('quit'),
});
