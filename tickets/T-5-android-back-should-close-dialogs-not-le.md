---
id: T-5
title: Android Back should close dialogs, not leave the game
status: todo
priority: low
labels: []
depends: []
created: 2026-10-05T06:34:02Z
updated: 2026-10-05T06:34:02Z
---
Found in spec review for arcs/T-4: Settings, Rules (and the coming Scoreboard) push no history entry, so system Back with a dialog open leaves the game. Users expect Back to close the dialog.

## Done when
- [ ] With any dialog open on a phone, Back closes the dialog and the game stays open
- [ ] Back with no dialog open behaves as today
