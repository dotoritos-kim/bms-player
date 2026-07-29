# `@rhythm-archive/bms-player`

BMS rhythm-game player engine. Provides input handling, judgment, gauge,
score management, audio scheduling, and a WebGL-based note canvas.

🇰🇷 한국어 README는 추후 추가 예정입니다 <!-- Phase 4 follow-up -->

## Highlights

- Worker-based audio scheduler — playback is unaffected by main-thread
  jank or alt-tab throttling.
- Judgment engine with configurable timing windows
  (`JudgmentEngine`, `JudgmentWindows`).
- Gauge / score managers, key bindings persistence, latency calibration.
- IndexedDB-backed audio cache (`audioIndexedDBCache`) so large keysound
  sets resume quickly.
- React Context-based **i18n** for HUD labels and runtime errors. See
  [`I18N.md`](./I18N.md).

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
| `WorkerAudioScheduler` | Worker-based audio dispatch |
| `JudgmentEngine` | Timing-window judgment |
| `GaugeSystem`, `ScoreManager` | Game state machinery |
| `AudioPreloader` | Decodes + caches keysounds |
| `BmsPreviewPlayer` | Preview-mode player for chart editors |
| `I18nProvider`, `useI18n` | i18n contract — see I18N.md |

## Development

```bash
npm install       # on Windows use `npm install --include=dev` if devDeps are skipped
npm run build     # vite build + .d.ts emit
npm test          # vitest
npm run format    # prettier (config: .prettierrc.json)
```

This package is **vendored** by `bms-electron-app` into `vendor/bms-player/` via npm
workspaces. Keep the vendored copy in sync when changing the public API — see the
workspace health report (`WORKSPACE_HEALTH_*.md`).

## Versioning

Same rules as `bms-editor`. Adding an i18n key is minor; removing/renaming
is major. Engine API changes follow semver.

## Related

- [`bms-core`](https://github.com/dotoritos-kim/bms-core) — parser
- [`bms-editor`](https://github.com/dotoritos-kim/bms-editor) — editor
- [`bms-electron-app`](https://github.com/dotoritos-kim/bms-electron-app) — shell
