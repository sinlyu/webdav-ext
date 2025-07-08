import * as vscode from 'vscode';
import { Command } from './commandManager';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';

export class TestGoToDefinitionCommand implements Command {
	constructor(
		private placeholderProvider: PlaceholderFileSystemProvider,
		private stubFileCreator: (() => Promise<void>) | null,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Test go-to-definition command triggered');
		
		try {
			// Test opening the stub file directly
			const stubUri = vscode.Uri.parse('webdav:/.stubs/automate.meta.php');
			this.debugLog('Testing direct opening of stub file', { uri: stubUri.toString() });
			
			// Check if WebDAV provider is available
			const realProvider = this.placeholderProvider?.getRealProvider();
			if (!realProvider) {
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to WebDAV first.');
				return;
			}
			
			// Check if stub file exists
			if (!realProvider.hasVirtualFile('~/.stubs/automate.meta.php')) {
				vscode.window.showWarningMessage('Stub file not found. Creating it now...');
				if (this.stubFileCreator) {
					await this.stubFileCreator();
					vscode.window.showInformationMessage('Stub file created. Try again.');
				}
				return;
			}
			
			// Try to open the document
			const document = await vscode.workspace.openTextDocument(stubUri);
			await vscode.window.showTextDocument(document);
			
			vscode.window.showInformationMessage('Stub file opened successfully! Go-to-definition should work now.');
			this.debugLog('Successfully opened stub file for testing', {
				uri: stubUri.toString(),
				lineCount: document.lineCount,
				languageId: document.languageId
			});
			
		} catch (error: any) {
			this.debugLog('Failed to test go-to-definition', { error: error.message, stack: error.stack });
			vscode.window.showErrorMessage(`Failed to test go-to-definition: ${error.message}`);
		}
	}
}