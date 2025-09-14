/**
 * HTTP/HTTPS WebDAV Protocol Implementation
 * 
 * Wraps the existing WebDAVApi to provide a consistent interface
 */

import { WebDAVCredentials, WebDAVFileItem } from '../types';
import { WebDAVApi, WebDAVDirectoryResponse, WebDAVFileResponse, WebDAVOperationResponse } from './webdavApi';
import { WebDAVProtocolInterface } from './webdavProtocol';

export class WebDAVHttpProtocol implements WebDAVProtocolInterface {
	private webdavApi: WebDAVApi | null = null;
	private debugLog: (message: string, data?: any) => void;

	constructor(debugLog: (message: string, data?: any) => void = () => {}) {
		this.debugLog = debugLog;
	}

	async initialize(credentials: WebDAVCredentials): Promise<boolean> {
		try {
			this.webdavApi = new WebDAVApi(credentials, this.debugLog);
			this.debugLog('HTTP WebDAV Protocol initialized', {
				url: credentials.url,
				hasProject: !!credentials.project
			});
			return true;
		} catch (error: any) {
			this.debugLog('Failed to initialize HTTP WebDAV Protocol', { error: error.message });
			return false;
		}
	}

	async testConnection(): Promise<boolean> {
		try {
			if (!this.webdavApi) {
				return false;
			}
			
			const result = await this.webdavApi.getDirectoryListing('/');
			return result.success;
		} catch (error: any) {
			this.debugLog('HTTP WebDAV connection test failed', { error: error.message });
			return false;
		}
	}

	async getDirectoryListing(path: string): Promise<WebDAVDirectoryResponse> {
		if (!this.webdavApi) {
			return {
				items: [],
				success: false,
				error: 'WebDAV API not initialized'
			};
		}

		return await this.webdavApi.getDirectoryListing(path);
	}

	async readFile(path: string): Promise<WebDAVFileResponse> {
		if (!this.webdavApi) {
			return {
				content: new Uint8Array(),
				headers: {},
				success: false,
				error: 'WebDAV API not initialized'
			};
		}

		return await this.webdavApi.readFile(path);
	}

	async writeFile(path: string, content: Uint8Array): Promise<WebDAVOperationResponse> {
		if (!this.webdavApi) {
			return {
				success: false,
				error: 'WebDAV API not initialized'
			};
		}

		// Note: WebDAVApi.createFile expects different parameters
		// Extract filename and directory from path
		const pathParts = path.split('/');
		const fileName = pathParts.pop() || '';
		const dirPath = pathParts.join('/');
		return await this.webdavApi.createFile(fileName, new TextDecoder().decode(content), dirPath);
	}

	async createDirectory(path: string): Promise<WebDAVOperationResponse> {
		if (!this.webdavApi) {
			return {
				success: false,
				error: 'WebDAV API not initialized'
			};
		}

		// Extract folder name and directory from path
		const pathParts = path.split('/');
		const folderName = pathParts.pop() || '';
		const dirPath = pathParts.join('/');
		return await this.webdavApi.createDirectory(folderName, dirPath);
	}

	async delete(path: string): Promise<WebDAVOperationResponse> {
		if (!this.webdavApi) {
			return {
				success: false,
				error: 'WebDAV API not initialized'
			};
		}

		// Extract item name and directory from path
		const pathParts = path.split('/');
		const itemName = pathParts.pop() || '';
		const dirPath = pathParts.join('/');
		return await this.webdavApi.deleteItem(itemName, dirPath);
	}

	async move(sourcePath: string, destinationPath: string): Promise<WebDAVOperationResponse> {
		if (!this.webdavApi) {
			return {
				success: false,
				error: 'WebDAV API not initialized'
			};
		}

		// Extract current name and new name from paths
		const sourcePathParts = sourcePath.split('/');
		const currentName = sourcePathParts.pop() || '';
		const dirPath = sourcePathParts.join('/');
		const newName = destinationPath.split('/').pop() || '';
		return await this.webdavApi.renameItem(currentName, newName, dirPath);
	}

	async copy(sourcePath: string, destinationPath: string): Promise<WebDAVOperationResponse> {
		if (!this.webdavApi) {
			return {
				success: false,
				error: 'WebDAV API not initialized'
			};
		}

		// WebDAVApi doesn't have copyFile, simulate with read + write
		const readResult = await this.webdavApi.readFile(sourcePath);
		if (!readResult.success) {
			return {
				success: false,
				error: readResult.error || 'Failed to read source file'
			};
		}
		
		const pathParts = destinationPath.split('/');
		const fileName = pathParts.pop() || '';
		const dirPath = pathParts.join('/');
		return await this.webdavApi.createFile(fileName, new TextDecoder().decode(readResult.content), dirPath);
	}

	async getProperties(path: string): Promise<WebDAVFileItem | null> {
		if (!this.webdavApi) {
			return null;
		}

		const result = await this.webdavApi.getDirectoryListing(path);
		if (result.success && result.items.length > 0) {
			// Return the first item that matches the exact path
			const item = result.items.find(item => item.path === path || item.name === path.split('/').pop());
			return item || null;
		}
		
		return null;
	}
}