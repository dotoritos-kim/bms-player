/**
 * AudioLoader.worker.ts
 *
 * Worker that fetches audio files in parallel and sends ArrayBuffers to the main thread.
 * In Vite, import it with the `?worker` suffix.
 *
 * @example
 * ```typescript
 * import AudioLoaderWorker from './AudioLoader.worker?worker';
 * const worker = new AudioLoaderWorker();
 * ```
 */

import type { LoaderInbound } from './messages';
import { postFromLoaderWorker } from './messages';

// Browser concurrent-connection limit (usually 6).
const CONCURRENT_LIMIT = 6;

// Delay between batches (ms) - spreads server load.
const BATCH_DELAY_MS = 50;

// 429 retry settings.
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 5000;

// Delay utility.
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

// File-loading function: retries with exponential backoff on 429 errors.
// No extension fallback — extension resolution must be completed by resolveKeysoundFiles before loading.
async function loadAudioFile(baseUrl: string, key: string, fileName: string): Promise<ArrayBuffer> {
    let lastError: Error | null = null;
    let retryDelay = INITIAL_RETRY_DELAY_MS;
    const url = buildAudioUrl(baseUrl, fileName);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, { cache: 'force-cache' });

            if (response.status === 429) {
                if (attempt < MAX_RETRIES) {
                    const jitter = Math.random() * 100;
                    const waitTime = Math.min(retryDelay + jitter, MAX_RETRY_DELAY_MS);
                    console.log(`[Worker] Rate limited (429) for key=${key}, retrying in ${Math.round(waitTime)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await delay(waitTime);
                    retryDelay *= 2;
                    continue;
                }
                throw new Error(`HTTP error 429 - Rate limited after ${MAX_RETRIES} retries`);
            }

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }

            return await response.arrayBuffer();
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Network errors get retried with backoff (not 4xx client errors)
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
}

// Loads a single file and sends the result.
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

        // Send progress (PROGRESS).
        postFromLoaderWorker({
            type: 'PROGRESS',
            payload: {
                key,
                fileName,
                loadedCount: loadedCount.value,
                total,
            },
        });

        // Send the ArrayBuffer to the main thread (Transferable).
        postFromLoaderWorker(
            {
                type: 'LOADED',
                payload: {
                    key,
                    fileName,
                    arrayBuffer,
                },
            },
            [arrayBuffer],
        );

        return true;
    } catch (error: unknown) {
        // A single file failure only reports an error message and keeps going.
        loadedCount.value++;
        postFromLoaderWorker({
            type: 'PROGRESS',
            payload: {
                key,
                fileName,
                loadedCount: loadedCount.value,
                total,
            },
        });
        postFromLoaderWorker({
            type: 'ERROR',
            payload: { key, fileName, message: String(error) },
        });
        return false;
    }
}

// Worker message handler.
self.onmessage = async (event: MessageEvent<LoaderInbound>) => {
    const msg = event.data;

    switch (msg.type) {
        case 'LOAD_AUDIO': {
            const { baseUrl, fileMap } = msg.payload;

            const entries = Object.entries(fileMap);
            const total = entries.length;

            if (total === 0) {
                postFromLoaderWorker({
                    type: 'DONE',
                    payload: { total: 0, loaded: 0 },
                });
                return;
            }

            const loadedCount = { value: 0 };

            // Parallel loading: process in batches of CONCURRENT_LIMIT.
            for (let i = 0; i < entries.length; i += CONCURRENT_LIMIT) {
                const batch = entries.slice(i, i + CONCURRENT_LIMIT);
                const promises = batch.map(([key, fileName]) =>
                    loadAndSendFile(baseUrl, key, fileName, loadedCount, total),
                );

                // Run in parallel within a batch, sequentially across batches.
                await Promise.all(promises);

                // Delay before the next batch (except the last one) - spreads server load.
                if (i + CONCURRENT_LIMIT < entries.length) {
                    await delay(BATCH_DELAY_MS);
                }
            }

            // All files finished loading.
            postFromLoaderWorker({
                type: 'DONE',
                payload: { total, loaded: loadedCount.value },
            });
            break;
        }
    }
};
