import { describe, it, expect, vi } from 'vitest';
import {
  extractStem,
  resolveKeysounds,
  resolveKeysoundFiles,
} from '../src/audio/loader/resolveKeysoundFiles';
import type { AudioFileMapFetcher, ResolveOptions } from '../src/audio/loader/resolveKeysoundFiles';

// ── extractStem ────────────────────────────────────────────────────

describe('extractStem', () => {
  it('should remove extension and lowercase', () => {
    expect(extractStem('kick.wav')).toBe('kick');
  });

  it('should return lowercase filename when no extension', () => {
    expect(extractStem('kick')).toBe('kick');
  });

  it('should only strip the last extension (multiple dots)', () => {
    expect(extractStem('my.sound.file.ogg')).toBe('my.sound.file');
  });

  it('should return empty string for empty input', () => {
    expect(extractStem('')).toBe('');
  });

  it('should be case-insensitive (uppercase input)', () => {
    expect(extractStem('KICK.WAV')).toBe('kick');
    expect(extractStem('Snare.OGG')).toBe('snare');
  });

  it('should handle dotfile-like names (leading dot is not an extension dot)', () => {
    // lastIndexOf('.') > 0 is false for ".hidden", so full name is kept
    expect(extractStem('.hidden')).toBe('.hidden');
  });

  it('should handle filename with trailing dot', () => {
    // "file." -> lastDot = 4 > 0 -> slice(0,4) = "file"
    expect(extractStem('file.')).toBe('file');
  });
});

// ── resolveKeysounds ───────────────────────────────────────────────

describe('resolveKeysounds', () => {
  const serverAudioMap: Record<string, string> = {
    kick: 'kick.ogg',
    snare: 'snare.ogg',
    hihat: 'hihat.mp3',
  };

  it('should resolve all keysounds when every stem matches (full match)', () => {
    const keysoundMap = {
      '01': 'kick.wav',
      '02': 'snare.wav',
      '03': 'hihat.wav',
    };

    const { resolved, unresolved } = resolveKeysounds(keysoundMap, serverAudioMap);

    expect(resolved).toEqual({
      '01': 'kick.ogg',
      '02': 'snare.ogg',
      '03': 'hihat.mp3',
    });
    expect(unresolved).toHaveLength(0);
  });

  it('should partially resolve when some stems are missing (partial match)', () => {
    const keysoundMap = {
      '01': 'kick.wav',
      '02': 'bass.wav',
    };

    const { resolved, unresolved } = resolveKeysounds(keysoundMap, serverAudioMap);

    expect(resolved).toEqual({ '01': 'kick.ogg' });
    expect(unresolved).toEqual(['02:bass.wav']);
  });

  it('should return empty resolved map when nothing matches (no match)', () => {
    const keysoundMap = {
      '01': 'piano.wav',
      '02': 'guitar.wav',
    };

    const { resolved, unresolved } = resolveKeysounds(keysoundMap, serverAudioMap);

    expect(Object.keys(resolved)).toHaveLength(0);
    expect(unresolved).toHaveLength(2);
  });

  it('should handle empty keysoundMap', () => {
    const { resolved, unresolved } = resolveKeysounds({}, serverAudioMap);

    expect(Object.keys(resolved)).toHaveLength(0);
    expect(unresolved).toHaveLength(0);
  });

  it('should handle empty serverAudioMap', () => {
    const keysoundMap = { '01': 'kick.wav' };
    const { resolved, unresolved } = resolveKeysounds(keysoundMap, {});

    expect(Object.keys(resolved)).toHaveLength(0);
    expect(unresolved).toEqual(['01:kick.wav']);
  });

  it('should handle both inputs empty', () => {
    const { resolved, unresolved } = resolveKeysounds({}, {});

    expect(Object.keys(resolved)).toHaveLength(0);
    expect(unresolved).toHaveLength(0);
  });

  it('should lowercase keysound IDs in resolved output', () => {
    const keysoundMap = { 'AB': 'kick.wav' };

    const { resolved } = resolveKeysounds(keysoundMap, serverAudioMap);

    expect(resolved).toHaveProperty('ab');
    expect(resolved).not.toHaveProperty('AB');
    expect(resolved['ab']).toBe('kick.ogg');
  });
});

// ── Case insensitivity ─────────────────────────────────────────────

describe('case insensitivity', () => {
  it('should match BMS filenames case-insensitively against server map', () => {
    const keysoundMap = {
      '01': 'KICK.WAV',
      '02': 'Snare.Ogg',
    };
    const serverAudioMap: Record<string, string> = {
      kick: 'kick.ogg',
      snare: 'snare.ogg',
    };

    const { resolved, unresolved } = resolveKeysounds(keysoundMap, serverAudioMap);

    expect(resolved).toEqual({
      '01': 'kick.ogg',
      '02': 'snare.ogg',
    });
    expect(unresolved).toHaveLength(0);
  });
});

// ── resolveKeysoundFiles (async with mock fetcher) ─────────────────

describe('resolveKeysoundFiles', () => {
  const defaultOptions: ResolveOptions = {
    slug: 'test-repo',
    ref: 'main',
    dir: '',
  };

  it('should call fetcher with provided options and resolve keysounds', async () => {
    const mockFetcher: AudioFileMapFetcher = vi.fn().mockResolvedValue({
      kick: 'kick.ogg',
      snare: 'snare.mp3',
    });

    const keysoundMap = {
      '01': 'kick.wav',
      '02': 'snare.wav',
    };

    const { resolved, unresolved } = await resolveKeysoundFiles(
      keysoundMap,
      defaultOptions,
      mockFetcher,
    );

    expect(mockFetcher).toHaveBeenCalledWith(defaultOptions);
    expect(resolved).toEqual({
      '01': 'kick.ogg',
      '02': 'snare.mp3',
    });
    expect(unresolved).toHaveLength(0);
  });

  it('should propagate unresolved keysounds from fetcher result', async () => {
    const mockFetcher: AudioFileMapFetcher = vi.fn().mockResolvedValue({
      kick: 'kick.ogg',
    });

    const keysoundMap = {
      '01': 'kick.wav',
      '02': 'missing.wav',
    };

    const { resolved, unresolved } = await resolveKeysoundFiles(
      keysoundMap,
      defaultOptions,
      mockFetcher,
    );

    expect(resolved).toEqual({ '01': 'kick.ogg' });
    expect(unresolved).toEqual(['02:missing.wav']);
  });

  it('should handle fetcher returning empty map', async () => {
    const mockFetcher: AudioFileMapFetcher = vi.fn().mockResolvedValue({});

    const keysoundMap = { '01': 'kick.wav' };

    const { resolved, unresolved } = await resolveKeysoundFiles(
      keysoundMap,
      defaultOptions,
      mockFetcher,
    );

    expect(Object.keys(resolved)).toHaveLength(0);
    expect(unresolved).toHaveLength(1);
  });

  it('should pass dir option through to fetcher', async () => {
    const mockFetcher: AudioFileMapFetcher = vi.fn().mockResolvedValue({});
    const opts: ResolveOptions = { slug: 'repo', ref: 'v1', dir: 'sounds/bgm' };

    await resolveKeysoundFiles({}, opts, mockFetcher);

    expect(mockFetcher).toHaveBeenCalledWith(opts);
  });

  it('should propagate fetcher errors', async () => {
    const mockFetcher: AudioFileMapFetcher = vi.fn().mockRejectedValue(
      new Error('Network error'),
    );

    await expect(
      resolveKeysoundFiles({ '01': 'kick.wav' }, defaultOptions, mockFetcher),
    ).rejects.toThrow('Network error');
  });
});
