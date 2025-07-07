import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { WebDAVFileIndex } from '../core/fileIndex';
import { IPHPDefinitionProvider, PHPSymbol } from './phpDefinitionProviderInterface';

// Import php-parser
const Engine = require('php-parser');

export class PHPDefinitionProviderAST implements IPHPDefinitionProvider {
	private _credentials: WebDAVCredentials | null = null;
	private _fileIndex: WebDAVFileIndex | null = null;
	private _debugLog: (message: string, data?: any) => void = () => {};
	private _symbolCache = new Map<string, PHPSymbol[]>();
	private _fileContentCache = new Map<string, string>();
	private _fileSystemProvider: any = null;
	private _parser: any;

	constructor() {
		// Initialize PHP parser with modern PHP support
		this._parser = new Engine({
			parser: {
				extractDoc: true,
				php7: true,
				shortTags: true,
				aspTags: false,
				extractTokens: false
			},
			ast: {
				withPositions: true,
				withSource: false
			}
		});
	}

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

	/**
	 * Normalizes file paths for URI creation, handling virtual file prefixes
	 */
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
		this._debugLog('PHP AST definition requested', {
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
		const wordText = document.getText(wordRange);

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
				if (/^[A-Z_][A-Z0-9_]*$/.test(wordText)) {
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
		if (beforeWord.includes('$') || wordText.startsWith('$')) {
			return { type: 'variable', isStatic: false };
		}

		// Constant (all uppercase with underscores)
		if (/^[A-Z_][A-Z0-9_]*$/.test(wordText)) {
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
		const currentFileSymbols = await this.parseFileSymbolsAST(currentDocument.uri.path, currentFileContent);
		
		this._debugLog('Current file symbols parsed with AST', { 
			filePath: currentDocument.uri.path,
			totalSymbols: currentFileSymbols.length,
			symbolNames: currentFileSymbols.map(s => `${s.name}(${s.type})`)
		});

		const localDefinitions = currentFileSymbols.filter(symbol => 
			symbol.name === symbolName && this.matchesContext(symbol, context)
		);
		
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
			
			const allPhpFiles = await this.getAllPhpFiles();
			
			for (const filePath of allPhpFiles) {
				if (filePath === currentDocument.uri.path) {
					continue; // Already checked
				}

				try {
					const fileContent = await this.getFileContent(vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`));
					const fileSymbols = await this.parseFileSymbolsAST(filePath, fileContent);
					
					const matchingSymbols = fileSymbols.filter(symbol => 
						symbol.name === symbolName && this.matchesContext(symbol, context)
					);
					definitions.push(...matchingSymbols);
					
				} catch (error: any) {
					this._debugLog('Error parsing file for symbols', { filePath, error: error.message });
				}
			}
		} else {
			this._debugLog('Found local definitions, skipping project search', { count: definitions.length });
		}

		return definitions;
	}

	private matchesContext(symbol: PHPSymbol, context: any): boolean {
		this._debugLog('Matching context', {
			symbolName: symbol.name,
			symbolType: symbol.type,
			contextType: context.type,
			contextClassName: context.className,
			symbolClassName: symbol.className
		});

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

	private async parseFileSymbolsAST(filePath: string, content: string): Promise<PHPSymbol[]> {
		// Check cache first
		const cacheKey = `${filePath}:${content.length}:${this.getContentHash(content)}`;
		if (this._symbolCache.has(cacheKey)) {
			return this._symbolCache.get(cacheKey)!;
		}

		const symbols: PHPSymbol[] = [];

		try {
			this._debugLog('Parsing PHP file with AST', { filePath, contentLength: content.length });

			// Parse the PHP code into an AST
			const ast = this._parser.parseCode(content);
			
			this._debugLog('AST parsed successfully', { 
				filePath, 
				astType: ast.kind,
				childrenCount: ast.children?.length || 0 
			});

			// Extract symbols from the AST
			this.extractSymbolsFromAST(ast, symbols, filePath);

		} catch (error: any) {
			this._debugLog('Error parsing PHP with AST', { filePath, error: error.message });
			// Fallback to regex parsing in case of parse errors
			return this.fallbackRegexParsing(filePath, content);
		}

		// Cache the results
		this._symbolCache.set(cacheKey, symbols);
		this._debugLog('Parsed file symbols with AST', { filePath, symbolCount: symbols.length });

		return symbols;
	}

	private extractSymbolsFromAST(node: any, symbols: PHPSymbol[], filePath: string, namespace?: string, className?: string): void {
		if (!node) return;

		try {
			switch (node.kind) {
				case 'namespace':
					const namespaceName = this.getNodeName(node.name);
					if (node.children) {
						node.children.forEach((child: any) => 
							this.extractSymbolsFromAST(child, symbols, filePath, namespaceName, className)
						);
					}
					break;

				case 'class':
				case 'interface':
				case 'trait':
					const classOrInterfaceName = node.name?.name || node.name;
					if (classOrInterfaceName && node.loc) {
						symbols.push({
							name: classOrInterfaceName,
							type: 'class',
							location: new vscode.Location(
								vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`),
								new vscode.Position(node.loc.start.line - 1, node.loc.start.column)
							),
							namespace
						});
					}

					// Parse class members
					if (node.body) {
						node.body.forEach((member: any) => 
							this.extractSymbolsFromAST(member, symbols, filePath, namespace, classOrInterfaceName)
						);
					}
					break;

				case 'function':
					const functionName = node.name?.name || node.name;
					if (functionName && node.loc) {
						symbols.push({
							name: functionName,
							type: className ? 'method' : 'function',
							location: new vscode.Location(
								vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`),
								new vscode.Position(node.loc.start.line - 1, node.loc.start.column)
							),
							namespace,
							className,
							visibility: node.visibility || 'public',
							isStatic: node.isStatic || false,
							parameters: this.extractParameters(node.arguments)
						});
					}
					break;

				case 'method':
					const methodName = node.name?.name || node.name;
					if (methodName && node.loc) {
						symbols.push({
							name: methodName,
							type: 'method',
							location: new vscode.Location(
								vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`),
								new vscode.Position(node.loc.start.line - 1, node.loc.start.column)
							),
							namespace,
							className,
							visibility: node.visibility || 'public',
							isStatic: node.isStatic || false,
							parameters: this.extractParameters(node.arguments)
						});
					}
					break;

				case 'property':
					if (node.properties && className) {
						node.properties.forEach((prop: any) => {
							const propName = prop.name?.name || prop.name;
							if (propName && node.loc) {
								symbols.push({
									name: propName,
									type: 'property',
									location: new vscode.Location(
										vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`),
										new vscode.Position(node.loc.start.line - 1, node.loc.start.column)
									),
									namespace,
									className,
									visibility: node.visibility || 'public',
									isStatic: node.isStatic || false
								});
							}
						});
					}
					break;

				case 'constant':
					const constantName = node.name?.name || node.name;
					if (constantName && node.loc) {
						symbols.push({
							name: constantName,
							type: 'constant',
							location: new vscode.Location(
								vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`),
								new vscode.Position(node.loc.start.line - 1, node.loc.start.column)
							),
							namespace,
							className
						});
					}
					break;

				default:
					// Recursively process child nodes
					if (node.children) {
						node.children.forEach((child: any) => 
							this.extractSymbolsFromAST(child, symbols, filePath, namespace, className)
						);
					}
					if (node.body && Array.isArray(node.body)) {
						node.body.forEach((child: any) => 
							this.extractSymbolsFromAST(child, symbols, filePath, namespace, className)
						);
					}
					break;
			}
		} catch (error: any) {
			this._debugLog('Error extracting symbol from AST node', { 
				nodeKind: node.kind, 
				error: error.message 
			});
		}
	}

	private getNodeName(nameNode: any): string {
		if (typeof nameNode === 'string') {
			return nameNode;
		}
		if (nameNode && nameNode.name) {
			return nameNode.name;
		}
		if (nameNode && nameNode.parts) {
			return nameNode.parts.join('\\');
		}
		return '';
	}

	private extractParameters(args: any[]): Array<{name: string, type?: string, defaultValue?: any}> {
		if (!args || !Array.isArray(args)) {
			return [];
		}

		return args.map(arg => ({
			name: arg.name?.name || arg.name || '',
			type: arg.type?.name || undefined,
			defaultValue: arg.value || undefined
		}));
	}

	private async fallbackRegexParsing(filePath: string, content: string): Promise<PHPSymbol[]> {
		this._debugLog('Using fallback regex parsing', { filePath });
		
		// Use the original regex-based parsing as fallback
		const symbols: PHPSymbol[] = [];
		const lines = content.split('\n');
		let currentNamespace = '';
		let currentClass = '';
		let inPhpTag = false;

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex].trim();
			
			if (line.includes('<?php') || line.includes('<?=')) {
				inPhpTag = true;
				continue;
			}
			if (!inPhpTag) continue;
			if (line.includes('?>')) {
				inPhpTag = false;
				continue;
			}

			try {
				// Namespace
				const namespaceMatch = line.match(/^namespace\s+([^;]+);/);
				if (namespaceMatch) {
					currentNamespace = namespaceMatch[1].trim();
					continue;
				}

				// Class/interface/trait
				const classMatch = line.match(/^(?:abstract\s+)?(?:final\s+)?(class|interface|trait)\s+(\w+)/);
				if (classMatch) {
					currentClass = classMatch[2];
					symbols.push({
						name: currentClass,
						type: 'class',
						location: new vscode.Location(
							vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`),
							new vscode.Position(lineIndex, line.indexOf(currentClass))
						),
						namespace: currentNamespace || undefined
					});
					continue;
				}

				// Function
				const functionMatch = line.match(/(?:^|\s+)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+(\w+)/);
				if (functionMatch) {
					const functionName = functionMatch[1];
					symbols.push({
						name: functionName,
						type: currentClass ? 'method' : 'function',
						location: new vscode.Location(
							vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`),
							new vscode.Position(lineIndex, line.indexOf('function ' + functionName) + 9)
						),
						namespace: currentNamespace || undefined,
						className: currentClass || undefined
					});
				}
			} catch (error: any) {
				// Continue parsing even if one line fails
			}
		}

		return symbols;
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
			const uri = vscode.Uri.parse(`webdav:${this.normalizeFilePathForUri(filePath)}`);
			const content = await this.getFileContent(uri);
			return await this.parseFileSymbolsAST(filePath, content);
		} catch (error: any) {
			this._debugLog('Error getting symbols in file', { filePath, error: error.message });
			return [];
		}
	}
}