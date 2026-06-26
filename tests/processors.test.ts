import { describe, it, expect } from 'vitest';
import { AudioFrame, LegacyProcessor, CrestFactorProcessor } from '../src/renderer/processors';

function frame(level: number, rms = 0.1, db = -20, samples?: Float32Array): AudioFrame {
  return { rms, db, level, samples: samples ?? new Float32Array(2048).fill(0.1) };
}

describe('LegacyProcessor', () => {
  it('flags a jump >= 30 as typing', () => {
    const p = new LegacyProcessor();
    expect(p.isTyping(frame(10))).toBe(false);
    expect(p.isTyping(frame(45))).toBe(true);
  });

  it('does not flag gradual changes as typing', () => {
    const p = new LegacyProcessor();
    p.isTyping(frame(30)); // seed prevLevel
    expect(p.isTyping(frame(35))).toBe(false); // +5
    expect(p.isTyping(frame(42))).toBe(false); // +7
  });

  it('flags drops as non-typing (only upward jumps count)', () => {
    const p = new LegacyProcessor();
    p.isTyping(frame(50));
    expect(p.isTyping(frame(20))).toBe(false);
  });

  it('reset clears internal state', () => {
    const p = new LegacyProcessor();
    p.isTyping(frame(80));
    p.reset();
    expect(p.isTyping(frame(0))).toBe(false);
  });
});

describe('CrestFactorProcessor', () => {
  it('returns false for low crest factor (speech-like)', () => {
    const samples = new Float32Array(2048);
    // Pure sine wave: rms = amplitude / sqrt(2), peak = amplitude
    // crest = peak / rms = sqrt(2) ≈ 1.41
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin(2 * Math.PI * 100 * i / 44100);
    }
    const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
    const p = new CrestFactorProcessor(2); // threshold above √2
    expect(p.isTyping(frame(50, rms, -20, samples))).toBe(false);
  });

  it('returns true for high crest factor (click-like)', () => {
    const samples = new Float32Array(2048);
    samples[0] = 1.0; // single sample peak
    // rms of mostly silence with one peak
    const rms = Math.sqrt(1 / samples.length);
    const p = new CrestFactorProcessor(10);
    // crest = 1.0 / rms = sqrt(2048) ≈ 45
    expect(p.isTyping(frame(50, rms, -20, samples))).toBe(true);
  });

  it('returns false for near silence', () => {
    const p = new CrestFactorProcessor(10);
    expect(p.isTyping(frame(0, 0.005, -100))).toBe(false);
  });

  it('respects custom threshold', () => {
    const samples = new Float32Array(2048);
    samples[0] = 1.0;
    const rms = Math.sqrt(1 / samples.length);
    const crest = 1.0 / rms; // ≈ 45

    const strict = new CrestFactorProcessor(crest + 1);
    expect(strict.isTyping(frame(50, rms, -20, samples))).toBe(false);

    const permissive = new CrestFactorProcessor(crest - 1);
    expect(permissive.isTyping(frame(50, rms, -20, samples))).toBe(true);
  });

  it('reset is a no-op (no state to clear)', () => {
    const p = new CrestFactorProcessor();
    p.reset();
    expect(true).toBe(true); // just ensure no error
  });
});
