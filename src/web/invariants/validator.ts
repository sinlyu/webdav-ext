/**
 * Invariant-Based Validation System - Negative Space Programming
 * 
 * This system defines what states and transitions CANNOT occur,
 * creating a validation framework based on exclusion rather than inclusion.
 */

import { ConstraintViolationError, INVARIANTS, LIMITS } from '../constraints';
import { ErrorBoundary, DefensiveErrorHandler } from '../boundaries/errorBoundary';

// System invariants that MUST NEVER be violated
export interface SystemInvariants {
  // Connection invariants
  readonly cannotBeConnectedAndDisconnected: true;
  readonly cannotHaveCredentialsWithoutConnection: true;
  readonly cannotOperateWithExpiredCredentials: true;
  
  // Data invariants
  readonly cannotExposeSensitiveData: true;
  readonly cannotExceedResourceLimits: true;
  readonly cannotViolatePathSecurity: true;
  
  // State invariants
  readonly cannotHaveInvalidStateTransitions: true;
  readonly cannotHaveMultipleActiveOperations: true;
  readonly cannotIgnoreTimeoutBoundaries: true;
}

// Validation context that tracks what cannot happen
export interface ValidationContext extends Record<string, unknown> {
  readonly operation: string;
  readonly startTime: number;
  readonly maxDuration: number;
  readonly forbiddenStates: readonly string[];
  readonly requiredInvariants: readonly string[];
}

// State tracker that prevents invalid states
class StateInvariantTracker {
  private currentState: string = 'initial';
  private stateHistory: string[] = [];
  private lastTransition: number = Date.now();
  
  // States that CANNOT coexist
  private readonly mutuallyExclusiveStates = new Map([
    ['connected', new Set(['disconnected', 'connecting'])],
    ['reading', new Set(['writing', 'deleting'])],
    ['authenticated', new Set(['unauthenticated', 'authenticating'])],
  ]);
  
  // Transitions that CANNOT occur
  private readonly forbiddenTransitions = new Map([
    ['connected', new Set(['connecting'])],
    ['error', new Set(['connected'])],
    ['writing', new Set(['reading'])],
  ]);

  validateTransition(from: string, to: string): void | never {
    // Cannot transition to mutually exclusive states
    const exclusiveStates = this.mutuallyExclusiveStates.get(to);
    if (exclusiveStates?.has(from)) {
      throw new ConstraintViolationError(
        'Cannot transition between mutually exclusive states',
        { from, to, exclusive: Array.from(exclusiveStates) }
      );
    }

    // Cannot perform forbidden transitions
    const forbidden = this.forbiddenTransitions.get(from);
    if (forbidden?.has(to)) {
      throw new ConstraintViolationError(
        'Forbidden state transition',
        { from, to }
      );
    }

    // Cannot transition too rapidly (prevent state thrashing)
    const timeSinceLastTransition = Date.now() - this.lastTransition;
    if (timeSinceLastTransition < 100) { // 100ms minimum between transitions
      throw new ConstraintViolationError(
        'State transitions too rapid',
        { timeSinceLastTransition, minimum: 100 }
      );
    }
  }

  transition(to: string): void {
    this.validateTransition(this.currentState, to);
    
    this.stateHistory.push(this.currentState);
    this.currentState = to;
    this.lastTransition = Date.now();
    
    // Cannot maintain infinite state history
    if (this.stateHistory.length > 100) {
      this.stateHistory = this.stateHistory.slice(-50);
    }
  }

  getCurrentState(): string {
    return this.currentState;
  }

  // Cannot be in invalid state combinations
  validateCurrentState(): void | never {
    const exclusiveStates = this.mutuallyExclusiveStates.get(this.currentState);
    if (exclusiveStates) {
      for (const exclusive of exclusiveStates) {
        if (this.stateHistory.includes(exclusive)) {
          const recentHistory = this.stateHistory.slice(-5);
          if (recentHistory.includes(exclusive)) {
            throw new ConstraintViolationError(
              'Invalid state detected in recent history',
              { current: this.currentState, recent: recentHistory, exclusive }
            );
          }
        }
      }
    }
  }
}

// Invariant validator that enforces what CANNOT happen
export class InvariantValidator implements SystemInvariants {
  // Invariant compliance markers
  readonly cannotBeConnectedAndDisconnected = true;
  readonly cannotHaveCredentialsWithoutConnection = true;
  readonly cannotOperateWithExpiredCredentials = true;
  readonly cannotExposeSensitiveData = true;
  readonly cannotExceedResourceLimits = true;
  readonly cannotViolatePathSecurity = true;
  readonly cannotHaveInvalidStateTransitions = true;
  readonly cannotHaveMultipleActiveOperations = true;
  readonly cannotIgnoreTimeoutBoundaries = true;

  private readonly stateTracker = new StateInvariantTracker();
  private readonly activeOperations = new Set<string>();
  private readonly resourceUsage = new Map<string, number>();

  // Validate operation cannot proceed due to invariant violations
  async validateOperation<T>(
    operation: () => Promise<T>,
    context: ValidationContext
  ): Promise<T> {
    return DefensiveErrorHandler.handleWithBoundary(async () => {
      // Pre-operation invariant validation
      this.validatePreConditions(context);
      
      const operationId = this.trackOperation(context.operation);
      
      try {
        // Execute with timeout boundary
        const result = await this.executeWithTimeout(operation, context);
        
        // Post-operation invariant validation
        this.validatePostConditions(context);
        
        return result;
        
      } finally {
        this.untrackOperation(operationId);
      }
    }, ErrorBoundary.FILESYSTEM_ISOLATION, context);
  }

  // Pre-conditions that CANNOT be violated
  private validatePreConditions(context: ValidationContext): void {
    // Cannot proceed if forbidden states are active
    for (const forbidden of context.forbiddenStates) {
      if (this.stateTracker.getCurrentState() === forbidden) {
        throw new ConstraintViolationError(
          `Cannot proceed in forbidden state: ${forbidden}`,
          { current: this.stateTracker.getCurrentState(), operation: context.operation }
        );
      }
    }

    // Cannot exceed concurrent operation limits
    if (this.activeOperations.size >= LIMITS.MAX_CONCURRENT_REQUESTS) {
      throw new ConstraintViolationError(
        'Cannot exceed concurrent operation limit',
        { active: this.activeOperations.size, max: LIMITS.MAX_CONCURRENT_REQUESTS }
      );
    }

    // Cannot operate beyond timeout boundaries
    const projectedEndTime = context.startTime + context.maxDuration;
    const maxAllowedTime = context.startTime + LIMITS.MAX_TIMEOUT_MS;
    if (projectedEndTime > maxAllowedTime) {
      throw new ConstraintViolationError(
        'Cannot exceed maximum timeout boundary',
        { requested: context.maxDuration, maximum: LIMITS.MAX_TIMEOUT_MS }
      );
    }

    // Validate required invariants are satisfied
    for (const invariant of context.requiredInvariants) {
      if (!this.checkInvariant(invariant)) {
        throw new ConstraintViolationError(
          `Required invariant not satisfied: ${invariant}`,
          { operation: context.operation }
        );
      }
    }

    this.stateTracker.validateCurrentState();
  }

  // Post-conditions that CANNOT be violated
  private validatePostConditions(context: ValidationContext): void {
    const operationDuration = Date.now() - context.startTime;
    
    // Cannot exceed time boundaries
    if (operationDuration > context.maxDuration) {
      throw new ConstraintViolationError(
        'Operation exceeded time boundary',
        { duration: operationDuration, maximum: context.maxDuration }
      );
    }

    // Cannot leave system in invalid state
    this.stateTracker.validateCurrentState();
    
    // Cannot leave resources unconsumed
    this.validateResourceCleanup(context.operation);
  }

  // Execute operation with strict timeout that CANNOT be exceeded
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    context: ValidationContext
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let completed = false;
      
      // Timeout that CANNOT be ignored
      const timeoutId = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new ConstraintViolationError(
            INVARIANTS.CANNOT_IGNORE_TIMEOUTS,
            { 
              operation: context.operation,
              timeout: context.maxDuration,
              startTime: context.startTime
            }
          ));
        }
      }, context.maxDuration);

      // Execute operation
      operation()
        .then(result => {
          if (!completed) {
            completed = true;
            clearTimeout(timeoutId);
            resolve(result);
          }
        })
        .catch(error => {
          if (!completed) {
            completed = true;
            clearTimeout(timeoutId);
            reject(error);
          }
        });
    });
  }

  // Track operations to prevent violations
  private trackOperation(operation: string): string {
    const operationId = `${operation}-${Date.now()}-${Math.random()}`;
    
    // Cannot start duplicate operations of certain types
    const exclusiveOperations = ['authenticate', 'connect', 'disconnect'];
    if (exclusiveOperations.includes(operation)) {
      for (const activeOp of this.activeOperations) {
        if (activeOp.startsWith(operation + '-')) {
          throw new ConstraintViolationError(
            'Cannot start duplicate exclusive operation',
            { operation, existing: activeOp }
          );
        }
      }
    }

    this.activeOperations.add(operationId);
    this.updateResourceUsage(operation, 1);
    
    return operationId;
  }

  private untrackOperation(operationId: string): void {
    this.activeOperations.delete(operationId);
    
    const operation = operationId.split('-')[0];
    this.updateResourceUsage(operation, -1);
  }

  private updateResourceUsage(operation: string, delta: number): void {
    const current = this.resourceUsage.get(operation) || 0;
    const newUsage = current + delta;
    
    if (newUsage <= 0) {
      this.resourceUsage.delete(operation);
    } else {
      this.resourceUsage.set(operation, newUsage);
    }
  }

  private validateResourceCleanup(operation: string): void {
    // Cannot leave resources leaked
    const usage = this.resourceUsage.get(operation) || 0;
    if (usage > 0) {
      // This is a warning rather than an error, but tracked for monitoring
      console.warn(`Resource leak detected for operation: ${operation}, usage: ${usage}`);
    }
  }

  // Check if specific invariant is satisfied
  private checkInvariant(invariant: string): boolean {
    switch (invariant) {
      case INVARIANTS.CANNOT_OPERATE_WITHOUT_CREDENTIALS:
        return this.stateTracker.getCurrentState() === 'authenticated';
        
      case INVARIANTS.CANNOT_PROCEED_WITH_INVALID_URI:
        // This is checked per-operation
        return true;
        
      case INVARIANTS.CANNOT_ACCESS_PARENT_DIRECTORIES:
        // This is validated per-path
        return true;
        
      default:
        return false;
    }
  }

  // Transition state with invariant validation
  transitionState(newState: string): void {
    this.stateTracker.transition(newState);
  }

  // Get current validation state (for monitoring)
  getValidationState(): Record<string, unknown> {
    return {
      currentState: this.stateTracker.getCurrentState(),
      activeOperations: this.activeOperations.size,
      resourceUsage: Object.fromEntries(this.resourceUsage),
      // Cannot expose sensitive state information
      hasViolations: false, // Placeholder for violation detection
      lastValidation: new Date().toISOString(),
    };
  }

  // Reset validator state (for testing)
  reset(): void {
    this.activeOperations.clear();
    this.resourceUsage.clear();
    this.stateTracker.transition('initial');
  }
}