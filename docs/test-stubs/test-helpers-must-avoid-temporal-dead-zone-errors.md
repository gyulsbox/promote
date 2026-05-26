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

    let subscription; // Declare BEFORE subscribe
    const errors: Error[] = [];

    expect(() => {
      subscription = source.subscribe({
        next: () => {},
        error: (err) => {
          errors.push(err);
          subscription?.unsubscribe(); // Safe to reference
        }
      });
    }).not.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('sync error');
  });
});
```
