# The recording at the top of the readme, as a script rather than a lucky take.
#
#   brew install vhs        # or see https://github.com/charmbracelet/vhs
#   vhs docs/demo.tape      # from the repository root
#
# `Type@220ms` is a speed modifier on the command. Written as `Type "@220ms"` it is a
# string to type, which is how an earlier take sent `@220ms` to the pane as keystrokes.
#
# The size is chosen rather than guessed: 1130x620 with Menlo at 13 is 134 columns by
# 38 rows, which lands the pane in its middle layout — the file panel beside a unified
# diff. Two columns want 160, which makes a GIF nobody wants to download to read a
# readme. `stty size` under vhs is how to check that again after changing any of it.

Output docs/demo.gif

Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 13
Set Width 1130
Set Height 620
Set Padding 14
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

# Building the repository is not part of what is being shown
Hide
Type `PLUGIN=$PWD && . "$PLUGIN/docs/demo-repo.sh" && clear` Enter
Sleep 3s
Type `node "$PLUGIN/bin/review.js"` Enter
Sleep 3s
Show

Sleep 1500ms

# j and k move the cursor down the lines, always. The band follows it, and the row
# under the header holds whichever function it is inside.
Type@220ms "jjjjjjjjjj"
Sleep 1600ms

# n and p move the file list, always. Neither key takes a turn at being the other.
Type "n"
Sleep 1400ms
Type "p"
Sleep 1400ms

# Mark the run the comment is about, then write it
Type "v"
Sleep 600ms
Type@220ms "jjj"
Sleep 900ms
Type "c"
Sleep 700ms
Type "A template literal reads better. Check the callers that passed a number."
Sleep 1000ms
Enter
Sleep 1400ms

# A second comment, on one line rather than a run
Type@220ms "jjjjjj"
Sleep 900ms
Type "c"
Sleep 700ms
Type "map is right. Does anything rely on the old array being mutable?"
Sleep 1000ms
Enter
Sleep 1600ms

# S opens the batch rather than sending it: everything chosen, space to leave one out,
# Enter to send what is left into the agent's input — where it is not submitted.
Type "S"
Sleep 2s
Type "j"
Sleep 800ms
Type " "
Sleep 1200ms
Type " "
Sleep 1000ms
Enter
Sleep 3500ms
