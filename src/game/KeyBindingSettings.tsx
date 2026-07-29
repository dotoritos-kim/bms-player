/**
 * Key binding settings component.
 * Provides a UI that lets users customize their game keys.
 *
 * NOTE: This version uses plain HTML elements instead of shadcn/ui components
 * to avoid dependency on the host app's UI library.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { DEFAULT_KEY_MAP, type KeyColumn } from './InputHandler';

// ============ Constants ============

const STORAGE_KEY = 'bms_key_bindings';

// Display info per lane
interface LaneInfo {
  column: KeyColumn;
  label: string;
  color: string;
  description: string;
}

const LANE_INFO_5K: LaneInfo[] = [
  { column: 'SC', label: 'SC', color: '#ff3366', description: 'Scratch' },
  { column: '1', label: '1', color: '#ffffff', description: 'Key 1' },
  { column: '2', label: '2', color: '#3399ff', description: 'Key 2' },
  { column: '3', label: '3', color: '#ffcc00', description: 'Key 3 (Center)' },
  { column: '4', label: '4', color: '#3399ff', description: 'Key 4' },
  { column: '5', label: '5', color: '#ffffff', description: 'Key 5' },
];

const LANE_INFO_7K: LaneInfo[] = [
  { column: 'SC', label: 'SC', color: '#ff3366', description: 'Scratch' },
  { column: '1', label: '1', color: '#ffffff', description: 'Key 1' },
  { column: '2', label: '2', color: '#3399ff', description: 'Key 2' },
  { column: '3', label: '3', color: '#ffffff', description: 'Key 3' },
  { column: '4', label: '4', color: '#ffcc00', description: 'Key 4 (Center)' },
  { column: '5', label: '5', color: '#ffffff', description: 'Key 5' },
  { column: '6', label: '6', color: '#3399ff', description: 'Key 6' },
  { column: '7', label: '7', color: '#ffffff', description: 'Key 7' },
];

function getLaneInfoForKeyMode(keyMode?: number): LaneInfo[] {
  switch (keyMode) {
    case 5: return LANE_INFO_5K;
    case 7:
    default: return LANE_INFO_7K;
  }
}

// Converts a key code to a user-friendly name
function getKeyDisplayName(code: string): string {
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

export interface KeyBindings {
  [column: string]: string; // column -> keyCode
}

export interface KeyBindingSettingsProps {
  /** Current key bindings */
  bindings?: KeyBindings;
  /** Change callback */
  onChange?: (bindings: KeyBindings) => void;
  /** Hide the trigger button (when open is controlled externally) */
  hideTrigger?: boolean;
  /** Dialog open state (externally controlled) */
  open?: boolean;
  /** Dialog open state change */
  onOpenChange?: (open: boolean) => void;
  /** Key mode (5K, 7K, etc.). Defaults to 7K when unspecified */
  keyMode?: number;
}

// ============ Utility functions ============

/** Loads saved key bindings */
export function loadKeyBindings(): KeyBindings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore
  }
  // Return defaults (converts keyCode -> column into column -> keyCode)
  return invertKeyMap(DEFAULT_KEY_MAP);
}

/** Saves key bindings */
export function saveKeyBindings(bindings: KeyBindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Ignore
  }
}

/** Converts key bindings into a keyMap for InputHandler */
export function bindingsToKeyMap(bindings: KeyBindings): Record<string, KeyColumn> {
  const keyMap: Record<string, KeyColumn> = {};
  for (const [column, keyCode] of Object.entries(bindings)) {
    keyMap[keyCode] = column;
  }
  return keyMap;
}

/** Converts DEFAULT_KEY_MAP into the bindings format */
function invertKeyMap(keyMap: Record<string, KeyColumn>): KeyBindings {
  const bindings: KeyBindings = {};
  for (const [keyCode, column] of Object.entries(keyMap)) {
    // When multiple keys map to the same column, use only the first one
    if (!bindings[column]) {
      bindings[column] = keyCode;
    }
  }
  return bindings;
}

// ============ Components ============

/** Individual key slot */
const KeySlot: React.FC<{
  lane: LaneInfo;
  currentKey: string;
  isListening: boolean;
  onStartListening: () => void;
  onCancelListening: () => void;
}> = ({ lane, currentKey, isListening, onStartListening, onCancelListening }) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 8,
        border: isListening ? '2px solid #ff6600' : '1px solid #444',
        background: isListening ? 'rgba(255, 102, 0, 0.1)' : '#2a2a3e',
        transition: 'all 0.2s',
      }}
    >
      {/* Lane indicator */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          fontSize: 14,
          backgroundColor: lane.color,
          color: lane.color === '#ffffff' ? '#000' : '#fff',
        }}
      >
        {lane.label}
      </div>

      {/* Description */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14, color: '#fff' }}>{lane.description}</div>
        <div style={{ fontSize: 12, color: '#888' }}>Lane {lane.label}</div>
      </div>

      {/* Current key / listening state */}
      <button
        onClick={isListening ? onCancelListening : onStartListening}
        style={{
          minWidth: 80,
          height: 40,
          padding: '0 12px',
          borderRadius: 6,
          fontFamily: 'monospace',
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isListening ? '#ff6600' : '#444',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {isListening ? 'Press key...' : getKeyDisplayName(currentKey)}
      </button>
    </div>
  );
};

/** Key binding settings dialog */
export const KeyBindingSettings: React.FC<KeyBindingSettingsProps> = ({
  bindings: externalBindings,
  onChange,
  hideTrigger = false,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  keyMode,
}) => {
  // Internal state (used when there is no external control)
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;

  // Key binding state
  const [bindings, setBindings] = useState<KeyBindings>(() => externalBindings ?? loadKeyBindings());
  const [listeningColumn, setListeningColumn] = useState<KeyColumn | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync when external bindings change
  useEffect(() => {
    if (externalBindings) {
      setBindings(externalBindings);
    }
  }, [externalBindings]);

  // Key input listener
  useEffect(() => {
    if (!listeningColumn) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // ESC cancels
      if (e.code === 'Escape') {
        setListeningColumn(null);
        return;
      }

      // Update the key binding
      setBindings((prev) => {
        // Check whether the key is already assigned to another lane
        const existingColumn = Object.entries(prev).find(([, code]) => code === e.code)?.[0];

        const newBindings = { ...prev };

        // If another lane already has this key, swap it with the current lane's key
        if (existingColumn && existingColumn !== listeningColumn) {
          newBindings[existingColumn] = prev[listeningColumn];
        }

        newBindings[listeningColumn] = e.code;
        return newBindings;
      });

      setHasChanges(true);
      setListeningColumn(null);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [listeningColumn]);

  // Save
  const handleSave = useCallback(() => {
    saveKeyBindings(bindings);
    onChange?.(bindings);
    setHasChanges(false);
    setOpen(false);
  }, [bindings, onChange, setOpen]);

  // Reset to defaults
  const handleReset = useCallback(() => {
    const defaultBindings = invertKeyMap(DEFAULT_KEY_MAP);
    setBindings(defaultBindings);
    setHasChanges(true);
  }, []);

  // Cancel
  const handleCancel = useCallback(() => {
    setBindings(externalBindings ?? loadKeyBindings());
    setHasChanges(false);
    setListeningColumn(null);
    setOpen(false);
  }, [externalBindings, setOpen]);

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
        Key Settings
      </button>
    );
  }

  if (!open) return null;

  return (
    <div
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
        if (e.target === e.currentTarget) {
          setListeningColumn(null);
          setOpen(false);
        }
      }}
    >
      <div
        style={{
          width: 420,
          maxHeight: '80vh',
          background: '#1a1a2e',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #333' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#fff' }}>Key Binding Settings</div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            Click a slot and press a key to rebind. Keys swap automatically.
          </div>
        </div>

        {/* Key slot list */}
        <div style={{ padding: '12px 16px', overflowY: 'auto', maxHeight: 400, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {getLaneInfoForKeyMode(keyMode).map((lane) => (
            <KeySlot
              key={lane.column}
              lane={lane}
              currentKey={bindings[lane.column] || ''}
              isListening={listeningColumn === lane.column}
              onStartListening={() => setListeningColumn(lane.column)}
              onCancelListening={() => setListeningColumn(null)}
            />
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #333', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={handleReset}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              background: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Reset Default
          </button>
          <button
            onClick={handleCancel}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              background: '#555',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              background: hasChanges ? '#ff6600' : '#666',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: hasChanges ? 'pointer' : 'not-allowed',
              opacity: hasChanges ? 1 : 0.5,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeyBindingSettings;
