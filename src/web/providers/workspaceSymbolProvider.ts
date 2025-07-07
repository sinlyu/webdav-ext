import * as vscode from 'vscode';
import { WebDAVFileIndex } from '../core/fileIndex';

export class WebDAVWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
	private _fileIndex: WebDAVFileIndex | null = null;
	private _debugLog: (message: string, data?: any) => void = () => {};

	setFileIndex(fileIndex: WebDAVFileIndex | null) {
		this._fileIndex = fileIndex;
	}

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this._debugLog = logger;
	}

	async provideWorkspaceSymbols(
		query: string,
		token: vscode.CancellationToken
	): Promise<vscode.SymbolInformation[]> {
		if (!this._fileIndex) {
			this._debugLog('WorkspaceSymbolProvider: No file index available');
			return [];
		}

		this._debugLog('WorkspaceSymbolProvider: Searching for symbols', { query });

		const symbols: vscode.SymbolInformation[] = [];

		try {
			// Ensure index is ready
			await this._fileIndex.ensureIndexed();

			// Search for files matching the query (for file-based symbols)
			const matchingFiles = this._fileIndex.searchFiles(query);
			
			// Add file symbols
			for (const filePath of matchingFiles) {
				if (token.isCancellationRequested) {
					break;
				}

				const fileName = this.getFileName(filePath);
				const normalizedPath = this.normalizeFilePathForUri(filePath);
				const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);

				// Create file symbol
				const location = new vscode.Location(uri, new vscode.Position(0, 0));
				const symbol = new vscode.SymbolInformation(
					fileName,
					vscode.SymbolKind.File,
					'',
					location
				);

				symbols.push(symbol);
			}

			// Search for PHP symbols (functions, classes, methods)
			const phpFiles = this._fileIndex.getAllFiles().filter(file => 
				file.endsWith('.php') || file.endsWith('.phtml')
			);

			for (const filePath of phpFiles) {
				if (token.isCancellationRequested) {
					break;
				}

				try {
					const phpSymbols = await this.extractPhpSymbols(filePath, query);
					symbols.push(...phpSymbols);
				} catch (error: any) {
					this._debugLog('Error extracting PHP symbols', { filePath, error: error.message });
				}
			}

			this._debugLog('WorkspaceSymbolProvider: Found symbols', { 
				query, 
				symbolCount: symbols.length,
				fileCount: matchingFiles.length
			});

			return symbols;
		} catch (error: any) {
			this._debugLog('WorkspaceSymbolProvider: Error searching symbols', { 
				query, 
				error: error.message 
			});
			return [];
		}
	}

	private async extractPhpSymbols(filePath: string, query: string): Promise<vscode.SymbolInformation[]> {
		const symbols: vscode.SymbolInformation[] = [];
		
		try {
			// Read file content through the file system provider
			const normalizedPath = this.normalizeFilePathForUri(filePath);
			const uri = vscode.Uri.parse(`webdav:${normalizedPath}`);
			
			// Try to get existing document or read file
			let content: string;
			try {
				const document = await vscode.workspace.openTextDocument(uri);
				content = document.getText();
			} catch {
				// If document not open, we'd need to read from file system
				// For now, skip files that aren't open
				return [];
			}

			const lines = content.split('\n');
			const queryLower = query.toLowerCase();

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const lineLower = line.toLowerCase();

				// Skip if query doesn't match this line
				if (query && !lineLower.includes(queryLower)) {
					continue;
				}

				// Extract PHP symbols using regex patterns
				const phpSymbols = this.extractPhpSymbolsFromLine(line, i, uri);
				
				// Filter symbols that match the query
				for (const symbol of phpSymbols) {
					if (!query || symbol.name.toLowerCase().includes(queryLower)) {
						symbols.push(symbol);
					}
				}
			}

		} catch (error: any) {
			this._debugLog('Error reading PHP file for symbols', { filePath, error: error.message });
		}

		return symbols;
	}

	private extractPhpSymbolsFromLine(line: string, lineNumber: number, uri: vscode.Uri): vscode.SymbolInformation[] {
		const symbols: vscode.SymbolInformation[] = [];
		const position = new vscode.Position(lineNumber, 0);

		// Class definitions
		const classMatch = line.match(/class\s+(\w+)/i);
		if (classMatch) {
			const location = new vscode.Location(uri, position);
			symbols.push(new vscode.SymbolInformation(
				classMatch[1],
				vscode.SymbolKind.Class,
				'',
				location
			));
		}

		// Function definitions
		const functionMatch = line.match(/function\s+(\w+)/i);
		if (functionMatch) {
			const location = new vscode.Location(uri, position);
			symbols.push(new vscode.SymbolInformation(
				functionMatch[1],
				vscode.SymbolKind.Function,
				'',
				location
			));
		}

		// Method definitions (inside classes)
		const methodMatch = line.match(/(?:public|private|protected)?\s*function\s+(\w+)/i);
		if (methodMatch && methodMatch[1] !== functionMatch?.[1]) {
			const location = new vscode.Location(uri, position);
			symbols.push(new vscode.SymbolInformation(
				methodMatch[1],
				vscode.SymbolKind.Method,
				'',
				location
			));
		}

		// Interface definitions
		const interfaceMatch = line.match(/interface\s+(\w+)/i);
		if (interfaceMatch) {
			const location = new vscode.Location(uri, position);
			symbols.push(new vscode.SymbolInformation(
				interfaceMatch[1],
				vscode.SymbolKind.Interface,
				'',
				location
			));
		}

		// Trait definitions
		const traitMatch = line.match(/trait\s+(\w+)/i);
		if (traitMatch) {
			const location = new vscode.Location(uri, position);
			symbols.push(new vscode.SymbolInformation(
				traitMatch[1],
				vscode.SymbolKind.Module,
				'',
				location
			));
		}

		// Constants
		const constantMatch = line.match(/const\s+(\w+)/i);
		if (constantMatch) {
			const location = new vscode.Location(uri, position);
			symbols.push(new vscode.SymbolInformation(
				constantMatch[1],
				vscode.SymbolKind.Constant,
				'',
				location
			));
		}

		// Variables (properties)
		const variableMatch = line.match(/(?:public|private|protected)?\s*\$(\w+)/i);
		if (variableMatch) {
			const location = new vscode.Location(uri, position);
			symbols.push(new vscode.SymbolInformation(
				'$' + variableMatch[1],
				vscode.SymbolKind.Variable,
				'',
				location
			));
		}

		return symbols;
	}

	private getFileName(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
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