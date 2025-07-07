/**
 * WebDAV Cache Manager
 * 
 * Provides persistent caching for WebDAV operations to improve performance
 * and reduce workspace opening lag.
 */

import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';

export interface CacheEntry {
  content: Uint8Array;
  metadata: {
    size: number;
    mtime: number;
    etag?: string;
    contentType?: string;
    lastAccessed: number;
    accessCount: number;
  };
  expires: number;
}

export interface DirectoryEntry {
  name: string;
  type: vscode.FileType;
  size: number;
  mtime: number;
  etag?: string;
}

export interface DirectoryCache {
  entries: DirectoryEntry[];
  lastFetched: number;
  etag?: string;
  expires: number;
}

export class CacheManager {
  private static readonly CACHE_VERSION = '1.0';
  private static readonly MAX_CACHE_SIZE_MB = 50;
  private static readonly MAX_CACHE_ENTRIES = 1000;
  private static readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly DIRECTORY_TTL_MS = 2 * 60 * 1000; // 2 minutes
  private static readonly CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

  private memoryCache = new Map<string, CacheEntry>();
  private directoryCache = new Map<string, DirectoryCache>();
  private accessOrder: string[] = [];
  private currentCacheSize = 0;
  private cleanupTimer?: NodeJS.Timeout;
  private debugLog: (message: string, data?: any) => void;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly credentials: WebDAVCredentials | null,
    debugLog: (message: string, data?: any) => void
  ) {
    this.debugLog = debugLog;
    this.startCleanupTimer();
    this.loadPersistentCache();
  }

  /**
   * Get cached file content
   */
  async getFile(path: string): Promise<Uint8Array | null> {
    const key = this.getCacheKey(path);
    const entry = this.memoryCache.get(key);

    if (!entry) {
      return null;
    }

    // Check if cache entry is expired
    if (Date.now() > entry.expires) {
      this.memoryCache.delete(key);
      this.removeFromAccessOrder(key);
      return null;
    }

    // Update access statistics
    entry.metadata.lastAccessed = Date.now();
    entry.metadata.accessCount++;
    this.updateAccessOrder(key);

    this.debugLog('Cache hit for file', { path, size: entry.content.length });
    return entry.content;
  }

  /**
   * Cache file content
   */
  async setFile(path: string, content: Uint8Array, metadata: {
    size: number;
    mtime: number;
    etag?: string;
    contentType?: string;
  }): Promise<void> {
    const key = this.getCacheKey(path);
    const ttl = this.getTTL(path);
    
    const entry: CacheEntry = {
      content,
      metadata: {
        ...metadata,
        lastAccessed: Date.now(),
        accessCount: 1
      },
      expires: Date.now() + ttl
    };

    // Check if we need to evict entries
    const entrySize = content.length;
    while (this.shouldEvict(entrySize)) {
      this.evictLRU();
    }

    this.memoryCache.set(key, entry);
    this.currentCacheSize += entrySize;
    this.updateAccessOrder(key);

    this.debugLog('Cached file', { path, size: entrySize, totalSize: this.currentCacheSize });

    // Store in persistent cache for frequently accessed files
    if (entry.metadata.accessCount > 2 || this.isImportantFile(path)) {
      this.saveToPersistentCache(key, entry);
    }
  }

  /**
   * Get cached directory listing
   */
  async getDirectory(path: string): Promise<DirectoryEntry[] | null> {
    const key = this.getCacheKey(path);
    const cached = this.directoryCache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache entry is expired
    if (Date.now() > cached.expires) {
      this.directoryCache.delete(key);
      return null;
    }

    this.debugLog('Directory cache hit', { path, entryCount: cached.entries.length });
    return cached.entries;
  }

  /**
   * Cache directory listing
   */
  async setDirectory(path: string, entries: DirectoryEntry[], etag?: string): Promise<void> {
    const key = this.getCacheKey(path);
    
    const cached: DirectoryCache = {
      entries,
      lastFetched: Date.now(),
      etag,
      expires: Date.now() + CacheManager.DIRECTORY_TTL_MS
    };

    this.directoryCache.set(key, cached);
    this.debugLog('Cached directory', { path, entryCount: entries.length });
  }

  /**
   * Delete cached file content
   */
  async deleteFile(path: string): Promise<void> {
    const key = this.getCacheKey(path);
    const entry = this.memoryCache.get(key);
    
    if (entry) {
      this.currentCacheSize -= entry.content.length;
      this.memoryCache.delete(key);
      this.removeFromAccessOrder(key);
      this.debugLog('Deleted file from cache', { path, size: entry.content.length });
    } else {
      this.debugLog('File not found in cache for deletion', { path });
    }
  }

  /**
   * Delete cached directory listing
   */
  async deleteDirectory(path: string): Promise<void> {
    const key = this.getCacheKey(path);
    const cached = this.directoryCache.get(key);
    
    if (cached) {
      this.directoryCache.delete(key);
      this.debugLog('Deleted directory from cache', { path, entryCount: cached.entries.length });
    } else {
      this.debugLog('Directory not found in cache for deletion', { path });
    }
  }

  /**
   * Delete all cache entries that start with the given path (for recursive deletes)
   */
  async deleteRecursive(basePath: string): Promise<void> {
    const baseKey = this.getCacheKey(basePath);
    let deletedFiles = 0;
    let deletedDirectories = 0;
    let freedSize = 0;

    // Delete all files that start with this path
    for (const [key, entry] of this.memoryCache.entries()) {
      if (key.startsWith(baseKey)) {
        freedSize += entry.content.length;
        this.memoryCache.delete(key);
        this.removeFromAccessOrder(key);
        deletedFiles++;
      }
    }

    // Delete all directories that start with this path
    for (const [key] of this.directoryCache.entries()) {
      if (key.startsWith(baseKey)) {
        this.directoryCache.delete(key);
        deletedDirectories++;
      }
    }

    this.currentCacheSize -= freedSize;
    this.debugLog('Recursive cache deletion completed', { 
      basePath, 
      deletedFiles, 
      deletedDirectories, 
      freedSize 
    });
  }


  /**
   * Get cache statistics
   */
  getCacheStats(): {
    fileCount: number;
    directoryCount: number;
    totalSize: number;
    hitRate: number;
    mostAccessed: string[];
  } {
    const totalAccess = Array.from(this.memoryCache.values())
      .reduce((sum, entry) => sum + entry.metadata.accessCount, 0);
    
    const mostAccessed = Array.from(this.memoryCache.entries())
      .sort((a, b) => b[1].metadata.accessCount - a[1].metadata.accessCount)
      .slice(0, 10)
      .map(([key]) => key);

    return {
      fileCount: this.memoryCache.size,
      directoryCount: this.directoryCache.size,
      totalSize: this.currentCacheSize,
      hitRate: totalAccess > 0 ? (this.memoryCache.size / totalAccess) * 100 : 0,
      mostAccessed
    };
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    this.memoryCache.clear();
    this.directoryCache.clear();
    this.accessOrder = [];
    this.currentCacheSize = 0;
    
    await this.clearPersistentCache();
    this.debugLog('Cache cleared');
  }


  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  private getCacheKey(path: string): string {
    const base = this.credentials ? `${this.credentials.url}/${this.credentials.project}` : 'default';
    // Normalize path for consistent cache keys
    const normalizedPath = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    return `${base}:${normalizedPath}`;
  }

  private getTTL(path: string): number {
    // Important files get longer TTL
    if (this.isImportantFile(path)) {
      return CacheManager.DEFAULT_TTL_MS * 2;
    }
    
    // Frequently accessed files get standard TTL
    return CacheManager.DEFAULT_TTL_MS;
  }

  private isImportantFile(path: string): boolean {
    const importantExtensions = ['.json', '.md', '.txt', '.xml', '.yml', '.yaml'];
    const importantFiles = ['package.json', 'composer.json', 'README.md', 'index.php', 'index.html'];
    
    const fileName = path.split('/').pop() || '';
    const extension = fileName.includes('.') ? '.' + fileName.split('.').pop() : '';
    
    return importantFiles.includes(fileName) || 
           importantExtensions.includes(extension) ||
           path.split('/').length <= 2; // Root level files
  }

  private shouldEvict(newEntrySize: number): boolean {
    const maxSizeBytes = CacheManager.MAX_CACHE_SIZE_MB * 1024 * 1024;
    
    return this.memoryCache.size >= CacheManager.MAX_CACHE_ENTRIES ||
           (this.currentCacheSize + newEntrySize) > maxSizeBytes;
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) {
      return;
    }
    
    const keyToEvict = this.accessOrder.shift()!;
    const entry = this.memoryCache.get(keyToEvict);
    
    if (entry) {
      this.currentCacheSize -= entry.content.length;
      this.memoryCache.delete(keyToEvict);
      this.debugLog('Evicted LRU entry', { key: keyToEvict, size: entry.content.length });
    }
  }

  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);
  }

  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, CacheManager.CLEANUP_INTERVAL_MS);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    // Clean file cache
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expires) {
        this.currentCacheSize -= entry.content.length;
        this.memoryCache.delete(key);
        this.removeFromAccessOrder(key);
        cleanedCount++;
      }
    }
    
    // Clean directory cache
    for (const [key, cached] of this.directoryCache.entries()) {
      if (now > cached.expires) {
        this.directoryCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      this.debugLog('Cleaned up expired cache entries', { count: cleanedCount });
    }
  }

  private async loadPersistentCache(): Promise<void> {
    try {
      const cacheKey = `webdav-cache-${CacheManager.CACHE_VERSION}`;
      const stored = await this.context.globalState.get(cacheKey);
      
      if (stored) {
        this.debugLog('Loaded persistent cache entries');
      }
    } catch (error) {
      this.debugLog('Failed to load persistent cache', { error });
    }
  }

  private async saveToPersistentCache(key: string, entry: CacheEntry): Promise<void> {
    try {
      // Only save metadata to persistent storage, not content (too large)
      const cacheKey = `webdav-cache-${CacheManager.CACHE_VERSION}`;
      const existing = await this.context.globalState.get(cacheKey, {});
      
      await this.context.globalState.update(cacheKey, {
        ...existing,
        [key]: {
          metadata: entry.metadata,
          expires: entry.expires
        }
      });
    } catch (error) {
      this.debugLog('Failed to save to persistent cache', { error });
    }
  }

  private async clearPersistentCache(): Promise<void> {
    try {
      const cacheKey = `webdav-cache-${CacheManager.CACHE_VERSION}`;
      await this.context.globalState.update(cacheKey, undefined);
    } catch (error) {
      this.debugLog('Failed to clear persistent cache', { error });
    }
  }
}