import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { WebDAVFileSystemProvider } from '../providers/webdavFileSystemProvider';
import { WebDAVFileSearchProvider } from '../providers/fileSearchProvider';
import { WebDAVTextSearchProvider } from '../providers/textSearchProvider';
import { IPHPDefinitionProvider } from '../providers/phpDefinitionProviderInterface';
import { WebDAVFileIndex } from '../core/fileIndex';
import { TemplateLoader } from './templates/templateLoader';
import { WebDAVApi } from '../core/webdavApi';
import { WorkspaceManager } from '../services/workspaceManager';
import { getFetchMode } from '../utils/platformUtils';
import { WebDAVProtocolType, WebDAVProtocolInterface } from '../core/webdavProtocol';
import { WebDAVProtocolFactory } from '../core/webdavProtocolFactory';

export class WebDAVViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'webdavConnection';
	private _view?: vscode.WebviewView;
	private credentials: WebDAVCredentials | null = null;
	private connected = false;
	private fsProvider: WebDAVFileSystemProvider | null = null;
	private protocolHandler: WebDAVProtocolInterface | null = null;
	private workspaceManager: WorkspaceManager;
	private cachedProjects: any[] = [];
	private webviewState: any = {};

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly debugLog: (message: string, data?: any) => void,
		private readonly globalPlaceholderProvider: any,
		private readonly globalFileSearchProvider: WebDAVFileSearchProvider,
		private readonly globalTextSearchProvider: WebDAVTextSearchProvider,
		private readonly globalPhpDefinitionProvider: IPHPDefinitionProvider,
		private readonly globalFileIndex: WebDAVFileIndex,
		private readonly globalContext: vscode.ExtensionContext,
		private readonly globalStubFileCreator: (() => Promise<void>) | null,
		private readonly debugOutput: vscode.OutputChannel
	) {
		this.workspaceManager = new WorkspaceManager(this.globalContext, this.debugLog);
		
		// Set workspace manager on search providers for multi-workspace support
		this.globalFileSearchProvider.setWorkspaceManager(this.workspaceManager);
		this.globalTextSearchProvider.setWorkspaceManager(this.workspaceManager);
		
		// Set workspace manager on PHP definition provider for multi-workspace symbol search
		if (this.globalPhpDefinitionProvider && 'setWorkspaceManager' in this.globalPhpDefinitionProvider) {
			(this.globalPhpDefinitionProvider as any).setWorkspaceManager(this.workspaceManager);
		}
	}

	public async resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};
		
		// Enable retaining context when hidden (VS Code API property)
		if ('retainContextWhenHidden' in webviewView) {
			(webviewView as any).retainContextWhenHidden = true;
		}

		webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);

		// Add visibility change handler to maintain connection state
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.debugLog('Webview became visible, restoring state');
				this.autoReconnect().then(() => {
					// Restore webview state after reconnection
					this.restoreWebviewState();
				});
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
						this.debugLog('Processing connect message', { url: data.url, username: data.username, protocol: data.protocol });
						await this.connect(data.url, data.username, data.password, data.protocol);
						break;
					case 'disconnect':
						this.debugLog('Processing disconnect message');
						this.disconnect();
						break;
					case 'addToWorkspace':
						this.debugLog('Processing addToWorkspace message', { customName: data.customName });
						await this.addToWorkspace(data.customName);
						break;
					case 'addProjectToWorkspace':
						this.debugLog('Processing addProjectToWorkspace message', { project: data.project, customName: data.customName });
						await this.addProjectToWorkspace(data.project, data.customName);
						break;
					case 'getWorkspaces':
						this.debugLog('Processing getWorkspaces message');
						this.sendWorkspaceList();
						break;
					case 'workspaceAction':
						this.debugLog('Processing workspaceAction message', { action: data.action, workspaceId: data.workspaceId });
						await this.handleWorkspaceAction(data.action, data.workspaceId, data);
						break;
					case 'showInputBox':
						this.debugLog('Processing showInputBox message', { prompt: data.prompt, workspaceId: data.workspaceId });
						await this.handleShowInputBox(data.prompt, data.value, data.workspaceId);
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

	private async _getHtmlForWebview(_webview: vscode.Webview): Promise<string> {
		const templateLoader = new TemplateLoader(this._extensionUri);
		return await templateLoader.loadWebviewTemplate('webdav-connection');
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

	private async updateWebviewWithProjects() {
		if (this._view && this.credentials) {
			try {
				const baseUrl = this.getBaseUrl(this.credentials.url);
				this.debugLog('Fetching projects for webview', { baseUrl, username: this.credentials.username });
				
				const response = await WebDAVApi.getProjectList(baseUrl, this.credentials.username, this.credentials.password);
				
				this.debugLog('Project list response', { 
					success: response.success, 
					itemCount: response.items?.length || 0,
					error: response.error,
					items: response.items?.map(item => item.name) || []
				});
				
				// Cache the projects for state restoration
				if (response.success && response.items) {
					this.cachedProjects = response.items;
					this.webviewState.availableProjects = response.items;
				}
				
				const message = {
					type: 'connectionStatus',
					connected: this.connected,
					url: this.credentials.url,
					username: this.credentials.username,
					project: this.credentials.project,
					availableProjects: response.success ? response.items : [],
					projectListError: !response.success ? (response.error || 'Failed to fetch projects') : undefined
				};
				
				this.debugLog('Sending message to webview with projects', message);
				this._view.webview.postMessage(message);
				
				// Show user notification if no projects found
				if (response.success && response.items.length === 0) {
					vscode.window.showWarningMessage('No projects found in /apps/remote/. Check if projects exist on the server.');
				} else if (!response.success) {
					vscode.window.showErrorMessage(`Failed to load projects: ${response.error}`);
				}
			} catch (error: any) {
				this.debugLog('Error fetching projects for webview', { error: error.message, stack: error.stack });
				vscode.window.showErrorMessage(`Error loading projects: ${error.message}`);
				this.updateWebview(); // Fallback to regular update
			}
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

	// Restore webview state after visibility change
	private restoreWebviewState() {
		if (this._view && this.connected && this.credentials) {
			this.debugLog('Restoring webview state', {
				hasCachedProjects: this.cachedProjects.length > 0,
				cachedProjectCount: this.cachedProjects.length
			});

			if (this.cachedProjects.length > 0) {
				const message = {
					type: 'connectionStatus',
					connected: this.connected,
					url: this.credentials.url,
					username: this.credentials.username,
					project: this.credentials.project,
					availableProjects: this.cachedProjects
				};
				
				this.debugLog('Sending cached projects to webview', message);
				this._view.webview.postMessage(message);
			} else {
				// If no cached projects, fetch them again
				this.debugLog('No cached projects, fetching fresh data');
				this.updateWebviewWithProjects();
			}
		}
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
				
				// Create protocol handler based on stored protocol
				const protocolType = storedCredentials.protocol === 'webdav' ? WebDAVProtocolType.WEBDAV : WebDAVProtocolType.HTTP;
				this.protocolHandler = WebDAVProtocolFactory.create(protocolType, this.debugLog);
				this.debugLog('Protocol handler created during auto-reconnect', { protocolType });
				
				this.fsProvider = new WebDAVFileSystemProvider(this.credentials, this.globalContext);
				
				// Set dependencies for filesystem provider
				this.fsProvider.setDebugLogger(this.debugLog);
				this.fsProvider.setFileIndex(this.globalFileIndex);
					
				// Initialize cache warming and file system
				await this.fsProvider.initialize();

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
				if (this.globalPhpDefinitionProvider) {
					this.globalPhpDefinitionProvider.setCredentials(this.credentials);
					this.globalPhpDefinitionProvider.setFileSystemProvider(this.fsProvider);
					this.debugLog('Credentials and file system provider set for PHP definition provider during auto-reconnect');
				}
				if (this.globalFileIndex) {
					this.globalFileIndex.setCredentials(this.credentials);
					// Note: Indexing will start when workspace is activated, not during auto-reconnect
					this.debugLog('Credentials set for file index during auto-reconnect - indexing deferred until workspace activation');
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
					`Auto-connected to edoc Automate: ${storedCredentials.project}`,
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

	async fetchProjects(url: string, username: string, password: string) {
		this.debugLog('Fetching available projects', { url, username });
		
		try {
			const baseUrl = this.getBaseUrl(url);
			const response = await WebDAVApi.getProjectList(baseUrl, username, password);
			
			if (response.success) {
				this.debugLog('Projects fetched successfully', { count: response.items.length });
				this._view?.webview.postMessage({
					type: 'projectList',
					projects: response.items.map(item => ({ name: item.name }))
				});
			} else {
				this.debugLog('Failed to fetch projects', { error: response.error });
				this._view?.webview.postMessage({
					type: 'projectList',
					projects: [],
					error: response.error || 'Failed to fetch projects'
				});
			}
		} catch (error: any) {
			this.debugLog('Error fetching projects', { error: error.message });
			this._view?.webview.postMessage({
				type: 'projectList',
				projects: [],
				error: error.message || 'Failed to fetch projects'
			});
		}
	}

	async connect(url: string, username: string, password: string, protocol: string = 'http') {
		this.debugLog('Starting connection process', { url, username, protocol });
		
		try {
			// Clean URL to base server URL
			const baseUrl = this.getBaseUrl(url);
			this.debugLog('URL processing', { originalUrl: url, baseUrl });

			// Create protocol handler
			const protocolType = protocol === 'webdav' ? WebDAVProtocolType.WEBDAV : WebDAVProtocolType.HTTP;
			this.protocolHandler = WebDAVProtocolFactory.create(protocolType, this.debugLog);
			this.debugLog('Protocol handler created', { protocolType });

			// Validate credentials by testing connection to base URL
			this.debugLog('Validating credentials...');
			const tempCredentials = { url: baseUrl, username, password, protocol };
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
			this.fsProvider = new WebDAVFileSystemProvider(this.credentials, this.globalContext);
			
			// Set dependencies for filesystem provider
			this.fsProvider.setDebugLogger(this.debugLog);
			this.fsProvider.setFileIndex(this.globalFileIndex);
			
			// Initialize cache warming and file system
			await this.fsProvider.initialize();
			
			this.debugLog('FileSystemProvider created', { baseUrl });
			
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
			if (this.globalPhpDefinitionProvider) {
				this.globalPhpDefinitionProvider.setCredentials(this.credentials);
				this.globalPhpDefinitionProvider.setFileSystemProvider(this.fsProvider);
				this.debugLog('Credentials and file system provider set for PHP definition provider');
			}
			if (this.globalFileIndex) {
				this.globalFileIndex.setCredentials(this.credentials);
				// Note: Do not start indexing here - wait until project is added to workspace
				this.debugLog('Credentials set for file index - indexing deferred until workspace addition');
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
			await this.updateWebviewWithProjects();
			this.debugLog('Webview updated successfully');
			
			vscode.window.showInformationMessage(`Connected to edoc Automate server: ${baseUrl}`);
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
		this.protocolHandler = null;
		
		// Clear cached state
		this.cachedProjects = [];
		this.webviewState = {};
		
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
		vscode.window.showInformationMessage('Disconnected from edoc Automate server');
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
				
				// Create protocol handler based on stored protocol
				const protocolType = storedCredentials.protocol === 'webdav' ? WebDAVProtocolType.WEBDAV : WebDAVProtocolType.HTTP;
				this.protocolHandler = WebDAVProtocolFactory.create(protocolType, this.debugLog);
				this.debugLog('Protocol handler created during restore', { protocolType });
				
				this.fsProvider = new WebDAVFileSystemProvider(this.credentials);
				
				// Set dependencies for filesystem provider
				this.fsProvider.setDebugLogger(this.debugLog);
				this.fsProvider.setFileIndex(this.globalFileIndex);
					
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
					// Note: Indexing will start when workspace is activated, not during restore
					this.debugLog('Credentials set for file index during restore - indexing deferred until workspace activation');
				}
				
				// Create stub files after restore
				if (this.globalStubFileCreator) {
					this.globalStubFileCreator().catch(error => {
						this.debugLog('Error creating stub files during restore', { error: error.message });
					});
				}
				
				this.updateWebview();
				
				vscode.window.showInformationMessage(`Reconnected to edoc Automate server: ${storedCredentials.url} (Project: ${storedCredentials.project})`);
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

	// Note: openFiles method removed - workspace management now handled by WorkspaceManager


	private getBaseUrl(url: string): string {
		// Remove /apps/remote/project_name from the URL to get base server URL
		const remotePattern = /\/apps\/remote\/[^\/\?#]+.*$/;
		
		// If URL already contains /apps/remote/, remove everything after it
		if (url.includes('/apps/remote/')) {
			return url.replace(remotePattern, '');
		}
		
		// If URL doesn't contain /apps/remote/, just return the clean URL
		return url.replace(/\/$/, ''); // Remove trailing slash
	}

	private async validateCredentials(credentials: WebDAVCredentials): Promise<boolean> {
		try {
			this.debugLog('Testing edoc Automate connection', { url: credentials.url });
			
			// Test connection by attempting to list the apps/remote directory
			const testURL = `${credentials.url}/apps/remote/`;
			
			const response = await fetch(testURL, {
				method: 'GET',
				headers: {
					'Authorization': `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'User-Agent': 'VSCode-edoc-Automate-Extension',
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				},
				mode: getFetchMode(),
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

	/**
	 * Add a specific project to workspace
	 */
	async addProjectToWorkspace(projectName: string, customName?: string): Promise<void> {
		if (!this.credentials) {
			vscode.window.showErrorMessage('Not connected to edoc Automate server');
			return;
		}

		try {
			// Create credentials for the selected project
			const projectCredentials = {
				...this.credentials,
				project: projectName
			};

			const workspaceId = await this.workspaceManager.addWorkspace(projectCredentials, customName);
			const fsProvider = await this.workspaceManager.activateWorkspace(workspaceId);
			
			if (fsProvider) {
				// Set up providers for the new workspace
				this.setupProvidersForWorkspace(fsProvider, workspaceId);
				
				// Check if credentials were updated during activation and re-register if needed
				if ((fsProvider as any)._credentialsUpdated) {
					this.debugLog('Re-registering providers after credential update', { workspaceId });
					this.setupProvidersForWorkspace(fsProvider, workspaceId);
				}
				
				this.sendWorkspaceList();
				
				// Clear the custom name input and project selection
				this._view?.webview.postMessage({
					type: 'clearWorkspaceForm'
				});
			}
		} catch (error: any) {
			this.debugLog('Error adding project to workspace', { projectName, error: error.message });
			vscode.window.showErrorMessage(`Failed to add project workspace: ${error.message}`);
		}
	}

	/**
	 * Add current connection to workspace
	 */
	async addToWorkspace(customName?: string): Promise<void> {
		if (!this.credentials) {
			vscode.window.showErrorMessage('Not connected to edoc Automate server');
			return;
		}

		try {
			const workspaceId = await this.workspaceManager.addWorkspace(this.credentials, customName);
			const fsProvider = await this.workspaceManager.activateWorkspace(workspaceId);
			
			if (fsProvider) {
				// Set up providers for the new workspace
				this.setupProvidersForWorkspace(fsProvider, workspaceId);
				
				// Check if credentials were updated during activation and re-register if needed
				if ((fsProvider as any)._credentialsUpdated) {
					this.debugLog('Re-registering providers after credential update', { workspaceId });
					this.setupProvidersForWorkspace(fsProvider, workspaceId);
				}
				
				this.sendWorkspaceList();
				
				// Clear the custom name input
				this._view?.webview.postMessage({
					type: 'clearWorkspaceName'
				});
			}
		} catch (error: any) {
			this.debugLog('Error adding workspace', { error: error.message });
			vscode.window.showErrorMessage(`Failed to add workspace: ${error.message}`);
		}
	}

	/**
	 * Handle workspace actions (activate, deactivate, rename, delete)
	 */
	async handleWorkspaceAction(action: string, workspaceId: string, data: any): Promise<void> {
		try {
			switch (action) {
				case 'activate':
					const fsProvider = await this.workspaceManager.activateWorkspace(workspaceId);
					if (fsProvider) {
						this.setupProvidersForWorkspace(fsProvider, workspaceId);
						
						// Check if credentials were updated during activation and re-register if needed
						if ((fsProvider as any)._credentialsUpdated) {
							this.debugLog('Re-registering providers after credential update during activation', { workspaceId });
							this.setupProvidersForWorkspace(fsProvider, workspaceId);
						}
					}
					break;
					
				case 'deactivate':
					await this.workspaceManager.deactivateWorkspace(workspaceId);
					// Clean up provider registration for this workspace
					this.cleanupProvidersForWorkspace(workspaceId);
					break;
					
				case 'rename':
					if (data.newName) {
						await this.workspaceManager.renameWorkspace(workspaceId, data.newName);
					}
					break;
					
				case 'delete':
					const workspace = this.workspaceManager.getWorkspaces().find(w => w.id === workspaceId);
					if (workspace) {
						const confirm = await vscode.window.showWarningMessage(
							`Are you sure you want to delete workspace "${workspace.name}"?`,
							'Delete', 'Cancel'
						);
						if (confirm === 'Delete') {
							// Clean up provider registration before removing workspace
							this.cleanupProvidersForWorkspace(workspaceId);
							await this.workspaceManager.removeWorkspace(workspaceId);
						}
					}
					break;
			}
			
			this.sendWorkspaceList();
		} catch (error: any) {
			this.debugLog('Error handling workspace action', { action, workspaceId, error: error.message });
			vscode.window.showErrorMessage(`Failed to ${action} workspace: ${error.message}`);
		}
	}

	/**
	 * Handle input box request from webview
	 */
	async handleShowInputBox(prompt: string, defaultValue: string, workspaceId: string): Promise<void> {
		try {
			const newName = await vscode.window.showInputBox({
				prompt: prompt,
				value: defaultValue,
				validateInput: (value) => {
					if (!value || !value.trim()) {
						return 'Workspace name cannot be empty';
					}
					return null;
				}
			});

			if (newName && newName.trim() && newName.trim() !== defaultValue) {
				await this.workspaceManager.renameWorkspace(workspaceId, newName.trim());
				this.sendWorkspaceList();
			}
		} catch (error: any) {
			this.debugLog('Error handling input box', { error: error.message });
			vscode.window.showErrorMessage(`Failed to rename workspace: ${error.message}`);
		}
	}

	/**
	 * Send workspace list to webview
	 */
	private sendWorkspaceList(): void {
		const workspaces = this.workspaceManager.getWorkspaces();
		this._view?.webview.postMessage({
			type: 'workspaceList',
			workspaces: workspaces
		});
	}

	/**
	 * Setup providers for a workspace
	 */
	private setupProvidersForWorkspace(fsProvider: WebDAVFileSystemProvider, workspaceId: string): void {
		const fileIndex = this.workspaceManager.getFileIndex(workspaceId);
		const workspace = this.workspaceManager.getWorkspaces().find(w => w.id === workspaceId);
		
		if (!workspace || !fileIndex) return;

		// Set up providers for this workspace
		if (this.globalPlaceholderProvider) {
			// Register provider for this specific project
			if (workspace.credentials.project && typeof this.globalPlaceholderProvider.setRealProviderForProject === 'function') {
				this.globalPlaceholderProvider.setRealProviderForProject(workspace.credentials.project, fsProvider);
			} else {
				// Fallback to default provider method
				this.globalPlaceholderProvider.setRealProvider(fsProvider);
			}
		}

		if (this.globalFileSearchProvider) {
			this.globalFileSearchProvider.setCredentials(workspace.credentials);
		}
		
		if (this.globalTextSearchProvider) {
			this.globalTextSearchProvider.setCredentials(workspace.credentials);
		}
		
		if (this.globalPhpDefinitionProvider) {
			this.globalPhpDefinitionProvider.setCredentials(workspace.credentials);
			this.globalPhpDefinitionProvider.setFileSystemProvider(fsProvider);
		}

		// Start indexing
		fileIndex.rebuildIndex().catch(error => {
			this.debugLog('Error rebuilding index for workspace', { workspaceId, error: error.message });
		});

		// Create stub files
		if (this.globalStubFileCreator) {
			this.globalStubFileCreator().catch(error => {
				this.debugLog('Error creating stub files for workspace', { workspaceId, error: error.message });
			});
		}
	}

	/**
	 * Clean up providers for a workspace
	 */
	private cleanupProvidersForWorkspace(workspaceId: string): void {
		const workspace = this.workspaceManager.getWorkspaces().find(w => w.id === workspaceId);
		
		if (workspace && workspace.credentials.project && this.globalPlaceholderProvider) {
			if (typeof this.globalPlaceholderProvider.setRealProviderForProject === 'function') {
				this.globalPlaceholderProvider.setRealProviderForProject(workspace.credentials.project, null);
				this.debugLog('Provider cleaned up for project', { project: workspace.credentials.project });
			}
		}
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		this.workspaceManager.dispose();
	}
}