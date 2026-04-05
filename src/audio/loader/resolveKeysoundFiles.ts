/**
 * resolveKeysoundFiles.ts
 *
 * BMS 키사운드 파일명을 실제 존재하는 파일로 해석(resolve)합니다.
 *
 * BMS 파일은 `#WAV01 kick.wav` 형식으로 키사운드를 정의하지만,
 * 실제 파일의 확장자가 다를 수 있습니다 (예: kick.ogg).
 * 이 모듈은 주입된 fetcher를 통해 stem(확장자 제거) 기준으로
 * 실제 파일을 매칭합니다.
 *
 * Flow:
 * 1. fetcher를 통해 오디오 파일 stem→filename 매핑을 가져옴
 * 2. BMS keysound map의 각 파일명에서 stem을 추출
 * 3. stem으로 실제 파일명을 lookup
 * 4. 해석된 fileMap 반환 (키사운드ID → 실제파일명)
 */

import type { FileMap } from './AudioPreloader';

export interface ResolveOptions {
    /** Repository slug */
    slug: string;
    /** Branch, tag, or commit SHA */
    ref: string;
    /** BMS 파일이 위치한 디렉토리 경로 (루트면 빈 문자열) */
    dir: string;
}

/**
 * 오디오 파일 stem→filename 매핑을 반환하는 fetcher 함수 타입.
 * 환경에 따라 다른 구현을 주입합니다:
 * - 웹: API 서버 호출
 * - Electron: 로컬 파일시스템 스캔
 */
export type AudioFileMapFetcher = (options: ResolveOptions) => Promise<Record<string, string>>;

/**
 * 파일명에서 확장자를 제거하고 stem(소문자)을 반환
 */
export function extractStem(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    const name = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    return name.toLowerCase();
}

/**
 * BMS keysound map을 실제 파일로 해석합니다.
 *
 * @param keysoundMap - BMS 파서가 반환한 키사운드 매핑 (ID → BMS에 기재된 파일명)
 * @param serverAudioMap - stem→실제파일명 매핑 (fetcher 결과)
 * @returns 해석된 FileMap (키사운드ID → 실제 파일명). 매칭 실패한 항목은 제외됨.
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
 * BMS keysound map을 실제 파일로 해석하는 통합 함수.
 * fetcher + resolveKeysounds를 한 번에 수행.
 *
 * @param keysoundMap - BMS 파서가 반환한 키사운드 매핑 (ID → 파일명)
 * @param options - 해석 옵션
 * @param fetcher - 오디오 파일 매핑을 가져오는 함수 (환경별 주입)
 * @returns 해석된 FileMap
 */
export async function resolveKeysoundFiles(
    keysoundMap: Record<string, string>,
    options: ResolveOptions,
    fetcher: AudioFileMapFetcher,
): Promise<{ resolved: FileMap; unresolved: string[] }> {
    const serverAudioMap = await fetcher(options);
    return resolveKeysounds(keysoundMap, serverAudioMap);
}
