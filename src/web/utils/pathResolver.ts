/**
 * Path Resolver
 * 
 * Utility for normalizing and resolving WebDAV file paths, including
 * virtual file path handling
 */

export class PathResolver {
	/**
	 * Normalizes file paths for URI creation, handling virtual file prefixes
	 */
	static normalizeFilePathForUri(filePath: string): string {
		// Handle ~ prefix for virtual files - convert to regular path
		let normalizedPath = filePath;
		if (filePath.startsWith('~/')) {
			normalizedPath = filePath.substring(1); // Remove ~ but keep the /
		} else if (filePath.startsWith('~')) {
			normalizedPath = filePath.substring(1); // Remove ~ completely
		}
		
		// Ensure path starts with /
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = `/${normalizedPath}`;
		}
		
		return normalizedPath;
	}

	/**
	 * Get the parent directory path
	 */
	static getParentPath(path: string): string {
		const normalizedPath = this.normalizePath(path);
		const lastSlash = normalizedPath.lastIndexOf('/');
		
		if (lastSlash <= 0) {
			return '/';
		}
		
		return normalizedPath.substring(0, lastSlash);
	}

	/**
	 * Get the file name from a path
	 */
	static getFileName(path: string): string {
		const normalizedPath = this.normalizePath(path);
		const lastSlash = normalizedPath.lastIndexOf('/');
		
		if (lastSlash === -1) {
			return normalizedPath;
		}
		
		return normalizedPath.substring(lastSlash + 1);
	}

	/**
	 * Join path segments
	 */
	static joinPaths(...segments: string[]): string {
		const cleanSegments = segments
			.filter(segment => segment && segment.trim() !== '')
			.map(segment => segment.trim())
			.map(segment => segment.replace(/^\/+|\/+$/g, '')) // Remove leading/trailing slashes
			.filter(segment => segment !== '');

		if (cleanSegments.length === 0) {
			return '/';
		}

		return '/' + cleanSegments.join('/');
	}

	/**
	 * Normalize a path by removing double slashes and handling virtual prefixes
	 */
	static normalizePath(path: string): string {
		if (!path) {
			return '/';
		}

		// Handle virtual file prefixes
		let normalizedPath = path;
		if (path.startsWith('~/')) {
			normalizedPath = path.substring(1); // Remove ~ but keep the /
		} else if (path.startsWith('~')) {
			normalizedPath = '/' + path.substring(1); // Remove ~ and ensure leading /
		}

		// Normalize slashes
		normalizedPath = normalizedPath.replace(/\/+/g, '/');

		// Ensure leading slash
		if (!normalizedPath.startsWith('/')) {
			normalizedPath = '/' + normalizedPath;
		}

		// Remove trailing slash except for root
		if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
			normalizedPath = normalizedPath.slice(0, -1);
		}

		return normalizedPath;
	}

	/**
	 * Check if a path is virtual (contains ~ prefix)
	 */
	static isVirtualPath(path: string): boolean {
		return path.startsWith('~') || path.includes('~');
	}

	/**
	 * Convert virtual path to regular path
	 */
	static resolveVirtualPath(path: string): string {
		if (path.startsWith('~/')) {
			return path.substring(1); // Remove ~ but keep the /
		} else if (path.startsWith('~')) {
			return '/' + path.substring(1); // Remove ~ and ensure leading /
		}
		
		return path;
	}

	/**
	 * Check if a path is a directory (ends with /)
	 */
	static isDirectory(path: string): boolean {
		return path.endsWith('/');
	}

	/**
	 * Ensure path is treated as directory (add trailing slash if needed)
	 */
	static ensureDirectoryPath(path: string): string {
		const normalized = this.normalizePath(path);
		return normalized === '/' ? normalized : normalized + '/';
	}

	/**
	 * Get the file extension from a path
	 */
	static getExtension(path: string): string {
		const fileName = this.getFileName(path);
		const dotIndex = fileName.lastIndexOf('.');
		
		if (dotIndex === -1 || dotIndex === 0) {
			return '';
		}
		
		return fileName.substring(dotIndex + 1).toLowerCase();
	}

	/**
	 * Check if a path represents a PHP file
	 */
	static isPhpFile(path: string): boolean {
		const extension = this.getExtension(path);
		return ['php', 'phtml', 'inc'].includes(extension);
	}

	/**
	 * Get relative path from base to target
	 */
	static getRelativePath(basePath: string, targetPath: string): string {
		const base = this.normalizePath(basePath);
		const target = this.normalizePath(targetPath);
		
		if (target.startsWith(base)) {
			const relative = target.substring(base.length);
			return relative.startsWith('/') ? relative.substring(1) : relative;
		}
		
		return target;
	}

	/**
	 * Check if target path is under base path
	 */
	static isUnderPath(basePath: string, targetPath: string): boolean {
		const base = this.normalizePath(basePath);
		const target = this.normalizePath(targetPath);
		
		return target.startsWith(base) && target.length > base.length;
	}
}