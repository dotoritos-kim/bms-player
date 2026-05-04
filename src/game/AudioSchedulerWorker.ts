/**
 * AudioSchedulerWorker - Editor/Preview용 경량 오디오 스케줄러 Worker
 *
 * 판정 로직 없이 순수 오디오 스케줄링만 담당.
 * setInterval(5ms)로 tick, performance.now() 기반 타이밍.
 */

// ==================== Message Types ====================

export type SchedulerMainToWorker =
  | { type: 'init'; payload: SchedulerInitPayload }
  | { type: 'play'; payload: { startSec: number; speed: number } }
  | { type: 'pause' }
  | { type: 'resume'; payload: { resumeSec: number; speed: number } }
  | { type: 'stop' }
  | { type: 'seek'; payload: { seekSec: number; speed: number } }
  | { type: 'setSpeed'; payload: { speed: number } }
  | { type: 'dispose' };

export interface SchedulerInitPayload {
  notes: SchedulerNote[];
}

export interface SchedulerNote {
  sec: number;       // time in seconds
  keysound: string;
  offset: number;    // keysound start offset
  volume: number;
}

export type SchedulerWorkerToMain =
  | { type: 'playSound'; payload: { keysound: string; offset: number; delaySec: number; volume: number } }
  | { type: 'tick'; payload: { currentSec: number } }
  | { type: 'ended' }
  | { type: 'ready' };

// ==================== Worker State ====================

let notes: SchedulerNote[] = [];
let currentIndex: number = 0;
let isPlaying: boolean = false;
let startTimestamp: number = 0;  // performance.now()
let startSec: number = 0;       // game time offset in seconds
let speed: number = 1;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let lastUiTick: number = 0;
const LOOKAHEAD = 0.100; // 100ms lookahead
const UI_UPDATE_INTERVAL = 50; // ms between UI tick updates

function post(msg: SchedulerWorkerToMain): void {
  (self as unknown as { postMessage: (msg: SchedulerWorkerToMain) => void }).postMessage(msg);
}

function getCurrentSec(): number {
  if (!isPlaying) return startSec;
  const elapsed = (performance.now() - startTimestamp) / 1000;
  return startSec + elapsed * speed;
}

function scheduleTick(): void {
  if (!isPlaying) return;

  const currentSec = getCurrentSec();
  const lookaheadSec = currentSec + LOOKAHEAD;

  // Schedule notes within lookahead window
  while (currentIndex < notes.length) {
    const note = notes[currentIndex];
    if (note.sec > lookaheadSec) break;

    const delaySec = (note.sec - currentSec) / speed;
    post({
      type: 'playSound',
      payload: {
        keysound: note.keysound,
        offset: note.offset,
        delaySec: Math.max(0, delaySec),
        volume: note.volume,
      },
    });
    currentIndex++;
  }

  // UI update (throttled)
  const now = performance.now();
  if (now - lastUiTick >= UI_UPDATE_INTERVAL) {
    lastUiTick = now;
    post({ type: 'tick', payload: { currentSec } });
  }

  // Check if all notes played and we're past the last note
  if (currentIndex >= notes.length) {
    const lastNote = notes[notes.length - 1];
    if (lastNote && currentSec > lastNote.sec + 2) {
      post({ type: 'ended' });
      stopTick();
      isPlaying = false;
    }
  }
}

function startTick(): void {
  stopTick();
  lastUiTick = 0;
  tickInterval = setInterval(scheduleTick, 5);
}

function stopTick(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function findNoteIndex(sec: number): number {
  // Binary search for first note at or after sec
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].sec < sec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ==================== Message Handler ====================

self.onmessage = (e: MessageEvent<SchedulerMainToWorker>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      notes = msg.payload.notes.slice().sort((a, b) => a.sec - b.sec);
      currentIndex = 0;
      isPlaying = false;
      post({ type: 'ready' });
      break;

    case 'play':
      startSec = msg.payload.startSec;
      speed = msg.payload.speed;
      currentIndex = findNoteIndex(startSec);
      startTimestamp = performance.now();
      isPlaying = true;
      startTick();
      break;

    case 'pause':
      startSec = getCurrentSec();
      isPlaying = false;
      stopTick();
      break;

    case 'resume':
      startSec = msg.payload.resumeSec;
      speed = msg.payload.speed;
      currentIndex = findNoteIndex(startSec);
      startTimestamp = performance.now();
      isPlaying = true;
      startTick();
      break;

    case 'stop':
      isPlaying = false;
      stopTick();
      startSec = 0;
      currentIndex = 0;
      break;

    case 'seek':
      startSec = msg.payload.seekSec;
      speed = msg.payload.speed;
      currentIndex = findNoteIndex(startSec);
      if (isPlaying) {
        startTimestamp = performance.now();
      }
      break;

    case 'setSpeed':
      if (isPlaying) {
        startSec = getCurrentSec();
        startTimestamp = performance.now();
      }
      speed = msg.payload.speed;
      break;

    case 'dispose':
      stopTick();
      isPlaying = false;
      notes = [];
      currentIndex = 0;
      break;
  }
};
