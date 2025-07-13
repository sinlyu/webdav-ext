import { WebDAVCredentials, WebDAVFileItem } from '../types';
import { parseDirectoryHTML } from '../utils/htmlUtils';
import { getFetchMode } from '../utils/platformUtils';

export interface WebDAVRequestOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string | FormData;
	timeout?: number;
}

export interface WebDAVDirectoryResponse {
	items: WebDAVFileItem[];
	success: boolean;
	error?: string;
}

export interface WebDAVFileResponse {
	content: Uint8Array;
	headers: Record<string, string>;
	success: boolean;
	error?: string;
}

export interface WebDAVOperationResponse {
	success: boolean;
	error?: string;
	statusCode?: number;
}

export class WebDAVApi {
	private readonly credentials: WebDAVCredentials;
	private readonly debugLog: (message: string, data?: any) => void;
	private readonly baseHeaders: Record<string, string>;
	private readonly baseUrl: string;

	constructor(credentials: WebDAVCredentials, debugLog: (message: string, data?: any) => void = () => {}) {
		this.credentials = credentials;
		this.debugLog = debugLog;
		this.baseHeaders = {
			'Authorization': `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
			'User-Agent': 'VSCode-WebDAV-Extension'
		};
		this.baseUrl = `${credentials.url}/apps/remote/${credentials.project || ''}`;
	}

	/**
	 * Builds the complete URL for a given path
	 */
	private buildUrl(path: string, addCacheBuster: boolean = false): string {
		// Normalize the path - remove leading slash and clean up multiple slashes
		let cleanPath = path.replace(/^\/+/, '').replace(/\/+/g, '/');
		// Remove trailing slash except for empty path
		if (cleanPath.endsWith('/') && cleanPath.length > 1) {
			cleanPath = cleanPath.slice(0, -1);
		}
		let url = cleanPath ? `${this.baseUrl}/${cleanPath}` : `${this.baseUrl}/`;
		
		// Add cache buster timestamp for file reads to prevent browser caching
		if (addCacheBuster) {
			const separator = url.includes('?') ? '&' : '?';
			url += `${separator}_cb=${Date.now()}`;
		}
		
		this.debugLog('Built URL', { originalPath: path, cleanPath, url, cacheBuster: addCacheBuster });
		return url;
	}

	/**
	 * Merges base headers with custom headers
	 */
	private mergeHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
		return { ...this.baseHeaders, ...customHeaders };
	}

	/**
	 * Makes a generic HTTP request to WebDAV server
	 */
	private async makeRequest(
		url: string, 
		options: WebDAVRequestOptions = {}
	): Promise<Response> {
		const {
			method = 'GET',
			headers = {},
			body,
			timeout = 30000
		} = options;

		const requestOptions: RequestInit = {
			method,
			headers: this.mergeHeaders(headers),
			mode: getFetchMode(),
			credentials: 'include'
		};

		if (body) {
			requestOptions.body = body;
		}

		this.debugLog('Making WebDAV request', {
			url,
			method,
			headers: Object.keys(requestOptions.headers || {}),
			hasBody: !!body
		});

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		try {
			const response = await fetch(url, {
				...requestOptions,
				signal: controller.signal
			});

			clearTimeout(timeoutId);
			this.debugLog('WebDAV request completed', {
				url,
				status: response.status,
				statusText: response.statusText,
				ok: response.ok
			});

			return response;
		} catch (error: any) {
			clearTimeout(timeoutId);
			this.debugLog('WebDAV request failed', {
				url,
				error: error.message,
				name: error.name
			});
			throw error;
		}
	}

	/**
	 * Gets directory listing from WebDAV server
	 */
	async getDirectoryListing(path: string): Promise<WebDAVDirectoryResponse> {
		try {
			const url = this.buildUrl(path, true); // Add cache buster for directory listings
			const response = await this.makeRequest(url, {
				headers: {
					'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				}
			});

			if (!response.ok) {
				return {
					items: [],
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}`
				};
			}

			const html = await response.text();
			const items = parseDirectoryHTML(html);
			
			this.debugLog('Directory listing retrieved', { 
				path, 
				itemCount: items.length,
				items: items.map(item => ({ name: item.name, isDirectory: item.isDirectory }))
			});

			return {
				items,
				success: true
			};
		} catch (error: any) {
			this.debugLog('Error getting directory listing', { path, error: error.message });
			return {
				items: [],
				success: false,
				error: error.message
			};
		}
	}

	/**
	 * Reads file content from WebDAV server
	 */
	async readFile(path: string): Promise<WebDAVFileResponse> {
		try {
			const url = this.buildUrl(path, true); // Add cache buster for file reads
			const response = await this.makeRequest(url, {
				headers: {
					'Accept': '*/*',
					'Cache-Control': 'no-cache, no-store, must-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				}
			});

			if (!response.ok) {
				return {
					content: new Uint8Array(0),
					headers: {},
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}`
				};
			}

			const arrayBuffer = await response.arrayBuffer();
			const content = new Uint8Array(arrayBuffer);
			
			// Extract relevant headers
			const headers: Record<string, string> = {};
			const headerNames = ['etag', 'content-type', 'last-modified', 'content-length'];
			
			for (const headerName of headerNames) {
				const value = response.headers.get(headerName);
				if (value) {
					headers[headerName] = value;
				}
			}

			this.debugLog('File content retrieved', { 
				path, 
				size: content.length,
				headers: Object.keys(headers)
			});

			return {
				content,
				headers,
				success: true
			};
		} catch (error: any) {
			this.debugLog('Error reading file', { path, error: error.message });
			return {
				content: new Uint8Array(0),
				headers: {},
				success: false,
				error: error.message
			};
		}
	}

	/**
	 * Creates a new file on WebDAV server
	 */
	async createFile(fileName: string, content: string, dirPath: string = ''): Promise<WebDAVOperationResponse> {
		try {
			const url = this.buildUrl(dirPath);
			const formData = new FormData();
			formData.append('sabreAction', 'put');
			formData.append('name', fileName);
			
			const blob = new Blob([content], { type: 'application/octet-stream' });
			formData.append('file', blob, fileName);

			const response = await this.makeRequest(url, {
				method: 'POST',
				body: formData
			});

			const success = response.ok;
			this.debugLog('File creation result', { 
				fileName, 
				dirPath, 
				success, 
				status: response.status 
			});

			return {
				success,
				error: success ? undefined : `HTTP ${response.status}: ${response.statusText}`,
				statusCode: response.status
			};
		} catch (error: any) {
			this.debugLog('Error creating file', { fileName, dirPath, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	/**
	 * Creates a new directory on WebDAV server
	 */
	async createDirectory(folderName: string, dirPath: string = ''): Promise<WebDAVOperationResponse> {
		try {
			const url = this.buildUrl(dirPath);
			const body = `sabreAction=mkcol&name=${encodeURIComponent(folderName)}`;

			const response = await this.makeRequest(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded'
				},
				body
			});

			const success = response.ok;
			this.debugLog('Directory creation result', { 
				folderName, 
				dirPath, 
				success, 
				status: response.status 
			});

			return {
				success,
				error: success ? undefined : `HTTP ${response.status}: ${response.statusText}`,
				statusCode: response.status
			};
		} catch (error: any) {
			this.debugLog('Error creating directory', { folderName, dirPath, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	/**
	 * Deletes an item from WebDAV server
	 */
	async deleteItem(itemName: string, dirPath: string = ''): Promise<WebDAVOperationResponse> {
		try {
			const itemPath = dirPath ? `${dirPath}/${itemName}` : itemName;
			const cleanPath = itemPath.startsWith('/') ? itemPath.substring(1) : itemPath;
			const url = `${this.baseUrl}/${cleanPath}/?sabreAction=delete`;

			const response = await this.makeRequest(url);

			const success = response.ok;
			this.debugLog('Item deletion result', { 
				itemName, 
				dirPath, 
				success, 
				status: response.status 
			});

			return {
				success,
				error: success ? undefined : `HTTP ${response.status}: ${response.statusText}`,
				statusCode: response.status
			};
		} catch (error: any) {
			this.debugLog('Error deleting item', { itemName, dirPath, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	/**
	 * Renames an item on WebDAV server
	 */
	async renameItem(currentName: string, newName: string, dirPath: string = ''): Promise<WebDAVOperationResponse> {
		try {
			const itemPath = dirPath ? `${dirPath}/${currentName}` : currentName;
			const cleanPath = itemPath.startsWith('/') ? itemPath.substring(1) : itemPath;
			const url = `${this.baseUrl}/${cleanPath}?sabreAction=rename&newName=${encodeURIComponent(newName)}`;

			const response = await this.makeRequest(url);

			const success = response.ok;
			this.debugLog('Item rename result', { 
				currentName, 
				newName, 
				dirPath, 
				success, 
				status: response.status 
			});

			return {
				success,
				error: success ? undefined : `HTTP ${response.status}: ${response.statusText}`,
				statusCode: response.status
			};
		} catch (error: any) {
			this.debugLog('Error renaming item', { currentName, newName, dirPath, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	/**
	 * Performs a PROPFIND request for cache warming
	 */
	async propFind(path: string): Promise<{ name: string; type: 'file' | 'directory'; size: number; mtime: number; etag?: string; }[]> {
		try {
			const response = await this.getDirectoryListing(path);
			
			if (!response.success) {
				return [];
			}

			return response.items.map(item => ({
				name: item.name,
				type: item.isDirectory ? 'directory' : 'file',
				size: parseInt(item.size) || 0,
				mtime: new Date(item.modified).getTime(),
				etag: undefined // WebDAV server doesn't provide ETags in directory listings
			}));
		} catch (error: any) {
			this.debugLog('Error in PROPFIND', { path, error: error.message });
			return [];
		}
	}

	/**
	 * Gets the base URL for this WebDAV connection
	 */
	getBaseUrl(): string {
		return this.baseUrl;
	}

	/**
	 * Gets the credentials for this WebDAV connection
	 */
	getCredentials(): WebDAVCredentials {
		return { ...this.credentials };
	}

	/**
	 * Gets list of available projects from the remote apps directory
	 */
	static async getProjectList(baseUrl: string, username: string, password: string): Promise<WebDAVDirectoryResponse> {
		const debugLog = (message: string, data?: any) => {
			console.log(`[WebDAVApi.getProjectList] ${message}`, data);
		};

		try {
			const appsRemoteUrl = `${baseUrl}/apps/remote/`;
			const headers = {
				'Authorization': `Basic ${btoa(`${username}:${password}`)}`,
				'User-Agent': 'VSCode-WebDAV-Extension',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'Cache-Control': 'no-cache, no-store, must-revalidate',
				'Pragma': 'no-cache',
				'Expires': '0'
			};

			debugLog('Fetching project list', { 
				url: appsRemoteUrl, 
				username,
				headers: Object.keys(headers)
			});

			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
				debugLog('Request timed out');
			}, 15000);

			const response = await fetch(appsRemoteUrl, {
				method: 'GET',
				headers,
				mode: getFetchMode(),
				credentials: 'include',
				signal: controller.signal
			});

			clearTimeout(timeoutId);

			debugLog('Response received', { 
				status: response.status, 
				statusText: response.statusText,
				contentType: response.headers.get('content-type'),
				contentLength: response.headers.get('content-length')
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => 'Unable to read error response');
				debugLog('Failed to fetch project list', { 
					status: response.status, 
					statusText: response.statusText,
					errorText: errorText.substring(0, 500)
				});
				return {
					items: [],
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}. ${errorText.substring(0, 200)}`
				};
			}

			const html = await response.text();
			debugLog('HTML response received', { 
				length: html.length,
				preview: html.substring(0, 200)
			});
			
			const items = parseDirectoryHTML(html);
			debugLog('Parsed HTML items', { 
				totalParsed: items.length,
				allItems: items.map(item => ({ 
					name: item.name, 
					isDirectory: item.isDirectory,
					size: item.size 
				}))
			});
			
			// Filter out non-directory items and system folders
			const projects = items.filter(item => {
				const isValidProject = item.isDirectory && 
					!item.name.startsWith('.') && 
					item.name !== 'index.html' &&
					item.name !== 'parent' &&
					item.name !== '..' &&
					item.name.trim() !== '';
				
				debugLog('Filtering item', {
					name: item.name,
					isDirectory: item.isDirectory,
					isValidProject
				});
				
				return isValidProject;
			});

			debugLog('Project list retrieved', { 
				totalItems: items.length,
				projectCount: projects.length,
				projects: projects.map(p => p.name)
			});

			return {
				items: projects,
				success: true
			};
		} catch (error: any) {
			debugLog('Error getting project list', { 
				error: error.message, 
				name: error.name,
				stack: error.stack?.substring(0, 500)
			});
			
			// Provide more specific error messages
			let errorMessage = error.message;
			if (error.name === 'AbortError') {
				errorMessage = 'Request timed out after 15 seconds';
			} else if (error.message === 'Failed to fetch') {
				errorMessage = 'Network error - check CORS settings or server availability';
			}
			
			return {
				items: [],
				success: false,
				error: errorMessage
			};
		}
	}
}