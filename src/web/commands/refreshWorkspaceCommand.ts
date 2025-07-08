/**
 * Refresh Workspace Command
 * 
 * Refreshes the WebDAV workspace and file index
 */

import * as vscode from 'vscode';
import { Command } from './commandManager';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';
import { createChildLogger, ChildLogger } from '../utils/logger';

export class RefreshWorkspaceCommand implements Command {
	private logger: ChildLogger;

	constructor(private placeholderProvider: PlaceholderFileSystemProvider) {
		this.logger = createChildLogger('RefreshWorkspaceCommand');
	}

	async execute(): Promise<void> {
		this.logger.info('Refresh workspace command triggered');
		
		try {
			// Refresh the file index
			const realProvider = this.placeholderProvider.getRealProvider();
			if (realProvider && realProvider.getFileIndex()) {
				await realProvider.getFileIndex()?.quickIndex();
			}
			
			// Refresh VS Code file explorer
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			
			vscode.window.showInformationMessage('WebDAV workspace refreshed and indexed');
			this.logger.info('Workspace refresh completed successfully');
		} catch (error: any) {
			this.logger.exception('Failed to refresh workspace', error);
			vscode.window.showErrorMessage(`Failed to refresh workspace: ${error.message}`);
		}
	}
}