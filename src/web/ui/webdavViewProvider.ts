import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { WebDAVFileSystemProvider } from '../providers/webdavFileSystemProvider';
import { WebDAVFileSearchProvider } from '../providers/fileSearchProvider';
import { WebDAVTextSearchProvider } from '../providers/textSearchProvider';
import { IPHPDefinitionProvider } from '../providers/phpDefinitionProviderInterface';
import { WebDAVFileIndex } from '../core/fileIndex';
import { TemplateLoader } from './templates/templateLoader';

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
		private readonly globalPhpDefinitionProvider: IPHPDefinitionProvider,
		private readonly globalFileIndex: WebDAVFileIndex,
		private readonly globalContext: vscode.ExtensionContext,
		private readonly globalStubFileCreator: (() => Promise<void>) | null,
		private readonly debugOutput: vscode.OutputChannel
	) {}

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

		webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);

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
			this.fsProvider = new WebDAVFileSystemProvider(this.credentials, this.globalContext);
			
			// Set dependencies for filesystem provider
			this.fsProvider.setDebugLogger(this.debugLog);
			this.fsProvider.setFileIndex(this.globalFileIndex);
			
			// Initialize cache warming and file system
			await this.fsProvider.initialize();
			
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
			if (this.globalPhpDefinitionProvider) {
				this.globalPhpDefinitionProvider.setCredentials(this.credentials);
				this.globalPhpDefinitionProvider.setFileSystemProvider(this.fsProvider);
				this.debugLog('Credentials and file system provider set for PHP definition provider');
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
			
			vscode.window.showInformationMessage(`Connected to edoc Automate server: ${baseUrl} (Project: ${finalProject})`);
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

	async openFiles() {
		if (!this.fsProvider || !this.credentials?.project) {
			vscode.window.showErrorMessage('Not connected to edoc Automate server');
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
			vscode.window.showInformationMessage(`edoc Automate project "${this.credentials.project}" added to workspace`);
			
			// Don't update webview after adding to workspace to prevent reset
			// The connection should remain intact
			this.debugLog('Preserving connection state after workspace addition');
			
			// Start file indexing to make them searchable
			if (this.fsProvider && this.fsProvider.getFileIndex()) {
				setTimeout(async () => {
					await this.fsProvider!.getFileIndex()?.quickIndex();
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
			vscode.window.showErrorMessage('Failed to add edoc Automate folder to workspace');
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
			this.debugLog('Testing edoc Automate connection', { url: credentials.url, project: credentials.project });
			
			// Test connection by attempting to list the project root directory
			const testURL = `${credentials.url}/apps/remote/${credentials.project}/`;
			
			const response = await fetch(testURL, {
				method: 'GET',
				headers: {
					'Authorization': `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'User-Agent': 'VSCode-edoc-Automate-Extension'
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