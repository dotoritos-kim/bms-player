/**
 * 게임 옵션 UI 컴포넌트
 * Hi-Speed, 게이지 타입, 키 설정 등
 */

import React, { useState, useCallback } from 'react';
import type { GaugeType } from './GaugeSystem';
import type { KeyColumn } from './InputHandler';
import { DEFAULT_KEY_MAP } from './InputHandler';

// ============ 타입 ============

export interface GameOptionsState {
  hiSpeed: number;
  gaugeType: GaugeType;
  suddenPlus: number;
  liftPlus: number;
  laneOption: 'normal' | 'mirror' | 'random';
  keyMap: Record<string, KeyColumn>;
  // 레이턴시 보정
  audioLatency: number;
  judgmentOffset: number;
  visualOffset: number;
}

export interface GameOptionsProps {
  /** 현재 옵션 */
  options: GameOptionsState;
  /** 옵션 변경 콜백 */
  onChange: (options: GameOptionsState) => void;
  /** 닫기 콜백 */
  onClose: () => void;
}

// ============ 기본값 ============

export const DEFAULT_GAME_OPTIONS: GameOptionsState = {
  hiSpeed: 1.0,
  gaugeType: 'groove',
  suddenPlus: 0,
  liftPlus: 0,
  laneOption: 'normal',
  keyMap: DEFAULT_KEY_MAP,
  audioLatency: 0,
  judgmentOffset: 0,
  visualOffset: 0,
};

// ============ 서브 컴포넌트 ============

/** 슬라이더 */
const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}> = ({ label, value, min, max, step = 0.1, onChange, format }) => (
  <div style={{ marginBottom: 15 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
      <span>{label}</span>
      <span style={{ color: '#ffcc00' }}>{format ? format(value) : value}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ width: '100%', cursor: 'pointer' }}
    />
  </div>
);

/** 선택 버튼 그룹 */
const ButtonGroup: React.FC<{
  label: string;
  options: Array<{ value: string; label: string; color?: string }>;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, options, value, onChange }) => (
  <div style={{ marginBottom: 15 }}>
    <div style={{ marginBottom: 8 }}>{label}</div>
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1,
            padding: '10px 15px',
            fontSize: 14,
            background: value === opt.value ? (opt.color ?? '#ff6600') : '#333',
            color: '#fff',
            border: value === opt.value ? '2px solid #fff' : '2px solid #555',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

// ============ 키 설정 컴포넌트 ============

const KEY_LABELS: Record<KeyColumn, string> = {
  'SC': 'Scratch',
  '1': 'Key 1',
  '2': 'Key 2',
  '3': 'Key 3',
  '4': 'Key 4',
  '5': 'Key 5',
  '6': 'Key 6',
  '7': 'Key 7',
};

const KeyBindingRow: React.FC<{
  column: KeyColumn;
  currentKey: string;
  onRebind: (column: KeyColumn) => void;
  isBinding: boolean;
}> = ({ column, currentKey, onRebind, isBinding }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid #333',
    }}
  >
    <span>{KEY_LABELS[column]}</span>
    <button
      onClick={() => onRebind(column)}
      style={{
        padding: '6px 15px',
        fontSize: 12,
        background: isBinding ? '#ff6600' : '#444',
        color: '#fff',
        border: '1px solid #666',
        borderRadius: 4,
        cursor: 'pointer',
        minWidth: 100,
      }}
    >
      {isBinding ? 'Press a key...' : currentKey.replace('Key', '')}
    </button>
  </div>
);

// ============ 메인 컴포넌트 ============

export const GameOptions: React.FC<GameOptionsProps> = ({
  options,
  onChange,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'speed' | 'gauge' | 'keys' | 'latency'>('speed');
  const [bindingColumn, setBindingColumn] = useState<KeyColumn | null>(null);

  // 옵션 업데이트 헬퍼
  const updateOption = useCallback(
    <K extends keyof GameOptionsState>(key: K, value: GameOptionsState[K]) => {
      onChange({ ...options, [key]: value });
    },
    [options, onChange]
  );

  // 키 바인딩
  const handleKeyRebind = useCallback((column: KeyColumn) => {
    setBindingColumn(column);
  }, []);

  // 키 입력 감지
  React.useEffect(() => {
    if (!bindingColumn) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();

      // ESC로 취소
      if (e.code === 'Escape') {
        setBindingColumn(null);
        return;
      }

      // 새 키 매핑
      const newKeyMap = { ...options.keyMap };

      // 기존에 이 키를 사용하는 컬럼 찾기
      for (const [key, col] of Object.entries(newKeyMap)) {
        if (col === bindingColumn) {
          delete newKeyMap[key];
        }
      }

      // 새 키 할당
      newKeyMap[e.code] = bindingColumn;
      updateOption('keyMap', newKeyMap);
      setBindingColumn(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bindingColumn, options.keyMap, updateOption]);

  // 현재 키 찾기
  const getKeyForColumn = (column: KeyColumn): string => {
    for (const [key, col] of Object.entries(options.keyMap)) {
      if (col === column) return key;
    }
    return 'None';
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.9)',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: 400,
          maxHeight: '80vh',
          background: '#1a1a2e',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '15px 20px',
            background: '#2a2a4e',
            borderBottom: '1px solid #444',
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 'bold', color: '#fff' }}>
            GAME OPTIONS
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '5px 15px',
              fontSize: 14,
              background: '#666',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* 탭 */}
        <div style={{ display: 'flex', borderBottom: '1px solid #444' }}>
          {(['speed', 'gauge', 'keys', 'latency'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: 12,
                background: activeTab === tab ? '#ff6600' : 'transparent',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {tab === 'speed' ? 'SPEED' : tab === 'gauge' ? 'GAUGE' : tab === 'keys' ? 'KEYS' : 'TIMING'}
            </button>
          ))}
        </div>

        {/* 탭 내용 */}
        <div style={{ padding: 20, color: '#fff' }}>
          {/* 스피드 설정 */}
          {activeTab === 'speed' && (
            <>
              <Slider
                label="Hi-Speed"
                value={options.hiSpeed}
                min={0.5}
                max={10}
                step={0.25}
                onChange={(v) => updateOption('hiSpeed', v)}
                format={(v) => v.toFixed(2)}
              />
              <Slider
                label="SUDDEN+"
                value={options.suddenPlus}
                min={0}
                max={500}
                step={10}
                onChange={(v) => updateOption('suddenPlus', v)}
              />
              <Slider
                label="LIFT+"
                value={options.liftPlus}
                min={0}
                max={500}
                step={10}
                onChange={(v) => updateOption('liftPlus', v)}
              />
              <ButtonGroup
                label="Lane Option"
                options={[
                  { value: 'normal', label: 'NORMAL' },
                  { value: 'mirror', label: 'MIRROR' },
                  { value: 'random', label: 'RANDOM' },
                ]}
                value={options.laneOption}
                onChange={(v) => updateOption('laneOption', v as 'normal' | 'mirror' | 'random')}
              />
            </>
          )}

          {/* 게이지 설정 */}
          {activeTab === 'gauge' && (
            <ButtonGroup
              label="Gauge Type"
              options={[
                { value: 'groove', label: 'GROOVE', color: '#00aa00' },
                { value: 'easy', label: 'EASY', color: '#00cc66' },
                { value: 'assist-easy', label: 'ASSIST', color: '#66cc66' },
                { value: 'hard', label: 'HARD', color: '#cc0000' },
                { value: 'exhard', label: 'EX-HARD', color: '#ff00ff' },
              ]}
              value={options.gaugeType}
              onChange={(v) => updateOption('gaugeType', v as GaugeType)}
            />
          )}

          {/* 키 설정 */}
          {activeTab === 'keys' && (
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 15 }}>
                Click a button and press a key to rebind
              </div>
              {(['SC', '1', '2', '3', '4', '5', '6', '7'] as KeyColumn[]).map((column) => (
                <KeyBindingRow
                  key={column}
                  column={column}
                  currentKey={getKeyForColumn(column)}
                  onRebind={handleKeyRebind}
                  isBinding={bindingColumn === column}
                />
              ))}
              <button
                onClick={() => updateOption('keyMap', DEFAULT_KEY_MAP)}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: 15,
                  fontSize: 14,
                  background: '#444',
                  color: '#fff',
                  border: '1px solid #666',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Reset to Default
              </button>
            </div>
          )}

          {/* 레이턴시 설정 */}
          {activeTab === 'latency' && (
            <div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 15 }}>
                Adjust timing offsets to compensate for audio/visual latency
              </div>
              <Slider
                label="Audio Latency"
                value={options.audioLatency}
                min={-100}
                max={100}
                step={1}
                onChange={(v) => updateOption('audioLatency', v)}
                format={(v) => `${v > 0 ? '+' : ''}${v}ms`}
              />
              <div style={{ fontSize: 11, color: '#666', marginTop: -10, marginBottom: 15 }}>
                Positive: Audio plays earlier | Negative: Audio plays later
              </div>
              <Slider
                label="Judgment Offset"
                value={options.judgmentOffset}
                min={-100}
                max={100}
                step={1}
                onChange={(v) => updateOption('judgmentOffset', v)}
                format={(v) => `${v > 0 ? '+' : ''}${v}ms`}
              />
              <div style={{ fontSize: 11, color: '#666', marginTop: -10, marginBottom: 15 }}>
                Positive: Hit earlier | Negative: Hit later
              </div>
              <Slider
                label="Visual Offset"
                value={options.visualOffset}
                min={-100}
                max={100}
                step={1}
                onChange={(v) => updateOption('visualOffset', v)}
                format={(v) => `${v > 0 ? '+' : ''}${v}ms`}
              />
              <div style={{ fontSize: 11, color: '#666', marginTop: -10, marginBottom: 15 }}>
                Positive: Notes appear earlier | Negative: Notes appear later
              </div>
              <button
                onClick={() => {
                  updateOption('audioLatency', 0);
                  updateOption('judgmentOffset', 0);
                  updateOption('visualOffset', 0);
                }}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: 10,
                  fontSize: 14,
                  background: '#444',
                  color: '#fff',
                  border: '1px solid #666',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Reset Timing
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameOptions;
