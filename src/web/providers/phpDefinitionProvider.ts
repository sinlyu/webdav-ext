import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { WebDAVFileIndex } from '../core/fileIndex';
import { IPHPDefinitionProvider, PHPSymbol } from './phpDefinitionProviderInterface';

export class PHPDefinitionProvider implements IPHPDefinitionProvider {
	private _credentials: WebDAVCredentials | null = null;
	private _fileIndex: WebDAVFileIndex | null = null;
	private _debugLog: (message: string, data?: any) => void = () => {};
	private _symbolCache = new Map<string, PHPSymbol[]>();
	private _fileContentCache = new Map<string, string>();
	private _fileSystemProvider: any = null;

	constructor() {}

	setCredentials(credentials: WebDAVCredentials | null) {
		this._credentials = credentials;
		this.clearCaches();
	}

	setFileIndex(fileIndex: WebDAVFileIndex | null) {
		this._fileIndex = fileIndex;
	}

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this._debugLog = logger;
	}

	setFileSystemProvider(fsProvider: any) {
		this._fileSystemProvider = fsProvider;
	}

	private clearCaches() {
		this._symbolCache.clear();
		this._fileContentCache.clear();
		this._debugLog('PHP symbol caches cleared');
	}

	async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Definition | undefined> {
		this._debugLog('PHP definition requested', {
			file: document.uri.toString(),
			position: { line: position.line, character: position.character }
		});

		if (!this._credentials) {
			this._debugLog('No WebDAV credentials available');
			return undefined;
		}

		try {
			// Get the word at the current position
			const wordRange = document.getWordRangeAtPosition(position);
			if (!wordRange) {
				this._debugLog('No word found at position');
				return undefined;
			}

			const word = document.getText(wordRange);
			this._debugLog('Looking for definition of word', { word });

			// Determine the context and type of symbol
			const symbolContext = this.getSymbolContext(document, position, wordRange);
			this._debugLog('Symbol context determined', symbolContext);

			// Search for the symbol definition
			const definitions = await this.findSymbolDefinitions(word, symbolContext, document);
			
			if (definitions.length === 0) {
				this._debugLog('No definitions found', { word });
				return undefined;
			}

			this._debugLog('Found definitions', { word, count: definitions.length });
			return definitions.map(def => def.location);

		} catch (error: any) {
			this._debugLog('Error in provideDefinition', { error: error.message });
			return undefined;
		}
	}

	private getSymbolContext(
		document: vscode.TextDocument,
		position: vscode.Position,
		wordRange: vscode.Range
	): {
		type: 'function' | 'class' | 'method' | 'property' | 'variable' | 'constant' | 'unknown';
		isStatic: boolean;
		className?: string;
		namespace?: string;
	} {
		const line = document.lineAt(position.line).text;
		const beforeWord = line.substring(0, wordRange.start.character);
		const afterWord = line.substring(wordRange.end.character);

		// Check for different PHP symbol patterns
		if (beforeWord.includes('function ') || /\s+function\s*$/.test(beforeWord)) {
			return { type: 'function', isStatic: false };
		}

		if (beforeWord.includes('class ') || /\s+class\s*$/.test(beforeWord) || 
			beforeWord.includes('interface ') || /\s+interface\s*$/.test(beforeWord) ||
			beforeWord.includes('trait ') || /\s+trait\s*$/.test(beforeWord)) {
			return { type: 'class', isStatic: false };
		}

		if (beforeWord.includes('new ') || /\s+new\s+$/.test(beforeWord)) {
			return { type: 'class', isStatic: false };
		}

		if (beforeWord.includes('extends ') || beforeWord.includes('implements ')) {
			return { type: 'class', isStatic: false };
		}

		if (beforeWord.includes('::')) {
			const staticMatch = beforeWord.match(/(\w+)\s*::\s*$/);
			if (staticMatch) {
				// Could be a method or constant
				if (/[A-Z_][A-Z0-9_]*/.test(document.getText(wordRange))) {
					return { type: 'constant', isStatic: true, className: staticMatch[1] };
				}
				return { type: 'method', isStatic: true, className: staticMatch[1] };
			}
		}

		if (beforeWord.includes('->')) {
			const methodMatch = beforeWord.match(/\$\w+\s*->\s*$/);
			if (methodMatch) {
				// Could be a method or property
				if (afterWord.startsWith('(')) {
					return { type: 'method', isStatic: false };
				}
				return { type: 'property', isStatic: false };
			}
		}

		// Variable reference
		if (beforeWord.includes('$') || document.getText(wordRange).startsWith('$')) {
			return { type: 'variable', isStatic: false };
		}

		// Constant (all uppercase with underscores)
		if (/^[A-Z_][A-Z0-9_]*$/.test(document.getText(wordRange))) {
			return { type: 'constant', isStatic: false };
		}

		// Check if it looks like a function call
		if (afterWord.startsWith('(')) {
			return { type: 'function', isStatic: false };
		}

		// Check use statements
		if (beforeWord.includes('use ') || /\s+use\s+$/.test(beforeWord)) {
			return { type: 'class', isStatic: false };
		}

		return { type: 'unknown', isStatic: false };
	}

	private async findSymbolDefinitions(
		symbolName: string,
		context: any,
		currentDocument: vscode.TextDocument
	): Promise<PHPSymbol[]> {
		const definitions: PHPSymbol[] = [];

		// First, check the current file
		const currentFileContent = await this.getFileContent(currentDocument.uri);
		const currentFileSymbols = await this.parseFileSymbols(currentDocument.uri.path, currentFileContent);
		
		this._debugLog('Current file symbols parsed', { 
			filePath: currentDocument.uri.path,
			totalSymbols: currentFileSymbols.length,
			symbolNames: currentFileSymbols.map(s => `${s.name}(${s.type})`)
		});

		// Debug: Show all symbols found and which ones match
		const allMatches = currentFileSymbols.filter(symbol => symbol.name === symbolName);
		const contextMatches = allMatches.filter(symbol => this.matchesContext(symbol, context));
		
		this._debugLog('Symbol matching analysis', {
			symbolName,
			contextType: context.type,
			totalSymbolsInFile: currentFileSymbols.length,
			symbolsWithSameName: allMatches.length,
			symbolsWithSameNameDetails: allMatches.map(s => `${s.name}(${s.type})`),
			contextMatches: contextMatches.length,
			finalMatches: contextMatches.map(s => `${s.name}(${s.type}) at line ${s.location.range.start.line}`)
		});

		const localDefinitions = contextMatches;
		
		this._debugLog('Local definitions found', { 
			symbolName, 
			context: context.type,
			localMatches: localDefinitions.length,
			matchedSymbols: localDefinitions.map(s => `${s.name}(${s.type}) at line ${s.location.range.start.line}`)
		});
		
		definitions.push(...localDefinitions);

		// If not found locally, search all PHP files in the project
		if (definitions.length === 0) {
			this._debugLog('No local definitions found, searching project files', { symbolName });
		} else {
			this._debugLog('Found local definitions, skipping project search', { count: definitions.length });
			return definitions;
		}

		if (definitions.length === 0) {
			const allPhpFiles = await this.getAllPhpFiles();
			this._debugLog('Will search PHP files', { 
				count: allPhpFiles.length,
				files: allPhpFiles.slice(0, 5), // Show first 5 files
				hasMore: allPhpFiles.length > 5
			});
			
			for (const filePath of allPhpFiles) {
				if (filePath === currentDocument.uri.path) {
					this._debugLog('Skipping current file', { filePath });
					continue; // Already checked
				}

				try {
					this._debugLog('Searching file for symbols', { filePath, symbolName });
					const fileContent = await this.getFileContent(vscode.Uri.parse(`webdav:${filePath}`));
					const fileSymbols = await this.parseFileSymbols(filePath, fileContent);
					
					const matchingSymbols = fileSymbols.filter(symbol => 
						symbol.name === symbolName && this.matchesContext(symbol, context)
					);
					
					if (matchingSymbols.length > 0) {
						this._debugLog('Found matching symbols in file', { 
							filePath, 
							symbolName, 
							matches: matchingSymbols.length 
						});
						definitions.push(...matchingSymbols);
					}
					
				} catch (error: any) {
					this._debugLog('Error parsing file for symbols', { filePath, error: error.message });
				}
			}
		}

		return definitions;
	}

	private matchesContext(symbol: PHPSymbol, context: any): boolean {
		// Only log mismatches for debugging
		const matches = this.evaluateContextMatch(symbol, context);
		if (!matches) {
			this._debugLog('Context mismatch', {
				symbolName: symbol.name,
				symbolType: symbol.type,
				contextType: context.type,
				reason: this.getMatchFailureReason(symbol, context)
			});
		}
		return matches;
	}

	private evaluateContextMatch(symbol: PHPSymbol, context: any): boolean {
		if (context.type === 'unknown') {
			return true; // Match any type if context is unknown
		}

		if (context.type === symbol.type) {
			// Additional checks for methods
			if (context.type === 'method' && context.className && symbol.className) {
				return context.className === symbol.className;
			}
			return true;
		}

		// Enhanced special cases for more flexible matching
		
		// Functions and methods are interchangeable in many contexts
		if ((context.type === 'function' && symbol.type === 'method') ||
		    (context.type === 'method' && symbol.type === 'function')) {
			return true; // Allow functions and methods to match each other
		}
		
		// Properties can sometimes be accessed like functions (magic methods, callable properties)
		if (context.type === 'function' && symbol.type === 'property') {
			return true; // Allow properties to match function context
		}
		
		// Methods can be accessed as properties (method references)
		if (context.type === 'property' && symbol.type === 'method') {
			return true; // Allow methods to match property context
		}
		
		// Constants can be used in function-like contexts
		if (context.type === 'function' && symbol.type === 'constant') {
			return true; // Allow constants to match function context
		}

		return false;
	}

	private getMatchFailureReason(symbol: PHPSymbol, context: any): string {
		if (context.type !== symbol.type) {
			return `type mismatch: expected ${context.type}, got ${symbol.type}`;
		}
		if (context.type === 'method' && context.className && symbol.className && context.className !== symbol.className) {
			return `class mismatch: expected ${context.className}, got ${symbol.className}`;
		}
		return 'unknown reason';
	}

	private async getAllPhpFiles(): Promise<string[]> {
		if (!this._fileIndex) {
			this._debugLog('No file index available');
			return [];
		}

		// Get all files from the file index
		const allFiles = this._fileIndex.getAllFiles();
		
		// Filter for PHP files (including virtual files)
		const phpFiles = allFiles.filter(file => 
			file.endsWith('.php') || 
			file.endsWith('.phtml') || 
			file.endsWith('.inc')
		);

		this._debugLog('Found PHP files (including virtual)', { 
			totalFiles: allFiles.length,
			phpFiles: phpFiles.length,
			phpFilesList: phpFiles
		});
		return phpFiles;
	}

	private async getFileContent(uri: vscode.Uri): Promise<string> {
		const filePath = uri.path;
		
		// Check cache first
		if (this._fileContentCache.has(filePath)) {
			return this._fileContentCache.get(filePath)!;
		}

		try {
			// Try to get from open document first
			const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.path === filePath);
			if (openDoc) {
				const content = openDoc.getText();
				this._fileContentCache.set(filePath, content);
				return content;
			}

			// Check if this is a virtual file
			const isVirtualFile = filePath.startsWith('~/.') || filePath.startsWith('/.') || 
								 filePath.includes('.stubs') || filePath.includes('.vscode');
			
			if (isVirtualFile && this._fileSystemProvider) {
				this._debugLog('Attempting to read virtual file through file system provider', { filePath });
				try {
					// Try to read through the WebDAV file system provider
					const content = await this._fileSystemProvider.readFile(uri);
					const textContent = new TextDecoder().decode(content);
					this._fileContentCache.set(filePath, textContent);
					this._debugLog('Successfully read virtual file', { filePath, contentLength: textContent.length });
					return textContent;
				} catch (fsError: any) {
					this._debugLog('Failed to read virtual file through FS provider', { filePath, error: fsError.message });
				}
			}

			// Read from standard file system
			const document = await vscode.workspace.openTextDocument(uri);
			const content = document.getText();
			this._fileContentCache.set(filePath, content);
			return content;

		} catch (error: any) {
			this._debugLog('Error reading file content', { filePath, error: error.message });
			return '';
		}
	}

	private async parseFileSymbols(filePath: string, content: string): Promise<PHPSymbol[]> {
		// Check cache first
		const cacheKey = `${filePath}:${content.length}:${this.getContentHash(content)}`;
		if (this._symbolCache.has(cacheKey)) {
			return this._symbolCache.get(cacheKey)!;
		}

		const symbols: PHPSymbol[] = [];
		const lines = content.split('\n');

		let currentNamespace = '';
		let currentClass = '';
		let inPhpTag = false;

		this._debugLog('Starting to parse file symbols', { 
			filePath, 
			totalLines: lines.length,
			contentLength: content.length 
		});

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex].trim();
			
			// Check for PHP opening tag
			if (line.includes('<?php') || line.includes('<?=')) {
				inPhpTag = true;
				this._debugLog('Found PHP opening tag', { line: lineIndex + 1 });
				continue;
			}

			// Skip non-PHP content
			if (!inPhpTag) {
				continue;
			}

			// Check for PHP closing tag
			if (line.includes('?>')) {
				inPhpTag = false;
				this._debugLog('Found PHP closing tag', { line: lineIndex + 1 });
				continue;
			}

			// Log lines that contain function keyword for debugging
			if (line.includes('function')) {
				this._debugLog('Line contains "function" keyword', {
					line: lineIndex + 1,
					content: lines[lineIndex], // Use original line with indentation
					trimmed: line,
					currentClass,
					inPhpTag
				});
			}

			try {
				// Parse namespace
				const namespaceMatch = line.match(/^namespace\s+([^;]+);/);
				if (namespaceMatch) {
					currentNamespace = namespaceMatch[1].trim();
					this._debugLog('Found namespace', { namespace: currentNamespace, line: lineIndex + 1 });
					continue;
				}

				// Parse class/interface/trait
				const classMatch = line.match(/^(?:abstract\s+)?(?:final\s+)?(class|interface|trait)\s+(\w+)/);
				if (classMatch) {
					currentClass = classMatch[2];
					symbols.push({
						name: currentClass,
						type: 'class',
						location: new vscode.Location(
							vscode.Uri.parse(`webdav:${filePath}`),
							new vscode.Position(lineIndex, line.indexOf(currentClass))
						),
						namespace: currentNamespace || undefined
					});
					this._debugLog('Found class/interface/trait', {
						name: currentClass,
						type: classMatch[1],
						line: lineIndex + 1,
						originalLine: lines[lineIndex]
					});
					continue;
				}

				// Reset current class on closing brace (simple heuristic)
				if (line === '}' && currentClass) {
					this._debugLog('End of class detected', { previousClass: currentClass, line: lineIndex + 1 });
					currentClass = '';
					continue;
				}

				// Parse function - try multiple patterns
				let functionMatch = line.match(/(?:^|\s+)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+(\w+)/);
				
				// If first pattern fails, try more permissive patterns
				if (!functionMatch) {
					// Try without requiring word boundaries at start
					functionMatch = line.match(/(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+(\w+)/);
				}
				
				if (!functionMatch) {
					// Try even simpler pattern - just function keyword
					functionMatch = line.match(/function\s+(\w+)/);
				}
				
				if (functionMatch) {
					const functionName = functionMatch[1];
					const isStatic = line.includes('static');
					const visibility = this.extractVisibility(line);

					// Find the exact position of the function name
					const functionNameIndex = line.indexOf('function ' + functionName) + 9; // 9 = 'function '.length

					const symbol = {
						name: functionName,
						type: currentClass ? 'method' : 'function',
						location: new vscode.Location(
							vscode.Uri.parse(`webdav:${filePath}`),
							new vscode.Position(lineIndex, functionNameIndex)
						),
						namespace: currentNamespace || undefined,
						className: currentClass || undefined,
						visibility,
						isStatic
					} as PHPSymbol;

					symbols.push(symbol);
					
					this._debugLog('Found function/method', {
						name: functionName,
						type: symbol.type,
						line: lineIndex + 1,
						originalLine: lines[lineIndex],
						trimmedLine: line,
						currentClass,
						visibility,
						isStatic,
						regex: 'matched'
					});
					
					continue;
				} else if (line.includes('function')) {
					// Debug why function line didn't match
					this._debugLog('Function line did NOT match regex', {
						line: lineIndex + 1,
						originalLine: lines[lineIndex],
						trimmedLine: line,
						currentClass,
						regex: /(?:^|\s+)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+(\w+)/.toString()
					});
				}

				// Parse class properties
				if (currentClass) {
					const propertyMatch = line.match(/(?:^|\s+)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?\$(\w+)/);
					if (propertyMatch) {
						const propertyName = propertyMatch[1];
						const isStatic = line.includes('static');
						const visibility = this.extractVisibility(line);

						symbols.push({
							name: propertyName,
							type: 'property',
							location: new vscode.Location(
								vscode.Uri.parse(`webdav:${filePath}`),
								new vscode.Position(lineIndex, line.indexOf('$' + propertyName))
							),
							namespace: currentNamespace || undefined,
							className: currentClass,
							visibility,
							isStatic
						});
						continue;
					}
				}

				// Parse constants
				const constantMatch = line.match(/(?:^|\s+)(?:const\s+|define\s*\(\s*['"]?)([A-Z_][A-Z0-9_]*)/);
				if (constantMatch) {
					const constantName = constantMatch[1];
					symbols.push({
						name: constantName,
						type: 'constant',
						location: new vscode.Location(
							vscode.Uri.parse(`webdav:${filePath}`),
							new vscode.Position(lineIndex, line.indexOf(constantName))
						),
						namespace: currentNamespace || undefined,
						className: currentClass || undefined
					});
					continue;
				}

			} catch (error: any) {
				this._debugLog('Error parsing line', { lineIndex, line, error: error.message });
			}
		}

		// Cache the results
		this._symbolCache.set(cacheKey, symbols);
		this._debugLog('Parsed file symbols', { filePath, symbolCount: symbols.length });

		return symbols;
	}

	private extractVisibility(line: string): 'public' | 'private' | 'protected' {
		if (line.includes('private')) return 'private';
		if (line.includes('protected')) return 'protected';
		return 'public';
	}

	private getContentHash(content: string): string {
		// Simple hash function for caching
		let hash = 0;
		for (let i = 0; i < content.length; i++) {
			const char = content.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString();
	}

	/**
	 * Clear all caches (useful when files change)
	 */
	public clearAllCaches(): void {
		this.clearCaches();
	}

	/**
	 * Get symbol information for debugging
	 */
	public async getSymbolsInFile(filePath: string): Promise<PHPSymbol[]> {
		try {
			const uri = vscode.Uri.parse(`webdav:${filePath}`);
			const content = await this.getFileContent(uri);
			return await this.parseFileSymbols(filePath, content);
		} catch (error: any) {
			this._debugLog('Error getting symbols in file', { filePath, error: error.message });
			return [];
		}
	}
}