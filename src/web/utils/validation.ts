/**
 * Simple Validation Utilities
 * 
 * Basic validation functions extracted from the negative space programming approach
 * but simplified for practical use
 */

export class ValidationError extends Error {
	constructor(message: string, public readonly details?: any) {
		super(message);
		this.name = 'ValidationError';
	}
}

export class Validator {
	// File size limits
	static readonly MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
	static readonly MAX_FILENAME_LENGTH = 255;
	static readonly MAX_PATH_DEPTH = 32;

	// Dangerous path patterns
	private static readonly FORBIDDEN_PATHS = [
		'../', './', '..\\', '.\\',  // Path traversal
		'/etc/', '/var/', '/usr/',   // Unix system directories
		'C:\\Windows\\', 'C:\\System32\\', // Windows system dirs
	];

	// Dangerous URI patterns
	private static readonly FORBIDDEN_URI_PATTERNS = [
		/^\/webdav:/,                // Leading slash before scheme
		/javascript:/i,              // Script injection
		/data:/i,                    // Data URLs
		/file:/i,                    // Local file access
	];

	/**
	 * Validate that credentials are present
	 */
	static validateCredentials<T>(credentials: T | null | undefined): T {
		if (!credentials) {
			throw new ValidationError('Operation requires valid credentials');
		}
		return credentials;
	}

	/**
	 * Validate URI format and reject dangerous patterns
	 */
	static validateUri(uri: string): string {
		if (!uri || typeof uri !== 'string') {
			throw new ValidationError('URI must be a non-empty string');
		}

		for (const pattern of this.FORBIDDEN_URI_PATTERNS) {
			if (pattern.test(uri)) {
				throw new ValidationError('URI contains forbidden pattern', { uri, pattern: pattern.toString() });
			}
		}

		// Basic URL validation
		try {
			new URL(uri);
		} catch {
			throw new ValidationError('Invalid URI format', { uri });
		}

		return uri;
	}

	/**
	 * Validate file paths and reject dangerous patterns
	 */
	static validatePath(path: string): string {
		if (!path || typeof path !== 'string') {
			throw new ValidationError('Path must be a non-empty string');
		}

		// Check for path traversal attacks
		for (const forbidden of this.FORBIDDEN_PATHS) {
			if (path.includes(forbidden)) {
				throw new ValidationError('Path contains forbidden pattern', { path, forbidden });
			}
		}

		// Check path length
		if (path.length > this.MAX_FILENAME_LENGTH) {
			throw new ValidationError('Path too long', { 
				path, 
				length: path.length, 
				maxLength: this.MAX_FILENAME_LENGTH 
			});
		}

		return path;
	}

	/**
	 * Validate file content size
	 */
	static validateFileSize(content: Uint8Array): Uint8Array {
		if (content.length > this.MAX_FILE_SIZE) {
			throw new ValidationError('File too large', { 
				size: content.length, 
				maxSize: this.MAX_FILE_SIZE 
			});
		}
		return content;
	}

	/**
	 * Validate that a value is not null or undefined
	 */
	static validateNotNull<T>(value: T | null | undefined, name: string): T {
		if (value === null || value === undefined) {
			throw new ValidationError(`${name} cannot be null or undefined`);
		}
		return value;
	}

	/**
	 * Validate that a string is not empty
	 */
	static validateNotEmpty(value: string, name: string): string {
		if (!value || value.trim().length === 0) {
			throw new ValidationError(`${name} cannot be empty`);
		}
		return value.trim();
	}

	/**
	 * Validate file extension is allowed
	 */
	static validateFileExtension(filename: string, allowedExtensions: string[]): string {
		const extension = filename.split('.').pop()?.toLowerCase();
		if (!extension || !allowedExtensions.includes(extension)) {
			throw new ValidationError('File extension not allowed', { 
				filename, 
				extension, 
				allowedExtensions 
			});
		}
		return filename;
	}

	/**
	 * Validate that a number is within range
	 */
	static validateRange(value: number, min: number, max: number, name: string): number {
		if (value < min || value > max) {
			throw new ValidationError(`${name} must be between ${min} and ${max}`, { 
				value, min, max 
			});
		}
		return value;
	}
}