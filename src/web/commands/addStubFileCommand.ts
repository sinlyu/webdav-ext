import * as vscode from 'vscode';
import { Command } from './commandManager';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';

export class AddStubFileCommand implements Command {
	constructor(
		private context: vscode.ExtensionContext,
		private placeholderProvider: PlaceholderFileSystemProvider,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Add stub file command triggered');
		
		try {
			// Check if there's a WebDAV connection
			const realProvider = this.placeholderProvider?.getRealProvider();
			if (!realProvider) {
				this.debugLog('No WebDAV connection found');
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to a WebDAV server first.');
				return;
			}
			
			const stubUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'web', 'resources', 'automate.meta.php');
			
			// Create virtual directories
			this.debugLog('Creating virtual directories for stub file');
			realProvider.createVirtualDirectory('~/.stubs');
			
			// Read the stub file content
			const stubContent = await vscode.workspace.fs.readFile(stubUri);
			this.debugLog('Read source stub file', { size: stubContent.length });
			
			// Create virtual stub file
			realProvider.createVirtualFile('~/.stubs/automate.meta.php', stubContent);
			
			// Refresh the file explorer to show the new virtual files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			this.debugLog('File explorer refreshed to show virtual files');
			
			// Show success message
			vscode.window.showInformationMessage('PHP Automate meta file added as virtual file in WebDAV workspace for autocompletion!');
			this.debugLog('Virtual stub file created in WebDAV filesystem', { virtualPath: '~/.stubs/automate.meta.php' });
			
		} catch (error: any) {
			this.debugLog('Failed to add virtual stub file', { error: error.message });
			vscode.window.showErrorMessage(`Failed to add stub file: ${error.message}`);
		}
	}
}