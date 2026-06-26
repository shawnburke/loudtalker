// --- Pluggable typing filter ---
interface AudioFrame {
  rms: number;
  db: number;
  level: number;
  samples: Float32Array;
}

interface Processor {
  readonly id: string;
  readonly label: string;
  isTyping(frame: AudioFrame): boolean;
  reset(): void;
}

class LegacyProcessor implements Processor {
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

class CrestFactorProcessor implements Processor {
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

function createProcessor(id: string, crestThreshold = 10): Processor {
  return id === 'crest' ? new CrestFactorProcessor(crestThreshold) : new LegacyProcessor();
}

const toggleBtn = document.getElementById('toggle') as HTMLButtonElement;
const quitBtn = document.getElementById('quit') as HTMLButtonElement;
const listenOnStartEl = document.getElementById('listen-on-start') as HTMLInputElement;
const autoGainEl = document.getElementById('auto-gain') as HTMLInputElement;
const deviceNameEl = document.getElementById('device-name') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const canvas = document.getElementById('graph') as HTMLCanvasElement;
const warningInput = document.getElementById('warning') as HTMLInputElement;
const warningValueEl = document.getElementById('warning-value') as HTMLSpanElement;
const limitInput = document.getElementById('limit') as HTMLInputElement;
const limitValueEl = document.getElementById('limit-value') as HTMLSpanElement;
const levelEl = document.getElementById('level') as HTMLSpanElement;
const releaseInput = document.getElementById('release') as HTMLInputElement;
const releaseValueEl = document.getElementById('release-value') as HTMLSpanElement;
const warnHoldInput = document.getElementById('warn-hold') as HTMLInputElement;
const warnHoldValueEl = document.getElementById('warn-hold-value') as HTMLSpanElement;
const limitHoldInput = document.getElementById('limit-hold') as HTMLInputElement;
const limitHoldValueEl = document.getElementById('limit-hold-value') as HTMLSpanElement;
const minConsInput = document.getElementById('min-consecutive') as HTMLInputElement;
const minConsValueEl = document.getElementById('min-consecutive-value') as HTMLSpanElement;
const processorSelect = document.getElementById('processor-select') as HTMLSelectElement;
const crestThresholdInput = document.getElementById('crest-threshold') as HTMLInputElement;
const crestThresholdValueEl = document.getElementById('crest-threshold-value') as HTMLSpanElement;
const g = canvas.getContext('2d')!;

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// --- Tunables ---
const SAMPLE_MS = 33; // ~30 Hz; timer-based so it runs while popover is hidden

const GATE_DB = -55; // quieter than this counts as silence (never trips)
const DB_MIN = -60; // bottom of the displayed scale
const DB_MAX = 0; // top of the displayed scale
const ATTACK = 0.5; // smoothing when getting louder (fast)
let RELEASE = 0.4; // smoothing when getting quieter
let MIN_CONSECUTIVE = 3; // samples above threshold before triggering
let WARN_HOLD_MS = 200; // yellow flash hold after dropping below warning
let LIMIT_HOLD_MS = 800; // red flash hold after dropping below limit

// --- Device classification (for display only) ---
type DeviceClass = 'builtin' | 'headset' | 'external' | 'unknown';

let deviceClass: DeviceClass = 'unknown';
let micLabel = '';

function classifyDevice(label: string): DeviceClass {
  const lower = label.toLowerCase();
  if (/built[- ]?in|macbook/.test(lower)) return 'builtin';
  if (/airpods|beats|headphone|headset|earphone|earpod|earbud|earpiece/.test(lower)) return 'headset';
  return 'external';
}

// Thresholds are stored keyed by the actual mic label (e.g. "warning_MacBook Pro Microphone")
// so separate devices keep their own settings.
function storageKey(prefix: string): string {
  return micLabel ? `${prefix}_${micLabel}` : prefix;
}

// --- Thresholds (persisted per microphone name) ---
const DEFAULT_WARN = 60;
const DEFAULT_LIMIT = 80;

const saved = localStorage.getItem('warning') ?? localStorage.getItem('threshold');
warningInput.value = saved ?? String(DEFAULT_WARN);
const limSaved = localStorage.getItem('limit');
limitInput.value = limSaved ?? String(DEFAULT_LIMIT);

let warningThreshold = Number(warningInput.value);
let limitThreshold = Number(limitInput.value);
warningValueEl.textContent = String(warningThreshold);
limitValueEl.textContent = String(limitThreshold);

warningInput.addEventListener('input', () => {
  let val = Number(warningInput.value);
  if (val > limitThreshold) { val = limitThreshold; warningInput.value = String(val); }
  warningThreshold = val;
  warningValueEl.textContent = String(val);
  localStorage.setItem(storageKey('warning'), String(val));
  draw();
});

limitInput.addEventListener('input', () => {
  let val = Number(limitInput.value);
  if (val < warningThreshold) { val = warningThreshold; limitInput.value = String(val); }
  limitThreshold = val;
  limitValueEl.textContent = String(val);
  localStorage.setItem(storageKey('limit'), String(val));
  draw();
});

// --- "Listen on start" preference (persisted, default on) ---
const listenPref = localStorage.getItem('listenOnStart');
const listenOnStart = listenPref === null ? true : listenPref === 'true';
listenOnStartEl.checked = listenOnStart;
listenOnStartEl.addEventListener('change', () => {
  localStorage.setItem('listenOnStart', String(listenOnStartEl.checked));
});

// --- Auto gain control preference (persisted, default on) ---
const autoGainPref = localStorage.getItem('autoGain');
const autoGain = autoGainPref === null ? true : autoGainPref === 'true';
autoGainEl.checked = autoGain;
autoGainEl.addEventListener('change', () => {
  localStorage.setItem('autoGain', String(autoGainEl.checked));
  if (running) {
    stop();
    start();
  }
});

// --- Advanced tunables (persisted, applies live) ---
function loadAdvanced(): void {
  const defs: [string, string, (v: string) => void][] = [
    ['release', '0.4', (v) => { RELEASE = Number(v); releaseInput.value = v; releaseValueEl.textContent = v; }],
    ['minConsecutive', '3', (v) => { MIN_CONSECUTIVE = Number(v); minConsInput.value = v; minConsValueEl.textContent = v; }],
    ['warnHoldMs', '200', (v) => { WARN_HOLD_MS = Number(v); warnHoldInput.value = v; warnHoldValueEl.textContent = v; }],
    ['limitHoldMs', '800', (v) => { LIMIT_HOLD_MS = Number(v); limitHoldInput.value = v; limitHoldValueEl.textContent = v; }],
  ];
  for (const [key, fallback, apply] of defs) {
    const saved = localStorage.getItem(key);
    apply(saved ?? fallback);
  }
}
loadAdvanced();

releaseInput.addEventListener('input', () => {
  const v = releaseInput.value;
  RELEASE = Number(v);
  releaseValueEl.textContent = v;
  localStorage.setItem('release', v);
});

minConsInput.addEventListener('input', () => {
  const v = minConsInput.value;
  MIN_CONSECUTIVE = Number(v);
  minConsValueEl.textContent = v;
  localStorage.setItem('minConsecutive', v);
});

warnHoldInput.addEventListener('input', () => {
  const v = warnHoldInput.value;
  WARN_HOLD_MS = Number(v);
  warnHoldValueEl.textContent = v;
  localStorage.setItem('warnHoldMs', v);
});

limitHoldInput.addEventListener('input', () => {
  const v = limitHoldInput.value;
  LIMIT_HOLD_MS = Number(v);
  limitHoldValueEl.textContent = v;
  localStorage.setItem('limitHoldMs', v);
});

const savedCrestThreshold = Number(localStorage.getItem('crestThreshold') ?? '10');
crestThresholdInput.value = String(savedCrestThreshold);
crestThresholdValueEl.textContent = String(savedCrestThreshold);

let processor: Processor = createProcessor(localStorage.getItem('processor') ?? 'crest', savedCrestThreshold);
processorSelect.value = processor.id;

processorSelect.addEventListener('change', () => {
  processor = createProcessor(processorSelect.value, Number(crestThresholdInput.value));
  processor.reset();
  localStorage.setItem('processor', processor.id);
});

crestThresholdInput.addEventListener('input', () => {
  const v = crestThresholdInput.value;
  crestThresholdValueEl.textContent = v;
  localStorage.setItem('crestThreshold', v);
  if (processor.id === 'crest') {
    processor = new CrestFactorProcessor(Number(v));
  }
});

// --- Audio state ---
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let timeData: Float32Array<ArrayBuffer> | null = null;
let timerId: number | null = null;
let running = false;

let displayLevel = 0; // smoothed 0..100
let loud: LoudState = 'off';
let lastWarningTime = 0;
let lastLimitTime = 0;
let warnAboveCount = 0;
let limitAboveCount = 0;
const levels: number[] = new Array(WIDTH).fill(0);

function dbToLevel(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
}

function setLoud(next: LoudState): void {
  if (next === loud) return;
  loud = next;
  window.loudTalker.sendLoudState(loud);
  statusEl.textContent = loud === 'limit' ? 'LIMIT' : loud === 'warning' ? 'TOO LOUD' : 'Listening';
  statusEl.classList.toggle('loud', loud !== 'off');
}

async function start(): Promise<void> {
  try {
    await window.loudTalker.requestMic();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: autoGainEl.checked,
      },
    });
  } catch {
    statusEl.textContent = 'Mic permission denied';
    return;
  }

  const label = stream!.getAudioTracks()[0].label;
  micLabel = label;
  deviceClass = classifyDevice(label);
  deviceNameEl.textContent = `${label} · ${deviceClass}`;
  const devWarn = localStorage.getItem(storageKey('warning')) ?? localStorage.getItem(`warning_${deviceClass}`);
  const devLimit = localStorage.getItem(storageKey('limit')) ?? localStorage.getItem(`limit_${deviceClass}`);
  if (devWarn !== null) {
    warningThreshold = Number(devWarn);
    warningInput.value = devWarn;
    warningValueEl.textContent = devWarn;
  }
  if (devLimit !== null) {
    limitThreshold = Number(devLimit);
    limitInput.value = devLimit;
    limitValueEl.textContent = devLimit;
  }
  draw();

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 4000;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  source.connect(filter);
  filter.connect(analyser);
  timeData = new Float32Array(analyser.fftSize);

  running = true;
  window.loudTalker.setRunning(true);
  toggleBtn.textContent = 'Stop';
  toggleBtn.classList.add('running');
  statusEl.textContent = 'Listening';
  // setInterval (not requestAnimationFrame) keeps measuring while the popover
  // is hidden, so the flash works during calls.
  timerId = window.setInterval(tick, SAMPLE_MS);
}

function stop(): void {
  running = false;
  window.loudTalker.setRunning(false);
  if (timerId !== null) clearInterval(timerId);
  timerId = null;
  stream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  stream = null;
  audioCtx = null;
  analyser = null;
  timeData = null;

  toggleBtn.textContent = 'Go';
  toggleBtn.classList.remove('running');
  setLoud('off');
  statusEl.textContent = 'Idle';
  statusEl.classList.remove('loud');
  deviceNameEl.textContent = '';
  displayLevel = 0;
  lastWarningTime = 0;
  lastLimitTime = 0;
  warnAboveCount = 0;
  limitAboveCount = 0;
  processor.reset();
  levels.fill(0);
  draw();
}

function tick(): void {
  if (!running || !analyser || !timeData) return;

  analyser.getFloatTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    sum += timeData[i] * timeData[i];
  }
  const rms = Math.sqrt(sum / timeData.length);
  const db = rms > 0 ? 20 * Math.log10(rms) : -100;
  const target = db < GATE_DB ? 0 : dbToLevel(db);

  const isTyping = processor.isTyping({ rms, db, level: target, samples: timeData });

  const coeff = target > displayLevel ? ATTACK : RELEASE;
  displayLevel += (target - displayLevel) * coeff;

  const now = performance.now();
  const aboveWarn = displayLevel >= warningThreshold && db >= GATE_DB;
  const aboveLimit = displayLevel >= limitThreshold && db >= GATE_DB;

  if (aboveLimit && !isTyping) { limitAboveCount++; if (limitAboveCount >= MIN_CONSECUTIVE) lastLimitTime = now; }
  else if (!aboveLimit) limitAboveCount = 0;

  if (aboveWarn && !isTyping) { warnAboveCount++; if (warnAboveCount >= MIN_CONSECUTIVE) lastWarningTime = now; }
  else if (!aboveWarn) warnAboveCount = 0;

  const inWarn = aboveWarn || (now - lastWarningTime < WARN_HOLD_MS);
  const inLimit = aboveLimit || (now - lastLimitTime < LIMIT_HOLD_MS);

  const next: LoudState = inLimit ? 'limit' : inWarn ? 'warning' : 'off';
  setLoud(next);

  levelEl.textContent = 'Level: ' + Math.round(displayLevel);

  levels.push(displayLevel);
  levels.shift();
  if (!document.hidden) draw();
}

function draw(): void {
  g.clearRect(0, 0, WIDTH, HEIGHT);
  g.fillStyle = '#010409';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  const limitY = HEIGHT - (limitThreshold / 100) * HEIGHT;
  const warnY = HEIGHT - (warningThreshold / 100) * HEIGHT;

  // red zone (above limit)
  g.fillStyle = 'rgba(255, 0, 0, 0.08)';
  g.fillRect(0, 0, WIDTH, limitY);

  // yellow zone (warning to limit)
  g.fillStyle = 'rgba(255, 200, 0, 0.08)';
  g.fillRect(0, limitY, WIDTH, warnY - limitY);

  // limit threshold line
  g.beginPath();
  g.moveTo(0, limitY);
  g.lineTo(WIDTH, limitY);
  g.strokeStyle = '#ff4d4d';
  g.lineWidth = 1.5;
  g.setLineDash([6, 4]);
  g.stroke();

  // warning threshold line
  g.beginPath();
  g.moveTo(0, warnY);
  g.lineTo(WIDTH, warnY);
  g.strokeStyle = '#ffae00';
  g.lineWidth = 1.5;
  g.setLineDash([6, 4]);
  g.stroke();
  g.setLineDash([]);

  // volume trace
  g.beginPath();
  for (let x = 0; x < levels.length; x++) {
    const y = HEIGHT - (levels[x] / 100) * HEIGHT;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = loud !== 'off' ? '#ff4d4d' : '#4da6ff';
  g.lineWidth = 2;
  g.stroke();
}

// Redraw immediately when the popover is reopened.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) draw();
});

toggleBtn.addEventListener('click', () => (running ? stop() : start()));
quitBtn.addEventListener('click', () => window.loudTalker.quit());
draw();

// Begin listening automatically when the preference is enabled.
if (listenOnStart) start();

// Hot-swap when the user plugs/unplugs headphones.
navigator.mediaDevices.addEventListener('devicechange', () => {
  if (running) {
    stop();
    start();
  }
});
