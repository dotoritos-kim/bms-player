# bms-player Stage 1 독립 검증 보고서

> 작성일: 2026-05-05
> 검증자: 독립 검증 에이전트 (이전 자기보고 미신뢰)
> 대상 PR: https://github.com/dotoritos-kim/bms-player/pull/1
> Base: `master` / Head: `refactor/stage-1-worker-boundary-typing` (commit `30496d9`)

---

## 1. 요약 (Verdict)

**APPROVE — 머지 권고 (LOW risk)**

Stage 1 (Worker boundary 타이핑)은 REFACTOR-PLAN의 S1~S3 항목을 충실히 이행했고, master 베이스라인(tsc 3 errors)을 0 errors로 정상화했다. 242/242 vitest 통과 + vite/tsc 빌드 정상. 외부 공개 API(KeysoundPlayer/AudioPreloader/Notechart/GamePlayer 등) 시그니처는 무변경이며 bms-editor·bms-electron-app 호환성에 영향 없음.

다만 두 가지 주의점 존재:
1. `(self as unknown as DedicatedWorkerGlobalScope)` 패턴은 cast 자체가 사라진 게 아니라 **타입 협소화 cast로 교체된 것**. 광범위 `{ postMessage: any }` cast 대비 명확히 안전해졌지만 "cast 0회"는 아님.
2. 새 `messages.ts`의 `FileMap`이 기존 `AudioPreloader.ts:30`의 `FileMap`과 **이중 정의**되었다. 구조적 동등이라 컴파일은 통과하지만 향후 단일 출처로 통합 권장(Stage 2 후속 처리).

---

## 2. Plan 정합성

REFACTOR-PLAN 9장의 S1~S3 항목과 실제 PR diff 매핑:

| Plan 단계 | 계획 내용 | 실제 PR 반영 | 정합 |
|---|---|---|---|
| S1 | `audio/loader/messages.ts` Discriminated Union + AudioLoader switch | `messages.ts` 신규 60 LOC, `LoaderInbound`/`LoaderOutbound` 정의, `AudioLoader.worker.ts:146` switch 적용 | OK |
| S2 | `AudioPreloader.onWorkerMessage` 시그니처를 LoaderOutbound 기반으로 | `worker.onmessage` 핸들러 `MessageEvent<LoaderOutbound>`로 협소화. 단, **공개 콜백 시그니처는 보존**(`(type: string, payload: unknown) => void`) | **부분 — 보존 결정 OK** |
| S3 | Worker `self` cast 헬퍼(`postFromWorker`) — GameLoopWorker / AudioSchedulerWorker | `postFromLoaderWorker` 도입(AudioLoader). GameLoopWorker/AudioSchedulerWorker는 헬퍼 함수 대신 `(self as unknown as DedicatedWorkerGlobalScope)` 인라인 협소화로만 처리 | **부분** |

**평가**: Plan은 3개 worker 모두 동일 헬퍼 사용을 권장했으나, GameLoopWorker/AudioSchedulerWorker는 협소화 cast만 적용. 이는 의도적 **"최소 변경"** 전략으로 보이며, 새 메시지 추가 시 컴파일러가 잡을 수 있도록 `WorkerToMainMessage`/`SchedulerWorkerToMain` union이 이미 인자 타입으로 묶여 있어 안전성 측면에서는 동등하다. Stage 2 이후 통합 헬퍼화 가능.

S2의 공개 콜백 시그니처 보존은 **외부 호환성**에 매우 좋은 결정 (외부 ABI 변경 없이 내부 안전성만 강화).

---

## 3. 빌드/테스트 결과

### 베이스라인 비교

```
master 브랜치 tsc --noEmit:
  src/game/index.ts(54,3): error TS2305: 'SerializedNotechart' not exported from './AudioSchedulerWorker'
  src/game/index.ts(55,3): error TS2305: 'MainToWorkerMessage' not exported from './AudioSchedulerWorker'
  src/game/index.ts(56,3): error TS2305: 'WorkerToMainMessage' not exported from './AudioSchedulerWorker'
  → 3 errors
```

### 현재 브랜치

| 명령 | 결과 |
|---|---|
| `npx tsc --noEmit` | **0 errors** (정상) |
| `npm run build` (vite + tsc declaration emit) | **정상** — 32 modules, dist 산출물 정상 (cjs/esm/d.ts 모두 생성) |
| `npm test` (vitest run) | **242/242 PASS** (9 test files: adversarial, audioWorker, gameloop, gauge, input, integration-core-player, judgment, resolveKeysoundFiles, score) |
| `npx vitest run tests/audioWorker.test.ts` | **19/19 PASS** (Worker 메시지 boundary 회귀 없음) |

이전 에이전트의 `tsc 3→0`, `242/242` 자기보고와 일치 — 직접 재현 확인 완료.

---

## 4. Worker boundary 타입 안전성 검토

### 4.1 신규 `messages.ts` (60 LOC)

```ts
export type LoaderInbound = { type: 'LOAD_AUDIO'; payload: LoadAudioPayload };
export type LoaderOutbound =
  | { type: 'PROGRESS'; payload: WorkerProgressPayload }
  | { type: 'LOADED'; payload: WorkerLoadedPayload }
  | { type: 'DONE'; payload: WorkerDonePayload }
  | { type: 'ERROR'; payload: WorkerErrorPayload };

export function postFromLoaderWorker(msg: LoaderOutbound, transfer?: Transferable[]): void {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  if (transfer && transfer.length > 0) scope.postMessage(msg, transfer);
  else scope.postMessage(msg);
}
```

**평가**: 진짜 안전한 Discriminated Union. `LoaderOutbound`에 새 type 추가 시 switch에서 exhaustiveness 강제됨(현재 `AudioLoader.worker.ts`는 `LOAD_AUDIO`만 처리하므로 inbound는 1종, outbound는 4종). `Transferable[]` 시그니처도 표준 호환.

### 4.2 잔존 cast 분석

`as unknown as` 6건 (master 11건에서 감소했으나 0은 아님):

| 위치 | cast | 분류 |
|---|---|---|
| `messages.ts:54` | `self as unknown as DedicatedWorkerGlobalScope` | **합법적** — Worker scope 협소화 표준 패턴, lib type 한계 |
| `AudioSchedulerWorker.ts:51` | 동일 | 합법적 |
| `GameLoopWorker.ts:104` | 동일 | 합법적 |
| `GameLoopWorker.ts:184` | `proxy as unknown as Notechart` | **잔존** — Stage 1 범위 밖 (Plan S5에서 INotechart 추출로 해결 예정) |
| `useGamePlayer.ts:256` | `keysoundPlayer as unknown as { preloader?: ... }` | **잔존** — Stage 1 범위 밖 (Plan S4) |
| `messages.ts:9` | 주석 내 텍스트 (cast 아님) | N/A |

**결론**: Worker outgoing postMessage 안티패턴 3건은 모두 **타입 협소화 cast**(unsafe `{ postMessage: any }` → 표준 lib 타입)로 교체됨. 새 메시지 type을 union에 추가하면 switch exhaustiveness가 누락을 잡는다(audioWorker.test.ts 19개 테스트로 검증).

### 4.3 `MessageEvent<LoaderInbound>` 도입

```ts
self.onmessage = async (event: MessageEvent<LoaderInbound>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'LOAD_AUDIO': { ... }
  }
};
```

`event.data`의 type이 `LoaderInbound`로 협소화되어 `payload as ...` 수동 cast 제거. **진짜 개선**.

### 4.4 식별된 마이너 이슈

- `FileMap` 이중 정의: `messages.ts:21` + `AudioPreloader.ts:30`. 구조적 동등(`{[key: string]: string}`)이라 컴파일 통과하나 의미적으로 동일 개념이 두 곳에 정의됨. Stage 2 이후 한쪽 단일 출처로 통합 권장(공개 API에서 `AudioPreloader.ts`의 것이 export 되므로 그쪽이 정본).
- `AudioPreloader.onWorkerMessage` public callback 시그니처는 의도적으로 `(string, unknown)` 보존. 외부 호환성 때문에 합당하나, 호출 시 `msg.type, msg.payload` (이미 narrow 가능한 객체)를 다시 풀어서 전달하므로 외부 콜백에서는 narrowing 정보 손실. Stage 2의 KeysoundPlayer interface 보강과 함께 점진 개선 가능.

---

## 5. barrel re-export 수정 적절성 (Stage 1 포함 OK?)

### 사실 확인

- master `src/game/index.ts:53-63`은 `SerializedNotechart, MainToWorkerMessage, WorkerToMainMessage`를 `./AudioSchedulerWorker`에서 import한다고 선언했으나, 해당 타입들은 **실제로는 `./workerProtocol`에 정의됨**. master tsc는 이로 인해 3 errors 발생.
- 즉 **pre-existing 진짜 버그**(아마 파일 분리 리팩터링 잔재). Stage 1 코드 변경의 부수 효과가 아님.
- 이전 보고는 정확하다.

### 분리 PR 필요?

이론적으로는 별도 PR(예: `fix/barrel-reexport-typo`)이 깔끔하지만, **현재 PR 포함도 합리적**:

1. master tsc가 깨진 상태에서 Stage 1 타입 작업을 시작하려면 베이스라인 불일치로 검증 불가능.
2. 변경 규모가 3 lines (export type 블록 분리)로 매우 작고 명백한 typo fix.
3. PR 단위에서 commit 메시지로 설명되어 있으면 리뷰 추적 가능. 실제 commit 30496d9 메시지 확인 필요(없다면 README에서라도 별도 언급).

**권고**: 그대로 머지 OK. 단 **commit 메시지 또는 PR 설명에 "fix(barrel): re-export SerializedNotechart from workerProtocol (pre-existing master bug)"** 명시되어 있는지 확인 (현재 단일 commit이 `refactor(stage-1)` 한 줄뿐이라면 amendment 또는 PR body에 보완 권장).

---

## 6. 공개 API 영향

### bms-editor 사용 표면

```
KeysoundPlayer, createKeysoundPlayer, KeysoundPlayerOptions,
KeysoundPlayerResolveConfig, AudioPreloader, FileMap,
WorkerFactory, AudioPreloaderOptions
```

### bms-electron-app 사용 표면

```
Notechart, AudioPreloader, GamePlayer, FileMap, ScoreState,
NotechartInput, WorkerAudioScheduler, SchedulerNote
```

### 검증 결과

| 항목 | 결과 |
|---|---|
| `src/index.ts` | **변경 없음** |
| `src/audio/index.ts` | **변경 없음** |
| `src/game/index.ts` | export 블록 재구성(typo fix). 노출되는 type 이름·시그니처 동일 |
| `src/types/KeysoundPlayer.ts` | **변경 없음** |
| `KeysoundPlayer` 클래스 | **변경 없음** |
| `AudioPreloader` 생성자 + `onWorkerMessage` 콜백 시그니처 | **변경 없음** (`(type: string, payload: unknown) => void` 보존) |
| `Notechart` 클래스 | **변경 없음** |

**결론**: 외부 호환성 100% 유지. 다운스트림 빌드 영향 0.

---

## 7. 머지 위험도 + 권고

### 위험도: **LOW**

| 차원 | 평가 |
|---|---|
| 회귀 위험 | 매우 낮음. 242 테스트 그린 + Worker 메시지 직렬화는 런타임 동등(payload 형상 무변경) |
| 외부 호환성 | 100% 보존 |
| 타입 안전성 향상 | 진짜 개선 (Discriminated Union narrowing, Worker scope 협소화) |
| 코드 양 | 6 files / +123 / -51 — 작고 집중적 |
| 게임 루프 / 오디오 스케줄링 / Worker 통신 | 기존 audioWorker / gameloop / integration 테스트 그린, 메시지 직렬화 형상 동일하므로 런타임 회귀 가능성 낮음 |

### 머지 권고

**APPROVE / READY TO MERGE**.

### 머지 전 권장 액션 (선택)

1. (필수 아님) PR 본문/commit 메시지에 "barrel typo fix는 pre-existing master 버그 수정"임을 명시 (감사 추적용).
2. (Stage 2 후속) `messages.ts`의 `FileMap`을 `AudioPreloader.ts`의 것으로 단일화하거나 반대로(공개 API 측이 정본이면 그쪽 유지).
3. (Stage 2 후속) Plan S3에 따라 `GameLoopWorker`/`AudioSchedulerWorker`도 헬퍼 함수(`postFromGameWorker`/`postFromSchedulerWorker`) 또는 제네릭 `postFromWorker<T>`로 통일.
4. (Stage 2 후속) `AudioPreloader.onWorkerMessage` 콜백을 `(msg: LoaderOutbound) => void`로 마이그레이션(deprecated 한 사이클 유지 후 breaking).

### 머지 후 모니터링

- bms-editor / bms-electron-app 다음 빌드에서 import 깨짐 없는지 (이론상 0 risk).
- AudioWorker로딩 진행률(progress / loaded / done) UI 표시 정상 동작 (런타임 형상 무변경이라 OK).
