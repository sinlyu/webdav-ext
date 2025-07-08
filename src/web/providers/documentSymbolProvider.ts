import * as vscode from 'vscode';

export class WebDAVDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
	private _debugLog: (message: string, data?: any) => void = () => {};

	setDebugLogger(logger: (message: string, data?: any) => void) {
		this._debugLog = logger;
	}

	async provideDocumentSymbols(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentSymbol[]> {
		if (document.uri.scheme !== 'webdav') {
			return [];
		}

		this._debugLog('DocumentSymbolProvider: Analyzing document', { 
			uri: document.uri.toString(),
			languageId: document.languageId,
			lineCount: document.lineCount
		});

		const symbols: vscode.DocumentSymbol[] = [];

		try {
			// Handle different file types
			switch (document.languageId) {
				case 'php':
					return this.extractPhpSymbols(document, token);
				case 'javascript':
				case 'typescript':
					return this.extractJsSymbols(document, token);
				case 'json':
					return this.extractJsonSymbols(document, token);
				default:
					// For other file types, provide basic structure
					return this.extractGenericSymbols(document, token);
			}
		} catch (error: any) {
			this._debugLog('DocumentSymbolProvider: Error extracting symbols', { 
				uri: document.uri.toString(),
				error: error.message 
			});
			return [];
		}
	}

	private extractPhpSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
		const symbols: vscode.DocumentSymbol[] = [];
		const text = document.getText();
		const lines = text.split('\n');

		let currentClass: vscode.DocumentSymbol | null = null;
		let currentFunction: vscode.DocumentSymbol | null = null;
		let braceDepth = 0;
		let classStartBrace = -1;
		let functionStartBrace = -1;

		for (let i = 0; i < lines.length; i++) {
			if (token.isCancellationRequested) {
				break;
			}

			const line = lines[i];
			const trimmedLine = line.trim();

			// Track brace depth for determining scope
			for (const char of line) {
				if (char === '{') {
					braceDepth++;
				} else if (char === '}') {
					braceDepth--;
					
					// Check if we're closing a class
					if (currentClass && braceDepth === classStartBrace) {
						currentClass.range = new vscode.Range(
							currentClass.range.start,
							new vscode.Position(i, line.length)
						);
						currentClass.selectionRange = new vscode.Range(
							currentClass.selectionRange.start,
							new vscode.Position(i, line.length)
						);
						symbols.push(currentClass);
						currentClass = null;
						classStartBrace = -1;
					}
					
					// Check if we're closing a function
					if (currentFunction && braceDepth === functionStartBrace) {
						currentFunction.range = new vscode.Range(
							currentFunction.range.start,
							new vscode.Position(i, line.length)
						);
						currentFunction.selectionRange = new vscode.Range(
							currentFunction.selectionRange.start,
							new vscode.Position(i, line.length)
						);
						
						if (currentClass) {
							currentClass.children.push(currentFunction);
						} else {
							symbols.push(currentFunction);
						}
						currentFunction = null;
						functionStartBrace = -1;
					}
				}
			}

			// Namespace
			const namespaceMatch = trimmedLine.match(/^namespace\s+([^;]+)/i);
			if (namespaceMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					namespaceMatch[1],
					'',
					vscode.SymbolKind.Namespace,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Class definition
			const classMatch = trimmedLine.match(/^(?:abstract\s+|final\s+)?class\s+(\w+)/i);
			if (classMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				currentClass = new vscode.DocumentSymbol(
					classMatch[1],
					'',
					vscode.SymbolKind.Class,
					range,
					range
				);
				classStartBrace = braceDepth;
			}

			// Interface definition
			const interfaceMatch = trimmedLine.match(/^interface\s+(\w+)/i);
			if (interfaceMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					interfaceMatch[1],
					'',
					vscode.SymbolKind.Interface,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Trait definition
			const traitMatch = trimmedLine.match(/^trait\s+(\w+)/i);
			if (traitMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					traitMatch[1],
					'',
					vscode.SymbolKind.Module,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Function/Method definition
			const functionMatch = trimmedLine.match(/^(?:public|private|protected|static|\s)*function\s+(\w+)/i);
			if (functionMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				currentFunction = new vscode.DocumentSymbol(
					functionMatch[1],
					'',
					currentClass ? vscode.SymbolKind.Method : vscode.SymbolKind.Function,
					range,
					range
				);
				functionStartBrace = braceDepth;
			}

			// Constants
			const constantMatch = trimmedLine.match(/^(?:public|private|protected)?\s*const\s+(\w+)/i);
			if (constantMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					constantMatch[1],
					'',
					vscode.SymbolKind.Constant,
					range,
					range
				);
				
				if (currentClass) {
					currentClass.children.push(symbol);
				} else {
					symbols.push(symbol);
				}
			}

			// Properties
			const propertyMatch = trimmedLine.match(/^(?:public|private|protected)?\s*\$(\w+)/i);
			if (propertyMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					'$' + propertyMatch[1],
					'',
					vscode.SymbolKind.Property,
					range,
					range
				);
				
				if (currentClass) {
					currentClass.children.push(symbol);
				} else {
					symbols.push(symbol);
				}
			}
		}

		// Add any remaining open class
		if (currentClass) {
			symbols.push(currentClass);
		}

		this._debugLog('DocumentSymbolProvider: Extracted PHP symbols', { 
			symbolCount: symbols.length,
			symbols: symbols.map(s => ({ name: s.name, kind: s.kind }))
		});

		return symbols;
	}

	private extractJsSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
		const symbols: vscode.DocumentSymbol[] = [];
		const text = document.getText();
		const lines = text.split('\n');

		for (let i = 0; i < lines.length; i++) {
			if (token.isCancellationRequested) {
				break;
			}

			const line = lines[i];
			const trimmedLine = line.trim();

			// Function declarations
			const functionMatch = trimmedLine.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/i);
			if (functionMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					functionMatch[1],
					'',
					vscode.SymbolKind.Function,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Arrow functions
			const arrowMatch = trimmedLine.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/i);
			if (arrowMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					arrowMatch[1],
					'',
					vscode.SymbolKind.Function,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Class declarations
			const classMatch = trimmedLine.match(/^(?:export\s+)?class\s+(\w+)/i);
			if (classMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					classMatch[1],
					'',
					vscode.SymbolKind.Class,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Variable declarations
			const variableMatch = trimmedLine.match(/^(?:const|let|var)\s+(\w+)/i);
			if (variableMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					variableMatch[1],
					'',
					vscode.SymbolKind.Variable,
					range,
					range
				);
				symbols.push(symbol);
			}
		}

		return symbols;
	}

	private extractJsonSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
		const symbols: vscode.DocumentSymbol[] = [];

		try {
			const text = document.getText();
			const json = JSON.parse(text);
			
			this.extractJsonObjectSymbols(json, symbols, document, '', 0);
		} catch (error: any) {
			this._debugLog('DocumentSymbolProvider: Error parsing JSON', { error: error.message });
		}

		return symbols;
	}

	private extractJsonObjectSymbols(
		obj: any, 
		symbols: vscode.DocumentSymbol[], 
		document: vscode.TextDocument, 
		parentKey: string, 
		depth: number
	): void {
		if (depth > 3) {return;} // Prevent infinite recursion

		for (const key in obj) {
			const value = obj[key];
			const fullKey = parentKey ? `${parentKey}.${key}` : key;
			
			// Find the position of this key in the document
			const keyPosition = this.findJsonKeyPosition(document, key);
			const range = new vscode.Range(keyPosition, keyPosition);
			
			let symbolKind = vscode.SymbolKind.Property;
			if (typeof value === 'object' && value !== null) {
				symbolKind = Array.isArray(value) ? vscode.SymbolKind.Array : vscode.SymbolKind.Object;
			} else if (typeof value === 'function') {
				symbolKind = vscode.SymbolKind.Function;
			} else if (typeof value === 'string') {
				symbolKind = vscode.SymbolKind.String;
			} else if (typeof value === 'number') {
				symbolKind = vscode.SymbolKind.Number;
			} else if (typeof value === 'boolean') {
				symbolKind = vscode.SymbolKind.Boolean;
			}

			const symbol = new vscode.DocumentSymbol(
				key,
				typeof value === 'string' ? value : '',
				symbolKind,
				range,
				range
			);

			// Recursively add child symbols for objects
			if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
				this.extractJsonObjectSymbols(value, symbol.children, document, fullKey, depth + 1);
			}

			symbols.push(symbol);
		}
	}

	private findJsonKeyPosition(document: vscode.TextDocument, key: string): vscode.Position {
		const text = document.getText();
		const keyPattern = new RegExp(`"${key}"\\s*:`, 'g');
		const match = keyPattern.exec(text);
		
		if (match) {
			const position = document.positionAt(match.index);
			return position;
		}
		
		return new vscode.Position(0, 0);
	}

	private extractGenericSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
		const symbols: vscode.DocumentSymbol[] = [];
		const text = document.getText();
		const lines = text.split('\n');

		for (let i = 0; i < lines.length; i++) {
			if (token.isCancellationRequested) {
				break;
			}

			const line = lines[i];
			const trimmedLine = line.trim();

			// Look for lines that might be headers or important sections
			// Headers with # (Markdown style)
			const headerMatch = trimmedLine.match(/^#+\s*(.+)/);
			if (headerMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					headerMatch[1],
					'',
					vscode.SymbolKind.String,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Lines with all caps (potential constants or sections)
			const capsMatch = trimmedLine.match(/^([A-Z_][A-Z0-9_]*)\s*[:=]/);
			if (capsMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					capsMatch[1],
					'',
					vscode.SymbolKind.Constant,
					range,
					range
				);
				symbols.push(symbol);
			}
		}

		return symbols;
	}
}