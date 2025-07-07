import * as vscode from 'vscode';
import { WebDAVCredentials, WebDAVFileItem } from '../types';
import { WebDAVFileIndex } from '../core/fileIndex';
import { parseDirectoryHTML } from '../utils/htmlUtils';

export class WebDAVFileSearchProvider {
	private _credentials: WebDAVCredentials | null = null;
	private _fileIndex: WebDAVFileIndex | null = null;

	constructor(credentials: WebDAVCredentials | null = null) {
		this._credentials = credentials;
	}

	setCredentials(credentials: WebDAVCredentials | null) {
		this._credentials = credentials;
	}

	setFileIndex(fileIndex: WebDAVFileIndex | null) {
		this._fileIndex = fileIndex;
	}

	async provideFileSearchResults(
		query: any,
		_options: any,
		token: vscode.CancellationToken
	): Promise<vscode.Uri[]> {
		if (!this._credentials) {
			return [];
		}

		const searchPattern = typeof query === 'string' ? query : query.pattern || '';
		this.debugLog('File search started (new API)', { pattern: searchPattern, useIndex: !!this._fileIndex });

		try {
			let results: vscode.Uri[] = [];

			// Use index if available, otherwise fall back to directory traversal
			if (this._fileIndex) {
				await this._fileIndex.ensureIndexed();
				const indexedResults = this._fileIndex.searchFiles(searchPattern);
				results = indexedResults.map(path => {
					// Normalize path for URI creation, handling virtual file prefixes
					const normalizedPath = this.normalizeFilePathForUri(path);
					return vscode.Uri.parse(`webdav:${normalizedPath}`);
				});
				this.debugLog('File search completed using index', { resultCount: results.length });
			} else {
				// Fallback to directory traversal
				await this.searchDirectory('', searchPattern, results, token);
				this.debugLog('File search completed using directory traversal', { resultCount: results.length });
			}

			return results;
		} catch (error: any) {
			this.debugLog('File search error', { error: error.message });
			return [];
		}
	}

	private async searchDirectory(
		dirPath: string,
		pattern: string,
		results: vscode.Uri[],
		token: vscode.CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		try {
			const items = await this.getDirectoryListing(dirPath);
			
			for (const item of items) {
				if (token.isCancellationRequested) {
					return;
				}

				const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
				
				if (item.isDirectory) {
					if (this.shouldSearchDirectory(item.name)) {
						await this.searchDirectory(itemPath, pattern, results, token);
					}
				} else {
					if (this.matchesPattern(item.name, pattern)) {
						// Normalize path for URI creation, handling virtual file prefixes
						const normalizedPath = this.normalizeFilePathForUri(itemPath);
						results.push(vscode.Uri.parse(`webdav:${normalizedPath}`));
					}
				}
			}
		} catch (error: any) {
			this.debugLog('Error searching directory', { dirPath, error: error.message });
		}
	}

	private matchesPattern(fileName: string, pattern: string): boolean {
		if (!pattern) {
			return true;
		}

		// Convert glob pattern to regex
		const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
		return regex.test(fileName);
	}

	private shouldSearchDirectory(dirName: string): boolean {
		// Skip common directories that shouldn't be searched
		// TODO: Make this configurable by the user
		const excludedDirs = [
			'.git',
			'.svn',
			'.hg',
			'node_modules',
			'.vscode',
			'.idea',
			'dist',
			'build',
			'target',
			'bin',
			'obj',
			'.cache',
			'.tmp',
			'temp',
			'.DS_Store'
		];
		
		const lowerDirName = dirName.toLowerCase();
		return !excludedDirs.some(excluded => lowerDirName === excluded || lowerDirName.startsWith(excluded + '/'));
	}

	private async getDirectoryListing(dirPath: string): Promise<WebDAVFileItem[]> {
		try {
			let cleanDirPath = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;
			
			if (cleanDirPath === '' || cleanDirPath === '/') {
				cleanDirPath = '';
			}
			
			const dirURL = cleanDirPath 
				? `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${cleanDirPath}`
				: `${this._credentials!.url}/apps/remote/${this._credentials!.project}/`;
			
			const response = await fetch(dirURL, {
				method: 'GET',
				headers: {
					'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'User-Agent': 'VSCode-WebDAV-Extension'
				},
				mode: 'cors',
				credentials: 'include'
			});
			
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			
			const html = await response.text();
			return parseDirectoryHTML(html);
		} catch (error: any) {
			this.debugLog('Error in getDirectoryListing', { error: error.message });
			// For the file search provider, we don't have direct access to virtual files
			// The search will rely on the file index which includes virtual files
			return [];
		}
	}



	// Debug logging placeholder - will be provided by extension
	private debugLog(_message: string, _data?: any) {
		// This will be overridden by setDebugLogger
	}

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this.debugLog = logger;
	}

	/**
	 * Normalizes file paths for URI creation, handling virtual file prefixes
	 */
	private normalizeFilePathForUri(filePath: string): string {
		// Handle ~ prefix for virtual files - convert to regular path
		let normalizedPath = filePath;
		if (filePath.startsWith('~/')) {
			normalizedPath = filePath.substring(1); // Remove ~ but keep the /
		} else if (filePath.startsWith('~')) {
			normalizedPath = filePath.substring(1); // Remove ~ completely
		}
		
		// Ensure path starts with /
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = `/${normalizedPath}`;
		}
		
		return normalizedPath;
	}
}