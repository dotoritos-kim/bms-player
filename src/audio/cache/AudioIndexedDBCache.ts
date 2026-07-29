/**
 * AudioIndexedDBCache
 *
 * IndexedDB-backed audio file cache.
 * - Persists ArrayBuffers.
 * - LRU-based automatic cleanup.
 * - Expiration-time management.
 */

const DB_NAME = 'rhythm-archive-audio-cache';
const DB_VERSION = 1;
const STORE_NAME = 'audio-files';
const METADATA_STORE = 'cache-metadata';

// Cache settings.
const MAX_CACHE_SIZE_MB = 500; // Up to 500 MB.
const MAX_CACHE_ENTRIES = 2000; // Up to 2000 files.
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

export interface CachedAudioEntry {
  key: string; // URL-based key.
  data: ArrayBuffer;
  size: number;
  timestamp: number; // Last access time.
  createdAt: number;
  expiresAt: number;
}

export interface CacheMetadata {
  totalSize: number;
  entryCount: number;
  lastCleanup: number;
}

class AudioIndexedDBCache {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private isInitialized = false;
  private lastCleanupTime = 0;
  private readonly CLEANUP_DEBOUNCE_MS = 30_000; // At least 30 s apart.

  /**
   * Initializes IndexedDB.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[AudioCache] IndexedDB open error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Audio file store.
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
        }

        // Metadata store.
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Reads audio data from the cache.
   */
  async get(key: string): Promise<ArrayBuffer | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result as CachedAudioEntry | undefined;

        if (!entry) {
          resolve(null);
          return;
        }

        // Expiration check.
        if (entry.expiresAt < Date.now()) {
          store.delete(key);
          resolve(null);
          return;
        }

        // LRU: refresh the timestamp.
        entry.timestamp = Date.now();
        store.put(entry);

        resolve(entry.data);
      };

      request.onerror = () => {
        console.warn('[AudioCache] Get error:', request.error);
        resolve(null);
      };
    });
  }

  /**
   * Stores audio data in the cache.
   */
  async set(key: string, data: ArrayBuffer, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
    await this.init();
    if (!this.db) return;

    const now = Date.now();
    const entry: CachedAudioEntry = {
      key,
      data,
      size: data.byteLength,
      timestamp: now,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => {
        // Run cache cleanup asynchronously.
        this.maybeCleanup().catch(console.warn);
        resolve();
      };

      request.onerror = () => {
        console.warn('[AudioCache] Set error:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Reads multiple keys at once (batch).
   */
  async getMany(keys: string[]): Promise<Map<string, ArrayBuffer>> {
    await this.init();
    if (!this.db) return new Map();

    const results = new Map<string, ArrayBuffer>();
    const now = Date.now();

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      let completed = 0;
      const total = keys.length;

      if (total === 0) {
        resolve(results);
        return;
      }

      for (const key of keys) {
        const request = store.get(key);

        request.onsuccess = () => {
          const entry = request.result as CachedAudioEntry | undefined;

          if (entry && entry.expiresAt >= now) {
            results.set(key, entry.data);
            // LRU update.
            entry.timestamp = now;
            store.put(entry);
          }

          completed++;
          if (completed === total) {
            resolve(results);
          }
        };

        request.onerror = () => {
          completed++;
          if (completed === total) {
            resolve(results);
          }
        };
      }
    });
  }

  /**
   * Stores multiple entries at once (batch).
   */
  async setMany(entries: Array<{ key: string; data: ArrayBuffer }>): Promise<void> {
    await this.init();
    if (!this.db) return;

    const now = Date.now();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      for (const { key, data } of entries) {
        const entry: CachedAudioEntry = {
          key,
          data,
          size: data.byteLength,
          timestamp: now,
          createdAt: now,
          expiresAt: now + DEFAULT_TTL_MS,
        };
        store.put(entry);
      }

      transaction.oncomplete = () => {
        this.maybeCleanup().catch(console.warn);
        resolve();
      };

      transaction.onerror = () => {
        console.warn('[AudioCache] SetMany error:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  /**
   * Deletes a cache entry.
   */
  async delete(key: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Deletes cached entries matching a URL prefix (e.g. every file of a repository).
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();

      let deletedCount = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if ((cursor.value as CachedAudioEntry).key.startsWith(prefix)) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };

      request.onerror = () => resolve(deletedCount);
    });
  }

  /**
   * Reads cache statistics.
   */
  async getStats(): Promise<{ totalSize: number; entryCount: number; oldestEntry: number | null }> {
    await this.init();
    if (!this.db) return { totalSize: 0, entryCount: 0, oldestEntry: null };

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);

      let totalSize = 0;
      let entryCount = 0;
      let oldestEntry: number | null = null;

      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const entry = cursor.value as CachedAudioEntry;
          totalSize += entry.size;
          entryCount++;
          if (oldestEntry === null || entry.timestamp < oldestEntry) {
            oldestEntry = entry.timestamp;
          }
          cursor.continue();
        } else {
          resolve({ totalSize, entryCount, oldestEntry });
        }
      };

      request.onerror = () => resolve({ totalSize: 0, entryCount: 0, oldestEntry: null });
    });
  }

  /**
   * Cleans up the cache when needed (LRU) — debounced to at least 30 s apart.
   */
  private async maybeCleanup(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupTime < this.CLEANUP_DEBOUNCE_MS) return;
    this.lastCleanupTime = now;

    const stats = await this.getStats();
    const maxSizeBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;

    // Clean up when size or entry count is exceeded.
    if (stats.totalSize > maxSizeBytes || stats.entryCount > MAX_CACHE_ENTRIES) {
      await this.cleanup(Math.floor(stats.entryCount * 0.2)); // Delete 20%.
    }
  }

  /**
   * Cleans up the oldest entries (LRU).
   */
  async cleanup(count: number = 100): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.openCursor();

      let deletedCount = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && deletedCount < count) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          console.log(`[AudioCache] Cleaned up ${deletedCount} entries`);
          resolve(deletedCount);
        }
      };

      request.onerror = () => resolve(deletedCount);
    });
  }

  /**
   * Cleans up expired entries.
   */
  async cleanupExpired(): Promise<number> {
    await this.init();
    if (!this.db) return 0;

    const now = Date.now();

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('expiresAt');
      const range = IDBKeyRange.upperBound(now);
      const request = index.openCursor(range);

      let deletedCount = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          console.log(`[AudioCache] Cleaned up ${deletedCount} expired entries`);
          resolve(deletedCount);
        }
      };

      request.onerror = () => resolve(deletedCount);
    });
  }

  /**
   * Clears the entire cache.
   */
  async clear(): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('[AudioCache] Cache cleared');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Closes the DB connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      this.initPromise = null;
    }
  }
}

// Singleton instance.
export const audioIndexedDBCache = new AudioIndexedDBCache();
