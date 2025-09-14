/**
 * WebDAV Protocol Interface and Implementations
 * 
 * Provides abstraction layer for different WebDAV connection methods:
 * - HTTP/HTTPS (current implementation)
 * - Native WebDAV protocol
 */

import { WebDAVCredentials, WebDAVFileItem } from '../types';
import { WebDAVDirectoryResponse, WebDAVFileResponse, WebDAVOperationResponse } from './webdavApi';

export interface WebDAVProtocolInterface {
	/**
	 * Initialize the protocol with credentials
	 */
	initialize(credentials: WebDAVCredentials): Promise<boolean>;

	/**
	 * Test connection to the server
	 */
	testConnection(): Promise<boolean>;

	/**
	 * Get directory listing
	 */
	getDirectoryListing(path: string): Promise<WebDAVDirectoryResponse>;

	/**
	 * Read file content
	 */
	readFile(path: string): Promise<WebDAVFileResponse>;

	/**
	 * Write file content
	 */
	writeFile(path: string, content: Uint8Array): Promise<WebDAVOperationResponse>;

	/**
	 * Create directory
	 */
	createDirectory(path: string): Promise<WebDAVOperationResponse>;

	/**
	 * Delete file or directory
	 */
	delete(path: string): Promise<WebDAVOperationResponse>;

	/**
	 * Move/rename file or directory
	 */
	move(sourcePath: string, destinationPath: string): Promise<WebDAVOperationResponse>;

	/**
	 * Copy file or directory
	 */
	copy(sourcePath: string, destinationPath: string): Promise<WebDAVOperationResponse>;

	/**
	 * Get file/directory properties
	 */
	getProperties(path: string): Promise<WebDAVFileItem | null>;
}

export enum WebDAVProtocolType {
	HTTP = 'http',
	WEBDAV = 'webdav'
}

export interface WebDAVConnection {
	protocol: WebDAVProtocolType;
	url: string;
	username: string;
	password: string;
	project?: string;
}