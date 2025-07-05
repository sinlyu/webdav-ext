/**
 * Boundary Interfaces - Negative Space Programming
 * 
 * These interfaces define what implementations CANNOT violate,
 * rather than prescriptive implementations.
 */

import { ConstraintViolationError } from '../constraints';

// Boundary that prevents credential exposure
export interface SecureCredentialBoundary {
  // Operations that MUST NOT expose credentials
  readonly cannotLog: true;
  readonly cannotSerialize: true;
  readonly cannotCache: true;
  
  // Only safe operations are allowed
  readonly safeOperations: {
    validate(): boolean;
    hash(): string;
    isExpired(): boolean;
  };
}

// Boundary that prevents unsafe file operations
export interface FileSystemBoundary {
  // Operations that MUST NOT be performed
  readonly cannotTraversePaths: true;
  readonly cannotAccessSystemFiles: true;
  readonly cannotWriteArbitraryLocations: true;
  
  // Only constrained operations allowed
  readonly constrainedOperations: {
    validatePath(path: string): string | never;
    checkPermissions(operation: 'read' | 'write' | 'delete'): boolean;
    enforceQuota(size: number): void | never;
  };
}

// Boundary that prevents network abuse
export interface NetworkBoundary {
  readonly cannotRetryIndefinitely: true;
  readonly cannotIgnoreTimeouts: true;
  readonly cannotBypassCORS: true;
  
  readonly protectedOperations: {
    enforceTimeout(ms: number): void | never;
    limitRetries(attempt: number): void | never;
    validateOrigin(url: string): void | never;
  };
}

// State boundary that prevents invalid transitions
export interface StateBoundary<T extends string> {
  readonly currentState: T;
  readonly cannotTransitionTo: Set<T>;
  
  // Only valid transitions allowed
  transitionTo(newState: T): void | never;
  isValidTransition(to: T): boolean;
}

// Abstract base for all bounded operations
export abstract class BoundedOperation {
  // Every operation must define its constraints
  abstract readonly constraints: readonly string[];
  abstract readonly maxExecutionTime: number;
  abstract readonly requiredPermissions: readonly string[];
  
  // Defensive execution wrapper
  protected async executeSafely<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      // Enforce time boundary
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(
          new ConstraintViolationError('Operation timeout exceeded', { 
            context, 
            maxTime: this.maxExecutionTime 
          })
        ), this.maxExecutionTime);
      });
      
      // Race between operation and timeout
      return await Promise.race([operation(), timeoutPromise]);
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Re-throw with boundary context
      if (error instanceof ConstraintViolationError) {
        throw error;
      }
      
      throw new ConstraintViolationError('Operation failed within boundary', {
        context,
        duration,
        originalError: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Validate operation can proceed
  protected validateCanProceed(): void | never {
    for (const constraint of this.constraints) {
      if (!this.checkConstraint(constraint)) {
        throw new ConstraintViolationError(`Constraint not satisfied: ${constraint}`);
      }
    }
  }
  
  // Each implementation must define how to check constraints
  protected abstract checkConstraint(constraint: string): boolean;
}

// Boundary-aware provider interface
export interface BoundaryAwareProvider extends 
  SecureCredentialBoundary, 
  FileSystemBoundary, 
  NetworkBoundary {
  
  // Provider cannot operate outside these boundaries
  readonly operationalBoundaries: {
    readonly maxConcurrentOperations: number;
    readonly allowedMimeTypes: readonly string[];
    readonly forbiddenPaths: readonly string[];
  };
  
  // All operations must go through boundary validation
  validateOperation(operation: string, params: unknown): void | never;
  
  // Resource cleanup cannot be skipped
  cleanup(): Promise<void>;
}

// Factory that ensures all providers respect boundaries
export class BoundaryEnforcedFactory {
  private static readonly registeredProviders = new Map<string, () => BoundaryAwareProvider>();
  
  // Cannot create providers that don't implement boundaries
  static register<T extends BoundaryAwareProvider>(
    name: string,
    factory: () => T
  ): void {
    // Validate factory produces boundary-aware instance
    const instance = factory();
    if (!this.validateBoundaryCompliance(instance)) {
      throw new ConstraintViolationError('Provider does not implement required boundaries', { name });
    }
    
    this.registeredProviders.set(name, factory);
  }
  
  // Create provider with automatic boundary enforcement
  static create<T extends BoundaryAwareProvider>(name: string): T {
    const factory = this.registeredProviders.get(name);
    if (!factory) {
      throw new ConstraintViolationError('Unknown provider type', { name });
    }
    
    const provider = factory() as T;
    
    // Wrap with boundary enforcement proxy
    return this.wrapWithBoundaryEnforcement(provider);
  }
  
  private static validateBoundaryCompliance(provider: any): provider is BoundaryAwareProvider {
    return (
      provider.cannotLog === true &&
      provider.cannotSerialize === true &&
      provider.cannotCache === true &&
      provider.cannotTraversePaths === true &&
      provider.cannotAccessSystemFiles === true &&
      provider.cannotWriteArbitraryLocations === true &&
      provider.cannotRetryIndefinitely === true &&
      provider.cannotIgnoreTimeouts === true &&
      provider.cannotBypassCORS === true &&
      typeof provider.validateOperation === 'function' &&
      typeof provider.cleanup === 'function'
    );
  }
  
  private static wrapWithBoundaryEnforcement<T extends BoundaryAwareProvider>(provider: T): T {
    return new Proxy(provider, {
      get(target, prop) {
        const value = target[prop as keyof T];
        
        // Intercept method calls to enforce boundaries
        if (typeof value === 'function') {
          return function(this: T, ...args: any[]) {
            // Validate operation before execution
            target.validateOperation(String(prop), args);
            
            // Execute with boundary context
            return (value as Function).apply(this, args);
          };
        }
        
        return value;
      },
      
      set(target, prop, value) {
        // Prevent modification of boundary properties
        if (typeof prop === 'string' && prop.startsWith('cannot')) {
          throw new ConstraintViolationError('Boundary properties are immutable', { property: prop });
        }
        
        (target as any)[prop] = value;
        return true;
      }
    });
  }
}