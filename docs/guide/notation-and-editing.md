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

Use **Edit → Transpose Selection** when you need a named interval or more
control than the direct arrow-key transposition commands.

## Spread chords across staves

Explode and reduce redistribute copied music at a destination without changing
the source.

| Command                                 | Key           | Effect                                                                       |
| --------------------------------------- | ------------- | ---------------------------------------------------------------------------- |
| **Edit → Explode to Staves**            | —             | Fans copied pitches out from the selected destination, top note on top staff |
| **Edit → Reduce to Staff**              | —             | Merges copied staves into chords on the selected destination staff           |
| **Edit → Select Top Note of Chords**    | —             | Narrows the selection to the highest notehead of every selected chord        |
| **Edit → Select Bottom Note of Chords** | —             | Narrows the selection to the lowest notehead of every selected chord         |
| **Edit → Paste and Merge**              | `Mod+Shift+V` | Pastes pitches _into_ the destination chords rather than replacing them      |

To use either command:

1. Select the source music and copy it.
2. Select the note, rest, rhythmic position, or measure where the result should
   begin.
3. Choose **Explode to Staves** or **Reduce to Staff** from the Edit menu.

Reduce pools simultaneous pitches from all copied staves and writes them as
chords on one destination staff. Explode works downward from the destination:
it uses as many staves as the tallest copied chord needs. Select an explicit
multi-staff destination range to choose a different staff count. When a chord
has more pitches than the destination has staves, the surplus stacks on the
last staff; when it has fewer, the leftover staves get rests.

Both commands use the normal paste behavior for destination placement, clefs,
transposition, dynamics, ties, voices, and condensed-score writeback.

The selection and paste commands cover the manual case. Select the top note of
a line, cut it, then paste it into another staff to move one voice by hand; use
**Paste and Merge** to fold a line back into chords that already exist.

> [!NOTE]
> Tuplets, tremolos, and grace notes cannot be redistributed yet. Both commands
> leave the score unchanged and report the limitation instead.
>
> Staves carrying more than one voice are not supported yet: rather than
> rewrite the wrong voice, both commands refuse the whole operation and say so.

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

The time-signature menu accepts an optional beat grouping after the meter.
Enter `5/8 32`, `5/8 3+2`, or `5/8 3,2` for 5/8 grouped 3+2. Compact
groupings use one digit per group; use `+` or `,` when a group has more than
one digit. Beat groups must add up to the meter numerator. Entering only `5/8`
uses the document's automatic grouping, and entering the current conventional
grouping also normalizes back to Automatic.

The **Text** palette also contains chord-symbol entry and lyric-line controls.
See [Chord Symbols](/docs/chord-symbols) for entering harmony and
[Lyrics](/docs/lyrics) for syllable entry, melismas, labels, languages, and
line ordering.

## Inspector

The right inspector changes properties of the selected item. The available
controls depend on what is selected: notes expose pitch and notation
properties, while lyrics, slurs, barlines, text, and other annotations expose
their own specialized controls. Selecting a lyric syllable lets you correct its
text, word position, or lyric line without changing its note.

Use direct shortcuts for frequent actions and the inspector for precise or
less common properties. Both edit the same MNX document and participate in
undo and redo.

## Clipboard history

Copy and paste use MNX-aware score fragments rather than pixels. The
**History** tab in the left panel retains recent copied fragments and shows a
musical preview, making it useful when reusing several passages.

> [!NOTE]
> **Availability: MuseScore paste in the Windows desktop app**
>
> Copy a passage in MuseScore, select its destination in Viritura, then press
> `Ctrl+V`. Supported notation is imported; unsupported markings are skipped
> where safe, with a warning explaining what was omitted. Include both ends of
> ties, slurs, and hairpins when copying. Invalid data or uncertain timing stops
> the paste rather than risking incorrect rhythms.
>
> Direct MuseScore clipboard paste is not available in the browser or on other
> desktop platforms. Copying from Viritura back into MuseScore is currently
> disabled; copying and pasting within Viritura still works normally.

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

For entering new notes, see [Note Entry](/docs/note-entry). For entering words
under notes, see [Lyrics](/docs/lyrics). For the complete binding list, see
[Keyboard & Mouse](/docs/keyboard-shortcuts).
