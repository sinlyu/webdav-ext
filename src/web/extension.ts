// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

interface WebDAVCredentials {
	url: string;
	username: string;
	password: string;
	project?: string;
}

interface WebDAVFileItem {
	name: string;
	type: string;
	size: string;
	modified: string;
	path: string;
	isDirectory: boolean;
}

class WebDAVFileSystemProvider implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _credentials: WebDAVCredentials | null = null;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	constructor(credentials: WebDAVCredentials) {
		this._credentials = credentials;
	}

	watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		return new vscode.Disposable(() => {});
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const path = uri.path;
		debugLog('stat() called', { uri: uri.toString(), path });
		
		// Handle root path
		if (path === '/' || path === '') {
			debugLog('Returning root directory stat');
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
			debugLog('stat() getting parent directory', { parentPath, fileName });
			
			const items = await this.getDirectoryListing(parentPath);
			const item = items.find(i => i.name === fileName);
			
			if (!item) {
				debugLog('File not found in directory listing', { fileName, availableItems: items.map(i => i.name) });
				throw vscode.FileSystemError.FileNotFound(uri);
			}

			const result = {
				type: item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File,
				ctime: Date.now(),
				mtime: Date.now(),
				size: item.isDirectory ? 0 : parseInt(item.size) || 0
			};
			debugLog('stat() result', result);
			return result;
		} catch (error: any) {
			debugLog('Error in stat', { error: error.message, stack: error.stack });
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		debugLog('readDirectory() called', { uri: uri.toString(), path: uri.path });
		try {
			const items = await this.getDirectoryListing(uri.path);
			const result = items.map(item => [
				item.name,
				item.isDirectory ? vscode.FileType.Directory : vscode.FileType.File
			] as [string, vscode.FileType]);
			debugLog('readDirectory() result', result);
			return result;
		} catch (error: any) {
			debugLog('Error in readDirectory', { error: error.message, stack: error.stack });
			throw vscode.FileSystemError.FileNotFound(uri);
		}
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		const folderName = this.getFileName(uri.path);
		const dirPath = this.getParentPath(uri.path);
		await this.createFolder(folderName, dirPath);
		this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const filePath = uri.path.substring(1); // Remove leading slash
		const fileURL = `${this._credentials!.url}/apps/remote/${this._credentials!.project}/${filePath}`;
		
		debugLog('Reading file', { filePath, fileURL });
		
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
			debugLog('Failed to read file', { status: response.status, statusText: response.statusText });
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
	}

	async delete(uri: vscode.Uri, _options: { recursive: boolean; }): Promise<void> {
		const itemName = this.getFileName(uri.path);
		const dirPath = this.getParentPath(uri.path);
		await this.deleteItem(itemName, dirPath);
		this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
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
			
			debugLog('Fetching directory listing', { 
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
			
			debugLog('Directory listing response', { 
				status: response.status, 
				statusText: response.statusText,
				headers: 'Headers object'
			});
			
			if (!response.ok) {
				debugLog('Failed to fetch directory listing', { 
					status: response.status, 
					statusText: response.statusText 
				});
				throw vscode.FileSystemError.FileNotFound();
			}
			
			const html = await response.text();
			debugLog('Raw HTML response length', html.length);
			debugLog('First 500 chars of HTML', html.substring(0, 500));
			
			const items = this.parseDirectoryHTML(html);
			debugLog('Parsed directory items', items);
			
			return items;
		} catch (error: any) {
			debugLog('Error in getDirectoryListing', { error: error.message, stack: error.stack });
			
			// Check if this is a CORS error
			if (error.message === 'Failed to fetch') {
				debugLog('CORS Error Detected', {
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
					if (selection === 'More Info') {
						debugOutput.show();
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
		debugLog('Parsing directory HTML', { htmlLength: html.length });
		
		const items: WebDAVFileItem[] = [];
		
		try {
			// Use regex to parse the HTML since DOMParser is not available in web worker
			// Look for table rows in the nodeTable
			const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
			const rows = html.match(tableRowRegex) || [];
			
			debugLog('Found table rows', { count: rows.length });
			
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
					
					debugLog('Parsed row', { name, type, size, href });
					
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
			
			debugLog('Parsed directory items', { count: items.length, items });
			return items;
			
		} catch (error: any) {
			debugLog('Error parsing HTML with regex', { error: error.message });
			// Fallback: try to extract any links as a last resort
			return this.parseDirectoryHTMLFallback(html);
		}
	}

	private stripHtmlTags(html: string): string {
		return html.replace(/<[^>]*>/g, '').trim();
	}

	private parseDirectoryHTMLFallback(html: string): WebDAVFileItem[] {
		debugLog('Using fallback HTML parsing');
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
		
		debugLog('Fallback parsed items', { count: items.length, items });
		return items;
	}
}

class PlaceholderFileSystemProvider implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _realProvider: WebDAVFileSystemProvider | null = null;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	setRealProvider(provider: WebDAVFileSystemProvider | null) {
		this._realProvider = provider;
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		if (this._realProvider) {
			return this._realProvider.watch(uri, options);
		}
		return new vscode.Disposable(() => {});
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		if (this._realProvider) {
			return this._realProvider.stat(uri);
		}
		debugLog('PlaceholderProvider: stat() called but not connected', { uri: uri.toString() });
		vscode.window.showErrorMessage('Not connected to WebDAV server. Please connect first.');
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		if (this._realProvider) {
			return this._realProvider.readDirectory(uri);
		}
		debugLog('PlaceholderProvider: readDirectory() called but not connected', { uri: uri.toString() });
		vscode.window.showErrorMessage('Not connected to WebDAV server. Please connect first.');
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.createDirectory(uri);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		if (this._realProvider) {
			return this._realProvider.readFile(uri);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.writeFile(uri, content, options);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.delete(uri, options);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.rename(oldUri, newUri, options);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}
}

class WebDAVViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'webdavConnection';
	private _view?: vscode.WebviewView;
	private credentials: WebDAVCredentials | null = null;
	private connected = false;
	private fsProvider: WebDAVFileSystemProvider | null = null;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Add visibility change handler to maintain connection state
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				debugLog('Webview became visible, attempting auto-reconnect');
				this.autoReconnect();
			}
		});

		// Attempt auto-reconnect immediately when webview is resolved
		setTimeout(() => {
			debugLog('Webview resolved, attempting initial auto-reconnect');
			this.autoReconnect();
		}, 100);

		webviewView.webview.onDidReceiveMessage(async data => {
			debugLog('WebView received message', { type: data.type, data });
			try {
				switch (data.type) {
					case 'test':
						debugLog('Test message received from webview');
						vscode.window.showInformationMessage('Webview test successful!');
						break;
					case 'connect':
						debugLog('Processing connect message', { url: data.url, username: data.username, project: data.project });
						await this.connect(data.url, data.username, data.password, data.project);
						break;
					case 'disconnect':
						debugLog('Processing disconnect message');
						this.disconnect();
						break;
					case 'addToWorkspace':
						debugLog('Processing addToWorkspace message');
						this.openFiles();
						break;
					default:
						debugLog('Unknown message type', { type: data.type });
				}
			} catch (error: any) {
				debugLog('Error in message handler', { error: error.message, stack: error.stack });
				this._view?.webview.postMessage({
					type: 'connectionError',
					error: error.message || 'Connection failed'
				});
			}
		});

		this.updateWebview();
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>WebDAV Connection</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			background-color: var(--vscode-sideBar-background);
			color: var(--vscode-sideBar-foreground);
			margin: 0;
			padding: 16px;
		}
		.container { max-width: 100%; }
		.form-group { margin-bottom: 16px; }
		h3 {
			color: var(--vscode-editor-foreground);
			margin-top: 0;
			margin-bottom: 16px;
		}
		label {
			display: block;
			margin-bottom: 4px;
			font-weight: 600;
			color: var(--vscode-input-foreground);
		}
		input {
			width: 100%;
			padding: 8px 12px;
			border: 1px solid var(--vscode-input-border);
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 4px;
			font-size: 13px;
			box-sizing: border-box;
		}
		input:focus {
			outline: none;
			border-color: var(--vscode-focusBorder);
			box-shadow: 0 0 0 1px var(--vscode-focusBorder);
		}
		.btn {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 8px 16px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 13px;
			font-weight: 500;
			width: 100%;
			margin-top: 8px;
		}
		.btn:hover { background-color: var(--vscode-button-hoverBackground); }
		.btn:disabled {
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			cursor: not-allowed;
		}
		.btn-secondary {
			background-color: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.btn-secondary:hover { background-color: var(--vscode-button-secondaryHoverBackground); }
		.status-card {
			background-color: var(--vscode-editorWidget-background);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 6px;
			padding: 16px;
			margin-bottom: 16px;
		}
		.status-title {
			font-weight: 600;
			margin-bottom: 8px;
			color: var(--vscode-editor-foreground);
		}
		.status-item {
			display: flex;
			justify-content: space-between;
			margin-bottom: 4px;
			font-size: 12px;
		}
		.status-label { color: var(--vscode-descriptionForeground); }
		.status-value {
			color: var(--vscode-editor-foreground);
			font-weight: 500;
		}
		.success-indicator {
			color: var(--vscode-testing-iconPassed);
			font-weight: 600;
		}
		.hidden { display: none; }
		.error {
			color: var(--vscode-errorForeground);
			font-size: 12px;
			margin-top: 4px;
		}
		.loading {
			opacity: 0.6;
			pointer-events: none;
		}
	</style>
</head>
<body>
	<div class="container">
		<div id="connectionForm" class="connection-form">
			<h3>WebDAV Connection</h3>
			<form id="webdavForm">
				<div class="form-group">
					<label for="url">Server URL</label>
					<input type="url" id="url" placeholder="https://server.com/apps/remote/project" required>
					<div id="urlError" class="error hidden"></div>
				</div>
				<div class="form-group">
					<label for="username">Username</label>
					<input type="text" id="username" placeholder="Enter username" required>
				</div>
				<div class="form-group">
					<label for="password">Password</label>
					<input type="password" id="password" placeholder="Enter password" required>
				</div>
				<div class="form-group">
					<label for="project">Project Name</label>
					<input type="text" id="project" placeholder="Auto-detected or manual entry">
					<div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px;">
						Project will be auto-extracted from URL if available
					</div>
				</div>
				<button type="submit" class="btn" id="connectBtn">Connect to WebDAV</button>
			</form>
		</div>
		<div id="connectionStatus" class="hidden">
			<div class="status-card">
				<div class="status-title">
					<span class="success-indicator">✓</span> Connected to WebDAV
				</div>
				<div class="status-item">
					<span class="status-label">Server:</span>
					<span class="status-value" id="connectedUrl"></span>
				</div>
				<div class="status-item">
					<span class="status-label">User:</span>
					<span class="status-value" id="connectedUser"></span>
				</div>
				<div class="status-item">
					<span class="status-label">Project:</span>
					<span class="status-value" id="connectedProject"></span>
				</div>
			</div>
			<button class="btn" id="addWorkspaceBtn">Add to Workspace</button>
			<button class="btn btn-secondary" id="disconnectBtn">Disconnect</button>
		</div>
	</div>
</body>
</html>`;
		
		// Add the script separately to avoid template literal issues
		const script = this._getWebviewScript();
		const fullHtml = html.replace('</body>', script + '</body>');
		return fullHtml;
	}

	private _getWebviewScript(): string {
		return `
<script>
(function() {
	'use strict';
	
	const vscode = acquireVsCodeApi();
	
	function setupEventHandlers() {
		const webdavForm = document.getElementById('webdavForm');
		if (webdavForm) {
			webdavForm.addEventListener('submit', handleFormSubmit);
		}
		
		const disconnectBtn = document.getElementById('disconnectBtn');
		if (disconnectBtn) {
			disconnectBtn.addEventListener('click', handleDisconnect);
		}
		
		const addWorkspaceBtn = document.getElementById('addWorkspaceBtn');
		if (addWorkspaceBtn) {
			addWorkspaceBtn.addEventListener('click', handleAddWorkspace);
		}
		
		const urlInput = document.getElementById('url');
		if (urlInput) {
			urlInput.addEventListener('input', handleUrlChange);
		}
		
		window.addEventListener('message', handleMessage);
	}
	
	function handleFormSubmit(e) {
		e.preventDefault();
		
		const urlInput = document.getElementById('url');
		const usernameInput = document.getElementById('username');
		const passwordInput = document.getElementById('password');
		const projectInput = document.getElementById('project');
		
		if (!urlInput || !usernameInput || !passwordInput || !projectInput) {
			console.error('Form elements not found');
			return;
		}
		
		const url = urlInput.value;
		const username = usernameInput.value;
		const password = passwordInput.value;
		let project = projectInput.value;
		
		if (!project) {
			const match = url.match(/\\/apps\\/remote\\/([^\\/\\?#]+)/);
			project = match ? match[1] : '';
		}
		
		if (!project) {
			showError('Project name required. Please add it to the URL or enter manually.');
			return;
		}
		
		hideError();
		setLoadingState(true);
		
		vscode.postMessage({
			type: 'connect',
			url: url,
			username: username,
			password: password,
			project: project
		});
	}
	
	function handleDisconnect() {
		vscode.postMessage({ type: 'disconnect' });
	}
	
	function handleAddWorkspace() {
		vscode.postMessage({ type: 'addToWorkspace' });
	}
	
	function handleUrlChange(e) {
		const url = e.target.value;
		const projectField = document.getElementById('project');
		
		if (url && projectField && !projectField.value) {
			const match = url.match(/\\/apps\\/remote\\/([^\\/\\?#]+)/);
			if (match) {
				projectField.value = match[1];
			}
		}
	}
	
	function handleMessage(event) {
		const message = event.data;
		console.log('WebView received message:', message);
		
		switch (message.type) {
			case 'connectionStatus':
				if (message.connected) {
					showConnectionStatus(message);
				} else {
					showConnectionForm();
				}
				break;
			case 'connectionError':
				console.log('Connection error received:', message.error);
				setLoadingState(false);
				showError(message.error || 'Connection failed');
				break;
		}
	}
	
	function showConnectionStatus(message) {
		const connectionForm = document.getElementById('connectionForm');
		const connectionStatus = document.getElementById('connectionStatus');
		if (connectionForm) connectionForm.classList.add('hidden');
		if (connectionStatus) connectionStatus.classList.remove('hidden');
		
		const connectedUrl = document.getElementById('connectedUrl');
		const connectedUser = document.getElementById('connectedUser');
		const connectedProject = document.getElementById('connectedProject');
		if (connectedUrl) connectedUrl.textContent = message.url || '';
		if (connectedUser) connectedUser.textContent = message.username || '';
		if (connectedProject) connectedProject.textContent = message.project || '';
	}
	
	function showConnectionForm() {
		const connectionForm = document.getElementById('connectionForm');
		const connectionStatus = document.getElementById('connectionStatus');
		if (connectionForm) connectionForm.classList.remove('hidden');
		if (connectionStatus) connectionStatus.classList.add('hidden');
		setLoadingState(false);
	}
	
	function setLoadingState(loading) {
		const connectBtn = document.getElementById('connectBtn');
		if (connectBtn) {
			connectBtn.textContent = loading ? 'Connecting...' : 'Connect to WebDAV';
			connectBtn.disabled = loading;
		}
		const connectionForm = document.querySelector('.connection-form');
		if (connectionForm) {
			if (loading) {
				connectionForm.classList.add('loading');
			} else {
				connectionForm.classList.remove('loading');
			}
		}
	}
	
	function showError(message) {
		const urlError = document.getElementById('urlError');
		if (urlError) {
			urlError.textContent = message;
			urlError.classList.remove('hidden');
		}
	}
	
	function hideError() {
		const urlError = document.getElementById('urlError');
		if (urlError) {
			urlError.classList.add('hidden');
		}
	}
	
	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', setupEventHandlers);
	} else {
		setupEventHandlers();
	}
})();
</script>`;
	}

	private updateWebview() {
		if (this._view) {
			const message = {
				type: 'connectionStatus',
				connected: this.connected,
				url: this.credentials?.url,
				username: this.credentials?.username,
				project: this.credentials?.project
			};
			debugLog('Sending message to webview', message);
			this._view.webview.postMessage(message);
		} else {
			debugLog('Cannot update webview - view is null');
		}
	}

	// Force update webview with current connection state
	public forceUpdateWebview() {
		debugLog('Force updating webview with current state', {
			connected: this.connected,
			hasCredentials: !!this.credentials,
			hasProvider: !!this.fsProvider
		});
		this.updateWebview();
	}

	// Auto-reconnect if credentials are available
	public async autoReconnect() {
		debugLog('Auto-reconnect attempt started', {
			currentlyConnected: this.connected,
			hasCredentials: !!this.credentials,
			hasProvider: !!this.fsProvider
		});

		// If already connected, just update the webview
		if (this.connected && this.fsProvider && this.credentials) {
			debugLog('Already connected, updating webview');
			this.forceUpdateWebview();
			return;
		}

		// Try to restore from stored credentials
		try {
			const storedCredentials = await this.getStoredCredentials();
			if (storedCredentials) {
				debugLog('Found stored credentials for auto-reconnect', {
					url: storedCredentials.url,
					project: storedCredentials.project,
					username: storedCredentials.username
				});

				// Restore connection state
				this.credentials = storedCredentials;
				this.connected = true;
				this.fsProvider = new WebDAVFileSystemProvider(this.credentials);

				// Set the real provider in the placeholder
				if (globalPlaceholderProvider) {
					globalPlaceholderProvider.setRealProvider(this.fsProvider);
					debugLog('Real provider set in placeholder during auto-reconnect');
				}

				// Update webview to show connected state
				this.updateWebview();

				debugLog('Auto-reconnect successful', {
					url: storedCredentials.url,
					project: storedCredentials.project
				});

				// Show a subtle notification
				vscode.window.showInformationMessage(
					`Auto-connected to WebDAV: ${storedCredentials.project}`,
					'Hide'
				);

				return this.fsProvider;
			} else {
				debugLog('No stored credentials found for auto-reconnect');
				this.updateWebview();
			}
		} catch (error: any) {
			debugLog('Auto-reconnect failed', { error: error.message, stack: error.stack });
			this.updateWebview();
		}

		return null;
	}


	async connect(url: string, username: string, password: string, project?: string) {
		debugLog('Starting connection process', { url, username, project });
		
		try {
			// Extract project name from URL or use provided
			let finalProject = project;
			if (!finalProject) {
				finalProject = this.extractProjectFromUrl(url) || undefined;
			}
			
			debugLog('Project extraction complete', { finalProject, extractedFrom: url });

			if (!finalProject) {
				debugLog('No project name found, sending error');
				this._view?.webview.postMessage({
					type: 'connectionError',
					error: 'Project name is required'
				});
				return;
			}

			// Clean URL to base server URL
			const baseUrl = this.getBaseUrl(url);
			debugLog('URL processing', { originalUrl: url, baseUrl, project: finalProject });

			// Validate credentials by testing connection
			debugLog('Validating credentials...');
			const tempCredentials = { url: baseUrl, username, password, project: finalProject };
			const isValid = await this.validateCredentials(tempCredentials);
			
			if (!isValid) {
				debugLog('Credential validation failed');
				this._view?.webview.postMessage({
					type: 'connectionError',
					error: 'Invalid credentials or server unreachable. Please check your URL, username, and password.'
				});
				return;
			}
			
			debugLog('Credentials validated successfully');
			this.credentials = tempCredentials;
			this.connected = true;
			
			debugLog('Credentials set, storing...');
			// Store credentials securely
			await this.storeCredentials(this.credentials);
			
			debugLog('Creating filesystem provider...');
			// Create filesystem provider
			this.fsProvider = new WebDAVFileSystemProvider(this.credentials);
			debugLog('FileSystemProvider created', { baseUrl, project: finalProject });
			
			// Set the real provider in the placeholder
			if (globalPlaceholderProvider) {
				globalPlaceholderProvider.setRealProvider(this.fsProvider);
				debugLog('Real provider set in placeholder');
			}
			
			debugLog('Updating webview...');
			this.updateWebview();
			debugLog('Webview updated successfully');
			
			vscode.window.showInformationMessage(`Connected to WebDAV server: ${baseUrl} (Project: ${finalProject})`);
			debugOutput.show();
			
			return this.fsProvider;
		} catch (error: any) {
			debugLog('Connection failed', { error: error.message, stack: error.stack });
			this._view?.webview.postMessage({
				type: 'connectionError', 
				error: error.message || 'Connection failed'
			});
			throw error; // Re-throw so the message handler can catch it too
		}
	}

	disconnect() {
		this.credentials = null;
		this.connected = false;
		this.fsProvider = null;
		
		// Clear the real provider from the placeholder
		if (globalPlaceholderProvider) {
			globalPlaceholderProvider.setRealProvider(null);
		}
		
		this.updateWebview();
		vscode.window.showInformationMessage('Disconnected from WebDAV server');
		this.clearStoredCredentials();
	}

	async restoreConnection() {
		debugLog('Attempting to restore previous connection');
		try {
			const storedCredentials = await this.getStoredCredentials();
			if (storedCredentials) {
				debugLog('Found stored credentials, restoring connection');
				this.credentials = storedCredentials;
				this.connected = true;
				this.fsProvider = new WebDAVFileSystemProvider(this.credentials);
				
				// Set the real provider in the placeholder IMMEDIATELY
				if (globalPlaceholderProvider) {
					globalPlaceholderProvider.setRealProvider(this.fsProvider);
					debugLog('Real provider set in placeholder during restore');
				}
				
				this.updateWebview();
				
				vscode.window.showInformationMessage(`Reconnected to WebDAV server: ${storedCredentials.url} (Project: ${storedCredentials.project})`);
				debugLog('Connection restored successfully', { url: storedCredentials.url, project: storedCredentials.project });
				return this.fsProvider;
			} else {
				debugLog('No stored credentials found');
			}
		} catch (error: any) {
			debugLog('Failed to restore connection', { error: error.message });
		}
		return null;
	}

	private async storeCredentials(credentials: WebDAVCredentials) {
		try {
			// Store in VS Code secrets
			await globalContext.secrets.store('webdav-credentials', JSON.stringify(credentials));
			debugLog('Credentials stored in VS Code secrets');
			
			// Also store in localStorage as fallback for web environments
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('webdav-credentials', JSON.stringify(credentials));
				debugLog('Credentials stored in localStorage as fallback');
			}
		} catch (error: any) {
			debugLog('Failed to store credentials', { error: error.message });
		}
	}

	private async getStoredCredentials(): Promise<WebDAVCredentials | null> {
		let vsCodeCredentials: WebDAVCredentials | null = null;
		let localStorageCredentials: WebDAVCredentials | null = null;

		// Try VS Code secrets first
		try {
			const stored = await globalContext.secrets.get('webdav-credentials');
			if (stored) {
				vsCodeCredentials = JSON.parse(stored) as WebDAVCredentials;
				debugLog('Retrieved credentials from VS Code secrets');
			}
		} catch (error: any) {
			debugLog('Failed to get credentials from VS Code secrets', { error: error.message });
		}
		
		// Check localStorage
		try {
			if (typeof localStorage !== 'undefined') {
				const stored = localStorage.getItem('webdav-credentials');
				if (stored) {
					localStorageCredentials = JSON.parse(stored) as WebDAVCredentials;
					debugLog('Retrieved credentials from localStorage');
				}
			}
		} catch (error: any) {
			debugLog('Failed to get credentials from localStorage', { error: error.message });
		}

		// Sync credentials if they exist in one but not the other
		if (vsCodeCredentials && !localStorageCredentials) {
			try {
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem('webdav-credentials', JSON.stringify(vsCodeCredentials));
					debugLog('Synced credentials from VS Code secrets to localStorage');
				}
			} catch (error: any) {
				debugLog('Failed to sync to localStorage', { error: error.message });
			}
			return vsCodeCredentials;
		} else if (!vsCodeCredentials && localStorageCredentials) {
			try {
				await globalContext.secrets.store('webdav-credentials', JSON.stringify(localStorageCredentials));
				debugLog('Synced credentials from localStorage to VS Code secrets');
			} catch (error: any) {
				debugLog('Failed to sync to VS Code secrets', { error: error.message });
			}
			return localStorageCredentials;
		} else if (vsCodeCredentials) {
			// Both exist, prefer VS Code secrets
			return vsCodeCredentials;
		}
		
		debugLog('No stored credentials found in any storage');
		return null;
	}

	private async clearStoredCredentials() {
		try {
			// Clear from VS Code secrets
			await globalContext.secrets.delete('webdav-credentials');
			debugLog('Credentials cleared from VS Code secrets');
		} catch (error: any) {
			debugLog('Failed to clear VS Code secrets', { error: error.message });
		}
		
		try {
			// Clear from localStorage
			if (typeof localStorage !== 'undefined') {
				localStorage.removeItem('webdav-credentials');
				debugLog('Credentials cleared from localStorage');
			}
		} catch (error: any) {
			debugLog('Failed to clear localStorage', { error: error.message });
		}
	}

	async openFiles() {
		if (!this.fsProvider || !this.credentials?.project) {
			vscode.window.showErrorMessage('Not connected to WebDAV server');
			return;
		}

		debugLog('Opening files - ensuring connection is active', { 
			hasProvider: !!this.fsProvider, 
			hasCredentials: !!this.credentials,
			connected: this.connected,
			project: this.credentials?.project 
		});

		// Ensure the global placeholder provider has the real provider set
		if (globalPlaceholderProvider && this.fsProvider) {
			debugLog('Setting real provider in global placeholder');
			globalPlaceholderProvider.setRealProvider(this.fsProvider);
		} else {
			debugLog('Warning: Global placeholder provider or fs provider not available');
		}

		// Add WebDAV as a workspace folder to integrate with VS Code's native explorer
		const workspaceFolder: vscode.WorkspaceFolder = {
			uri: vscode.Uri.parse(`webdav:/`),
			name: this.credentials.project, // Use just the project name
			index: 0
		};

		debugLog('Adding WebDAV workspace folder', { workspaceFolder });

		// Add the workspace folder to VS Code
		const success = vscode.workspace.updateWorkspaceFolders(0, 0, workspaceFolder);
		
		if (success) {
			debugLog('Workspace folder added successfully');
			vscode.window.showInformationMessage(`WebDAV project "${this.credentials.project}" added to workspace`);
			
			// Don't update webview after adding to workspace to prevent reset
			// The connection should remain intact
			debugLog('Preserving connection state after workspace addition');
			
			// Force refresh the explorer to show the new files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
		} else {
			debugLog('Failed to add workspace folder');
			vscode.window.showErrorMessage('Failed to add WebDAV folder to workspace');
		}
	}

	private extractProjectFromUrl(url: string): string | null {
		// Extract project name from URL pattern: .../apps/remote/PROJECT_NAME
		const remotePattern = /\/apps\/remote\/([^\/\?#]+)/;
		const match = url.match(remotePattern);
		return match ? match[1] : null;
	}

	private getBaseUrl(url: string): string {
		// Remove /apps/remote/project_name from the URL to get base server URL
		const remotePattern = /\/apps\/remote\/[^\/\?#]+.*$/;
		return url.replace(remotePattern, '');
	}

	private async validateCredentials(credentials: WebDAVCredentials): Promise<boolean> {
		try {
			debugLog('Testing WebDAV connection', { url: credentials.url, project: credentials.project });
			
			// Test connection by attempting to list the project root directory
			const testURL = `${credentials.url}/apps/remote/${credentials.project}/`;
			
			const response = await fetch(testURL, {
				method: 'GET',
				headers: {
					'Authorization': `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'User-Agent': 'VSCode-WebDAV-Extension'
				},
				mode: 'cors',
				credentials: 'include'
			});
			
			debugLog('Validation response', { status: response.status, statusText: response.statusText });
			
			// Check if the response is successful (200-299 range)
			if (response.ok) {
				debugLog('Credential validation successful');
				return true;
			} else if (response.status === 401 || response.status === 403) {
				debugLog('Authentication failed', { status: response.status });
				return false;
			} else {
				debugLog('Server error during validation', { status: response.status });
				return false;
			}
		} catch (error: any) {
			debugLog('Credential validation error', { error: error.message });
			
			// Check if this is a CORS error
			if (error.message === 'Failed to fetch') {
				debugLog('CORS Error during validation - assuming credentials are valid for now');
				// In web environments, CORS might prevent validation, but credentials could still be valid
				// We'll allow it to proceed but log the issue
				return true;
			}
			
			return false;
		}
	}
}


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
let globalFsProvider: WebDAVFileSystemProvider | null = null;
let debugOutput: vscode.OutputChannel;
let globalPlaceholderProvider: PlaceholderFileSystemProvider;
let globalContext: vscode.ExtensionContext;

function debugLog(message: string, data?: any) {
	const timestamp = new Date().toISOString();
	if (data) {
		debugOutput.appendLine(`[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}`);
	} else {
		debugOutput.appendLine(`[${timestamp}] ${message}`);
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Store context globally for persistence
	globalContext = context;
	
	// Create debug output channel
	debugOutput = vscode.window.createOutputChannel('WebDAV Debug');
	context.subscriptions.push(debugOutput);
	
	const timestamp = new Date().toISOString();
	debugOutput.appendLine(`===============================================`);
	debugOutput.appendLine(`[${timestamp}] WebDAV extension ACTIVATED`);
	debugOutput.appendLine(`Extension path: ${context.extensionPath}`);
	debugOutput.appendLine(`Extension mode: ${context.extensionMode}`);
	debugOutput.appendLine(`===============================================`);
	console.log('WebDAV extension activated at', timestamp);

	// Register a placeholder filesystem provider immediately
	globalPlaceholderProvider = new PlaceholderFileSystemProvider();
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider('webdav', globalPlaceholderProvider, { isCaseSensitive: false })
	);
	debugLog('Global placeholder provider registered');

	// Create WebView provider
	const viewProvider = new WebDAVViewProvider(context.extensionUri);
	
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(WebDAVViewProvider.viewType, viewProvider)
	);
	debugLog('WebView provider registered');
	
	// Try to auto-reconnect AFTER providers are registered
	setTimeout(async () => {
		debugLog('Attempting auto-reconnect after initialization');
		await viewProvider.autoReconnect();
	}, 200);

	// Add workspace change handler to maintain connection
	const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		debugLog('Workspace folders changed', { 
			added: event.added.length, 
			removed: event.removed.length 
		});
		
		// Auto-reconnect to maintain connection state after workspace changes
		setTimeout(async () => {
			debugLog('Auto-reconnecting after workspace change');
			await viewProvider.autoReconnect();
		}, 500);
	});
	context.subscriptions.push(workspaceWatcher);

	const showDebugCommand = vscode.commands.registerCommand('automate-webdav.showDebug', () => {
		debugOutput.show();
	});

	context.subscriptions.push(showDebugCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {
	const timestamp = new Date().toISOString();
	if (debugOutput) {
		debugOutput.appendLine(`===============================================`);
		debugOutput.appendLine(`[${timestamp}] WebDAV extension DEACTIVATED`);
		debugOutput.appendLine(`===============================================`);
	}
	console.log('WebDAV extension deactivated at', timestamp);
}
