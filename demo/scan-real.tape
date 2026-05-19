# promote scan — real execution
Output demo/scan.gif
Set FontSize 14
Set Width 1000
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 40ms
Set Shell zsh

# Source env so API keys are available
Type "source ~/.zshrc 2>/dev/null; export ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
Enter
Sleep 500ms

Type "npx tsx src/index.ts scan --repo trpc/trpc --since 60d"
Enter

# Wait for full scan (LLM calls ~3min)
Sleep 300s

# Choose "No, digest only"
Down 1
Sleep 500ms
Enter

Sleep 3s
