import * as vscode from 'vscode';
import { WebDAVFileIndex } from '../core/fileIndex';

export class WebDAVCustomSearchProvider {
	private _fileIndex: WebDAVFileIndex | null = null;
	private _debugLog: (message: string, data?: any) => void = () => {};

	setFileIndex(fileIndex: WebDAVFileIndex | null) {
		this._fileIndex = fileIndex;
	}

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this._debugLog = logger;
	}

	async showFileSearchQuickPick(): Promise<void> {
		if (!this._fileIndex) {
			vscode.window.showWarningMessage('File index not available');
			return;
		}

		try {
			await this._fileIndex.ensureIndexed();
			const allFiles = this._fileIndex.getAllFiles();

			const items: vscode.QuickPickItem[] = allFiles.map(filePath => ({
				label: this.getFileName(filePath),
				description: this.getDirectoryPath(filePath),
				detail: filePath
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Search for files in WebDAV workspace...',
				matchOnDescription: true,
				matchOnDetail: true
			});

			if (selected && selected.detail) {
				const normalizedPath = this.normalizeFilePathForUri(selected.detail);
				const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
				await vscode.window.showTextDocument(uri);
			}
		} catch (error: any) {
			this._debugLog('Error in file search quick pick', { error: error.message });
			vscode.window.showErrorMessage(`File search failed: ${error.message}`);
		}
	}

	async showTextSearchQuickPick(): Promise<void> {
		if (!this._fileIndex) {
			vscode.window.showWarningMessage('File index not available');
			return;
		}

		// Get search query from user
		const searchQuery = await vscode.window.showInputBox({
			placeHolder: 'Enter text to search for...',
			prompt: 'Search for text in WebDAV files'
		});

		if (!searchQuery) {
			return;
		}

		try {
			await this._fileIndex.ensureIndexed();
			const searchResults = await this.searchInFiles(searchQuery);

			if (searchResults.length === 0) {
				vscode.window.showInformationMessage(`No matches found for "${searchQuery}"`);
				return;
			}

			const items: vscode.QuickPickItem[] = searchResults.map(result => ({
				label: `${result.fileName}:${result.lineNumber}`,
				description: result.lineText.trim(),
				detail: result.filePath
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: `Found ${searchResults.length} matches for "${searchQuery}"`,
				matchOnDescription: true
			});

			if (selected && selected.detail) {
				const normalizedPath = this.normalizeFilePathForUri(selected.detail);
				const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
				
				// Extract line number from label
				const lineMatch = selected.label.match(/:(\d+)$/);
				const lineNumber = lineMatch ? parseInt(lineMatch[1]) - 1 : 0;
				
				const document = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(document);
				
				// Jump to the specific line
				const position = new vscode.Position(lineNumber, 0);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position));
			}
		} catch (error: any) {
			this._debugLog('Error in text search quick pick', { error: error.message });
			vscode.window.showErrorMessage(`Text search failed: ${error.message}`);
		}
	}

	async showSymbolSearchQuickPick(): Promise<void> {
		if (!this._fileIndex) {
			vscode.window.showWarningMessage('File index not available');
			return;
		}

		// Get search query from user
		const searchQuery = await vscode.window.showInputBox({
			placeHolder: 'Enter symbol name to search for...',
			prompt: 'Search for PHP symbols (functions, classes, methods)'
		});

		if (!searchQuery) {
			return;
		}

		try {
			await this._fileIndex.ensureIndexed();
			const symbolResults = await this.searchForSymbols(searchQuery);

			if (symbolResults.length === 0) {
				vscode.window.showInformationMessage(`No symbols found for "${searchQuery}"`);
				return;
			}

			const items: vscode.QuickPickItem[] = symbolResults.map(result => ({
				label: result.symbolName,
				description: `${result.symbolType} in ${result.fileName}:${result.lineNumber}`,
				detail: result.filePath
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: `Found ${symbolResults.length} symbols for "${searchQuery}"`,
				matchOnDescription: true
			});

			if (selected && selected.detail) {
				const normalizedPath = this.normalizeFilePathForUri(selected.detail);
				const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
				
				// Extract line number from description
				const lineMatch = selected.description?.match(/:(\d+)$/);
				const lineNumber = lineMatch ? parseInt(lineMatch[1]) - 1 : 0;
				
				const document = await vscode.workspace.openTextDocument(uri);
				const editor = await vscode.window.showTextDocument(document);
				
				// Jump to the specific line
				const position = new vscode.Position(lineNumber, 0);
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(new vscode.Range(position, position));
			}
		} catch (error: any) {
			this._debugLog('Error in symbol search quick pick', { error: error.message });
			vscode.window.showErrorMessage(`Symbol search failed: ${error.message}`);
		}
	}

	private async searchInFiles(query: string): Promise<Array<{
		filePath: string;
		fileName: string;
		lineNumber: number;
		lineText: string;
	}>> {
		const results: Array<{
			filePath: string;
			fileName: string;
			lineNumber: number;
			lineText: string;
		}> = [];

		if (!this._fileIndex) {
			return results;
		}

		// Get files that are likely to contain text
		const textFiles = this._fileIndex.getAllFiles().filter(file => 
			this.isTextFile(file)
		);

		for (const filePath of textFiles) {
			try {
				const normalizedPath = this.normalizeFilePathForUri(filePath);
				const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
				
				// Try to read the file
				let content: string;
				try {
					const document = await vscode.workspace.openTextDocument(uri);
					content = document.getText();
				} catch {
					// Skip files that can't be read
					continue;
				}

				const lines = content.split('\n');
				const queryLower = query.toLowerCase();

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (line.toLowerCase().includes(queryLower)) {
						results.push({
							filePath,
							fileName: this.getFileName(filePath),
							lineNumber: i + 1,
							lineText: line
						});
					}
				}
			} catch (error: any) {
				this._debugLog('Error searching in file', { filePath, error: error.message });
			}
		}

		return results;
	}

	private async searchForSymbols(query: string): Promise<Array<{
		filePath: string;
		fileName: string;
		symbolName: string;
		symbolType: string;
		lineNumber: number;
	}>> {
		const results: Array<{
			filePath: string;
			fileName: string;
			symbolName: string;
			symbolType: string;
			lineNumber: number;
		}> = [];

		if (!this._fileIndex) {
			return results;
		}

		// Get PHP files
		const phpFiles = this._fileIndex.getAllFiles().filter(file => 
			file.endsWith('.php') || file.endsWith('.phtml')
		);

		const queryLower = query.toLowerCase();

		for (const filePath of phpFiles) {
			try {
				const normalizedPath = this.normalizeFilePathForUri(filePath);
				const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
				
				// Try to read the file
				let content: string;
				try {
					const document = await vscode.workspace.openTextDocument(uri);
					content = document.getText();
				} catch {
					// Skip files that can't be read
					continue;
				}

				const lines = content.split('\n');

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					const symbols = this.extractSymbolsFromLine(line);

					for (const symbol of symbols) {
						if (symbol.name.toLowerCase().includes(queryLower)) {
							results.push({
								filePath,
								fileName: this.getFileName(filePath),
								symbolName: symbol.name,
								symbolType: symbol.type,
								lineNumber: i + 1
							});
						}
					}
				}
			} catch (error: any) {
				this._debugLog('Error searching for symbols in file', { filePath, error: error.message });
			}
		}

		return results;
	}

	private extractSymbolsFromLine(line: string): Array<{ name: string; type: string }> {
		const symbols: Array<{ name: string; type: string }> = [];

		// Class definitions
		const classMatch = line.match(/class\s+(\w+)/i);
		if (classMatch) {
			symbols.push({ name: classMatch[1], type: 'class' });
		}

		// Function definitions
		const functionMatch = line.match(/function\s+(\w+)/i);
		if (functionMatch) {
			symbols.push({ name: functionMatch[1], type: 'function' });
		}

		// Interface definitions
		const interfaceMatch = line.match(/interface\s+(\w+)/i);
		if (interfaceMatch) {
			symbols.push({ name: interfaceMatch[1], type: 'interface' });
		}

		// Trait definitions
		const traitMatch = line.match(/trait\s+(\w+)/i);
		if (traitMatch) {
			symbols.push({ name: traitMatch[1], type: 'trait' });
		}

		// Constants
		const constantMatch = line.match(/const\s+(\w+)/i);
		if (constantMatch) {
			symbols.push({ name: constantMatch[1], type: 'constant' });
		}

		return symbols;
	}

	private isTextFile(filePath: string): boolean {
		const textExtensions = [
			'.txt', '.js', '.ts', '.json', '.css', '.html', '.htm', '.xml', 
			'.md', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', 
			'.php', '.rb', '.go', '.rs', '.swift', '.kt', '.yml', '.yaml'
		];
		return textExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
	}

	private getFileName(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
	}

	private getDirectoryPath(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
	}

	private normalizeFilePathForUri(filePath: string): string {
		// Handle ~ prefix for virtual files - convert to regular path
		let normalizedPath = filePath;
		if (filePath.startsWith('~/')) {
			normalizedPath = filePath.substring(1); // Remove ~ but keep the /
		} else if (filePath.startsWith('~')) {
			normalizedPath = filePath.substring(1); // Remove ~ completely
		}
		
		// Ensure path starts with /
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = `/${normalizedPath}`;
		}
		
		return normalizedPath;
	}
}