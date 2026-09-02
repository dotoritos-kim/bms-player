/**
 * Key input handler for the BMS game.
 * Uses performance.now() for low-latency key input handling.
 */

// Default 7K+SC (IIDX SP)
export type KeyColumn7K = 'SC' | '1' | '2' | '3' | '4' | '5' | '6' | '7';

// 14K+2SC (IIDX DP)
export type KeyColumn14K = KeyColumn7K | 'SC2' | '8' | '9' | '10' | '11' | '12' | '13' | '14';

// 9K (pop'n)
export type KeyColumn9K = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

// All key column types (extensible)
export type KeyColumn = string;

export interface KeyInput {
  column: KeyColumn;
  time: number;        // Time based on performance.now() (ms)
  type: 'down' | 'up';
}

export interface InputHandlerConfig {
  keyMap: Record<string, KeyColumn>;
  enabled: boolean;
}

// Default key mapping (7K + Scratch)
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

// Alternative key mapping
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

// 2P key mapping (SC is on the right, so mapped to right-hand keys)
export const KEY_MAP_2P: Record<string, KeyColumn> = {
  'KeyS': '1',
  'KeyD': '2',
  'KeyF': '3',
  'Space': '4',
  'KeyJ': '5',
  'KeyK': '6',
  'KeyL': '7',
  'ShiftRight': 'SC',
  'Semicolon': 'SC',  // Semicolon can also be used as SC
};

export class InputHandler {
  private keyMap: Map<string, KeyColumn>;
  private pendingInputs: KeyInput[] = [];
  private heldKeys: Set<KeyColumn> = new Set();
  private enabled: boolean = true;

  // Input callbacks
  private onKeyDownCallback?: (input: KeyInput) => void;
  private onKeyUpCallback?: (input: KeyInput) => void;

  constructor(config: Partial<InputHandlerConfig> = {}) {
    this.keyMap = new Map(Object.entries(config.keyMap ?? DEFAULT_KEY_MAP));
    this.enabled = config.enabled ?? true;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Keyboard event listeners (handled in the capture phase for minimal latency)
    window.addEventListener('keydown', this.handleKeyDown, { capture: true });
    window.addEventListener('keyup', this.handleKeyUp, { capture: true });

    // Release all keys when focus is lost
    window.addEventListener('blur', this.handleBlur);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;

    const column = this.keyMap.get(e.code);
    if (!column) return;

    // Ignore key repeat (when already held)
    if (e.repeat || this.heldKeys.has(column)) return;

    // Prevent default behavior (Space scrolling, etc.)
    e.preventDefault();

    const time = performance.now();
    this.heldKeys.add(column);

    const input: KeyInput = { column, time, type: 'down' };
    this.enqueue(input);

    // Invoke the callback
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
    this.enqueue(input);

    // Invoke the callback
    this.onKeyUpCallback?.(input);
  };

  private handleBlur = (): void => {
    // Release all held keys
    const time = performance.now();
    for (const column of this.heldKeys) {
      const input: KeyInput = { column, time, type: 'up' };
      this.pendingInputs.push(input);
      this.onKeyUpCallback?.(input);
    }
    this.heldKeys.clear();
  };

  /**
   * Returns all pending inputs and clears the queue.
   */
  consumeInputs(): KeyInput[] {
    const inputs = [...this.pendingInputs];
    this.pendingInputs = [];
    return inputs;
  }

  /**
   * Returns only the pending key-down inputs.
   */
  consumeKeyDowns(): KeyInput[] {
    const keyDowns = this.pendingInputs.filter(i => i.type === 'down');
    this.pendingInputs = this.pendingInputs.filter(i => i.type === 'up');
    return keyDowns;
  }

  /**
   * Checks whether a specific column is currently held.
   */
  isHeld(column: KeyColumn): boolean {
    return this.heldKeys.has(column);
  }

  /**
   * Returns all currently held columns.
   */
  getHeldColumns(): KeyColumn[] {
    return Array.from(this.heldKeys);
  }

  /**
   * Sets the key-down callback.
   */
  onKeyDown(callback: (input: KeyInput) => void): void {
    this.onKeyDownCallback = callback;
  }

  /**
   * Sets the key-up callback.
   */
  onKeyUp(callback: (input: KeyInput) => void): void {
    this.onKeyUpCallback = callback;
  }

  /** Bounded queue: nothing drains it during play, so cap it instead of growing for the whole session. */
  private enqueue(input: KeyInput): void {
    if (this.pendingInputs.length >= InputHandler.MAX_PENDING_INPUTS) this.pendingInputs.shift();
    this.pendingInputs.push(input);
  }
  private static readonly MAX_PENDING_INPUTS = 256;

  /**
   * Enables/disables input.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.heldKeys.clear();
      this.pendingInputs = [];
    }
  }

  /**
   * Changes the key mapping.
   */
  setKeyMap(keyMap: Record<string, KeyColumn>): void {
    this.keyMap = new Map(Object.entries(keyMap));
  }

  /**
   * Cleans up resources.
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
