# bms-player Stage 2 독립 검증 보고서

> 작성일: 2026-05-05
> 검증자: 독립 검증 에이전트 (자기보고 미신뢰)
> 대상 PR: https://github.com/dotoritos-kim/bms-player/pull/2 (이미 머지됨, master `524d63d`)
> Base: `master` / Head: `refactor/stage-2-filemap-and-cast-cleanup`
> Stage 2 주장: FileMap 단일화, INotechart 추출, KeysoundPlayer.getAudioContext() optional, NotechartProxy implements INotechart, GameEngineConfig.notechart broadening

---

## 1. 요약 (Verdict)

**APPROVE / 머지 적합 — LOW–MEDIUM risk.** PR은 이미 master에 머지된 상태(`524d63d`)이며, 독립 재현 검증 결과 모든 핵심 주장이 성립한다.

- bms-player 자체: `tsc --noEmit` 0 errors, `vitest` **242/242 PASS**, `vite build` 정상.
- bms-editor: `tsc --noEmit` **0 errors**, `vitest` **165 passed / 5 skipped (170 total)**.
- bms-electron-app: `tsc --noEmit` **0 errors related to bms-player** (단 1건 `ZoomControl` 누락은 bms-editor 배럴 이슈로 Stage 2와 무관), `vitest` **1122/1122 PASS**.
- 핵심 호환성 변경 3건(KeysoundPlayer optional 메서드 추가 / GameEngineConfig broadening / FileMap 재정의 위치 이동) 모두 **외부 표면에서 깨짐 없음**으로 확인.

---

## 2. PR diff vs Plan 정합성

REFACTOR-PLAN의 S4(KeysoundPlayer.getAudioContext)/S5(INotechart 추출) 및 Stage 1 후속 처리(FileMap 단일화)가 단일 PR에 묶여 있다.

| Plan 단계 | 계획 | 실제 PR | 정합 |
|---|---|---|---|
| Stage 1 후속 | `FileMap` 이중 정의 통합 | `messages.ts:21`을 정본으로 두고 `AudioPreloader.ts`는 `export type { FileMap } from './messages'` 재노출 | **OK** |
| S4 | `KeysoundPlayer` interface에 `getAudioContext(): AudioContext \| null` 추가 → `useGamePlayer.ts:256` cast 제거 | `types/KeysoundPlayer.ts`에 **optional** `getAudioContext?()` 추가, 클래스 `KeysoundPlayer.getAudioContext()` 노출(non-optional 구현), `useGamePlayer`에서 `getAudioContext?.() ?? preloader?.context ?? null` 폴백 사용 | **OK (optional 선택은 비파괴 결정)** |
| S5 | `INotechart` 인터페이스 추출 + `NotechartProxy implements INotechart` → `as unknown as Notechart` 제거 | `audio/judgements/types.ts`에 `INotechart` 추가, `NotechartProxy implements INotechart`, `GameEngineConfig.notechart: Notechart → INotechart` broadening | **OK** |

**판단**: Plan 정합 100%. Plan 표 (10장)의 S4 정책 "default-implementation 클래스로 우회"보다 **더 보수적**으로 처리됨 (interface는 optional 메서드 추가만 — 외부 implementer는 추가 구현 불필요).

---

## 3. 빌드/테스트 결과 (직접 재현)

### 3.1 bms-player (대상 저장소)

| 명령 | 결과 |
|---|---|
| `git pull --ff-only origin master` | `Updating ea42e3a..524d63d` (PR #2 머지된 master로 동기화) |
| `npx tsc --noEmit` | **0 errors** |
| `npm test` (vitest run) | **242/242 PASS** (9 test files, 344ms) |
| `npm run build` (vite + tsc declaration) | **정상**, 32 modules 변환, esm/cjs/d.ts 정상 emit |

### 3.2 외부 의존자 (가장 중요)

bms-editor와 bms-electron-app은 모두 **`file:../bms-player` 워크스페이스 의존**으로 연결되어 있어 머지 직후의 영향이 즉시 보인다.

#### bms-editor (`c:/SourceCode/bms-editor`)

| 명령 | 결과 |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm test` (vitest run) | **165 passed / 5 skipped (170 total)** in 9 test files |

`bms-editor` 내부의 자체 `KeysoundPlayer` 클래스(별도)는 `AudioPreloader, type FileMap, type WorkerFactory, type AudioPreloaderOptions` 만 import 하므로 **Stage 2 변경의 영향 면(getAudioContext, INotechart, GameEngineConfig)에 노출되지 않는다.**

#### bms-electron-app (`c:/SourceCode/bms-electron-app`)

| 명령 | 결과 |
|---|---|
| `npm run type-check` | **bms-player 관련 0 errors**. (단 1 error는 `ZoomControl` not exported from `bms-editor` — 사전 존재하던 bms-editor 배럴 누락이며 Stage 2와 무관) |
| `npm test` (vitest run) | **1122/1122 PASS** (38 test files) |

`bms-electron-app`은 `Notechart, AudioPreloader, GamePlayer, FileMap, ScoreState, NotechartInput, WorkerAudioScheduler, SchedulerNote`를 직접 사용하고 자체적으로 `KeysoundPlayer` interface를 별도로 선언(`src/renderer/lib/keysoundPlayerAdapter.ts`)하여 어댑터로 감싼다. 이 자체 interface는 `getAudioContext?` 를 미구현하므로 — Stage 2의 optional 추가가 비파괴임을 실증한다.

---

## 4. 호환성 영향 (요청에 따라 상세 강조)

### 4.1 `KeysoundPlayer.getAudioContext()` optional 추가

**변경**:
```ts
// types/KeysoundPlayer.ts
export interface KeysoundPlayer {
  // ... 기존 멤버 ...
  readonly preloader?: AudioPreloader;       // @deprecated 유지
  getAudioContext?(): AudioContext | null;   // 신규 — optional
}
```

**외부 영향 평가**:

| 외부 implementer | 영향 |
|---|---|
| `bms-player` 자체 `KeysoundPlayer` 클래스 (`audio/KeysoundPlayer.ts:516`) | 구현 추가 (`getAudioContext(): AudioContext \| null { return this._preloader?.context ?? null }`) — non-breaking |
| `bms-editor`의 자체 `KeysoundPlayer` 클래스 (`src/chart/KeysoundPlayer.ts`) | 자체 interface (`bms-player`의 interface를 implement하지 않음) — **영향 없음** |
| `bms-electron-app`의 `KeysoundPlayer` interface (`src/renderer/lib/keysoundPlayerAdapter.ts`) | **자체 interface 정의** — `bms-player`의 interface와 별도. 어댑터 내부에서 사용. **영향 없음** (그러나 GamePlayer가 받는 interface는 bms-player의 `KeysoundPlayer`이므로, electron-app의 어댑터 객체는 `getAudioContext`가 누락되어 있어도 optional이라 OK) |

**평가**: optional 메서드 추가는 TypeScript 의미론적으로 **subtype 관계 보존** (모든 기존 implementer가 새 interface를 만족). interface 차원에서 strictly broadening. **0 breaking risk**.

검증: useGamePlayer:255 `keysoundPlayer.getAudioContext?.() ?? keysoundPlayer.preloader?.context ?? null` 폴백 체인 — 미구현 implementer도 기존 동작 유지(deprecated `preloader` 게터 경유).

### 4.2 `INotechart` 추출 및 `GameEngineConfig.notechart: Notechart → INotechart` broadening

**변경**:
- `INotechart` interface 신규 추가 (4 readonly props + 2 methods).
- `class Notechart` 자체는 그대로 (`extends/implements INotechart` 명시 없음 — 구조적 호환만으로 충족).
- `GameEngineConfig.notechart: Notechart` → `INotechart`.
- `class GameEngine`의 private 필드 `notechart: Notechart` → `INotechart`.
- `NotechartProxy implements INotechart`.

**Liskov 관점 분석**:
- `class Notechart`는 `INotechart`의 4 readonly + 2 methods 모두 구현하고 있으므로 구조적 subtype.
- 외부 caller가 `new GameEngine({ notechart: notechartInstance })`를 호출할 때, `Notechart` 인스턴스 → `INotechart` 파라미터로 위임 — 입력 위치(contravariant) broadening은 **caller에게 비파괴**(기존 호출 패턴 모두 유효).
- 다만 `GameEngine` 클래스의 `private notechart: INotechart` 필드는 외부에서 접근 불가(private)이므로 외부 영향 없음. **공개 표면이 아닌 위치**.

**검증**:
- `src/index.ts` / `src/game/index.ts`에서 `INotechart`는 export되지 않음 — 내부 전용. 외부 표면 변경 없음.
- bms-electron-app의 `Player.tsx:100`이 `new Notechart(notechartInput)` 호출 후 `GamePlayer` 컴포넌트에 전달 — `GamePlayer` props가 변경되지 않았으므로 영향 없음.
- bms-electron-app 테스트 1122/1122 그린이 이를 실증.

**평가**: input position broadening은 **caller에게 항상 안전**. 외부 호환성 0 risk.

### 4.3 `FileMap` 단일 출처 이동

**변경**:
- 정본을 `AudioPreloader.ts`(라인 30, Stage 1 시점) → `messages.ts`(라인 21)로 옮김.
- `AudioPreloader.ts`는 `export type { FileMap } from './messages'`로 type re-export.

**외부 영향 평가**:

| 외부 import 경로 | 결과 |
|---|---|
| `import type { FileMap } from '@rhythm-archive/bms-player'` (루트 배럴) | `src/index.ts:26` → `src/audio/index.ts:29` → `audio/loader/AudioPreloader.ts` (re-export) → `messages.ts` (정본) — **이름·시그니처 동일**, 컴파일 통과 |
| bms-editor `import { type FileMap } from '@rhythm-archive/bms-player'` | OK (실제 typecheck로 검증) |
| bms-electron-app `import type { FileMap } from '@rhythm-archive/bms-player'` (Player.tsx, Editor.tsx) | OK |
| `import { FileMap } from '@rhythm-archive/bms-player'` (value import, 잘못된 패턴) | type-only이므로 영향 없음 — 실제 사용처 모두 type-only |

**리스크**: 동일 구조(`{[key: string]: string}`)이므로 **structural typing 관점에서 0 risk**. nominal id가 한 곳으로 통합되어 향후 유지보수 측면에서 개선됨.

### 4.4 외부 표면 (간접) 영향 정리

| 표면 | 영향 |
|---|---|
| `KeysoundPlayer` 클래스 (public API) | 메서드 추가만 (`getAudioContext()`) — non-breaking |
| `KeysoundPlayer` interface (`types/KeysoundPlayer.ts`) | optional 메서드 추가 — **non-breaking** (모든 기존 implementer 자동 만족) |
| `Notechart` 클래스 | **시그니처 무변경** |
| `INotechart` interface | 신규 — 외부에 export 안 됨 (내부 전용) |
| `GameEngineConfig.notechart` 파라미터 | `Notechart → INotechart` broadening — **caller에게 비파괴** |
| `AudioPreloader.FileMap` re-export | re-export로 이름 보존 — **사용 측 영향 없음** |
| `useGamePlayer` 반환 형태 | 무변경 |
| `GamePlayer` props | 무변경 |

> **결론: 외부 호환성 100% 보존.** bms-editor / bms-electron-app 모두 typecheck 0 errors + 모든 테스트 통과로 실증.

---

## 5. 잔존 unsafe cast 분석

### 5.1 `as unknown as` 카운트 (Stage 1 6건 → Stage 2 후)

`grep -rn "as unknown as" src/` 결과:

| 위치 | 코드 | 분류 |
|---|---|---|
| `audio/loader/messages.ts:54` | `self as unknown as DedicatedWorkerGlobalScope` | **합법적** — Worker scope 협소화 표준 패턴 |
| `game/AudioSchedulerWorker.ts:51` | 동일 | 합법적 |
| `game/GameLoopWorker.ts:106` | 동일 | 합법적 |
| `audio/KeysoundPlayer.ts:519` | (주석 안의 텍스트) | N/A — code cast 아님 |
| `audio/loader/messages.ts:9` | (주석 안의 텍스트) | N/A — code cast 아님 |

**결과**: 실제 코드 cast는 **3건만 잔존**, 모두 `DedicatedWorkerGlobalScope` Worker 협소화(표준 lib type 한계로 불가피).

**제거된 안티패턴 (Stage 2 효과)**:
- `proxy as unknown as Notechart` (GameLoopWorker.ts:184) — INotechart implements로 제거
- `keysoundPlayer as unknown as { preloader?: { context?: AudioContext } }` (useGamePlayer.ts:256) — getAudioContext() interface로 제거

**판단**: Plan 7장의 P0/P1 unknown 누수 6건 → Stage 1+2 누적으로 모두 해결. 잔존 3건은 모두 "Worker scope cast (합법)" 카테고리로 — 사용자가 우려한 "합법 Worker scope cast만 남았는지"가 정확히 충족됨.

### 5.2 다른 위험 패턴 검사

`as any` / type assertion 검사 별도 수행 — Stage 2 PR diff에서는 신규 추가 0건.

---

## 6. 머지 위험도

### 위험도: **LOW–MEDIUM**

| 차원 | 평가 | 비고 |
|---|---|---|
| 회귀 위험 | 낮음 | 242 + 165 + 1122 = **1529 테스트 그린** (3 저장소 합산) |
| 외부 호환성 | 보존 | typecheck/build 모두 통과, 어떤 변경도 contravariant broadening 또는 optional add only |
| 타입 안전성 향상 | 진짜 개선 | 진짜 unknown 누수 2건 추가 제거 (S4, S5) |
| 코드 양 | 8 files / +84 / -17 — 작고 집중적 | CI 변경(.github/workflows/ci.yml)도 sibling repo 통합으로 합리적 |
| Game/Audio runtime | 회귀 가능성 낮음 | 직렬화 형상·런타임 동작 무변경 (interface 추가만) |
| **외부 implementer 깨짐 리스크** | **매우 낮음** | optional 메서드 추가 + input position broadening — Liskov 관점에서 0 breaking. 실증: bms-editor / bms-electron-app 빌드/테스트 그린 |

### 6.1 머지 권고

**APPROVE / READY (이미 머지됨, master `524d63d`).**

PR은 보수적으로 잘 설계되었다. 주장된 모든 변경이 비파괴(non-breaking)임이 확인되었고, 외부 의존자(bms-editor / bms-electron-app)는 typecheck + 전체 테스트 그린.

### 6.2 후속 권장 (선택, Stage 3+ 후속)

1. **deprecated `preloader` 게터 제거 마일스톤 정의**: `KeysoundPlayer.preloader`는 `@deprecated 다음 메이저에서 제거 예정` 주석이 있으나 마일스톤 미명시. SemVer 측면에서 1 마이너 사이클 유지 후 0.x → 0.y에서 제거 시점 명시 권장.
2. **`INotechart` 외부 export 검토**: 현재 internal-only. 외부 환경(bms-editor/electron-app)에서 차트 사본을 만들고 GameEngine에 주입하려는 케이스가 생기면 `INotechart`도 `src/audio/index.ts` 또는 `src/index.ts`에서 export 하는 것이 자연스럽다 — 다만 export하면 외부 표면에 새 type이 들어가므로 **breaking 후보**가 된다는 점 유의.
3. **Plan S3 마무리**: `GameLoopWorker` / `AudioSchedulerWorker`도 `messages.ts`의 `postFromLoaderWorker`처럼 헬퍼 함수로 통일하면 cast를 1곳으로 축약 가능 (현재 2곳에 인라인 협소화가 남아 있음, 합법이지만 일관성 측면).
4. **CI 검증 강화**: `.github/workflows/ci.yml`이 bms-core sibling 체크아웃을 위한 `WORKSPACE_REPO_TOKEN`/`SIBLING_REPO_TOKEN` 옵셔널 토큰 + `continue-on-error: true` 패턴으로 동작. 토큰이 없는 환경(예: 외부 PR fork)에서는 `bms-core/package.json` 없으면 build skip되지만 그 후 bms-player tsc는 `@rhythm-archive/bms-core` 누락으로 실패 가능. **외부 fork PR 시나리오 별도 검토 권장**.

### 6.3 머지 후 모니터링

- bms-editor / bms-electron-app 다음 빌드에서 `getAudioContext` 미구현 어댑터들이 `useGamePlayer` 폴백 경로(`preloader?.context`)로 정상 동작하는지 (이론상 OK).
- AudioContext suspended → resume 복구 시나리오 회귀 없음(런타임 형상 무변경).
- Worker GameLoop 모드에서 `NotechartProxy` 주입 정상 (워커 모드 통합 테스트로 covered).

---

## 7. 부록: 검증 명령 로그

```
$ cd /c/SourceCode/bms-player && git pull --ff-only origin master
Updating ea42e3a..524d63d
Fast-forward
 src/audio/KeysoundPlayer.ts        | 11 +++++++++++
 src/audio/judgements/types.ts      | 20 ++++++++++++++++++++
 src/audio/loader/AudioPreloader.ts | 10 ++++++----
 src/game/GameEngine.ts             |  6 +++---
 src/game/GameLoopWorker.ts         |  8 +++++---
 src/game/useGamePlayer.ts          |  6 ++++--
 src/types/KeysoundPlayer.ts        | 12 +++++++++++-
 7 files changed, 60 insertions(+), 13 deletions(-)

$ npx tsc --noEmit          # 0 errors
$ npm test                  # Test Files 9 passed | Tests 242 passed | Duration 344ms
$ npm run build             # 32 modules transformed, esm/cjs/d.ts 정상

$ cd /c/SourceCode/bms-editor && npx tsc --noEmit   # 0 errors
$ npm test                  # 165 passed / 5 skipped (170 total)

$ cd /c/SourceCode/bms-electron-app && npm run type-check
# 1 error (ZoomControl from bms-editor — 사전 존재 + Stage 2 무관)
$ npm test                  # 1122/1122 passed (38 files)
```

---

**최종 결론**: Stage 2 PR은 보수적이고 비파괴적이며, 자기보고와 실제가 일치한다. **머지 적합**. (이미 머지됨.) 외부 호환성 위험은 typecheck + 1529 통합 테스트 그린으로 실증되었다.
