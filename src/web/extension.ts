import * as vscode from 'vscode';
import { WebDAVFileSearchProvider } from './providers/fileSearchProvider';
import { WebDAVTextSearchProvider } from './providers/textSearchProvider';
import { WebDAVWorkspaceSymbolProvider } from './providers/workspaceSymbolProvider';
import { WebDAVDocumentSymbolProvider } from './providers/documentSymbolProvider';
import { WebDAVCustomSearchProvider } from './providers/customSearchProvider';
import { PHPDefinitionProviderAST } from './providers/phpDefinitionProviderAST';
import { IPHPDefinitionProvider } from './providers/phpDefinitionProviderInterface';
import { WebDAVFileIndex } from './core/fileIndex';
import { WebDAVViewProvider } from './ui/webdavViewProvider';
import { PlaceholderFileSystemProvider } from './providers/fileSystemProvider';
import { createDebugLogger } from './utils/logging';
import { Logger, createChildLogger } from './utils/logger';
import { PHPConfigurationManager } from './services/phpConfigurationManager';
import { VirtualFileManager } from './services/virtualFileManager';
import { CommandManager } from './commands/commandManager';
import { ShowDebugCommand } from './commands/showDebugCommand';
import { RefreshWorkspaceCommand } from './commands/refreshWorkspaceCommand';
import { AddStubFileCommand } from './commands/addStubFileCommand';
import { SetupPhpStubsCommand } from './commands/setupPhpStubsCommand';
import { TestVirtualFileCommand } from './commands/testVirtualFileCommand';
import { TestGoToDefinitionCommand } from './commands/testGoToDefinitionCommand';
import { SearchFilesCommand, SearchTextCommand, SearchSymbolsCommand } from './commands/searchCommand';
import { DebugFileSystemCommand } from './commands/debugFileSystemCommand';



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

// Service instances
let phpConfigManager: PHPConfigurationManager;
let virtualFileManager: VirtualFileManager;
let commandManager: CommandManager;

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
		
		await phpConfigManager.updateWorkspaceIncludePath(allPhpFiles);
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
	
	// Initialize centralized logger
	Logger.initialize(debugOutput);
	const logger = createChildLogger('Extension');
	
	// Initialize services
	phpConfigManager = new PHPConfigurationManager();
	commandManager = new CommandManager();
	
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
	
	// Use AST-based PHP definition provider (more accurate)
	globalPhpDefinitionProvider = new PHPDefinitionProviderAST();
	debugLog('Using AST-based PHP definition provider');
	
	globalFileIndex = new WebDAVFileIndex();
	
	// Set debug loggers for all providers and index
	// globalFileSearchProvider now has built-in debug logging
	// globalTextSearchProvider now has built-in debug logging
	globalWorkspaceSymbolProvider.setDebugLogger(debugLog);
	globalDocumentSymbolProvider.setDebugLogger(debugLog);
	globalCustomSearchProvider.setDebugLogger(debugLog);
	globalPhpDefinitionProvider.setDebugLogger(debugLog);
	globalFileIndex.setDebugLogger(debugLog);
	
	// Set callback to update PHP workspace.includePath when index is updated
	globalFileIndex.setOnIndexUpdatedCallback(updatePhpWorkspaceIncludePath);
	
	// Set callback to show notification when indexing starts
	globalFileIndex.setOnIndexStartedCallback(() => {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "WebDAV: Indexing directories recursively...",
			cancellable: true
		}, async (progress, token) => {
			// Wait for indexing to complete with timeout and cancellation support
			const maxWaitTime = 5 * 60 * 1000; // 5 minutes max
			const startTime = Date.now();
			
			while (globalFileIndex?.isIndexing()) {
				// Check for cancellation
				if (token.isCancellationRequested) {
					debugLog('Indexing cancelled by user');
					return;
				}
				
				// Check for timeout
				if (Date.now() - startTime > maxWaitTime) {
					debugLog('Indexing timeout after 5 minutes');
					vscode.window.showWarningMessage('WebDAV indexing timed out. The extension may not function properly.');
					return;
				}
				
				// Update progress
				const elapsed = Math.round((Date.now() - startTime) / 1000);
				progress.report({ message: `Indexing... (${elapsed}s)` });
				
				await new Promise(resolve => setTimeout(resolve, 500));
			}
			
			const stats = globalFileIndex?.getIndexStats();
			if (stats) {
				debugLog('Recursive indexing completed', stats);
				vscode.window.showInformationMessage(
					`WebDAV indexing complete: ${stats.files} files, ${stats.directories} directories cached`
				);
			}
		});
	});
	
	// Set file index for non-search providers (search providers now use direct traversal)
	// globalFileSearchProvider - now uses direct traversal only
	// globalTextSearchProvider - now uses direct traversal only
	globalWorkspaceSymbolProvider.setFileIndex(globalFileIndex);
	globalCustomSearchProvider.setFileIndex(globalFileIndex);
	globalPhpDefinitionProvider.setFileIndex(globalFileIndex);
	
	// Initialize virtual file manager
	virtualFileManager = new VirtualFileManager(context, globalPlaceholderProvider, phpConfigManager);
	
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
					await virtualFileManager.createStubFile();
					logger.info('Virtual PHP stub file created successfully');
				} catch (error: any) {
					logger.exception('Failed to create virtual stub file', error);
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

	// Register commands using command manager
	const showDebugCommand = commandManager.registerCommand('automate-webdav.showDebug', 
		new ShowDebugCommand(debugOutput));
	
	const refreshWorkspaceCommand = commandManager.registerCommand('automate-webdav.refreshWorkspace', 
		new RefreshWorkspaceCommand(globalPlaceholderProvider));

	const addStubFileCommand = commandManager.registerCommand('automate-webdav.addStubFile', 
		new AddStubFileCommand(context, globalPlaceholderProvider, debugLog));

	const setupPhpStubsCommand = commandManager.registerCommand('automate-webdav.setupPhpStubs', 
		new SetupPhpStubsCommand(context, globalPlaceholderProvider, globalFileIndex, phpConfigManager, debugLog));

	const testVirtualFileCommand = commandManager.registerCommand('automate-webdav.testVirtualFile', 
		new TestVirtualFileCommand(globalPlaceholderProvider, debugLog));

	const testGoToDefinitionCommand = commandManager.registerCommand('automate-webdav.testGoToDefinition', 
		new TestGoToDefinitionCommand(globalPlaceholderProvider, globalStubFileCreator, debugLog));

	const searchFilesCommand = commandManager.registerCommand('automate-webdav.searchFiles', 
		new SearchFilesCommand(globalCustomSearchProvider, debugLog));

	const searchTextCommand = commandManager.registerCommand('automate-webdav.searchText', 
		new SearchTextCommand(globalCustomSearchProvider, debugLog));

	const searchSymbolsCommand = commandManager.registerCommand('automate-webdav.searchSymbols', 
		new SearchSymbolsCommand(globalCustomSearchProvider, debugLog));

	const debugFileSystemCommand = commandManager.registerCommand('automate-webdav.debugFileSystem', 
		new DebugFileSystemCommand(globalPlaceholderProvider, globalFileIndex, debugLog));

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