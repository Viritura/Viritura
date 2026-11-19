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

To remove whole bars, click empty staff space to select a bar and Shift-click
to extend the bar selection. Choose **Edit → Delete Selected Bars**, or
right-click inside the selected bars and choose **Delete Selected Bars**.
This removes those bars from every instrument in the document, even when
only one staff is selected. Deleting all bars leaves one empty bar. Use
**Undo** to restore the deleted bars.

The existing **Delete** command clears selected music without removing bars.
When a cut or delete empties a whole bar on a staff, that bar shows a
full-measure rest again.

Select an explicit time signature and press `Delete` to remove it. Following
bars inherit the nearest earlier time signature, and automatic beat grouping
follows the inherited meter.

To exchange the music of two staves, select a bar range that covers exactly two
staves, either on two instruments or on the two staves of one piano, and
choose **Edit → Swap Staff Contents** or the same command from the right-click
menu. Voices and staff-attached markings move together; the staves' clefs,
instruments, and other structural settings stay where they are.

The fastest commands act directly on the selection:

| Key       | Action                                        |
| --------- | --------------------------------------------- |
| `S`       | Toggle a slur                                 |
| `T`       | Toggle a tie or laissez vibrer                |
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

## Staff and system text

Select a note, rest, or bar and choose **System text / tempo** in the **Text & tempo** palette
to add an instruction shared by the full score and instrumental parts. It
appears above the visible system at that musical position. Choose **Staff
text** instead for text attached to one staff.

The palette tile and **Shift+T** open the same lightweight text-only popover.
Selecting an instruction exposes advanced controls in Properties. Use
**Set tempo** there to enable or remove BPM, beat unit and dots; rhythm settings can
also explicitly request swing or straight playback. With Set tempo off and
rhythm set to **Inherit**, the instruction is purely visual: words such as
“Allegro” do not infer a speed or interrupt an existing tempo ramp.

Properties also provide rich text, placement, offsets and optional borders. Page
text frames remain separate: they attach to a page rather than a musical
position and never change playback. Choose **Page text frame** in the same
palette to create and select a frame on the current page; Properties opens
automatically for text, formatting, page attachment, size and position.
In Horizon, which has no pages, new page frames start on page 1 and can be
edited in Properties even though they are not drawn there.

Rich text editing in Properties provides **Bold**, **Italic**, **Underline**,
and **Strikethrough** formatting, a font family, a relative text size, and a
SMuFL glyph search for inserting music symbols inline.

In the popover, enter `Freely` or `Allegro` for plain system text,
`q=180` for a metronome marking, or `Allegro q=180` for both. Dotted units
such as `q.=90` and a bare BPM such as `180` are also supported. Explicit
tempo syntax can appear anywhere in the input, including `words here (q=180)`.
The tempo token and any parentheses enclosing only that token are removed
from the printed words; the metronome marking is rendered separately.
Use only one tempo marking per instruction. Press
Enter to apply or Escape to cancel; use Properties for advanced formatting.
Replacing tempo syntax with words alone removes playback settings.
Editing the words of a BPM-free Swing or Straight instruction preserves its
rhythm setting; choose Inherit in Properties to clear it.

The **Rhythm** setting offers **Inherit** (the default), **Straight**, or
**Swing**. Swing applies to **Eighth** or **Sixteenth** notes with a **60%
(3:2)** or **Triplet (2:1)** preset, or a custom long:short ratio. The
**Effective** readout shows which rhythm instruction is in force at that point
and where it comes from.

The **Lyrics** tile (**Shift+W**) starts inline syllable entry on the selected
note and opens Properties. Active-line selection, adding and reordering lines,
labels, language, Paste verse/Reflow and extender settings live in the Lyrics
section of Properties rather than the palette.

### Tempo ramps

To make a gradual tempo change, select where it should start and open
**Properties → Tempo ramp → Add tempo ramp**. Set the **Start bar** and **End
bar** (with optional quarter-note offsets), then choose the target as a
**Percentage of starting tempo** (80% by default) or as a **Quarter-note BPM**.
**Tempo curve** shapes the change: **Linear**, **Early change**, **Late
change**, or **Smooth**. **Marking preset** prints **rit.**, **accel.**,
**rall.**, **stringendo**, or **Custom text**. Choose **Create tempo ramp** to
add it.

A ramp applies to every instrument and normally starts from the tempo already
in force. Deleting a ramp's printed label also removes its playback change.

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

Every command in this section is also available from the jump bar (`Ctrl+Space`)
and from the right-click menu on the score. Right-clicking a note that isn't
already selected selects it first; right-clicking inside an existing selection
keeps that selection, so the command applies to everything you highlighted.

Reduce pools simultaneous pitches from all copied staves and writes them as
chords on one destination staff. Explode works downward from the destination:
it uses as many staves as the tallest copied chord needs. Select an explicit
multi-staff destination range to choose a different staff count. When a chord
has more pitches than the destination has staves, the surplus stacks on the
last staff; when it has fewer, the leftover staves get rests.

Both commands use the normal paste behavior for destination placement, clefs,
transposition, dynamics, ties, voices, and condensed-score writeback.

Expression travels with the music. Articulations, fermatas, and lyrics on a
copied chord are reproduced on every staff the chord is exploded onto, and
dynamics are written to all of them, so the exploded lines phrase and balance
the way the chord did. Reduce is the mirror image: the destination chord
absorbs the articulations of every line feeding it, and duplicate dynamics
collapse into one. Where the sources disagree at the same moment — two
different dynamics, or a marking present on one staff only — the topmost copied
staff wins.

Tuplets are redistributed as a unit: each destination staff receives its own
copy of the tuplet, keeping the ratio, bracket, and number settings of the
original. A staff that ends up with nothing to play inside a tuplet gets an
ordinary rest for that span rather than a bracket over rests.

The selection and paste commands cover the manual case. Select the top note of
a line, cut it, then paste it into another staff to move one voice by hand; use
**Paste and Merge** to fold a line back into chords that already exist.

> [!NOTE]
> Tremolos and grace notes cannot be redistributed yet. Both commands leave the
> score unchanged and report the limitation instead.
>
> Tuplets have to line up across the copied staves. A triplet sounding against
> a different rhythm, or against a different tuplet ratio, has no correct
> re-notation, so both commands refuse rather than re-bar the music.
>
> Staves carrying more than one voice are not supported yet: rather than
> rewrite the wrong voice, both commands refuse the whole operation and say so.

## Palettes and radial menus

The left panel contains notation palettes, undo and clipboard history, and
Properties. Palettes are
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
| `Shift+O` | Ornaments                 |
| `Shift+R` | Repeats and navigation    |
| `Shift+3` | Tuplets                   |
| `Shift+4` | Time signatures (alias)   |
| `Shift+5` | Key signatures            |

Choose an item from a radial menu to apply it to the current selection. The
same commands remain available from the palettes when you prefer a persistent
visual list.

Applying a different key signature after the first bar adds a double barline
before the new key, unless that boundary already has an explicit barline or a
repeat. The barline is an independent item: you can change it in the inspector,
and deleting the key signature does not remove it.

The time-signature menu accepts an optional beat grouping after the meter.
Enter `5/8 32`, `5/8 3+2`, or `5/8 3,2` for 5/8 grouped 3+2. Compact
groupings use one digit per group; use `+` or `,` when a group has more than
one digit. Beat groups must add up to the meter numerator. Entering only `5/8`
uses the document's automatic grouping, and entering the current conventional
grouping also normalizes back to Automatic.

The **Text & tempo** palette also contains chord-symbol and lyric-entry tiles.
See [Chord Symbols](/docs/chord-symbols) for entering harmony and
[Lyrics](/docs/lyrics) for syllable entry, melismas, labels, languages, and
line ordering.

## Markings and lines

| Marking                    | Where to find it                             | Notes                                                                      |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| Glissando / portamento     | **Connections** palette                      | Select exactly two notes or chords in one instrument                       |
| Scoop, plop, falloff, doit | **Notehead markings** palette                | Applies per notehead; notation only, with no playback effect               |
| Caesura                    | **Breath & fermata** palette (`Shift+H`)     | On a barline it spans every displayed staff; on a note or rest it is local |
| Up-bow / down-bow          | **Articulations** palette (`Shift+A`)        | Applies to every selected note                                             |
| Ottava lines               | **Octaves & pedals** palette                 | 8va, 8vb, 15ma, 15mb, 22ma, 22mb                                           |
| Segno, Coda, D.C., D.S.    | **Repeats & navigation** palette (`Shift+R`) | Markers go at the start of the selection; jumps and Fine at its end        |

Finish note input before adding a glissando or portamento. Outside a repeat,
select the two notes in either order; the line goes forward. When both notes
are in the same repeat, select the starting note first and the destination
second. Ctrl/Cmd-click selects nonadjacent notes. A line back across a repeat
is supported from the repeat-end measure to the repeat-start downbeat.

In Properties, the **Glissando / portamento** section sets the **Type**, a
straight or wavy **Line style**, the **Playback type** (**Chromatic**,
**Diatonic**, or **Pitch bend**), and whether the "gliss." or "port." label
is shown.

Slides also have **Slide in** and **Slide out** controls in the **Note
markings** section. A selected caesura offers four shapes and one or two
strokes. Bow markings expose **Direction** and **Placement**.

Drag either end of an ottava line to change its span. Its Properties section
sets the displacement, placement, and whether it applies to all staves and
voices or only one.

Navigation markers drive playback: repeats, D.C., D.S., To Coda, and Fine are
followed when the score plays. In Properties, **Instruction** changes the
marker type, Segno and Coda offer alternative glyphs, and **Add text** prints
custom wording before, after, or instead of the standard text without changing
what the marker does.

### Rests, bars, and meters

To hide a rest, select it and check **Hidden** under **Rest visibility** in
Properties. A hidden rest remains visible as a placeholder in Write so you can
select it again.

To start the score with an upbeat, open the barline menu (`Shift+B`) and choose
**Create Pickup Bar**. Pick a **Pickup duration** shorter than the opening time
signature. The command is unavailable when the score already starts with a
pickup.

Selecting a bar shows its time signature, barline, repeats, measure-repeat, and
measure-number controls in Properties:

- **Display** shows a time signature as stacked numbers, common time (4/4),
  cut time (2/2), an open meter, or with a note-value denominator.
- **Barline → Type** includes double, final, heavy, dashed, dotted, tick, short,
  and no barline.
- **Repeat End** adds a **Repeat Count** of 2 to 32 playthroughs.
- **Measure number → Override** renumbers a bar; **Clear override** restores
  automatic numbering.

With a time signature selected, **Meter grouping display** chooses how beat
groups are printed, for this time signature or for one staff only. It changes
appearance, not rhythm. A **staff-local meter** gives one staff a different
time signature over the same bar; choose **Shared duration** when both meters
fill the same length, or **Fit measure**, then **Apply to this staff**. **Reset
to global** removes it.

### Beams

Select notes to reach the **Beam** section of Properties. **Join selected
notes** and **Break after selection** override automatic beaming, and **Beam
level** applies the change only to secondary or deeper beams, for example to
split sixteenths into groups of four beneath a continuous eighth beam. A
single note at a secondary level can carry a full beam, an automatic one, or a
forward or backward beamlet.

### Instrument changes

To switch a player to another instrument partway through, select a single bar
in that instrument and choose **Edit → Change instrument or tuning** (also in
the right-click menu and jump bar). The change lasts until the next instrument
change. Sounding pitches are preserved, so written notes respell for the new
transposition. The dialog can customize the tuning and set the printed label
and an advance reminder. House style controls whether these labels appear; see
[Engraving & Layout](/docs/engraving-and-layout).

To remove an instrument change, click its label in the score and press
**Delete**; the player returns to the previous instrument. Deleting an advance
reminder (such as "To Flute") hides only that reminder and keeps the change.

## Inspector

The **Properties** tab in the left panel changes properties of the selected
item. The available controls depend on what is selected: notes expose pitch and
notation properties, while lyrics, slurs, barlines, text, and other annotations
expose their own specialized controls. Selecting a lyric syllable lets you
correct its text, word position, or lyric line without changing its note.

Use direct shortcuts for frequent actions and the inspector for precise or
less common properties. Both edit the same document and participate in
undo and redo.

## Undo and clipboard history

The **History** tab in the left panel has two sections. **Undo History** lists
your recent edits with descriptive names; click an entry to undo or redo
straight to that point. The current state is marked **NOW**.

Copy and paste preserve musical information, not just its appearance. The
**Clipboard** section retains recent copied fragments and shows a musical
preview, making it useful when reusing several passages. **Clear** empties it.

Pasting preserves written rest values: a quarter rest followed by a half rest
stays as two rests rather than becoming a dotted half rest. Rests created to
fill leftover time or split at a barline follow the destination meter. Simple
meters such as 4/4 use undotted rests; compound meters such as 12/8 allow dotted
rests within their beat groups. Existing dotted values in copied music are
preserved when they fit without splitting.
Fractional timing is retained exactly rather than rounded to beat boundaries.

Whole-bar copies include the starting clefs and key signature, plus changes
within the copied bars. Clefs follow the copied staves; key signatures apply
to all staves in the destination document. Existing clef and key changes inside
the pasted passage are replaced. Explicit changes outside the passage and clef
changes on uncopied staves are retained. Individual-note and partial-passage
copies leave destination clefs and key signatures unchanged.

For multi-staff instruments such as piano, selecting measures on one staff
copies only that staff's music and voices. Select across both staves to copy
both. A single-staff fragment pastes onto the selected destination staff;
the lower staff's first voice remains voice 1, not voice 2.

To paste a complete grand-staff passage, select the upper destination staff or
select both destination staves. Both-staff selections use the upper staff as
the anchor, even when selected from bottom to top. This also works between
browser tabs. Clipboard previews keep the two staves separate.

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
