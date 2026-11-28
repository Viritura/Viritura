# Engraving & Layout

The **Engrave** activity controls how a score or instrumental part is presented without
changing its musical meaning. Keep composition and note editing in **Write**;
use Engrave for house style, page geometry, system flow, condensing, and
fine placement.

## House style

The **House Style** tab contains document-wide engraving controls. Its search box
filters categories by name and related terms.

### Time signatures

Choose an appearance preset for conventional, oversized, or film-score time
signatures. Depending on the preset, you can adjust distribution across staves,
vertical position, scale, and numeral design.

Changes are previewed on the live score. Check several systems and any
single-line percussion staves before settling on a score-wide treatment.

### Bar numbers

Open **Bar Numbers** in House Style. Under **Apply to**, choose the house style
for all layouts or the current layout for an exception. Start with **Classical**
or **Film score**, then choose whether numbers appear at system starts, every
bar, or not at all. You can also adjust placement, alignment, enclosure, font,
and reserved space. For an individual bar's numbering, use the measure number
override in Write.

### Chord symbols

Choose a chord-symbol preset for conventional notation, jazz symbols, plain
text, or lowercase minor roots. The live preview applies the choice across the
document without changing the semantic chord data.

Open **Advanced** to control root-letter case, major-seventh, minor,
diminished, half-diminished, and augmented spellings, plus superscript or
baseline extensions. Per-symbol display text remains available in
**Properties** for an exception that should not change the document-wide house
style. To remain playable, the override must describe the same harmony;
unsupported or contradictory text is retained with an editor-only warning.

Chord visibility belongs to the instrument, not the layout: **Automatic**
shows the shared progression for recognized piano, bass, and guitar
instruments; **Show** places it above any instrument's first displayed staff,
and **Hide** suppresses it for that instrument wherever it appears. Adding or
pasting a chord sets the affected instrument to **Show** for the entire
progression, even after **Hide**.
See [Chord Symbols](/docs/chord-symbols) for entry, progression navigation,
editing, and playback.

### Text styles

Text styles keep repeated roles consistent across the document. Edit the style
for titles, subtitles, composer and lyricist credits, copyright, tempo,
dynamics, staff text, and other named roles rather than formatting every item
individually.

Style controls include the font family, size, weight, italic treatment, color,
and alignment where applicable.

### Instrument changes

**Show label at change** and **Show advance reminder** control whether
instrument-change labels and the reminder before a change are printed. Set the
label and reminder text for an individual change in Write; see
[Notation & Editing](/docs/notation-and-editing#instrument-changes).

## Page setup

Open the **Layouts** tab to edit the score or instrumental part selected in the header. Page
setup includes:

- paper size and orientation;
- page margins;
- staff size;
- page and system spacing.

Each score and instrumental part can carry its own page setup. A full score can
therefore use larger paper and a smaller staff while part extracts use a
page-turn-friendly format.

### Hide empty staves

In **Layouts**, use **Auto-hide empty staves** to select instruments whose
rest-only systems should be hidden in the current score or part. Music or
markings on any staff keep the whole instrument visible, and at least one
instrument remains visible. Shared staves hide only when all their instruments
are selected and empty.

Choose **Show all staves on the first system** to keep the opening complete.
Click a hidden staff's rail to keep it visible on that system. Where available,
**Apply to all score views** or **Apply to all part views** copies the policy
to the other views of that kind. Automatic hiding applies in page views; manual
staff hiding takes precedence.

## Systems and page flow

To force a break, select a barline and choose **System break** or **Page
break** in the Engrave toolbar. Alternatively, `Ctrl/Cmd`-click a barline for
a system break or `Shift`-click it for a page break. The music after that
barline then starts a new system or page. The **Forced breaks** panel lists the
breaks in the current layout; remove a selected break there, or clear all of
them at once.

Forced breaks are durable layout decisions. Use them sparingly: make the
automatic layout do most of the work, then intervene for musical phrasing,
rehearsal structure, or page turns.

## Slurs and other curves

Select a slur to expose its engraving properties. You can adjust direction and
fine geometry while the engine continues to avoid notes, stems, articulations,
and other obstacles.

Prefer the automatic shape first. Manual control points are best reserved for
musically important exceptions that cannot be expressed through direction or
placement alone.

## Condensing

Press `Alt+C` to open condensing controls for eligible multi-player material.
Condensing changes the displayed score, not the underlying music. Each
instrument's music remains separate and is used in its own instrumental part.

Always review condensed passages at entrances, divisi changes, unisons, and
rhythmically independent writing.

The two staves of a piano or other multi-staff instrument are never merged with
each other. When a player doubles on another instrument, condensing splits and
rejoins their shared staff at system boundaries around the change.

For managing instruments, scores, and instrumental parts, see
[Scores, Parts, & Layouts](/docs/instruments-and-scores). For final PDF output, see
[Publishing & Export](/docs/publishing-and-export).
