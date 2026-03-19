/**
 * BMS 게임용 키 입력 핸들러
 * 저지연 키 입력 처리를 위해 performance.now() 사용
 */

// 기본 7K+SC (IIDX SP)
export type KeyColumn7K = 'SC' | '1' | '2' | '3' | '4' | '5' | '6' | '7';

// 14K+2SC (IIDX DP)
export type KeyColumn14K = KeyColumn7K | 'SC2' | '8' | '9' | '10' | '11' | '12' | '13' | '14';

// 9K (pop'n)
export type KeyColumn9K = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

// 모든 키 컬럼 타입 (확장 가능)
export type KeyColumn = string;

export interface KeyInput {
  column: KeyColumn;
  time: number;        // performance.now() 기준 시간 (ms)
  type: 'down' | 'up';
}

export interface InputHandlerConfig {
  keyMap: Record<string, KeyColumn>;
  enabled: boolean;
}

// 기본 키 매핑 (7K + Scratch)
export const DEFAULT_KEY_MAP: Record<string, KeyColumn> = {
  'ShiftLeft': 'SC',
  'KeyZ': 'SC',
  'KeyS': '1',
  'KeyD': '2',
  'KeyF': '3',
  'Space': '4',
  'KeyJ': '5',
  'KeyK': '6',
  'KeyL': '7',
};

// 대체 키 매핑
export const ALT_KEY_MAP: Record<string, KeyColumn> = {
  'ShiftLeft': 'SC',
  'KeyA': '1',
  'KeyS': '2',
  'KeyD': '3',
  'Space': '4',
  'KeyJ': '5',
  'KeyK': '6',
  'KeyL': '7',
};

// 2P 키 매핑 (SC가 오른쪽에 있으므로 오른쪽 키에 매핑)
export const KEY_MAP_2P: Record<string, KeyColumn> = {
  'KeyS': '1',
  'KeyD': '2',
  'KeyF': '3',
  'Space': '4',
  'KeyJ': '5',
  'KeyK': '6',
  'KeyL': '7',
  'ShiftRight': 'SC',
  'Semicolon': 'SC',  // 세미콜론도 SC로 사용 가능
};

export class InputHandler {
  private keyMap: Map<string, KeyColumn>;
  private pendingInputs: KeyInput[] = [];
  private heldKeys: Set<KeyColumn> = new Set();
  private enabled: boolean = true;

  // 입력 콜백
  private onKeyDownCallback?: (input: KeyInput) => void;
  private onKeyUpCallback?: (input: KeyInput) => void;

  constructor(config: Partial<InputHandlerConfig> = {}) {
    this.keyMap = new Map(Object.entries(config.keyMap ?? DEFAULT_KEY_MAP));
    this.enabled = config.enabled ?? true;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // 키보드 이벤트 리스너 (캡처 단계에서 처리하여 최소 지연)
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp, { capture: true });

    // 포커스 잃을 때 모든 키 해제
    window.addEventListener('blur', this.handleBlur);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;

    const column = this.keyMap.get(e.code);
    if (!column) return;

    // 키 반복 무시 (이미 누르고 있는 경우)
    if (e.repeat || this.heldKeys.has(column)) return;

    // 기본 동작 방지 (Space 스크롤 등)
    e.preventDefault();

    const time = performance.now();
    this.heldKeys.add(column);

    const input: KeyInput = { column, time, type: 'down' };
    this.pendingInputs.push(input);

    // 콜백 호출
    this.onKeyDownCallback?.(input);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (!this.enabled) return;

    const column = this.keyMap.get(e.code);
    if (!column) return;

    e.preventDefault();

    const time = performance.now();
    this.heldKeys.delete(column);

    const input: KeyInput = { column, time, type: 'up' };
    this.pendingInputs.push(input);

    // 콜백 호출
    this.onKeyUpCallback?.(input);
  };

  private handleBlur = (): void => {
    // 모든 홀드 키 해제
    const time = performance.now();
    for (const column of this.heldKeys) {
      const input: KeyInput = { column, time, type: 'up' };
      this.pendingInputs.push(input);
      this.onKeyUpCallback?.(input);
    }
    this.heldKeys.clear();
  };

  /**
   * 대기 중인 모든 입력을 가져오고 큐를 비웁니다
   */
  consumeInputs(): KeyInput[] {
    const inputs = [...this.pendingInputs];
    this.pendingInputs = [];
    return inputs;
  }

  /**
   * 대기 중인 키다운 입력만 가져옵니다
   */
  consumeKeyDowns(): KeyInput[] {
    const keyDowns = this.pendingInputs.filter(i => i.type === 'down');
    this.pendingInputs = this.pendingInputs.filter(i => i.type === 'up');
    return keyDowns;
  }

  /**
   * 특정 컬럼이 현재 눌려있는지 확인
   */
  isHeld(column: KeyColumn): boolean {
    return this.heldKeys.has(column);
  }

  /**
   * 현재 눌려있는 모든 컬럼 반환
   */
  getHeldColumns(): KeyColumn[] {
    return Array.from(this.heldKeys);
  }

  /**
   * 키다운 콜백 설정
   */
  onKeyDown(callback: (input: KeyInput) => void): void {
    this.onKeyDownCallback = callback;
  }

  /**
   * 키업 콜백 설정
   */
  onKeyUp(callback: (input: KeyInput) => void): void {
    this.onKeyUpCallback = callback;
  }

  /**
   * 입력 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.heldKeys.clear();
      this.pendingInputs = [];
    }
  }

  /**
   * 키 매핑 변경
   */
  setKeyMap(keyMap: Record<string, KeyColumn>): void {
    this.keyMap = new Map(Object.entries(keyMap));
  }

  /**
   * 리소스 정리
   */
  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown, { capture: true });
    window.removeEventListener('keyup', this.handleKeyUp, { capture: true });
    window.removeEventListener('blur', this.handleBlur);
    this.heldKeys.clear();
    this.pendingInputs = [];
    this.onKeyDownCallback = undefined;
    this.onKeyUpCallback = undefined;
  }
}

export default InputHandler;
