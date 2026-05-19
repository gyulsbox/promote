# promote CLI demo
# Run: vhs demo/demo.tape

Output demo/demo.gif
Set FontSize 14
Set Width 1200
Set Height 800
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 50ms

# Title
Type "# promote — Pick up lost decisions from AI review comments"
Enter
Sleep 1s

# Init
Type "npx promote-cli init"
Enter
Sleep 3s

# Show scan
Hide
Type "q"
Enter
Sleep 500ms
Show

Type "# Scan a repo for repeated AI review patterns"
Enter
Sleep 500ms

Type "npx promote-cli scan --repo trpc/trpc --since 60d"
Enter
Sleep 40s

# Wait for results
Sleep 5s

# Show digest option
Type "n"
Enter
Sleep 2s

# Show the digest
Type "cat .promote/digests/2026-05-*.md | head -40"
Enter
Sleep 5s
