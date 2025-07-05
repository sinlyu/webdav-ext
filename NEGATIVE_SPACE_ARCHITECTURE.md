# Negative Space Programming Architecture

This document describes the implementation of **Negative Space Programming** principles in the WebDAV extension, where the system is defined by what it **CANNOT** do rather than what it can do.

## Core Philosophy

> *"Programming by exclusion: Define the boundaries of what cannot happen, and let valid operations emerge in the remaining space."*

Instead of prescriptively defining every possible operation, this architecture creates a safe operational space by establishing constraints, boundaries, and invariants that **cannot** be violated.

## Architecture Overview

```
src/web/
├── 🚫 constraints/           # What the system CANNOT do
│   └── index.ts             # System-wide constraints and limits
├── 🛡️ boundaries/            # Operational boundaries that CANNOT be crossed
│   ├── interfaces.ts        # Boundary-aware interfaces
│   └── errorBoundary.ts     # Error containment boundaries
├── ⚖️ invariants/            # Rules that CANNOT be violated
│   └── validator.ts         # Invariant validation system
├── 🔒 providers/             # Boundary-compliant implementations
│   └── boundedWebdavProvider.ts  # WebDAV provider with constraints
└── negativeSpaceExtension.ts     # Main negative space entry point
```

## Key Principles

### 1. **Constraint-Based Design** 🚫

The system defines what **CANNOT** happen:

```typescript
export const INVARIANTS = {
  CANNOT_OPERATE_WITHOUT_CREDENTIALS: 'Operations forbidden without valid credentials',
  CANNOT_PROCEED_WITH_INVALID_URI: 'Malformed URIs must be rejected',
  CANNOT_ACCESS_PARENT_DIRECTORIES: 'Path traversal attacks forbidden',
  CANNOT_IGNORE_TIMEOUTS: 'Timeout boundaries must be respected',
} as const;
```

### 2. **Boundary Enforcement** 🛡️

Operations are contained within strict boundaries:

```typescript
export interface BoundaryAwareProvider {
  // What the provider CANNOT do
  readonly cannotLog: true;
  readonly cannotSerialize: true;
  readonly cannotCache: true;
  readonly cannotTraversePaths: true;
  readonly cannotAccessSystemFiles: true;
  readonly cannotWriteArbitraryLocations: true;
}
```

### 3. **Invariant Validation** ⚖️

System state is maintained by preventing violations:

```typescript
// Cannot proceed if forbidden states are active
for (const forbidden of context.forbiddenStates) {
  if (this.stateTracker.getCurrentState() === forbidden) {
    throw new ConstraintViolationError(`Cannot proceed in forbidden state: ${forbidden}`);
  }
}
```

### 4. **Defensive Error Handling** 🛡️

Errors are contained and cannot propagate beyond boundaries:

```typescript
export enum ErrorBoundary {
  NETWORK_ISOLATION = 'network-isolation',     // Network errors cannot affect file system
  FILESYSTEM_ISOLATION = 'filesystem-isolation', // File errors cannot affect credentials
  UI_ISOLATION = 'ui-isolation',               // UI errors cannot affect core operations
  AUTH_ISOLATION = 'auth-isolation',           // Auth errors cannot be auto-recovered
}
```

## Implementation Examples

### Constraint-Based File Operations

```typescript
async readFile(uri: vscode.Uri): Promise<Uint8Array> {
  return this.executeSafely(async () => {
    // CANNOT proceed without validation
    this.validateOperation('readFile', { uri });
    
    // CANNOT operate without credentials
    const credentials = Constraints.rejectUnauthenticated(this._credentials);
    
    // CANNOT access unsafe paths
    const safePath = Constraints.rejectUnsafePath(uri.path);
    
    const content = await this.performReadFile(safePath, credentials);
    
    // CANNOT return oversized content
    return Constraints.rejectOversizedContent(content);
  }, 'readFile');
}
```

### Boundary-Aware State Management

```typescript
class StateInvariantTracker {
  // States that CANNOT coexist
  private readonly mutuallyExclusiveStates = new Map([
    ['connected', new Set(['disconnected', 'connecting'])],
    ['reading', new Set(['writing', 'deleting'])],
  ]);
  
  validateTransition(from: string, to: string): void | never {
    const exclusiveStates = this.mutuallyExclusiveStates.get(to);
    if (exclusiveStates?.has(from)) {
      throw new ConstraintViolationError('Cannot transition between mutually exclusive states');
    }
  }
}
```

### Error Boundary Isolation

```typescript
// Network errors CANNOT affect other systems
private static handleNetworkError(error: Error, context: Record<string, unknown>): Error {
  const nonRetryableErrors = ['CORS', 'Unauthorized', 'Forbidden'];
  if (nonRetryableErrors.some(type => error.message.includes(type))) {
    return new ConstraintViolationError(INVARIANTS.CANNOT_IGNORE_CORS_VIOLATIONS);
  }
  return new ErrorBoundaryViolation(ErrorBoundary.NETWORK_ISOLATION, error, context);
}
```

## Benefits of Negative Space Programming

### 🔒 **Enhanced Security**
- Operations are secure by default - only explicitly allowed actions can proceed
- Path traversal, credential exposure, and other attacks are prevented by design
- Error messages cannot leak sensitive information

### 🛡️ **Robustness**
- System cannot enter invalid states due to invariant enforcement
- Circuit breakers prevent cascading failures
- Resource limits prevent system abuse

### 🎯 **Predictability**
- Behavior is deterministic within the defined constraints
- Edge cases are handled by boundary validation
- State transitions are controlled and validated

### 🔧 **Maintainability**
- Adding new features requires defining their constraints
- Bug fixes involve strengthening boundaries rather than patching symptoms
- Testing focuses on boundary violations rather than exhaustive feature testing

## Usage Patterns

### Adding New Operations

1. **Define Constraints**: What CANNOT happen during this operation?
2. **Set Boundaries**: What limits must be respected?
3. **Validate Invariants**: What system state rules apply?
4. **Implement Defensively**: How should errors be contained?

```typescript
async newOperation(params: any): Promise<Result> {
  return this.executeSafely(async () => {
    // Step 1: Validate constraints
    this.validateOperation('newOperation', params);
    
    // Step 2: Apply boundaries
    const safeParams = this.validateBoundaries(params);
    
    // Step 3: Check invariants
    this.enforceInvariants(['CANNOT_VIOLATE_X', 'CANNOT_IGNORE_Y']);
    
    // Step 4: Execute within error boundary
    return this.performOperation(safeParams);
  }, 'newOperation');
}
```

### Testing Negative Space

Tests focus on **what should NOT be possible**:

```typescript
test('cannot operate without credentials', async () => {
  const provider = new BoundedWebDAVProvider(mockLogger);
  await expect(provider.readFile(mockUri))
    .rejects.toThrow(ConstraintViolationError);
});

test('cannot exceed timeout boundaries', async () => {
  const longOperation = () => new Promise(resolve => setTimeout(resolve, 60000));
  await expect(validator.validateOperation(longOperation, shortTimeoutContext))
    .rejects.toThrow('Operation exceeded time boundary');
});
```

## Migration Guide

To adopt negative space programming principles:

1. **Identify Current Constraints**: What rules already exist in your code?
2. **Extract Boundaries**: What limits are implicitly enforced?
3. **Define Invariants**: What states should never occur?
4. **Implement Defensively**: How can errors be contained?
5. **Validate Boundaries**: Add runtime constraint checking

## Conclusion

Negative Space Programming creates robust, secure, and maintainable systems by defining the boundaries of what cannot happen, allowing valid operations to emerge naturally within the safe operational space. This approach is particularly valuable for security-critical applications, distributed systems, and complex state management scenarios.

The WebDAV extension serves as a practical demonstration of these principles, showing how constraint-based design can create more reliable software through defensive programming patterns.