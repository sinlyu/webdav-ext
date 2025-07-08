/**
 * Simple Cache Implementation
 * 
 * Replaces the complex LRU cache system with a simple Map-based cache
 * with TTL expiration and size limits
 */

import { createChildLogger, ChildLogger } from '../utils/logger';

export interface CacheEntry<T> {
	value: T;
	timestamp: number;
	ttl: number;
	size: number;
}

export interface CacheOptions {
	defaultTTL?: number;
	maxSize?: number;
	maxEntries?: number;
	cleanupInterval?: number;
}

export class SimpleCache<T> {
	private cache = new Map<string, CacheEntry<T>>();
	private currentSize = 0;
	private cleanupTimer?: NodeJS.Timeout;
	private logger: ChildLogger;

	private readonly defaultTTL: number;
	private readonly maxSize: number;
	private readonly maxEntries: number;
	private readonly cleanupInterval: number;

	constructor(options: CacheOptions = {}) {
		this.defaultTTL = options.defaultTTL ?? 5 * 60 * 1000; // 5 minutes
		this.maxSize = options.maxSize ?? 50 * 1024 * 1024; // 50MB
		this.maxEntries = options.maxEntries ?? 1000;
		this.cleanupInterval = options.cleanupInterval ?? 60 * 1000; // 1 minute

		this.logger = createChildLogger('SimpleCache');
		this.startCleanupTimer();
	}

	/**
	 * Get value from cache
	 */
	get(key: string): T | undefined {
		const entry = this.cache.get(key);
		if (!entry) {
			return undefined;
		}

		// Check if expired
		if (Date.now() > entry.timestamp + entry.ttl) {
			this.delete(key);
			return undefined;
		}

		this.logger.debug('Cache hit', { key, size: entry.size });
		return entry.value;
	}

	/**
	 * Set value in cache
	 */
	set(key: string, value: T, ttl?: number): void {
		const size = this.calculateSize(value);
		const entry: CacheEntry<T> = {
			value,
			timestamp: Date.now(),
			ttl: ttl ?? this.defaultTTL,
			size
		};

		// Remove existing entry if it exists
		this.delete(key);

		// Ensure we have space
		this.ensureSpace(size);

		// Add new entry
		this.cache.set(key, entry);
		this.currentSize += size;

		this.logger.debug('Cache set', { key, size, ttl: entry.ttl });
	}

	/**
	 * Delete value from cache
	 */
	delete(key: string): boolean {
		const entry = this.cache.get(key);
		if (!entry) {
			return false;
		}

		this.cache.delete(key);
		this.currentSize -= entry.size;
		this.logger.debug('Cache delete', { key, size: entry.size });
		return true;
	}

	/**
	 * Clear all cache entries
	 */
	clear(): void {
		this.cache.clear();
		this.currentSize = 0;
		this.logger.debug('Cache cleared');
	}

	/**
	 * Get cache statistics
	 */
	getStats(): {
		entries: number;
		size: number;
		hitRate: number;
		maxSize: number;
		maxEntries: number;
	} {
		return {
			entries: this.cache.size,
			size: this.currentSize,
			hitRate: 0, // Simple implementation doesn't track hits
			maxSize: this.maxSize,
			maxEntries: this.maxEntries
		};
	}

	/**
	 * Dispose of cache resources
	 */
	dispose(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
		}
		this.clear();
	}

	/**
	 * Calculate approximate size of a value
	 */
	private calculateSize(value: T): number {
		if (value instanceof Uint8Array) {
			return value.length;
		}
		if (typeof value === 'string') {
			return value.length * 2; // Approximate Unicode size
		}
		if (typeof value === 'object' && value !== null) {
			return JSON.stringify(value).length * 2;
		}
		return 1; // Default size for primitives
	}

	/**
	 * Ensure we have space for a new entry
	 */
	private ensureSpace(requiredSize: number): void {
		// Check size limit
		while (this.currentSize + requiredSize > this.maxSize && this.cache.size > 0) {
			this.evictOldest();
		}

		// Check entry limit
		while (this.cache.size >= this.maxEntries && this.cache.size > 0) {
			this.evictOldest();
		}
	}

	/**
	 * Evict the oldest entry
	 */
	private evictOldest(): void {
		let oldestKey: string | undefined;
		let oldestTime = Date.now();

		for (const [key, entry] of this.cache.entries()) {
			if (entry.timestamp < oldestTime) {
				oldestTime = entry.timestamp;
				oldestKey = key;
			}
		}

		if (oldestKey) {
			this.logger.debug('Evicting oldest entry', { key: oldestKey });
			this.delete(oldestKey);
		}
	}

	/**
	 * Start cleanup timer
	 */
	private startCleanupTimer(): void {
		this.cleanupTimer = setInterval(() => {
			this.cleanup();
		}, this.cleanupInterval);
	}

	/**
	 * Clean up expired entries
	 */
	private cleanup(): void {
		const now = Date.now();
		const expiredKeys: string[] = [];

		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.timestamp + entry.ttl) {
				expiredKeys.push(key);
			}
		}

		for (const key of expiredKeys) {
			this.delete(key);
		}

		if (expiredKeys.length > 0) {
			this.logger.debug('Cleaned up expired entries', { count: expiredKeys.length });
		}
	}
}

/**
 * Specialized cache for WebDAV operations
 */
export class WebDAVCache {
	private fileCache: SimpleCache<Uint8Array>;
	private directoryCache: SimpleCache<any[]>;
	private metadataCache: SimpleCache<any>;

	constructor() {
		this.fileCache = new SimpleCache<Uint8Array>({
			defaultTTL: 5 * 60 * 1000, // 5 minutes
			maxSize: 40 * 1024 * 1024, // 40MB for files
			maxEntries: 500
		});

		this.directoryCache = new SimpleCache<any[]>({
			defaultTTL: 2 * 60 * 1000, // 2 minutes
			maxSize: 5 * 1024 * 1024, // 5MB for directories
			maxEntries: 200
		});

		this.metadataCache = new SimpleCache<any>({
			defaultTTL: 10 * 60 * 1000, // 10 minutes
			maxSize: 5 * 1024 * 1024, // 5MB for metadata
			maxEntries: 1000
		});
	}

	// File operations
	getFile(path: string): Uint8Array | undefined {
		return this.fileCache.get(path);
	}

	setFile(path: string, content: Uint8Array): void {
		this.fileCache.set(path, content);
	}

	deleteFile(path: string): void {
		this.fileCache.delete(path);
	}

	// Directory operations
	getDirectory(path: string): any[] | undefined {
		return this.directoryCache.get(path);
	}

	setDirectory(path: string, entries: any[]): void {
		this.directoryCache.set(path, entries);
	}

	deleteDirectory(path: string): void {
		this.directoryCache.delete(path);
	}

	// Metadata operations
	getMetadata(path: string): any | undefined {
		return this.metadataCache.get(path);
	}

	setMetadata(path: string, metadata: any): void {
		this.metadataCache.set(path, metadata);
	}

	deleteMetadata(path: string): void {
		this.metadataCache.delete(path);
	}

	// Bulk operations
	deleteRecursive(basePath: string): void {
		// Delete all cached items that start with the base path
		const caches = [this.fileCache, this.directoryCache, this.metadataCache];
		
		for (const cache of caches) {
			const keysToDelete: string[] = [];
			const cacheMap = (cache as any).cache as Map<string, any>;
			
			for (const key of cacheMap.keys()) {
				if (key.startsWith(basePath)) {
					keysToDelete.push(key);
				}
			}
			
			for (const key of keysToDelete) {
				cache.delete(key);
			}
		}
	}

	// Clear all caches
	clear(): void {
		this.fileCache.clear();
		this.directoryCache.clear();
		this.metadataCache.clear();
	}

	// Get combined statistics
	getStats(): any {
		return {
			files: this.fileCache.getStats(),
			directories: this.directoryCache.getStats(),
			metadata: this.metadataCache.getStats()
		};
	}

	// Dispose of all resources
	dispose(): void {
		this.fileCache.dispose();
		this.directoryCache.dispose();
		this.metadataCache.dispose();
	}
}