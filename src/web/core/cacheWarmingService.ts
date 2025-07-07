/**
 * Cache Warming Service
 * 
 * Proactively loads directory structures and important files in the background
 * to improve workspace opening performance.
 */

import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { CacheManager, DirectoryEntry } from './cacheManager';

export interface WarmingStrategy {
  immediate: string[];      // Paths to load immediately
  background: string[];     // Paths to load in background
  onDemand: string[];      // Paths to load on first access
}

export class CacheWarmingService {
  private static readonly WARMING_BATCH_SIZE = 10;
  private static readonly WARMING_DELAY_MS = 100;
  private static readonly MAX_CONCURRENT_REQUESTS = 5;
  
  private warmingQueue: string[] = [];
  private activeWarming = new Set<string>();
  private warmingTimer?: NodeJS.Timeout;
  private isWarming = false;
  private debugLog: (message: string, data?: any) => void;

  constructor(
    private readonly credentials: WebDAVCredentials,
    private readonly cacheManager: CacheManager,
    private readonly httpClient: {
      propFind: (path: string) => Promise<DirectoryEntry[]>;
      getFile: (path: string) => Promise<{ content: Uint8Array; headers: Record<string, string> }>;
    },
    debugLog: (message: string, data?: any) => void
  ) {
    this.debugLog = debugLog;
  }

  /**
   * Start warming cache for workspace
   */
  async startWarmingForWorkspace(): Promise<void> {
    if (this.isWarming) {
      this.debugLog('Cache warming already in progress');
      return;
    }

    this.isWarming = true;
    this.debugLog('Starting cache warming for workspace');

    try {
      const strategy = await this.createWarmingStrategy();
      
      // Load immediate paths first
      await this.warmImmediatePaths(strategy.immediate);
      
      // Queue background paths
      this.queueBackgroundPaths(strategy.background);
      
      // Start background warming
      this.startBackgroundWarming();
      
    } catch (error) {
      this.debugLog('Failed to start cache warming', { error });
      this.isWarming = false;
    }
  }

  /**
   * Stop cache warming
   */
  stopWarming(): void {
    if (this.warmingTimer) {
      clearTimeout(this.warmingTimer);
      this.warmingTimer = undefined;
    }
    
    this.warmingQueue = [];
    this.activeWarming.clear();
    this.isWarming = false;
    this.debugLog('Cache warming stopped');
  }

  /**
   * Add path to warming queue
   */
  queuePath(path: string): void {
    if (!this.warmingQueue.includes(path) && !this.activeWarming.has(path)) {
      this.warmingQueue.push(path);
      this.debugLog('Added path to warming queue', { path });
    }
  }

  /**
   * Get warming status
   */
  getWarmingStatus(): {
    isActive: boolean;
    queueSize: number;
    activeCount: number;
    completedPaths: number;
  } {
    return {
      isActive: this.isWarming,
      queueSize: this.warmingQueue.length,
      activeCount: this.activeWarming.size,
      completedPaths: 0 // This could be tracked if needed
    };
  }

  private async createWarmingStrategy(): Promise<WarmingStrategy> {
    const strategy: WarmingStrategy = {
      immediate: [],
      background: [],
      onDemand: []
    };

    // Always load root directory immediately
    strategy.immediate.push('/');

    try {
      // Get root directory listing to determine strategy
      const rootEntries = await this.loadDirectoryEntries('/');
      
      if (rootEntries) {
        // Categorize root entries
        for (const entry of rootEntries) {
          const path = `/${entry.name}`;
          
          if (this.isImportantPath(path)) {
            if (entry.type === vscode.FileType.Directory) {
              strategy.background.push(path);
            } else {
              strategy.immediate.push(path);
            }
          } else if (entry.type === vscode.FileType.Directory) {
            strategy.onDemand.push(path);
          }
        }
        
        // Add common important subdirectories
        const commonDirs = ['/src', '/app', '/public', '/assets', '/config'];
        for (const dir of commonDirs) {
          if (rootEntries.some(e => e.name === dir.substring(1) && e.type === vscode.FileType.Directory)) {
            if (!strategy.background.includes(dir)) {
              strategy.background.push(dir);
            }
          }
        }
      }

    } catch (error) {
      this.debugLog('Failed to create warming strategy', { error });
      // Fallback to basic strategy
      strategy.immediate = ['/'];
      strategy.background = ['/src', '/app', '/public'];
    }

    this.debugLog('Created warming strategy', {
      immediate: strategy.immediate.length,
      background: strategy.background.length,
      onDemand: strategy.onDemand.length
    });

    return strategy;
  }

  private async warmImmediatePaths(paths: string[]): Promise<void> {
    this.debugLog('Warming immediate paths', { count: paths.length });
    
    const promises = paths.map(path => this.warmPath(path));
    
    try {
      await Promise.all(promises);
      this.debugLog('Completed immediate path warming');
    } catch (error) {
      this.debugLog('Error warming immediate paths', { error });
    }
  }

  private queueBackgroundPaths(paths: string[]): void {
    for (const path of paths) {
      if (!this.warmingQueue.includes(path)) {
        this.warmingQueue.push(path);
      }
    }
    
    this.debugLog('Queued background paths', { count: paths.length });
  }

  private startBackgroundWarming(): void {
    if (this.warmingTimer) {
      return;
    }

    this.warmingTimer = setTimeout(() => {
      this.processWarmingQueue();
    }, CacheWarmingService.WARMING_DELAY_MS);
  }

  private async processWarmingQueue(): Promise<void> {
    if (this.warmingQueue.length === 0) {
      // No more paths to warm
      this.isWarming = false;
      this.debugLog('Background cache warming completed');
      return;
    }

    // Calculate how many slots are available
    const availableSlots = CacheWarmingService.MAX_CONCURRENT_REQUESTS - this.activeWarming.size;
    if (availableSlots <= 0) {
      // Wait for some operations to complete
      this.warmingTimer = setTimeout(() => {
        this.processWarmingQueue();
      }, CacheWarmingService.WARMING_DELAY_MS);
      return;
    }

    // Process batch efficiently - take only what we can handle
    const batchSize = Math.min(availableSlots, CacheWarmingService.WARMING_BATCH_SIZE);
    const batch = this.warmingQueue.splice(0, batchSize);
    
    // Start all warming operations in parallel
    const warmingPromises = batch.map(path => {
      this.activeWarming.add(path);
      return this.warmPath(path).finally(() => {
        this.activeWarming.delete(path);
      });
    });

    // Continue processing when operations complete
    Promise.allSettled(warmingPromises).then(() => {
      if (this.warmingQueue.length > 0) {
        // Immediately process next batch if queue has items
        setImmediate(() => this.processWarmingQueue());
      }
    });

    // Also schedule next processing as backup
    if (this.warmingQueue.length > 0) {
      this.warmingTimer = setTimeout(() => {
        this.processWarmingQueue();
      }, CacheWarmingService.WARMING_DELAY_MS);
    }
  }

  private async warmPath(path: string): Promise<void> {
    // Note: activeWarming.add() is called by the caller
    
    try {
      // Check if path is already cached
      const cachedDir = await this.cacheManager.getDirectory(path);
      if (cachedDir && cachedDir.length > 0) {
        this.debugLog('Path already cached', { path, entries: cachedDir.length });
        return;
      }

      // Load directory or file
      if (path.endsWith('/') || !path.includes('.')) {
        // Treat as directory
        await this.loadDirectoryEntries(path);
      } else {
        // Treat as file - load and cache file content
        try {
          const response = await this.httpClient.getFile(path);
          const metadata = {
            size: response.content.length,
            mtime: Date.now(),
            etag: response.headers.etag,
            contentType: response.headers['content-type']
          };
          await this.cacheManager.setFile(path, response.content, metadata);
          this.debugLog('Loaded file content', { path, size: response.content.length });
        } catch (error) {
          this.debugLog('Failed to load file content', { path, error });
        }
      }

    } catch (error) {
      this.debugLog('Failed to warm path', { path, error });
    }
  }

  private async loadDirectoryEntries(path: string): Promise<DirectoryEntry[] | null> {
    try {
      const entries = await this.httpClient.propFind(path);
      await this.cacheManager.setDirectory(path, entries);
      
      this.debugLog('Loaded directory entries', { path, count: entries.length });
      
      // Queue important subdirectories for background warming
      for (const entry of entries) {
        if (entry.type === vscode.FileType.Directory) {
          const subPath = `${path}/${entry.name}`.replace(/\/+/g, '/');
          if (this.isImportantPath(subPath)) {
            this.queuePath(subPath);
          }
        }
      }
      
      return entries;
    } catch (error) {
      this.debugLog('Failed to load directory entries', { path, error });
      return null;
    }
  }


  private isImportantPath(path: string): boolean {
    // Root level files and directories
    if (path.split('/').length <= 2) {
      return true;
    }
    
    // Important file types
    const importantExtensions = ['.json', '.md', '.txt', '.xml', '.yml', '.yaml', '.php', '.js', '.css', '.html'];
    const extension = path.includes('.') ? '.' + path.split('.').pop() : '';
    
    if (importantExtensions.includes(extension)) {
      return true;
    }
    
    // Important directories
    const importantDirs = ['/src', '/app', '/public', '/assets', '/config', '/includes', '/lib'];
    const pathLower = path.toLowerCase();
    
    return importantDirs.some(dir => pathLower.includes(dir));
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopWarming();
  }
}