# `@rhythm-archive/bms-player`

BMS rhythm-game player engine. Provides input handling, judgment, gauge,
score management, audio scheduling, and a WebGL-based note canvas.

## Highlights

- Worker-based game loop and audio scheduler: playback is unaffected by
  main-thread jank or alt-tab throttling. Worker entries are published as
  `@rhythm-archive/bms-player/workers/game-loop` and
  `@rhythm-archive/bms-player/workers/audio-scheduler`.
- AudioWorklet mixer built for keysound-heavy charts: samples are registered
  once and played by key, re-triggering a keysound cuts its previous voice
  (choke), a peak limiter replaces hard clipping, and a play that arrives late
  skips the elapsed part. Note times are anchored to
  `AudioContext.currentTime` with a 250 ms lookahead.
- Judgment engine with configurable timing windows
  (`JudgmentEngine`, `JudgmentWindows`). `#RANK` / `#DEFEXRANK` set the
  windows (`DEFEXRANK 100` equals NORMAL) and `#TOTAL` drives the gauge
  (missing or non-positive values fall back to 200); pass them through
  `GamePlayerOptions` (`rank`, `defexrank`, `total`).
- Landmines take their damage from the chart (`value / 2` %, `ZZ` fails every
  gauge). Long-note releases are judged inside the window.
- Lane layouts from 4K to 48K+4SC (`LANE_CONFIG_MAP`). 4K / 6K / 8K follow
  Qwilight's `#4K` / `#6K` / `#8K`; pass `keyMode` to `GamePlayer`, since only
  the extension command selects them. 10K 2P uses columns 8-12 like bms-core.
- Gauge / score managers, key bindings persistence, latency calibration
  (`judgmentOffset`, `visualOffset`, `audioLatency`).
- IndexedDB-backed audio cache (`audioIndexedDBCache`) so large keysound
  sets resume quickly. Keysounds already decoded by another player for the
  same folder count as loaded.
- `KeysoundPlayer` and `useBmsPreview` build the loader worker with
  `createAudioLoaderWorker()` when no `workerFactory` is passed (Vite and
  webpack 5 bundle it).
- React Context-based **i18n** for HUD labels, the ready / pause / result
  screens and runtime errors. See [`I18N.md`](./I18N.md).

## Quick start

```tsx
import {
  GamePlayer,
  I18nProvider,
  type Translator,
} from '@rhythm-archive/bms-player';

function PlayerScreen(props) {
  const { t, i18n } = useTranslation('bms-player');
  const provider = useMemo(
    () => ({ t: t as Translator, locale: i18n.language }),
    [t, i18n.language],
  );
  return (
    <I18nProvider value={provider}>
      <GamePlayer {...props} />
    </I18nProvider>
  );
}
```

## Public API

See [`src/index.ts`](src/index.ts) for the full export list. Highlights:

| Export | Purpose |
| --- | --- |
| `GamePlayer` / `useGamePlayer` | Top-level player component / hook |
| `GameEngine`, `WorkerGameLoop` | Game logic and its worker-backed loop |
| `WorkerAudioScheduler` | Worker-based audio dispatch |
| `JudgmentEngine` | Timing-window judgment |
| `GaugeSystem`, `ScoreManager` | Game state machinery |
| `AudioPreloader`, `createAudioLoaderWorker` | Decodes + caches keysounds |
| `KeysoundPlayer`, `createKeysoundPlayer` | Keysound loading and playback |
| `LANE_CONFIG_MAP`, `getLaneConfigForSide` | Lane layouts per key mode |
| `BmsPreviewPlayer`, `useBmsPreview` | Preview-mode player for chart editors |
| `I18nProvider`, `useI18n` | i18n contract (see I18N.md) |
| `GamePhase`, `canTransition` | Unified game phase state |

## Development

```bash
npm install       # on Windows use `npm install --include=dev` if devDeps are skipped
npm run build     # vite build + .d.ts emit
npm test          # vitest
npm run lint      # eslint (flat config: eslint.config.js)
npm run format    # prettier (config: .prettierrc.json)
```

This package is **vendored** by `bms-electron-app` as a git submodule at
`vendor/bms-player/` and linked through npm workspaces. When changing the
public API, update the submodule pointer in the app in the same change.

## Versioning

Same rules as `bms-editor`. Adding an i18n key is minor; removing/renaming
is major. Engine API changes follow semver.

## Related

- [`bms-core`](https://github.com/dotoritos-kim/bms-core): parser
- [`bms-editor`](https://github.com/dotoritos-kim/bms-editor): editor
- [`bms-electron-app`](https://github.com/dotoritos-kim/bms-electron-app): shell
