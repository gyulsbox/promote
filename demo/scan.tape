# promote scan demo — replayed from real data
Output demo/scan.gif
Set FontSize 14
Set Width 1000
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 20
Set Shell bash

# Run replay script directly (it handles everything including the command line)
Hide
Type "bash demo/replay.sh"
Enter
Sleep 500ms
Show

# Wait for full replay
Sleep 100s
