import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('loudTalker', {
  sendLoudState: (state: LoudState) => ipcRenderer.send('loud-state', state),
  setRunning: (isRunning: boolean) => ipcRenderer.send('meter-running', isRunning),
  onLoudState: (cb: (state: LoudState) => void) =>
    ipcRenderer.on('loud-state', (_e, state: LoudState) => cb(state)),
  requestMic: () => ipcRenderer.invoke('request-mic'),
  quit: () => ipcRenderer.send('quit'),
});
