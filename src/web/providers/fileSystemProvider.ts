import * as vscode from 'vscode';
import { WebDAVFileSystemProvider } from './webdavFileSystemProvider';

export class PlaceholderFileSystemProvider implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _realProvider: WebDAVFileSystemProvider | null = null;
	private _debugLog: (message: string, data?: any) => void;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	constructor(debugLog: (message: string, data?: any) => void) {
		this._debugLog = debugLog;
	}

	setRealProvider(provider: WebDAVFileSystemProvider | null) {
		this._realProvider = provider;
		this._debugLog('PlaceholderProvider: Real provider set', { hasProvider: !!provider });
	}

	getRealProvider(): WebDAVFileSystemProvider | null {
		return this._realProvider;
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		if (this._realProvider) {
			return this._realProvider.watch(uri, options);
		}
		return new vscode.Disposable(() => {});
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		// Handle malformed URIs with extra leading slash
		let correctedUri = uri;
		if (uri.toString().startsWith('/webdav:')) {
			// Fix malformed URI by removing leading slash
			const correctedUriString = uri.toString().substring(1);
			correctedUri = vscode.Uri.parse(correctedUriString);
			this._debugLog('Fixed malformed URI with leading slash', {
				original: uri.toString(),
				corrected: correctedUri.toString()
			});
		}
		
		if (this._realProvider) {
			return this._realProvider.stat(correctedUri);
		}
		this._debugLog('PlaceholderProvider: stat() called but not connected', { uri: correctedUri.toString() });
		const errorMsg = `No file system handle registered (${correctedUri.scheme}://)`;
		throw vscode.FileSystemError.Unavailable(errorMsg);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		if (this._realProvider) {
			return this._realProvider.readDirectory(uri);
		}
		this._debugLog('PlaceholderProvider: readDirectory() called but not connected', { uri: uri.toString() });
		const errorMsg = `No file system handle registered (${uri.scheme}://)`;
		throw vscode.FileSystemError.Unavailable(errorMsg);
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.createDirectory(uri);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		// Handle malformed URIs with extra leading slash
		let correctedUri = uri;
		if (uri.toString().startsWith('/webdav:')) {
			// Fix malformed URI by removing leading slash
			const correctedUriString = uri.toString().substring(1);
			correctedUri = vscode.Uri.parse(correctedUriString);
			this._debugLog('Fixed malformed URI with leading slash', {
				original: uri.toString(),
				corrected: correctedUri.toString()
			});
		}
		
		if (this._realProvider) {
			return this._realProvider.readFile(correctedUri);
		}
		this._debugLog('PlaceholderProvider: readFile() called but not connected', { uri: correctedUri.toString() });
		const errorMsg = `No file system handle registered (${correctedUri.scheme}://)`;
		throw vscode.FileSystemError.Unavailable(errorMsg);
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.writeFile(uri, content, options);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.delete(uri, options);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
		if (this._realProvider) {
			return this._realProvider.rename(oldUri, newUri, options);
		}
		throw vscode.FileSystemError.Unavailable('Not connected to WebDAV server');
	}
}