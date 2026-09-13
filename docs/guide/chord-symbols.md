# Chord Symbols

Chord symbols belong to a part-level harmony lane. They are anchored to
rhythmic positions in the music, but they are not owned by the note or rest you
select to enter them.

## Enter a chord symbol

1. Select the note or rest where the chord change begins.
2. Press `Shift+K`, or choose **Chord symbol** in **Palettes → Text**.
3. Enter a symbol such as `C`, `Dm7`, `F#maj7/A#`, `Gsus4`, or `C5`.
4. Press `Enter` to commit and exit, or use a navigation key to continue the
   progression.

The selected event establishes the source part and rhythmic position. Entering
another chord at the same position replaces the existing symbol for that
display staff rather than creating a duplicate.

## Shorthand

Chord entry accepts:

- roots from `A` through `G`;
- flat, sharp, double-flat, and double-sharp roots and bass notes;
- major, minor, dominant, diminished, augmented, half-diminished,
  minor-major, power, suspended-second, and suspended-fourth qualities;
- extensions `6`, `7`, `9`, `11`, and `13`;
- slash bass notes such as `C/E` or `F#maj7/A#`.

An unfamiliar quality suffix is retained as custom quality text. Use
**Properties** after entry when you need to inspect or refine the semantic
spelling.

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

- root and accidental;
- quality and custom quality text;
- extension;
- slash bass and accidental;
- display staff for a multi-staff instrument;
- a display override for exceptional text.

The root, quality, extension, and bass remain semantic data. A display override
changes only the engraved label, so use it for an isolated exception rather
than as the normal way to spell a chord.

Press `Delete` or `Backspace` with a chord symbol selected to remove that
harmony event without changing the underlying note or rest.

## Placement in scores and parts

By default, a source part's chord symbols appear above its first displayed
staff. A multi-staff instrument can direct an individual symbol to another
staff through **Properties**.

Layouts can independently show or hide the harmony lane on a displayed staff.
This lets a document use the same harmonic data in a full score and
instrumental parts while presenting it differently in each output.

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
