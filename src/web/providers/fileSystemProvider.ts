import * as vscode from 'vscode';
import { WebDAVFileSystemProvider } from './webdavFileSystemProvider';

export class PlaceholderFileSystemProvider implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _realProviders: Map<string, WebDAVFileSystemProvider> = new Map();
	private _debugLog: (message: string, data?: any) => void;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	constructor(debugLog: (message: string, data?: any) => void) {
		this._debugLog = debugLog;
	}

	setRealProvider(provider: WebDAVFileSystemProvider | null) {
		// Maintain backward compatibility - set as default provider for root path
		if (provider) {
			this._realProviders.set('', provider);
			this._debugLog('PlaceholderProvider: Default real provider set', { hasProvider: !!provider });
		} else {
			this._realProviders.clear();
			this._debugLog('PlaceholderProvider: All providers cleared');
		}
	}

	setRealProviderForProject(projectName: string, provider: WebDAVFileSystemProvider | null) {
		if (provider) {
			this._realProviders.set(projectName, provider);
			this._debugLog('PlaceholderProvider: Real provider set for project', { project: projectName, hasProvider: !!provider });
		} else {
			this._realProviders.delete(projectName);
			this._debugLog('PlaceholderProvider: Real provider removed for project', { project: projectName });
		}
	}

	getRealProvider(): WebDAVFileSystemProvider | null {
		// Return default provider for backward compatibility
		return this._realProviders.get('') || null;
	}

	private getRealProviderForUri(uri: vscode.Uri): { provider: WebDAVFileSystemProvider | null, adjustedUri: vscode.Uri } {
		// Extract project name from URI path (e.g., webdav:/project1/file.php -> project1)
		const path = uri.path;
		if (path.startsWith('/')) {
			const segments = path.substring(1).split('/');
			const projectName = segments[0];
			
			if (projectName && this._realProviders.has(projectName)) {
				// Create adjusted URI without the project prefix for the provider
				// webdav:/project1/file.php -> webdav:/file.php
				// webdav:/project1 -> webdav:/
				const remainingSegments = segments.slice(1);
				const adjustedPath = remainingSegments.length > 0 ? '/' + remainingSegments.join('/') : '/';
				const adjustedUri = uri.with({ path: adjustedPath });
				
				this._debugLog('URI routing', {
					original: uri.toString(),
					adjusted: adjustedUri.toString(),
					project: projectName,
					originalPath: path,
					adjustedPath: adjustedPath,
					segmentCount: segments.length
				});
				
				return { provider: this._realProviders.get(projectName)!, adjustedUri };
			}
		}
		
		// Fallback to default provider (empty string key) with original URI
		const defaultProvider = this._realProviders.get('') || null;
		return { provider: defaultProvider, adjustedUri: uri };
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
		const { provider, adjustedUri } = this.getRealProviderForUri(uri);
		if (provider) {
			return provider.watch(adjustedUri, options);
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
		
		const { provider, adjustedUri } = this.getRealProviderForUri(correctedUri);
		if (provider) {
			return provider.stat(adjustedUri);
		}
		this._debugLog('PlaceholderProvider: stat() called but no provider found', { uri: correctedUri.toString() });
		const errorMsg = `No file system handle registered for ${correctedUri.toString()}`;
		throw vscode.FileSystemError.Unavailable(errorMsg);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const { provider, adjustedUri } = this.getRealProviderForUri(uri);
		if (provider) {
			return provider.readDirectory(adjustedUri);
		}
		this._debugLog('PlaceholderProvider: readDirectory() called but no provider found', { uri: uri.toString() });
		const errorMsg = `No file system handle registered for ${uri.toString()}`;
		throw vscode.FileSystemError.Unavailable(errorMsg);
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		const { provider, adjustedUri } = this.getRealProviderForUri(uri);
		if (provider) {
			return provider.createDirectory(adjustedUri);
		}
		throw vscode.FileSystemError.Unavailable(`No WebDAV provider found for ${uri.toString()}`);
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
		
		const { provider, adjustedUri } = this.getRealProviderForUri(correctedUri);
		if (provider) {
			return provider.readFile(adjustedUri);
		}
		this._debugLog('PlaceholderProvider: readFile() called but no provider found', { uri: correctedUri.toString() });
		const errorMsg = `No file system handle registered for ${correctedUri.toString()}`;
		throw vscode.FileSystemError.Unavailable(errorMsg);
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
		const { provider, adjustedUri } = this.getRealProviderForUri(uri);
		if (provider) {
			return provider.writeFile(adjustedUri, content, options);
		}
		throw vscode.FileSystemError.Unavailable(`No WebDAV provider found for ${uri.toString()}`);
	}

	async delete(uri: vscode.Uri, options: { recursive: boolean; }): Promise<void> {
		const { provider, adjustedUri } = this.getRealProviderForUri(uri);
		if (provider) {
			return provider.delete(adjustedUri, options);
		}
		throw vscode.FileSystemError.Unavailable(`No WebDAV provider found for ${uri.toString()}`);
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void> {
		const { provider, adjustedUri: adjustedOldUri } = this.getRealProviderForUri(oldUri);
		if (provider) {
			const { adjustedUri: adjustedNewUri } = this.getRealProviderForUri(newUri);
			return provider.rename(adjustedOldUri, adjustedNewUri, options);
		}
		throw vscode.FileSystemError.Unavailable(`No WebDAV provider found for ${oldUri.toString()}`);
	}
}