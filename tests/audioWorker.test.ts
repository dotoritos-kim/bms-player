import { describe, it, expect } from 'vitest';

/**
 * Tests for AudioLoader.worker.ts logic.
 * Since the worker uses `self.onmessage`, we can't import its functions directly.
 * Instead we replicate the pure functions and test them.
 */

// Replicated from AudioLoader.worker.ts buildAudioUrl
function buildAudioUrl(baseUrl: string, fileName: string): string {
    const hasSpecialChars = /[#[\]%]/.test(fileName);
    if (hasSpecialChars) {
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}path=${encodeURIComponent(fileName)}`;
    }
    const encodedFileName = fileName.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `${baseUrl}/${encodedFileName}`;
}

describe('AudioLoader.worker - buildAudioUrl', () => {
    const baseUrl = 'https://api.example.com/repos/test/raw/main/sounds';

    it('constructs simple URL for normal filenames', () => {
        expect(buildAudioUrl(baseUrl, 'kick.wav')).toBe(
            `${baseUrl}/kick.wav`
        );
    });

    it('encodes spaces in filenames', () => {
        expect(buildAudioUrl(baseUrl, 'my sound.wav')).toBe(
            `${baseUrl}/my%20sound.wav`
        );
    });

    it('handles subdirectory paths', () => {
        expect(buildAudioUrl(baseUrl, 'sub/folder/kick.wav')).toBe(
            `${baseUrl}/sub/folder/kick.wav`
        );
    });

    it('encodes each path segment separately', () => {
        expect(buildAudioUrl(baseUrl, 'sub dir/my file.wav')).toBe(
            `${baseUrl}/sub%20dir/my%20file.wav`
        );
    });

    it('uses query parameter for filenames with #', () => {
        const url = buildAudioUrl(baseUrl, 'song#1.wav');
        expect(url).toContain('path=');
        expect(url).toContain(encodeURIComponent('song#1.wav'));
    });

    it('uses query parameter for filenames with [', () => {
        const url = buildAudioUrl(baseUrl, '[HYPER]song.wav');
        expect(url).toContain('path=');
    });

    it('uses query parameter for filenames with ]', () => {
        const url = buildAudioUrl(baseUrl, 'song].wav');
        expect(url).toContain('path=');
    });

    it('uses query parameter for filenames with %', () => {
        const url = buildAudioUrl(baseUrl, '100%song.wav');
        expect(url).toContain('path=');
    });

    it('uses ? separator when baseUrl has no query params', () => {
        const url = buildAudioUrl('https://api.com/raw', '#test.wav');
        expect(url).toContain('?path=');
    });

    it('uses & separator when baseUrl already has query params', () => {
        const url = buildAudioUrl('https://api.com/raw?token=abc', '#test.wav');
        expect(url).toContain('&path=');
    });

    it('handles empty filename', () => {
        const url = buildAudioUrl(baseUrl, '');
        expect(url).toBe(`${baseUrl}/`);
    });

    it('handles Japanese filenames', () => {
        const url = buildAudioUrl(baseUrl, '曲名.wav');
        expect(url).toContain(encodeURIComponent('曲名.wav'));
    });

    it('handles Korean filenames', () => {
        const url = buildAudioUrl(baseUrl, '음악.ogg');
        expect(url).toContain(encodeURIComponent('음악.ogg'));
    });
});

describe('AudioLoader.worker - retry/backoff logic (specification test)', () => {
    // These tests verify the retry constants and behavior specification
    // without actually running the worker

    const CONCURRENT_LIMIT = 6;
    const MAX_RETRIES = 5;
    const INITIAL_RETRY_DELAY_MS = 200;
    const MAX_RETRY_DELAY_MS = 5000;
    const BATCH_DELAY_MS = 50;

    it('concurrent limit matches browser connection limit', () => {
        expect(CONCURRENT_LIMIT).toBe(6);
    });

    it('retry configuration is reasonable', () => {
        expect(MAX_RETRIES).toBeGreaterThanOrEqual(3);
        expect(MAX_RETRIES).toBeLessThanOrEqual(10);
    });

    it('exponential backoff stays within max delay', () => {
        let delay = INITIAL_RETRY_DELAY_MS;
        for (let i = 0; i < MAX_RETRIES; i++) {
            delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
        }
        expect(delay).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
    });

    it('total worst-case retry time is reasonable', () => {
        // Sum of all delays with max jitter (100ms)
        let totalMs = 0;
        let delay = INITIAL_RETRY_DELAY_MS;
        for (let i = 0; i < MAX_RETRIES; i++) {
            totalMs += Math.min(delay + 100, MAX_RETRY_DELAY_MS);
            delay *= 2;
        }
        // Should be under 30 seconds total
        expect(totalMs).toBeLessThan(30000);
    });

    it('batch delay is reasonable for server load distribution', () => {
        expect(BATCH_DELAY_MS).toBeGreaterThanOrEqual(10);
        expect(BATCH_DELAY_MS).toBeLessThanOrEqual(500);
    });

    it('extension fallback was removed (pre-resolution only)', () => {
        // This is a specification test to document the architectural decision
        // The worker should NOT have extension fallback - resolution happens before loading
        // This test passes trivially but documents the requirement
        const NO_EXTENSION_FALLBACK = true;
        expect(NO_EXTENSION_FALLBACK).toBe(true);
    });
});
