import * as vscode from 'vscode';
import { WebDAVCredentials, WebDAVFileItem } from '../types';
import { CacheManager } from './cacheManager';
import { WebDAVApi } from './webdavApi';

export interface IndexedFile {
	path: string;
	name: string;
	isDirectory: boolean;
	lastModified: number;
}

export class WebDAVFileIndex {
	private _credentials: WebDAVCredentials | null = null;
	private _fileIndex: Map<string, IndexedFile> = new Map();
	private _directoryIndex: Map<string, Set<string>> = new Map();
	private _isIndexing: boolean = false;
	private _indexingPromise: Promise<void> | null = null;
	private _debugLog: (message: string, data?: any) => void = () => {};
	private _cacheManager: CacheManager | null = null;
	private _batchSize: number = 50;
	private _maxConcurrentRequests: number = 5;
	private _onIndexUpdatedCallback: (() => Promise<void>) | null = null;
	private _webdavApi: WebDAVApi | null = null;

	constructor(credentials: WebDAVCredentials | null = null, cacheManager: CacheManager | null = null) {
		this._credentials = credentials;
		this._cacheManager = cacheManager;
		if (credentials) {
			this._webdavApi = new WebDAVApi(credentials, this._debugLog);
		}
	}

	setCredentials(credentials: WebDAVCredentials | null) {
		this._credentials = credentials;
		if (credentials) {
			this._webdavApi = new WebDAVApi(credentials, this._debugLog);
		} else {
			this._webdavApi = null;
		}
		// Clear existing index when credentials change
		this.clearIndex();
	}

	setCacheManager(cacheManager: CacheManager) {
		this._cacheManager = cacheManager;
	}

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this._debugLog = logger;
		if (this._credentials) {
			this._webdavApi = new WebDAVApi(this._credentials, logger);
		}
	}

	setOnIndexUpdatedCallback(callback: (() => Promise<void>) | null) {
		this._onIndexUpdatedCallback = callback;
	}

	clearIndex() {
		this._fileIndex.clear();
		this._directoryIndex.clear();
		this._debugLog('File index cleared');
	}

	async ensureIndexed(): Promise<void> {
		if (this._isIndexing && this._indexingPromise) {
			// If indexing is already in progress, wait for it to complete
			await this._indexingPromise;
			return;
		}

		if (this._fileIndex.size === 0 && this._credentials) {
			// Start indexing if not already done
			await this.rebuildIndex();
		}
	}

	async rebuildIndex(): Promise<void> {
		if (!this._credentials) {
			this._debugLog('Cannot rebuild index: no credentials');
			return;
		}

		if (this._isIndexing) {
			this._debugLog('Index rebuild already in progress');
			return;
		}

		this._isIndexing = true;
		this._debugLog('Starting optimized file index rebuild');
		
		try {
			this.clearIndex();
			this._indexingPromise = this.batchIndexDirectory('');
			await this._indexingPromise;
			this._debugLog('File index rebuild completed', { 
				totalFiles: this._fileIndex.size,
				totalDirectories: this._directoryIndex.size 
			});
			
			// Call the update callback if set
			if (this._onIndexUpdatedCallback) {
				try {
					await this._onIndexUpdatedCallback();
				} catch (error: any) {
					this._debugLog('Error in index update callback', { error: error.message });
				}
			}
		} catch (error: any) {
			this._debugLog('Error rebuilding index', { error: error.message });
			throw error;
		} finally {
			this._isIndexing = false;
			this._indexingPromise = null;
		}
	}

	async quickIndex(): Promise<void> {
		if (!this._credentials) {
			this._debugLog('Cannot quick index: no credentials');
			return;
		}

		if (this._isIndexing) {
			this._debugLog('Indexing already in progress');
			return;
		}

		this._isIndexing = true;
		this._debugLog('Starting quick index (root level only)');
		
		try {
			// Only index the root directory for immediate workspace availability
			await this.indexSingleDirectory('');
			this._debugLog('Quick index completed', { 
				rootFiles: this._directoryIndex.get('')?.size || 0
			});
			
			// Call the update callback if set
			if (this._onIndexUpdatedCallback) {
				try {
					await this._onIndexUpdatedCallback();
				} catch (error: any) {
					this._debugLog('Error in index update callback', { error: error.message });
				}
			}
		} catch (error: any) {
			this._debugLog('Error during quick index', { error: error.message });
			throw error;
		} finally {
			this._isIndexing = false;
		}
	}

	private async batchIndexDirectory(dirPath: string): Promise<void> {
		const directoriesToProcess = [dirPath];
		const processedDirectories = new Set<string>();
		
		while (directoriesToProcess.length > 0) {
			// Process directories in batches
			const currentBatch = directoriesToProcess.splice(0, this._batchSize);
			const batchPromises = currentBatch.map(dir => 
				this.processBatchDirectory(dir, directoriesToProcess, processedDirectories)
			);
			
			// Limit concurrent requests
			const batches = [];
			for (let i = 0; i < batchPromises.length; i += this._maxConcurrentRequests) {
				batches.push(batchPromises.slice(i, i + this._maxConcurrentRequests));
			}
			
			for (const batch of batches) {
				await Promise.all(batch);
				// Small delay to prevent overwhelming the server
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		}
	}

	private async processBatchDirectory(
		dirPath: string, 
		directoriesToProcess: string[], 
		processedDirectories: Set<string>
	): Promise<void> {
		if (processedDirectories.has(dirPath)) {
			return;
		}
		
		processedDirectories.add(dirPath);
		
		try {
			const items = await this.getDirectoryListingWithCache(dirPath);
			const childPaths = new Set<string>();
			
			for (const item of items) {
				const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
				childPaths.add(itemPath);
				
				const indexedFile: IndexedFile = {
					path: itemPath,
					name: item.name,
					isDirectory: item.isDirectory,
					lastModified: Date.now()
				};
				
				this._fileIndex.set(itemPath, indexedFile);
				
				if (item.isDirectory && 
					!processedDirectories.has(itemPath)) {
					directoriesToProcess.push(itemPath);
				}
			}
			
			this._directoryIndex.set(dirPath, childPaths);
			
		} catch (error: any) {
			this._debugLog('Error processing batch directory', { dirPath, error: error.message });
		}
	}

	private async indexSingleDirectory(dirPath: string): Promise<void> {
		try {
			const items = await this.getDirectoryListingWithCache(dirPath);
			const childPaths = new Set<string>();
			
			for (const item of items) {
				const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
				childPaths.add(itemPath);
				
				const indexedFile: IndexedFile = {
					path: itemPath,
					name: item.name,
					isDirectory: item.isDirectory,
					lastModified: Date.now()
				};
				
				this._fileIndex.set(itemPath, indexedFile);
			}
			
			this._directoryIndex.set(dirPath, childPaths);
			
		} catch (error: any) {
			this._debugLog('Error indexing single directory', { dirPath, error: error.message });
		}
	}

	private async getDirectoryListingWithCache(dirPath: string): Promise<WebDAVFileItem[]> {
		// Check cache first
		if (this._cacheManager) {
			const cached = await this._cacheManager.getDirectory(dirPath);
			if (cached) {
				// Convert cache entries to WebDAVFileItem format
				return cached.map(entry => ({
					name: entry.name,
					isDirectory: entry.type === vscode.FileType.Directory,
					size: entry.size.toString(),
					lastModified: new Date(entry.mtime).toISOString(),
					type: entry.type === vscode.FileType.Directory ? 'Collection' : 'File',
					modified: new Date(entry.mtime).toISOString(),
					path: `${dirPath}/${entry.name}`.replace(/\/+/g, '/')
				}));
			}
		}

		// Fallback to direct listing via WebDAV API
		if (!this._webdavApi) {
			return [];
		}
		const response = await this._webdavApi.getDirectoryListing(dirPath);
		return response.success ? response.items : [];
	}


	// Method to add virtual files directly to the index
	addVirtualFileToIndex(filePath: string, isDirectory: boolean, lastModified: number = Date.now()): void {
		const fileName = this.getFileName(filePath);
		const parentPath = this.getParentPath(filePath);
		
		const indexedFile: IndexedFile = {
			path: filePath,
			name: fileName,
			isDirectory: isDirectory,
			lastModified: lastModified
		};
		
		this._fileIndex.set(filePath, indexedFile);
		
		// Update directory index
		const parentChildren = this._directoryIndex.get(parentPath) || new Set();
		parentChildren.add(filePath);
		this._directoryIndex.set(parentPath, parentChildren);
		
		this._debugLog('Virtual file added to index', { filePath, isDirectory, fileName, parentPath });
	}

	// Debug method to get all indexed files
	getAllIndexedFiles(): IndexedFile[] {
		return Array.from(this._fileIndex.values());
	}

	// Debug method to get index size
	getIndexSize(): number {
		return this._fileIndex.size;
	}

	// File operation event handlers
	async onFileCreated(filePath: string): Promise<void> {
		if (!this._credentials) { return; }
		
		try {
			const parentPath = this.getParentPath(filePath);
			const fileName = this.getFileName(filePath);
			
			// Try to get file info
			if (!this._webdavApi) {
				return;
			}
			const response = await this._webdavApi.getDirectoryListing(parentPath);
			if (!response.success) {
				return;
			}
			const item = response.items.find(i => i.name === fileName);
			
			if (item) {
				const indexedFile: IndexedFile = {
					path: filePath,
					name: item.name,
					isDirectory: item.isDirectory,
					lastModified: Date.now()
				};
				
				this._fileIndex.set(filePath, indexedFile);
				
				// Update directory index
				const parentChildren = this._directoryIndex.get(parentPath) || new Set();
				parentChildren.add(filePath);
				this._directoryIndex.set(parentPath, parentChildren);
				
				this._debugLog('File added to index', { filePath, isDirectory: item.isDirectory });
			}
		} catch (error: any) {
			this._debugLog('Error adding file to index', { filePath, error: error.message });
		}
	}

	async onFileDeleted(filePath: string): Promise<void> {
		const deletedFile = this._fileIndex.get(filePath);
		if (!deletedFile) { return; }
		
		// Remove from file index
		this._fileIndex.delete(filePath);
		
		// Update directory index
		const parentPath = this.getParentPath(filePath);
		const parentChildren = this._directoryIndex.get(parentPath);
		if (parentChildren) {
			parentChildren.delete(filePath);
		}
		
		// If it was a directory, remove all children
		if (deletedFile.isDirectory) {
			this.removeDirectoryFromIndex(filePath);
		}
		
		this._debugLog('File removed from index', { filePath });
	}

	async onFileRenamed(oldPath: string, newPath: string): Promise<void> {
		const oldFile = this._fileIndex.get(oldPath);
		if (!oldFile) { return; }
		
		// Remove old entry
		await this.onFileDeleted(oldPath);
		
		// Add new entry
		await this.onFileCreated(newPath);
		
		this._debugLog('File renamed in index', { oldPath, newPath });
	}

	private removeDirectoryFromIndex(dirPath: string): void {
		// Remove all files that start with this directory path
		const toRemove: string[] = [];
		for (const [path] of this._fileIndex) {
			if (path.startsWith(dirPath + '/')) {
				toRemove.push(path);
			}
		}
		
		for (const path of toRemove) {
			this._fileIndex.delete(path);
		}
		
		// Remove directory from directory index
		this._directoryIndex.delete(dirPath);
		
		this._debugLog('Directory removed from index', { dirPath, removedFiles: toRemove.length });
	}

	// Search methods using the index
	searchFiles(pattern: string): string[] {
		const results: string[] = [];
		
		// Simple substring search for now
		const lowerPattern = pattern.toLowerCase();
		
		for (const [path, file] of this._fileIndex) {
			if (!file.isDirectory && file.name.toLowerCase().includes(lowerPattern)) {
				results.push(path);
			}
		}
		
		this._debugLog('File search completed', { pattern, resultCount: results.length });
		return results;
	}

	getAllFiles(): string[] {
		const files: string[] = [];
		for (const [path, file] of this._fileIndex) {
			if (!file.isDirectory) {
				files.push(path);
			}
		}
		return files;
	}

	getIndexStats(): { files: number; directories: number; totalEntries: number } {
		let files = 0;
		let directories = 0;
		
		for (const file of this._fileIndex.values()) {
			if (file.isDirectory) {
				directories++;
			} else {
				files++;
			}
		}
		
		return {
			files,
			directories,
			totalEntries: this._fileIndex.size
		};
	}


	private getParentPath(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash > 0 ? filePath.substring(0, lastSlash) : '';
	}

	private getFileName(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
	}


}