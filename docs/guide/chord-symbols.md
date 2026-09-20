# Chord Symbols

Chord symbols belong to one document-wide chord progression. They are
anchored to rhythmic positions in the music, but they are not owned by the note
or rest you select to enter them. Every displayed copy refers to the same
progression; there are no separate instrument-specific progressions.

## Enter a chord symbol

1. Select the note or rest where the chord change begins.
2. Press `Shift+K`, or choose **Chord symbol** in **Palettes → Text**.
3. Enter a symbol such as `C`, `Dm7`, `F#maj7/A#`, `Gsus4`, or `C5`.
4. Press `Enter` to commit and exit, or use a navigation key to continue the
   progression.

The selected event establishes the rhythmic position. Adding a symbol sets
that instrument's chord visibility to **Show**, even if it was previously
**Hide**. This shows the entire progression above its first displayed staff,
not just the new symbol. Entering another chord at the same position replaces
the existing symbol rather than creating a duplicate.

Enter roots and slash bass notes as written for the instrument in the current
view. In a transposed view, Viritura converts both to concert pitch for storage
and playback, then displays the appropriate spelling for each instrument.

## Shorthand

Chord entry accepts:

- roots from `A` through `G`;
- flat, sharp, double-flat, and double-sharp roots and bass notes;
- major, minor, dominant, diminished, augmented, half-diminished,
  minor-major, power, suspended-second, and suspended-fourth qualities;
- extensions `6`, `7`, `9`, `11`, and `13`;
- slash bass notes such as `C/E` or `F#maj7/A#`.

Authored text is retained, including unfamiliar suffixes and unrecognized
symbols. Unsupported text is not silently interpreted as a major chord. Use
**Properties** to inspect or correct it. Enter `NC` or `N.C.` for an intentional
no-chord change.

## Enter a progression

Use these keys while the chord-symbol field is open:

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| `Enter`         | Commit and exit                                     |
| `Space`         | Commit and move to the next note or rest            |
| `Shift+Space`   | Commit and move to the previous note or rest        |
| `;`             | Commit and move to the next beat                    |
| `Shift+;` / `:` | Commit and move to the previous beat                |
| `Mod+→`         | Commit and move to the first event in the next bar  |
| `Mod+←`         | Commit and move to the first event in the prior bar |
| `Esc`           | Cancel and exit                                     |

Beat stepping follows the active meter. In compound meter, for example, it
moves by the compound beat rather than by each notated beat unit. Navigation
continues across barlines and can land in measures represented by a
full-measure rest.

## Edit a chord symbol

Select an engraved chord symbol to edit it in **Properties**. The available
fields include:

- authored chord text;
- root and accidental, when recognized;
- quality and custom quality text;
- extension;
- slash bass and accidental;
- chord visibility for the instrument;
- a display override for exceptional text.

The root, quality, extension, and bass describe the harmony. A display override
changes the label, not that harmony: it must describe the same chord to remain
playable. Unrecognized or contradictory overrides are retained but marked
unsupported, rather than played as a different chord.

Press `Delete` or `Backspace` with a chord symbol selected to remove that
harmony event without changing the underlying note or rest.

## Placement in scores and parts

Use the instrument's **Chord Symbols** control in Setup, or chord visibility in
**Properties**:

- **Automatic** (**Auto** in Properties): show the progression above the first
  displayed staff of the topmost displayed instrument.
- **Show**: show the progression above this instrument's first displayed staff.
- **Hide**: suppress it for this instrument.

This is an instrument setting, stored on its source part. It follows that
instrument wherever it appears, including the full score and instrumental
parts; it is not an independent layout or per-symbol staff setting. Hiding the
topmost instrument's symbols does not move automatic placement to the next
instrument. Visibility affects engraving, not playback.

## Import, paste, and export

MusicXML, MuseScore clipboard, and Finale import consolidate harmony into the
same document-wide progression. At an identical rhythmic position, matching
harmony is deduplicated. If incoming staves disagree, the topmost incoming
source wins and a warning reports the conflict; no separate local progression
is retained.

Pasting replaces existing symbols only at positions occupied by incoming chord
changes. Other changes remain intact, and existing destination harmony does
not compete with incoming staves for priority. Positions are compared exactly,
so nearby but different changes are not merged. Pasting sets affected
instruments to **Show**, including instruments previously set to **Hide**, for
the entire progression.

MNX saves preserve the shared progression and authored text. PDF and SVG export
use the selected score or instrumental part's visibility and concert/written
pitch settings, including both roots and slash bass notes. Editor warning
marks are not printed or exported.

Copying to MuseScore preserves supported harmony using its concert-pitch
clipboard format; MuseScore applies the destination instrument's written
transposition. Unsupported harmony is preserved with a warning when possible.
If that format would change its meaning, conversion reports an error rather
than silently substituting a playable chord.

## Unsupported symbols and playback

Unsupported symbols keep their authored text and show a red editor-only warning:
**Unsupported chord: cannot play this symbol.** The warning also appears in
Properties. These symbols produce no audio, but still end the preceding chord.
`NC` and `N.C.` likewise end the preceding chord and remain silent, without an
unsupported warning.

When the document contains chord symbols, the mixer includes a **Chords**
channel. It starts unmuted and uses a piano sound in both browser and desktop
playback; it does not add a notated instrument to the document. The voicing uses
one low root or slash bass and all the chord tones in a fixed upper register.
The root remains among the upper chord tones; an unrelated slash bass is not
added to them.

Click a supported symbol or commit a chord edit to hear a short audition while
playback is stopped. Audition uses the same voicing and respects the Chords
channel's mute, solo, and level.

Ordinary full-score or instrumental-part playback includes the progression,
even when its symbols are hidden. An explicit instrument selection includes
chords only when it covers every instrument visible in the current view; a
partial selection excludes them. In a single-instrument view, selecting that
instrument therefore includes chords. An explicitly empty selection plays
nothing. See [Playback, Mixer & Piano Roll](/docs/playback-and-piano-roll).

## House style

Open **Engrave → House Style → Chord Symbols** to choose a document-wide
preset:

- **Conventional**;
- **Jazz symbols**;
- **Plain text**;
- **Lowercase minor roots**.

Open **Advanced** to control root-letter case, major-seventh, minor,
diminished, half-diminished, and augmented spellings, plus superscript or
baseline extensions. These settings change engraving without rewriting the
semantic chord data.

For entering pitched notes together as one rhythmic event, see
[Note Entry — Chords](/docs/note-entry#chords). For general selection and
Properties behavior, see [Notation & Editing](/docs/notation-and-editing). For
layout-wide appearance controls, see
[Engraving & Layout](/docs/engraving-and-layout#chord-symbols).
