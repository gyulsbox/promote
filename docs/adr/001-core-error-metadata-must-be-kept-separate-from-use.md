# ADR-001: Separate Core Error Metadata from User-Declared Payload Data

## Status
Proposed

## Context
tRPC error handling requires maintaining a clear boundary between framework-managed error metadata and user-provided payload data. When core error properties (code, cause, name, stack) can be overwritten by user-declared data, runtime error state becomes desynchronized from the declared error shape, leading to unpredictable behavior and difficult-to-debug failures in error handling pipelines.

## Decision
Core error metadata (code, cause, name, stack) must be kept separate and protected from user-declared payload data. Error builders and handlers must not use shallow merge operations (Object.assign) that allow user data to overwrite framework properties. Instead, user payload must be explicitly nested or validated to prevent collision with reserved error fields.

## Consequences
- User-declared error data is isolated in a dedicated payload property, preventing accidental overwrites of core metadata
- Error handlers can safely rely on code, cause, name, and stack properties maintaining their runtime values
- Declared error shapes remain predictable and match their registered definitions throughout the error lifecycle
- Additional validation is required when constructing errors to ensure user data doesn't include reserved field names
- Error serialization and deserialization logic must explicitly handle the separation of metadata and payload layers
