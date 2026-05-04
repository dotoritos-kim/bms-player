/**
 * KeysoundPlayer
 *
 * BMS 키사운드를 로드하고 재생하는 커스텀 AudioPreloader 기반 플레이어
 * AudioWorklet을 사용하여 저지연 오디오 재생을 제공합니���.
 * resolveKeysoundFiles를 통한 stem 기반 파일 해석을 지원합니다.
 */

import { AudioPreloader, type FileMap, type WorkerFactory, type AudioPreloaderOptions } from './loader/AudioPreloader';
import { resolveKeysoundFiles, type ResolveOptions, type AudioFileMapFetcher } from './loader/resolveKeysoundFiles';

/**
 * 모니터 프레임 주기를 측정하여 초 단위로 반환
 * rAF 10프레임 샘플링 → 평균 프레임 간격
 */
function detectFrameDuration(): Promise<number> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let prev = 0;
    const measure = (ts: number) => {
      if (prev > 0) deltas.push(ts - prev);
      prev = ts;
      if (deltas.length < 10) {
        requestAnimationFrame(measure);
      } else {
        const avgMs = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        resolve(avgMs / 1000); // ms → seconds
      }
    };
    requestAnimationFrame(measure);
  });
}

export interface KeysoundPlayerResolveConfig {
  /** Repository slug */
  slug: string;
  /** Branch, tag, or commit SHA */
  ref: string;
  /** BMS 파일이 위치한 디렉토리 경로 (루트면 빈 문자열) */
  dir: string;
  /** 오디오 파일 매핑을 가져오는 fetcher (환경별 주입) */
  fetcher: AudioFileMapFetcher;
}

export interface KeysoundPlayerOptions {
  /** 기본 URL (BMS 파일이 있는 디렉토리) */
  baseUrl: string;
  /** 키사운드 매핑 (ID -> 파일명) */
  keysounds: Record<string, string>;
  /** 볼륨 (0.0 ~ 1.0) */
  volume?: number;
  /** 로드 진행 콜백 */
  onProgress?: (loaded: number, total: number) => void;
  /** 로드 완료 콜백 */
  onReady?: () => void;
  /** 에러 콜백 */
  onError?: (error: string) => void;
  /** 성능 최적화 옵션 (기본: 활���화) */
  performanceMode?: boolean;
  /** 간소화된 이펙트 사�� (기본: false) */
  simplifiedEffects?: boolean;
  /** Worker 팩토리 (AudioLoader Worker 인스턴스를 생성하는 함수) */
  workerFactory?: WorkerFactory;
  /** stem 기반 파일 해석 설정 (없으면 직접 fileMap 사용) */
  resolve?: KeysoundPlayerResolveConfig;
}


export class KeysoundPlayer {
  readonly preloader: AudioPreloader | null = null;
  private _preloader: AudioPreloader | null = null;
  private options: Required<Omit<KeysoundPlayerOptions, 'resolve'>> & { resolve?: KeysoundPlayerResolveConfig };
  private isLoading = false;
  private _isReady = false;
  private fileMap: FileMap = {};
  private _contextStateHandler: (() => void) | null = null;
  private _isRecovering = false;
  private preloaderOptions: AudioPreloaderOptions;

  // 디버깅용: 로드 실패한 키사운드 추적
  private _failedKeysounds: Map<string, string> = new Map();
  private _loadedKeysounds: Set<string> = new Set();

  // 키사운드별 재생 레이턴시 측정
  private _playLatencies: number[] = [];
  private readonly _maxLatencySamples = 100;

  constructor(options: KeysoundPlayerOptions) {
    this.options = {
      volume: options.volume ?? 0.8,
      onProgress: options.onProgress ?? (() => {}),
      onReady: options.onReady ?? (() => {}),
      onError: options.onError ?? (() => {}),
      baseUrl: options.baseUrl,
      keysounds: options.keysounds,
      performanceMode: options.performanceMode ?? true,
      simplifiedEffects: options.simplifiedEffects ?? false,
      workerFactory: options.workerFactory ?? (() => { throw new Error('workerFactory is required for KeysoundPlayer'); }),
      resolve: options.resolve,
    };

    this.preloaderOptions = {
      progressiveDecode: this.options.performanceMode,
      simplifiedEffects: this.options.simplifiedEffects,
      useCache: true,
    };

    // resolve 모드가 아닌 경우 즉시 fileMap 빌드
    if (!this.options.resolve) {
      this.buildFileMap();
    }
  }

  private buildFileMap(): void {
    for (const [id, filename] of Object.entries(this.options.keysounds)) {
      const file = filename.replace(/^\//, '');
      this.fileMap[id.toLowerCase()] = file;
    }
  }

  private async buildFileMapResolved(): Promise<void> {
    const resolveConfig = this.options.resolve;
    if (!resolveConfig) {
      this.buildFileMap();
      return;
    }

    const resolveOptions: ResolveOptions = {
      slug: resolveConfig.slug,
      ref: resolveConfig.ref,
      dir: resolveConfig.dir,
    };

    const { resolved } = await resolveKeysoundFiles(
      this.options.keysounds,
      resolveOptions,
      resolveConfig.fetcher,
    );

    if (Object.keys(resolved).length > 0) {
      this.fileMap = resolved;
    } else {
      // resolve 실패 시 원본 fileMap으로 폴백
      console.warn('[KeysoundPlayer] Resolve returned no results, falling back to raw filenames');
      this.buildFileMap();
    }
  }

  get isReady(): boolean {
    return this._isReady;
  }

  get loadProgress(): { loaded: number; total: number } {
    if (!this._preloader) {
      return { loaded: 0, total: Object.keys(this.fileMap).length };
    }
    return {
      loaded: this._preloader.downloadedCount,
      total: this._preloader.downloadedTotal,
    };
  }

  async init(): Promise<void> {
    if (this._preloader) return;

    // resolve 모드인 경우 파일 매핑 해석
    if (this.options.resolve) {
      await this.buildFileMapResolved();
    }

    try {
      const frameDuration = await detectFrameDuration();

      const worker = this.options.workerFactory();

      this._preloader = new AudioPreloader(
        this.options.baseUrl.replace(/\/$/, ''),
        this.fileMap,
        worker,
        (type: string, payload: unknown) => {
          if (type === 'PROGRESS') {
            const loaded = this._preloader?.downloadedCount ?? 0;
            const total = this._preloader?.downloadedTotal ?? Object.keys(this.fileMap).length;
            this.options.onProgress(loaded, total);
          } else if (type === 'LOADED') {
            const loadedPayload = payload as { key?: string } | undefined;
            if (loadedPayload?.key) {
              this._loadedKeysounds.add(loadedPayload.key.toLowerCase());
            }
          } else if (type === 'ERROR') {
            const errorPayload = payload as { key?: string; fileName?: string; message?: string } | undefined;
            if (errorPayload?.key) {
              this._failedKeysounds.set(
                errorPayload.key.toLowerCase(),
                `${errorPayload.fileName || 'unknown'}: ${errorPayload.message || 'Unknown error'}`
              );
            }
            console.warn('[KeysoundPlayer] Load failed:', errorPayload?.key, errorPayload?.fileName, errorPayload?.message);
          }
        },
        { ...this.preloaderOptions, latencyHint: frameDuration }
      );

      // Make preloader accessible via readonly property
      (this as { preloader: AudioPreloader | null }).preloader = this._preloader;

      this._contextStateHandler = () => {
        const ctx = this._preloader?.context;
        if (!ctx) return;

        if (ctx.state === 'suspended') {
          if (!this._isRecovering) {
            this._isRecovering = true;
            ctx.resume().then(() => {
              this._isRecovering = false;
            }).catch(() => {
              this._isRecovering = false;
            });
          }
        }
      };

      const ctx = this._preloader.context;
      if (ctx) {
        ctx.addEventListener('statechange', this._contextStateHandler);
      }
    } catch (error: unknown) {
      this.options.onError('Failed to initialize AudioPreloader');
      throw error;
    }
  }

  async load(): Promise<void> {
    if (this.isLoading) return;
    if (!this._preloader) {
      await this.init();
    }

    if (!this._preloader) {
      throw new Error('Preloader not initialized');
    }

    const totalCount = Object.keys(this.fileMap).length;
    if (totalCount === 0) {
      this._isReady = true;
      this.options.onReady();
      return;
    }

    this.isLoading = true;

    try {
      if (this.options.performanceMode) {
        await this._preloader.loadAndInitParallel();
      } else {
        await this._preloader.loadAll();
        await this._preloader.decodeAll();
        await this._preloader.initAudioWorklet();
      }

      this._preloader.setMasterVolume(this.options.volume);

      this._isReady = true;
      this.isLoading = false;
      this.options.onReady();
    } catch (error: unknown) {
      this.isLoading = false;
      const message = error instanceof Error ? error.message : 'Failed to load keysounds';
      this.options.onError(message);
      throw error;
    }
  }

  /**
   * 키사운드 재생
   * @param keysoundId - 키사운드 ID
   * @param offset - 재생 시작 위치 (초 단위, 기본: 0)
   * @param scheduledTime - AudioContext 예약 시간 (0이면 즉시 재생)
   * @param volume - 볼륨 (0-1, 기본: 1)
   */
  play(keysoundId: string, offset = 0, scheduledTime = 0, volume = 1): void {
    if (!this._preloader || !this._isReady) {
      return;
    }

    const ctx = this._preloader.context;
    if (ctx && ctx.state !== 'running') {
      if (!this._isRecovering) {
        this._isRecovering = true;
        ctx.resume().finally(() => { this._isRecovering = false; });
      }
      return;
    }

    const id = keysoundId.toLowerCase();

    try {
      const t0 = performance.now();
      const result = this._preloader.playAudioSync(id, false, true, offset, scheduledTime, volume);
      const delta = performance.now() - t0;
      this._playLatencies.push(delta);
      if (this._playLatencies.length > this._maxLatencySamples) {
        this._playLatencies.shift();
      }
      if (!result && !this._loggedMissingKeys?.has(id)) {
        if (!this._loggedMissingKeys) this._loggedMissingKeys = new Set();
        if (this._loggedMissingKeys.size < 10) {
          this._loggedMissingKeys.add(id);
          console.warn('[KeysoundPlayer] No audio for keysound:', id);
        }
      }
    } catch (error: unknown) {
      if (!this._loggedMissingKeys?.has('_playError')) {
        if (!this._loggedMissingKeys) this._loggedMissingKeys = new Set();
        this._loggedMissingKeys.add('_playError');
        console.warn('[KeysoundPlayer] Play error (subsequent errors will be suppressed):', error);
      }
    }
  }

  private _loggedMissingKeys?: Set<string>;

  playMultiple(keysoundIds: string[]): void {
    for (const id of keysoundIds) {
      this.play(id);
    }
  }

  playMultipleWithOffset(keysounds: Array<{ id: string; offset: number }>): void {
    for (const { id, offset } of keysounds) {
      this.play(id, offset);
    }
  }

  stopAll(): void {
    if (!this._preloader) return;
    this._preloader.stopAllAudio();
  }

  setVolume(volume: number): void {
    this.options.volume = Math.max(0, Math.min(1, volume));
    if (this._preloader && this._isReady) {
      this._preloader.setMasterVolume(this.options.volume);
    }
  }

  setPlaybackRate(rate: number): void {
    if (this._preloader && this._isReady) {
      this._preloader.setPlaybackRate(rate);
    }
  }

  getKeysoundDuration(keysoundId: string): number {
    if (!this._preloader || !this._isReady) return 0;
    const id = keysoundId.toLowerCase();
    return this._preloader.getAudioDuration(id);
  }

  hasKeysound(keysoundId: string): boolean {
    if (!this._preloader || !this._isReady) return false;
    const id = keysoundId.toLowerCase();
    return this._preloader.hasAudioBuffer(id);
  }

  // ============ Diagnostic Methods ============

  getFailedKeysounds(): Map<string, string> {
    return new Map(this._failedKeysounds);
  }

  getLoadedKeysounds(): Set<string> {
    return new Set(this._loadedKeysounds);
  }

  diagnoseKeysounds(referencedKeysoundIds: string[]): {
    missingDefinitions: string[];
    failedLoads: Array<{ id: string; error: string }>;
    loaded: string[];
    notReferenced: string[];
  } {
    const uniqueRefs = [...new Set(referencedKeysoundIds.map(id => id.toLowerCase()))];
    const definedIds = new Set(Object.keys(this.fileMap).map(k => k.toLowerCase()));

    const missingDefinitions: string[] = [];
    const failedLoads: Array<{ id: string; error: string }> = [];
    const loaded: string[] = [];

    for (const id of uniqueRefs) {
      if (!definedIds.has(id)) {
        missingDefinitions.push(id);
      } else if (this._failedKeysounds.has(id)) {
        failedLoads.push({ id, error: this._failedKeysounds.get(id) || 'Unknown' });
      } else if (this._loadedKeysounds.has(id)) {
        loaded.push(id);
      } else {
        missingDefinitions.push(id);
      }
    }

    const notReferenced = [...this._loadedKeysounds].filter(id => !uniqueRefs.includes(id));

    return { missingDefinitions, failedLoads, loaded, notReferenced };
  }

  logDiagnostics(referencedKeysoundIds: string[]): void {
    const diagnosis = this.diagnoseKeysounds(referencedKeysoundIds);
    const definedIds = Object.keys(this.fileMap);
    const uniqueRefs = [...new Set(referencedKeysoundIds.map(id => id.toLowerCase()))];

    console.group('[KeysoundPlayer] Diagnostics');
    console.log(`Total WAV definitions: ${definedIds.length}`);
    console.log(`Total unique IDs referenced in notes: ${uniqueRefs.length}`);
    console.log(`Successfully loaded: ${diagnosis.loaded.length}`);

    if (definedIds.length > 0 || uniqueRefs.length > 0) {
      console.log('--- ID Comparison ---');
      console.log(`Sample WAV IDs: [${definedIds.slice(0, 15).join(', ')}]${definedIds.length > 15 ? '...' : ''}`);
      console.log(`Sample note IDs: [${uniqueRefs.slice(0, 15).join(', ')}]${uniqueRefs.length > 15 ? '...' : ''}`);
    }

    if (diagnosis.missingDefinitions.length > 0) {
      console.warn(`Missing WAV definitions: ${diagnosis.missingDefinitions.length}`);
      console.warn('IDs:', diagnosis.missingDefinitions.slice(0, 20).join(', '));
    }

    if (diagnosis.failedLoads.length > 0) {
      console.warn(`Failed to load: ${diagnosis.failedLoads.length}`);
      diagnosis.failedLoads.slice(0, 10).forEach(({ id, error }) => {
        console.warn(`  ${id}: ${error}`);
      });
    }

    if (diagnosis.notReferenced.length > 0) {
      console.log(`Loaded but unused: ${diagnosis.notReferenced.length}`);
    }

    console.groupEnd();
  }

  // ============ Effect Methods ============

  setEqualizerEnabled(enabled: boolean): void {
    if (this._preloader && this._isReady) this._preloader.setEqualizerEnabled(enabled);
  }

  setEqualizerBand(index: number, gain: number): void {
    if (this._preloader && this._isReady) this._preloader.setEqualizerBand(index, gain);
  }

  setEqualizerPreset(preset: string): void {
    if (this._preloader && this._isReady) this._preloader.setEqualizerPreset(preset);
  }

  getEqualizerBands(): number[] {
    if (this._preloader && this._isReady) return this._preloader.getEqualizerBands();
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }

  setCompressorEnabled(enabled: boolean): void {
    if (this._preloader && this._isReady) this._preloader.setCompressorEnabled(enabled);
  }

  setCompressorSettings(settings: { threshold?: number; ratio?: number; attack?: number; release?: number }): void {
    if (this._preloader && this._isReady) {
      this._preloader.setCompressorSettings(
        settings.threshold ?? -24, settings.ratio ?? 12, settings.attack ?? 0.003, settings.release ?? 0.25
      );
    }
  }

  setReverbEnabled(enabled: boolean): void {
    if (this._preloader && this._isReady) this._preloader.setReverbEnabled(enabled);
  }

  setReverbMix(mix: number): void {
    if (this._preloader && this._isReady) this._preloader.setReverbMix(mix);
  }

  setReverbDecay(decay: number): void {
    if (this._preloader && this._isReady) this._preloader.setReverbDecay(decay);
  }

  setStereoEnabled(enabled: boolean): void {
    if (this._preloader && this._isReady) this._preloader.setStereoEnabled(enabled);
  }

  setStereoWidth(width: number): void {
    if (this._preloader && this._isReady) this._preloader.setStereoWidth(width);
  }

  async resume(): Promise<void> {
    if (!this._preloader) return;
    const context = this._preloader.context;
    if (context && context.state === 'suspended') {
      await context.resume();
    }
  }

  dispose(): void {
    this.stopAll();

    if (this._contextStateHandler && this._preloader?.context) {
      this._preloader.context.removeEventListener('statechange', this._contextStateHandler);
      this._contextStateHandler = null;
    }

    if (this._preloader) {
      this._preloader.releaseAllResources();
      this._preloader = null;
      (this as { preloader: AudioPreloader | null }).preloader = null;
    }
    this._isReady = false;
    this._isRecovering = false;
  }

  /**
   * 내부 `AudioContext` 를 노출한다.
   *
   * `useGamePlayer` 등이 KeysoundPlayer 캡슐화를 깨는 cast (`as unknown as { preloader }`)
   * 없이 AudioContext 에 접근할 수 있게 하기 위한 인터페이스 메서드 (`types/KeysoundPlayer.ts`
   * 의 optional `getAudioContext`).
   */
  getAudioContext(): AudioContext | null {
    return this._preloader?.context ?? null;
  }

  getContextState(): AudioContextState | null {
    return this._preloader?.context?.state ?? null;
  }

  isContextReady(): boolean {
    return this.getContextState() === 'running';
  }

  getContextTime(): number {
    return this._preloader?.context?.currentTime ?? 0;
  }

  getPipelineLatency(): number | null {
    const ctx = this._preloader?.context;
    if (!ctx) return null;
    let total = ctx.baseLatency ?? 0;
    if ('outputLatency' in ctx) {
      total += (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    }
    return total * 1000;
  }

  getSchedulingOverhead(): number | null {
    if (this._playLatencies.length === 0) return null;
    const sum = this._playLatencies.reduce((a, b) => a + b, 0);
    return sum / this._playLatencies.length;
  }

  resetLatencySamples(): void {
    this._playLatencies = [];
  }
}

/**
 * 키사운드 플레이어를 생성하고 로드하는 헬퍼 함수
 */
export async function createKeysoundPlayer(
  options: KeysoundPlayerOptions
): Promise<KeysoundPlayer> {
  const player = new KeysoundPlayer(options);
  await player.init();
  await player.load();
  return player;
}
