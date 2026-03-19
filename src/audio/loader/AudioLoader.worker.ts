/**
 * AudioLoader.worker.ts
 *
 * 오디오 파일을 병렬로 fetch한 뒤 ArrayBuffer를 메인 스레드로 보내는 Worker
 * Vite에서는 `?worker` suffix로 import하여 사용합니다.
 *
 * @example
 * ```typescript
 * import AudioLoaderWorker from './AudioLoader.worker?worker';
 * const worker = new AudioLoaderWorker();
 * ```
 */

interface FileMap {
    [key: string]: string;
}

// 브라우저 동시 연결 제한 (대부분 6개)
const CONCURRENT_LIMIT = 6;

// 배치 간 딜레이 (ms) - 서버 부하 분산
const BATCH_DELAY_MS = 50;

// 429 재시도 설정
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 5000;

// 딜레이 유틸리티
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Build URL with query parameter for files with special characters to avoid reverse proxy issues
function buildAudioUrl(baseUrl: string, fileName: string): string {
    const hasSpecialChars = /[#[\]%]/.test(fileName);
    if (hasSpecialChars) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}path=${encodeURIComponent(fileName)}`;
    }
    const encodedFileName = fileName.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `${baseUrl}/${encodedFileName}`;
}

// 파일 로드 함수: 429 에러 시 지수 백오프로 재시도, 실패 시 확장자 변경 후 재요청
async function loadAudioFile(baseUrl: string, key: string, fileName: string): Promise<ArrayBuffer> {
    const tryFetchWithRetry = async (url: string): Promise<Response> => {
        let lastError: Error | null = null;
        let retryDelay = INITIAL_RETRY_DELAY_MS;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await fetch(url, { cache: 'force-cache' });

                if (response.status === 429) {
                    // Rate limited - retry with exponential backoff
                    if (attempt < MAX_RETRIES) {
                        const jitter = Math.random() * 100;
                        const waitTime = Math.min(retryDelay + jitter, MAX_RETRY_DELAY_MS);
                        console.log(`[Worker] Rate limited (429) for key=${key}, retrying in ${Math.round(waitTime)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                        await delay(waitTime);
                        retryDelay *= 2; // Exponential backoff
                        continue;
                    }
                    throw new Error(`HTTP error 429 - Rate limited after ${MAX_RETRIES} retries`);
                }

                if (!response.ok) {
                    throw new Error(`HTTP error ${response.status}`);
                }

                return response;
            } catch (error: unknown) {
                lastError = error instanceof Error ? error : new Error(String(error));

                // Network errors also get retried with backoff
                if (attempt < MAX_RETRIES && !lastError.message.includes('HTTP error 4')) {
                    const jitter = Math.random() * 100;
                    const waitTime = Math.min(retryDelay + jitter, MAX_RETRY_DELAY_MS);
                    await delay(waitTime);
                    retryDelay *= 2;
                    continue;
                }
                throw lastError;
            }
        }

        throw lastError || new Error('Unknown fetch error');
    };

    // Build URL using query parameter for files with special characters
    const url = buildAudioUrl(baseUrl, fileName);
    const extension = fileName.split('.').pop()?.toLowerCase();

    try {
        // 첫 번째 시도
        const response = await tryFetchWithRetry(url);
        return await response.arrayBuffer();
    } catch (error: unknown) {
        // 확장자 대소문자 무관하게 폴백 처리
        if (extension === 'wav') {
            // .wav 요청 실패 시 .ogg로 재시도
            const fallbackFileName = fileName.replace(/\.wav$/i, '.ogg');
            const fallbackUrl = buildAudioUrl(baseUrl, fallbackFileName);
            const response = await tryFetchWithRetry(fallbackUrl);
            return await response.arrayBuffer();
        } else if (extension === 'ogg') {
            // .ogg 요청 실패 시 .wav로 재시도
            const fallbackFileName = fileName.replace(/\.ogg$/i, '.wav');
            const fallbackUrl = buildAudioUrl(baseUrl, fallbackFileName);
            const response = await tryFetchWithRetry(fallbackUrl);
            return await response.arrayBuffer();
        } else {
            // 다른 확장자는 재시도 없이 에러 처리
            throw error;
        }
    }
}

// 단일 파일 로드 및 결과 전송
async function loadAndSendFile(
    baseUrl: string,
    key: string,
    fileName: string,
    loadedCount: { value: number },
    total: number,
): Promise<boolean> {
    try {
        const arrayBuffer = await loadAudioFile(baseUrl, key, fileName);
        loadedCount.value++;

        // 진행상황(PROGRESS) 전송
        self.postMessage({
            type: 'PROGRESS',
            payload: {
                key,
                fileName,
                loadedCount: loadedCount.value,
                total,
            },
        });

        // 메인 스레드로 ArrayBuffer 전송 (Transferable)
        self.postMessage(
            {
                type: 'LOADED',
                payload: {
                    key,
                    fileName,
                    arrayBuffer,
                },
            },
            { transfer: [arrayBuffer] },
        );

        return true;
    } catch (error: unknown) {
        // 개별 파일 실패는 에러 메시지만 보내고 계속 진행
        loadedCount.value++;
        self.postMessage({
            type: 'PROGRESS',
            payload: {
                key,
                fileName,
                loadedCount: loadedCount.value,
                total,
            },
        });
        self.postMessage({
            type: 'ERROR',
            payload: { key, fileName, message: String(error) },
        });
        return false;
    }
}

// Worker 메시지 핸들러
self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'LOAD_AUDIO') {
        const { baseUrl, fileMap } = payload as {
            baseUrl: string;
            fileMap: FileMap;
        };

        const entries = Object.entries(fileMap);
        const total = entries.length;

        if (total === 0) {
            self.postMessage({ type: 'DONE', payload: { total: 0, loaded: 0 } });
            return;
        }

        const loadedCount = { value: 0 };

        // 병렬 로딩: CONCURRENT_LIMIT 개씩 배치로 처리
        for (let i = 0; i < entries.length; i += CONCURRENT_LIMIT) {
            const batch = entries.slice(i, i + CONCURRENT_LIMIT);
            const promises = batch.map(([key, fileName]) =>
                loadAndSendFile(baseUrl, key, fileName, loadedCount, total),
            );

            // 배치 내에서는 병렬 실행, 배치 간에는 순차 실행
            await Promise.all(promises);

            // 다음 배치 전 딜레이 (마지막 배치 제외) - 서버 부하 분산
            if (i + CONCURRENT_LIMIT < entries.length) {
                await delay(BATCH_DELAY_MS);
            }
        }

        // 모든 파일 로딩 완료
        self.postMessage({
            type: 'DONE',
            payload: { total, loaded: loadedCount.value },
        });
    }
};
