import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { WebDAVFileSystemProvider } from '../providers/webdavFileSystemProvider';
import { WebDAVFileSearchProvider } from '../providers/fileSearchProvider';
import { WebDAVTextSearchProvider } from '../providers/textSearchProvider';
import { WebDAVFileIndex } from '../core/fileIndex';

export class WebDAVViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'webdavConnection';
	private _view?: vscode.WebviewView;
	private credentials: WebDAVCredentials | null = null;
	private connected = false;
	private fsProvider: WebDAVFileSystemProvider | null = null;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly debugLog: (message: string, data?: any) => void,
		private readonly globalPlaceholderProvider: any,
		private readonly globalFileSearchProvider: WebDAVFileSearchProvider,
		private readonly globalTextSearchProvider: WebDAVTextSearchProvider,
		private readonly globalFileIndex: WebDAVFileIndex,
		private readonly globalContext: vscode.ExtensionContext,
		private readonly globalStubFileCreator: (() => Promise<void>) | null,
		private readonly debugOutput: vscode.OutputChannel
	) {}

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
				this.debugLog('Webview became visible, attempting auto-reconnect');
				this.autoReconnect();
			}
		});

		// Attempt auto-reconnect immediately when webview is resolved
		setTimeout(() => {
			this.debugLog('Webview resolved, attempting initial auto-reconnect');
			this.autoReconnect();
		}, 100);

		webviewView.webview.onDidReceiveMessage(async data => {
			this.debugLog('WebView received message', { type: data.type, data });
			try {
				switch (data.type) {
					case 'test':
						this.debugLog('Test message received from webview');
						vscode.window.showInformationMessage('Webview test successful!');
						break;
					case 'connect':
						this.debugLog('Processing connect message', { url: data.url, username: data.username, project: data.project });
						await this.connect(data.url, data.username, data.password, data.project);
						break;
					case 'disconnect':
						this.debugLog('Processing disconnect message');
						this.disconnect();
						break;
					case 'addToWorkspace':
						this.debugLog('Processing addToWorkspace message');
						this.openFiles();
						break;
					default:
						this.debugLog('Unknown message type', { type: data.type });
				}
			} catch (error: any) {
				this.debugLog('Error in message handler', { error: error.message, stack: error.stack });
				this._view?.webview.postMessage({
					type: 'connectionError',
					error: error.message || 'Connection failed'
				});
			}
		});

		this.updateWebview();
	}

	private _getHtmlForWebview(_webview: vscode.Webview) {
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
			this.debugLog('Sending message to webview', message);
			this._view.webview.postMessage(message);
		} else {
			this.debugLog('Cannot update webview - view is null');
		}
	}

	// Force update webview with current connection state
	public forceUpdateWebview() {
		this.debugLog('Force updating webview with current state', {
			connected: this.connected,
			hasCredentials: !!this.credentials,
			hasProvider: !!this.fsProvider
		});
		this.updateWebview();
	}

	// Auto-reconnect if credentials are available
	public async autoReconnect() {
		this.debugLog('Auto-reconnect attempt started', {
			currentlyConnected: this.connected,
			hasCredentials: !!this.credentials,
			hasProvider: !!this.fsProvider
		});

		// If already connected, just update the webview
		if (this.connected && this.fsProvider && this.credentials) {
			this.debugLog('Already connected, updating webview');
			this.forceUpdateWebview();
			return;
		}

		// Try to restore from stored credentials
		try {
			const storedCredentials = await this.getStoredCredentials();
			if (storedCredentials) {
				this.debugLog('Found stored credentials for auto-reconnect', {
					url: storedCredentials.url,
					project: storedCredentials.project,
					username: storedCredentials.username
				});

				// Restore connection state
				this.credentials = storedCredentials;
				this.connected = true;
				this.fsProvider = new WebDAVFileSystemProvider(this.credentials);
				
				// Set dependencies for filesystem provider
				this.fsProvider.setDebugLogger(this.debugLog);
				this.fsProvider.setFileIndex(this.globalFileIndex);
				this.fsProvider.setDebugOutput(this.debugOutput);

				// Set the real provider in the placeholder
				if (this.globalPlaceholderProvider) {
					this.globalPlaceholderProvider.setRealProvider(this.fsProvider);
					this.debugLog('Real provider set in placeholder during auto-reconnect');
				}

				// Set credentials for search providers
				if (this.globalFileSearchProvider) {
					this.globalFileSearchProvider.setCredentials(this.credentials);
					this.debugLog('Credentials set for file search provider during auto-reconnect');
				}
				if (this.globalTextSearchProvider) {
					this.globalTextSearchProvider.setCredentials(this.credentials);
					this.debugLog('Credentials set for text search provider during auto-reconnect');
				}
				if (this.globalFileIndex) {
					this.globalFileIndex.setCredentials(this.credentials);
					// Start indexing after credentials are set
					this.globalFileIndex.rebuildIndex().catch(error => {
						this.debugLog('Error rebuilding index during auto-reconnect', { error: error.message });
					});
					this.debugLog('Credentials set for file index during auto-reconnect');
				}
				
				// Create stub files after auto-reconnect
				if (this.globalStubFileCreator) {
					this.globalStubFileCreator().catch(error => {
						this.debugLog('Error creating stub files during auto-reconnect', { error: error.message });
					});
				}

				// Update webview to show connected state
				this.updateWebview();

				this.debugLog('Auto-reconnect successful', {
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
				this.debugLog('No stored credentials found for auto-reconnect');
				this.updateWebview();
			}
		} catch (error: any) {
			this.debugLog('Auto-reconnect failed', { error: error.message, stack: error.stack });
			this.updateWebview();
		}

		return null;
	}

	async connect(url: string, username: string, password: string, project?: string) {
		this.debugLog('Starting connection process', { url, username, project });
		
		try {
			// Extract project name from URL or use provided
			let finalProject = project;
			if (!finalProject) {
				finalProject = this.extractProjectFromUrl(url) || undefined;
			}
			
			this.debugLog('Project extraction complete', { finalProject, extractedFrom: url });

			if (!finalProject) {
				this.debugLog('No project name found, sending error');
				this._view?.webview.postMessage({
					type: 'connectionError',
					error: 'Project name is required'
				});
				return;
			}

			// Clean URL to base server URL
			const baseUrl = this.getBaseUrl(url);
			this.debugLog('URL processing', { originalUrl: url, baseUrl, project: finalProject });

			// Validate credentials by testing connection
			this.debugLog('Validating credentials...');
			const tempCredentials = { url: baseUrl, username, password, project: finalProject };
			const isValid = await this.validateCredentials(tempCredentials);
			
			if (!isValid) {
				this.debugLog('Credential validation failed');
				this._view?.webview.postMessage({
					type: 'connectionError',
					error: 'Invalid credentials or server unreachable. Please check your URL, username, and password.'
				});
				return;
			}
			
			this.debugLog('Credentials validated successfully');
			this.credentials = tempCredentials;
			this.connected = true;
			
			this.debugLog('Credentials set, storing...');
			// Store credentials securely
			await this.storeCredentials(this.credentials);
			
			this.debugLog('Creating filesystem provider...');
			// Create filesystem provider
			this.fsProvider = new WebDAVFileSystemProvider(this.credentials);
			
			// Set dependencies for filesystem provider
			this.fsProvider.setDebugLogger(this.debugLog);
			this.fsProvider.setFileIndex(this.globalFileIndex);
			this.fsProvider.setDebugOutput(this.debugOutput);
			
			this.debugLog('FileSystemProvider created', { baseUrl, project: finalProject });
			
			// Set the real provider in the placeholder
			if (this.globalPlaceholderProvider) {
				this.globalPlaceholderProvider.setRealProvider(this.fsProvider);
				this.debugLog('Real provider set in placeholder');
			}

			// Set credentials for search providers
			if (this.globalFileSearchProvider) {
				this.globalFileSearchProvider.setCredentials(this.credentials);
				this.debugLog('Credentials set for file search provider');
			}
			if (this.globalTextSearchProvider) {
				this.globalTextSearchProvider.setCredentials(this.credentials);
				this.debugLog('Credentials set for text search provider');
			}
			if (this.globalFileIndex) {
				this.globalFileIndex.setCredentials(this.credentials);
				// Start indexing after credentials are set
				this.globalFileIndex.rebuildIndex().catch(error => {
					this.debugLog('Error rebuilding index during connect', { error: error.message });
				});
				this.debugLog('Credentials set for file index');
			}
			
			// Create stub files after connection is established
			// Schedule this for after the connection is fully established
			setTimeout(() => {
				if (this.globalStubFileCreator) {
					this.globalStubFileCreator().catch(error => {
						this.debugLog('Error creating stub files during connect', { error: error.message });
					});
				}
			}, 1000);
			
			this.debugLog('Updating webview...');
			this.updateWebview();
			this.debugLog('Webview updated successfully');
			
			vscode.window.showInformationMessage(`Connected to WebDAV server: ${baseUrl} (Project: ${finalProject})`);
			this.debugOutput.show();
			
			return this.fsProvider;
		} catch (error: any) {
			this.debugLog('Connection failed', { error: error.message, stack: error.stack });
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
		if (this.globalPlaceholderProvider) {
			this.globalPlaceholderProvider.setRealProvider(null);
		}

		// Clear credentials from search providers
		if (this.globalFileSearchProvider) {
			this.globalFileSearchProvider.setCredentials(null);
		}
		if (this.globalTextSearchProvider) {
			this.globalTextSearchProvider.setCredentials(null);
		}
		if (this.globalFileIndex) {
			this.globalFileIndex.setCredentials(null);
		}
		
		this.updateWebview();
		vscode.window.showInformationMessage('Disconnected from WebDAV server');
		this.clearStoredCredentials();
	}

	async restoreConnection() {
		this.debugLog('Attempting to restore previous connection');
		try {
			const storedCredentials = await this.getStoredCredentials();
			if (storedCredentials) {
				this.debugLog('Found stored credentials, restoring connection');
				this.credentials = storedCredentials;
				this.connected = true;
				this.fsProvider = new WebDAVFileSystemProvider(this.credentials);
				
				// Set dependencies for filesystem provider
				this.fsProvider.setDebugLogger(this.debugLog);
				this.fsProvider.setFileIndex(this.globalFileIndex);
				this.fsProvider.setDebugOutput(this.debugOutput);
				
				// Set the real provider in the placeholder IMMEDIATELY
				if (this.globalPlaceholderProvider) {
					this.globalPlaceholderProvider.setRealProvider(this.fsProvider);
					this.debugLog('Real provider set in placeholder during restore');
				}

				// Set credentials for search providers
				if (this.globalFileSearchProvider) {
					this.globalFileSearchProvider.setCredentials(this.credentials);
					this.debugLog('Credentials set for file search provider during restore');
				}
				if (this.globalTextSearchProvider) {
					this.globalTextSearchProvider.setCredentials(this.credentials);
					this.debugLog('Credentials set for text search provider during restore');
				}
				if (this.globalFileIndex) {
					this.globalFileIndex.setCredentials(this.credentials);
					// Start indexing after credentials are set
					this.globalFileIndex.rebuildIndex().catch(error => {
						this.debugLog('Error rebuilding index during restore', { error: error.message });
					});
					this.debugLog('Credentials set for file index during restore');
				}
				
				// Create stub files after restore
				if (this.globalStubFileCreator) {
					this.globalStubFileCreator().catch(error => {
						this.debugLog('Error creating stub files during restore', { error: error.message });
					});
				}
				
				this.updateWebview();
				
				vscode.window.showInformationMessage(`Reconnected to WebDAV server: ${storedCredentials.url} (Project: ${storedCredentials.project})`);
				this.debugLog('Connection restored successfully', { url: storedCredentials.url, project: storedCredentials.project });
				return this.fsProvider;
			} else {
				this.debugLog('No stored credentials found');
			}
		} catch (error: any) {
			this.debugLog('Failed to restore connection', { error: error.message });
		}
		return null;
	}

	private async storeCredentials(credentials: WebDAVCredentials) {
		try {
			// Store in VS Code secrets
			await this.globalContext.secrets.store('webdav-credentials', JSON.stringify(credentials));
			this.debugLog('Credentials stored in VS Code secrets');
			
			// Also store in localStorage as fallback for web environments
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('webdav-credentials', JSON.stringify(credentials));
				this.debugLog('Credentials stored in localStorage as fallback');
			}
		} catch (error: any) {
			this.debugLog('Failed to store credentials', { error: error.message });
		}
	}

	private async getStoredCredentials(): Promise<WebDAVCredentials | null> {
		let vsCodeCredentials: WebDAVCredentials | null = null;
		let localStorageCredentials: WebDAVCredentials | null = null;

		// Try VS Code secrets first
		try {
			const stored = await this.globalContext.secrets.get('webdav-credentials');
			if (stored) {
				vsCodeCredentials = JSON.parse(stored) as WebDAVCredentials;
				this.debugLog('Retrieved credentials from VS Code secrets');
			}
		} catch (error: any) {
			this.debugLog('Failed to get credentials from VS Code secrets', { error: error.message });
		}
		
		// Check localStorage
		try {
			if (typeof localStorage !== 'undefined') {
				const stored = localStorage.getItem('webdav-credentials');
				if (stored) {
					localStorageCredentials = JSON.parse(stored) as WebDAVCredentials;
					this.debugLog('Retrieved credentials from localStorage');
				}
			}
		} catch (error: any) {
			this.debugLog('Failed to get credentials from localStorage', { error: error.message });
		}

		// Sync credentials if they exist in one but not the other
		if (vsCodeCredentials && !localStorageCredentials) {
			try {
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem('webdav-credentials', JSON.stringify(vsCodeCredentials));
					this.debugLog('Synced credentials from VS Code secrets to localStorage');
				}
			} catch (error: any) {
				this.debugLog('Failed to sync to localStorage', { error: error.message });
			}
			return vsCodeCredentials;
		} else if (!vsCodeCredentials && localStorageCredentials) {
			try {
				await this.globalContext.secrets.store('webdav-credentials', JSON.stringify(localStorageCredentials));
				this.debugLog('Synced credentials from localStorage to VS Code secrets');
			} catch (error: any) {
				this.debugLog('Failed to sync to VS Code secrets', { error: error.message });
			}
			return localStorageCredentials;
		} else if (vsCodeCredentials) {
			// Both exist, prefer VS Code secrets
			return vsCodeCredentials;
		}
		
		this.debugLog('No stored credentials found in any storage');
		return null;
	}

	private async clearStoredCredentials() {
		try {
			// Clear from VS Code secrets
			await this.globalContext.secrets.delete('webdav-credentials');
			this.debugLog('Credentials cleared from VS Code secrets');
		} catch (error: any) {
			this.debugLog('Failed to clear VS Code secrets', { error: error.message });
		}
		
		try {
			// Clear from localStorage
			if (typeof localStorage !== 'undefined') {
				localStorage.removeItem('webdav-credentials');
				this.debugLog('Credentials cleared from localStorage');
			}
		} catch (error: any) {
			this.debugLog('Failed to clear localStorage', { error: error.message });
		}
	}

	async openFiles() {
		if (!this.fsProvider || !this.credentials?.project) {
			vscode.window.showErrorMessage('Not connected to WebDAV server');
			return;
		}

		this.debugLog('Opening files - ensuring connection is active', { 
			hasProvider: !!this.fsProvider, 
			hasCredentials: !!this.credentials,
			connected: this.connected,
			project: this.credentials?.project 
		});

		// Ensure the global placeholder provider has the real provider set
		if (this.globalPlaceholderProvider && this.fsProvider) {
			this.debugLog('Setting real provider in global placeholder');
			this.globalPlaceholderProvider.setRealProvider(this.fsProvider);
		} else {
			this.debugLog('Warning: Global placeholder provider or fs provider not available');
		}

		// Add WebDAV as a workspace folder to integrate with VS Code's native explorer
		const workspaceFolder: vscode.WorkspaceFolder = {
			uri: vscode.Uri.parse(`webdav:/`),
			name: this.credentials.project, // Use just the project name
			index: 0
		};

		this.debugLog('Adding WebDAV workspace folder', { workspaceFolder });

		// Add the workspace folder to VS Code
		const success = vscode.workspace.updateWorkspaceFolders(0, 0, workspaceFolder);
		
		if (success) {
			this.debugLog('Workspace folder added successfully');
			vscode.window.showInformationMessage(`WebDAV project "${this.credentials.project}" added to workspace`);
			
			// Don't update webview after adding to workspace to prevent reset
			// The connection should remain intact
			this.debugLog('Preserving connection state after workspace addition');
			
			// Index all files to make them searchable
			if (this.fsProvider) {
				setTimeout(async () => {
					await this.fsProvider!.indexAllFiles();
					this.debugLog('Files indexed after workspace addition');
				}, 1000);
			}
			
			// Create stub files after workspace is added
			if (this.globalStubFileCreator) {
				setTimeout(() => {
					this.globalStubFileCreator!().catch(error => {
						this.debugLog('Error creating stub files after workspace addition', { error: error.message });
					});
				}, 2000);
			}
			
			// Force refresh the explorer to show the new files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
		} else {
			this.debugLog('Failed to add workspace folder');
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
			this.debugLog('Testing WebDAV connection', { url: credentials.url, project: credentials.project });
			
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
			
			this.debugLog('Validation response', { status: response.status, statusText: response.statusText });
			
			// Check if the response is successful (200-299 range)
			if (response.ok) {
				this.debugLog('Credential validation successful');
				return true;
			} else if (response.status === 401 || response.status === 403) {
				this.debugLog('Authentication failed', { status: response.status });
				return false;
			} else {
				this.debugLog('Server error during validation', { status: response.status });
				return false;
			}
		} catch (error: any) {
			this.debugLog('Credential validation error', { error: error.message });
			
			// Check if this is a CORS error
			if (error.message === 'Failed to fetch') {
				this.debugLog('CORS Error during validation - assuming credentials are valid for now');
				// In web environments, CORS might prevent validation, but credentials could still be valid
				// We'll allow it to proceed but log the issue
				return true;
			}
			
			return false;
		}
	}
}