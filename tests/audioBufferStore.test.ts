/**
 * AudioBufferStore 단위 테스트
 * Web Audio API 없는 환경에서 실행되므로 AudioBuffer는 간단한 stub을 사용한다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AudioBufferStore } from '../src/audio/pipeline/AudioBufferStore';

// AudioBuffer stub (JSDOM에는 AudioBuffer가 없음)
function makeStubBuffer(id: number): AudioBuffer {
    return { duration: id * 0.1, numberOfChannels: 1, sampleRate: 44100 } as unknown as AudioBuffer;
}

describe('AudioBufferStore', () => {
    let store: AudioBufferStore;

    beforeEach(() => {
        // useGlobalCache=false 로 격리 (전역 Map 오염 방지)
        store = new AudioBufferStore('test-prefix', false);
    });

    it('set/get 기본 동작', () => {
        const buf = makeStubBuffer(1);
        store.set('key1', buf);
        expect(store.get('key1')).toBe(buf);
    });

    it('존재하지 않는 키는 undefined', () => {
        expect(store.get('nonexistent')).toBeUndefined();
    });

    it('has() 정확성', () => {
        const buf = makeStubBuffer(2);
        store.set('k2', buf);
        expect(store.has('k2')).toBe(true);
        expect(store.has('k3')).toBe(false);
    });

    it('size() 반환 값', () => {
        expect(store.size()).toBe(0);
        store.set('a', makeStubBuffer(1));
        store.set('b', makeStubBuffer(2));
        expect(store.size()).toBe(2);
    });

    it('clear() 이후 비어 있음', () => {
        store.set('x', makeStubBuffer(1));
        store.clear();
        expect(store.size()).toBe(0);
        expect(store.has('x')).toBe(false);
    });

    it('keys() 순회', () => {
        store.set('a', makeStubBuffer(1));
        store.set('b', makeStubBuffer(2));
        const keys = [...store.keys()];
        expect(keys).toContain('a');
        expect(keys).toContain('b');
        expect(keys.length).toBe(2);
    });

    it('덮어쓰기(overwrite)가 올바르게 동작', () => {
        const buf1 = makeStubBuffer(1);
        const buf2 = makeStubBuffer(2);
        store.set('k', buf1);
        store.set('k', buf2);
        expect(store.get('k')).toBe(buf2);
    });
});
