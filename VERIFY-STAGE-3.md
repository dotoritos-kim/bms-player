# bms-player Stage 3 독립 검증 보고서

> 작성일: 2026-05-05
> 검증자: 독립 검증 에이전트 (자기보고 미신뢰)
> 대상 PR: https://github.com/dotoritos-kim/bms-player/pull/3
> Base: `master` (`524d63d`) / Head: `refactor/stage-3-game-phase-state-machine` (`ad62194`)
> Stage 3 주장: 4-boolean(`isPlaying`/`isPaused`/`isFailed`/`isCompleted`) → `GamePhase` discriminated union으로 통합. 외부 4-boolean API는 `gamePhaseToFlags`/derived getter로 보존. 23 테스트 추가 (242→265).

---

## 1. 요약 (Verdict)

**APPROVE / 머지 적합 — LOW risk.** 모든 핵심 주장이 독립 재현으로 성립한다.

- bms-player: `tsc --noEmit` **0 errors**, `vitest` **265/265 PASS** (master 242 → +23 신규 PASS), `vite build` **정상** (esm/cjs/d.ts emit OK).
- 다운스트림: bms-editor `tsc --noEmit` **0 errors**, bms-electron-app `npm run type-check` **0 errors**.
- 외부 API 4-boolean 시맨틱이 master 베이스라인과 **완전 일치**한다(특히 `pause` 시 `isPlaying=true` 유지의 leaky 시맨틱까지 보존).
- 신규 23 테스트는 derive 매핑 5개·전이 7개·`GameEngine` 통합 8개 + 헬퍼 3개로 derive·transition·integration을 커버.
- "잘못된 transition은 막힌다" 주장은 **헬퍼(`canTransition`) 차원에서만 성립**하며 lifecycle 메서드 자체는 `canTransition`을 게이트로 호출하지 않는다(직접 phase 대입). 단, `pause/resume`은 `phase.kind` guard가 있어 실질적 invalid 호출은 차단된다. 의도적 설계로 판단.

---

## 2. PR diff vs Plan 정합성

| Plan §6.2 / S6 항목 | 실제 PR | 정합 |
|---|---|---|
| `GamePhase` discriminated union 정의 | `src/types/GamePhase.ts:17-22` 5-state union (`ready`/`playing`/`paused`/`completed`/`failed`) | **OK** |
| `PHASE_*` 상수 (frozen sentinel) | `:27-31` `Object.freeze` 5개 | **OK** |
| Transition 테이블 + `canTransition()` | `:46-57` `ALLOWED` Map + helper | **OK** |
| `gamePhaseToFlags()` derive 헬퍼 | `:72-90` 5-case switch | **OK** (master 시맨틱 일치, §3.3 참조) |
| `isActivePhase`/`isTerminalPhase` 헬퍼 | `:93-100` | **OK** |
| `GameLoop`/`WorkerGameLoop`/`GameEngine` 단일 `_phase` | 3개 클래스 모두 `private _phase: GamePhase = PHASE_READY` 단일 필드 | **OK** |
| 4-boolean derived getter 보존 | 3개 클래스 + `useGamePlayer` `GamePlayerState`에서 derive | **OK** |
| `SerializedGameState`/`GameLoopState`/`GameEngineState`/`GamePlayerState`에 `phase` 필드 + 기존 4-boolean 동시 노출 | 4 type 모두 `phase: GamePhase`(필수) + `isPlaying/isPaused/isFailed/isCompleted`(필수, `@deprecated`) | **OK** |
| 루트 배럴 export | `src/index.ts:148-159` `GamePhase`/`GamePhaseKind` 타입, `PHASE_*` 5개, `canTransition`/`gamePhaseToFlags`/`isActivePhase`/`isTerminalPhase` 추가 | **OK** |

**판단**: Plan §6.2/S6 정합 100%. PR description은 LOC delta `+505/-103 = net +402`, 실제 stat `505 +/103 -` 일치.

---

## 3. 빌드/테스트 결과 (직접 재현)

### 3.1 bms-player

| 명령 | 결과 |
|---|---|
| `gh pr view 3` (mergeable 확인) | `MERGEABLE` |
| `git checkout refactor/stage-3-game-phase-state-machine` | clean working tree, `ad62194` |
| (사전) `cd ../bms-core && npm run build` | dist/.d.ts 생성 (참조용) |
| `npx tsc --noEmit` | **0 errors** |
| `npx vitest run` | **265 passed / 0 failed** (10 test files, 364ms) |
| `npm run build` (vite + tsc declaration) | 33 modules, esm/cjs/d.ts 정상 emit |
| (베이스라인) `git checkout master` 후 `npx vitest run` | **242 passed** (9 test files) → delta `+23` 매칭 |

### 3.2 외부 의존자

`file:../bms-player` 워크스페이스 의존이므로 PR 브랜치 변경이 즉시 반영된다.

| 저장소 | 명령 | 결과 |
|---|---|---|
| bms-editor | `npx tsc --noEmit` | **0 errors** |
| bms-electron-app | `npm run type-check` (`tsc -p tsconfig.node.json && tsc -p tsconfig.web.json`) | **0 errors** |

신규 필수 필드 `phase`가 4 type에 추가되었으나, 두 다운스트림 모두 이 type을 *생성*하지 않고 *소비*만 하므로 영향 없음. `useGamePlayer`/`GameLoopState` 등 핵심 type 사용 여부는 §4에서 직접 확인.

---

## 4. 다운스트림 영향 평가 (Critical)

### 4.1 bms-editor (`c:/SourceCode/bms-editor`)

`@rhythm-archive/bms-player` 사용처에서 4-boolean / `GameLoopState`/`GamePlayerState`/`useGamePlayer` 참조 검색:

| 파일 | 매칭 식별자 | 분석 |
|---|---|---|
| `src/chart/editor/noteRenderers.tsx:96-99` | 로컬 변수 `isPlaying` | bms-player와 무관(scroll ref 기반 로컬 boolean). |
| `src/chart/NoteChartViewer.tsx` | (검색 hit) | 자체 정의 식별자, bms-player import 아님. |
| `src/chart/EditorPlayback.ts` | (검색 hit) | 자체 정의 식별자, bms-player import 아님. |

→ **`useGamePlayer`/`GameLoopState`/`GamePlayerState` 직접 소비 0건.** 따라서 `phase` 필드 추가는 *불가능한 영향*. tsc 0 errors가 이를 실증.

### 4.2 bms-electron-app (`c:/SourceCode/bms-electron-app`)

| 파일 | 매칭 식별자 | 분석 |
|---|---|---|
| `src/renderer/routes/Editor.tsx:22-23` | `import { AudioPreloader, WorkerAudioScheduler } from '@rhythm-archive/bms-player'` + `type { FileMap, SchedulerNote }` | Stage 3 변경 면(GameLoop/Engine/Player state)에 노출 없음. |
| 동 파일의 `isPlayingRef` (333~) | 로컬 `useRef<boolean>(false)` | bms-player와 무관. |
| `src/renderer/components/AudioSlicer.tsx` | (검색 hit) | 자체 식별자. |

→ **bms-player의 게임 phase 관련 type을 소비하는 코드 0건.** type-check 0 errors가 이를 실증.

### 4.3 호환성 깨짐 시나리오 평가

PR description에서 명시한 "type을 *생성*하는 외부 코드(예: 테스트 mock)는 깨질 수 있다" 리스크에 대해:

- bms-editor / bms-electron-app 둘 다 `GameLoopState`/`GameEngineState`/`SerializedGameState`/`GamePlayerState`를 직접 생성하지 않음(검색으로 확인).
- 만약 외부 컨슈머가 mock을 만들고 있다면 `phase: PHASE_READY` 한 줄 추가 필요. PHASE_READY는 frozen sentinel이며 export 되어 있어 마이그레이션 트리비얼.
- npm 의존 타 컨슈머가 있는 경우의 영향은 본 검증 범위 밖이지만, 변경은 SemVer minor로 노출 가능(필드 추가 + deprecated 표기, 제거 아님).

---

## 5. 외부 API 호환 (4-boolean ↔ phase derive 정확성)

### 5.1 master 베이스라인 시맨틱 (PR 전)

| 클래스 | `start()` | `pause()` | `stop()` | 결과 시맨틱 |
|---|---|---|---|---|
| `GameLoop` (master) | `_isPlaying=true; _isPaused=false; _isFailed=false; _isCompleted=false` | `_isPaused=true` (← `_isPlaying`은 그대로 true) | `_isPlaying=false; _isPaused=false` | **pause 중 `isPlaying=true && isPaused=true`** (leaky) |
| `GameEngine` (master) | (동일) | `_isPaused=true` (`_isPlaying` 그대로) | `_isPlaying=false; _isPaused=false` | (동일) |

### 5.2 PR derive 결과 (`gamePhaseToFlags` 및 클래스 getter)

| phase | `gamePhaseToFlags`/getter `isPlaying` | `isPaused` | `isFailed` | `isCompleted` |
|---|---|---|---|---|
| `ready` | false | false | false | false |
| `playing` | true | false | false | false |
| `paused` | **true** | true | false | false |
| `completed` | false | false | false | true |
| `failed` | false | false | true | false |

### 5.3 master ↔ PR 시맨틱 일치 매트릭스

| 시나리오 | master 결과 (4-boolean) | PR 결과 (derive) | 일치 |
|---|---|---|---|
| 초기 (구성 직후) | `0000` | `ready` → `0000` | OK |
| `start()` 후 | `1000` (Playing) | `playing` → `1000` | OK |
| `start(); pause()` | `1100` (Playing+Paused, master는 `_isPlaying`을 안 바꿈) | `paused` → `1100` | **OK (의도적 보존)** |
| `start(); pause(); resume()` | `1000` | `playing` → `1000` | OK |
| `start(); stop()` | `0000` | `ready` → `0000` | OK |
| `tick → complete()` | `0001` (master GameLoop: `_isPlaying=false; _isCompleted=true`) | `completed` → `0001` | OK |
| `tick → fail()` | `0010` | `failed` → `0010` | OK |

→ **모든 lifecycle 시점에서 master 4-boolean 결과 = PR derive 결과**. `paused`의 `isPlaying=true` 보존은 `gamePhaseToFlags` switch case 'paused'(`src/types/GamePhase.ts:83-84`)에서 명시적으로 처리되어 있고 테스트(`tests/gamePhase.test.ts:44-51, 153-160`)로 락되어 있다.

### 5.4 `useGamePlayer` 외부 인터페이스 보존

`GamePlayerState`(useGamePlayer.ts:60~95) 변경:
- `phase: GamePhase` **추가**(필수)
- 기존 `isPlaying`/`isPaused`/`isCompleted`/`isFailed` 필드 **유지**(필수, `@deprecated` 표기만 추가)
- 기존 `currentTime`/`combo`/`gaugeValue`/`exScore`/`lastJudgment`/`heldKeys`/`finalScore` 등 **모두 유지**

`useGamePlayer` 함수 시그니처(`useGamePlayer.ts:127-131`)·`UseGamePlayerResult` 구조(`canvasProps`/`actions`/`state`)·initial `gameState` 객체(`:139-162`, `phase: PHASE_READY`만 추가) 모두 비파괴 변경. 다운스트림 type-check 0 errors가 실증.

---

## 6. State Machine Transition 정확성

### 6.1 `ALLOWED` 표 검증 (`src/types/GamePhase.ts:46-52`)

| from\to | ready | playing | paused | completed | failed |
|---|---|---|---|---|---|
| **ready** | T | T | F | F | F |
| **playing** | T | T (self) | T | T | T |
| **paused** | T | T | T (self) | T | T |
| **completed** | T | F | F | T (self) | F |
| **failed** | T | F | F | F | T (self) |

해석: `completed/failed`에서 직접 `playing`으로 가는 것은 차단(restart 경유 강제), 그 외 모든 정상 전이 허용. 합리적.

### 6.2 lifecycle 메서드의 transition 강제 여부

**중요 관찰**: `start()`/`stop()`은 `canTransition`을 호출하지 않고 `_phase`를 **직접 대입**한다(`GameLoop.start():280`, `GameEngine.start():223`, `WorkerGameLoop.start():168`).

- 이는 master 동작과 호환을 의도한 설계: master `start()`도 어떤 상태에서든 4-boolean을 reset 했음. 따라서 `completed → playing` 직접 전이가 실제로 가능하나, `canTransition('completed','playing')`은 false 반환.
- **헬퍼(`canTransition`)는 외부 컨슈머의 명시적 가드용**이며 내부 lifecycle은 자체 guard(`if (this._phase.kind !== 'playing') return;`)로 invalid 호출만 차단한다.
- `pause()`는 `phase.kind !== 'playing'` 체크로 ready/paused/completed/failed에서 무조건 no-op (master는 ready에서 pause 호출 시 `_isPaused=true`로 broken state를 만들 수 있었음 — **PR이 더 견고**).
- `resume()`은 `phase.kind !== 'paused'` 체크로 invalid 호출 차단. 마찬가지로 PR이 더 견고.

**판단**: "잘못된 transition은 막힌다"는 주장은 lifecycle 메서드의 phase 가드 차원에서 성립한다. `canTransition` 자체는 라이브러리 노출 헬퍼지 강제 게이트는 아니다. 이 분리는 합리적이며 master 호환을 깨지 않기 위한 의도적 결정.

### 6.3 신규 테스트 23개의 커버리지

| 그룹 | 케이스 수 | 다룬 영역 |
|---|---|---|
| derived flags (legacy compatibility) | 7 | 5 phase × 4-boolean derive 매핑 + `isActivePhase`/`isTerminalPhase` |
| transition table | 7 | `ready→playing`, `playing↔paused`, `playing→completed/failed`, `*→ready`, `completed→playing`(차단), `failed→playing`(차단), `ready→paused`(차단) |
| GameEngine integration | 9 | 초기 phase, start/pause/resume/stop, invalid `pause()` no-op, invalid `resume()` no-op, tick → completed, `buildState` phase+derive 동시 노출 |

미커버 영역:
- `WorkerGameLoop`/`GameLoop` 인스턴스의 phase 시맨틱은 이 파일에서 직접 테스트하지 않음. 단 기존 242 테스트가 GameLoop 동작을 다수 커버하며 모두 PASS.
- gauge.fail()/`fail()` 경로의 phase=failed 전환은 통합 테스트 미커버(unit 차원에서 mock notechart로 강제하기 어려움).

리스크: **Low**. 미커버 영역은 모두 master 동작과 동형이며 4-boolean → phase 매핑은 derive 함수 단위 테스트로 락됨.

---

## 7. 머지 위험도 / 권고

### 7.1 위험도

| 항목 | 평가 |
|---|---|
| API 호환성 | **LOW**: 모든 기존 4-boolean 필드/getter 보존, 신규 `phase` 필드만 추가. 다운스트림 0 errors 실증. |
| 시맨틱 호환성 | **LOW**: `paused` 시 `isPlaying=true` leaky 시맨틱 의도적 보존 + 테스트 락. |
| 내부 invariant | **POSITIVE**: `pause()` before `start()`/`resume()` outside `paused` 같은 invalid 호출이 명시적 no-op가 되어 견고성 증가. |
| 테스트 안전망 | **MEDIUM-HIGH**: 23 추가 + 242 기존 PASS. 단 `WorkerGameLoop`/`fail()` 경로 phase 직접 통합 테스트는 부재. |
| LOC delta | `+505/-103` (Plan ≤500 살짝 초과하나 신규 217 LOC 테스트 포함이라 실 코드 +288/-103 = OK) |
| 머지 가능 상태 | gh `MERGEABLE`. CI 통과 확인 필요(로컬 검증은 모두 GREEN). |

### 7.2 권고

**머지 권고 (APPROVE)**. 다음을 후속 처리로 추가 권장:

1. (선택) `WorkerGameLoop` instance 단위 phase 통합 테스트 추가 — 현재 23개는 `GameEngine`만 커버.
2. (선택) `fail()` 경로의 phase 전환 통합 테스트 — gauge mock으로 강제 가능.
3. (정보 제공) 4-boolean `@deprecated` 표기는 했으나 제거 시점 미정. 향후 major bump 시 제거 계획 명시 권장.
4. (확인) PR description에서 언급한 "VERIFY-STAGE-2 권고와 일치하는 Stage 4 = AudioPreloader 분해 골든 회귀" 방향 동의.

---

## 8. 부록 — 관찰된 사소 사항 (블로커 아님)

- `ALLOWED.get('paused')`(`src/types/GamePhase.ts:49`)는 `paused → completed`/`failed`도 허용하는데, 실제 lifecycle에서 paused 중에는 tick이 돌지 않아 자연 발생 경로가 없다. 안전한 over-permissive 설정.
- `Object.freeze({ kind: 'ready' })` 등이 `postMessage`(structured clone) 시 freeze는 풀리지만 구조는 유지됨 — 시리얼라이즈 안전.
- `GameLoop.complete()`/`fail()`는 phase 전환 *전에* `getCurrentTime()`을 캡처하는 패턴(`:803-804, 820-821`)을 master와 동일하게 보존. 이 디테일이 깨지면 final state의 시간이 0이 되는 회귀가 발생할 수 있는데, 정확히 보존됨.
- `GameLoop`/`GameEngine`의 `isPlaying` derived getter는 `playing || paused`인 반면 `gamePhaseToFlags(PHASE_PAUSED).isPlaying = true`로 일치. 두 경로 동치성 OK.
