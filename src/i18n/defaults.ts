/**
 * English fallback messages for `@rhythm-archive/bms-player`.
 *
 * Smaller surface than bms-editor — the player has fewer user-visible
 * strings (mostly judgment labels, gauge state, error messages).
 */

export const defaultMessages = {
  judgment: {
    pgreat: 'PGREAT',
    great: 'GREAT',
    good: 'GOOD',
    bad: 'BAD',
    poor: 'POOR',
    miss: 'MISS',
    early: 'EARLY',
    late: 'LATE',
  },
  gauge: {
    cleared: 'CLEARED',
    failed: 'FAILED',
  },
  hud: {
    bpm: 'BPM',
    score: 'Score',
    combo: 'Combo',
    accuracy: 'Accuracy',
  },
  errors: {
    audioLoadFailed: 'Failed to load audio',
    decodeFailed: 'Audio decode failed',
    keysoundMissing: 'Missing keysound: {{name}}',
  },
  state: {
    ready: 'Ready',
    playing: 'Playing',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
  },
  screens: {
    ready: {
      title: 'READY',
      hiSpeedLabel: 'HI-SPEED (↑↓ adjust)',
      bpmFormula: 'BPM {{bpm}} × {{hiSpeed}} = {{effective}}',
      greenNumber: 'GREEN NUMBER: {{value}}',
      floatingOn: '● FLOATING HI-SPEED ON',
      floatingOff: '○ FLOATING HI-SPEED OFF',
      floatingKey: '(` key)',
      start: 'START',
      pressToStart: 'Press SPACE or click to start',
      keyHint: '↑↓ Hi-Speed ±0.25 | PgUp/PgDn ±1.0 | ` Floating',
    },
    pause: {
      title: 'PAUSED',
      resume: 'RESUME',
      restart: 'RESTART',
      exit: 'EXIT',
    },
    result: {
      clear: 'CLEAR!',
      failed: 'FAILED',
      fullCombo: 'FULL COMBO!',
      exScore: 'EX SCORE:',
      maxCombo: 'MAX COMBO:',
      retry: 'RETRY',
      exit: 'EXIT',
    },
  },
} as const;

export type BmsPlayerMessages = typeof defaultMessages;
