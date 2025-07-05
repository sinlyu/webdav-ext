import * as vscode from 'vscode';
import { WebDAVCredentials } from '../types';
import { WebDAVFileIndex } from '../core/fileIndex';

export interface PHPSymbol {
	name: string;
	type: 'function' | 'class' | 'method' | 'property' | 'constant' | 'variable';
	location: vscode.Location;
	namespace?: string;
	className?: string;
	visibility?: 'public' | 'private' | 'protected';
	isStatic?: boolean;
	returnType?: string;
	parameters?: Array<{name: string, type?: string, defaultValue?: any}>;
}

export interface IPHPDefinitionProvider extends vscode.DefinitionProvider {
	setCredentials(credentials: WebDAVCredentials | null): void;
	setFileIndex(fileIndex: WebDAVFileIndex | null): void;
	setDebugLogger(logger: (message: string, data?: any) => void): void;
	setFileSystemProvider(fsProvider: any): void;
	clearAllCaches(): void;
	getSymbolsInFile(filePath: string): Promise<PHPSymbol[]>;
}