import * as vscode from 'vscode';
import { WebDAVCredentials, WebDAVFileItem } from '../types';
import { WebDAVFileIndex } from '../core/fileIndex';
import { parseDirectoryHTML } from '../utils/htmlUtils';

export class WebDAVTextSearchProvider {
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

	async provideTextSearchResults(
		query: any,
		options: any,
		progress: vscode.Progress<any>,
		token: vscode.CancellationToken
	): Promise<any> {
		if (!this._credentials) {
			this.debugLog('Text search: No credentials available');
			return { limitHit: false };
		}

		this.debugLog('Text search started (new API)', { 
			query: query, 
			queryPattern: query.pattern || query,
			queryType: typeof query,
			options: options 
		});

		try {
			// Use index if available, otherwise fall back to directory traversal
			if (this._fileIndex) {
				await this._fileIndex.ensureIndexed();
				await this.searchIndexedFiles(query, progress, token);
				this.debugLog('Text search completed using index');
			} else {
				// Fallback to directory traversal
				await this.searchInDirectory('', query, options, progress, token);
				this.debugLog('Text search completed using directory traversal');
			}
			return { limitHit: false };
		} catch (error: any) {
			this.debugLog('Text search error', { error: error.message, stack: error.stack });
			return { limitHit: false };
		}
	}

	private async searchIndexedFiles(
		query: any,
		progress: vscode.Progress<any>,
		token: vscode.CancellationToken
	): Promise<void> {
		if (!this._fileIndex) {
			return;
		}

		this.debugLog('Starting indexed file search');
		const allFiles = this._fileIndex.getAllFiles();
		let searchedCount = 0;

		for (const filePath of allFiles) {
			if (token.isCancellationRequested) {
				this.debugLog('Search cancelled during indexed search', { searchedFiles: searchedCount });
				return;
			}

			const fileName = this.getFileName(filePath);
			if (this.shouldSearchFile(fileName)) {
				await this.searchInFile(filePath, query, progress, token);
				searchedCount++;
			}
		}

		this.debugLog('Indexed file search completed', { 
			totalFiles: allFiles.length, 
			searchedFiles: searchedCount 
		});
	}

	private getFileName(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
	}

	private async searchInDirectory(
		dirPath: string,
		query: any,
		options: any,
		progress: vscode.Progress<any>,
		token: vscode.CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			this.debugLog('Search cancelled in directory', { dirPath });
			return;
		}

		try {
			this.debugLog('Searching directory', { dirPath });
			const items = await this.getDirectoryListing(dirPath);
			this.debugLog('Directory listing retrieved', { dirPath, itemCount: items.length, items: items.map(i => i.name) });
			
			for (const item of items) {
				if (token.isCancellationRequested) {
					this.debugLog('Search cancelled during iteration', { dirPath, item: item.name });
					return;
				}

				const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
				
				if (item.isDirectory) {
					const shouldSearchDir = this.shouldSearchDirectory(item.name);
					this.debugLog('Checking directory', { itemPath, shouldSearchDir, dirName: item.name });
					if (shouldSearchDir) {
						this.debugLog('Entering subdirectory', { itemPath });
						await this.searchInDirectory(itemPath, query, options, progress, token);
					} else {
						this.debugLog('Skipping excluded directory', { itemPath });
					}
				} else {
					const shouldSearch = this.shouldSearchFile(item.name);
					this.debugLog('Checking file', { itemPath, shouldSearch, fileName: item.name });
					if (shouldSearch) {
						await this.searchInFile(itemPath, query, progress, token);
					}
				}
			}
		} catch (error: any) {
			this.debugLog('Error searching directory', { dirPath, error: error.message, stack: error.stack });
		}
	}

	private shouldSearchFile(fileName: string): boolean {
		// Search in common text files
		const textExtensions = ['.txt', '.js', '.ts', '.json', '.css', '.html', '.htm', '.xml', '.md', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt'];
		return textExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
	}

	private shouldSearchDirectory(dirName: string): boolean {
		// Skip common directories that shouldn't be searched
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

	private async searchInFile(
		filePath: string,
		query: any,
		progress: vscode.Progress<any>,
		token: vscode.CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			this.debugLog('Search cancelled in file', { filePath });
			return;
		}

		try {
			this.debugLog('Reading file for search', { filePath });
			const fileContent = await this.readFileContent(filePath);
			this.debugLog('File content read', { filePath, contentLength: fileContent.length });
			
			const lines = fileContent.split('\n');
			const searchPattern = typeof query === 'string' ? query : query.pattern || '';
			const isCaseSensitive = query.isCaseSensitive || false;
			const isRegExp = query.isRegExp || false;
			
			this.debugLog('Searching file content', { 
				filePath, 
				lineCount: lines.length, 
				searchPattern, 
				isCaseSensitive, 
				isRegExp 
			});
			
			let matchCount = 0;
			for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
				if (token.isCancellationRequested) {
					this.debugLog('Search cancelled during file processing', { filePath, lineNumber });
					return;
				}

				const line = lines[lineNumber];
				const matches = this.findMatches(line, searchPattern, isCaseSensitive, isRegExp);
				
				if (matches.length > 0) {
					matchCount += matches.length;
					// Normalize path for URI creation, handling virtual file prefixes
					const normalizedPath = this.normalizeFilePathForUri(filePath);
					const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
					const result = {
						uri,
						ranges: matches.map(match => new vscode.Range(lineNumber, match.start, lineNumber, match.end)),
						preview: {
							text: line,
							matches: matches.map(match => new vscode.Range(0, match.start, 0, match.end))
						}
					};
					
					this.debugLog('Reporting match', { 
						filePath, 
						lineNumber, 
						matchCount: matches.length,
						line: line.substring(0, 100),
						result 
					});
					
					progress.report(result);
				}
			}
			
			this.debugLog('File search completed', { filePath, totalMatches: matchCount });
		} catch (error: any) {
			this.debugLog('Error searching in file', { filePath, error: error.message, stack: error.stack });
		}
	}

	private findMatches(text: string, pattern: string, isCaseSensitive: boolean, isRegExp: boolean): { start: number; end: number }[] {
		const matches: { start: number; end: number }[] = [];
		const searchText = isCaseSensitive ? text : text.toLowerCase();
		const searchPattern = isCaseSensitive ? pattern : pattern.toLowerCase();
		
		this.debugLog('Finding matches in line', { 
			pattern, 
			searchPattern, 
			text: text.substring(0, 50), 
			isCaseSensitive, 
			isRegExp 
		});
		
		if (isRegExp) {
			try {
				const regex = new RegExp(pattern, isCaseSensitive ? 'g' : 'gi');
				let match;
				while ((match = regex.exec(text)) !== null) {
					matches.push({ start: match.index, end: match.index + match[0].length });
				}
				this.debugLog('Regex matches found', { matchCount: matches.length, matches });
			} catch (error) {
				this.debugLog('Regex error, falling back to literal', { error: (error as Error).message });
				// Invalid regex, fall back to literal search
				return this.findLiteralMatches(searchText, searchPattern);
			}
		} else {
			const literalMatches = this.findLiteralMatches(searchText, searchPattern);
			this.debugLog('Literal matches found', { matchCount: literalMatches.length, matches: literalMatches });
			return literalMatches;
		}
		
		return matches;
	}

	private findLiteralMatches(text: string, pattern: string): { start: number; end: number }[] {
		const matches: { start: number; end: number }[] = [];
		let index = 0;
		
		while ((index = text.indexOf(pattern, index)) !== -1) {
			matches.push({ start: index, end: index + pattern.length });
			index += pattern.length;
		}
		
		return matches;
	}

	private async readFileContent(filePath: string): Promise<string> {
		const fileURL = `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${filePath}`;
		
		// Detect if we're running on desktop VS Code vs web
		const isDesktop = typeof process !== 'undefined' && process.versions && process.versions.electron;
		
		const response = await fetch(fileURL, {
			method: 'GET',
			headers: {
				'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`,
				'Accept': '*/*'
			},
			mode: isDesktop ? 'no-cors' : 'cors',
			credentials: 'include'
		});
		
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		
		return await response.text();
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
			
			// Detect if we're running on desktop VS Code vs web
			const isDesktop = typeof process !== 'undefined' && process.versions && process.versions.electron;
			
			const response = await fetch(dirURL, {
				method: 'GET',
				headers: {
					'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'User-Agent': 'VSCode-WebDAV-Extension'
				},
				mode: isDesktop ? 'no-cors' : 'cors',
				credentials: 'include'
			});
			
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			
			const html = await response.text();
			return parseDirectoryHTML(html);
		} catch (error: any) {
			this.debugLog('Error in getDirectoryListing', { error: error.message });
			throw error;
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