# Note Entry

Note input is the heart of the editor. Press `N` to toggle **note input mode**;
the cursor advances after each entry. You can enter notes two ways — by
**clicking** the staff or by **typing** pitch letters — and freely mix them.

## Durations

Pick a duration before entering a note. Both naming systems below are used
internationally, and the same keys work in both modes:

| Key | Fraction-based name  | Semibreve-based name |
| --- | -------------------- | -------------------- |
| `1` | Thirty-second        | Demisemiquaver       |
| `2` | Sixteenth            | Semiquaver           |
| `3` | Eighth               | Quaver               |
| `4` | Quarter              | Crotchet             |
| `5` | Half                 | Minim                |
| `6` | Whole                | Semibreve            |
| `7` | Double whole (breve) | Breve                |
| `8` | Maxima               | Maxima               |

Press `.` to toggle an **augmentation dot** on the current duration (and on a
selected note in normal mode).

## Pitches

- **Click** the staff at the line/space you want. The pitch follows the active
  clef and key signature.
- **Type** `A`–`G` to enter a note at the nearest octave to the previous one.

In note input, `Alt+↑` / `Alt+↓` moves the just-entered note by a diatonic
step, `Alt+Shift+↑` / `Alt+Shift+↓` by a chromatic semitone, and
`Mod+Alt+↑` / `Mod+Alt+↓` by an octave.

## Ruler and click snapping

Move the pointer over a staff in note input mode to show the insertion preview:

- the ghost notehead snaps vertically to the nearest staff line or space;
- the blue cursor shows the horizontal position where the note will be entered;
- the ruler below the staff shows the available rhythmic snap positions;
- the highlighted ruler tick is the position nearest the pointer.

By default, empty space is divided using the selected duration and augmentation
dots. With a quarter note selected, for example, clicks snap to quarter-note
positions; with a dotted eighth selected, they snap to dotted-eighth positions.
Existing event onsets and tuplet-internal positions remain available even when
they do not fall on that duration grid.

Hold `Alt` while pointing or clicking to temporarily use an undotted
sixteenth-note snap grid. This provides finer placement for the common quarter-,
eighth-, and dotted-duration grids. Alt changes only the insertion position:
the entered note still uses the duration and dots selected in the toolbar.

The ruler uses longer ticks for downbeats and whole beats, medium ticks for
half beats, and shorter ticks for finer subdivisions. Existing event onsets are
also emphasized, making it easier to align a new note with music already in the
measure.

## Chords

To stack notes into a chord:

- **Typing:** hold `Shift` and press a pitch letter (`Shift+A`–`Shift+G`) to add
  to the current chord instead of advancing.
- **Clicking:** `Shift`‑click a note head that already exists to add a pitch to
  that event's chord (the durations must match).
- **Chord‑lock:** press `Q` to lock chord mode so plain `A`–`G` add to the chord
  without advancing. Press `Q` again to release. From normal mode, `Q` jumps
  straight into note input with chord‑lock on.

## Rests

Press `0` in note input to insert a rest of the current duration. In normal
mode, `Delete` / `Backspace` replaces the selected event(s) with a rest of the
same duration.

When you click a note onto an empty measure, the full‑measure rest is replaced
automatically — you don't need to clear it first.

## Accidentals

| Key       | Action                  |
| --------- | ----------------------- |
| `-`       | Flat                    |
| `=`       | Sharp                   |
| `\`       | Natural _(note input)_  |
| `0`       | Natural _(normal mode)_ |
| `Shift+-` | Step down (♭ → ♭♭)      |
| `Shift+=` | Step up (♯ → ♯♯)        |
| `Z`       | Double flat _(input)_   |
| `X`       | Double sharp _(input)_  |

Accidentals follow standard engraving practice: a pitch altered earlier in the
measure isn't re‑marked, and a note tied across a barline keeps its accidental
without restating it. When no accidental key is selected, note input inherits
the alteration already in force for that pitch in the current measure.

## Ties, slurs, and grace notes

- `T` ties the current note to the next (note input) / to the next note
  (normal).
- `S` begins a slur to the next note.
- `/` toggles **grace‑note** entry in note input — the next note(s) you enter
  become grace notes attached to the following main note.

## Tuplets

Press `Shift+T` in note input to open the tuplet menu (triplets, quintuplets,
…). In normal mode, `Shift+3` opens the tuplet radial menu for a selection,
while `Shift+T` sets tempo at the selection.

## Voices

Up to four independent voices share a staff. Switch the active input voice with
`Alt+1` … `Alt+4`. Voice 1 typically takes stems up, voice 2 stems down; the
engine handles rest offset and stem direction automatically.

## Moving the cursor

| Key         | Action                            |
| ----------- | --------------------------------- |
| `←` / `→`   | Move by one event                 |
| `↑` / `↓`   | Move between staves / instruments |
| `Space`     | Advance without entering anything |
| `Backspace` | Delete previous event             |
| `Delete`    | Delete current event              |
| `Esc` / `N` | Exit note input                   |

## Auditory feedback

Each note you enter is previewed through the playback engine. Percussion
instruments preview the mapped drum sound rather than the clicked pitch.

For the complete shortcut tables (including normal‑mode editing and the radial
menus), see [Keyboard &amp; Mouse](/docs/keyboard-shortcuts).

For selection, palettes, the inspector, and clipboard history, see
[Notation &amp; Editing](/docs/notation-and-editing).
