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

## MIDI keyboard input

> [!NOTE]
> **Availability: Profiled Web MIDI input**
>
> MIDI note entry requires a Web MIDI host, permission to access the device,
> and a performance port matched by a built-in controller profile. The current
> built-in profile covers the Akai MPK Mini IV.

Open **Settings → MIDI Input**, enable access, and select the profiled keyboard
port as the **Performance input**. Unprofiled MIDI ports can be monitored in
diagnostics but do not yet enter notes.

Playing outside note input auditions the profile's fixed preview sound. In note
input, hold one or more keys and release them to enter a note or chord at the
cursor; the editor previews the held pitches through the current instrumental
part while you play.

The selected toolbar duration controls the entered rhythm. MIDI velocity is
used for audition but does not replace the document's notated dynamics.

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

When Viritura creates or repairs ordinary rests, it spells generated rests to
show the active meter's beat groups and primary divisions. In 4/4, for example,
rests do not cross the middle of the bar, but a two-beat span contained within
one half may use a half rest. In non-compound meters generated rests are
undotted; compound meters may use dotted rests within their three-unit beat
groups. This does not alter explicitly entered or imported rest spellings,
full-measure rests, or rests inside tuplets.

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
without restating it. When a note at the start of a new measure changes the
previous measure's spelling of the same written pitch, Viritura adds an
unenclosed courtesy accidental automatically. Repeats and alternate endings
also compare each bar with the one heard immediately before it. Tied
continuations remain unmarked, except for a parenthesized reminder at a system
or page start. These automatic marks affect only the display and do not change
the notes. When no accidental key is selected, note input inherits the
alteration already in force for that pitch in the current measure.

At repeat boundaries, clef, key, and time signatures are placed so they follow
the repeat marks when they apply to the following music. A signature changed in
a first ending is shown in brackets at the start of the second ending when it
continues there.

## Ties, slurs, and grace notes

- In normal mode, `T` ties each selected notehead to an adjacent same-pitch
  note, or adds an open-ended laissez vibrer (l.v.) tie when there is no match.
  Press it again to remove the connection. The separate **Tie** and
  **Laissez vibrer tie** palette buttons let you choose explicitly.
- In note input, `T` toggles tie entry. Clicking a new note ties it to an
  adjacent same-pitch note already in the score, or adds a laissez vibrer
  tie when there is no match. No unfinished tie is stored.
- `S` begins a slur to the next note.
- `/` toggles **grace‑note** entry in note input — the next note(s) you enter
  become grace notes attached to the following main note.

In normal mode, select a grace notehead and press `Delete` / `Backspace` to
remove it without changing the main note or inserting a rest. For a grace
chord, only the selected pitches are removed; the grace chord disappears when
its last pitch is deleted. Ctrl/Cmd-click can select several grace noteheads
for deletion together.

## Tuplets

Press `Shift+T` in note input to open the tuplet menu (triplets, quintuplets,
…). In normal mode, `Shift+3` opens the tuplet radial menu for a selection,
while `Shift+T` sets tempo at the selection.

## Voices

Up to four independent voices share a staff, organised as directional lanes:
**Up 1**, **Down 1**, **Up 2** and **Down 2**. Switch the active input voice
with `Alt+1` … `Alt+4` (in that order). The lane follows its voice from bar to
bar, even when bars store their voices in a different order.

A lane's direction is a hint, not a force. When two voices share a bar, Up
voices take stems up and Down voices stems down. When a voice has the bar to
itself — the other voice is empty or holds only hidden rests — its stems follow
pitch like a single voice. To force a direction for one note, flip it with `F`.

To change the hint for one bar, select a note in that voice and set **Voice
Direction** in the **Layout Overrides** section of Properties. **Auto** uses the voice's lane.
The same section's **Cross-Staff** control moves a note onto another staff of
the same instrument, such as the other hand of a piano.

## Rhythm source

To copy the rhythm of another staff while you enter pitches, choose that staff
and voice from the rhythm-reading list (the glasses icon) in the note input
toolbar, just before the duration buttons. Each note you enter then takes the
duration of the matching source event, including tuplets, and rests in the
source are written as rests automatically. This is useful for doublings and
homophonic writing.

The cursor must sit on a rhythmic boundary of the source. When the source runs
out, input returns to **Manual duration**; choosing a duration in the toolbar
does the same.

## Moving the cursor

| Key                    | Action                                      |
| ---------------------- | ------------------------------------------- |
| `←` / `→`              | Move by one event                           |
| `H`                    | Previous event                              |
| `J`                    | Next measure                                |
| `↑` / `↓`              | Move between staves / instruments           |
| `Space`                | Advance without entering anything           |
| `Backspace` / `Delete` | Retract the last entered event in the voice |
| `Esc` / `N`            | Exit note input                             |

The score scrolls automatically to keep the input cursor in view.

## Auditory feedback

Each note you enter is previewed through the playback engine. Percussion
instruments preview the mapped drum sound rather than the clicked pitch.

For the complete shortcut tables (including normal‑mode editing and the radial
menus), see [Keyboard &amp; Mouse](/docs/keyboard-shortcuts).

For selection, palettes, the inspector, and clipboard history, see
[Notation &amp; Editing](/docs/notation-and-editing).

For syllable entry, melismas, translations, and lyric-line metadata, see
[Lyrics](/docs/lyrics).

For entering and styling harmonic labels above the staff, see
[Chord Symbols](/docs/chord-symbols).
