---
applyTo: "packages/server/src/unstable-core-do-not-import/http/**"
---
# maxBatchSize Parameter Validation

- Validate `maxBatchSize` as a finite positive integer using `Number.isFinite(maxBatchSize) && maxBatchSize > 0 && Number.isInteger(maxBatchSize)`
- Reject `NaN`, `Infinity`, negative numbers, zero, and non-integer values with a descriptive error message
- Avoid relying solely on `typeof maxBatchSize === 'number'` as it incorrectly accepts `NaN` and `Infinity`
- Test that invalid values (`NaN`, `Infinity`, -1, 0, 1.5) throw or are rejected before runtime comparisons
- Place validation at the entry point of functions accepting `maxBatchSize` to prevent downstream limit-enforcement failures
