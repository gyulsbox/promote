---
applyTo: "packages/openapi/**/serverSentEvents.gen.ts"
---
# Server-Sent Events Retry Logic

- Initialize `attempt` counter to 0, not 1, so the first connection attempt does not consume retry budget
- Exclude `AbortError` from retryable error conditions; treat aborts as intentional cancellations, not failures
- Increment `attempt` only after a failed request, not before the initial connection
- Validate that `sseMaxRetryAttempts: 1` allows exactly one retry after the initial attempt, not zero
- Use error type checking to distinguish between network failures (retryable) and user-initiated aborts (non-retryable)
