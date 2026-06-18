export {};

declare global {
  interface Window {
    loudTalker: {
      /** Meter side: tell the overlay/tray whether we're currently too loud. */
      sendLoudState(isLoud: boolean): void;
      /** Meter side: report whether the meter is actively listening. */
      setRunning(isRunning: boolean): void;
      /** Overlay side: subscribe to loud-state changes. */
      onLoudState(cb: (isLoud: boolean) => void): void;
      /** Ask macOS for microphone access (no-op / true on other platforms). */
      requestMic(): Promise<boolean>;
      /** Quit the whole app. */
      quit(): void;
    };
  }
}
