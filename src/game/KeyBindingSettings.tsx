/**
 * Key binding settings component.
 * Lets the player choose the key of every lane of a key mode.
 *
 * NOTE: This version uses plain HTML elements instead of shadcn/ui components
 * to avoid dependency on the host app's UI library.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { KeyColumn } from './InputHandler';
import { LANE_CONFIG_MAP } from './canvas/laneConfig';
import {
  type KeyBindings,
  defaultKeyBindingsFor,
  loadKeyBindingsFor,
  normalizeKeyMode,
  saveKeyBindingsFor,
} from './keyLayouts';
import { useI18n } from '../i18n';

export { loadKeyBindings, saveKeyBindings, bindingsToKeyMap } from './keyLayouts';
export type { KeyBindings } from './keyLayouts';

/** Converts a key code to a user-friendly name. */
export function getKeyDisplayName(code: string): string {
  const keyNames: Record<string, string> = {
    'ShiftLeft': 'L-Shift',
    'ShiftRight': 'R-Shift',
    'ControlLeft': 'L-Ctrl',
    'ControlRight': 'R-Ctrl',
    'AltLeft': 'L-Alt',
    'AltRight': 'R-Alt',
    'Space': 'Space',
    'Enter': 'Enter',
    'Backspace': 'Back',
    'Tab': 'Tab',
    'Escape': 'Esc',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
    'Semicolon': ';',
    'Quote': "'",
    'Comma': ',',
    'Period': '.',
    'Slash': '/',
    'Backslash': '\\',
    'BracketLeft': '[',
    'BracketRight': ']',
    'Minus': '-',
    'Equal': '=',
    'Backquote': '`',
  };

  if (keyNames[code]) return keyNames[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return code;
}

// ============ Types ============

export interface KeyBindingSettingsProps {
  /** Current key bindings */
  bindings?: KeyBindings;
  /** Change callback (called with the saved bindings) */
  onChange?: (bindings: KeyBindings) => void;
  /** Hide the trigger button (when open is controlled externally) */
  hideTrigger?: boolean;
  /** Dialog open state (externally controlled) */
  open?: boolean;
  /** Dialog open state change */
  onOpenChange?: (open: boolean) => void;
  /**
   * Key mode whose lanes are edited: a lane-config name ('9K', '14K', ...)
   * or the key count (5, 7). Defaults to 7K when unspecified.
   */
  keyMode?: number | string;
}

/** Lane-config name for the `keyMode` prop. */
function modeName(keyMode: number | string | undefined): string {
  return normalizeKeyMode(typeof keyMode === 'number' ? `${keyMode}K` : keyMode);
}

// ============ Components ============

/** Individual key slot */
const KeySlot: React.FC<{
  column: KeyColumn;
  color: string;
  currentKey: string;
  isListening: boolean;
  listeningLabel: string;
  onToggle: () => void;
}> = ({ column, color, currentKey, isListening, listeningLabel, onToggle }) => (
  <button
    data-testid={`key-slot-${column}`}
    onClick={onToggle}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 4,
      padding: 6,
      borderRadius: 8,
      border: isListening ? '2px solid #ff6600' : '1px solid #444',
      background: isListening ? 'rgba(255, 102, 0, 0.1)' : '#2a2a3e',
      cursor: 'pointer',
    }}
  >
    {/* Lane indicator */}
    <span
      style={{
        borderRadius: 4,
        padding: '2px 0',
        fontWeight: 'bold',
        fontSize: 12,
        textAlign: 'center',
        backgroundColor: color,
        color: color.toLowerCase() === '#ffffff' ? '#000' : '#fff',
      }}
    >
      {column}
    </span>
    {/* Current key / listening state */}
    <span style={{ fontFamily: 'monospace', fontSize: 13, textAlign: 'center', color: '#fff', minHeight: 18 }}>
      {isListening ? listeningLabel : (currentKey ? getKeyDisplayName(currentKey) : '-')}
    </span>
  </button>
);

const footerButton = (background: string, enabled = true): React.CSSProperties => ({
  padding: '8px 16px',
  fontSize: 14,
  background,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.5,
});

/** Key binding settings dialog */
export const KeyBindingSettings: React.FC<KeyBindingSettingsProps> = ({
  bindings: externalBindings,
  onChange,
  hideTrigger = false,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  keyMode,
}) => {
  const { t } = useI18n();
  const mode = modeName(keyMode);
  const lanes = useMemo(() => LANE_CONFIG_MAP[mode] ?? LANE_CONFIG_MAP['7K'], [mode]);

  // Internal state (used when there is no external control)
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;

  // Key binding state
  const [bindings, setBindings] = useState<KeyBindings>(() => externalBindings ?? loadKeyBindingsFor(mode));
  const [listeningColumn, setListeningColumn] = useState<KeyColumn | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Start from the current bindings whenever the dialog opens or the source changes
  useEffect(() => {
    if (!open) return;
    setBindings(externalBindings ?? loadKeyBindingsFor(mode));
    setHasChanges(false);
    setListeningColumn(null);
  }, [open, externalBindings, mode]);

  // Key input listener
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // The dialog owns the keyboard while it is open: the game behind it
      // must not start, pause or change speed on these keys.
      e.stopPropagation();
      if (!listeningColumn) {
        if (e.code === 'Escape') setOpen(false);
        return;
      }
      e.preventDefault();

      // ESC cancels
      if (e.code === 'Escape') {
        setListeningColumn(null);
        return;
      }

      // Update the key binding
      setBindings((prev) => {
        const newBindings = { ...prev };
        // If another lane already has this key, it takes the current lane's key
        const existingColumn = Object.entries(prev).find(([, code]) => code === e.code)?.[0];
        if (existingColumn && existingColumn !== listeningColumn) {
          if (prev[listeningColumn]) newBindings[existingColumn] = prev[listeningColumn];
          else delete newBindings[existingColumn];
        }
        newBindings[listeningColumn] = e.code;
        return newBindings;
      });

      setHasChanges(true);
      setListeningColumn(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [open, listeningColumn, setOpen]);

  // Save
  const handleSave = useCallback(() => {
    saveKeyBindingsFor(mode, bindings);
    onChange?.(bindings);
    setHasChanges(false);
    setOpen(false);
  }, [mode, bindings, onChange, setOpen]);

  // Reset to defaults
  const handleReset = useCallback(() => {
    setBindings(defaultKeyBindingsFor(mode));
    setListeningColumn(null);
    setHasChanges(true);
  }, [mode]);

  // Cancel
  const handleCancel = useCallback(() => {
    setListeningColumn(null);
    setOpen(false);
  }, [setOpen]);

  if (!open && !hideTrigger) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          fontSize: 14,
          background: '#333',
          color: '#fff',
          border: '1px solid #555',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        {t('screens.keys.open')}
      </button>
    );
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('screens.keys.title')}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.8)',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: '85vh',
          background: '#1a1a2e',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #333' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#fff' }}>
            {t('screens.keys.title')} <span style={{ fontSize: 13, color: '#888' }}>{mode}</span>
          </div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{t('screens.keys.help')}</div>
        </div>

        {/* Key slots, in lane order */}
        <div
          style={{
            padding: '12px 16px',
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
            gap: 8,
          }}
        >
          {lanes.map((lane) => (
            <KeySlot
              key={lane.column}
              column={lane.column}
              color={lane.color}
              currentKey={bindings[lane.column] || ''}
              isListening={listeningColumn === lane.column}
              listeningLabel={t('screens.keys.listening')}
              onToggle={() => setListeningColumn((prev) => (prev === lane.column ? null : lane.column))}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #333', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={handleReset} style={footerButton('#444')}>{t('screens.keys.reset')}</button>
          <button onClick={handleCancel} style={footerButton('#555')}>{t('screens.keys.cancel')}</button>
          <button onClick={handleSave} disabled={!hasChanges} style={footerButton(hasChanges ? '#ff6600' : '#666', hasChanges)}>
            {t('screens.keys.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeyBindingSettings;
