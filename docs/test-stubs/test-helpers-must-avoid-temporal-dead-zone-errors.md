# Test Helper Temporal Dead Zone Prevention

## Test File Location
`tests/helpers/subscription-helpers.test.ts`

## What the Test Should Assert

The test should verify that subscription test helpers safely handle synchronous `onError` callbacks without triggering ReferenceError due to temporal dead zone violations. Specifically:

1. When a source observable calls `onError` synchronously during the `subscribe()` call, the error callback should execute without referencing uninitialized variables
2. The subscription variable must be declared (with `let`) before the `subscribe()` call, ensuring it exists in scope even if the callback executes immediately
3. Error handling should complete successfully regardless of whether the error occurs synchronously or asynchronously

## Code Sketch

```typescript
describe('Subscription helpers - temporal dead zone safety', () => {
  it('should handle synchronous onError without ReferenceError', () => {
    const source = new Observable(subscriber => {
      subscriber.error(new Error('sync error'));
    });

    let errorCaught: Error | null = null;
    let subscription: Subscription; // Declared BEFORE subscribe()
    
    subscription = source.subscribe({
      next: () => {},
      error: (err) => {
        errorCaught = err;
        // This should not throw ReferenceError
        subscription?.unsubscribe();
      }
    });

    expect(errorCaught).toBeDefined();
    expect(errorCaught?.message).toBe('sync error');
  });

  it('should not reference subscription in TDZ', () => {
    // Verify pattern: let sub; ... sub = source.subscribe(...)
    // NOT: const sub = source.subscribe(...)
    expect(() => {
      let sub: Subscription;
      new Observable(s => s.error(new Error('test'))).subscribe({
        error: () => sub.unsubscribe() // Safe: sub declared before subscribe
      });
    }).not.toThrow(ReferenceError);
  });
});
```
