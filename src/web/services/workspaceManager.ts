import * as vscode from 'vscode';
import { WebDAVCredentials, WebDAVWorkspace, MultiWorkspaceState } from '../types';
import { WebDAVFileSystemProvider } from '../providers/webdavFileSystemProvider';
import { WebDAVFileIndex } from '../core/fileIndex';

export class WorkspaceManager {
	private state: MultiWorkspaceState = { workspaces: [] };
	private fsProviders: Map<string, WebDAVFileSystemProvider> = new Map();
	private fileIndexes: Map<string, WebDAVFileIndex> = new Map();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly debugLog: (message: string, data?: any) => void
	) {
		this.loadState();
	}

	/**
	 * Add a new workspace
	 */
	async addWorkspace(credentials: WebDAVCredentials, customName?: string): Promise<string> {
		const workspaceId = this.generateWorkspaceId();
		const defaultName = customName || `${credentials.project} (${new URL(credentials.url).hostname})`;
		
		const workspace: WebDAVWorkspace = {
			id: workspaceId,
			name: defaultName,
			credentials,
			isActive: false,
			dateAdded: Date.now()
		};

		this.state.workspaces.push(workspace);
		await this.saveState();

		this.debugLog('Workspace added', { id: workspaceId, name: defaultName });
		return workspaceId;
	}

	/**
	 * Remove a workspace
	 */
	async removeWorkspace(workspaceId: string): Promise<boolean> {
		const index = this.state.workspaces.findIndex(w => w.id === workspaceId);
		if (index === -1) return false;

		const workspace = this.state.workspaces[index];
		
		// Clean up providers and indexes
		this.fsProviders.delete(workspaceId);
		this.fileIndexes.delete(workspaceId);

		// Remove from VS Code workspace if active
		if (workspace.isActive) {
			await this.removeFromVSCodeWorkspace(workspace);
		}

		this.state.workspaces.splice(index, 1);
		
		// Update active workspace if removed workspace was active
		if (this.state.activeWorkspaceId === workspaceId) {
			this.state.activeWorkspaceId = undefined;
		}

		await this.saveState();
		this.debugLog('Workspace removed', { id: workspaceId });
		return true;
	}

	/**
	 * Rename a workspace
	 */
	async renameWorkspace(workspaceId: string, newName: string): Promise<boolean> {
		const workspace = this.state.workspaces.find(w => w.id === workspaceId);
		if (!workspace) return false;

		const oldName = workspace.name;
		workspace.name = newName;
		await this.saveState();

		// Update VS Code workspace folder name if active
		if (workspace.isActive) {
			await this.updateVSCodeWorkspaceName(workspace);
		}

		this.debugLog('Workspace renamed', { id: workspaceId, oldName, newName });
		return true;
	}

	/**
	 * Activate a workspace (add to VS Code workspace)
	 */
	async activateWorkspace(workspaceId: string): Promise<WebDAVFileSystemProvider | null> {
		const workspace = this.state.workspaces.find(w => w.id === workspaceId);
		if (!workspace) return null;

		// Create file system provider if not exists
		let fsProvider = this.fsProviders.get(workspaceId);
		if (!fsProvider) {
			fsProvider = new WebDAVFileSystemProvider(workspace.credentials, this.context);
			fsProvider.setDebugLogger(this.debugLog);
			
			// Create and set file index
			const fileIndex = new WebDAVFileIndex(workspace.credentials);
			fileIndex.setDebugLogger(this.debugLog);
			fsProvider.setFileIndex(fileIndex);
			
			this.fsProviders.set(workspaceId, fsProvider);
			this.fileIndexes.set(workspaceId, fileIndex);
			
			await fsProvider.initialize();
		}

		// Add to VS Code workspace using a unique URI for each project
		const workspaceFolder: vscode.WorkspaceFolder = {
			uri: vscode.Uri.parse(`webdav:/${workspace.credentials.project || workspace.id}`),
			name: workspace.name,
			index: vscode.workspace.workspaceFolders?.length || 0
		};

		const success = vscode.workspace.updateWorkspaceFolders(
			vscode.workspace.workspaceFolders?.length || 0, 
			0, 
			workspaceFolder
		);

		if (success) {
			workspace.isActive = true;
			this.state.activeWorkspaceId = workspaceId;
			await this.saveState();
			
			this.debugLog('Workspace activated', { id: workspaceId, name: workspace.name });
			vscode.window.showInformationMessage(`Workspace "${workspace.name}" added to VS Code`);
		}

		return fsProvider;
	}

	/**
	 * Deactivate a workspace (remove from VS Code workspace)
	 */
	async deactivateWorkspace(workspaceId: string): Promise<boolean> {
		const workspace = this.state.workspaces.find(w => w.id === workspaceId);
		if (!workspace || !workspace.isActive) return false;

		await this.removeFromVSCodeWorkspace(workspace);
		workspace.isActive = false;
		
		if (this.state.activeWorkspaceId === workspaceId) {
			this.state.activeWorkspaceId = undefined;
		}

		await this.saveState();
		this.debugLog('Workspace deactivated', { id: workspaceId });
		return true;
	}

	/**
	 * Get all workspaces
	 */
	getWorkspaces(): WebDAVWorkspace[] {
		return [...this.state.workspaces];
	}

	/**
	 * Get active workspace
	 */
	getActiveWorkspace(): WebDAVWorkspace | null {
		if (!this.state.activeWorkspaceId) return null;
		return this.state.workspaces.find(w => w.id === this.state.activeWorkspaceId) || null;
	}

	/**
	 * Get file system provider for workspace
	 */
	getFileSystemProvider(workspaceId: string): WebDAVFileSystemProvider | null {
		return this.fsProviders.get(workspaceId) || null;
	}

	/**
	 * Get file index for workspace
	 */
	getFileIndex(workspaceId: string): WebDAVFileIndex | null {
		return this.fileIndexes.get(workspaceId) || null;
	}

	/**
	 * Update VS Code workspace folder name
	 */
	private async updateVSCodeWorkspaceName(workspace: WebDAVWorkspace): Promise<void> {
		const expectedUri = `webdav:/${workspace.credentials.project || workspace.id}`;
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		const folderIndex = workspaceFolders.findIndex(folder => 
			folder.uri.toString() === expectedUri
		);

		if (folderIndex !== -1) {
			// Remove old folder and add new one with updated name
			const newFolder: vscode.WorkspaceFolder = {
				uri: workspaceFolders[folderIndex].uri,
				name: workspace.name,
				index: folderIndex
			};

			vscode.workspace.updateWorkspaceFolders(folderIndex, 1, newFolder);
		}
	}

	/**
	 * Remove workspace from VS Code
	 */
	private async removeFromVSCodeWorkspace(workspace: WebDAVWorkspace): Promise<void> {
		const expectedUri = `webdav:/${workspace.credentials.project || workspace.id}`;
		const workspaceFolders = vscode.workspace.workspaceFolders || [];
		const folderIndex = workspaceFolders.findIndex(folder => 
			folder.uri.toString() === expectedUri
		);

		if (folderIndex !== -1) {
			vscode.workspace.updateWorkspaceFolders(folderIndex, 1);
		}
	}

	/**
	 * Generate unique workspace ID
	 */
	private generateWorkspaceId(): string {
		return `workspace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Load state from storage
	 */
	private async loadState(): Promise<void> {
		try {
			const stored = await this.context.secrets.get('webdav-workspaces');
			if (stored) {
				this.state = JSON.parse(stored);
				this.debugLog('Workspace state loaded', { 
					workspaceCount: this.state.workspaces.length,
					activeWorkspace: this.state.activeWorkspaceId 
				});
			}
		} catch (error: any) {
			this.debugLog('Failed to load workspace state', { error: error.message });
		}
	}

	/**
	 * Save state to storage
	 */
	private async saveState(): Promise<void> {
		try {
			await this.context.secrets.store('webdav-workspaces', JSON.stringify(this.state));
			this.debugLog('Workspace state saved');
		} catch (error: any) {
			this.debugLog('Failed to save workspace state', { error: error.message });
		}
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		this.fsProviders.forEach(provider => provider.dispose());
		this.fsProviders.clear();
		this.fileIndexes.clear();
	}
}