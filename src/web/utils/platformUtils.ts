/**
 * Platform detection utilities for VS Code extensions
 */

/**
 * Detects if the extension is running on desktop VS Code (with Electron) vs web VS Code
 * @returns true if running on desktop VS Code, false if running in web environment
 */
export function isDesktopVSCode(): boolean {
	return typeof process !== 'undefined' && process.versions && !!process.versions.electron;
}

/**
 * Gets the appropriate fetch mode for the current platform
 * Desktop VS Code can bypass CORS entirely, while web VS Code must respect CORS
 * @returns 'no-cors' for desktop, 'cors' for web
 */
export function getFetchMode(): RequestMode {
	return isDesktopVSCode() ? 'no-cors' : 'cors';
}

/**
 * Creates a RequestInit object with appropriate CORS settings for the current platform
 * @param options Base RequestInit options to extend
 * @returns RequestInit with platform-appropriate CORS settings
 */
export function createPlatformRequestInit(options: RequestInit = {}): RequestInit {
	return {
		...options,
		mode: getFetchMode(),
		credentials: 'include'
	};
}