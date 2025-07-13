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
 * However, no-cors mode limits response access, so we'll use cors with credentials
 * @returns 'cors' for all platforms to maintain response access
 */
export function getFetchMode(): RequestMode {
	// Always use 'cors' mode to maintain access to response properties
	// Desktop VS Code should handle CORS better than web, but we still need response access
	return 'cors';
}

/**
 * Gets the appropriate fetch mode specifically for scenarios where response inspection is not needed
 * This can use no-cors on desktop for fire-and-forget requests
 * @returns 'no-cors' for desktop, 'cors' for web
 */
export function getFireAndForgetFetchMode(): RequestMode {
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