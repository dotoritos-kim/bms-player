/**
 * AudioProcessor.worklet.ts
 *
 * AudioWorklet 프로세서 - 멀티 트랙 스테레오 오디오 재생
 * AudioWorklet은 별도의 스레드에서 실행되므로 외부 import가 불가능합니다.
 * 따라서 타입 정의를 inline으로 포함하고 Blob URL로 변환하여 사용합니다.
 *
 * v2: 스테레오 지원, 동시 재생 지원, 이펙트 단순화
 */

// AudioWorklet 코드를 문자열로 정의
const workletCode = `
/**
 * 스테레오 트랙 구조
 * - leftData, rightData: 각 채널의 Float32Array
 * - readIndex: 현재 읽기 위치 (소수점 포함 - 보간용)
 * - isPlaying: 재생 중 여부
 * - loop: 루프 여부
 * - volume: 트랙별 볼륨 (0-1)
 */
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // 트랙 관리: Map<trackId, Track>
        this.tracks = new Map();
        this.masterVolume = 0.5;
        this.playbackRate = 1.0; // 전역 재생 속도

        // 트랙별 볼륨: Map<trackId, number>
        this.trackVolumes = new Map();

        // 완료된 트랙을 정리하기 위한 카운터
        this.cleanupCounter = 0;

        this.port.onmessage = (e) => {
            const { type, key, data } = e.data;
            switch (type) {
                case 'play':
                    if (data && (data.buffer || data.bufferLeft)) {
                        // 스테레오 또는 모노 데이터 처리
                        // Transferable Objects로 전송되어 이미 Float32Array로 받음 (복사 불필요)
                        let leftData, rightData;

                        if (data.bufferLeft && data.bufferRight) {
                            // 스테레오: 이미 Float32Array로 전달됨
                            leftData = data.bufferLeft;
                            rightData = data.bufferRight;
                        } else if (data.buffer) {
                            // 모노: 양쪽 채널에 동일 데이터
                            leftData = data.buffer;
                            rightData = leftData;
                        } else {
                            break;
                        }

                        // offset 지원: 초 단위 오프셋을 샘플 인덱스로 변환
                        // sampleRate는 AudioWorkletGlobalScope에서 제공
                        const offsetSeconds = data.offset || 0;
                        const startIndex = offsetSeconds * sampleRate;

                        // 오프셋이 데이터 길이를 초과하면 재생하지 않음
                        if (startIndex >= leftData.length) {
                            break;
                        }

                        this.tracks.set(key, {
                            leftData,
                            rightData,
                            readIndex: startIndex, // 오프셋부터 시작
                            isPlaying: true,
                            loop: data.loop || false,
                        });
                        this.trackVolumes.set(key, 1.0);
                    }
                    break;

                case 'stop':
                    if (this.tracks.has(key)) {
                        this.tracks.get(key).isPlaying = false;
                    }
                    break;

                case 'stopAll':
                    for (const track of this.tracks.values()) {
                        track.isPlaying = false;
                    }
                    break;

                case 'clear':
                    this.tracks.delete(key);
                    this.trackVolumes.delete(key);
                    break;

                case 'clearAll':
                    this.tracks.clear();
                    this.trackVolumes.clear();
                    break;

                case 'setVolume':
                    if (typeof data === 'number') {
                        this.masterVolume = Math.max(0, Math.min(1, data));
                    }
                    break;

                case 'adjustVolume':
                    if (typeof data === 'number' && this.trackVolumes.has(key)) {
                        this.trackVolumes.set(key, Math.max(0, Math.min(1, data)));
                    }
                    break;

                case 'setPlaybackRate':
                    if (typeof data === 'number') {
                        this.playbackRate = Math.max(0.25, Math.min(4.0, data));
                    }
                    break;
            }
        };
    }

    // 선형 보간 함수 (배속 재생용)
    interpolate(data, index) {
        const idx0 = Math.floor(index);
        const idx1 = idx0 + 1;
        const frac = index - idx0;

        if (idx1 >= data.length) {
            return data[idx0] || 0;
        }

        // 선형 보간: (1-frac)*data[idx0] + frac*data[idx1]
        return data[idx0] * (1 - frac) + data[idx1] * frac;
    }

    process(inputs, outputs) {
        const output = outputs[0];
        if (!output || output.length === 0) return true;

        const left = output[0];
        const right = output[1] || left;
        const blockSize = left.length;
        const rate = this.playbackRate;

        // 출력 버퍼 초기화
        for (let i = 0; i < blockSize; i++) {
            left[i] = 0;
            right[i] = 0;
        }

        // 완료된 트랙 목록
        const completedTracks = [];

        // 각 트랙 처리
        for (const [trackKey, track] of this.tracks.entries()) {
            if (!track.isPlaying) {
                completedTracks.push(trackKey);
                continue;
            }

            const trackVolume = this.trackVolumes.get(trackKey) || 1.0;
            const dataLength = track.leftData.length;

            for (let i = 0; i < blockSize; i++) {
                if (track.readIndex >= dataLength - 1) {
                    if (track.loop) {
                        track.readIndex = 0;
                    } else {
                        track.isPlaying = false;
                        completedTracks.push(trackKey);
                        break;
                    }
                }

                // 선형 보간을 사용한 샘플 읽기 (배속 지원)
                const leftSample = this.interpolate(track.leftData, track.readIndex);
                const rightSample = this.interpolate(track.rightData, track.readIndex);

                left[i] += leftSample * trackVolume;
                right[i] += rightSample * trackVolume;

                // playbackRate만큼 인덱스 증가 (1.5x면 1.5씩 증가)
                track.readIndex += rate;
            }
        }

        // 마스터 볼륨 적용 및 클리핑 방지
        for (let i = 0; i < blockSize; i++) {
            left[i] = Math.max(-1, Math.min(1, left[i] * this.masterVolume));
            right[i] = Math.max(-1, Math.min(1, right[i] * this.masterVolume));
        }

        // 주기적으로 완료된 트랙 정리 (매 100 블록마다)
        this.cleanupCounter++;
        if (this.cleanupCounter >= 100) {
            this.cleanupCounter = 0;
            for (const trackKey of completedTracks) {
                this.tracks.delete(trackKey);
                this.trackVolumes.delete(trackKey);
            }
        }

        return true;
    }
}

registerProcessor('audio-worklet-processor', AudioProcessor);
`;

// Blob URL 생성
const blob = new Blob([workletCode], { type: 'application/javascript' });
export const AudioProcessorWorkletUrl = URL.createObjectURL(blob);

export default AudioProcessorWorkletUrl;
