import * as vscode from 'vscode';
import { Command } from './commandManager';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';
import { WebDAVFileIndex } from '../core/fileIndex';
import { PHPConfigurationManager } from '../services/phpConfigurationManager';

export class SetupPhpStubsCommand implements Command {
	constructor(
		private context: vscode.ExtensionContext,
		private placeholderProvider: PlaceholderFileSystemProvider,
		private fileIndex: WebDAVFileIndex,
		private phpConfigManager: PHPConfigurationManager,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Setup PHP stubs command triggered');
		
		try {
			// Check if there's a WebDAV connection
			const realProvider = this.placeholderProvider?.getRealProvider();
			if (!realProvider) {
				this.debugLog('No WebDAV connection found');
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to a WebDAV server first.');
				return;
			}
			
			this.debugLog('Using WebDAV filesystem provider for virtual files');
			
			// Create virtual directories
			this.debugLog('Creating virtual directories');
			realProvider.createVirtualDirectory('~/.stubs');
			realProvider.createVirtualDirectory('/.vscode');
			this.debugLog('Virtual directories created');
			
			// Read the stub file from extension resources
			const stubUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'web', 'resources', 'automate.meta.php');
			this.debugLog('Reading source stub file', { sourcePath: stubUri.fsPath });
			const stubContent = await vscode.workspace.fs.readFile(stubUri);
			this.debugLog('Source stub file read successfully', { contentSize: stubContent.length });
			
			// Create virtual stub file
			realProvider.createVirtualFile('~/.stubs/automate.meta.php', stubContent);
			this.debugLog('Virtual stub file created');
			
			// Get all PHP files from the file index to include in settings
			const allPhpFiles = this.fileIndex ? this.fileIndex.getAllFiles().filter(file => 
				file.endsWith('.php') || file.endsWith('.phtml') || file.endsWith('.inc')
			) : [];
			
			// Create unique directories containing PHP files
			const phpDirectories = new Set<string>();
			allPhpFiles.forEach(file => {
				const dir = file.substring(0, file.lastIndexOf('/'));
				if (dir && dir !== '.' && dir !== '') {
					phpDirectories.add(dir.startsWith('/') ? dir.substring(1) : dir);
				}
			});
			
			// Add stubs directory
			phpDirectories.add('.stubs');
			
			// Prepare settings content with all PHP directories
			const settingsContent = {
				"php.stubs": [
					"*",
					".stubs/automate.meta.php"
				],
				"php.workspace.includePath": Array.from(phpDirectories).join(';'),
				"intelephense.environment.includePaths": Array.from(phpDirectories)
			};
			this.debugLog('Prepared settings content', { settingsContent });
			
			// Check if virtual settings.json already exists
			let existingSettings: any = {};
			const existingVirtualFile = realProvider.getVirtualFile('/.vscode/settings.json');
			if (existingVirtualFile) {
				try {
					const decoder = new TextDecoder();
					const existingText = decoder.decode(existingVirtualFile.content);
					existingSettings = JSON.parse(existingText);
					this.debugLog('Successfully read existing virtual settings.json', { 
						existingKeys: Object.keys(existingSettings),
						existingSize: existingText.length
					});
				} catch (error: any) {
					this.debugLog('Failed to parse existing virtual settings.json', { error: error.message });
				}
			} else {
				this.debugLog('No existing virtual settings.json found');
			}
			
			// Merge with existing settings
			const mergedSettings = {
				...existingSettings,
				...settingsContent
			};
			this.debugLog('Merged settings prepared', { 
				totalKeys: Object.keys(mergedSettings).length,
				phpStubsCount: mergedSettings['php.stubs']?.length || 0
			});
			
			// Create virtual settings.json file
			const settingsJson = JSON.stringify(mergedSettings, null, 2);
			const encoder = new TextEncoder();
			const settingsContentBytes = encoder.encode(settingsJson);
			
			this.debugLog('Creating virtual settings.json', { 
				settingsSize: settingsJson.length 
			});
			
			realProvider.createVirtualFile('/.vscode/settings.json', settingsContentBytes);
			this.debugLog('Virtual settings.json created');
			
			// Update VS Code configuration programmatically
			const phpConfig = vscode.workspace.getConfiguration('php');
			const currentStubs = phpConfig.get('stubs', []) as string[];
			const newStubs = [...new Set([...currentStubs, '*', '.stubs/automate.meta.php'])];
			
			await phpConfig.update('stubs', newStubs, vscode.ConfigurationTarget.Workspace);
			this.debugLog('Updated VS Code php.stubs configuration', { newStubs });
			
			// Configure PHP Tools workspace.includePath for all PHP files
			try {
				// Get all PHP files from the file index
				if (this.fileIndex) {
					setTimeout(async () => {
						const allPhpFiles = this.fileIndex.getAllFiles().filter(file => 
							file.endsWith('.php') || file.endsWith('.phtml') || file.endsWith('.inc')
						);
						
						await this.phpConfigManager.updateWorkspaceIncludePath(allPhpFiles);
						
						this.debugLog('Updated PHP Tools workspace.includePath in setupPhpStubsCommand', { 
							totalPhpFiles: allPhpFiles.length
						});
					}, 1000); // Wait for file index to be populated
				}
			} catch (error: any) {
				this.debugLog('Failed to configure PHP Tools workspace.includePath in setupPhpStubsCommand', { error: error.message });
			}
			
			// Refresh the file explorer to show the new virtual files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			this.debugLog('File explorer refreshed to show virtual files');
			
			// Show success message
			vscode.window.showInformationMessage('PHP stub configuration setup complete! Virtual files created in WebDAV workspace.');
			this.debugLog('PHP stub configuration setup complete', { 
				virtualStubPath: '~/.stubs/automate.meta.php',
				virtualSettingsPath: '/.vscode/settings.json',
				stubSize: stubContent.length,
				settingsSize: settingsJson.length
			});
			
		} catch (error: any) {
			this.debugLog('Failed to setup PHP stubs configuration', { 
				error: error.message,
				stack: error.stack,
				name: error.name
			});
			vscode.window.showErrorMessage(`Failed to setup PHP stubs: ${error.message}`);
		}
	}
}