/**
 * 키 바인딩 설정 컴포넌트
 * 사용자가 게임 키를 커스터마이징할 수 있는 UI 제공
 *
 * NOTE: This version uses plain HTML elements instead of shadcn/ui components
 * to avoid dependency on the host app's UI library.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { DEFAULT_KEY_MAP, type KeyColumn } from './InputHandler';

// ============ 상수 ============

const STORAGE_KEY = 'bms_key_bindings';

// 레인별 표시 정보
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

// 키 코드를 사용자 친화적인 이름으로 변환
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

// ============ 타입 ============

export interface KeyBindings {
  [column: string]: string; // column -> keyCode
}

export interface KeyBindingSettingsProps {
  /** 현재 키 바인딩 */
  bindings?: KeyBindings;
  /** 변경 콜백 */
  onChange?: (bindings: KeyBindings) => void;
  /** 트리거 버튼 숨기기 (외부에서 open 제어 시) */
  hideTrigger?: boolean;
  /** 다이얼로그 열림 상태 (외부 제어) */
  open?: boolean;
  /** 다이얼로그 열림 상태 변경 */
  onOpenChange?: (open: boolean) => void;
  /** 키 모드 (5K, 7K 등). 미지정 시 7K */
  keyMode?: number;
}

// ============ 유틸 함수 ============

/** 저장된 키 바인딩 불러오기 */
export function loadKeyBindings(): KeyBindings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // 무시
  }
  // 기본값 반환 (keyCode -> column 을 column -> keyCode로 변환)
  return invertKeyMap(DEFAULT_KEY_MAP);
}

/** 키 바인딩 저장 */
export function saveKeyBindings(bindings: KeyBindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // 무시
  }
}

/** 키 바인딩을 InputHandler용 keyMap으로 변환 */
export function bindingsToKeyMap(bindings: KeyBindings): Record<string, KeyColumn> {
  const keyMap: Record<string, KeyColumn> = {};
  for (const [column, keyCode] of Object.entries(bindings)) {
    keyMap[keyCode] = column;
  }
  return keyMap;
}

/** DEFAULT_KEY_MAP을 bindings 형식으로 변환 */
function invertKeyMap(keyMap: Record<string, KeyColumn>): KeyBindings {
  const bindings: KeyBindings = {};
  for (const [keyCode, column] of Object.entries(keyMap)) {
    // 같은 column에 여러 키가 매핑된 경우 첫 번째만 사용
    if (!bindings[column]) {
      bindings[column] = keyCode;
    }
  }
  return bindings;
}

// ============ 컴포넌트 ============

/** 개별 키 슬롯 */
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
      {/* 레인 표시 */}
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

      {/* 설명 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14, color: '#fff' }}>{lane.description}</div>
        <div style={{ fontSize: 12, color: '#888' }}>Lane {lane.label}</div>
      </div>

      {/* 현재 키 / 리스닝 상태 */}
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

/** 키 바인딩 설정 다이얼로그 */
export const KeyBindingSettings: React.FC<KeyBindingSettingsProps> = ({
  bindings: externalBindings,
  onChange,
  hideTrigger = false,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  keyMode,
}) => {
  // 내부 상태 (외부 제어가 없을 때 사용)
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen ?? internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;

  // 키 바인딩 상태
  const [bindings, setBindings] = useState<KeyBindings>(() => externalBindings ?? loadKeyBindings());
  const [listeningColumn, setListeningColumn] = useState<KeyColumn | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // 외부 bindings 변경 시 동기화
  useEffect(() => {
    if (externalBindings) {
      setBindings(externalBindings);
    }
  }, [externalBindings]);

  // 키 입력 리스너
  useEffect(() => {
    if (!listeningColumn) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // ESC는 취소
      if (e.code === 'Escape') {
        setListeningColumn(null);
        return;
      }

      // 키 바인딩 업데이트
      setBindings((prev) => {
        // 이미 다른 레인에 할당된 키인지 확인
        const existingColumn = Object.entries(prev).find(([, code]) => code === e.code)?.[0];

        const newBindings = { ...prev };

        // 기존에 이 키가 할당된 레인이 있으면 현재 레인의 키와 교환
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

  // 저장
  const handleSave = useCallback(() => {
    saveKeyBindings(bindings);
    onChange?.(bindings);
    setHasChanges(false);
    setOpen(false);
  }, [bindings, onChange, setOpen]);

  // 기본값으로 초기화
  const handleReset = useCallback(() => {
    const defaultBindings = invertKeyMap(DEFAULT_KEY_MAP);
    setBindings(defaultBindings);
    setHasChanges(true);
  }, []);

  // 취소
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
        {/* 헤더 */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #333' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#fff' }}>Key Binding Settings</div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
            Click a slot and press a key to rebind. Keys swap automatically.
          </div>
        </div>

        {/* 키 슬롯 목록 */}
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

        {/* 푸터 */}
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
