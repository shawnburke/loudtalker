export interface AudioFrame {
  rms: number;
  db: number;
  level: number;
  samples: Float32Array;
}

export interface Processor {
  readonly id: string;
  readonly label: string;
  isTyping(frame: AudioFrame): boolean;
  reset(): void;
}

export class LegacyProcessor implements Processor {
  readonly id = 'legacy';
  readonly label = 'Legacy (jump detection)';
  private prevLevel = 0;

  isTyping(frame: AudioFrame): boolean {
    const result = frame.level - this.prevLevel >= 30;
    this.prevLevel = frame.level;
    return result;
  }

  reset(): void {
    this.prevLevel = 0;
  }
}

export class CrestFactorProcessor implements Processor {
  readonly id = 'crest';
  readonly label = 'Crest factor';
  private readonly threshold: number;

  constructor(threshold = 10) {
    this.threshold = threshold;
  }

  isTyping(frame: AudioFrame): boolean {
    if (frame.rms < 0.01) return false;
    let peak = 0;
    const s = frame.samples;
    for (let i = 0; i < s.length; i++) {
      const abs = Math.abs(s[i]);
      if (abs > peak) peak = abs;
    }
    return peak / frame.rms > this.threshold;
  }

  reset(): void {}
}

export function createProcessor(id: string, crestThreshold = 10): Processor {
  return id === 'crest' ? new CrestFactorProcessor(crestThreshold) : new LegacyProcessor();
}
