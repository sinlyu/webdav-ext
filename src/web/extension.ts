import * as vscode from 'vscode';
import { WebDAVFileSearchProvider } from './providers/fileSearchProvider';
import { WebDAVTextSearchProvider } from './providers/textSearchProvider';
import { WebDAVWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { WebDAVDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { WebDAVCustomSearchProvider } from './providers/customSearchProvider';
import { PHPDefinitionProvider } from './providers/phpDefinitionProvider';
import { PHPDefinitionProviderAST } from './providers/phpDefinitionProviderAST';
import { IPHPDefinitionProvider } from './providers/phpDefinitionProviderInterface';
import { WebDAVFileIndex } from './core/fileIndex';
import { WebDAVViewProvider } from './ui/webdavViewProvider';
import { PlaceholderFileSystemProvider } from './providers/fileSystemProvider';
import { createDebugLogger } from './utils/logging';



// Extension global variables
let debugOutput: vscode.OutputChannel;
let globalPlaceholderProvider: PlaceholderFileSystemProvider;
let globalContext: vscode.ExtensionContext;
let globalFileSearchProvider: WebDAVFileSearchProvider;
let globalTextSearchProvider: WebDAVTextSearchProvider;
let globalWorkspaceSymbolProvider: WebDAVWorkspaceSymbolProvider;
let globalDocumentSymbolProvider: WebDAVDocumentSymbolProvider;
let globalCustomSearchProvider: WebDAVCustomSearchProvider;
let globalPhpDefinitionProvider: IPHPDefinitionProvider;
let globalFileIndex: WebDAVFileIndex;
let globalStubFileCreator: (() => Promise<void>) | null = null;
let debugLog: (message: string, data?: any) => void;

// Function to update PHP Tools workspace.includePath with all PHP directories
async function updatePhpWorkspaceIncludePath() {
	try {
		if (!globalFileIndex) {
			debugLog('No file index available for PHP includePath update');
			return;
		}
		
		const allPhpFiles = globalFileIndex.getAllFiles().filter(file => 
			file.endsWith('.php') || file.endsWith('.phtml') || file.endsWith('.inc')
		);
		
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
		
		// Get current workspace.includePath - handle both array and string formats
		const phpConfig = vscode.workspace.getConfiguration('php');
		let currentIncludePaths: string[] = [];
		const currentConfig = phpConfig.get('workspace.includePath', [] as any);
		if (Array.isArray(currentConfig)) {
			currentIncludePaths = currentConfig;
		} else if (typeof currentConfig === 'string') {
			currentIncludePaths = currentConfig.split(';').filter((p: string) => p.trim());
		}
		
		// Merge with existing paths
		const newIncludePaths = new Set([...currentIncludePaths]);
		phpDirectories.forEach(dir => newIncludePaths.add(dir));
		
		// Convert to semicolon-separated string as required by PHP Tools
		const finalIncludePaths = Array.from(newIncludePaths).filter(p => p.trim()).join(';');
		
		await phpConfig.update('workspace.includePath', finalIncludePaths, vscode.ConfigurationTarget.Workspace);
		
		debugLog('Updated PHP Tools workspace.includePath', { 
			includePath: finalIncludePaths,
			phpDirectoryCount: phpDirectories.size,
			totalPhpFiles: allPhpFiles.length,
			allDirectories: Array.from(phpDirectories)
		});
	} catch (error: any) {
		debugLog('Failed to update PHP Tools workspace.includePath', { error: error.message });
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Store context globally for persistence
	globalContext = context;
	
	// Create debug output channel and logger
	debugOutput = vscode.window.createOutputChannel('WebDAV Debug');
	debugLog = createDebugLogger(debugOutput);
	context.subscriptions.push(debugOutput);
	
	const timestamp = new Date().toISOString();
	debugOutput.appendLine(`===============================================`);
	debugOutput.appendLine(`[${timestamp}] WebDAV extension ACTIVATED`);
	debugOutput.appendLine(`Extension path: ${context.extensionPath}`);
	debugOutput.appendLine(`Extension mode: ${context.extensionMode}`);
	debugOutput.appendLine(`===============================================`);
	console.log('WebDAV extension activated at', timestamp);

	// Register a placeholder filesystem provider immediately
	globalPlaceholderProvider = new PlaceholderFileSystemProvider(debugLog);
	const providerRegistration = vscode.workspace.registerFileSystemProvider('webdav', globalPlaceholderProvider, { 
		isCaseSensitive: false,
		isReadonly: false
	});
	context.subscriptions.push(providerRegistration);
	debugLog('Global placeholder provider registered', {
		scheme: 'webdav',
		isCaseSensitive: false,
		isReadonly: false
	});


	// Initialize search providers (both proposed and stable APIs)
	globalFileSearchProvider = new WebDAVFileSearchProvider();
	globalTextSearchProvider = new WebDAVTextSearchProvider();
	globalWorkspaceSymbolProvider = new WebDAVWorkspaceSymbolProvider();
	globalDocumentSymbolProvider = new WebDAVDocumentSymbolProvider();
	globalCustomSearchProvider = new WebDAVCustomSearchProvider();
	
	// Choose PHP definition provider (AST-based is more accurate)
	const useASTParser = vscode.workspace.getConfiguration('webdav').get('useASTParser', false);
	if (useASTParser) {
		globalPhpDefinitionProvider = new PHPDefinitionProviderAST();
		debugLog('Using AST-based PHP definition provider');
	} else {
		globalPhpDefinitionProvider = new PHPDefinitionProvider();
		debugLog('Using regex-based PHP definition provider');
	}
	
	globalFileIndex = new WebDAVFileIndex();
	
	// Set debug loggers for all providers and index
	globalFileSearchProvider.setDebugLogger(debugLog);
	globalTextSearchProvider.setDebugLogger(debugLog);
	globalWorkspaceSymbolProvider.setDebugLogger(debugLog);
	globalDocumentSymbolProvider.setDebugLogger(debugLog);
	globalCustomSearchProvider.setDebugLogger(debugLog);
	globalPhpDefinitionProvider.setDebugLogger(debugLog);
	globalFileIndex.setDebugLogger(debugLog);
	
	// Set callback to update PHP workspace.includePath when index is updated
	globalFileIndex.setOnIndexUpdatedCallback(updatePhpWorkspaceIncludePath);
	
	// Set file index for all providers
	globalFileSearchProvider.setFileIndex(globalFileIndex);
	globalTextSearchProvider.setFileIndex(globalFileIndex);
	globalWorkspaceSymbolProvider.setFileIndex(globalFileIndex);
	globalCustomSearchProvider.setFileIndex(globalFileIndex);
	globalPhpDefinitionProvider.setFileIndex(globalFileIndex);
	
	// Register stable API providers (always available)
	try {
		// Register WorkspaceSymbolProvider for Ctrl+T symbol search
		context.subscriptions.push(
			vscode.languages.registerWorkspaceSymbolProvider(globalWorkspaceSymbolProvider)
		);
		debugLog('Workspace symbol provider registered');

		// Register DocumentSymbolProvider for outline view and Ctrl+Shift+O
		context.subscriptions.push(
			vscode.languages.registerDocumentSymbolProvider(
				{ scheme: 'webdav' }, 
				globalDocumentSymbolProvider
			)
		);
		debugLog('Document symbol provider registered');
	} catch (error: any) {
		debugLog('Failed to register stable symbol providers', { error: error.message });
	}

	// DISABLED: Proposed API providers (require development mode)
	// These are kept for future use when APIs are stabilized
	/*
	try {
		// Try to register search providers using experimental API
		if ((vscode.workspace as any).registerFileSearchProvider) {
			context.subscriptions.push(
				(vscode.workspace as any).registerFileSearchProvider('webdav', globalFileSearchProvider)
			);
			debugLog('File search provider registered');
		}
		
		if ((vscode.workspace as any).registerTextSearchProvider) {
			context.subscriptions.push(
				(vscode.workspace as any).registerTextSearchProvider('webdav', globalTextSearchProvider)
			);
			debugLog('Text search provider registered');
		}
	} catch (error: any) {
		debugLog('Failed to register search providers', { error: error.message });
	}
	*/

	// Register PHP definition provider
	try {
		context.subscriptions.push(
			vscode.languages.registerDefinitionProvider(
				{ scheme: 'webdav', language: 'php' },
				globalPhpDefinitionProvider
			)
		);
		debugLog('PHP definition provider registered');
	} catch (error: any) {
		debugLog('Failed to register PHP definition provider', { error: error.message });
	}

	// Register stub file for PHP autocompletion
	const config = vscode.workspace.getConfiguration('webdav');
	const includeStubs = config.get('includeStubs', true);
	
	if (includeStubs) {
		try {
			// Create virtual stub file creation function  
			const createVirtualStubFile = async () => {
				try {
					// Get the real WebDAV provider
					const realProvider = globalPlaceholderProvider?.getRealProvider();
					if (!realProvider) {
						debugLog('No WebDAV provider available for virtual file creation');
						return;
					}
					
					const sourceStubUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'web', 'resources', 'plugin-api.stubs.php');
					const stubContent = await vscode.workspace.fs.readFile(sourceStubUri);
					
					// Create virtual directories with ~ prefix
					realProvider.createVirtualDirectory('~/.stubs');
					
					// Create virtual stub file with ~ prefix to match expected path format
					realProvider.createVirtualFile('~/.stubs/plugin-api.stubs.php', stubContent);
					debugLog('Created virtual PHP stub file in WebDAV filesystem', { size: stubContent.length });
					
					// Force refresh to ensure the file is visible
					await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
					
					// Pre-load the stub file to enable "go to definition" without manual opening
					// Wait for file system to be fully ready and workspace to be loaded
					setTimeout(async () => {
						try {
							// Check if WebDAV workspace exists
							const workspaceFolders = vscode.workspace.workspaceFolders || [];
							const hasWebdavWorkspace = workspaceFolders.some(folder => folder.uri.scheme === 'webdav');
							
							if (!hasWebdavWorkspace) {
								debugLog('No WebDAV workspace found, skipping stub file pre-load');
								return;
							}
							
							const stubUri = vscode.Uri.parse('webdav:/.stubs/plugin-api.stubs.php');
							
							// First verify the file exists through our file system provider
							const realProvider = globalPlaceholderProvider?.getRealProvider();
							if (realProvider && realProvider.hasVirtualFile('~/.stubs/plugin-api.stubs.php')) {
								// Try to open the document invisibly to register it with VS Code
								const document = await vscode.workspace.openTextDocument(stubUri);
								debugLog('Pre-loaded stub file for go-to-definition support', { 
									uri: stubUri.toString(),
									documentLength: document.getText().length
								});
								
								// Close the document again since we just wanted to register it
								await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
							} else {
								debugLog('Virtual stub file not found in provider');
							}
						} catch (error: any) {
							debugLog('Failed to pre-load stub file', { 
								error: error.message,
								errorName: error.name,
								stack: error.stack 
							});
						}
					}, 3000); // Wait 3 seconds to ensure everything is ready
					
					// Add stub file to php.stubs configuration using relative path only
					// Avoid webdav:// URIs in PHP configuration to prevent path resolution issues
					const phpConfig = vscode.workspace.getConfiguration('php');
					const phpStubs = phpConfig.get('stubs', []) as string[];
					const relativeStubPath = '.stubs/plugin-api.stubs.php';
					
					// Ensure "*" is included (DEVSENSE shortcut for all default stubs)
					if (!phpStubs.includes('*')) {
						phpStubs.unshift('*');
					}
					
					// Only use relative path to avoid URI resolution issues
					if (!phpStubs.includes(relativeStubPath)) {
						phpStubs.push(relativeStubPath);
						phpConfig.update('stubs', phpStubs, vscode.ConfigurationTarget.Workspace).then(() => {
							debugLog('Added virtual PHP stub file to php.stubs configuration', { 
								relativePath: relativeStubPath,
								allStubs: phpStubs
							});
						}, (error: any) => {
							debugLog('Failed to update php.stubs configuration', { error: error.message });
						});
					}
					
					// Also try to configure Intelephense if available
					const intelephenseConfig = vscode.workspace.getConfiguration('intelephense');
					if (intelephenseConfig) {
						// Add the virtual WebDAV data/persistent path to environment.includePaths
						// Use relative path only to avoid URI resolution issues
						const includePaths = intelephenseConfig.get('environment.includePaths', []) as string[];
						const relativeDataPath = '.stubs';
						
						if (!includePaths.includes(relativeDataPath)) {
							includePaths.push(relativeDataPath);
							intelephenseConfig.update('environment.includePaths', includePaths, vscode.ConfigurationTarget.Workspace).then(() => {
								debugLog('Added virtual WebDAV .stubs path to Intelephense include paths', { includePaths });
							}, (error: any) => {
								debugLog('Failed to update Intelephense include paths', { error: error.message });
							});
						}
					}
					
					// Configure PHP Tools (DEVSENSE) workspace.includePath
					try {
						const phpToolsConfig = vscode.workspace.getConfiguration('php');
						
						// Get all PHP files from the file index to add to workspace.includePath
						if (globalFileIndex) {
							setTimeout(async () => {
								const allPhpFiles = globalFileIndex.getAllFiles().filter(file => 
									file.endsWith('.php') || file.endsWith('.phtml') || file.endsWith('.inc')
								);
								
								// Get current workspace.includePath
								const currentIncludePaths = phpToolsConfig.get('workspace.includePath', []) as string[];
								
								// Add all PHP files and the stubs directory to includePath
								const newIncludePaths = new Set([...currentIncludePaths]);
								
								// Add stubs directory
								newIncludePaths.add('.stubs');
								
								// Add each PHP file path (use directory paths, not individual files for performance)
								const phpDirectories = new Set<string>();
								allPhpFiles.forEach(file => {
									const dir = file.substring(0, file.lastIndexOf('/'));
									if (dir && dir !== '.') {
										phpDirectories.add(dir);
									}
								});
								
								// Add unique directories containing PHP files
								phpDirectories.forEach(dir => newIncludePaths.add(dir));
								
								const finalIncludePaths = Array.from(newIncludePaths).join(';');
								
								await phpToolsConfig.update('workspace.includePath', finalIncludePaths, vscode.ConfigurationTarget.Workspace);
								
								debugLog('Updated PHP Tools workspace.includePath', { 
									includePath: finalIncludePaths,
									phpDirectoryCount: phpDirectories.size,
									totalPhpFiles: allPhpFiles.length
								});
							}, 2000); // Wait for file index to be populated
						}
					} catch (error: any) {
						debugLog('Failed to configure PHP Tools workspace.includePath', { error: error.message });
					}
					
					debugLog('Virtual PHP stub file registered for autocompletion', { 
						relativePath: relativeStubPath
					});
				} catch (error: any) {
					debugLog('Failed to create virtual stub file', { error: error.message });
					// Continue without the stub file
				}
			};
			
			// Store the stub file creator for later use
			globalStubFileCreator = createVirtualStubFile;
		} catch (error: any) {
			debugLog('Failed to register PHP stub file', { error: error.message });
		}
	}


	// Create WebView provider with proper dependencies
	const viewProvider = new WebDAVViewProvider(
		context.extensionUri,
		debugLog,
		globalPlaceholderProvider,
		globalFileSearchProvider,
		globalTextSearchProvider,
		globalPhpDefinitionProvider,
		globalFileIndex,
		globalContext,
		globalStubFileCreator,
		debugOutput
	);
	
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(WebDAVViewProvider.viewType, viewProvider)
	);
	debugLog('WebView provider registered');
	
	// Try to auto-reconnect AFTER providers are registered
	setTimeout(async () => {
		debugLog('Attempting auto-reconnect after initialization');
		await viewProvider.autoReconnect();
	}, 200);

	// Add workspace change handler to maintain connection
	const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		debugLog('Workspace folders changed', { 
			added: event.added.length, 
			removed: event.removed.length 
		});
		
		// Auto-reconnect to maintain connection state after workspace changes
		setTimeout(async () => {
			debugLog('Auto-reconnecting after workspace change');
			await viewProvider.autoReconnect();
		}, 500);
	});
	context.subscriptions.push(workspaceWatcher);

	// Hook into document opening to handle go-to-definition requests
	const documentOpenHandler = vscode.workspace.onDidOpenTextDocument((document) => {
		const uri = document.uri;
		debugLog('Document opened', { 
			uri: uri.toString(),
			scheme: uri.scheme,
			path: uri.path,
			fsPath: uri.fsPath
		});

		// Check if this is a malformed webdav URI that needs correction
		if (uri.toString().startsWith('/webdav:')) {
			debugLog('Detected malformed webdav URI in document opening', {
				original: uri.toString(),
				path: uri.path,
				scheme: uri.scheme
			});
			
			// The URI correction will be handled by the file system provider
			// but we can log this for debugging purposes
		}

		// Check if this is a webdav document that was successfully opened
		if (uri.scheme === 'webdav') {
			debugLog('WebDAV document opened successfully', {
				uri: uri.toString(),
				path: uri.path,
				languageId: document.languageId,
				lineCount: document.lineCount
			});

			// If this is a stub file being opened by go-to-definition, ensure it's properly loaded
			if (uri.path.includes('.stubs/')) {
				debugLog('Stub file opened via go-to-definition', {
					uri: uri.toString(),
					path: uri.path
				});
				
				// This indicates that go-to-definition is working for stub files
				vscode.window.showInformationMessage('WebDAV stub file opened successfully!', 'Dismiss');
			}
		}
	});
	context.subscriptions.push(documentOpenHandler);

	// Hook into text document will save to handle file modifications
	const documentWillSaveHandler = vscode.workspace.onWillSaveTextDocument((event) => {
		if (event.document.uri.scheme === 'webdav') {
			debugLog('WebDAV document will save', {
				uri: event.document.uri.toString(),
				reason: event.reason
			});
		}
	});
	context.subscriptions.push(documentWillSaveHandler);

	const showDebugCommand = vscode.commands.registerCommand('automate-webdav.showDebug', () => {
		debugOutput.show();
	});

	const refreshWorkspaceCommand = vscode.commands.registerCommand('automate-webdav.refreshWorkspace', async () => {
		debugLog('Refresh workspace command triggered');
		
		// Refresh the file index
		const realProvider = globalPlaceholderProvider?.getRealProvider();
		if (realProvider && realProvider.getFileIndex()) {
			await realProvider.getFileIndex()?.quickIndex();
		}
		
		await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
		vscode.window.showInformationMessage('WebDAV workspace refreshed and indexed');
	});

	const addStubFileCommand = vscode.commands.registerCommand('automate-webdav.addStubFile', async () => {
		debugLog('Add stub file command triggered');
		
		try {
			// Check if there's a WebDAV connection
			const realProvider = globalPlaceholderProvider?.getRealProvider();
			if (!realProvider) {
				debugLog('No WebDAV connection found');
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to a WebDAV server first.');
				return;
			}
			
			const stubUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'web', 'resources', 'plugin-api.stubs.php');
			
			// Create virtual directories
			debugLog('Creating virtual directories for stub file');
			realProvider.createVirtualDirectory('~/.stubs');
			
			// Read the stub file content
			const stubContent = await vscode.workspace.fs.readFile(stubUri);
			debugLog('Read source stub file', { size: stubContent.length });
			
			// Create virtual stub file
			realProvider.createVirtualFile('~/.stubs/plugin-api.stubs.php', stubContent);
			
			// Refresh the file explorer to show the new virtual files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			debugLog('File explorer refreshed to show virtual files');
			
			// Show success message
			vscode.window.showInformationMessage('PHP Plugin API stub file added as virtual file in WebDAV workspace for autocompletion!');
			debugLog('Virtual stub file created in WebDAV filesystem', { virtualPath: '~/.stubs/plugin-api.stubs.php' });
			
		} catch (error: any) {
			debugLog('Failed to add virtual stub file', { error: error.message });
			vscode.window.showErrorMessage(`Failed to add stub file: ${error.message}`);
		}
	});

	const setupPhpStubsCommand = vscode.commands.registerCommand('automate-webdav.setupPhpStubs', async () => {
		debugLog('Setup PHP stubs command triggered');
		
		try {
			// Check if there's a WebDAV connection
			const realProvider = globalPlaceholderProvider?.getRealProvider();
			if (!realProvider) {
				debugLog('No WebDAV connection found');
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to a WebDAV server first.');
				return;
			}
			
			debugLog('Using WebDAV filesystem provider for virtual files');
			
			// Create virtual directories
			debugLog('Creating virtual directories');
			realProvider.createVirtualDirectory('~/.stubs');
			realProvider.createVirtualDirectory('/.vscode');
			debugLog('Virtual directories created');
			
			// Read the stub file from extension resources
			const stubUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'web', 'resources', 'plugin-api.stubs.php');
			debugLog('Reading source stub file', { sourcePath: stubUri.fsPath });
			const stubContent = await vscode.workspace.fs.readFile(stubUri);
			debugLog('Source stub file read successfully', { contentSize: stubContent.length });
			
			// Create virtual stub file
			realProvider.createVirtualFile('~/.stubs/plugin-api.stubs.php', stubContent);
			debugLog('Virtual stub file created');
			
			// Get all PHP files from the file index to include in settings
			const allPhpFiles = globalFileIndex ? globalFileIndex.getAllFiles().filter(file => 
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
					".stubs/plugin-api.stubs.php"
				],
				"php.workspace.includePath": Array.from(phpDirectories).join(';'),
				"intelephense.environment.includePaths": Array.from(phpDirectories)
			};
			debugLog('Prepared settings content', { settingsContent });
			
			// Check if virtual settings.json already exists
			let existingSettings: any = {};
			const existingVirtualFile = realProvider.getVirtualFile('/.vscode/settings.json');
			if (existingVirtualFile) {
				try {
					const decoder = new TextDecoder();
					const existingText = decoder.decode(existingVirtualFile.content);
					existingSettings = JSON.parse(existingText);
					debugLog('Successfully read existing virtual settings.json', { 
						existingKeys: Object.keys(existingSettings),
						existingSize: existingText.length
					});
				} catch (error: any) {
					debugLog('Failed to parse existing virtual settings.json', { error: error.message });
				}
			} else {
				debugLog('No existing virtual settings.json found');
			}
			
			// Merge with existing settings
			const mergedSettings = {
				...existingSettings,
				...settingsContent
			};
			debugLog('Merged settings prepared', { 
				totalKeys: Object.keys(mergedSettings).length,
				phpStubsCount: mergedSettings['php.stubs']?.length || 0
			});
			
			// Create virtual settings.json file
			const settingsJson = JSON.stringify(mergedSettings, null, 2);
			const encoder = new TextEncoder();
			const settingsContentBytes = encoder.encode(settingsJson);
			
			debugLog('Creating virtual settings.json', { 
				settingsSize: settingsJson.length 
			});
			
			realProvider.createVirtualFile('/.vscode/settings.json', settingsContentBytes);
			debugLog('Virtual settings.json created');
			
			// Update VS Code configuration programmatically
			const phpConfig = vscode.workspace.getConfiguration('php');
			const currentStubs = phpConfig.get('stubs', []) as string[];
			const newStubs = [...new Set([...currentStubs, '*', '.stubs/plugin-api.stubs.php'])];
			
			await phpConfig.update('stubs', newStubs, vscode.ConfigurationTarget.Workspace);
			debugLog('Updated VS Code php.stubs configuration', { newStubs });
			
			// Configure PHP Tools workspace.includePath for all PHP files
			try {
				// Get all PHP files from the file index
				if (globalFileIndex) {
					setTimeout(async () => {
						const allPhpFiles = globalFileIndex.getAllFiles().filter(file => 
							file.endsWith('.php') || file.endsWith('.phtml') || file.endsWith('.inc')
						);
						
						// Get current workspace.includePath - handle both array and string formats
						let currentIncludePaths: string[] = [];
						const currentConfig = phpConfig.get('workspace.includePath', [] as any);
						if (Array.isArray(currentConfig)) {
							currentIncludePaths = currentConfig;
						} else if (typeof currentConfig === 'string') {
							currentIncludePaths = currentConfig.split(';').filter((p: string) => p.trim());
						}
						
						// Add all PHP files and the stubs directory to includePath
						const newIncludePaths = new Set([...currentIncludePaths]);
						
						// Add stubs directory
						newIncludePaths.add('.stubs');
						
						// Add each PHP file path (use directory paths, not individual files for performance)
						const phpDirectories = new Set<string>();
						allPhpFiles.forEach(file => {
							const dir = file.substring(0, file.lastIndexOf('/'));
							if (dir && dir !== '.' && dir !== '') {
								phpDirectories.add(dir.startsWith('/') ? dir.substring(1) : dir);
							}
						});
						
						// Add unique directories containing PHP files
						phpDirectories.forEach(dir => newIncludePaths.add(dir));
						
						// Convert to semicolon-separated string as required by PHP Tools
						const finalIncludePaths = Array.from(newIncludePaths).filter(p => p.trim()).join(';');
						
						await phpConfig.update('workspace.includePath', finalIncludePaths, vscode.ConfigurationTarget.Workspace);
						
						debugLog('Updated PHP Tools workspace.includePath in setupPhpStubsCommand', { 
							includePath: finalIncludePaths,
							phpDirectoryCount: phpDirectories.size,
							totalPhpFiles: allPhpFiles.length
						});
					}, 1000); // Wait for file index to be populated
				}
			} catch (error: any) {
				debugLog('Failed to configure PHP Tools workspace.includePath in setupPhpStubsCommand', { error: error.message });
			}
			
			// Refresh the file explorer to show the new virtual files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			debugLog('File explorer refreshed to show virtual files');
			
			// Show success message
			vscode.window.showInformationMessage('PHP stub configuration setup complete! Virtual files created in WebDAV workspace.');
			debugLog('PHP stub configuration setup complete', { 
				virtualStubPath: '~/.stubs/plugin-api.stubs.php',
				virtualSettingsPath: '/.vscode/settings.json',
				stubSize: stubContent.length,
				settingsSize: settingsJson.length
			});
			
		} catch (error: any) {
			debugLog('Failed to setup PHP stubs configuration', { 
				error: error.message,
				stack: error.stack,
				name: error.name
			});
			vscode.window.showErrorMessage(`Failed to setup PHP stubs: ${error.message}`);
		}
	});

	const testVirtualFileCommand = vscode.commands.registerCommand('automate-webdav.testVirtualFile', async () => {
		debugLog('Test virtual file command triggered');
		
		try {
			// Check if there's a WebDAV connection
			const realProvider = globalPlaceholderProvider?.getRealProvider();
			if (!realProvider) {
				debugLog('No WebDAV connection found');
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to a WebDAV server first.');
				return;
			}
			
			debugLog('Creating test virtual file');
			
			// Create a simple test file in the root
			const testContent = new TextEncoder().encode('This is a test virtual file!\nCreated by WebDAV extension.');
			realProvider.createVirtualFile('/test-virtual-file.txt', testContent);
			
			// Create a test directory with a file
			realProvider.createVirtualDirectory('/test-dir');
			realProvider.createVirtualFile('/test-dir/nested-file.txt', new TextEncoder().encode('Nested virtual file content'));
			
			debugLog('Virtual files created', {
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
				debugLog('Adding WebDAV workspace to VS Code');
				try {
					// Try to add the WebDAV root as a workspace folder
					const added = vscode.workspace.updateWorkspaceFolders(
						workspaceFolders.length, 
						0, 
						{ uri: webdavUri, name: 'WebDAV' }
					);
					if (added) {
						debugLog('Successfully added WebDAV workspace folder');
					} else {
						debugLog('Failed to add WebDAV workspace folder');
					}
				} catch (error: any) {
					debugLog('Error adding WebDAV workspace folder', { error: error.message });
				}
			} else {
				debugLog('WebDAV workspace already exists');
			}
			
			// Refresh the file explorer to show the new virtual files
			await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
			debugLog('File explorer refreshed to show virtual files');
			
			vscode.window.showInformationMessage('Test virtual files created! Check the file explorer.');
			
		} catch (error: any) {
			debugLog('Failed to create test virtual files', { error: error.message });
			vscode.window.showErrorMessage(`Failed to create test virtual files: ${error.message}`);
		}
	});

	const testGoToDefinitionCommand = vscode.commands.registerCommand('automate-webdav.testGoToDefinition', async () => {
		debugLog('Test go-to-definition command triggered');
		
		try {
			// Test opening the stub file directly
			const stubUri = vscode.Uri.parse('webdav:/.stubs/plugin-api.stubs.php');
			debugLog('Testing direct opening of stub file', { uri: stubUri.toString() });
			
			// Check if WebDAV provider is available
			const realProvider = globalPlaceholderProvider?.getRealProvider();
			if (!realProvider) {
				vscode.window.showWarningMessage('No WebDAV connection found. Please connect to WebDAV first.');
				return;
			}
			
			// Check if stub file exists
			if (!realProvider.hasVirtualFile('~/.stubs/plugin-api.stubs.php')) {
				vscode.window.showWarningMessage('Stub file not found. Creating it now...');
				if (globalStubFileCreator) {
					await globalStubFileCreator();
					vscode.window.showInformationMessage('Stub file created. Try again.');
				}
				return;
			}
			
			// Try to open the document
			const document = await vscode.workspace.openTextDocument(stubUri);
			await vscode.window.showTextDocument(document);
			
			vscode.window.showInformationMessage('Stub file opened successfully! Go-to-definition should work now.');
			debugLog('Successfully opened stub file for testing', {
				uri: stubUri.toString(),
				lineCount: document.lineCount,
				languageId: document.languageId
			});
			
		} catch (error: any) {
			debugLog('Failed to test go-to-definition', { error: error.message, stack: error.stack });
			vscode.window.showErrorMessage(`Failed to test go-to-definition: ${error.message}`);
		}
	});

	const searchFilesCommand = vscode.commands.registerCommand('automate-webdav.searchFiles', async () => {
		debugLog('Search files command triggered');
		await globalCustomSearchProvider.showFileSearchQuickPick();
	});

	const searchTextCommand = vscode.commands.registerCommand('automate-webdav.searchText', async () => {
		debugLog('Search text command triggered');
		await globalCustomSearchProvider.showTextSearchQuickPick();
	});

	const searchSymbolsCommand = vscode.commands.registerCommand('automate-webdav.searchSymbols', async () => {
		debugLog('Search symbols command triggered');
		await globalCustomSearchProvider.showSymbolSearchQuickPick();
	});

	const debugFileSystemCommand = vscode.commands.registerCommand('automate-webdav.debugFileSystem', async () => {
		debugLog('Debug file system command triggered');
		
		try {
			const realProvider = globalPlaceholderProvider?.getRealProvider();
			debugLog('File system debug info', {
				hasPlaceholderProvider: !!globalPlaceholderProvider,
				hasRealProvider: !!realProvider,
				virtualFileCount: realProvider?.getVirtualFileCount() || 0,
				hasFileIndex: !!globalFileIndex
			});
			
			// Debug virtual file storage
			if (realProvider) {
				// Check what's actually stored in the virtual files map
				const virtualFileDebug = (realProvider as any)._virtualFiles as Map<string, any>;
				if (virtualFileDebug) {
					const storedKeys = Array.from(virtualFileDebug.keys());
					debugLog('Virtual files stored in provider', {
						storedKeys,
						totalFiles: storedKeys.length
					});
					
					// Check specifically for our stub file
					const stubPath = '~/.stubs/plugin-api.stubs.php';
					const hasStubFile = virtualFileDebug.has(stubPath);
					debugLog('Stub file storage check', {
						path: stubPath,
						exists: hasStubFile,
						stubKeys: storedKeys.filter(key => key.includes('stubs'))
					});
				}
			}
			
			// Test if file system provider is working
			try {
				const testUri = vscode.Uri.parse('webdav:/.stubs/plugin-api.stubs.php');
				debugLog('Testing access to stub file', { 
					uri: testUri.toString(),
					path: testUri.path,
					scheme: testUri.scheme
				});
				
				if (realProvider && realProvider.hasVirtualFile('~/.stubs/plugin-api.stubs.php')) {
					debugLog('Virtual stub file exists in provider');
					
					// Try to read the file
					const content = await realProvider.readFile(testUri);
					debugLog('Successfully read stub file', { size: content.length });
					
					vscode.window.showInformationMessage(`Stub file accessible: ${content.length} bytes. File system is working correctly.`);
				} else {
					debugLog('Virtual stub file not found in provider');
					vscode.window.showWarningMessage('Virtual stub file not found. Try connecting to WebDAV first.');
				}
			} catch (error: any) {
				debugLog('Error accessing stub file directly', { error: error.message, stack: error.stack });
				vscode.window.showErrorMessage(`Error accessing stub file: ${error.message}`);
			}
			
			// Check file index contents
			if (globalFileIndex) {
				const allIndexedFiles = globalFileIndex.getAllIndexedFiles();
				const indexSize = globalFileIndex.getIndexSize();
				debugLog('File index contents', {
					indexSize,
					totalIndexedFiles: allIndexedFiles.length,
					indexedFiles: allIndexedFiles.map(f => ({ 
						path: f.path, 
						name: f.name, 
						isDirectory: f.isDirectory 
					}))
				});
			}
			
		} catch (error: any) {
			debugLog('Debug file system failed', { error: error.message });
			vscode.window.showErrorMessage(`Debug failed: ${error.message}`);
		}
	});

	context.subscriptions.push(showDebugCommand);
	context.subscriptions.push(refreshWorkspaceCommand);
	context.subscriptions.push(addStubFileCommand);
	context.subscriptions.push(setupPhpStubsCommand);
	context.subscriptions.push(testVirtualFileCommand);
	context.subscriptions.push(testGoToDefinitionCommand);
	context.subscriptions.push(searchFilesCommand);
	context.subscriptions.push(searchTextCommand);
	context.subscriptions.push(searchSymbolsCommand);
	context.subscriptions.push(debugFileSystemCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {
	const timestamp = new Date().toISOString();
	if (debugOutput) {
		debugOutput.appendLine(`===============================================`);
		debugOutput.appendLine(`[${timestamp}] WebDAV extension DEACTIVATED`);
		debugOutput.appendLine(`===============================================`);
	}
	console.log('WebDAV extension deactivated at', timestamp);
}