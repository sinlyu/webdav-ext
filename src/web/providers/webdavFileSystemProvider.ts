import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { WebDAVFileIndex } from '../core/fileIndex';
import { WebDAVCache } from '../core/simpleCache';
import { WebDAVApi } from '../core/webdavApi';

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _credentials: WebDAVCredentials | null = null;
	private _fileIndex: WebDAVFileIndex | null = null;
	private _cache: WebDAVCache | null = null;
	private _debugLog: (message: string, data?: any) => void = () => {};
	private _virtualFiles = new Map<string, { content: Uint8Array; mtime: number; isDirectory: boolean }>();
	private _isInitialized = false;
	private _webdavApi: WebDAVApi | null = null;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	constructor(credentials: WebDAVCredentials, context?: vscode.ExtensionContext) {
		this._credentials = credentials;
		this._webdavApi = new WebDAVApi(credentials, this._debugLog);
		this._cache = new WebDAVCache();
	}

	setFileIndex(fileIndex: WebDAVFileIndex | null) {
		this._fileIndex = fileIndex;
		if (this._fileIndex && this._cache) {
			this._fileIndex.setCache(this._cache);
		}
	}

	getFileIndex(): WebDAVFileIndex | null {
		return this._fileIndex;
	}

	setCache(cache: WebDAVCache) {
		this._cache = cache;
		if (this._fileIndex) {
			this._fileIndex.setCache(cache);
		}
	}

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this._debugLog = logger;
		if (this._credentials) {
			this._webdavApi = new WebDAVApi(this._credentials, logger);
		}
		// Simple cache doesn't need logger updates
	}


	async initialize(): Promise<void> {
		if (this._isInitialized) {
			return;
		}

		this._debugLog('Initializing WebDAV file system provider with simple caching');

		try {
			// Start full recursive indexing for complete directory caching on startup
			if (this._fileIndex) {
				this._fileIndex.rebuildIndex().catch(error => {
					this._debugLog('Full recursive index failed', { error });
				});
			}

			this._isInitialized = true;
			this._debugLog('WebDAV file system provider initialized with full recursive caching');

		} catch (error) {
			this._debugLog('Failed to initialize WebDAV file system provider', { error });
			throw error;
		}
	}

	// Virtual file management methods
	createVirtualFile(path: string, content: Uint8Array): void {
		const mtime = Date.now();
		this._virtualFiles.set(path, {
			content,
			mtime,
			isDirectory: false
		});
		this._debugLog('Created virtual file', { path, size: content.length });
		
		// Add to file index if available
		if (this._fileIndex) {
			this._fileIndex.addVirtualFileToIndex(path, false, mtime);
			this._debugLog('Added virtual file to index', { path });
		}
		
		// Emit file change event
		this._emitter.fire([{
			type: vscode.FileChangeType.Created,
			uri: this.createWebdavUri(path)
		}]);
		
		// Trigger file explorer refresh for virtual files
		this.refreshFileExplorer();
	}

	createVirtualDirectory(path: string): void {
		const mtime = Date.now();
		this._virtualFiles.set(path, {
			content: new Uint8Array(0),
			mtime,
			isDirectory: true
		});
		this._debugLog('Created virtual directory', { path });
		
		// Add to file index if available
		if (this._fileIndex) {
			this._fileIndex.addVirtualFileToIndex(path, true, mtime);
			this._debugLog('Added virtual directory to index', { path });
		}
		
		// Emit file change event
		this._emitter.fire([{
			type: vscode.FileChangeType.Created,
			uri: this.createWebdavUri(path)
		}]);
		
		// Trigger file explorer refresh for virtual files
		this.refreshFileExplorer();
	}

	hasVirtualFile(path: string): boolean {
		return this._virtualFiles.has(path);
	}

	getVirtualFile(path: string): { content: Uint8Array; mtime: number; isDirectory: boolean } | undefined {
		return this._virtualFiles.get(path);
	}

	getVirtualFileCount(): number {
		return this._virtualFiles.size;
	}

	private refreshFileExplorer(): void {
		// Use setTimeout to defer the refresh to avoid blocking the main thread
		setTimeout(async () => {
			try {
				await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
				this._debugLog('File explorer refreshed successfully');
			} catch (error: any) {
				this._debugLog('Failed to refresh file explorer', { error: error.message });
			}
		}, 100); // Small delay to ensure the virtual file is fully created
	}

	watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const path = uri.path;
		this._debugLog('stat() called', { uri: uri.toString(), path });

		// Handle malformed URIs that might come from language servers
		if (uri.toString().startsWith('/webdav:') || uri.fsPath.startsWith('/webdav:')) {
			this._debugLog('Detected malformed URI in stat()', { uri: uri.toString() });
			// This will be handled by the PlaceholderProvider's URI correction
			throw vscode.FileSystemError.FileNotFound('Malformed URI detected - should be corrected by PlaceholderProvider');
		}
		
		// Check for virtual files first
		const virtualFile = this._virtualFiles.get(path);
		if (virtualFile) {
			this._debugLog('Returning virtual file stat', { path, isDirectory: virtualFile.isDirectory });
			return {
				type: virtualFile.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
				ctime: virtualFile.mtime,
				mtime: virtualFile.mtime,
				size: virtualFile.content.length
			};
		}

		// Debug: Check for path format issues
		this._debugLog('Virtual file not found in stat()', { path, virtualFiles: this._virtualFiles.size });

		// Try alternative path formats including ~ prefix for virtual files
		const alternativePaths = [
			`~${path}`,                    // Add ~ prefix (for virtual files)
			path.substring(1),             // Remove leading slash
			path.replace(/^\/+/, '/'),     // Normalize multiple slashes
			// Special handling for .stubs and .vscode virtual directories
			path.startsWith('/.stubs') ? `~${path}` : null,
			path.startsWith('/.vscode') ? `~${path}` : null,
			// Additional normalization for stub files
			path.replace(/^\/+/, '~/')     // Convert leading slashes to ~/ for virtual files
		].filter(Boolean) as string[];

		for (const altPath of alternativePaths) {
			const altFile = this._virtualFiles.get(altPath);
			if (altFile) {
				this._debugLog('Found virtual file with alternative path in stat()', { path, foundPath: altPath });
				return {
					type: altFile.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
					ctime: altFile.mtime,
					mtime: altFile.mtime,
					size: altFile.content.length
				};
			}
		}
		
		// Handle root path
		if (path === '/' || path === '') {
			this._debugLog('Returning root directory stat');
			return {
				type: vscode.FileType.Directory,
				ctime: Date.now(),
				mtime: Date.now(),
				size: 0
			};
		}

		try {
			const parentPath = this.getParentPath(path);
			const fileName = this.getFileName(path);
			this._debugLog('stat() getting parent directory', { parentPath, fileName });
			
			// Check if parent directory is cached first
			if (this._cache) {
				// Try multiple path formats to find cache entry
				const pathsToTry = [
					parentPath,                          // /
					parentPath.substring(1),             // '' (remove leading slash)
					parentPath === '/' ? '' : parentPath  // Handle root specially
				].filter((path, index, arr) => arr.indexOf(path) === index); // Remove duplicates

				let cached: any[] | undefined;
				let usedPath: string | undefined;

				for (const tryPath of pathsToTry) {
					cached = this._cache.getDirectory(tryPath);
					if (cached) {
						usedPath = tryPath;
						break;
					}
				}

				this._debugLog('stat() cache lookup', { 
					parentPath, 
					pathsToTry,
					cacheHit: !!cached, 
					usedPath,
					cacheSize: cached?.length || 0 
				});
				if (cached) {
					const item = cached.find(entry => entry.name === fileName);
					if (item) {
						this._debugLog('stat() found in cache', { fileName, isDirectory: item.type === vscode.FileType.Directory });
						return {
							type: item.type,
							ctime: item.mtime,
							mtime: item.mtime,
							size: item.size
						};
					}
				}
			}
			
			if (!this._webdavApi) {
				throw vscode.FileSystemError.FileNotFound('WebDAV API not initialized');
			}

			const response = await this._webdavApi.getDirectoryListing(parentPath);
			if (!response.success) {
				this._debugLog('Failed to get directory listing for stat', { error: response.error });
				throw vscode.FileSystemError.FileNotFound(uri);
			}

			const item = response.items.find(i => i.name === fileName);
			
			if (!item) {
				this._debugLog('File not found in directory listing', { fileName, availableItems: response.items.map(i => i.name) });
				throw vscode.FileSystemError.FileNotFound(uri);
			}

			const result = {
				type: item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
				ctime: Date.now(),
				mtime: Date.now(),
				size: item.isDirectory ? 0 : parseInt(item.size) || 0
			};
			this._debugLog('stat() result', result);
			return result;
		} catch (error: any) {
			this._debugLog('Error in stat', { error: error.message, stack: error.stack });
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		this._debugLog('readDirectory() called', { uri: uri.toString(), virtualFiles: this._virtualFiles.size });
		
		const currentPath = uri.path;
		let result: [string, vscode.FileType][] = [];
		
		try {
			// Check cache first
			if (this._cache) {
				// Try multiple path formats to find cache entry
				const pathsToTry = [
					currentPath,                          // /plugins
					currentPath.substring(1),             // plugins (remove leading slash)
					currentPath === '/' ? '' : currentPath  // Handle root specially
				].filter((path, index, arr) => arr.indexOf(path) === index); // Remove duplicates

				let cached: any[] | undefined;
				let usedPath: string | undefined;

				for (const tryPath of pathsToTry) {
					cached = this._cache.getDirectory(tryPath);
					if (cached) {
						usedPath = tryPath;
						break;
					}
				}

				this._debugLog('Cache lookup attempt', { 
					path: currentPath, 
					pathsToTry,
					cacheHit: !!cached, 
					usedPath,
					cacheSize: cached?.length || 0,
					cacheStats: this._cache.getStats()
				});
				if (cached && cached.length > 0) {
					result = cached.map(entry => [
						entry.name,
						entry.type
					] as [string, vscode.FileType]);
					this._debugLog('Directory cache hit', { path: currentPath, count: result.length });
				} else if (cached) {
					this._debugLog('Directory cache hit but empty', { path: currentPath });
				} else {
					this._debugLog('Directory cache miss', { path: currentPath });
				}
			}

			// If not cached, get real WebDAV directory listing using API
			if (result.length === 0 && this._webdavApi) {
				const response = await this._webdavApi.getDirectoryListing(uri.path);
				if (response.success) {
					result = response.items.map(item => [
						item.name,
						item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File
					] as [string, vscode.FileType]);
					this._debugLog('Real WebDAV files found via API', { count: result.length });
					
					// Update cache with new directory listing
					if (this._cache && response.items.length > 0) {
						const cacheEntries = response.items.map(item => ({
							name: item.name,
							type: item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
							size: parseInt(item.size) || 0,
							mtime: Date.now()
						}));
						
						// Store with both path formats for consistency
						const normalizedPath = currentPath.startsWith('/') ? currentPath.substring(1) : currentPath;
						const pathWithSlash = currentPath.startsWith('/') ? currentPath : `/${currentPath}`;
						
						this._cache.setDirectory(normalizedPath, cacheEntries);
						this._cache.setDirectory(pathWithSlash, cacheEntries);
						this._debugLog('Updated directory cache', { 
							path: currentPath, 
							normalizedPath, 
							pathWithSlash,
							entries: cacheEntries.length 
						});
					}
				} else {
					this._debugLog('Failed to get directory listing via API', { error: response.error });
				}
			}
		} catch (error: any) {
			this._debugLog('Error getting WebDAV directory listing', { error: error.message });
			// Continue with empty result for real files
		}
		
		// Add virtual files/directories that belong to this directory
		let virtualFilesAdded = 0;
		this._debugLog('Processing virtual files for directory', { 
			currentPath, 
			totalVirtualFiles: this._virtualFiles.size,
			virtualFileKeys: Array.from(this._virtualFiles.keys())
		});
		
		for (const [virtualPath, virtualFile] of this._virtualFiles.entries()) {
			const virtualParentPath = this.getParentPath(virtualPath);
			this._debugLog('Checking virtual file', { 
				virtualPath, 
				virtualParentPath,
				currentPath,
				matches: virtualParentPath === currentPath 
			});
			
			// Match virtual files to current directory
			// Handle both exact matches and normalize empty vs "/" for root
			const isMatch = virtualParentPath === currentPath || 
							(currentPath === '/' && virtualParentPath === '') ||
							(currentPath === '' && virtualParentPath === '/');
			
			if (isMatch) {
				const virtualFileName = this.getFileName(virtualPath);
				const virtualFileType = virtualFile.isDirectory ? vscode.FileType.Directory : vscode.FileType.File;
				
				// Only add if not already in the result
				if (!result.some(([name]) => name === virtualFileName)) {
					result.push([virtualFileName, virtualFileType]);
					virtualFilesAdded++;
					this._debugLog('Added virtual file to directory listing', { virtualFileName, type: virtualFile.isDirectory ? 'dir' : 'file' });
				} else {
					this._debugLog('Virtual file already exists in result', { virtualFileName });
				}
			}
		}
		
		// Simple cache doesn't need background warming
		
		this._debugLog('readDirectory() final result', { 
			path: currentPath,
			totalItems: result.length,
			realFiles: result.length - virtualFilesAdded,
			virtualFilesAdded,
			items: result 
		});
		return result;
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		const path = uri.path;
		
		// Check if this should be a virtual directory (for directories we can't create on WebDAV)
		if (path.startsWith('~/.stubs') || path.startsWith('~/.vscode') || path.startsWith('/.stubs') || path.startsWith('/.vscode')) {
			this._debugLog('Creating virtual directory', { path });
			this.createVirtualDirectory(path);
			return;
		}
		
		const folderName = this.getFileName(uri.path);
		const dirPath = this.getParentPath(uri.path);
		if (!this._webdavApi) {
			throw vscode.FileSystemError.Unavailable('WebDAV API not initialized');
		}
		
		const result = await this._webdavApi.createDirectory(folderName, dirPath);
		if (!result.success) {
			this._debugLog('Failed to create directory via API', { error: result.error });
			throw vscode.FileSystemError.Unavailable();
		}
		
		// Invalidate parent directory cache since it now has a new child
		if (this._cache) {
			this._cache.deleteDirectory(dirPath);
			this._debugLog('Invalidated parent directory cache after creation', { dirPath });
		}
		
		this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
		
		// Update file index
		if (this._fileIndex) {
			await this._fileIndex.onFileCreated(uri.path);
		}
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const path = uri.path;
		
		this._debugLog('readFile() called', { 
			uri: uri.toString(), 
			path,
			scheme: uri.scheme
		});

		// Handle malformed URIs that might come from language servers
		if (uri.toString().startsWith('/webdav:') || uri.fsPath.startsWith('/webdav:')) {
			this._debugLog('Detected malformed URI in readFile()', {
				original: uri.toString(),
				fsPath: uri.fsPath,
				path: uri.path
			});
			// This will be handled by the PlaceholderProvider's URI correction
			throw vscode.FileSystemError.FileNotFound('Malformed URI detected - should be corrected by PlaceholderProvider');
		}
		
		// Check for virtual files first
		const virtualFile = this._virtualFiles.get(path);
		if (virtualFile) {
			this._debugLog('Reading virtual file', { path, size: virtualFile.content.length });
			return virtualFile.content;
		}

		// Try alternative path formats including ~ prefix for virtual files
		const alternativePaths = [
			`~${path}`,                    // Add ~ prefix (for virtual files)
			path.substring(1),             // Remove leading slash
			path.replace(/^\/+/, '/'),     // Normalize multiple slashes
			// Special handling for .stubs and .vscode virtual directories
			path.startsWith('/.stubs') ? `~${path}` : null,
			path.startsWith('/.vscode') ? `~${path}` : null,
			// Additional normalization for stub files
			path.replace(/^\/+/, '~/')     // Convert leading slashes to ~/ for virtual files
		].filter(Boolean) as string[];

		for (const altPath of alternativePaths) {
			const altFile = this._virtualFiles.get(altPath);
			if (altFile) {
				this._debugLog('Found virtual file with alternative path', { 
					requestedPath: path,
					foundPath: altPath
				});
				return altFile.content;
			}
		}

		
		// Fetch from WebDAV server using API
		if (!this._webdavApi) {
			throw vscode.FileSystemError.FileNotFound('WebDAV API not initialized');
		}

		const response = await this._webdavApi.readFile(path);
		
		if (!response.success) {
			this._debugLog('Failed to read file via API', { error: response.error });
			throw vscode.FileSystemError.FileNotFound();
		}


		return response.content;
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): Promise<void> {
		const path = uri.path;
		
		// Check if this should be a virtual file (for files we can't write to WebDAV)
		if (path.startsWith('~/.stubs/') || path.startsWith('~/.vscode/') || path.startsWith('/.stubs/') || path.startsWith('/.vscode/')) {
			this._debugLog('Creating/updating virtual file', { path, size: content.length });
			this._virtualFiles.set(path, {
				content,
				mtime: Date.now(),
				isDirectory: false
			});
			this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
			this._debugLog('Virtual file created/updated', { path, size: content.length, uri: uri.toString() });
			
			// Update file index for virtual files too
			if (this._fileIndex) {
				await this._fileIndex.onFileCreated(uri.path);
			}
			return;
		}
		
		const fileName = this.getFileName(uri.path);
		const dirPath = this.getParentPath(uri.path);
		
		const contentString = new TextDecoder().decode(content);
		if (!this._webdavApi) {
			throw vscode.FileSystemError.Unavailable('WebDAV API not initialized');
		}
		
		const result = await this._webdavApi.createFile(fileName, contentString, dirPath);
		if (!result.success) {
			this._debugLog('Failed to create file via API', { error: result.error });
			throw vscode.FileSystemError.Unavailable();
		}
		
		// Invalidate parent directory cache
		if (this._cache) {
			this._cache.deleteDirectory(dirPath); // Parent directory changed
			this._debugLog('Invalidated parent directory cache after file write', { invalidatedDir: dirPath });
		}
		
		this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
		this._debugLog('File written', { fileName, dirPath, uri: uri.toString(), size: content.length });
		
		// Update file index
		if (this._fileIndex) {
			await this._fileIndex.onFileCreated(uri.path);
		}
	}

	async delete(uri: vscode.Uri, _options: { recursive: boolean; }): Promise<void> {
		const path = uri.path;
		
		// Check if this is a virtual file/directory
		if (this._virtualFiles.has(path)) {
			this._virtualFiles.delete(path);
			this._debugLog('Deleted virtual file', { path });
		} else {
			// Delete from WebDAV server
			const itemName = this.getFileName(uri.path);
			const dirPath = this.getParentPath(uri.path);
			if (!this._webdavApi) {
				throw vscode.FileSystemError.Unavailable('WebDAV API not initialized');
			}
			
			const result = await this._webdavApi.deleteItem(itemName, dirPath);
			if (!result.success) {
				this._debugLog('Failed to delete item via API', { error: result.error });
				throw vscode.FileSystemError.Unavailable();
			}
			
			// Invalidate parent directory cache
			if (this._cache) {
				const dirPath = this.getParentPath(path);
				this._cache.deleteDirectory(dirPath);
				this._debugLog('Invalidated parent directory cache after deletion', { dirPath });
			}
		}
		
		this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
		
		// Update file index
		if (this._fileIndex) {
			await this._fileIndex.onFileDeleted(uri.path);
		}
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { overwrite: boolean; }): Promise<void> {
		const oldPath = oldUri.path;
		const newPath = newUri.path;
		
		// Check if this is a virtual file/directory
		if (this._virtualFiles.has(oldPath)) {
			const virtualFile = this._virtualFiles.get(oldPath)!;
			this._virtualFiles.delete(oldPath);
			this._virtualFiles.set(newPath, virtualFile);
			this._debugLog('Renamed virtual file', { oldPath, newPath });
		} else {
			// Rename on WebDAV server
			const currentName = this.getFileName(oldUri.path);
			const newName = this.getFileName(newUri.path);
			const dirPath = this.getParentPath(oldUri.path);
			
			if (!this._webdavApi) {
				throw vscode.FileSystemError.Unavailable('WebDAV API not initialized');
			}
			
			const result = await this._webdavApi.renameItem(currentName, newName, dirPath);
			if (!result.success) {
				this._debugLog('Failed to rename item via API', { error: result.error });
				throw vscode.FileSystemError.Unavailable();
			}
			
			// Invalidate parent directory cache for both paths
			if (this._cache) {
				const oldDirPath = this.getParentPath(oldPath);
				const newDirPath = this.getParentPath(newPath);
				this._cache.deleteDirectory(oldDirPath);
				this._cache.deleteDirectory(newDirPath);
				this._debugLog('Invalidated parent directory cache for renamed file', { oldDirPath, newDirPath });
			}
		}
		
		this._emitter.fire([
			{ type: vscode.FileChangeType.Deleted, uri: oldUri },
			{ type: vscode.FileChangeType.Created, uri: newUri }
		]);
		
		// Update file index
		if (this._fileIndex) {
			await this._fileIndex.onFileRenamed(oldUri.path, newUri.path);
		}
	}

	private getFileName(path: string): string {
		return path.split('/').pop() || '';
	}

	private getParentPath(path: string): string {
		// Handle ~ prefix for virtual files
		let normalizedPath = path;
		const hasVirtualPrefix = path.startsWith('~');
		
		if (path.startsWith('~/')) {
			normalizedPath = path.substring(1); // Remove ~ but keep the /
		} else if (path.startsWith('~')) {
			normalizedPath = path.substring(1); // Remove ~ completely
		}
		
		const parts = normalizedPath.split('/').filter(Boolean); // Filter out empty parts
		parts.pop(); // Remove the filename/last directory
		let parentPath = parts.join('/');
		
		// Ensure consistent path format
		if (parentPath && !parentPath.startsWith('/')) {
			parentPath = '/' + parentPath;
		}
		
		// For root directory and empty paths, return appropriate format
		if (!parentPath || parentPath === '/') {
			// Both virtual and real files in root should use the same format for comparison
			return '/';
		}
		
		// Remove leading slash for non-virtual files to match WebDAV path format
		if (!hasVirtualPrefix && parentPath.startsWith('/')) {
			parentPath = parentPath.substring(1);
		}
		
		return parentPath;
	}

	// Methods for cache warming service
	async propFindRequest(path: string): Promise<{ name: string; type: vscode.FileType; size: number; mtime: number; etag?: string; }[]> {
		if (!this._webdavApi) {
			return [];
		}
		const response = await this._webdavApi.getDirectoryListing(path);
		if (!response.success) {
			return [];
		}
		return response.items.map(item => ({
			name: item.name,
			type: item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
			size: parseInt(item.size) || 0,
			mtime: new Date(item.modified).getTime(),
			etag: undefined // WebDAV server doesn't provide ETags in directory listings
		}));
	}

	async getFileRequest(path: string): Promise<{ content: Uint8Array; headers: Record<string, string>; }> {
		if (!this._webdavApi) {
			throw new Error('WebDAV API not initialized');
		}
		
		const response = await this._webdavApi.readFile(path);
		if (!response.success) {
			throw new Error(`Failed to fetch file: ${response.error}`);
		}
		
		return { content: response.content, headers: response.headers };
	}

	// Cache management methods
	getCacheStats(): any {
		if (!this._cache) {
			return null;
		}
		return this._cache.getStats();
	}

	async clearCache(): Promise<void> {
		if (this._cache) {
			this._cache.clear();
			this._debugLog('Cache cleared by user request');
		}
	}

	// Dispose method to clean up resources
	dispose(): void {
		if (this._cache) {
			this._cache.dispose();
		}
		this._debugLog('WebDAV file system provider disposed');
	}

	// Helper method to create consistent webdav URIs
	private createWebdavUri(path: string): vscode.Uri {
		// Handle ~ prefix for virtual files - convert to regular path
		let normalizedPath = path;
		if (path.startsWith('~/')) {
			normalizedPath = path.substring(1); // Remove ~ but keep the /
		} else if (path.startsWith('~')) {
			normalizedPath = path.substring(1); // Remove ~ completely
		}
		
		// Ensure path starts with /
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = `/${normalizedPath}`;
		}
		
		const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
		this._debugLog('Created webdav URI', { 
			inputPath: path,
			normalizedPath,
			resultUri: uri.toString(),
			uriPath: uri.path,
			scheme: uri.scheme
		});
		return uri;
	}


}