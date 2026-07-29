/**
 * KeysoundPlayer Instance Store
 *
 * Manages KeysoundPlayer instances globally so they are reused across tab switches.
 * - Caches instances keyed by baseUrl.
 * - Keeps instances alive without calling dispose().
 * - LRU-based automatic cleanup.
 */

import { create } from 'zustand';
import type { KeysoundPlayer } from '../../types/KeysoundPlayer';

const MAX_CACHED_PLAYERS = 5; // Keep at most 5 player instances.

interface CachedPlayer {
  player: KeysoundPlayer;
  baseUrl: string;
  keysoundsHash: string; // Hash of the keysound map (checks whether it is the same song).
  lastUsed: number;
  isReady: boolean;
}

interface KeysoundPlayerStore {
  // Map of cached players (baseUrl -> CachedPlayer).
  players: Map<string, CachedPlayer>;

  // Fetches a player, or signals whether a new one needs to be created.
  getPlayer: (baseUrl: string, keysoundsHash: string) => KeysoundPlayer | null;

  // Stores a player in the cache.
  cachePlayer: (baseUrl: string, keysoundsHash: string, player: KeysoundPlayer) => void;

  // Marks a player as ready.
  markReady: (baseUrl: string) => void;

  // Removes a specific player.
  removePlayer: (baseUrl: string) => void;

  // Cleans up all players.
  clearAll: () => void;

  // Cleans up stale players (LRU).
  cleanupOldPlayers: () => void;
}

/**
 * Converts a keysound map into a hash string,
 * used to quickly compare whether two keysound sets are identical.
 */
export function hashKeysounds(keysounds: Record<string, string>): string {
  const keys = Object.keys(keysounds).sort();
  if (keys.length === 0) return 'empty';

  // Build a simple hash from the first 5 + last 5 keys + total count.
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
      // LRU: refresh the last-used time.
      cached.lastUsed = Date.now();
      // Return the player regardless of isReady (callers can check isReady themselves).
      return cached.player;
    }

    // Cache miss, or the keysound set differs.
    return null;
  },

  cachePlayer: (baseUrl: string, keysoundsHash: string, player: KeysoundPlayer) => {
    const { players, cleanupOldPlayers } = get();

    // Dispose the existing player, if any.
    const existing = players.get(baseUrl);
    if (existing && existing.player !== player) {
      try {
        existing.player.dispose();
      } catch {
        // Ignore dispose errors.
      }
    }

    // Cache the new player.
    const newPlayers = new Map(players);
    newPlayers.set(baseUrl, {
      player,
      baseUrl,
      keysoundsHash,
      lastUsed: Date.now(),
      isReady: false,
    });

    set({ players: newPlayers });

    // Clean up when the cache size is exceeded.
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
        // Ignore dispose errors.
      }

      const newPlayers = new Map(players);
      newPlayers.delete(baseUrl);
      set({ players: newPlayers });
    }
  },

  clearAll: () => {
    const { players } = get();

    // Dispose every player.
    for (const cached of players.values()) {
      try {
        cached.player.dispose();
      } catch {
        // Ignore dispose errors.
      }
    }

    set({ players: new Map() });
  },

  cleanupOldPlayers: () => {
    const { players } = get();

    if (players.size <= MAX_CACHED_PLAYERS) return;

    // Clean up the oldest players.
    const sortedEntries = Array.from(players.entries())
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    const toRemove = sortedEntries.slice(0, players.size - MAX_CACHED_PLAYERS);

    const newPlayers = new Map(players);
    for (const [key, cached] of toRemove) {
      try {
        cached.player.dispose();
      } catch {
        // Ignore dispose errors.
      }
      newPlayers.delete(key);
    }

    set({ players: newPlayers });
    console.log(`[KeysoundPlayerStore] Cleaned up ${toRemove.length} old players`);
  },
}));

/**
 * Cleans up all players when the page unloads.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    useKeysoundPlayerStore.getState().clearAll();
  });
}
