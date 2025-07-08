import * as vscode from 'vscode';
import { Command } from './commandManager';
import { PlaceholderFileSystemProvider } from '../providers/fileSystemProvider';
import { WebDAVFileIndex } from '../core/fileIndex';

export class DebugFileSystemCommand implements Command {
	constructor(
		private placeholderProvider: PlaceholderFileSystemProvider,
		private fileIndex: WebDAVFileIndex,
		private debugLog: (message: string, data?: any) => void
	) {}

	async execute(): Promise<void> {
		this.debugLog('Debug file system command triggered');
		
		try {
			const realProvider = this.placeholderProvider?.getRealProvider();
			this.debugLog('File system debug info', {
				hasPlaceholderProvider: !!this.placeholderProvider,
				hasRealProvider: !!realProvider,
				virtualFileCount: realProvider?.getVirtualFileCount() || 0,
				hasFileIndex: !!this.fileIndex
			});
			
			// Debug virtual file storage
			if (realProvider) {
				// Check what's actually stored in the virtual files map
				const virtualFileDebug = (realProvider as any)._virtualFiles as Map<string, any>;
				if (virtualFileDebug) {
					const storedKeys = Array.from(virtualFileDebug.keys());
					this.debugLog('Virtual files stored in provider', {
						storedKeys,
						totalFiles: storedKeys.length
					});
					
					// Check specifically for our stub file
					const stubPath = '~/.stubs/automate.meta.php';
					const hasStubFile = virtualFileDebug.has(stubPath);
					this.debugLog('Stub file storage check', {
						path: stubPath,
						exists: hasStubFile,
						stubKeys: storedKeys.filter(key => key.includes('stubs'))
					});
				}
			}
			
			// Test if file system provider is working
			try {
				const testUri = vscode.Uri.parse('webdav:/.stubs/automate.meta.php');
				this.debugLog('Testing access to stub file', { 
					uri: testUri.toString(),
					path: testUri.path,
					scheme: testUri.scheme
				});
				
				if (realProvider && realProvider.hasVirtualFile('~/.stubs/automate.meta.php')) {
					this.debugLog('Virtual stub file exists in provider');
					
					// Try to read the file
					const content = await realProvider.readFile(testUri);
					this.debugLog('Successfully read stub file', { size: content.length });
					
					vscode.window.showInformationMessage(`Stub file accessible: ${content.length} bytes. File system is working correctly.`);
				} else {
					this.debugLog('Virtual stub file not found in provider');
					vscode.window.showWarningMessage('Virtual stub file not found. Try connecting to WebDAV first.');
				}
			} catch (error: any) {
				this.debugLog('Error accessing stub file directly', { error: error.message, stack: error.stack });
				vscode.window.showErrorMessage(`Error accessing stub file: ${error.message}`);
			}
			
			// Check file index contents
			if (this.fileIndex) {
				const allIndexedFiles = this.fileIndex.getAllIndexedFiles();
				const indexSize = this.fileIndex.getIndexSize();
				this.debugLog('File index contents', {
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
			this.debugLog('Debug file system failed', { error: error.message });
			vscode.window.showErrorMessage(`Debug failed: ${error.message}`);
		}
	}
}