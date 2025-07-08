import * as vscode from 'vscode';
import { Command } from './commandManager';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';

export class TestVirtualFileCommand implements Command {
	constructor(
		private placeholderProvider: PlaceholderFileSystemProvider,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Test virtual file command triggered');
		
		try {
			// Check if there's a WebDAV connection
			const realProvider = this.placeholderProvider?.getRealProvider();
			if (!realProvider) {
				this.debugLog('No WebDAV connection found');
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to a WebDAV server first.');
				return;
			}
			
			this.debugLog('Creating test virtual file');
			
			// Create a simple test file in the root
			const testContent = new TextEncoder().encode('This is a test virtual file!\nCreated by WebDAV extension.');
			realProvider.createVirtualFile('/test-virtual-file.txt', testContent);
			
			// Create a test directory with a file
			realProvider.createVirtualDirectory('/test-dir');
			realProvider.createVirtualFile('/test-dir/nested-file.txt', new TextEncoder().encode('Nested virtual file content'));
			
			this.debugLog('Virtual files created', {
				rootFile: '/test-virtual-file.txt',
				directory: '/test-dir',
				nestedFile: '/test-dir/nested-file.txt',
				virtualFileCount: realProvider.getVirtualFileCount()
			});
			
			// Force refresh the file explorer and try to open the WebDAV workspace
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			
			// Try to open the WebDAV workspace if it's not already open
			const webdavUri = vscode.Uri.parse('webdav:/');
			const workspaceFolders = vscode.workspace.workspaceFolders || [];
			const hasWebdavWorkspace = workspaceFolders.some(folder => folder.uri.scheme === 'webdav');
			
			if (!hasWebdavWorkspace) {
				this.debugLog('Adding WebDAV workspace to VS Code');
				try {
					// Try to add the WebDAV root as a workspace folder
					const added = vscode.workspace.updateWorkspaceFolders(
						workspaceFolders.length, 
						0, 
						{ uri: webdavUri, name: 'WebDAV' }
					);
					if (added) {
						this.debugLog('Successfully added WebDAV workspace folder');
					} else {
						this.debugLog('Failed to add WebDAV workspace folder');
					}
				} catch (error: any) {
					this.debugLog('Error adding WebDAV workspace folder', { error: error.message });
				}
			} else {
				this.debugLog('WebDAV workspace already exists');
			}
			
			// Refresh the file explorer to show the new virtual files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			this.debugLog('File explorer refreshed to show virtual files');
			
			vscode.window.showInformationMessage('Test virtual files created! Check the file explorer.');
			
		} catch (error: any) {
			this.debugLog('Failed to create test virtual files', { error: error.message });
			vscode.window.showErrorMessage(`Failed to create test virtual files: ${error.message}`);
		}
	}
}