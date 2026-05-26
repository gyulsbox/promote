# Test Import Validation Invariant

## Test File Location
`tests/invariants/vitest-imports.test.ts`

## What the Test Should Assert

The test should verify that all Vitest utility functions used within a test file are explicitly imported from the `vitest` package. Specifically:
- Scan test files for usage of Vitest functions (`describe`, `it`, `expect`, `beforeAll`, `beforeEach`, `afterAll`, `afterEach`, `test`, `vi`)
- Verify that each used function appears in the import statement from `vitest`
- Fail if any Vitest function is used without being imported
- Report the line number and function name for each missing import

## Code Sketch

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Vitest Import Validation', () => {
  it('should ensure all used Vitest functions are imported', () => {
    const testFilesPattern = '**/*.test.ts';
    const vitestFunctions = [
      'describe', 'it', 'test', 'expect', 
      'beforeAll', 'beforeEach', 'afterAll', 'afterEach', 'vi'
    ];
    
    // Scan test files
    // Extract import statements
    // Extract function usages
    // Assert: usages ⊆ imports
    
    expect(missingImports).toEqual([]);
  });
});
```
