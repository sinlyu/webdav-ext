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

class WebDAVTreeDataProvider implements vscode.TreeDataProvider<WebDAVTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<WebDAVTreeItem | undefined | null | void> = new vscode.EventEmitter<WebDAVTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<WebDAVTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	private credentials: WebDAVCredentials | null = null;
	private connected = false;
	private fsProvider: WebDAVFileSystemProvider | null = null;

	getTreeItem(element: WebDAVTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: WebDAVTreeItem): Thenable<WebDAVTreeItem[]> {
		if (!element) {
			return Promise.resolve(this.getConnectionItems());
		}
		
		return Promise.resolve([]);
	}

	private getConnectionItems(): WebDAVTreeItem[] {
		if (!this.connected) {
			return [
				new WebDAVTreeItem('Click to connect to WebDAV server', vscode.TreeItemCollapsibleState.None, 'connect', {
					command: 'automate-webdav.connect',
					title: 'Connect to WebDAV'
				})
			];
		} else {
			return [
				new WebDAVTreeItem(`✓ Connected to ${this.credentials?.url}`, vscode.TreeItemCollapsibleState.None, 'status'),
				new WebDAVTreeItem(`User: ${this.credentials?.username}`, vscode.TreeItemCollapsibleState.None, 'info'),
				new WebDAVTreeItem(`Project: ${this.credentials?.project || 'None'}`, vscode.TreeItemCollapsibleState.None, 'info'),
				new WebDAVTreeItem('Add to Workspace', vscode.TreeItemCollapsibleState.None, 'openFiles', {
					command: 'automate-webdav.openFiles',
					title: 'Add WebDAV to Workspace'
				}),
				new WebDAVTreeItem('Disconnect', vscode.TreeItemCollapsibleState.None, 'disconnect', {
					command: 'automate-webdav.disconnect',
					title: 'Disconnect'
				})
			];
		}
	}


	async connect() {
		debugLog('Starting connection process');
		
		const url = await vscode.window.showInputBox({
			prompt: 'Enter WebDAV server URL',
			placeHolder: 'https://edocadpsolutionsqa.westeurope.cloudapp.azure.com/apps/remote/test_uther',
			validateInput: (text) => {
				if (!text) {
					return 'URL is required';
				}
				try {
					new URL(text);
					return null;
				} catch {
					return 'Please enter a valid URL';
				}
			}
		});

		if (!url) {
			debugLog('Connection cancelled - no URL provided');
			return;
		}

		const username = await vscode.window.showInputBox({
			prompt: 'Enter username',
			placeHolder: 'username'
		});

		if (!username) {
			debugLog('Connection cancelled - no username provided');
			return;
		}

		const password = await vscode.window.showInputBox({
			prompt: 'Enter password',
			placeHolder: 'password',
			password: true
		});

		if (!password) {
			debugLog('Connection cancelled - no password provided');
			return;
		}

		// Extract project name from URL or prompt for it
		let project: string | null = this.extractProjectFromUrl(url);
		debugLog('Project extraction result', { url, extractedProject: project });
		
		if (!project) {
			const userProject = await vscode.window.showInputBox({
				prompt: 'Enter project name',
				placeHolder: 'test_uther',
				validateInput: (text) => {
					if (!text) {
						return 'Project name is required';
					}
					return null;
				}
			});
			project = userProject || null;
			debugLog('Manual project input result', { project });
		}

		if (!project) {
			debugLog('Connection failed - no project name');
			vscode.window.showErrorMessage('Project name is required to connect');
			return;
		}

		// Clean URL to base server URL (remove /apps/remote/project if present)
		const baseUrl = this.getBaseUrl(url);
		debugLog('URL processing', { originalUrl: url, baseUrl, project });

		this.credentials = { url: baseUrl, username, password, project };
		this.connected = true;
		
		// Store credentials securely
		await this.storeCredentials(this.credentials);
		
		// Create filesystem provider (but don't register it - it's already registered as placeholder)
		this.fsProvider = new WebDAVFileSystemProvider(this.credentials);
		debugLog('FileSystemProvider created', { baseUrl, project });
		
		this._onDidChangeTreeData.fire();
		vscode.window.showInformationMessage(`Connected to WebDAV server: ${baseUrl} (Project: ${project})`);
		debugOutput.show(); // Show debug output when connecting
		
		return this.fsProvider;
	}

	disconnect() {
		this.credentials = null;
		this.connected = false;
		this.fsProvider = null;
		this._onDidChangeTreeData.fire();
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
				this._onDidChangeTreeData.fire();
				
				// Set the real provider in the placeholder
				if (globalPlaceholderProvider) {
					globalPlaceholderProvider.setRealProvider(this.fsProvider);
				}
				
				vscode.window.showInformationMessage(`Reconnected to WebDAV server: ${storedCredentials.url}`);
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
			await globalContext.secrets.store('webdav-credentials', JSON.stringify(credentials));
			debugLog('Credentials stored successfully');
		} catch (error: any) {
			debugLog('Failed to store credentials', { error: error.message });
		}
	}

	private async getStoredCredentials(): Promise<WebDAVCredentials | null> {
		try {
			const stored = await globalContext.secrets.get('webdav-credentials');
			if (stored) {
				return JSON.parse(stored) as WebDAVCredentials;
			}
		} catch (error: any) {
			debugLog('Failed to get stored credentials', { error: error.message });
		}
		return null;
	}

	private async clearStoredCredentials() {
		try {
			await globalContext.secrets.delete('webdav-credentials');
			debugLog('Stored credentials cleared');
		} catch (error: any) {
			debugLog('Failed to clear stored credentials', { error: error.message });
		}
	}

	async openFiles() {
		if (!this.fsProvider || !this.credentials?.project) {
			vscode.window.showErrorMessage('Not connected to WebDAV server');
			return;
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
			vscode.window.showInformationMessage(`WebDAV project "${this.credentials.project}" added to workspace`);
		} else {
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
}

class WebDAVTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly contextValue: string,
		command?: vscode.Command,
		public readonly filePath?: string
	) {
		super(label, collapsibleState);
		this.command = command;
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

	const provider = new WebDAVTreeDataProvider();
	
	// Try to restore previous connection
	provider.restoreConnection();
	
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('webdavConnection', provider)
	);

	// Register a placeholder filesystem provider immediately
	globalPlaceholderProvider = new PlaceholderFileSystemProvider();
	context.subscriptions.push(
		vscode.workspace.registerFileSystemProvider('webdav', globalPlaceholderProvider, { isCaseSensitive: false })
	);

	const connectCommand = vscode.commands.registerCommand('automate-webdav.connect', async () => {
		const fsProvider = await provider.connect();
		if (fsProvider) {
			globalFsProvider = fsProvider;
			globalPlaceholderProvider.setRealProvider(fsProvider);
		}
	});

	const disconnectCommand = vscode.commands.registerCommand('automate-webdav.disconnect', () => {
		provider.disconnect();
		globalFsProvider = null;
		globalPlaceholderProvider.setRealProvider(null);
	});

	const openFilesCommand = vscode.commands.registerCommand('automate-webdav.openFiles', () => {
		provider.openFiles();
	});


	const showDebugCommand = vscode.commands.registerCommand('automate-webdav.showDebug', () => {
		debugOutput.show();
	});

	context.subscriptions.push(connectCommand, disconnectCommand, openFilesCommand, showDebugCommand);
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
