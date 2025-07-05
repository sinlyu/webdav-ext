/**
 * Negative Space Programming: Constraints and Boundaries
 * 
 * This module defines what the system CANNOT do, creating a safe space
 * where only valid operations are possible through exclusion rather than inclusion.
 */

// System Invariants - These must NEVER be violated
export const INVARIANTS = {
  // Connection state invariants
  CANNOT_OPERATE_WITHOUT_CREDENTIALS: 'Operations forbidden without valid credentials',
  CANNOT_EXPOSE_SENSITIVE_DATA: 'Credentials must never be logged or exposed',
  CANNOT_PROCEED_WITH_INVALID_URI: 'Malformed URIs must be rejected',
  
  // File system invariants  
  CANNOT_ACCESS_PARENT_DIRECTORIES: 'Path traversal attacks forbidden',
  CANNOT_WRITE_OUTSIDE_PROJECT: 'Writes must be confined to project scope',
  CANNOT_DELETE_SYSTEM_FILES: 'System files are immutable',
  
  // Network invariants
  CANNOT_RETRY_INDEFINITELY: 'Network operations must have bounded retries',
  CANNOT_IGNORE_CORS_VIOLATIONS: 'CORS errors indicate security boundaries',
  CANNOT_PROCEED_WITHOUT_HTTPS: 'Unencrypted connections forbidden in production',
  CANNOT_IGNORE_TIMEOUTS: 'Timeout boundaries must be respected',
} as const;

// Forbidden Operations - These should never be attempted
export const FORBIDDEN = {
  // File operations
  PATHS: [
    '../', './', '..\\', '.\\',  // Path traversal
    '/etc/', '/var/', '/usr/',   // System directories
    'C:\\Windows\\', 'C:\\System32\\', // Windows system dirs
  ],
  
  // URI patterns that indicate malformed requests
  URI_PATTERNS: [
    /^\/webdav:/,                // Leading slash before scheme
    /javascript:/i,              // Script injection
    /data:/i,                    // Data URLs
    /file:/i,                    // Local file access
  ],
  
  // Headers that should never be sent
  HEADERS: [
    'x-forwarded-for',           // Could expose internal network
    'x-real-ip',                 // Could expose real client IP
    'server',                    // Could expose server info
  ],
  
  // Content types that are forbidden
  CONTENT_TYPES: [
    'application/x-executable',
    'application/x-msdos-program',
    'application/x-msdownload',
  ],
} as const;

// Resource Limits - Boundaries that cannot be exceeded
export const LIMITS = {
  MAX_FILE_SIZE: 100 * 1024 * 1024,    // 100MB
  MAX_FILENAME_LENGTH: 255,
  MAX_PATH_DEPTH: 32,
  MAX_CONCURRENT_REQUESTS: 10,
  MAX_RETRY_ATTEMPTS: 3,
  MAX_TIMEOUT_MS: 30000,
  MAX_LOG_ENTRY_SIZE: 1024,
} as const;

// State Boundaries - Valid state transitions
export const STATE_BOUNDARIES = {
  // Connection states that are mutually exclusive
  CONNECTION_STATES: ['disconnected', 'connecting', 'connected', 'error'] as const,
  
  // File operation states
  FILE_STATES: ['idle', 'reading', 'writing', 'deleting', 'error'] as const,
  
  // Invalid state transitions (from -> to)
  FORBIDDEN_TRANSITIONS: new Map([
    ['connected', 'connecting'],     // Cannot reconnect while connected
    ['error', 'connected'],          // Must go through disconnected first
    ['writing', 'reading'],          // Cannot read while writing
  ]),
} as const;

// Type constraints using negative space
export type NonEmptyString<T extends string> = T extends '' ? never : T;
export type NonNullable<T> = T extends null | undefined ? never : T;
export type SafeUri<T extends string> = T extends `${string}javascript:${string}` ? never :
                                       T extends `${string}data:${string}` ? never :
                                       T extends `${string}file:${string}` ? never : T;

// Validation functions that enforce constraints
export class ConstraintViolationError extends Error {
  constructor(invariant: string, details?: any) {
    super(`Constraint violation: ${invariant}`);
    this.name = 'ConstraintViolationError';
    if (details && typeof details === 'object') {
      Object.assign(this, { details });
    }
  }
}

// Defensive validation - defines what we WON'T accept
export const Constraints = {
  // Reject operations without proper credentials
  rejectUnauthenticated<T>(credentials: T | null): NonNullable<T> {
    if (!credentials) {
      throw new ConstraintViolationError(INVARIANTS.CANNOT_OPERATE_WITHOUT_CREDENTIALS);
    }
    return credentials as NonNullable<T>;
  },

  // Reject malformed URIs
  rejectMalformedUri(uri: string): SafeUri<string> {
    for (const pattern of FORBIDDEN.URI_PATTERNS) {
      if (pattern.test(uri)) {
        throw new ConstraintViolationError(INVARIANTS.CANNOT_PROCEED_WITH_INVALID_URI, { uri });
      }
    }
    return uri as SafeUri<string>;
  },

  // Reject dangerous paths
  rejectUnsafePath(path: string): string {
    for (const forbidden of FORBIDDEN.PATHS) {
      if (path.includes(forbidden)) {
        throw new ConstraintViolationError(INVARIANTS.CANNOT_ACCESS_PARENT_DIRECTORIES, { path });
      }
    }
    if (path.length > LIMITS.MAX_FILENAME_LENGTH) {
      throw new ConstraintViolationError('Path too long', { path, maxLength: LIMITS.MAX_FILENAME_LENGTH });
    }
    return path;
  },

  // Reject oversized content
  rejectOversizedContent(content: Uint8Array): Uint8Array {
    if (content.length > LIMITS.MAX_FILE_SIZE) {
      throw new ConstraintViolationError('File too large', { 
        size: content.length, 
        maxSize: LIMITS.MAX_FILE_SIZE 
      });
    }
    return content;
  },

  // Reject invalid state transitions
  rejectInvalidTransition(from: string, to: string): void {
    const forbidden = STATE_BOUNDARIES.FORBIDDEN_TRANSITIONS.get(from);
    if (forbidden === to) {
      throw new ConstraintViolationError('Invalid state transition', { from, to });
    }
  },
};