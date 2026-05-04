# bms-player 리팩토링 계획

> 분석 전용 문서. 코드 변경은 포함하지 않습니다. 작성일: 2026-05-05.

## 1. Executive Summary

bms-player는 BMS 리듬게임 플레이어 엔진(38 파일 / 12,499 LOC)으로, **Web Worker 2종(AudioLoader, GameLoop, AudioScheduler)** + **AudioWorklet 1종**을 사용한 멀티 스레드 아키텍처가 핵심이다. **GameLoop(861) / GamePlayer.tsx(849) / AudioPreloader(1143) / GameCanvas(1436) / KeysoundPlayer(559)** 5개 거대 파일이 책임이 혼재되어 변경 위험이 높고, **Worker postMessage 경계 4곳에서 unknown/이중 cast**가 누수된다(`(self as unknown as { postMessage })` 패턴 3회). 디자인 패턴 측면에서 **State Machine(게임 상태)/Strategy(키사운드 로더)/Observer(Worker 메시지 디스패처)/Object Pool(노트 객체) + Discriminated Union 메시지 타입**을 도입해야 한다. **외부 호환성 영향**: KeysoundPlayer interface, useGamePlayer/GamePlayer 컴포넌트, GameLoop public API는 bms-editor·bms-electron-app에 직접 노출되므로 시그니처 보존이 필수다.

## 2. 현재 구조 매핑

```
src/ (38 파일 / 12,499 LOC)
├── audio/ (오디오 로딩/디코딩/재생, 워커-워클렛 파이프라인)
│   ├── KeysoundPlayer.ts              559   AudioPreloader 래퍼 + 진단 + EFX 패스스루
│   ├── cache/AudioIndexedDBCache.ts   ~410  IndexedDB 영구 캐시 (LRU + 메타데이터)
│   ├── store/keysoundPlayerStore.ts   ~150  zustand store (인스턴스 캐시 + hashKeysounds)
│   ├── judgements/
│   │   ├── index.ts (Notechart)        ~430 BMS Note → 게임 노트 변환 + 판정 윈도우
│   │   └── types.ts                    ~80  GameNote/GameLandmine/SoundedEvent
│   └── loader/
│       ├── AudioLoader.worker.ts      188  파일 fetch Worker (배치/재시도/Transferable)
│       ├── AudioPreloader.ts         1143  Worker 통신 + decodeAudioData + EQ/Compressor/Reverb/Stereo + 캐시 + 재생
│       ├── AudioProcessor.worklet.ts  228  AudioWorklet 코드 (문자열 + Blob URL)
│       ├── AudioPlayer.ts             161  레거시 단순 재생기
│       ├── resolveKeysoundFiles.ts     98  stem 기반 확장자 폴백
│       └── types.ts                   127  Worker/Worklet 메시지 타입
│
├── game/ (게임 루프/판정/입력/렌더링/UI)
│   ├── GameLoop.ts                    861  Main Thread rAF 루프 + 노트/오토/미스/홀드/판정/지뢰
│   ├── GameEngine.ts                  685  순수 게임 로직 (사이드이펙트 없는 tick → TickResult 커맨드)
│   ├── WorkerGameLoop.ts              350  Main 측 Worker 래퍼 (GameLoop과 동일 API + nextNotes 캐시)
│   ├── GameLoopWorker.ts              274  Worker 내부: GameEngine + setInterval 5ms tick
│   ├── workerProtocol.ts              117  Discriminated Union (Main↔Worker) — 잘 타입화됨
│   ├── AudioSchedulerWorker.ts        195  경량 오디오 스케줄러 Worker (preview/editor)
│   ├── WorkerAudioScheduler.ts        194  Main 측 스케줄러 래퍼
│   ├── GameCanvas.tsx                1436  three.js + react-three/fiber 렌더 (lane/note/judgment FX)
│   ├── GamePlayer.tsx                 849  통합 컴포넌트(로딩/시작/일시정지/결과 화면 모두 포함)
│   ├── useGamePlayer.ts               388  React 훅(GameLoop or WorkerGameLoop 선택)
│   ├── GameOptions.tsx                459  옵션 패널 UI
│   ├── KeyBindingSettings.tsx         445  키바인딩 UI + 영속화
│   ├── JudgmentEngine.ts              220  판정 윈도우 계산
│   ├── GaugeSystem.ts                 300  게이지(Groove/Hard/Easy/...)
│   ├── ScoreManager.ts                278  EX 스코어/콤보/판정 카운트
│   ├── InputHandler.ts                222  키 이벤트 → KeyColumn 매핑
│   ├── LatencyCalibration.ts          260  오디오/판정/비주얼 지연 측정
│   └── index.ts                       103  배럴
│
├── preview/ (BMS 미리듣기)
│   ├── useBmsPreview.ts               685  preview.* 우선 → BGM 채널 실시간 재생 폴백
│   └── BmsPreviewPlayer.tsx           276  미리듣기 UI 컴포넌트
│
├── types/KeysoundPlayer.ts             21  외부 컨슈머용 인터페이스 contract
├── utils/cn.ts                          5
└── index.ts                           146  최상위 배럴(audio/game/preview)
```

### 레이어 분리

| 레이어 | 역할 | 파일 |
|---|---|---|
| L1 데이터 | BMS 파싱 결과 → 게임 데이터 | `audio/judgements/` (Notechart, GameNote) |
| L2 오디오 인프라 | 파일 로드 → ArrayBuffer → AudioBuffer → 재생 | `audio/loader/*`, `audio/cache/*` |
| L3 오디오 도메인 | 키사운드 재생 추상화 + 진단 | `audio/KeysoundPlayer.ts`, `audio/store/*` |
| L4 게임 도메인 | 순수 로직 (시간→이벤트) | `GameEngine.ts`, `Judgment/Gauge/Score/Input` |
| L5 게임 실행 | 환경별 루프 (rAF or Worker tick) | `GameLoop.ts`, `WorkerGameLoop.ts` + `GameLoopWorker.ts` |
| L6 게임 시각화 | 렌더 + UI | `GameCanvas.tsx`, `GamePlayer.tsx`, `useGamePlayer.ts` |
| L7 프리뷰 | 짧은 재생 시나리오 | `preview/*` |

## 3. 공개 API 표면 (`src/index.ts`)

3개 서브 진입점 (`./game`, `./audio`, 루트). 외부 노출:

- **클래스**: `KeysoundPlayer`, `AudioPreloader`, `Notechart`, `GameLoop`, `WorkerGameLoop`, `GameEngine`, `WorkerAudioScheduler`, `JudgmentEngine`, `GaugeSystem`, `ScoreManager`, `InputHandler`, `LatencyCalibration`
- **컴포넌트**: `GameCanvas`, `GamePlayer`, `GameOptions`, `KeyBindingSettings`, `BmsPreviewPlayer`
- **훅**: `useGamePlayer`, `useBmsPreview`, `useKeysoundPlayerStore`
- **타입(50+)**: `GameLoopState`, `WorkerGameLoopConfig`, `KeysoundPlayer`(interface), `Notechart` 입력/출력, `AudioProcessorPostMessage`, `WorkerLoadedPayload` 등
- **헬퍼**: `createKeysoundPlayer`, `resolveKeysoundFiles`, `loadKeyBindings`/`saveKeyBindings`, `bindingsToKeyMap`, `LANE_CONFIG_*`, `audioIndexedDBCache`, `hashKeysounds`

>  bms-editor / bms-electron-app은 위 표면 다수에 직접 의존하므로 **이름·시그니처 보존**이 강제 조건.

## 4. Worker 메시지 boundary 현황

bms-player 내부에 **3개의 Worker + 1개의 AudioWorklet**이 있고, 각각 다른 수준으로 타입화돼 있다.

| Worker | Main → Worker | Worker → Main | 타입화 상태 |
|---|---|---|---|
| **AudioLoader.worker.ts** | `LOAD_AUDIO` (1종) | `PROGRESS / LOADED / DONE / ERROR` | 부분(`types.ts`에 페이로드 정의) — onMessage 핸들러는 `event.data` 즉시 destructure로 inline 사용. 명시적 union 타입 미적용 |
| **GameLoopWorker.ts** | `init/start/pause/resume/stop/keyDown/keyUp/dispose` (8종) | `playSound/stopAll/update/judgment/landmine/keyInput/nextNotes/complete/failed/ready/error` (11종) | **양호** (`workerProtocol.ts`에 완전한 Discriminated Union) |
| **AudioSchedulerWorker.ts** | `init/play/pause/resume/stop/seek/setSpeed/dispose` | `playSound/tick/ended/ready` | **양호** (모듈 자체에 union) |
| **AudioProcessor.worklet** | `play/stop/stopAll/clear/clearAll/setVolume/adjustVolume/setPlaybackRate` | `latencyReport` | 부분 — `AudioProcessorPostMessage`는 union이지만 `data` 필드가 `null \| number \| StereoPlayData \| MonoPlayData` 한 묶음(메시지 타입별로 갈리지 않음) |

**postMessage cast 안티패턴 (3회)**:
- `GameLoopWorker.ts:104` `(self as unknown as { postMessage: ... }).postMessage(msg)`
- `GameLoopWorker.ts:184` `proxy as unknown as Notechart`
- `AudioSchedulerWorker.ts:51` 동일 패턴

원인: Worker `self`가 `WorkerGlobalScope` 타입이어서 `postMessage`가 너무 광범위(`any` payload 허용). 협소화된 헬퍼가 없어 수동 cast.

## 5. 식별된 이슈

### HIGH (구조적)

| # | 위치 | 이슈 |
|---|---|---|
| H1 | `AudioPreloader.ts` 1143 LOC | **God Class**. 파일 로딩(Worker 통신) + decodeAudioData 매니지 + 4종 EFX(EQ/Compressor/Reverb/Stereo) + LRU 캐시 + IndexedDB 캐시 + AudioWorklet 라이프사이클 + Track ID 카운터 + 재생 메서드(playAudio/playAudioSync) — 책임 7개 이상. 변경 시 영향 광범위 |
| H2 | `GameLoop.ts` 861 LOC | 단일 클래스에 타이밍/입력/판정/오토플레이/지뢰/롱노트/스코어/콜백 모두 통합. `GameEngine`이 이미 추출돼 있는데 `GameLoop`은 **GameEngine을 사용하지 않고** 직접 재구현 — 중복 |
| H3 | Worker postMessage 타입 누수 | `(self as unknown as ...)` 3회. Worker 내부에서 outgoing 메시지의 타입 안전성이 cast로 우회됨. 새 메시지 추가 시 컴파일러가 잡지 못함 |
| H4 | `KeysoundPlayer.ts` 이중 preloader 필드 | `readonly preloader: AudioPreloader \| null = null` + `_preloader` 두 개 보존. `(this as { preloader: ... }).preloader = ...`로 readonly 회피. `useGamePlayer.ts:256`에서 `(keysoundPlayer as unknown as { preloader?: { context?: AudioContext } })` cast로 읽음 — 캡슐화 깨짐 |
| H5 | `GamePlayer.tsx` 849 LOC | 단일 파일에 LoadingScreen/ReadyScreen/PauseScreen/ResultScreen + GamePlayer 본체 + Hi-Speed/Sudden+/Lift+ 상태 + 풀스크린 로직 + 키 핸들러. 5개 컴포넌트로 분리 가능 |
| H6 | `useBmsPreview.ts` 685 LOC | preview-file 모드와 bgm-channel 모드가 한 훅에 혼재. rAF 스케줄러(`runBgmScheduler`)와 Worker 스케줄러 분기가 복잡 |
| H7 | 게임 상태 boolean 4개 (isPlaying/isPaused/isFailed/isCompleted) | `GameLoop`/`WorkerGameLoop`/`useGamePlayer`/`GamePlayer` 모두 동일한 4-bool로 상태 관리. **불가능한 상태**(isPlaying && isCompleted) 컴파일러로 차단 불가 — State Machine 필요 |

### MID (코드 품질)

| # | 위치 | 이슈 |
|---|---|---|
| M1 | `AudioPreloader.ts` 글로벌 `globalAudioBufferCache`(모듈 전역 Map) | 인스턴스 간 공유되지만 정리 책임 불명확. 테스트 격리 어려움 |
| M2 | `GameLoop.ts:155` `pendingNotes`/`activeHolds`/`pendingLandmines` `splice/shift` 빈번 | O(n) 제거. 노트 수가 많은 차트에서 GC 압력 |
| M3 | `GameLoop.tick()` rAF + `GameLoopWorker.ts` setInterval(5ms) | 두 환경 timing 모델이 다름 — Worker는 백그라운드 탭에서도 동작하지만 시간 동기화는 Main의 `getCurrentTime`(AudioContext) vs Worker의 `performance.now`로 분기 |
| M4 | EFX 비활성화가 노드 그래프 변경 없이 gain만 조작 | 비활성화돼도 노드는 chain에 잔존(불필요한 CPU). bypass 라우팅 미구현 |
| M5 | `KeysoundPlayer.dispose()` vs `AudioPreloader.releaseAllResources()` 책임 중복 | dispose 흐름 추적 어려움 |
| M6 | `LOOKAHEAD = 50ms` (GameLoop) vs `100ms` (AudioScheduler) 하드코딩 차이 | 의도된 차이지만 상수 위치/문서 미일치 |
| M7 | `setTimeout(..., 50)`(GameLoop.processAutoplayNotes) | 키 릴리즈 시뮬레이션을 setTimeout에 의존 — pause/dispose 시 콜백이 살아 있을 수 있음 |
| M8 | `AudioProcessor.worklet.ts`의 워클렛 코드가 **문자열 리터럴** | TS 검사·하이라이트·테스트 모두 어려움. inline 이유는 worklet 환경의 import 제한 |

### LOW (표면 정리)

- `audio/loader/AudioPlayer.ts` 사용처 추적 필요(레거시 가능성)
- `KeysoundPlayer._loggedMissingKeys` 등 디버깅용 private 필드의 일관성
- `EQ_PRESETS`가 `Record<string, number[]>` — preset 이름 enum화 가능
- `GameOptions.tsx`/`KeyBindingSettings.tsx` localStorage 직접 접근 — 추상화 레이어 가능

## 6. 디자인 패턴 적용 계획

### 6.1 Discriminated Union + Type Guard for Worker Messages (P0)

**전 (`AudioLoader.worker.ts:147`):**
```ts
self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;
  if (type === 'LOAD_AUDIO') {
    const { baseUrl, fileMap } = payload as { baseUrl: string; fileMap: FileMap };
    ...
  }
};
```

**후:**
```ts
// audio/loader/messages.ts
export type LoaderInbound = { type: 'LOAD_AUDIO'; payload: { baseUrl: string; fileMap: FileMap } };
export type LoaderOutbound =
  | { type: 'PROGRESS'; payload: WorkerProgressPayload }
  | { type: 'LOADED'; payload: WorkerLoadedPayload }
  | { type: 'DONE'; payload: WorkerDonePayload }
  | { type: 'ERROR'; payload: WorkerErrorPayload };

export function postFromWorker(msg: LoaderOutbound, transfer?: Transferable[]): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

self.onmessage = (e: MessageEvent<LoaderInbound>) => {
  switch (e.data.type) {
    case 'LOAD_AUDIO': await handleLoad(e.data.payload); break;
  }
};
```

**효과**: cast 0회, 새 메시지 추가 시 switch exhaustiveness로 컴파일 에러. `GameLoopWorker.ts:104`/`AudioSchedulerWorker.ts:51`에도 동일 패턴 적용.

### 6.2 State Machine for Game Lifecycle (P0)

**전:** 4개 boolean (`isPlaying/isPaused/isFailed/isCompleted`) — 16가지 조합 중 5가지만 유효.

**후:**
```ts
type GamePhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'playing'; startedAt: number }
  | { kind: 'paused'; pausedAt: number }
  | { kind: 'completed'; finalScore: ScoreState }
  | { kind: 'failed'; finalScore: ScoreState };

type Transition =
  | { from: 'idle'; to: 'loading' }
  | { from: 'loading'; to: 'ready' }
  | { from: 'ready' | 'paused'; to: 'playing' }
  | { from: 'playing'; to: 'paused' | 'completed' | 'failed' }
  ...;
```

**적용처**: `GameLoop`/`WorkerGameLoop`/`useGamePlayer`/`GamePlayer.tsx` 일관 적용.

### 6.3 Strategy for Loop Implementation (P1)

**전:** `useGamePlayer.ts:281` `if (opts.worker) return new WorkerGameLoop(...) else return new GameLoop(...)`

**후:** 공통 인터페이스 도입.
```ts
export interface IGameLoop {
  start(): Promise<void>; pause(): void; resume(): void; stop(): void;
  dispose(): void; getCurrentTime(): number; getState(): GameLoopState | null;
  on(event: 'judgment'|'update'|'complete'|'failed', cb: ...): void;
}
class MainThreadGameLoop implements IGameLoop { /* 기존 GameLoop */ }
class WorkerGameLoopAdapter implements IGameLoop { /* 기존 WorkerGameLoop */ }
function createGameLoop(env: 'main'|'worker', cfg): IGameLoop;
```

**효과**: `GameLoop`이 직접 게임 로직을 재구현하는 H2 중복 제거(GameEngine 위임으로 단일화), Strategy 교체 단순화.

### 6.4 Observer/EventEmitter for Worker Messages (P1)

**전:** `WorkerGameLoop.handleWorkerMessage`에 11개 case switch가 직접 콜백 호출.

**후:**
```ts
class WorkerBus<TIn, TOut> {
  private handlers = new Map<TOut['type'], Set<(p: any) => void>>();
  on<K extends TOut['type']>(type: K, h: (p: Extract<TOut, {type:K}>['payload']) => void): () => void;
  send(msg: TIn): void;
  dispose(): void;
}
```

**효과**: GameLoopWorker / AudioScheduler / AudioLoader 3 worker가 동일 추상화 사용.

### 6.5 Object Pool for Notes (P2)

`pendingNotes.shift()` / `splice()` 빈번 → 인덱스 기반 cursor + frozen array로 GC 압력 감소.

```ts
class NoteCursor {
  private idx = 0;
  constructor(private readonly notes: readonly GameNote[]) {}
  peek(): GameNote | undefined { return this.notes[this.idx]; }
  consume(): void { this.idx++; }
  hasNext(): boolean { return this.idx < this.notes.length; }
  resetTo(predicate: (n: GameNote) => boolean): void { /* binary search */ }
}
```

`activeHolds`는 `Map`이지만 컬럼 수가 작으므로(7~14개) 그대로.

### 6.6 Builder for AudioPreloader (P2)

`new AudioPreloader(baseUrl, fileMap, worker, onMessage?, options?)` 5-arity → Builder.

```ts
const preloader = AudioPreloaderBuilder
  .from({ baseUrl, fileMap })
  .withWorker(worker)
  .withCache({ memory: true, indexedDB: true })
  .withEffects({ simplified: false })
  .onMessage(handler)
  .build();
```

EFX 노드 생성/연결도 Builder 내부에 캡슐화.

### 6.7 Composite for AudioPreloader 책임 분해 (P0)

H1 해결: AudioPreloader를 4개 클래스로 분해.
- `AudioBufferStore` (Map<key, AudioBuffer> + LRU + IndexedDB 통합)
- `AudioFetchPipeline` (Worker 통신 + decodeAudioData 디스패치)
- `EffectChain` (EQ/Compressor/Reverb/Stereo + bypass 라우팅)
- `WorkletPlayback` (AudioWorkletNode + scheduledTime + Transferable)

`AudioPreloader` 자체는 위 4개를 조립하는 Facade로 슬림화(~200 LOC 목표).

## 7. 타입 안전성 정리 계획 (any/unknown)

> 18건 / 9파일. **Worker 메시지 경계가 가장 큰 비중**이므로 6.1 패턴을 1순위로 적용.

| # | 파일:라인 | 코드 | 원인 분류 | 해결 전략 | 우선 |
|---|---|---|---|---|---|
| 1 | `AudioLoader.worker.ts:71` | `catch (error: unknown)` | catch (정당) | 유지 — `instanceof Error` 사용 중 | P3 (유지) |
| 2 | `AudioLoader.worker.ts:126` | `catch (error: unknown)` | catch (정당) | 유지 | P3 |
| 3 | `AudioPreloader.ts:184` | `onWorkerMessage?: (type: string, payload: unknown)` | Worker payload 미타입 | 6.1 union → `(msg: LoaderOutbound) => void`로 변경. type별 페이로드 자동 narrowing | **P0** |
| 4 | `AudioPreloader.ts:273/337/434` | `catch (err: unknown)` | catch (정당) | 유지 | P3 |
| 5 | `KeysoundPlayer.ts:180` | `(type: string, payload: unknown) => { ... payload as { key?: string } ... }` | Worker payload 수신 측 cast | 6.1 적용 후 `LoaderOutbound` 직접 사용 → `payload`가 자동으로 narrow됨 | **P0** |
| 6 | `KeysoundPlayer.ts:227/266/312` | `catch (error: unknown)` | catch (정당) | 유지 | P3 |
| 7 | `GameLoop.ts:256` | `catch (e: unknown)` | catch (정당) | 유지 | P3 |
| 8 | `GameLoopWorker.ts:104` | `(self as unknown as { postMessage: ... })` | Worker self 협소화 | `DedicatedWorkerGlobalScope` 사용 + 6.1 헬퍼(`postFromWorker<T>`) | **P0** |
| 9 | `GameLoopWorker.ts:184` | `proxy as unknown as Notechart` | NotechartProxy가 Notechart 일부만 구현 | (a) `Notechart`를 인터페이스로 추출하여 `INotechart` 정의 (b) Proxy가 인터페이스 구현 → cast 제거 | **P1** |
| 10 | `GameLoopWorker.ts:192` | `catch (err: unknown)` | catch (정당) | 유지 | P3 |
| 11 | `AudioSchedulerWorker.ts:51` | `(self as unknown as { postMessage: ... })` | Worker self 협소화 | 8과 동일 | **P0** |
| 12 | `GamePlayer.tsx:480` | `catch (err: unknown)` | catch (정당) | 유지 | P3 |
| 13 | `useGamePlayer.ts:256` | `(keysoundPlayer as unknown as { preloader?: { context?: AudioContext } })` | KeysoundPlayer 캡슐화 깨짐 | `KeysoundPlayer` 인터페이스에 `getAudioContext(): AudioContext \| null` 추가 → cast 제거 | **P0** |
| 14 | `useBmsPreview.ts:384` | `catch (error: unknown)` | catch (정당) | 유지 | P3 |

**총합**: 18건 중 **6건이 진짜 unknown 누수**(P0/P1) — 나머지 12건은 `catch(...: unknown)`으로 의도된 사용. 6건 모두 Worker boundary + KeysoundPlayer 캡슐화 문제이며, **6.1 + KeysoundPlayer interface 보강 두 변경으로 모두 해결 가능**.

## 8. 폴더/파일 재구성 제안

```
src/
├── core/                          (신규 — 도메인 순수 로직)
│   ├── notechart/                 (judgements 이동)
│   ├── judgment/JudgmentEngine
│   ├── gauge/GaugeSystem
│   ├── score/ScoreManager
│   ├── input/InputHandler
│   └── engine/GameEngine
│
├── audio/
│   ├── pipeline/                  (분해된 AudioPreloader)
│   │   ├── AudioBufferStore.ts
│   │   ├── AudioFetchPipeline.ts
│   │   ├── EffectChain.ts
│   │   └── WorkletPlayback.ts
│   ├── workers/
│   │   ├── AudioLoader.worker.ts
│   │   ├── AudioProcessor.worklet.ts
│   │   └── messages.ts            (Discriminated Union)
│   ├── cache/AudioIndexedDBCache.ts
│   ├── store/keysoundPlayerStore.ts
│   ├── KeysoundPlayer.ts          (Facade 슬림화)
│   └── resolveKeysoundFiles.ts
│
├── runtime/                       (신규 — 게임 실행 환경)
│   ├── IGameLoop.ts               (Strategy 인터페이스)
│   ├── MainThreadGameLoop.ts      (구 GameLoop, GameEngine 위임)
│   ├── WorkerGameLoopAdapter.ts   (구 WorkerGameLoop)
│   ├── workers/
│   │   ├── GameLoopWorker.ts
│   │   ├── AudioSchedulerWorker.ts
│   │   └── protocol.ts            (구 workerProtocol.ts + scheduler)
│   ├── WorkerAudioScheduler.ts
│   └── WorkerBus.ts               (Observer)
│
├── ui/                            (구 game/* 의 .tsx 이동)
│   ├── canvas/GameCanvas.tsx
│   ├── player/
│   │   ├── GamePlayer.tsx         (분해)
│   │   ├── screens/{Loading,Ready,Pause,Result}.tsx
│   │   └── HiSpeedHud.tsx
│   ├── options/GameOptions.tsx
│   ├── keybindings/KeyBindingSettings.tsx
│   └── preview/BmsPreviewPlayer.tsx
│
├── hooks/
│   ├── useGamePlayer.ts
│   └── useBmsPreview.ts
│
├── types/
│   ├── KeysoundPlayer.ts          (interface 보강 — getAudioContext 등)
│   └── GamePhase.ts               (State Machine)
│
├── utils/
└── index.ts                       (서브패키지 export 유지)
```

`./game`/`./audio` 서브 진입점은 **유지**(외부 호환성). 내부 구조만 재배치하고 배럴이 새 위치를 re-export.

## 9. 단계별 실행 계획 (작은 PR)

| 단계 | 내용 | 변경 범위 | 위험 |
|---|---|---|---|
| **S0** | 기준선: tsc + vitest 전체 통과 확인 | 0 | - |
| **S1** | `audio/loader/messages.ts` Discriminated Union 도입 + `AudioLoader.worker.ts` switch 적용 | 2 파일 | 낮음 |
| **S2** | `AudioPreloader.onWorkerMessage` 시그니처를 `LoaderOutbound`로 변경 | 2 파일 | 중 (KeysoundPlayer 콜백 동시 수정) |
| **S3** | Worker `self` cast 헬퍼(`postFromWorker`) 도입 — `GameLoopWorker` / `AudioSchedulerWorker` | 4 파일 | 낮음 |
| **S4** | `KeysoundPlayer` interface에 `getAudioContext()` 추가 → `useGamePlayer.ts:256` cast 제거 | 3 파일 | 중 (외부 호환: 추가 메서드만 — 기존 deprecated `preloader` getter 한 사이클 유지) |
| **S5** | `INotechart` 인터페이스 추출 + `NotechartProxy implements INotechart` → `as unknown as Notechart` 제거 | 3 파일 | 중 |
| **S6** | `GamePhase` State Machine 도입 (`runtime/state.ts`) — GameLoop/WorkerGameLoop/useGamePlayer 동시 적용 | 4 파일 | 중-상 |
| **S7** | `GameLoop`을 `GameEngine` 위임으로 재작성 — H2 중복 제거 | 1 파일 (대규모) | 상 |
| **S8** | `IGameLoop` 인터페이스 + Strategy factory(`createGameLoop(env)`) | 4 파일 | 중 |
| **S9** | `AudioPreloader` 분해 — `AudioBufferStore`/`AudioFetchPipeline`/`EffectChain`/`WorkletPlayback` 추출, AudioPreloader는 Facade | 5 파일 | **상** (외부에 노출된 메서드 시그니처 유지 필수) |
| **S10** | `GamePlayer.tsx` 화면 분리 — `screens/{Loading,Ready,Pause,Result}.tsx` | 5 파일 | 낮음 |
| **S11** | `useBmsPreview.ts` 모드별 분리 — `usePreviewFile` + `useBgmChannelPreview` + Facade `useBmsPreview` | 4 파일 | 중 |
| **S12** | 폴더 재구성(8장) — barrel만 변경, 내용 동일 | 다수 | 낮음 (한 PR 내 검증) |
| **S13** | `NoteCursor` 도입(M2 GC 최적화) | 2 파일 | 중 (회귀 테스트 필수) |
| **S14** | EFX 노드 bypass 라우팅(M4) | 1 파일 | 중 |

각 단계는 독립 PR. S6~S8은 종속성이 있어 순차. S9는 가장 위험 — 별도 feature flag(`useDecomposedPreloader`) 검토.

## 10. 외부 호환성 영향

### bms-editor / bms-electron-app에 직접 노출되는 것

| 표면 | 영향 단계 | 호환성 정책 |
|---|---|---|
| `KeysoundPlayer` 클래스 | S4, S9 | 메서드 시그니처 보존, **추가만** 허용. `preloader` 게터는 deprecated 마킹 후 1 마이너 유지 |
| `KeysoundPlayer` interface (`types/KeysoundPlayer.ts`) | S4 | `getAudioContext()` 추가는 breaking — interface implementer가 추가 구현 필요. **major bump 또는 default 메서드 제공** |
| `GameLoop` / `WorkerGameLoop` 생성자 | S6, S7, S8 | config 객체 형태 유지, public 메서드 유지. 내부 위임만 변경 |
| `GameLoopState`/`GameLoopCallbacks` | S6 | State Machine 도입 시 `phase: GamePhase` 추가, 기존 boolean은 derived getter로 유지(deprecated 마킹) |
| `useGamePlayer` 반환 형태 | S6 | 동일 — boolean 필드는 phase에서 파생 |
| `GamePlayer` props | S10 | 변경 없음 — 내부 분해만 |
| `AudioPreloader` 메서드 | S9 | 14개 public 메서드 시그니처 유지(테스트로 lock) |
| `useBmsPreview` controls/state | S11 | 변경 없음 |
| Worker 메시지 union(`AudioSchedulerMainToWorker` 등 export) | S1, S3 | 새 type 추가는 호환, 기존 type 제거는 breaking |

> bms-editor가 `WorkerAudioScheduler`/`AudioSchedulerWorker`/`AudioPreloader`를 미리듣기에서 사용하므로 S9/S11은 특히 신중.

## 11. 검증 계획

### 11.1 정적 검증
- `npm run type-check` (tsc --noEmit) — 모든 단계에서 0 에러
- ESLint(no-explicit-any) 룰 추가 — 18건 → 12건(catch만 허용)으로 감소 측정

### 11.2 단위 테스트 (기존 + 추가)
- 기존: `tests/{adversarial, audioWorker, gameloop, gauge, input, integration-core-player, judgment, resolveKeysoundFiles, score}.test.ts` 9개 모두 그린 유지
- **신규**:
  - `worker-protocol.contract.test.ts` — 모든 Worker 메시지 union의 round-trip(serialize/deserialize) + exhaustiveness 컴파일 테스트
  - `gamephase.test.ts` — State Machine 전이 검증(불가 전이는 throw 또는 no-op)
  - `audio-buffer-store.test.ts` / `effect-chain.test.ts` — S9 분해 후 단위 테스트
  - `note-cursor.test.ts` — S13 노트 cursor

### 11.3 통합/시뮬레이션
- `gameloop.simulation.test.ts` — `GameLoop`(Main) vs `GameEngine`(Worker용) 동일 입력에 동일 판정 결과(deterministic). `Notechart`+가상 입력 시퀀스로 verify
- `worker-equivalence.test.ts` — `MainThreadGameLoop`과 `WorkerGameLoopAdapter`이 동일한 콜백 시퀀스를 emit (단, Worker는 `mock Worker` 사용)

### 11.4 성능 회귀
- **rAF 안정성**: 1만 노트 차트에서 평균 frame budget 측정. S13 NoteCursor 적용 전후 비교 (목표: -10% GC 시간)
- **playAudio 레이턴시**: `getSchedulingOverhead()` 메트릭 활용. S9 후 평균 < 1ms 유지
- **decodeAudioData 점진적 디코딩**: 100개 키사운드 fixture로 첫 재생까지 시간 측정

### 11.5 수동 QA 체크리스트
- 백그라운드 탭 전환 시 Worker 모드 게임 진행 유지(setInterval 5ms)
- AudioContext suspended → resume 복구
- 일시정지 → 재개 시 타이밍 점프 없음(`firstTickDone` 플래그 유지)
- 풀스크린 토글 중 입력 분실 없음

## 12. 위험 요소

| 위험 | 영향 | 완화 |
|---|---|---|
| **R1**: `AudioPreloader` 분해(S9) 시 EFX 노드 라우팅 변경으로 무음/노이즈 발생 | 매우 높음 | 단계 시작 전 EFX 골든 스냅샷(decoded buffer 비교) 테스트 작성. feature flag로 점진 출시 |
| **R2**: State Machine(S6) 도입 시 race condition으로 `start() before ready` 등 새 버그 | 높음 | 모든 메서드 진입 시 phase 검증 + jest fake timers로 비동기 시퀀스 테스트 |
| **R3**: rAF→GameEngine 위임(S7)으로 타이밍 미세 변화 → 판정 결과 차이 | 높음 | 11.3 시뮬레이션 테스트가 deterministic 결과를 lock. 1만 입력 시퀀스 회귀 |
| **R4**: Worker `self` 타입 협소화 시 `globalThis` 충돌 | 중 | `DedicatedWorkerGlobalScope` 명시 + `lib: ["WebWorker"]` 일부 파일 옵션 |
| **R5**: `KeysoundPlayer` interface 변경 시 외부 구현체(electron-app 가능성) 깨짐 | 중 | grep으로 모든 implementer 사전 조사. 변경은 default-implementation 클래스로 우회 |
| **R6**: `Notechart` interface 추출(S5) 시 bms-core export 변경과 충돌 | 중 | bms-core 측 `INotechart`도 동시 도입 — 워크스페이스 전체 PR 묶음 |
| **R7**: setInterval 5ms는 브라우저 백그라운드 throttle 정책 영향 | 낮음 | 변경 사항 아님(기존 동작 유지) — 회귀 모니터링만 |
| **R8**: `globalAudioBufferCache`(M1) 인스턴스 간 공유 파괴 시 메모리 사용 증가 | 중 | S9에서 Store에 캡슐화하되, 기존 동작(공유) 옵션 보존 |

---

**부록: 측정 지표 (변경 전 baseline 권장)**
- 파일 수 38, 총 LOC 12,499
- any/unknown 18건 (catch 12 + 진짜 누수 6)
- 거대 파일 5개(>500 LOC): GameCanvas 1436 / AudioPreloader 1143 / GameLoop 861 / GamePlayer 849 / GameEngine 685 / useBmsPreview 685
- public exports: 50+ types, 30+ values
- Worker boundary: 3 Worker + 1 AudioWorklet
