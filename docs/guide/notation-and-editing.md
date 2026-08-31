# Notation & Editing

The **Write** activity is the main notation workspace. Use note input for new
music, then return to normal mode to select existing material and apply
commands, palettes, or inspector changes.

## Select musical material

- **Click** a note or notation item to select it.
- **Shift-click** extends the selection through the score.
- **Ctrl/Cmd-click** toggles individual items.
- Click empty staff space to select a measure.
- `Mod+A` selects all applicable material.

Arrow keys move the selection by event or staff. `Ctrl+Left` and `Ctrl+Right`
jump by measure; `Home` and `End` move to the first or last event in the
measure. `Alt+Left` and `Alt+Right` cycle through annotations attached to the
current event. Hold `Shift` with an arrow to extend the selection by event or
staff.

## Apply common edits

The fastest commands act directly on the selection:

| Key       | Action                                        |
| --------- | --------------------------------------------- |
| `S`       | Toggle a slur                                 |
| `T`       | Toggle a tie to the next note                 |
| `F`       | Flip direction or above/below placement       |
| `R`       | Repeat the selection immediately after itself |
| `.`       | Toggle an augmentation dot                    |
| `Shift+T` | Set tempo at the selection                    |
| `Shift+X` | Add staff text                                |
| `Delete`  | Replace selected rhythmic events with rests   |

Pitch transposition follows one vertical-arrow grammar in normal and note-input
modes:

| Key                           | Transposition             |
| ----------------------------- | ------------------------- |
| `Alt+↑` / `Alt+↓`             | Diatonic step             |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Chromatic step (semitone) |
| `Mod+Alt+↑` / `Mod+Alt+↓`     | Octave                    |

Use **Edit → Transpose Selection…** when you need a named interval or more
control than the direct arrow-key transposition commands.

## Palettes and radial menus

The left panel contains notation palettes and clipboard history. Palettes are
useful when you want to browse available symbols; radial menus are faster once
you know the category shortcut.

| Shortcut  | Category                  |
| --------- | ------------------------- |
| `Shift+A` | Articulations             |
| `Shift+B` | Barlines                  |
| `Shift+C` | Clefs                     |
| `Shift+D` | Dynamics                  |
| `Shift+E` | Ornaments and expressions |
| `Shift+F` | Fingerings                |
| `Shift+H` | Breath marks and fermatas |
| `Shift+M` | Time signatures           |
| `Shift+R` | Repeats                   |
| `Shift+3` | Tuplets                   |
| `Shift+5` | Key signatures            |

Choose an item from a radial menu to apply it to the current selection. The
same commands remain available from the palettes when you prefer a persistent
visual list.

## Inspector

The right inspector changes properties of the selected item. The available
controls depend on what is selected: notes expose pitch and notation
properties, while slurs, barlines, text, and other annotations expose their own
specialized controls.

Use direct shortcuts for frequent actions and the inspector for precise or
less common properties. Both edit the same MNX document and participate in
undo and redo.

## Clipboard history

Copy and paste use MNX-aware score fragments rather than pixels. The
**History** tab in the left panel retains recent copied fragments and shows a
musical preview, making it useful when reusing several passages.

## Jump bar

Press `Mod+Space` to open the jump bar. It can:

- run editor commands;
- switch activities such as Setup, Play, Picture, or Publish;
- jump to a measure or rehearsal mark;
- switch between score and instrumental-part views;
- open a specific Settings category or Help.

Type a few characters to filter the list, use the arrow keys to choose a
result, and press `Enter`. For direct navigation, type `m12` or `b12` for
measure 12, or `rA` for rehearsal mark A.

For entering new notes, see [Note Entry](/docs/note-entry). For the complete
binding list, see [Keyboard & Mouse](/docs/keyboard-shortcuts).
