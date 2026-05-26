## TypeScript Non-Null Assertions

- **Avoid non-null assertions (`!`)** in all TypeScript code; they bypass type safety and hide potential runtime errors
- **Use explicit type guards** instead: check with `if (value !== null && value !== undefined)` or `if (value)` before accessing properties
- **Use optional chaining (`?.`)** for safe property access on potentially null/undefined values (e.g., `obj?.property?.method()`)
- **Use nullish coalescing (`??`)** to provide default values instead of asserting non-null (e.g., `value ?? defaultValue`)
- **Apply to all files** including utility functions, client code, and array operations (e.g., replace `array.pop()!` with explicit length checks)


## Parameter Destructuring

- Do not destructure objects directly in function parameter declarations; use property access on the parameter object instead
- Apply this rule to all function types: callbacks, event handlers, utility functions, and API methods
- Instead of `function handler({ prop1, prop2 })`, write `function handler(obj) { const prop1 = obj.prop1; }`
- This applies across all packages and test files in the repository
- Exception: destructuring in function bodies is acceptable; only parameter-level destructuring is prohibited
