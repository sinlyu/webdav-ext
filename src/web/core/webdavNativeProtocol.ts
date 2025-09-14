/**
 * Native WebDAV Protocol Implementation
 * 
 * Implements proper WebDAV methods like PROPFIND, MKCOL, etc.
 * instead of relying on HTTP/HTTPS requests
 */

import { WebDAVCredentials, WebDAVFileItem } from '../types';
import { WebDAVDirectoryResponse, WebDAVFileResponse, WebDAVOperationResponse } from './webdavApi';
import { WebDAVProtocolInterface } from './webdavProtocol';
import { parseDirectoryHTML } from '../utils/htmlUtils';
import { getFetchMode } from '../utils/platformUtils';

export class WebDAVNativeProtocol implements WebDAVProtocolInterface {
	private credentials: WebDAVCredentials | null = null;
	private debugLog: (message: string, data?: any) => void;
	private baseUrl: string = '';
	private baseHeaders: Record<string, string> = {};

	constructor(debugLog: (message: string, data?: any) => void = () => {}) {
		this.debugLog = debugLog;
	}

	async initialize(credentials: WebDAVCredentials): Promise<boolean> {
		this.credentials = credentials;
		this.baseHeaders = {
			'Authorization': `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
			'User-Agent': 'VSCode-WebDAV-Extension-Native',
			'Content-Type': 'application/xml; charset=utf-8'
		};

		// Construct WebDAV URL - use webdav:// protocol
		const protocol = credentials.url.startsWith('https') ? 'webdav+ssl://' : 'webdav://';
		const urlWithoutProtocol = credentials.url.replace(/^https?:\/\//, '');
		const projectPath = credentials.project ? `/${credentials.project}` : '';
		this.baseUrl = `${protocol}${urlWithoutProtocol}/apps/remote${projectPath}`;

		this.debugLog('WebDAV Native Protocol initialized', {
			baseUrl: this.baseUrl,
			hasProject: !!credentials.project
		});

		return true;
	}

	async testConnection(): Promise<boolean> {
		try {
			const response = await this.propfind('/', 0);
			return response.success;
		} catch (error: any) {
			this.debugLog('WebDAV connection test failed', { error: error.message });
			return false;
		}
	}

	/**
	 * PROPFIND WebDAV method implementation
	 */
	private async propfind(path: string, depth: number = 1): Promise<WebDAVDirectoryResponse> {
		const url = this.buildUrl(path);
		
		const propfindBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
	<D:allprop/>
</D:propfind>`;

		try {
			const response = await this.makeWebDAVRequest(url, {
				method: 'PROPFIND',
				headers: {
					'Depth': depth.toString(),
					'Content-Length': propfindBody.length.toString()
				},
				body: propfindBody
			});

			if (!response.ok) {
				return {
					items: [],
					success: false,
					error: `PROPFIND failed: HTTP ${response.status}: ${response.statusText}`
				};
			}

			const xmlText = await response.text();
			const items = this.parseWebDAVResponse(xmlText, path);

			this.debugLog('PROPFIND completed', { 
				path, 
				depth,
				itemCount: items.length 
			});

			return {
				items,
				success: true
			};

		} catch (error: any) {
			this.debugLog('PROPFIND error', { path, error: error.message });
			return {
				items: [],
				success: false,
				error: error.message
			};
		}
	}

	async getDirectoryListing(path: string): Promise<WebDAVDirectoryResponse> {
		return await this.propfind(path, 1);
	}

	async readFile(path: string): Promise<WebDAVFileResponse> {
		try {
			const url = this.buildUrl(path);
			const response = await this.makeWebDAVRequest(url, {
				method: 'GET',
				headers: {
					'Accept': '*/*'
				}
			});

			if (!response.ok) {
				return {
					content: new Uint8Array(),
					headers: {},
					success: false,
					error: `GET failed: HTTP ${response.status}: ${response.statusText}`
				};
			}

			const content = await response.arrayBuffer();
			const headers: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				headers[key] = value;
			});

			this.debugLog('File read completed', { 
				path, 
				size: content.byteLength,
				contentType: headers['content-type']
			});

			return {
				content: new Uint8Array(content),
				headers,
				success: true
			};

		} catch (error: any) {
			this.debugLog('File read error', { path, error: error.message });
			return {
				content: new Uint8Array(),
				headers: {},
				success: false,
				error: error.message
			};
		}
	}

	async writeFile(path: string, content: Uint8Array): Promise<WebDAVOperationResponse> {
		try {
			const url = this.buildUrl(path);
			const response = await this.makeWebDAVRequest(url, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/octet-stream',
					'Content-Length': content.length.toString()
				},
				body: content
			});

			const success = response.ok;
			this.debugLog('File write completed', { 
				path, 
				size: content.length,
				success,
				status: response.status
			});

			return {
				success,
				statusCode: response.status,
				error: success ? undefined : `PUT failed: HTTP ${response.status}: ${response.statusText}`
			};

		} catch (error: any) {
			this.debugLog('File write error', { path, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	async createDirectory(path: string): Promise<WebDAVOperationResponse> {
		try {
			const url = this.buildUrl(path);
			const response = await this.makeWebDAVRequest(url, {
				method: 'MKCOL'
			});

			const success = response.ok;
			this.debugLog('Directory creation completed', { 
				path,
				success,
				status: response.status
			});

			return {
				success,
				statusCode: response.status,
				error: success ? undefined : `MKCOL failed: HTTP ${response.status}: ${response.statusText}`
			};

		} catch (error: any) {
			this.debugLog('Directory creation error', { path, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	async delete(path: string): Promise<WebDAVOperationResponse> {
		try {
			const url = this.buildUrl(path);
			const response = await this.makeWebDAVRequest(url, {
				method: 'DELETE'
			});

			const success = response.ok;
			this.debugLog('Delete completed', { 
				path,
				success,
				status: response.status
			});

			return {
				success,
				statusCode: response.status,
				error: success ? undefined : `DELETE failed: HTTP ${response.status}: ${response.statusText}`
			};

		} catch (error: any) {
			this.debugLog('Delete error', { path, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	async move(sourcePath: string, destinationPath: string): Promise<WebDAVOperationResponse> {
		try {
			const sourceUrl = this.buildUrl(sourcePath);
			const destUrl = this.buildUrl(destinationPath);
			
			const response = await this.makeWebDAVRequest(sourceUrl, {
				method: 'MOVE',
				headers: {
					'Destination': destUrl,
					'Overwrite': 'T'
				}
			});

			const success = response.ok;
			this.debugLog('Move completed', { 
				sourcePath,
				destinationPath,
				success,
				status: response.status
			});

			return {
				success,
				statusCode: response.status,
				error: success ? undefined : `MOVE failed: HTTP ${response.status}: ${response.statusText}`
			};

		} catch (error: any) {
			this.debugLog('Move error', { sourcePath, destinationPath, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	async copy(sourcePath: string, destinationPath: string): Promise<WebDAVOperationResponse> {
		try {
			const sourceUrl = this.buildUrl(sourcePath);
			const destUrl = this.buildUrl(destinationPath);
			
			const response = await this.makeWebDAVRequest(sourceUrl, {
				method: 'COPY',
				headers: {
					'Destination': destUrl,
					'Overwrite': 'T'
				}
			});

			const success = response.ok;
			this.debugLog('Copy completed', { 
				sourcePath,
				destinationPath,
				success,
				status: response.status
			});

			return {
				success,
				statusCode: response.status,
				error: success ? undefined : `COPY failed: HTTP ${response.status}: ${response.statusText}`
			};

		} catch (error: any) {
			this.debugLog('Copy error', { sourcePath, destinationPath, error: error.message });
			return {
				success: false,
				error: error.message
			};
		}
	}

	async getProperties(path: string): Promise<WebDAVFileItem | null> {
		const result = await this.propfind(path, 0);
		if (result.success && result.items.length > 0) {
			return result.items[0];
		}
		return null;
	}

	/**
	 * Build URL for WebDAV requests
	 */
	private buildUrl(path: string): string {
		let cleanPath = path.replace(/^\/+/, '').replace(/\/+/g, '/');
		if (cleanPath.endsWith('/') && cleanPath.length > 1) {
			cleanPath = cleanPath.slice(0, -1);
		}
		const url = cleanPath ? `${this.baseUrl}/${cleanPath}` : `${this.baseUrl}/`;
		
		this.debugLog('Built WebDAV URL', { originalPath: path, cleanPath, url });
		return url;
	}

	/**
	 * Make WebDAV request - falls back to HTTP if webdav:// not supported
	 */
	private async makeWebDAVRequest(url: string, options: {
		method?: string;
		headers?: Record<string, string>;
		body?: string | Uint8Array;
	}): Promise<Response> {
		const {
			method = 'GET',
			headers = {},
			body
		} = options;

		// Convert webdav:// URL to https:// if needed (fallback)
		let requestUrl = url;
		if (url.startsWith('webdav://') || url.startsWith('webdav+ssl://')) {
			if (url.startsWith('webdav+ssl://')) {
				requestUrl = url.replace('webdav+ssl://', 'https://');
			} else {
				requestUrl = url.replace('webdav://', 'http://');
			}
			this.debugLog('Falling back to HTTP protocol', { originalUrl: url, fallbackUrl: requestUrl });
		}

		const requestOptions: RequestInit = {
			method,
			headers: { ...this.baseHeaders, ...headers },
			mode: getFetchMode(),
			credentials: 'include'
		};

		if (body) {
			requestOptions.body = body;
		}

		this.debugLog('Making WebDAV request', {
			url: requestUrl,
			method,
			headers: Object.keys(requestOptions.headers || {}),
			hasBody: !!body
		});

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		try {
			const response = await fetch(requestUrl, {
				...requestOptions,
				signal: controller.signal
			});

			clearTimeout(timeoutId);
			this.debugLog('WebDAV request completed', {
				url: requestUrl,
				method,
				status: response.status,
				statusText: response.statusText,
				ok: response.ok
			});

			return response;
		} catch (error: any) {
			clearTimeout(timeoutId);
			this.debugLog('WebDAV request failed', {
				url: requestUrl,
				method,
				error: error.message,
				name: error.name
			});
			throw error;
		}
	}

	/**
	 * Parse WebDAV XML response from PROPFIND
	 */
	private parseWebDAVResponse(xmlText: string, basePath: string): WebDAVFileItem[] {
		const items: WebDAVFileItem[] = [];
		
		try {
			// Simple XML parsing - in production, consider using DOMParser
			const responses = xmlText.match(/<D:response[^>]*>([\s\S]*?)<\/D:response>/gi) || [];
			
			for (const responseXml of responses) {
				const hrefMatch = responseXml.match(/<D:href[^>]*>(.*?)<\/D:href>/i);
				const resourcetypeMatch = responseXml.match(/<D:resourcetype[^>]*>(.*?)<\/D:resourcetype>/i);
				const contentlengthMatch = responseXml.match(/<D:getcontentlength[^>]*>(.*?)<\/D:getcontentlength>/i);
				const lastmodifiedMatch = responseXml.match(/<D:getlastmodified[^>]*>(.*?)<\/D:getlastmodified>/i);

				if (hrefMatch && hrefMatch[1]) {
					const href = decodeURIComponent(hrefMatch[1].trim());
					const pathParts = href.split('/').filter(part => part.length > 0);
					const name = pathParts[pathParts.length - 1];

					if (name && name !== '.') {
						const isDirectory = resourcetypeMatch && resourcetypeMatch[1].includes('<D:collection');
						const sizeValue = contentlengthMatch ? parseInt(contentlengthMatch[1], 10) : 0;
						const lastModified = lastmodifiedMatch ? new Date(lastmodifiedMatch[1]) : new Date();

						items.push({
							name,
							path: href,
							type: isDirectory ? 'directory' : 'file',
							size: sizeValue.toString(),
							modified: lastModified.toISOString(),
							isDirectory: !!isDirectory
						});
					}
				}
			}

			// Remove the base path item if it exists
			return items.filter(item => item.path !== basePath);

		} catch (error: any) {
			this.debugLog('Error parsing WebDAV XML response', { error: error.message });
			return [];
		}
	}
}