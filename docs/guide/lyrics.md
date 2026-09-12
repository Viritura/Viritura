# Lyrics

Enter lyrics from the **Write** activity. Lyric entry moves through notes
syllable by syllable, while the lyric controls in **Palettes → Text** manage
verses, translations, labels, languages, and their display order.

## Start lyric entry

1. Select the note or chord where the first syllable belongs.
2. Open **Palettes → Text**, then find **Lyrics** below the text tools.
3. Choose the lyric line you want to enter.
4. Select **Start entry**.

You can also select a note and use the **Lyrics** toolbar button or press
`Shift+W`. Both commands open the Text palette and its Lyrics controls, then
start entry for the active line. If the selection is not a note or chord,
Viritura asks you to select one instead of changing the document.

Lyric entry and note input are separate interaction states. Starting lyric
entry exits note input; pressing `N` to start note input exits lyric entry.

## Enter syllables

Type into the field below the selected note, then use these keys:

| Key              | Action                                                  |
| ---------------- | ------------------------------------------------------- |
| `Space`          | Commit a complete syllable and advance to the next note |
| `-`              | Commit a syllable that continues on the next note       |
| `_`              | Advance across a note for a melisma                     |
| `Shift+Space`    | Insert a literal space in the current lyric text        |
| `Left` / `Right` | Move between notes when the text caret is at that edge  |
| `Up` / `Down`    | Move through lyric lines in their configured order      |
| `Enter`          | Move to the next lyric line                             |
| `Escape`         | Commit pending text and stop lyric entry                |

The field loads existing text when you revisit a note and lyric line. The label
below it identifies the active line.

## Edit an existing syllable

Click engraved lyric text to select that syllable. Open **Properties** to edit
its text, its position within a word, or the lyric line it belongs to. A line
that already has a syllable on the same note is unavailable as a destination,
so reassignment cannot silently overwrite text.

Press `Delete` or `Backspace` while a lyric syllable is selected to remove only
the lyric. Its note remains unchanged.

Standard clipboard commands follow the selection:

- Copying or cutting a selected syllable uses plain text. Cutting removes only
  the lyric, and pasting plain text replaces the selected syllable.
- Copying notes or passages includes their attached lyrics. Viritura fragments
  also carry the referenced line labels, languages, and ordering so they remain
  available when pasted into another document.

Pasting and distributing a complete verse across a passage is tracked
separately in [#119](https://github.com/Viritura/Viritura/issues/119).

## Manage lyric lines

The Lyrics controls in the Text palette list every lyric line used by the
document.

- Select a line card to make it active for entry.
- Select **Add line** to create another verse or translation.
- Use the arrow buttons to set the order shown below the staff and followed by
  `Up` and `Down` during entry.
- Set a **Label** such as `Verse 1`, `Chorus`, or `Translation`. The entry field
  shows this label.
- Set **Language** to a valid BCP 47 language tag such as `en`, `en-GB`, `fr`,
  or a valid private-use tag. Viritura preserves valid authored tags rather
  than silently rewriting them.

Line metadata, ordering, and entered syllables are normal document edits. They
round-trip through MNX and participate in undo and redo.

## Imported lyrics

MusicXML import creates lyric lines from numbered `<lyric>` elements. When the
source consistently provides a lyric name or language, Viritura retains that
information as the line label and language.

For general selection, palettes, and editing commands, see
[Notation & Editing](/docs/notation-and-editing). For entering notes, see
[Note Entry](/docs/note-entry).
