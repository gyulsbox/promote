# promote scan demo (simulated output)
Output demo/scan.gif
Set FontSize 14
Set Width 1000
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 30ms
Set Shell zsh

# Scan command
Type "promote scan --repo trpc/trpc --since 60d"
Enter
Sleep 1s

# Simulated output
Type@0ms ""
Sleep 500ms

# Print simulated scan output line by line
Type@0ms '  (*o*) > Scanning trpc/trpc (last 60 days)'
Enter
Type@0ms '──────────────────────────────────────────────────'
Enter
Sleep 300ms
Type@0ms '✔ Fetched 179 review comments'
Enter
Type@0ms '  AI reviewer comments: 158'
Enter
Type@0ms '  Human comments: 21'
Enter
Type@0ms '  Actionable AI comments: 154'
Enter
Type@0ms '  Noise filtered: 4'
Enter
Sleep 300ms
Type@0ms '✔ Normalized 154 comments'
Enter
Type@0ms '  PRs scanned: 29'
Enter
Sleep 300ms
Type@0ms '✔ Found 94 clusters (LLM direct) (38s)'
Enter
Type@0ms '  Repeated clusters: 13 (>= 3 occurrences)'
Enter
Type@0ms '──────────────────────────────────────────────────'
Enter
Sleep 300ms
Type@0ms '✔ No existing memory files found'
Enter
Sleep 400ms

# Classification results
Type@0ms '  [1/13] [path_scoped_rule] Use named imports for React hooks in test files (0.85)'
Enter
Sleep 200ms
Type@0ms '  [2/13] skip — Streaming response content-type inconsistency'
Enter
Sleep 200ms
Type@0ms '  [3/13] [test] createProxy valueOf/toString must not break chaining (0.85)'
Enter
Sleep 200ms
Type@0ms '  [4/13] skip — getRouterInputsHash O(n^2) performance issue'
Enter
Sleep 200ms
Type@0ms '  [5/13] [agents] Use placeholder paths in documentation examples (0.85)'
Enter
Sleep 200ms
Type@0ms '  [6/13] skip — Duplicate comment in same PR'
Enter
Sleep 200ms
Type@0ms '  [7/13] [agents] Avoid parameter destructuring in function signatures (0.85)'
Enter
Sleep 200ms
Type@0ms '  [8/13] [test] JsonValue schema must not use bare self-reference (0.85)'
Enter
Sleep 200ms
Type@0ms '  [9/13] skip — Typo correction: occured → occurred'
Enter
Sleep 200ms
Type@0ms '  [10/13] [agents] Avoid temporal dead zone in subscription helpers (0.85)'
Enter
Sleep 200ms
Type@0ms '  [11/13] [path_scoped_rule] bin entry must be included in files array (0.85)'
Enter
Sleep 200ms
Type@0ms '  [12/13] [path_scoped_rule] Do not expose generic intent binary name (0.95)'
Enter
Sleep 200ms
Type@0ms '  [13/13] [path_scoped_rule] bin files must exist before publishing (0.85)'
Enter
Sleep 300ms

Type@0ms '──────────────────────────────────────────────────'
Enter
Type@0ms '  Total tokens: 49090'
Enter
Type@0ms '  Estimated cost: $0.25'
Enter
Type@0ms '──────────────────────────────────────────────────'
Enter
Sleep 300ms
Type@0ms '  (^o^) > 8 candidate(s) found!'
Enter
Type@0ms '✓ Digest written to .promote/digests/2026-05-19.md'
Enter
Sleep 500ms

Type@0ms ''
Enter
Type@0ms '  path_scoped_rule: 4 candidate(s)'
Enter
Type@0ms '  agents: 3 candidate(s)'
Enter
Type@0ms '  test: 1 candidate(s)'
Enter

Sleep 3s
