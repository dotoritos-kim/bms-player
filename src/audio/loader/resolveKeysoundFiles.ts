/**
 * resolveKeysoundFiles.ts
 *
 * Resolves BMS keysound filenames to the files that actually exist on disk.
 *
 * BMS defines keysounds as `#WAV01 kick.wav`, but the on-disk file may use
 * a different extension (for example `kick.ogg`). This module matches the
 * declared name against the actual file by stem (the filename minus its
 * extension) using an injected fetcher.
 *
 * Flow:
 * 1. Use the fetcher to retrieve a stem → filename mapping for available
 *    audio files.
 * 2. Extract the stem from each filename in the BMS keysound map.
 * 3. Look up the real filename by stem.
 * 4. Return the resolved fileMap (keysound ID → real filename).
 */

import type { FileMap } from './AudioPreloader';

export interface ResolveOptions {
    /** Repository slug */
    slug: string;
    /** Branch, tag, or commit SHA */
    ref: string;
    /** Directory containing the BMS file (empty string if at root). */
    dir: string;
}

/**
 * Fetcher type that returns an audio-file stem → filename mapping.
 * Inject a different implementation per environment:
 * - Web: call an API server.
 * - Electron: scan the local filesystem.
 */
export type AudioFileMapFetcher = (options: ResolveOptions) => Promise<Record<string, string>>;

/**
 * Strips the extension from a filename and returns the lower-case stem.
 */
export function extractStem(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    return name.toLowerCase();
}

/**
 * Resolves a BMS keysound map to the real on-disk files.
 *
 * @param keysoundMap - keysound map produced by the BMS parser (ID → filename declared in the BMS).
 * @param serverAudioMap - stem → real-filename mapping (the fetcher's result).
 * @returns the resolved FileMap (keysound ID → real filename); unmatched entries are dropped.
 */
export function resolveKeysounds(
    keysoundMap: Record<string, string>,
    serverAudioMap: Record<string, string>,
): { resolved: FileMap; unresolved: string[] } {
    const resolved: FileMap = {};
    const unresolved: string[] = [];

    for (const [id, bmsFilename] of Object.entries(keysoundMap)) {
        const stem = extractStem(bmsFilename);
        const actualFile = serverAudioMap[stem];

        if (actualFile) {
            resolved[id.toLowerCase()] = actualFile;
        } else {
            unresolved.push(`${id}:${bmsFilename}`);
        }
    }

    if (unresolved.length > 0) {
        console.warn(
            `[resolveKeysoundFiles] ${unresolved.length} keysounds could not be resolved:`,
            unresolved.slice(0, 10),
            unresolved.length > 10 ? `... and ${unresolved.length - 10} more` : '',
        );
    }

    return { resolved, unresolved };
}

/**
 * Convenience wrapper that resolves a BMS keysound map in one call.
 * Combines the fetcher invocation and `resolveKeysounds`.
 *
 * @param keysoundMap - keysound map from the BMS parser (ID → filename).
 * @param options - resolve options.
 * @param fetcher - function that returns the audio-file mapping (injected per environment).
 * @returns the resolved FileMap.
 */
export async function resolveKeysoundFiles(
    keysoundMap: Record<string, string>,
    options: ResolveOptions,
    fetcher: AudioFileMapFetcher,
): Promise<{ resolved: FileMap; unresolved: string[] }> {
    const serverAudioMap = await fetcher(options);
    return resolveKeysounds(keysoundMap, serverAudioMap);
}
