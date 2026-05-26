## TypeScript Non-Null Assertions

- **Never use non-null assertions (`!`)** in TypeScript code; they bypass type safety and hide potential runtime errors
- **Use explicit type guards** instead: check with `if (value !== null && value !== undefined)` or `if (value)` before accessing properties
- **Use optional chaining (`?.`)** for safe property access on potentially null/undefined values (e.g., `obj?.property?.nested`)
- **Use nullish coalescing (`??`)** to provide default values instead of asserting non-null (e.g., `value ?? defaultValue`)
- **Apply this rule across all TypeScript files** including `src/`, `tests/`, and configuration files; no exceptions for "obvious" cases


## Parameter Destructuring

- Do not destructure objects directly in function parameter declarations; use property access instead
- Access object properties within the function body using dot notation (e.g., `options.property`) rather than destructuring in the function signature
- Apply this rule consistently across all function types: callbacks, handlers, utility functions, and test helpers
- This includes destructuring in arrow functions, regular functions, and callback parameters
- Refactor existing code that uses parameter destructuring to follow this pattern for consistency across the codebase
