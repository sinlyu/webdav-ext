import * as vscode from 'vscode';
import { Command } from './commandManager';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';

export class CreateActionCommand implements Command {
	constructor(
		private context: vscode.ExtensionContext,
		private placeholderProvider: PlaceholderFileSystemProvider,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(uri?: vscode.Uri): Promise<void> {
		this.debugLog('Create Action command triggered', { uri: uri?.toString() });
		
		try {
			// Check if there's a WebDAV connection
			const realProvider = this.placeholderProvider?.getRealProvider();
			if (!realProvider) {
				this.debugLog('No WebDAV connection found');
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to a WebDAV server first.');
				return;
			}
			
			// Validate that we're in the right location for creating actions
			if (!uri) {
				this.debugLog('No URI provided');
				vscode.window.showWarningMessage('No folder selected.');
				return;
			}
			
			const isPluginsActionsFolder = uri.path.endsWith('/plugins/actions');
			const isActionSubfolder = uri.path.includes('/actions/') && !uri.path.endsWith('/actions');
			
			if (!isPluginsActionsFolder && !isActionSubfolder) {
				this.debugLog('Invalid path for create action', { path: uri.path });
				vscode.window.showWarningMessage('This command can only be used in plugins/actions folders or action subfolders.');
				return;
			}
			
			// Prompt for action name
			const actionName = await vscode.window.showInputBox({
				prompt: 'Enter the action name',
				placeHolder: 'e.g., MyAction',
				validateInput: (value) => {
					if (!value) {
						return 'Action name is required';
					}
					if (!/^[A-Za-z][a-zA-Z0-9_]*$/.test(value)) {
						return 'Action name must start with a letter and contain only letters, numbers, and underscores';
					}
					return null;
				}
			});
			
			if (!actionName) {
				this.debugLog('Action creation cancelled - no name provided');
				return;
			}
			
			// Convert to Pascal case
			const pascalCaseName = this.toPascalCase(actionName);
			
			// Create action directory and file structure
			const actionPath = `${uri.path}/${pascalCaseName}`;
			const actionFilePath = `${actionPath}/${pascalCaseName}.php`;
			
			// Create the directory first
			this.debugLog('Creating action directory', { path: actionPath });
			try {
				await vscode.workspace.fs.createDirectory(vscode.Uri.from({ scheme: 'webdav', path: actionPath }));
			} catch (error: any) {
				this.debugLog('Directory might already exist, continuing', { error: error.message });
			}
			
			// Generate PHP action content using the boilerplate
			const actionContent = this.generateActionContent(pascalCaseName);
			const encoder = new TextEncoder();
			const contentBytes = encoder.encode(actionContent);
			
			// Create the action file
			this.debugLog('Creating action file', { path: actionFilePath });
			await vscode.workspace.fs.writeFile(
				vscode.Uri.from({ scheme: 'webdav', path: actionFilePath }), 
				contentBytes
			);
			
			// Refresh the file explorer to show the new folder and file
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			
			// Also trigger a refresh of the parent directory specifically
			try {
				await vscode.workspace.fs.stat(vscode.Uri.from({ scheme: 'webdav', path: uri.path }));
			} catch (error) {
				// Stat call helps trigger WebDAV filesystem refresh
			}
			
			this.debugLog('File explorer refreshed to show new action');
			
			// Small delay to ensure the refresh completes before opening the file
			await new Promise(resolve => setTimeout(resolve, 500));
			
			// Open the newly created file
			const document = await vscode.workspace.openTextDocument(vscode.Uri.from({ scheme: 'webdav', path: actionFilePath }));
			await vscode.window.showTextDocument(document);
			
			// Show success message
			vscode.window.showInformationMessage(`Action '${pascalCaseName}' created successfully!`);
			this.debugLog('Action created successfully', { actionName: pascalCaseName, path: actionFilePath });
			
		} catch (error: any) {
			this.debugLog('Failed to create action', { error: error.message, stack: error.stack });
			vscode.window.showErrorMessage(`Failed to create action: ${error.message}`);
		}
	}
	
	private generateActionContent(actionName: string): string {
		return `<?php

namespace edoc\\appserver\\app\\actions\\plugins;

use edoc\\appserver\\app\\AbstractAction;

class ${actionName} extends AbstractAction
{
    use \\edoc\\appserver\\app\\actions\\SingleValueAction;
    // use \\edoc\\appserver\\app\\actions\\DatasetAction; // To return datasets use DatasetAction instead of SingleValueAction

    protected function init()
    {
        // $this->addParameter('FirstString', self::ACTION_TYPE_TEXT);

        /* Datasources with select list are added like this:
        $this->addParameter('Datasource', self::ACTION_TYPE_DATASOURCE);*/
    }

    protected function exec(): AbstractAction
    {
        // $firstString = $this->param('FirstString');
        $secondString = $this->param('SecondString');
        return $this->returnSingleValue($firstString.$secondString);
    }
}
`;
	}
	
	private toPascalCase(str: string): string {
		// If string is already in PascalCase or camelCase, just ensure first letter is uppercase
		if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(str)) {
			return str.charAt(0).toUpperCase() + str.slice(1);
		}
		
		// For strings with spaces, underscores, hyphens, etc., convert to PascalCase
		return str
			.replace(/[^a-zA-Z0-9]/g, ' ')
			.split(' ')
			.filter(word => word.length > 0)
			.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join('');
	}
}