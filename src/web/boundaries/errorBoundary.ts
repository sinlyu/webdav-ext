/**
 * Error Boundary System - Negative Space Programming
 * 
 * Defines what errors CANNOT propagate and creates defensive layers
 * that prevent system corruption through constrained error handling.
 */

import { ConstraintViolationError, INVARIANTS } from '../constraints';

// Error types that CANNOT be ignored
export const CRITICAL_ERROR_TYPES = [
  'ConstraintViolationError',
  'SecurityError',
  'AuthenticationError',
  'AuthorizationError',
] as const;

// Error categories that define containment boundaries
export enum ErrorBoundary {
  // Network errors cannot affect file system operations
  NETWORK_ISOLATION = 'network-isolation',
  
  // File system errors cannot affect credential security
  FILESYSTEM_ISOLATION = 'filesystem-isolation',
  
  // UI errors cannot affect core operations
  UI_ISOLATION = 'ui-isolation',
  
  // Authentication errors cannot be recovered automatically
  AUTH_ISOLATION = 'auth-isolation',
}

// Error containment that prevents error propagation beyond boundaries
export class ErrorBoundaryViolation extends Error {
  constructor(
    public readonly boundary: ErrorBoundary,
    public readonly originalError: Error,
    public readonly context: Record<string, unknown>
  ) {
    super(`Error boundary violation: ${boundary}`);
    this.name = 'ErrorBoundaryViolation';
  }
}

// Defensive error handler that defines what errors CANNOT do
export class DefensiveErrorHandler {
  private static readonly errorCounts = new Map<string, number>();
  private static readonly maxErrorsPerType = 10;
  private static readonly circuitBreakerTimeout = 60000; // 1 minute
  private static readonly openCircuits = new Set<string>();

  // Errors cannot exceed these boundaries without triggering circuit breaker
  static readonly ERROR_LIMITS = {
    MAX_ERRORS_PER_MINUTE: 50,
    MAX_CONSECUTIVE_FAILURES: 5,
    MAX_ERROR_MESSAGE_LENGTH: 500,
    MAX_STACK_DEPTH: 20,
  } as const;

  // Handle errors within strict boundaries
  static async handleWithBoundary<T>(
    operation: () => Promise<T>,
    boundary: ErrorBoundary,
    context: Record<string, unknown> = {}
  ): Promise<T> {
    const errorType = `${boundary}-${context.operation || 'unknown'}`;
    
    // Cannot proceed if circuit breaker is open
    if (this.openCircuits.has(errorType)) {
      throw new ErrorBoundaryViolation(
        boundary,
        new Error('Circuit breaker open'),
        { ...context, reason: 'circuit-breaker' }
      );
    }

    try {
      const result = await operation();
      
      // Reset error count on success
      this.errorCounts.set(errorType, 0);
      
      return result;
      
    } catch (error) {
      return this.processErrorWithinBoundary(error, boundary, errorType, context);
    }
  }

  private static processErrorWithinBoundary<T>(
    error: unknown,
    boundary: ErrorBoundary,
    errorType: string,
    context: Record<string, unknown>
  ): never {
    const errorCount = (this.errorCounts.get(errorType) || 0) + 1;
    this.errorCounts.set(errorType, errorCount);

    // Circuit breaker: cannot allow unlimited failures
    if (errorCount >= this.maxErrorsPerType) {
      this.openCircuits.add(errorType);
      
      // Auto-reset circuit breaker
      setTimeout(() => {
        this.openCircuits.delete(errorType);
        this.errorCounts.set(errorType, 0);
      }, this.circuitBreakerTimeout);
    }

    const processedError = this.sanitizeError(error);
    
    // Apply boundary-specific error handling
    switch (boundary) {
      case ErrorBoundary.NETWORK_ISOLATION:
        throw this.handleNetworkError(processedError, context);
        
      case ErrorBoundary.FILESYSTEM_ISOLATION:
        throw this.handleFileSystemError(processedError, context);
        
      case ErrorBoundary.UI_ISOLATION:
        throw this.handleUIError(processedError, context);
        
      case ErrorBoundary.AUTH_ISOLATION:
        throw this.handleAuthError(processedError, context);
        
      default:
        throw new ErrorBoundaryViolation(boundary, processedError, context);
    }
  }

  // Sanitize errors to prevent information leakage
  private static sanitizeError(error: unknown): Error {
    if (error instanceof ConstraintViolationError) {
      // Constraint violations can pass through - they're designed to be safe
      return error;
    }

    if (error instanceof Error) {
      // Cannot expose sensitive information in error messages
      const sanitizedMessage = this.sanitizeMessage(error.message);
      const sanitizedError = new Error(sanitizedMessage);
      sanitizedError.name = error.name;
      
      // Cannot expose full stack traces in production
      if (process.env.NODE_ENV === 'production') {
        sanitizedError.stack = 'Stack trace hidden in production';
      } else {
        sanitizedError.stack = this.sanitizeStack(error.stack);
      }
      
      return sanitizedError;
    }

    // Cannot allow non-Error objects to propagate
    return new Error('Unknown error occurred');
  }

  private static sanitizeMessage(message: string): string {
    // Cannot expose paths, URLs, or other sensitive data
    const sanitized = message
      .replace(/\/[^\s]*\/[^\s]*/g, '[PATH_REDACTED]')
      .replace(/https?:\/\/[^\s]+/g, '[URL_REDACTED]')
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_REDACTED]')
      .replace(/password|token|key|secret/gi, '[CREDENTIAL_REDACTED]');

    // Cannot exceed maximum message length
    return sanitized.length > this.ERROR_LIMITS.MAX_ERROR_MESSAGE_LENGTH
      ? sanitized.substring(0, this.ERROR_LIMITS.MAX_ERROR_MESSAGE_LENGTH) + '...'
      : sanitized;
  }

  private static sanitizeStack(stack?: string): string {
    if (!stack) {
      return 'No stack trace available';
    }
    
    const lines = stack.split('\n');
    
    // Cannot expose deep stack traces
    const limitedLines = lines.slice(0, this.ERROR_LIMITS.MAX_STACK_DEPTH);
    
    // Cannot expose file paths in stack traces
    return limitedLines
      .map(line => line.replace(/\/[^\s]*\//g, '[PATH]/'))
      .join('\n');
  }

  // Network errors cannot affect other systems
  private static handleNetworkError(error: Error, context: Record<string, unknown>): Error {
    // Cannot retry certain network errors
    const nonRetryableErrors = ['CORS', 'Unauthorized', 'Forbidden'];
    if (nonRetryableErrors.some(type => error.message.includes(type))) {
      return new ConstraintViolationError(
        INVARIANTS.CANNOT_IGNORE_CORS_VIOLATIONS,
        { originalError: error.message, context }
      );
    }

    return new ErrorBoundaryViolation(ErrorBoundary.NETWORK_ISOLATION, error, context);
  }

  // File system errors cannot compromise security
  private static handleFileSystemError(error: Error, context: Record<string, unknown>): Error {
    // Cannot allow path traversal errors to propagate as-is
    if (error.message.includes('..') || error.message.includes('path')) {
      return new ConstraintViolationError(
        INVARIANTS.CANNOT_ACCESS_PARENT_DIRECTORIES,
        { context }
      );
    }

    return new ErrorBoundaryViolation(ErrorBoundary.FILESYSTEM_ISOLATION, error, context);
  }

  // UI errors cannot crash the extension
  private static handleUIError(error: Error, context: Record<string, unknown>): Error {
    // UI errors are contained and logged but don't propagate
    return new ErrorBoundaryViolation(ErrorBoundary.UI_ISOLATION, error, {
      ...context,
      severity: 'warning',
      recoverable: true
    });
  }

  // Authentication errors cannot be automatically recovered
  private static handleAuthError(error: Error, context: Record<string, unknown>): Error {
    // Cannot proceed with authentication failures
    return new ConstraintViolationError(
      INVARIANTS.CANNOT_OPERATE_WITHOUT_CREDENTIALS,
      { originalError: error.message, context, requiresUserAction: true }
    );
  }

  // Get error statistics (for monitoring, cannot expose sensitive data)
  static getErrorStatistics(): Record<string, unknown> {
    return {
      totalErrorTypes: this.errorCounts.size,
      openCircuits: Array.from(this.openCircuits),
      // Cannot expose actual error counts (could leak information)
      hasErrors: this.errorCounts.size > 0,
      timestamp: new Date().toISOString(),
    };
  }

  // Reset error boundaries (for testing or recovery)
  static resetBoundaries(): void {
    this.errorCounts.clear();
    this.openCircuits.clear();
  }
}