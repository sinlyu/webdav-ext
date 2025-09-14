/**
 * WebDAV Protocol Factory
 * 
 * Creates appropriate protocol implementations based on configuration
 */

import { WebDAVCredentials } from '../types';
import { WebDAVProtocolInterface, WebDAVProtocolType } from './webdavProtocol';
import { WebDAVHttpProtocol } from './webdavHttpProtocol';
import { WebDAVNativeProtocol } from './webdavNativeProtocol';

export class WebDAVProtocolFactory {
	/**
	 * Create a WebDAV protocol implementation
	 */
	static create(
		protocol: WebDAVProtocolType,
		debugLog: (message: string, data?: any) => void = () => {}
	): WebDAVProtocolInterface {
		switch (protocol) {
			case WebDAVProtocolType.WEBDAV:
				debugLog('Creating Native WebDAV protocol handler');
				return new WebDAVNativeProtocol(debugLog);
			
			case WebDAVProtocolType.HTTP:
			default:
				debugLog('Creating HTTP WebDAV protocol handler');
				return new WebDAVHttpProtocol(debugLog);
		}
	}

	/**
	 * Detect the best protocol based on URL and capabilities
	 */
	static detectProtocol(url: string): WebDAVProtocolType {
		// For now, default to HTTP but could add detection logic here
		// e.g., try WebDAV first and fall back to HTTP
		return WebDAVProtocolType.HTTP;
	}

	/**
	 * Test if a protocol is available/supported
	 */
	static async isProtocolSupported(protocol: WebDAVProtocolType): Promise<boolean> {
		switch (protocol) {
			case WebDAVProtocolType.WEBDAV:
				// Test if the environment supports WebDAV protocol
				// In VS Code web extension environments, native WebDAV might be limited
				// For now, assume it's supported and let the implementation handle fallbacks
				return true;
			
			case WebDAVProtocolType.HTTP:
				return true; // HTTP is always supported
			
			default:
				return false;
		}
	}

	/**
	 * Get available protocols
	 */
	static async getAvailableProtocols(): Promise<WebDAVProtocolType[]> {
		const protocols: WebDAVProtocolType[] = [];
		
		// HTTP is always available
		protocols.push(WebDAVProtocolType.HTTP);
		
		// Check if WebDAV is supported
		if (await this.isProtocolSupported(WebDAVProtocolType.WEBDAV)) {
			protocols.push(WebDAVProtocolType.WEBDAV);
		}
		
		return protocols;
	}
}