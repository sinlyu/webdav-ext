import * as vscode from 'vscode';
import { WebDAVCredentials, WebDAVFileItem } from './types';
import { WebDAVFileIndex } from './fileIndex';

export class WebDAVFileSystemProvider implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _credentials: WebDAVCredentials | null = null;
	private _fileIndex: WebDAVFileIndex | null = null;
	private _debugLog: (message: string, data?: any) => void = () => {};
	private _debugOutput: vscode.OutputChannel | null = null;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	constructor(credentials: WebDAVCredentials) {
		this._credentials = credentials;
	}

	setFileIndex(fileIndex: WebDAVFileIndex | null) {
		this._fileIndex = fileIndex;
	}

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this._debugLog = logger;
	}

	setDebugOutput(output: vscode.OutputChannel) {
		this._debugOutput = output;
	}

	watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const path = uri.path;
		this._debugLog('stat() called', { uri: uri.toString(), path });
		
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
			
			const items = await this.getDirectoryListing(parentPath);
			const item = items.find(i => i.name === fileName);
			
			if (!item) {
				this._debugLog('File not found in directory listing', { fileName, availableItems: items.map(i => i.name) });
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
		this._debugLog('readDirectory() called', { uri: uri.toString(), path: uri.path });
		try {
			const items = await this.getDirectoryListing(uri.path);
			const result = items.map(item => [
				item.name,
				item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File
			] as [string, vscode.FileType]);
			this._debugLog('readDirectory() result', result);
			return result;
		} catch (error: any) {
			this._debugLog('Error in readDirectory', { error: error.message, stack: error.stack });
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		const folderName = this.getFileName(uri.path);
		const dirPath = this.getParentPath(uri.path);
		await this.createFolder(folderName, dirPath);
		this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
		
		// Update file index
		if (this._fileIndex) {
			await this._fileIndex.onFileCreated(uri.path);
		}
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const filePath = uri.path.substring(1); // Remove leading slash
		const fileURL = `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${filePath}`;
		
		this._debugLog('Reading file', { filePath, fileURL });
		
		const response = await fetch(fileURL, {
			method: 'GET',
			headers: {
				'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`,
				'Accept': '*/*'
			},
			mode: 'cors',
			credentials: 'include'
		});
		if (!response.ok) {
			this._debugLog('Failed to read file', { status: response.status, statusText: response.statusText });
			throw vscode.FileSystemError.FileNotFound();
		}
		
		const arrayBuffer = await response.arrayBuffer();
		return new Uint8Array(arrayBuffer);
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean; }): Promise<void> {
		const fileName = this.getFileName(uri.path);
		const dirPath = this.getParentPath(uri.path);
		
		const contentString = new TextDecoder().decode(content);
		await this.createFile(fileName, contentString, dirPath);
		this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
		
		// Update file index
		if (this._fileIndex) {
			await this._fileIndex.onFileCreated(uri.path);
		}
	}

	async delete(uri: vscode.Uri, _options: { recursive: boolean; }): Promise<void> {
		const itemName = this.getFileName(uri.path);
		const dirPath = this.getParentPath(uri.path);
		await this.deleteItem(itemName, dirPath);
		this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
		
		// Update file index
		if (this._fileIndex) {
			await this._fileIndex.onFileDeleted(uri.path);
		}
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, _options: { overwrite: boolean; }): Promise<void> {
		const currentName = this.getFileName(oldUri.path);
		const newName = this.getFileName(newUri.path);
		const dirPath = this.getParentPath(oldUri.path);
		
		await this.renameItem(currentName, newName, dirPath);
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
		const parts = path.split('/');
		parts.pop();
		return parts.join('/').substring(1); // Remove leading slash
	}

	private async getDirectoryListing(dirPath: string): Promise<WebDAVFileItem[]> {
		try {
			let cleanDirPath = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;
			
			// Handle root path - show project root
			if (cleanDirPath === '' || cleanDirPath === '/') {
				cleanDirPath = '';
			}
			
			const dirURL = cleanDirPath 
				? `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${cleanDirPath}`
				: `${this._credentials!.url}/apps/remote/${this._credentials!.project}/`;
			
			this._debugLog('Fetching directory listing', { 
				originalPath: dirPath, 
				cleanPath: cleanDirPath, 
				url: dirURL,
				project: this._credentials!.project,
				currentOrigin: globalThis.location?.origin || 'unknown'
			});
			
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
			
			this._debugLog('Directory listing response', { 
				status: response.status, 
				statusText: response.statusText,
				headers: 'Headers object'
			});
			
			if (!response.ok) {
				this._debugLog('Failed to fetch directory listing', { 
					status: response.status, 
					statusText: response.statusText 
				});
				throw vscode.FileSystemError.FileNotFound();
			}
			
			const html = await response.text();
			this._debugLog('Raw HTML response length', html.length);
			this._debugLog('First 500 chars of HTML', html.substring(0, 500));
			
			const items = this.parseDirectoryHTML(html);
			this._debugLog('Parsed directory items', items);
			
			return items;
		} catch (error: any) {
			this._debugLog('Error in getDirectoryListing', { error: error.message, stack: error.stack });
			
			// Check if this is a CORS error
			if (error.message === 'Failed to fetch') {
				this._debugLog('CORS Error Detected', {
					issue: 'Cross-Origin Request Blocked',
					explanation: 'VS Code web (localhost:3000) cannot access external WebDAV server due to CORS policy',
					solutions: [
						'1. Use "npm run run-in-browser" which starts Chrome with CORS disabled',
						'2. Use VS Code Desktop instead of web version',
						'3. Configure WebDAV server to allow CORS from localhost:3000',
						'4. Use a proxy server to bypass CORS',
						'5. Test with a CORS-enabled WebDAV server'
					],
					note: 'The npm script "run-in-browser" now includes --disable-web-security flag'
				});
				
				vscode.window.showErrorMessage(
					'CORS Error: Cannot access WebDAV server from VS Code web. Try using VS Code Desktop or configure CORS on your server.',
					'More Info'
				).then(selection => {
					if (selection === 'More Info' && this._debugOutput) {
						this._debugOutput.show();
					}
				});
			}
			
			throw error;
		}
	}

	private async createFolder(folderName: string, dirPath: string): Promise<void> {
		const cleanDirPath = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;
		const targetURL = `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${cleanDirPath}`;
		
		const response = await fetch(targetURL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`
			},
			body: `sabreAction=mkcol&name=${encodeURIComponent(folderName)}`
		});
		
		if (!response.ok) {
			throw vscode.FileSystemError.Unavailable();
		}
	}

	private async deleteItem(itemName: string, dirPath: string): Promise<void> {
		const cleanDirPath = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;
		const itemPath = cleanDirPath ? `${cleanDirPath}/${itemName}` : itemName;
		const deleteURL = `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${itemPath}/?sabreAction=delete`;
		
		const response = await fetch(deleteURL, {
			method: 'GET',
			headers: {
				'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`
			}
		});
		
		if (!response.ok) {
			throw vscode.FileSystemError.Unavailable();
		}
	}

	private async createFile(fileName: string, content: string, dirPath: string): Promise<void> {
		const cleanDirPath = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;
		const targetURL = cleanDirPath
			? `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${cleanDirPath}`
			: `${this._credentials!.url}/apps/remote/${this._credentials!.project}`;
		
		const formData = new FormData();
		formData.append('sabreAction', 'put');
		formData.append('name', fileName);
		
		const blob = new Blob([content], { type: 'application/octet-stream' });
		formData.append('file', blob, fileName);
		
		const response = await fetch(targetURL, {
			method: 'POST',
			headers: {
				'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`
			},
			body: formData
		});
		
		if (!response.ok) {
			throw vscode.FileSystemError.Unavailable();
		}
	}

	private async renameItem(currentName: string, newName: string, dirPath: string): Promise<void> {
		const cleanDirPath = dirPath.startsWith('/') ? dirPath.substring(1) : dirPath;
		const itemPath = cleanDirPath ? `${cleanDirPath}/${currentName}` : currentName;
		const renameURL = `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${itemPath}?sabreAction=rename&newName=${encodeURIComponent(newName)}`;
		
		const response = await fetch(renameURL, {
			method: 'GET',
			headers: {
				'Authorization': `Basic ${btoa(`${this._credentials!.username}:${this._credentials!.password}`)}`
			}
		});
		
		if (!response.ok) {
			throw vscode.FileSystemError.Unavailable();
		}
	}

	private parseDirectoryHTML(html: string): WebDAVFileItem[] {
		this._debugLog('Parsing directory HTML', { htmlLength: html.length });
		
		const items: WebDAVFileItem[] = [];
		
		try {
			// Use regex to parse the HTML since DOMParser is not available in web worker
			// Look for table rows in the nodeTable
			const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
			const rows = html.match(tableRowRegex) || [];
			
			this._debugLog('Found table rows', { count: rows.length });
			
			for (const row of rows) {
				// Extract name column with link
				const nameMatch = row.match(/<td[^>]*class[^>]*nameColumn[^>]*>.*?<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/is);
				// Extract type column
				const typeMatch = row.match(/<td[^>]*class[^>]*typeColumn[^>]*>(.*?)<\/td>/is);
				// Extract size column
				const sizeMatch = row.match(/<td[^>]*class[^>]*sizeColumn[^>]*>(.*?)<\/td>/is);
				// Extract modified column
				const modifiedMatch = row.match(/<td[^>]*class[^>]*lastModifiedColumn[^>]*>(.*?)<\/td>/is);
				
				if (nameMatch && typeMatch) {
					const href = nameMatch[1]?.trim() || '';
					const name = this.stripHtmlTags(nameMatch[2]?.trim() || '');
					const type = this.stripHtmlTags(typeMatch[1]?.trim() || '');
					const size = sizeMatch ? this.stripHtmlTags(sizeMatch[1]?.trim() || '') : '';
					const modified = modifiedMatch ? this.stripHtmlTags(modifiedMatch[1]?.trim() || '') : '';
					
					this._debugLog('Parsed row', { name, type, size, href });
					
					// Skip parent directory links and empty names
					if (name && !name.startsWith('⇤') && name !== 'Parent Directory' && name !== '..') {
						items.push({
							name,
							type,
							size,
							modified,
							path: href,
							isDirectory: type === 'Collection' || type.toLowerCase().includes('directory')
						});
					}
				}
			}
			
			this._debugLog('Parsed directory items', { count: items.length, items });
			return items;
			
		} catch (error: any) {
			this._debugLog('Error parsing HTML with regex', { error: error.message });
			// Fallback: try to extract any links as a last resort
			return this.parseDirectoryHTMLFallback(html);
		}
	}

	private stripHtmlTags(html: string): string {
		return html.replace(/<[^>]*>/g, '').trim();
	}

	async indexAllFiles(): Promise<void> {
		this._debugLog('Starting full file indexing');
		try {
			await this.indexDirectory('');
			this._debugLog('File indexing completed');
		} catch (error: any) {
			this._debugLog('Error during file indexing', { error: error.message });
		}
	}

	private async indexDirectory(dirPath: string): Promise<void> {
		try {
			const items = await this.getDirectoryListing(dirPath);
			
			for (const item of items) {
				const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;
				const uri = vscode.Uri.parse(`webdav:/${itemPath}`);
				
				if (item.isDirectory) {
					// Fire directory change event
					this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
					// Recursively index subdirectories
					await this.indexDirectory(itemPath);
				} else {
					// Fire file change event to notify VS Code about the file
					this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
				}
			}
		} catch (error: any) {
			this._debugLog('Error indexing directory', { dirPath, error: error.message });
		}
	}

	private parseDirectoryHTMLFallback(html: string): WebDAVFileItem[] {
		this._debugLog('Using fallback HTML parsing');
		const items: WebDAVFileItem[] = [];
		
		// Simple fallback: extract any links that look like files/directories
		const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis;
		const links = html.matchAll(linkRegex);
		
		for (const link of links) {
			const href = link[1]?.trim() || '';
			const name = this.stripHtmlTags(link[2]?.trim() || '');
			
			if (name && !name.startsWith('⇤') && name !== 'Parent Directory' && name !== '..') {
				const isDirectory = href.endsWith('/') || !href.includes('.');
				items.push({
					name,
					type: isDirectory ? 'Collection' : 'File',
					size: '',
					modified: '',
					path: href,
					isDirectory
				});
			}
		}
		
		this._debugLog('Fallback parsed items', { count: items.length, items });
		return items;
	}
}