export {};

declare global {
  type LoudState = 'off' | 'warning' | 'limit';

  interface Window {
    loudTalker: {
      /** Meter side: tell the overlay/tray the current loudness state. */
      sendLoudState(state: LoudState): void;
      /** Meter side: report whether the meter is actively listening. */
      setRunning(isRunning: boolean): void;
      /** Overlay side: subscribe to loud-state changes. */
      onLoudState(cb: (state: LoudState) => void): void;
      /** Ask macOS for microphone access (no-op / true on other platforms). */
      requestMic(): Promise<boolean>;
      /** Open macOS System Settings to the microphone privacy pane. */
      openMicSettings(): void;
      /** Quit the whole app. */
      quit(): void;
    };
  }
}
