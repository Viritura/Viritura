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

Explode and reduce move pitches between staves without retyping them.

| Command                                 | Key           | Effect                                                                   |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| **Edit → Explode to Staves**            | —             | Fans the selected chords out, one pitch per staff, top note on top staff |
| **Edit → Reduce to Staff**              | —             | Collects the selected staves' music back onto the topmost selected staff |
| **Edit → Select Top Note of Chords**    | —             | Narrows the selection to the highest notehead of every selected chord    |
| **Edit → Select Bottom Note of Chords** | —             | Narrows the selection to the lowest notehead of every selected chord     |
| **Edit → Paste and Merge**              | `Mod+Shift+V` | Pastes pitches _into_ the destination chords rather than replacing them  |

Explode works downward: it uses as many staves below the selection as the
tallest chord needs. When a chord has more pitches than there are target
staves, the surplus stacks on the last staff; when it has fewer, the leftover
staves get rests. Reduce applies the same allocation in reverse. Selecting more
than one source staff before exploding pools all of their pitches first, so any
number of staves can be redistributed onto any other number.

Both commands follow the staves as they are laid out in the score you are
viewing. On a condensed score, a staff that renders several parts on one line
counts as a single staff: its parts are pooled together as one source, and
"the staff below" is the next line the reader sees rather than a part hidden
inside the same line.

The selection and paste commands cover the manual case. Select the top note of
a line, cut it, then paste it into another staff to move one voice by hand; use
**Paste and Merge** to fold a line back into chords that already exist.

> [!NOTE]
> Both commands rewrite only the span of music the selection covers, widened
> outward to whole events, on the first voice of each affected staff. Music
> before and after that span, and additional voices, are left untouched;
> extra voices are reported as a warning. Measures containing tuplets,
> tremolos, or grace notes are skipped rather than re-rhythmed. Music landing
> on a condensed staff is written to the first of its parts and the remaining
> parts rest.

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
