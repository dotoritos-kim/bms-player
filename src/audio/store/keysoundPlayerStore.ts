/**
 * KeysoundPlayer Instance Store
 *
 * KeysoundPlayer 인스턴스를 전역으로 관리하여 탭 전환 시에도 재사용
 * - baseUrl 기반으로 인스턴스 캐싱
 * - dispose() 호출 없이 인스턴스 유지
 * - LRU 기반 자동 정리
 */

import { create } from 'zustand';
import type { KeysoundPlayer } from '../../types/KeysoundPlayer';

const MAX_CACHED_PLAYERS = 5; // 최대 5개 플레이어 인스턴스 유지

interface CachedPlayer {
  player: KeysoundPlayer;
  baseUrl: string;
  keysoundsHash: string; // 키사운드 맵의 해시 (같은 곡인지 확인)
  lastUsed: number;
  isReady: boolean;
}

interface KeysoundPlayerStore {
  // 캐시된 플레이어 맵 (baseUrl -> CachedPlayer)
  players: Map<string, CachedPlayer>;

  // 플레이어 가져오기 또는 생성 필요 여부 확인
  getPlayer: (baseUrl: string, keysoundsHash: string) => KeysoundPlayer | null;

  // 플레이어 캐시에 저장
  cachePlayer: (baseUrl: string, keysoundsHash: string, player: KeysoundPlayer) => void;

  // 플레이어 준비 완료 표시
  markReady: (baseUrl: string) => void;

  // 특정 플레이어 제거
  removePlayer: (baseUrl: string) => void;

  // 모든 플레이어 정리
  clearAll: () => void;

  // 오래된 플레이어 정리 (LRU)
  cleanupOldPlayers: () => void;
}

/**
 * 키사운드 맵을 해시 문자열로 변환
 * 같은 키사운드 구성인지 빠르게 비교하기 위함
 */
export function hashKeysounds(keysounds: Record<string, string>): string {
  const keys = Object.keys(keysounds).sort();
  if (keys.length === 0) return 'empty';

  // 첫 5개 + 마지막 5개 + 총 개수로 간단한 해시 생성
  const sample = [
    ...keys.slice(0, 5),
    ...keys.slice(-5),
    `count:${keys.length}`,
  ].join('|');

  return sample;
}

export const useKeysoundPlayerStore = create<KeysoundPlayerStore>((set, get) => ({
  players: new Map(),

  getPlayer: (baseUrl: string, keysoundsHash: string) => {
    const { players } = get();
    const cached = players.get(baseUrl);

    if (cached && cached.keysoundsHash === keysoundsHash) {
      // LRU: 최근 사용 시간 업데이트
      cached.lastUsed = Date.now();
      // isReady 여부와 관계없이 플레이어 반환 (호출자가 isReady 체크 가능)
      return cached.player;
    }

    // 캐시 미스 또는 키사운드 구성이 다름
    return null;
  },

  cachePlayer: (baseUrl: string, keysoundsHash: string, player: KeysoundPlayer) => {
    const { players, cleanupOldPlayers } = get();

    // 기존 플레이어가 있으면 dispose
    const existing = players.get(baseUrl);
    if (existing && existing.player !== player) {
      try {
        existing.player.dispose();
      } catch {
        // dispose 에러 무시
      }
    }

    // 새 플레이어 캐시
    const newPlayers = new Map(players);
    newPlayers.set(baseUrl, {
      player,
      baseUrl,
      keysoundsHash,
      lastUsed: Date.now(),
      isReady: false,
    });

    set({ players: newPlayers });

    // 캐시 크기 초과 시 정리
    if (newPlayers.size > MAX_CACHED_PLAYERS) {
      cleanupOldPlayers();
    }
  },

  markReady: (baseUrl: string) => {
    const { players } = get();
    const cached = players.get(baseUrl);

    if (cached) {
      cached.isReady = true;
      cached.lastUsed = Date.now();
    }
  },

  removePlayer: (baseUrl: string) => {
    const { players } = get();
    const cached = players.get(baseUrl);

    if (cached) {
      try {
        cached.player.dispose();
      } catch {
        // dispose 에러 무시
      }

      const newPlayers = new Map(players);
      newPlayers.delete(baseUrl);
      set({ players: newPlayers });
    }
  },

  clearAll: () => {
    const { players } = get();

    // 모든 플레이어 dispose
    for (const cached of players.values()) {
      try {
        cached.player.dispose();
      } catch {
        // dispose 에러 무시
      }
    }

    set({ players: new Map() });
  },

  cleanupOldPlayers: () => {
    const { players } = get();

    if (players.size <= MAX_CACHED_PLAYERS) return;

    // 가장 오래된 플레이어들 정리
    const sortedEntries = Array.from(players.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    const toRemove = sortedEntries.slice(0, players.size - MAX_CACHED_PLAYERS);

    const newPlayers = new Map(players);
    for (const [key, cached] of toRemove) {
      try {
        cached.player.dispose();
      } catch {
        // dispose 에러 무시
      }
      newPlayers.delete(key);
    }

    set({ players: newPlayers });
    console.log(`[KeysoundPlayerStore] Cleaned up ${toRemove.length} old players`);
  },
}));

/**
 * 페이지 언로드 시 모든 플레이어 정리
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    useKeysoundPlayerStore.getState().clearAll();
  });
}
