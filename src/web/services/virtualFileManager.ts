/**
 * Virtual File Manager
 * 
 * Manages virtual files in the WebDAV file system, including stub files
 * and workspace configuration files
 */

import * as vscode from 'vscode';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';
import { PHPConfigurationManager } from './phpConfigurationManager';
import { createChildLogger, ChildLogger } from '../utils/logger';

export class VirtualFileManager {
	private logger: ChildLogger;

	constructor(
		private context: vscode.ExtensionContext,
		private placeholderProvider: PlaceholderFileSystemProvider,
		private phpConfigManager: PHPConfigurationManager
	) {
		this.logger = createChildLogger('VirtualFileManager');
	}

	/**
	 * Create virtual stub file for PHP autocompletion
	 */
	async createStubFile(): Promise<void> {
		try {
			const realProvider = this.placeholderProvider.getRealProvider();
			if (!realProvider) {
				this.logger.warn('No WebDAV provider available for virtual file creation');
				return;
			}
			
			// Load stub file content
			const stubContent = await this.loadStubContent();
			
			// Create virtual directories and files
			realProvider.createVirtualDirectory('~/.stubs');
			realProvider.createVirtualFile('~/.stubs/plugin-api.stubs.php', stubContent);
			
			this.logger.info('Created virtual PHP stub file in WebDAV filesystem', { size: stubContent.length });
			
			// Configure PHP extensions
			await this.configurePhpExtensions();
			
			// Pre-load the stub file for go-to-definition
			await this.preloadStubFile();
			
		} catch (error: any) {
			this.logger.exception('Failed to create virtual stub file', error);
			throw error;
		}
	}

	/**
	 * Create virtual workspace configuration files
	 */
	async createWorkspaceFiles(allPhpFiles: string[]): Promise<void> {
		try {
			const realProvider = this.placeholderProvider.getRealProvider();
			if (!realProvider) {
				this.logger.warn('No WebDAV provider available for virtual workspace files');
				return;
			}

			// Create .vscode directory
			realProvider.createVirtualDirectory('/.vscode');

			// Create settings.json with PHP configuration
			const settingsContent = await this.createSettingsContent(allPhpFiles);
			const settingsJson = JSON.stringify(settingsContent, null, 2);
			const settingsBytes = new TextEncoder().encode(settingsJson);

			realProvider.createVirtualFile('/.vscode/settings.json', settingsBytes);

			this.logger.info('Created virtual workspace settings file', { 
				settingsSize: settingsJson.length 
			});

		} catch (error: any) {
			this.logger.exception('Failed to create virtual workspace files', error);
			throw error;
		}
	}

	/**
	 * Create test virtual files for debugging
	 */
	async createTestFiles(): Promise<void> {
		try {
			const realProvider = this.placeholderProvider.getRealProvider();
			if (!realProvider) {
				throw new Error('No WebDAV connection found');
			}

			// Create test files
			const testContent = new TextEncoder().encode('This is a test virtual file!\nCreated by WebDAV extension.');
			realProvider.createVirtualFile('/test-virtual-file.txt', testContent);

			// Create test directory with nested file
			realProvider.createVirtualDirectory('/test-dir');
			realProvider.createVirtualFile('/test-dir/nested-file.txt', 
				new TextEncoder().encode('Nested virtual file content'));

			this.logger.info('Virtual test files created', {
				rootFile: '/test-virtual-file.txt',
				directory: '/test-dir',
				nestedFile: '/test-dir/nested-file.txt',
				virtualFileCount: realProvider.getVirtualFileCount()
			});

			// Refresh file explorer
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');

		} catch (error: any) {
			this.logger.exception('Failed to create test virtual files', error);
			throw error;
		}
	}

	/**
	 * Load stub file content from extension resources
	 */
	private async loadStubContent(): Promise<Uint8Array> {
		const stubUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'web', 'resources', 'plugin-api.stubs.php');
		return await vscode.workspace.fs.readFile(stubUri);
	}

	/**
	 * Configure PHP extensions to use the stub file
	 */
	private async configurePhpExtensions(): Promise<void> {
		const relativeStubPath = '.stubs/plugin-api.stubs.php';
		
		// Configure PHP stubs
		await this.phpConfigManager.configurePhpStubs(relativeStubPath);
		
		// Configure Intelephense
		await this.phpConfigManager.configureIntelephense([]);
	}

	/**
	 * Pre-load the stub file for go-to-definition support
	 */
	private async preloadStubFile(): Promise<void> {
		// Wait for file system to be ready
		setTimeout(async () => {
			try {
				// Check if WebDAV workspace exists
				const workspaceFolders = vscode.workspace.workspaceFolders || [];
				const hasWebdavWorkspace = workspaceFolders.some(folder => folder.uri.scheme === 'webdav');
				
				if (!hasWebdavWorkspace) {
					this.logger.debug('No WebDAV workspace found, skipping stub file pre-load');
					return;
				}
				
				const stubUri = vscode.Uri.parse('webdav:/.stubs/plugin-api.stubs.php');
				const realProvider = this.placeholderProvider.getRealProvider();
				
				if (realProvider && realProvider.hasVirtualFile('~/.stubs/plugin-api.stubs.php')) {
					// Open the document invisibly to register it with VS Code
					const document = await vscode.workspace.openTextDocument(stubUri);
					
					this.logger.debug('Pre-loaded stub file for go-to-definition support', { 
						uri: stubUri.toString(),
						documentLength: document.getText().length
					});
					
					// Close the document again
					await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
				}
			} catch (error: any) {
				this.logger.warn('Failed to pre-load stub file', { error: error.message });
			}
		}, 3000);
	}

	/**
	 * Create settings.json content with PHP configuration
	 */
	private async createSettingsContent(allPhpFiles: string[]): Promise<any> {
		const phpDirectories = this.extractPhpDirectories(allPhpFiles);
		phpDirectories.add('.stubs');

		return {
			"php.stubs": [
				"*",
				".stubs/plugin-api.stubs.php"
			],
			"php.workspace.includePath": Array.from(phpDirectories).join(';'),
			"intelephense.environment.includePaths": Array.from(phpDirectories)
		};
	}

	/**
	 * Extract unique directories from PHP file paths
	 */
	private extractPhpDirectories(allPhpFiles: string[]): Set<string> {
		const phpDirectories = new Set<string>();
		
		allPhpFiles.forEach(file => {
			const dir = file.substring(0, file.lastIndexOf('/'));
			if (dir && dir !== '.' && dir !== '') {
				phpDirectories.add(dir.startsWith('/') ? dir.substring(1) : dir);
			}
		});
		
		return phpDirectories;
	}
}