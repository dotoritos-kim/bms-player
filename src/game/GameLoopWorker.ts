/**
 * GameLoopWorker - Code running inside the Worker.
 *
 * Runs in a Web Worker and processes game logic via GameEngine.
 * Ticks via setInterval(5ms), timing based on performance.now().
 * Communicates with the Main Thread via postMessage.
 */

import { GameEngine, type TickResult, type GameEngineState } from './GameEngine';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  SerializedNotechart,
  SerializedGameState,
  WorkerInitPayload,
} from './workerProtocol';
import type { INotechart, GameNote, SoundedEvent } from '../audio/judgements';

// ==================== Lightweight Notechart Proxy ====================

/**
 * Lightweight Notechart proxy for use inside the Worker.
 * Operates on precomputed data instead of a real Notechart.
 *
 * Implements `INotechart`, so it can be injected directly into `GameEngine` (no cast needed).
 */
class NotechartProxy implements INotechart {
  readonly notes: GameNote[];
  readonly autos: SoundedEvent[];
  readonly landmines: GameNote[];
  readonly duration: number;
  private beatSecondsTable: Array<{ beat: number; seconds: number }>;

  constructor(data: SerializedNotechart) {
    this.notes = data.notes;
    this.autos = data.autos;
    this.landmines = data.landmines;
    this.duration = data.duration;
    this.beatSecondsTable = data.beatToSecondsTable;
  }

  /**
   * Converts seconds to beats (binary search).
   */
  secondsToBeat(seconds: number): number {
    const table = this.beatSecondsTable;
    if (table.length === 0) return 0;
    if (seconds <= table[0].seconds) return table[0].beat;
    if (seconds >= table[table.length - 1].seconds) return table[table.length - 1].beat;

    let lo = 0;
    let hi = table.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid].seconds <= seconds) lo = mid;
      else hi = mid;
    }

    // Linear interpolation
    const a = table[lo];
    const b = table[hi];
    const t = (seconds - a.seconds) / (b.seconds - a.seconds || 1);
    return a.beat + t * (b.beat - a.beat);
  }

  beatToSeconds(beat: number): number {
    const table = this.beatSecondsTable;
    if (table.length === 0) return 0;
    if (beat <= table[0].beat) return table[0].seconds;
    if (beat >= table[table.length - 1].beat) return table[table.length - 1].seconds;

    let lo = 0;
    let hi = table.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid].beat <= beat) lo = mid;
      else hi = mid;
    }

    const a = table[lo];
    const b = table[hi];
    const t = (beat - a.beat) / (b.beat - a.beat || 1);
    return a.seconds + t * (b.seconds - a.seconds);
  }
}

// ==================== Worker State ====================

let engine: GameEngine | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let startTimestamp: number = 0; // performance.now() when game started
let pauseGameTime: number = 0;  // game time when paused
let playbackRate: number = 1;
let startOffset: number = 0;

function getCurrentGameTime(): number {
  if (!engine || !engine.isPlaying) return 0;
  if (engine.isPaused) return pauseGameTime;
  const elapsed = performance.now() - startTimestamp;
  return (elapsed + startOffset) * playbackRate;
}

// ==================== Message Handler ====================

function post(msg: WorkerToMainMessage): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function serializeState(state: GameEngineState): SerializedGameState {
  return {
    ...state,
    activeHoldNoteIds: Array.from(state.activeHoldNoteIds),
  };
}

function processTickResult(result: TickResult): void {
  // Send sounds
  for (const sound of result.sounds) {
    post({ type: 'playSound', payload: sound });
  }

  // Send judgments
  for (const judgment of result.judgments) {
    post({ type: 'judgment', payload: judgment });
  }

  // Send landmines
  for (const landmine of result.landmines) {
    post({ type: 'landmine', payload: landmine });
  }

  // Send key inputs (autoplay visual feedback)
  for (const ki of result.keyInputs) {
    post({ type: 'keyInput', payload: ki });
  }

  // Send state update
  if (result.state) {
    post({ type: 'update', payload: serializeState(result.state) });
  }

  // Send nextNotes
  if (result.nextNotes.size > 0) {
    const obj: Record<string, { keysound: string; offset: number; volume: number }> = {};
    for (const [col, info] of result.nextNotes) {
      obj[col] = info;
    }
    post({ type: 'nextNotes', payload: obj });
  }

  // Completion/failure
  if (result.completed) {
    post({ type: 'complete', payload: result.completed });
    stopTick();
  }
  if (result.failed) {
    post({ type: 'failed', payload: result.failed });
    stopTick();
  }
}

function gameTick(): void {
  if (!engine) return;
  const currentTime = getCurrentGameTime();
  const result = engine.tick(currentTime);
  processTickResult(result);
}

function startTick(): void {
  stopTick();
  tickInterval = setInterval(gameTick, 5);
}

function stopTick(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function handleInit(payload: WorkerInitPayload): void {
  try {
    const proxy = new NotechartProxy(payload.notechart);

    engine = new GameEngine({
      notechart: proxy,
      ...payload.config,
    });

    playbackRate = payload.config.playbackRate ?? 1;
    startOffset = payload.config.startOffset ?? 0;

    post({ type: 'ready' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    post({ type: 'error', payload: { message } });
  }
}

function handleStart(): void {
  if (!engine) return;
  engine.start();
  startTimestamp = performance.now();
  pauseGameTime = 0;
  startTick();
}

function handlePause(): void {
  if (!engine) return;
  pauseGameTime = getCurrentGameTime();
  engine.pause(pauseGameTime);
  stopTick();
}

function handleResume(): void {
  if (!engine) return;
  engine.resume();
  // Recalculate startTimestamp so getCurrentGameTime() continues from pauseGameTime
  startTimestamp = performance.now() - (pauseGameTime / playbackRate - startOffset);
  startTick();
}

function handleStop(): void {
  if (!engine) return;
  engine.stop();
  stopTick();
  post({ type: 'stopAll' });
}

function handleKeyDown(column: string, _time: number): void {
  if (!engine) return;
  const currentTime = getCurrentGameTime();
  const result = engine.handleKeyDown(column, currentTime);
  processTickResult(result);
}

function handleKeyUp(column: string, _time: number): void {
  if (!engine) return;
  const currentTime = getCurrentGameTime();
  const result = engine.handleKeyUp(column, currentTime);
  processTickResult(result);
}

// ==================== Message Listener ====================

self.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      handleInit(msg.payload);
      break;
    case 'start':
      handleStart();
      break;
    case 'pause':
      handlePause();
      break;
    case 'resume':
      handleResume();
      break;
    case 'stop':
      handleStop();
      break;
    case 'keyDown':
      handleKeyDown(msg.payload.column, msg.payload.time);
      break;
    case 'keyUp':
      handleKeyUp(msg.payload.column, msg.payload.time);
      break;
    case 'dispose':
      handleStop();
      engine = null;
      break;
  }
};
