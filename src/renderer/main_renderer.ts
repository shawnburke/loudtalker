import { AudioFrame, Processor, LegacyProcessor, CrestFactorProcessor, createProcessor } from './processors';

const toggleBtn = document.getElementById('toggle') as HTMLButtonElement;
const quitBtn = document.getElementById('quit') as HTMLButtonElement;
const listenOnStartEl = document.getElementById('listen-on-start') as HTMLInputElement;
const autoGainEl = document.getElementById('auto-gain') as HTMLInputElement;
const deviceNameEl = document.getElementById('device-name') as HTMLSpanElement;
const canvas = document.getElementById('graph') as HTMLCanvasElement;
const warningInput = document.getElementById('warning') as HTMLInputElement;
const warningValueEl = document.getElementById('warning-value') as HTMLSpanElement;
const limitInput = document.getElementById('limit') as HTMLInputElement;
const limitValueEl = document.getElementById('limit-value') as HTMLSpanElement;
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
const micDeniedEl = document.getElementById('mic-denied') as HTMLDivElement;
const openMicSettingsBtn = document.getElementById('open-mic-settings') as HTMLButtonElement;
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusLabel = document.getElementById('status-label') as HTMLSpanElement;
const levelFill = document.getElementById('level-fill') as HTMLDivElement;
const levelNum = document.getElementById('level-num') as HTMLSpanElement;
const tickWarn = document.getElementById('tick-warn') as HTMLDivElement;
const tickLimit = document.getElementById('tick-limit') as HTMLDivElement;
const g = canvas.getContext('2d')!;

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// --- Tunables ---
const SAMPLE_MS = 33;
const GATE_DB = -55;
const DB_MIN = -60;
const DB_MAX = 0;
const ATTACK = 0.5;
let RELEASE = 0.4;
let MIN_CONSECUTIVE = 3;
let WARN_HOLD_MS = 200;
let LIMIT_HOLD_MS = 800;

type DeviceClass = 'builtin' | 'headset' | 'external' | 'unknown';
let deviceClass: DeviceClass = 'unknown';
let micLabel = '';

function classifyDevice(label: string): DeviceClass {
  const lower = label.toLowerCase();
  if (/built[- ]?in|macbook/.test(lower)) return 'builtin';
  if (/airpods|beats|headphone|headset|earphone|earpod|earbud|earpiece/.test(lower)) return 'headset';
  return 'external';
}

function storageKey(prefix: string): string {
  return micLabel ? `${prefix}_${micLabel}` : prefix;
}

// --- Thresholds ---
const DEFAULT_WARN = 65;
const DEFAULT_LIMIT = 75;

const saved = localStorage.getItem('warning') ?? localStorage.getItem('threshold');
warningInput.value = saved ?? String(DEFAULT_WARN);
const limSaved = localStorage.getItem('limit');
limitInput.value = limSaved ?? String(DEFAULT_LIMIT);

let warningThreshold = Number(warningInput.value);
let limitThreshold = Number(limitInput.value);
warningValueEl.textContent = String(warningThreshold);
limitValueEl.textContent = String(limitThreshold);

function updateSliderFill(input: HTMLInputElement, color: string): void {
  const pct = (Number(input.value) / 100) * 100;
  input.style.background = `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #22252b ${pct}%, #22252b 100%)`;
}

updateSliderFill(warningInput, '#e8b931');
updateSliderFill(limitInput, '#ef4444');

warningInput.addEventListener('input', () => {
  let val = Number(warningInput.value);
  if (val > limitThreshold) { val = limitThreshold; warningInput.value = String(val); }
  warningThreshold = val;
  warningValueEl.textContent = String(val);
  updateSliderFill(warningInput, '#e8b931');
  localStorage.setItem(storageKey('warning'), String(val));
  updateTickPositions();
  draw();
});

limitInput.addEventListener('input', () => {
  let val = Number(limitInput.value);
  if (val < warningThreshold) { val = warningThreshold; limitInput.value = String(val); }
  limitThreshold = val;
  limitValueEl.textContent = String(val);
  updateSliderFill(limitInput, '#ef4444');
  localStorage.setItem(storageKey('limit'), String(val));
  updateTickPositions();
  draw();
});

function updateTickPositions(): void {
  tickWarn.style.left = `${warningThreshold}%`;
  tickLimit.style.left = `${limitThreshold}%`;
}
updateTickPositions();

// --- Prefs ---
const listenPref = localStorage.getItem('listenOnStart');
const listenOnStart = listenPref === null ? true : listenPref === 'true';
listenOnStartEl.checked = listenOnStart;
listenOnStartEl.addEventListener('change', () => {
  localStorage.setItem('listenOnStart', String(listenOnStartEl.checked));
});

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

// --- Advanced tunables ---
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

// --- Processor ---
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

let displayLevel = 0;
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

function graphColor(state: LoudState): string {
  return state === 'limit' ? '#ef4444' : state === 'warning' ? '#e8b931' : '#e9ebef';
}

function setLoud(next: LoudState): void {
  if (next === loud) return;
  loud = next;
  window.loudTalker.sendLoudState(loud);

  if (!running) {
    statusDot.style.background = '#5b616b';
    statusDot.classList.remove('pulse');
    statusLabel.textContent = 'Idle';
    statusLabel.style.color = '#5b616b';
    return;
  }

  if (loud === 'off') {
    statusDot.style.background = '#8a8f98';
    statusDot.classList.add('pulse');
    statusLabel.textContent = 'Listening';
    statusLabel.style.color = '#9aa0a9';
  } else if (loud === 'warning') {
    statusDot.style.background = '#e8b931';
    statusDot.classList.add('pulse');
    statusLabel.textContent = 'Getting loud';
    statusLabel.style.color = '#e8b931';
  } else {
    statusDot.style.background = '#ef4444';
    statusDot.classList.add('pulse');
    statusLabel.textContent = 'TOO LOUD';
    statusLabel.style.color = '#ef4444';
  }
}

function updateLevelMeter(): void {
  levelNum.textContent = String(Math.round(displayLevel));
  levelFill.style.width = `${displayLevel}%`;
  levelFill.className = 'level-fill' + (loud === 'limit' ? ' state-alert' : loud === 'warning' ? ' state-warning' : '');
}

async function start(): Promise<void> {
  micDeniedEl.classList.add('hidden');
  const granted = await window.loudTalker.requestMic();
  if (!granted) {
    setLoud('off');
    statusDot.style.background = '#5b616b';
    statusDot.classList.remove('pulse');
    statusLabel.textContent = 'Mic permission denied';
    statusLabel.style.color = '#ff6b6b';
    micDeniedEl.classList.remove('hidden');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: autoGainEl.checked,
      },
    });
  } catch {
    statusDot.style.background = '#5b616b';
    statusDot.classList.remove('pulse');
    statusLabel.textContent = 'Mic permission denied';
    statusLabel.style.color = '#ff6b6b';
    micDeniedEl.classList.remove('hidden');
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
    updateSliderFill(warningInput, '#e8b931');
  }
  if (devLimit !== null) {
    limitThreshold = Number(devLimit);
    limitInput.value = devLimit;
    limitValueEl.textContent = devLimit;
    updateSliderFill(limitInput, '#ef4444');
  }
  updateTickPositions();
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
  setLoud('off');
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
  displayLevel = 0;
  lastWarningTime = 0;
  lastLimitTime = 0;
  warnAboveCount = 0;
  limitAboveCount = 0;
  processor.reset();
  levels.fill(0);
  setLoud('off');
  updateLevelMeter();
  deviceNameEl.textContent = '';
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

  updateLevelMeter();

  levels.push(displayLevel);
  levels.shift();
  if (!document.hidden) draw();
}

function draw(): void {
  g.clearRect(0, 0, WIDTH, HEIGHT);

  const limitY = HEIGHT - (limitThreshold / 100) * HEIGHT;
  const warnY = HEIGHT - (warningThreshold / 100) * HEIGHT;

  // Threshold lines
  g.beginPath();
  g.moveTo(0, warnY);
  g.lineTo(WIDTH, warnY);
  g.strokeStyle = '#e8b931';
  g.lineWidth = 1.5;
  g.setLineDash([6, 5]);
  g.globalAlpha = 0.8;
  g.stroke();

  g.beginPath();
  g.moveTo(0, limitY);
  g.lineTo(WIDTH, limitY);
  g.strokeStyle = '#ef4444';
  g.lineWidth = 1.5;
  g.setLineDash([6, 5]);
  g.globalAlpha = 0.8;
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;

  // Waveform area fill
  const lineColor = graphColor(loud);
  const areaGrad = g.createLinearGradient(0, 0, 0, HEIGHT);
  areaGrad.addColorStop(0, lineColor + '40');
  areaGrad.addColorStop(1, lineColor + '00');

  g.beginPath();
  g.moveTo(0, HEIGHT);
  for (let x = 0; x < levels.length; x++) {
    const y = HEIGHT - (levels[x] / 100) * HEIGHT;
    g.lineTo(x, y);
  }
  g.lineTo(WIDTH, HEIGHT);
  g.closePath();
  g.fillStyle = areaGrad;
  g.fill();

  // Waveform line
  g.beginPath();
  for (let x = 0; x < levels.length; x++) {
    const y = HEIGHT - (levels[x] / 100) * HEIGHT;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = lineColor;
  g.lineWidth = 2;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.stroke();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) draw();
});

toggleBtn.addEventListener('click', () => {
  micDeniedEl.classList.add('hidden');
  running ? stop() : start();
});
openMicSettingsBtn.addEventListener('click', () => window.loudTalker.openMicSettings());
quitBtn.addEventListener('click', () => window.loudTalker.quit());

setLoud('off');
updateLevelMeter();
draw();

if (listenOnStart) start();

navigator.mediaDevices.addEventListener('devicechange', () => {
  if (running) {
    stop();
    start();
  }
});
