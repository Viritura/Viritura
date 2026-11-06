# Chord Symbols

Chord symbols belong to one document-wide chord progression. They are
anchored to rhythmic positions in the music, but they are not owned by the note
or rest you select to enter them. Every displayed copy refers to the same
progression; there are no separate instrument-specific progressions.

## Chord track

In **Write → Horizon**, the **Chord track** is an editor-only lane aligned with
the music's rhythmic spacing. Its default natural position is below the paper;
vertical stickiness keeps it visible even in a tall orchestral score.
The lane's text, ruler, and interaction targets scale with the music's canvas
zoom and staff size. Click the settings cog beside **CHORDS** to open a
resizable right-side **Chord settings** panel for track position, vertical stickiness, entry-grid, and audition
options. These options no longer occupy the top toolbar.
You can also find the same preferences under **Settings → Chord track**, even
when the lane is hidden. Both settings surfaces apply the same session-wide
values immediately; they do not save preferences into the document or across
editor launches. Use the checked **View → Chord track** item to show or hide
the lane.

- Click an empty ruler tick to enter a change without selecting a note or rest.
- Single-click an existing chord to select it in **Properties** and audition it.
  Double-click it or press `Enter` while it has focus to edit its text.
  Press `Space` on a focused chord to select and audition without opening entry.
- Drag a chord label or occupied tick to move it to the nearest grid tick or
  existing chord onset. The preview identifies any chord that will be replaced.
  Release inside the lane to commit; press `Escape` or release outside to cancel.
  Each drop is one undo step, restoring both chords if a destination was replaced.
- Hold `Alt` during a drag for a temporary sixteenth-note grid. Pressing or
  releasing `Alt` updates the snapped preview immediately, even without pointer
  movement. Releasing it restores the selected grid without changing the preference.
- The **CHORDS** label and settings cog stay pinned while scrolling horizontally.
- In Horizon, **Position** chooses the lane's natural location **Above music**
  or **Below music**. **Sticky chord track** keeps the entire lane at its natural
  position when visible, and pins it inside the nearest top or bottom edge when
  vertical scrolling or zoom would move it outside the visible score area.
  Turn it off to let the lane scroll normally with the music. These settings do
  not change horizontal rhythmic alignment or printed/paged layouts.
- The lane gains a floating shadow when pinned, hovered, or focused. At the
  bottom edge it shares the status bar's vertical position; the visible status
  bar overlays the chord lane instead of pushing it upward.
- In **Chord settings**, choose **Quarter**, **Eighths**, or **Sixteenths** for
  note-value entry spacing, regardless of meter. Semicolon navigation still
  follows musical beats, including compound beats.
- Press `Space` or `Shift+Space` during entry to commit and move to the first beat
  of the next or previous bar, regardless of the entry grid. Use `;` or `Shift+;`
  for beats and `Mod+→` or `Mod+←` as alternative bar shortcuts.
- **Audition chords** in the settings panel controls automatic previews while playback is stopped.
  The existing moving playhead provides timing feedback during playback.
- Remove a selected chord with `Delete`/`Backspace` or **Remove chord**.
  Committed edits and deletions participate in ordinary undo/redo; canceling
  an entry does not change the document.

The lane always displays and accepts **concert pitch**, including in a
written-pitch view. Editing it does not change any instrument's chord-symbol
visibility. Staff chord symbols are temporarily hidden while the lane is
enabled in Horizon Write mode. Turning **View → Chord track** off restores them;
page views, engraving, and exports retain their existing placement.

> [!NOTE]
> **Availability: Horizon Write mode**
>
> The chord lane is currently available only in Horizon Write mode. In page
> views, use the engraved chord symbols and Properties to edit the same
> shared progression.

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
- added degrees `2`, `4`, `6`, `7`, `9`, `11`, and `13` with `add`;
- omitted degrees `1`, `2`, `3`, `4`, `5`, `6`, `7`, `9`, `11`, and `13`
  with `no` or `omit`;
- slash bass notes such as `C/E` or `F#maj7/A#`.

`Cadd6` means `C6`, and `Csus47` means `C7sus4`. Added degrees do not
imply intervening extensions: `Cadd9` has no seventh, and `Cadd13` adds
only the thirteenth to the triad. An added seventh is always a minor seventh,
even with a major or diminished base quality. `Cmaj7add9` retains its major
seventh.

Combine modifiers as `Cadd79omit5/E`: add the seventh and ninth, omit the
fifth, and use E in the bass. Concatenated `79` means `7,9`; `11` and `13`
remain whole degrees, so `Cadd791113` adds four degrees. Balanced, nonnested
parentheses and commas may group modifier or degree lists:
`C(add7, 9, no5)`, `Cadd(7,9)omit5`, and `C7(add9,omit5)` are supported.
Plain-text labels normalize these spellings, for example to
`Cadd7add9omit5/E`, while the document preserves the exact authored text.

Bare extension lists (`C79`, `C7(9)`), altered degrees (`C7b9`, `Cadd#11`),
unknown degrees, and malformed or nested groups are unsupported. They retain
their text and show the unsupported-symbol diagnostic described below.

Authored text is retained, including unfamiliar suffixes and unrecognized
symbols. Unsupported text is not silently interpreted as a major chord. Use
**Properties** to inspect or correct it. Enter `NC` or `N.C.` for an intentional
no-chord change.

## Enter a progression

Use these keys while the chord-symbol field is open:

| Key             | Action                                             |
| --------------- | -------------------------------------------------- |
| `Enter`         | Commit and exit                                    |
| `Space`         | Commit and move to the first beat of the next bar  |
| `Shift+Space`   | Commit and move to the first beat of the prior bar |
| `;`             | Commit and move to the next beat                   |
| `Shift+;` / `:` | Commit and move to the previous beat               |
| `Mod+→`         | Commit and move to the first beat of the next bar  |
| `Mod+←`         | Commit and move to the first beat of the prior bar |
| `Esc`           | Cancel and exit                                    |

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

Clipboard conversion preserves supported harmony, including added and omitted
degrees, using MuseScore's concert-pitch clipboard format; MuseScore applies
the destination instrument's written transposition. Unsupported harmony is
preserved with a warning when possible.
If that format would change its meaning, conversion reports an error rather
than silently substituting a playable chord.

> [!NOTE]
> **Availability: Destination chord vocabulary**
>
> Added/omitted-degree text is retained by the clipboard converter, but another
> application's chord vocabulary determines how it displays and plays that
> text. Use MNX for lossless exchange between Viritura documents.

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
The root remains among the upper chord tones unless explicitly omitted with
`no1` or `omit1`; this does not remove the low bass note. An unrelated slash
bass is not added to the upper chord tones.

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
