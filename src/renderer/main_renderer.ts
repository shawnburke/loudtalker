const toggleBtn = document.getElementById('toggle') as HTMLButtonElement;
const quitBtn = document.getElementById('quit') as HTMLButtonElement;
const listenOnStartEl = document.getElementById('listen-on-start') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const canvas = document.getElementById('graph') as HTMLCanvasElement;
const thresholdInput = document.getElementById('threshold') as HTMLInputElement;
const thresholdValueEl = document.getElementById('threshold-value') as HTMLSpanElement;
const levelEl = document.getElementById('level') as HTMLSpanElement;
const g = canvas.getContext('2d')!;

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

// --- Tunables ---
const SAMPLE_MS = 33; // ~30 Hz; timer-based so it runs while popover is hidden
const HOLD_MS = 400; // keep flashing this long after dropping below threshold
const GATE_DB = -55; // quieter than this counts as silence (never trips)
const DB_MIN = -60; // bottom of the displayed scale
const DB_MAX = 0; // top of the displayed scale
const ATTACK = 0.5; // smoothing when getting louder (fast)
const RELEASE = 0.15; // smoothing when getting quieter (slow)

// --- Threshold (persisted) ---
const saved = localStorage.getItem('threshold');
if (saved !== null) thresholdInput.value = saved;
let threshold = Number(thresholdInput.value);
thresholdValueEl.textContent = String(threshold);

thresholdInput.addEventListener('input', () => {
  threshold = Number(thresholdInput.value);
  thresholdValueEl.textContent = String(threshold);
  localStorage.setItem('threshold', thresholdInput.value);
  draw();
});

// --- "Listen on start" preference (persisted, default on) ---
const listenPref = localStorage.getItem('listenOnStart');
const listenOnStart = listenPref === null ? true : listenPref === 'true';
listenOnStartEl.checked = listenOnStart;
listenOnStartEl.addEventListener('change', () => {
  localStorage.setItem('listenOnStart', String(listenOnStartEl.checked));
});

// --- Audio state ---
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let timeData: Float32Array<ArrayBuffer> | null = null;
let timerId: number | null = null;
let running = false;

let displayLevel = 0; // smoothed 0..100
let loud = false;
let lastAboveTime = 0;

const levels: number[] = new Array(WIDTH).fill(0);

function dbToLevel(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * 100;
}

function setLoud(next: boolean): void {
  if (next === loud) return;
  loud = next;
  window.loudTalker.sendLoudState(loud);
  statusEl.textContent = loud ? 'TOO LOUD' : 'Listening';
  statusEl.classList.toggle('loud', loud);
}

async function start(): Promise<void> {
  try {
    await window.loudTalker.requestMic();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch {
    statusEl.textContent = 'Mic permission denied';
    return;
  }

  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  source.connect(analyser);
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
  setLoud(false);
  statusEl.textContent = 'Idle';
  statusEl.classList.remove('loud');
  displayLevel = 0;
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

  const coeff = target > displayLevel ? ATTACK : RELEASE;
  displayLevel += (target - displayLevel) * coeff;

  const now = performance.now();
  const above = displayLevel >= threshold && db >= GATE_DB;
  if (above) lastAboveTime = now;
  setLoud(above || (loud && now - lastAboveTime < HOLD_MS));

  levelEl.textContent = 'Level: ' + Math.round(displayLevel);

  levels.push(displayLevel);
  levels.shift();
  // Skip drawing while the popover is hidden — measuring still continues.
  if (!document.hidden) draw();
}

function draw(): void {
  g.clearRect(0, 0, WIDTH, HEIGHT);
  g.fillStyle = '#010409';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  // volume trace
  g.beginPath();
  for (let x = 0; x < levels.length; x++) {
    const y = HEIGHT - (levels[x] / 100) * HEIGHT;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.strokeStyle = loud ? '#ff4d4d' : '#4da6ff';
  g.lineWidth = 2;
  g.stroke();

  // threshold line
  const ty = HEIGHT - (threshold / 100) * HEIGHT;
  g.beginPath();
  g.moveTo(0, ty);
  g.lineTo(WIDTH, ty);
  g.strokeStyle = '#ffae00';
  g.lineWidth = 1.5;
  g.setLineDash([6, 4]);
  g.stroke();
  g.setLineDash([]);
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
