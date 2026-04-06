/**
 * AudioPreloader.ts
 *
 *  - Worker = 오디오 파일 다운로드
 *  - 메인 스레드 = decodeAudioData & AudioWorklet 재생
 *  - 스테레오 지원, 동시 재생 지원
 *
 * @example
 * ```typescript
 * import { AudioPreloader, createAudioLoaderWorker, AudioProcessorWorkletUrl } from '@/lib/bms/audio';
 *
 * const worker = createAudioLoaderWorker();
 * const preloader = new AudioPreloader(baseUrl, fileMap, worker);
 * await preloader.loadAll();
 * await preloader.decodeAll();
 * await preloader.initAudioWorklet();
 * preloader.playAudio('key');
 * ```
 */
import { AudioProcessorWorkletUrl } from './AudioProcessor.worklet';
import { AudioProcessorPostMessage } from './types';
import { audioIndexedDBCache } from '../cache';

// IndexedDB 캐시 키 생성 헬퍼
function makeIndexedDBKey(baseUrl: string, filename: string): string {
    return `${baseUrl}/${filename}`;
}

export interface FileMap {
    [key: string]: string; // 예: { "kick": "kick.wav", "bgm": "bgm.ogg" }
}

// 10밴드 이퀄라이저 주파수 정의
export const EQ_FREQUENCIES = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

// 이퀄라이저 프리셋 정의
export const EQ_PRESETS: Record<string, number[]> = {
    'flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'bass-boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    'treble-boost': [0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
    'vocal': [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2],
    'electronic': [4, 3, 0, -2, -1, 0, 2, 4, 3, 4],
    'rock': [4, 3, 1, 0, -1, 0, 1, 3, 4, 3],
    'pop': [-1, 0, 2, 3, 2, 0, -1, 1, 2, 1],
    'jazz': [2, 1, 0, 1, -1, 0, 1, 2, 3, 2],
};

// 이펙터 설정 인터페이스
export interface EffectSettings {
    equalizer?: {
        enabled: boolean;
        bands: number[]; // 10개 밴드의 게인 값 (-12 ~ +12 dB)
    };
    compressor?: {
        enabled: boolean;
        threshold: number;
        ratio: number;
        attack: number;
        release: number;
    };
    reverb?: {
        enabled: boolean;
        mix: number;
        decay: number;
    };
    stereo?: {
        enabled: boolean;
        width: number;
    };
}

/**
 * Vite Worker 생성 함수
 * Vite에서는 `?worker` suffix로 Worker를 import해야 합니다.
 *
 * @example
 * ```typescript
 * // 사용하는 컴포넌트에서:
 * import AudioLoaderWorker from '@/lib/bms/audio/loader/AudioLoader.worker?worker';
 * const worker = new AudioLoaderWorker();
 * ```
 */
export type WorkerFactory = () => Worker;

// 글로벌 오디오 버퍼 캐시 (URL 기반)
const globalAudioBufferCache = new Map<string, AudioBuffer>();
const CACHE_MAX_SIZE = 500; // 최대 캐시 크기

function addToCache(key: string, buffer: AudioBuffer): void {
    // LRU 방식 캐시 - 가장 오래된 항목 제거
    if (globalAudioBufferCache.size >= CACHE_MAX_SIZE) {
        const firstKey = globalAudioBufferCache.keys().next().value;
        if (firstKey) globalAudioBufferCache.delete(firstKey);
    }
    globalAudioBufferCache.set(key, buffer);
}

function getFromCache(key: string): AudioBuffer | undefined {
    const buffer = globalAudioBufferCache.get(key);
    if (buffer) {
        // LRU: 최근 사용된 항목을 끝으로 이동
        globalAudioBufferCache.delete(key);
        globalAudioBufferCache.set(key, buffer);
    }
    return buffer;
}

export interface AudioPreloaderOptions {
    /** 파일 로드 중 점진적 디코딩 활성화 (기본: true) */
    progressiveDecode?: boolean;
    /** 간단한 이펙트 체인 사용 (EQ/Reverb 비활성화로 성능 향상) */
    simplifiedEffects?: boolean;
    /** 글로벌 메모리 캐시 사용 (기본: true) */
    useCache?: boolean;
    /** IndexedDB 영구 캐시 사용 (기본: true) */
    useIndexedDBCache?: boolean;
    /** AudioContext latencyHint (초 단위 또는 프리셋, 기본: 'interactive') */
    latencyHint?: AudioContextLatencyCategory | number;
}

export class AudioPreloader {
    private worker: Worker;
    private audioDataMap = new Map<string, ArrayBuffer>();
    private audioBuffers = new Map<string, AudioBuffer>();

    private loadingProgress = 0;
    private loadedCount = 0;
    private decodedCount = 0;
    private totalCount = 0;
    public isWorkerDone = false;

    private audioContext: AudioContext;
    private audioWorkletNode: AudioWorkletNode | null = null;

    // 성능 옵션
    private progressiveDecode: boolean;
    private simplifiedEffects: boolean;
    private useCache: boolean;
    private useIndexedDBCache: boolean;
    private cacheKeyPrefix: string;

    // 이펙트 노드들
    private equalizerNodes: BiquadFilterNode[] = [];
    private compressorNode: DynamicsCompressorNode | null = null;
    private reverbConvolverNode: ConvolverNode | null = null;
    private reverbDryGain: GainNode | null = null;
    private reverbWetGain: GainNode | null = null;
    private reverbMixerNode: GainNode | null = null;
    private stereoEnhancerNode: StereoPannerNode | null = null;
    private masterGainNode: GainNode | null = null;

    // 이펙트 상태
    private equalizerEnabled = false;
    private compressorEnabled = false;
    private reverbEnabled = false;
    private _stereoEnabled = false;

    // 리버브 임펄스 응답 캐시 (decay 값별로 캐싱)
    private impulseCache = new Map<number, AudioBuffer>();
    private currentReverbDecay = 1.5; // 현재 적용된 decay 값

    // 동시 재생을 위한 트랙 ID 카운터
    private trackIdCounter = 0;

    // 디버깅용: 이미 경고한 누락 키 추적
    private _warnedMissingKeys?: Set<string>;

    // abort() 지원
    private aborted = false;
    private _abortResolve: (() => void) | undefined;

    /**
     * AudioPreloader 생성자
     * @param baseUrl - 오디오 파일이 위치한 기본 URL
     * @param fileMap - 키음 ID와 파일 이름의 매핑
     * @param worker - AudioLoader Worker 인스턴스 (Vite에서 `?worker`로 import 후 생성)
     * @param onWorkerMessage - Worker 메시지 콜백 (옵션)
     * @param options - 성능 옵션
     */
    constructor(
        private baseUrl: string,
        private fileMap: FileMap,
        worker: Worker,
        private onWorkerMessage?: (type: string, payload: unknown) => void,
        options?: AudioPreloaderOptions,
    ) {
        // 성능 옵션 설정
        this.progressiveDecode = options?.progressiveDecode ?? true;
        this.simplifiedEffects = options?.simplifiedEffects ?? false;
        this.useCache = options?.useCache ?? true;
        this.useIndexedDBCache = options?.useIndexedDBCache ?? true;
        this.cacheKeyPrefix = baseUrl; // 캐시 키 prefix로 baseUrl 사용

        this.audioContext = new AudioContext({
            latencyHint: options?.latencyHint ?? 'interactive',
        });
        this.worker = worker;
        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (this.onWorkerMessage) {
                this.onWorkerMessage(type, payload);
            }
            switch (type) {
                case 'PROGRESS':
                    this.loadingProgress = payload.loadedCount / payload.total;
                    this.loadedCount = payload.loadedCount;
                    this.totalCount = payload.total;
                    break;
                case 'LOADED':
                    this.audioDataMap.set(payload.key, payload.arrayBuffer);
                    // IndexedDB에 캐시 저장 (비동기, 에러 무시)
                    // decodeAudioData가 원본 buffer를 detach하므로 IDB에는 복사본 저장
                    if (this.useIndexedDBCache) {
                        const idbKey = makeIndexedDBKey(this.baseUrl, this.fileMap[payload.key] || payload.key);
                        audioIndexedDBCache.set(idbKey, payload.arrayBuffer.slice(0)).catch(() => {});
                    }
                    // 점진적 디코딩: 파일이 로드되면 즉시 디코딩 시작
                    if (this.progressiveDecode) {
                        this.decodeOne(payload.key, payload.arrayBuffer);
                    }
                    break;
                case 'DONE':
                    this.isWorkerDone = true;
                    break;
                case 'ERROR':
                    console.error(`[Error] key=${payload.key}, file=${payload.fileName}, msg=${payload.message}`);
                    break;
            }
        };
    }

    /**
     * 단일 오디오 파일 디코딩 (점진적 디코딩용)
     */
    private async decodeOne(key: string, arrayBuffer: ArrayBuffer): Promise<void> {
        if (this.aborted) return;
        // 이미 디코딩되었거나 캐시에 있으면 스킵
        if (this.audioBuffers.has(key)) return;

        // detach된 ArrayBuffer는 스킵 (decodeAudioData가 buffer를 소비한 경우)
        if (arrayBuffer.byteLength === 0) {
            const silent = this.audioContext.createBuffer(
                1,
                this.audioContext.sampleRate,
                this.audioContext.sampleRate,
            );
            this.audioBuffers.set(key, silent);
            this.decodedCount++;
            return;
        }

        // 글로벌 캐시 확인
        const cacheKey = `${this.cacheKeyPrefix}:${key}`;
        if (this.useCache) {
            const cached = getFromCache(cacheKey);
            if (cached) {
                this.audioBuffers.set(key, cached);
                this.decodedCount++;
                return;
            }
        }

        try {
            const audioBuf = await this.audioContext.decodeAudioData(arrayBuffer);
            if (this.aborted) return;
            this.audioBuffers.set(key, audioBuf);
            this.decodedCount++;

            // 글로벌 캐시에 저장
            if (this.useCache) {
                addToCache(cacheKey, audioBuf);
            }
        } catch (err: unknown) {
            if (this.aborted) return;
            console.error(`[Decode fail] key=${key}`, err);
            // 실패 시 무음 버퍼 생성
            const silent = this.audioContext.createBuffer(
                1,
                this.audioContext.sampleRate,
                this.audioContext.sampleRate,
            );
            this.audioBuffers.set(key, silent);
            this.decodedCount++;
        }
    }

    public async loadAll(): Promise<void> {
        const allKeys = Object.keys(this.fileMap);
        const fileCount = allKeys.length;
        if (fileCount === 0) {
            this.isWorkerDone = true;
            return;
        }

        // IndexedDB 캐시에서 먼저 확인
        let uncachedFileMap: FileMap = this.fileMap;
        let cachedCount = 0;

        if (this.useIndexedDBCache) {
            try {
                // 캐시 키 목록 생성
                const cacheKeys = allKeys.map(key => makeIndexedDBKey(this.baseUrl, this.fileMap[key]));

                // IndexedDB에서 배치로 조회
                const cachedData = await audioIndexedDBCache.getMany(cacheKeys);

                if (cachedData.size > 0) {
                    uncachedFileMap = {};

                    for (const key of allKeys) {
                        const idbKey = makeIndexedDBKey(this.baseUrl, this.fileMap[key]);
                        const cached = cachedData.get(idbKey);

                        if (cached) {
                            // 캐시 히트: audioDataMap에 저장하고 디코딩 시작
                            // decodeAudioData가 buffer를 detach하므로 각 키마다 복사본 사용
                            const buffer = cached.slice(0);
                            this.audioDataMap.set(key, buffer);
                            cachedCount++;

                            if (this.progressiveDecode) {
                                this.decodeOne(key, buffer);
                            }

                            // 캐시 히트에 대해서도 LOADED 메시지 전송 (KeysoundPlayer 추적용)
                            if (this.onWorkerMessage) {
                                this.onWorkerMessage('LOADED', { key, arrayBuffer: cached });
                            }
                        } else {
                            // 캐시 미스: Worker에서 fetch 필요
                            uncachedFileMap[key] = this.fileMap[key];
                        }
                    }

                    console.log(`[AudioPreloader] IndexedDB cache hit: ${cachedCount}/${fileCount}`);
                }
            } catch (err: unknown) {
                console.warn('[AudioPreloader] IndexedDB cache check failed:', err);
                uncachedFileMap = this.fileMap;
            }
        }

        // 모든 파일이 캐시에 있으면 Worker 요청 스킵
        const uncachedCount = Object.keys(uncachedFileMap).length;
        if (uncachedCount === 0) {
            this.loadedCount = fileCount;
            this.totalCount = fileCount;
            this.loadingProgress = 1;
            this.isWorkerDone = true;

            // onWorkerMessage 콜백 호출 (진행 상황 알림)
            if (this.onWorkerMessage) {
                this.onWorkerMessage('PROGRESS', { loadedCount: fileCount, total: fileCount });
            }
            return;
        }

        // 캐시된 항목 수 반영
        this.loadedCount = cachedCount;
        this.totalCount = fileCount;

        return new Promise<void>((resolve) => {
            const cleanup = () => {
                this.worker.removeEventListener('message', onMessage);
                this._abortResolve = undefined;
                resolve();
            };

            // abort() 호출 시 즉시 resolve할 수 있도록 저장
            this._abortResolve = cleanup;

            this.worker.postMessage({
                type: 'LOAD_AUDIO',
                payload: { baseUrl: this.baseUrl, fileMap: uncachedFileMap },
            });

            const onMessage = (e: MessageEvent) => {
                const { type, payload } = e.data;
                // PROGRESS 이벤트에서 캐시된 항목 수 더하기
                if (type === 'PROGRESS') {
                    this.loadedCount = cachedCount + payload.loadedCount;
                    this.loadingProgress = this.loadedCount / this.totalCount;
                }
                // 개별 파일 에러는 무시하고 DONE까지 기다림 (일부 키사운드가 없을 수 있음)
                if (type === 'DONE') {
                    cleanup();
                }
                // ERROR는 constructor의 onmessage 핸들러에서 로깅됨
            };
            this.worker.addEventListener('message', onMessage);
        });
    }

    public async decodeAll(): Promise<void> {
        if (this.aborted) return;

        // 점진적 디코딩이 활성화된 경우, 대부분의 파일이 이미 디코딩되었을 수 있음
        const promises: Promise<void>[] = [];
        for (const [key, arrayBuf] of this.audioDataMap.entries()) {
            if (this.audioBuffers.has(key)) continue;

            // detach된 buffer 스킵
            if (arrayBuf.byteLength === 0) {
                this.audioBuffers.set(key, this.audioContext.createBuffer(1, this.audioContext.sampleRate, this.audioContext.sampleRate));
                this.decodedCount++;
                continue;
            }

            // 글로벌 캐시 확인
            const cacheKey = `${this.cacheKeyPrefix}:${key}`;
            if (this.useCache) {
                const cached = getFromCache(cacheKey);
                if (cached) {
                    this.audioBuffers.set(key, cached);
                    this.decodedCount++;
                    continue;
                }
            }

            const p = this.audioContext
                .decodeAudioData(arrayBuf)
                .then((audioBuf) => {
                    if (this.aborted) return; // abort 후 결과 저장 스킵
                    this.audioBuffers.set(key, audioBuf);
                    this.decodedCount++;
                    // 캐시에 저장
                    if (this.useCache) {
                        addToCache(cacheKey, audioBuf);
                    }
                })
                .catch((err: unknown) => {
                    if (this.aborted) return;
                    console.error(`[Decode fail] key=${key}`, err);
                    // 실패 시 무음
                    this.audioBuffers.set(key, this.audioContext.createBuffer(1, this.audioContext.sampleRate, this.audioContext.sampleRate));
                    this.decodedCount++;
                });
            promises.push(p);
        }

        // abort() 호출 시 Promise.all을 기다리지 않고 즉시 반환
        const abortPromise = new Promise<void>((resolve) => {
            this._abortResolve = resolve;
        });
        await Promise.race([Promise.all(promises), abortPromise]);
        this._abortResolve = undefined;
    }

    /**
     * 파일 로드, 디코딩, AudioWorklet 초기화를 병렬로 수행
     * 성능 최적화를 위해 loadAll() + decodeAll() + initAudioWorklet() 대신 사용
     */
    public async loadAndInitParallel(workletUrl?: string, effectSettings?: EffectSettings): Promise<void> {
        // AudioWorklet 초기화와 파일 로드를 병렬로 시작
        const initPromise = this.initAudioWorklet(workletUrl, effectSettings);
        const loadPromise = this.loadAll();

        // 두 작업 모두 완료 대기
        await Promise.all([initPromise, loadPromise]);

        // 점진적 디코딩이 비활성화된 경우에만 일괄 디코딩
        if (!this.progressiveDecode) {
            await this.decodeAll();
        } else {
            // 점진적 디코딩 중이더라도 아직 디코딩되지 않은 파일 처리
            await this.waitForDecoding();
        }
    }

    /**
     * 점진적 디코딩 완료 대기
     */
    private async waitForDecoding(): Promise<void> {
        const startTime = Date.now();
        const timeout = 30000; // 30초 타임아웃

        while (this.decodedCount < this.audioDataMap.size) {
            if (Date.now() - startTime > timeout) {
                console.warn(`[AudioPreloader] Decoding timeout: ${this.decodedCount}/${this.audioDataMap.size}`);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    /**
     * AudioWorklet 초기화 (이펙트 체인 포함)
     * @param workletUrl - AudioWorklet 모듈 URL (기본값: AudioProcessorWorkletUrl)
     * @param effectSettings - 초기 이펙트 설정 (옵션)
     */
    public async initAudioWorklet(workletUrl?: string, effectSettings?: EffectSettings) {
        const url = workletUrl ?? AudioProcessorWorkletUrl;
        await this.audioContext.audioWorklet.addModule(url);
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-worklet-processor');

        if (this.simplifiedEffects) {
            // 간소화된 이펙트 체인: AudioWorklet → MasterGain → Destination
            this.createSimplifiedEffectChain();
        } else {
            // 전체 이펙트 체인 생성
            this.createEffectChain();

            // 노드 연결: AudioWorklet → EQ → Compressor → Reverb → Stereo → MasterGain → Destination
            this.connectEffectChain();

            // 초기 이펙트 설정 적용
            if (effectSettings) {
                this.applyEffectSettings(effectSettings);
            }
        }

        this.audioWorkletNode.port.onmessage = (event) => {
            const { type, key, data } = event.data;
            if (type === 'latencyReport') {
                console.log(`[Latency Report] Track=${key}, Latency=${data?.latency ?? 'Unknown'}`);
            }
        };
    }

    /**
     * 간소화된 이펙트 체인 생성 (성능 최적화)
     * AudioWorklet → MasterGain → Destination 만 연결
     */
    private createSimplifiedEffectChain(): void {
        if (!this.audioWorkletNode) return;

        // 마스터 게인만 생성
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.gain.value = 1;

        // 직접 연결: AudioWorklet → MasterGain → Destination
        this.audioWorkletNode.connect(this.masterGainNode);
        this.masterGainNode.connect(this.audioContext.destination);
    }

    /**
     * 이펙트 체인 노드 생성
     */
    private createEffectChain(): void {
        const ctx = this.audioContext;

        // 1. 10밴드 이퀄라이저 생성
        this.equalizerNodes = EQ_FREQUENCIES.map((freq, index) => {
            const filter = ctx.createBiquadFilter();
            // 첫 번째는 lowshelf, 마지막은 highshelf, 나머지는 peaking
            if (index === 0) {
                filter.type = 'lowshelf';
            } else if (index === EQ_FREQUENCIES.length - 1) {
                filter.type = 'highshelf';
            } else {
                filter.type = 'peaking';
                filter.Q.value = 1.4; // Q 팩터
            }
            filter.frequency.value = freq;
            filter.gain.value = 0; // 기본값: 플랫
            return filter;
        });

        // 2. 다이나믹 컴프레서 생성
        this.compressorNode = ctx.createDynamicsCompressor();
        this.compressorNode.threshold.value = -24;
        this.compressorNode.ratio.value = 4;
        this.compressorNode.attack.value = 0.003;
        this.compressorNode.release.value = 0.25;

        // 3. 리버브 (ConvolverNode + Dry/Wet 믹서)
        this.reverbConvolverNode = ctx.createConvolver();
        this.reverbDryGain = ctx.createGain();
        this.reverbWetGain = ctx.createGain();
        this.reverbMixerNode = ctx.createGain();
        this.reverbDryGain.gain.value = 1;
        this.reverbWetGain.gain.value = 0;

        // 기본 임펄스 응답 생성 (간단한 리버브)
        this.createDefaultImpulseResponse(1.5);

        // 4. 스테레오 확장
        this.stereoEnhancerNode = ctx.createStereoPanner();
        this.stereoEnhancerNode.pan.value = 0;

        // 5. 마스터 게인
        this.masterGainNode = ctx.createGain();
        this.masterGainNode.gain.value = 1;
    }

    /**
     * 기본 임펄스 응답 생성 (알고리즘 기반 리버브)
     * 캐시된 임펄스가 있으면 재사용, 없으면 새로 생성하여 캐시
     */
    private createDefaultImpulseResponse(decay: number): void {
        // 이미 같은 decay로 적용되어 있으면 스킵
        if (decay === this.currentReverbDecay && this.reverbConvolverNode?.buffer) {
            return;
        }

        // 캐시에서 확인
        let impulse = this.impulseCache.get(decay);

        if (!impulse) {
            // 캐시에 없으면 새로 생성
            const ctx = this.audioContext;
            const sampleRate = ctx.sampleRate;
            const length = Math.floor(sampleRate * decay);
            impulse = ctx.createBuffer(2, length, sampleRate);

            for (let channel = 0; channel < 2; channel++) {
                const channelData = impulse.getChannelData(channel);
                for (let i = 0; i < length; i++) {
                    // 지수 감쇠 + 노이즈
                    channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
                }
            }

            // 캐시에 저장 (최대 5개까지만 유지)
            if (this.impulseCache.size >= 5) {
                const firstKey = this.impulseCache.keys().next().value;
                if (firstKey !== undefined) {
                    this.impulseCache.delete(firstKey);
                }
            }
            this.impulseCache.set(decay, impulse);
        }

        if (this.reverbConvolverNode) {
            this.reverbConvolverNode.buffer = impulse;
            this.currentReverbDecay = decay;
        }
    }

    /**
     * 이펙트 체인 연결
     */
    private connectEffectChain(): void {
        if (!this.audioWorkletNode || !this.masterGainNode) return;

        // 기존 연결 해제
        this.audioWorkletNode.disconnect();

        let currentNode: AudioNode = this.audioWorkletNode;

        // 이퀄라이저 연결 (항상 연결, bypass는 gain=0으로)
        for (const eqNode of this.equalizerNodes) {
            currentNode.connect(eqNode);
            currentNode = eqNode;
        }

        // 컴프레서 연결
        if (this.compressorNode) {
            currentNode.connect(this.compressorNode);
            currentNode = this.compressorNode;
        }

        // 리버브 연결 (Dry/Wet 믹스)
        if (this.reverbDryGain && this.reverbWetGain && this.reverbConvolverNode && this.reverbMixerNode) {
            // Dry 경로
            currentNode.connect(this.reverbDryGain);
            this.reverbDryGain.connect(this.reverbMixerNode);

            // Wet 경로 (Convolver를 통해)
            currentNode.connect(this.reverbConvolverNode);
            this.reverbConvolverNode.connect(this.reverbWetGain);
            this.reverbWetGain.connect(this.reverbMixerNode);

            currentNode = this.reverbMixerNode;
        }

        // 스테레오 확장 연결
        if (this.stereoEnhancerNode) {
            currentNode.connect(this.stereoEnhancerNode);
            currentNode = this.stereoEnhancerNode;
        }

        // 마스터 게인 → 출력
        currentNode.connect(this.masterGainNode);
        this.masterGainNode.connect(this.audioContext.destination);
    }

    /**
     * 이펙트 설정 일괄 적용
     */
    public applyEffectSettings(settings: EffectSettings): void {
        if (settings.equalizer) {
            this.setEqualizerEnabled(settings.equalizer.enabled);
            if (settings.equalizer.bands) {
                settings.equalizer.bands.forEach((gain, index) => {
                    this.setEqualizerBand(index, gain);
                });
            }
        }

        if (settings.compressor) {
            this.setCompressorEnabled(settings.compressor.enabled);
            this.setCompressorSettings(
                settings.compressor.threshold,
                settings.compressor.ratio,
                settings.compressor.attack,
                settings.compressor.release
            );
        }

        if (settings.reverb) {
            this.setReverbEnabled(settings.reverb.enabled);
            this.setReverbMix(settings.reverb.mix);
            this.setReverbDecay(settings.reverb.decay);
        }

        if (settings.stereo) {
            this.setStereoEnabled(settings.stereo.enabled);
            this.setStereoWidth(settings.stereo.width);
        }
    }

    // ==================== 이퀄라이저 메서드 ====================

    /**
     * 이퀄라이저 활성화/비활성화
     */
    public setEqualizerEnabled(enabled: boolean): void {
        this.equalizerEnabled = enabled;
        // 비활성화 시 모든 밴드 게인을 0으로
        if (!enabled) {
            this.equalizerNodes.forEach(node => {
                node.gain.value = 0;
            });
        }
    }

    /**
     * 개별 이퀄라이저 밴드 설정
     * @param bandIndex - 밴드 인덱스 (0-9)
     * @param gain - 게인 값 (-12 ~ +12 dB)
     */
    public setEqualizerBand(bandIndex: number, gain: number): void {
        if (bandIndex < 0 || bandIndex >= this.equalizerNodes.length) return;
        const clampedGain = Math.max(-12, Math.min(12, gain));
        this.equalizerNodes[bandIndex].gain.value = this.equalizerEnabled ? clampedGain : 0;
    }

    /**
     * 이퀄라이저 프리셋 적용
     */
    public setEqualizerPreset(preset: string): void {
        const gains = EQ_PRESETS[preset];
        if (!gains) return;
        gains.forEach((gain, index) => {
            this.setEqualizerBand(index, gain);
        });
    }

    /**
     * 모든 이퀄라이저 밴드 값 가져오기
     */
    public getEqualizerBands(): number[] {
        return this.equalizerNodes.map(node => node.gain.value);
    }

    // ==================== 컴프레서 메서드 ====================

    /**
     * 컴프레서 활성화/비활성화
     */
    public setCompressorEnabled(enabled: boolean): void {
        this.compressorEnabled = enabled;
        if (this.compressorNode) {
            // 비활성화 시 ratio를 1로 설정 (압축 없음)
            this.compressorNode.ratio.value = enabled ? 4 : 1;
        }
    }

    /**
     * 컴프레서 설정
     */
    public setCompressorSettings(threshold: number, ratio: number, attack: number, release: number): void {
        if (!this.compressorNode) return;
        this.compressorNode.threshold.value = Math.max(-100, Math.min(0, threshold));
        this.compressorNode.ratio.value = this.compressorEnabled ? Math.max(1, Math.min(20, ratio)) : 1;
        this.compressorNode.attack.value = Math.max(0, Math.min(1, attack));
        this.compressorNode.release.value = Math.max(0, Math.min(1, release));
    }

    // ==================== 리버브 메서드 ====================

    /**
     * 리버브 활성화/비활성화
     */
    public setReverbEnabled(enabled: boolean): void {
        this.reverbEnabled = enabled;
        if (this.reverbDryGain && this.reverbWetGain) {
            // 비활성화 시 wet을 0으로
            this.reverbWetGain.gain.value = enabled ? this.reverbWetGain.gain.value || 0.3 : 0;
            this.reverbDryGain.gain.value = enabled ? 1 - this.reverbWetGain.gain.value : 1;
        }
    }

    /**
     * 리버브 믹스 설정 (0-1, 0=dry, 1=wet)
     */
    public setReverbMix(mix: number): void {
        if (!this.reverbDryGain || !this.reverbWetGain) return;
        const clampedMix = Math.max(0, Math.min(1, mix));
        if (this.reverbEnabled) {
            this.reverbWetGain.gain.value = clampedMix;
            this.reverbDryGain.gain.value = 1 - clampedMix;
        }
    }

    /**
     * 리버브 감쇠 시간 설정
     */
    public setReverbDecay(decay: number): void {
        const clampedDecay = Math.max(0.1, Math.min(10, decay));
        this.createDefaultImpulseResponse(clampedDecay);
    }

    // ==================== 스테레오 메서드 ====================

    /**
     * 스테레오 확장 활성화/비활성화
     */
    public setStereoEnabled(enabled: boolean): void {
        this._stereoEnabled = enabled;
        // 비활성화 시 pan을 0으로 (중앙)
        if (this.stereoEnhancerNode) {
            this.stereoEnhancerNode.pan.value = 0;
        }
    }

    /**
     * 스테레오 폭 설정 (0-2, 0=mono, 1=normal, 2=wide)
     * 참고: StereoPannerNode는 간단한 패닝만 지원하므로
     * 실제 스테레오 확장은 추후 ChannelSplitter/Merger로 구현 가능
     */
    public setStereoWidth(_width: number): void {
        // 현재는 StereoPannerNode의 pan 값으로 간단히 처리
        // width > 1이면 살짝 확장 효과 (실제로는 M/S 처리 필요)
        if (!this.stereoEnhancerNode) return;
        // 이 구현은 placeholder - 실제 스테레오 확장은 더 복잡함
        // 일단 pan 값을 0으로 유지 (스테레오 소스 그대로)
        this.stereoEnhancerNode.pan.value = 0;
    }

    /**
     * 오디오 재생 (스테레오 지원, 동시 재생 지원, offset 지원)
     * @param key - 오디오 버퍼 키
     * @param loop - 루프 여부
     * @param uniquePlay - true면 동일 key로 여러 번 재생 시 각각 별도로 재생됨
     * @param offset - 재생 시작 위치 (초 단위, 기본: 0)
     * @returns 트랙 ID (나중에 stopAudio로 정지할 때 사용)
     */
    public async playAudio(key: string, loop = false, uniquePlay = true, offset = 0): Promise<string | null> {
        if (!this.audioWorkletNode) {
            console.error('AudioWorkletNode not initialized.');
            return null;
        }
        const audioBuffer = this.audioBuffers.get(key);
        if (!audioBuffer) {
            console.warn(`No AudioBuffer for key=${key}`);
            return null;
        }

        // offset이 오디오 길이를 초과하면 재생하지 않음
        if (offset >= audioBuffer.duration) {
            return null;
        }

        // AudioContext가 suspended 상태면 resume 완료까지 대기
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // 스테레오 데이터 추출 (Transferable Objects 사용을 위해 복사)
        const leftData = audioBuffer.getChannelData(0).slice(0);
        const isStereo = audioBuffer.numberOfChannels > 1;
        const rightData = isStereo
            ? audioBuffer.getChannelData(1).slice(0)
            : leftData; // 모노면 left 데이터 재사용

        // 동시 재생을 위한 고유 트랙 ID 생성
        const trackId = uniquePlay ? `${key}_${this.trackIdCounter++}` : key;

        // Transferable Objects로 전송 (복사 없이 소유권 이전)
        const transferList: ArrayBuffer[] = isStereo
            ? [leftData.buffer, rightData.buffer]
            : [leftData.buffer]; // 모노면 하나만 전송

        this.postTypedMessage<AudioProcessorPostMessage>(
            {
                type: 'play',
                key: trackId,
                data: { bufferLeft: leftData, bufferRight: rightData, loop, offset },
            },
            { transfer: transferList }
        );

        return trackId;
    }

    /**
     * 동기 버전의 playAudio (기존 코드 호환성)
     * AudioContext resume을 기다리지 않음
     * @param offset - 재생 시작 위치 (초 단위, 기본: 0)
     */
    public playAudioSync(key: string, loop = false, uniquePlay = true, offset = 0, scheduledTime = 0, volume = 1): string | null {
        if (!this.audioWorkletNode) {
            console.warn('[AudioPreloader] playAudioSync: AudioWorkletNode not initialized');
            return null;
        }
        const audioBuffer = this.audioBuffers.get(key);
        if (!audioBuffer) {
            // 디버깅용: 버퍼가 없으면 처음 5개 키만 로그
            if (this.audioBuffers.size > 0 && !this._warnedMissingKeys?.has(key)) {
                if (!this._warnedMissingKeys) this._warnedMissingKeys = new Set();
                if (this._warnedMissingKeys.size < 10) {
                    this._warnedMissingKeys.add(key);
                    console.warn(`[AudioPreloader] No buffer for key: "${key}"`);
                }
            }
            return null;
        }

        // offset이 오디오 길이를 초과하면 재생하지 않음
        if (offset >= audioBuffer.duration) {
            return null;
        }

        // AudioContext가 suspended 상태면 resume (비동기지만 기다리지 않음)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // 스테레오 데이터 추출 (Transferable Objects 사용을 위해 복사)
        const leftData = audioBuffer.getChannelData(0).slice(0);
        const isStereo = audioBuffer.numberOfChannels > 1;
        const rightData = isStereo
            ? audioBuffer.getChannelData(1).slice(0)
            : leftData;

        const trackId = uniquePlay ? `${key}_${this.trackIdCounter++}` : key;

        // Transferable Objects로 전송 (복사 없이 소유권 이전)
        const transferList: ArrayBuffer[] = isStereo
            ? [leftData.buffer, rightData.buffer]
            : [leftData.buffer];

        this.postTypedMessage<AudioProcessorPostMessage>(
            {
                type: 'play',
                key: trackId,
                data: { bufferLeft: leftData, bufferRight: rightData, loop, offset, scheduledTime, volume },
            },
            { transfer: transferList }
        );

        return trackId;
    }

    /**
     * 특정 트랙 정지
     * @param trackId - playAudio에서 반환된 트랙 ID 또는 원본 key
     */
    public stopAudio(trackId: string) {
        this.postTypedMessage({ type: 'stop', key: trackId, data: null });
    }

    /**
     * 모든 트랙 정지
     */
    public stopAllAudio() {
        this.postTypedMessage({ type: 'stopAll', key: '', data: null });
    }

    /**
     * 특정 트랙 메모리 해제
     */
    public clearAudio(trackId: string) {
        this.postTypedMessage({ type: 'clear', key: trackId, data: null });
    }

    /**
     * 모든 트랙 메모리 해제
     */
    public clearAllAudio() {
        this.postTypedMessage({ type: 'clearAll', key: '', data: null });
    }

    /**
     * 마스터 볼륨 설정 (0-1)
     */
    public setMasterVolume(volume: number) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.postTypedMessage({ type: 'setVolume', key: '', data: clampedVolume });
    }

    /**
     * 트랙별 볼륨 조절 (0-1)
     */
    public adjustVolume(trackId: string, volume: number) {
        const clampedVolume = Math.max(0, Math.min(1, volume));
        this.postTypedMessage({ type: 'adjustVolume', key: trackId, data: clampedVolume });
    }

    /**
     * 재생 속도 설정 (0.25 ~ 4.0)
     * 모든 트랙에 적용되며, 선형 보간을 사용하여 부드러운 피치 변화 제공
     */
    public setPlaybackRate(rate: number) {
        const clampedRate = Math.max(0.25, Math.min(4.0, rate));
        this.postTypedMessage({ type: 'setPlaybackRate', key: '', data: clampedRate });
    }

    private postTypedMessage<T>(message: T, options?: StructuredSerializeOptions): void {
        if (!this.audioWorkletNode) {
            console.error('AudioWorkletNode not initialized.');
            return;
        }
        this.audioWorkletNode.port.postMessage(message, options);
    }

    /**
     * 특정 키의 오디오 버퍼 duration 조회 (초 단위)
     * @returns duration (초) 또는 버퍼가 없으면 0
     */
    public getAudioDuration(key: string): number {
        const buffer = this.audioBuffers.get(key);
        return buffer?.duration ?? 0;
    }

    /**
     * 오디오 버퍼가 존재하는지 확인
     */
    public hasAudioBuffer(key: string): boolean {
        return this.audioBuffers.has(key);
    }

    /**
     * 키음의 파형 데이터를 다운샘플링하여 반환 (파형 표시용)
     * @param key 키음 ID (lowercase)
     * @param samplesPerBeat 비트당 샘플 수 (기본 32)
     * @param bpm BPM (시간→비트 변환용)
     * @returns Float32Array of amplitude values (0~1), or null
     */
    public getWaveformData(key: string, samplesPerBeat: number = 32, bpm: number = 130): Float32Array | null {
        const buffer = this.audioBuffers.get(key);
        if (!buffer) return null;
        const channelData = buffer.getChannelData(0); // mono or left channel
        const durationSec = buffer.duration;
        const durationBeats = (durationSec * bpm) / 60;
        const totalSamples = Math.ceil(durationBeats * samplesPerBeat);
        if (totalSamples <= 0) return null;
        const result = new Float32Array(totalSamples);
        const samplesPerChunk = Math.floor(channelData.length / totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            const start = i * samplesPerChunk;
            const end = Math.min(start + samplesPerChunk, channelData.length);
            let maxAmp = 0;
            for (let j = start; j < end; j++) {
                const abs = Math.abs(channelData[j]);
                if (abs > maxAmp) maxAmp = abs;
            }
            result[i] = maxAmp;
        }
        return result;
    }

    /**
     * 진행 중인 loadAll() 또는 decodeAll()을 즉시 중단합니다.
     * 이미 시작된 디코딩 Promise는 완료되지만 결과를 저장하지 않습니다.
     * releaseAllResources() 호출 전에 abort()를 먼저 호출하면 고아 Promise를 최소화합니다.
     */
    public abort(): void {
        this.aborted = true;
        this._abortResolve?.();
        this._abortResolve = undefined;
    }

    public releaseAllResources(): void {
        // 워클렛에 정지/해제 메시지를 먼저 전송 (트랙 데이터 잔존 방지)
        try {
            this.stopAllAudio();
            this.clearAllAudio();
        } catch {
            // 이미 닫힌 포트 등 무시
        }

        this.worker.terminate();
        this.audioDataMap.clear();
        this.audioBuffers.clear();

        // 글로벌 캐시에서 이 인스턴스의 baseUrl에 해당하는 항목 제거
        if (this.useCache) {
            const prefix = `${this.cacheKeyPrefix}:`;
            for (const key of globalAudioBufferCache.keys()) {
                if (key.startsWith(prefix)) {
                    globalAudioBufferCache.delete(key);
                }
            }
        }

        // 이펙트 노드 disconnect (메모리 누수 방지)
        try {
            this.equalizerNodes.forEach((node) => node.disconnect());
            this.equalizerNodes = [];
            this.compressorNode?.disconnect();
            this.compressorNode = null;
            this.reverbConvolverNode?.disconnect();
            this.reverbConvolverNode = null;
            this.stereoEnhancerNode?.disconnect();
            this.stereoEnhancerNode = null;
            this.masterGainNode?.disconnect();
            this.masterGainNode = null;
            this.audioWorkletNode?.disconnect();
            this.audioWorkletNode = null;
        } catch {
            // disconnect 실패는 무시 (이미 닫힌 컨텍스트 등)
        }

        if (this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
    }

    public get progress() {
        return this.loadingProgress;
    }
    public get downloadedCount() {
        return this.loadedCount;
    }
    public get downloadedTotal() {
        return this.totalCount;
    }
    public get loaded() {
        return this.isWorkerDone;
    }
    public get context() {
        return this.audioContext;
    }
    public get stereoEnabled() {
        return this._stereoEnabled;
    }
}
