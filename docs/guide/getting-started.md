# Getting Started

Viritura is a web‑native music notation editor for composing, arranging,
engraving, and sharing scores.

This guide gets you from the Start Center to an edited, saved document.

## Open or create work

Launch the editor from the landing page (**Open Editor**) or go straight to
[app.viritura.com](https://app.viritura.com). The Start Center offers four paths:

- **New Project…** creates a versioned project in a folder you choose.
- **Open Project Folder…** is the recommended option for ongoing work. It keeps
  the MNX document, Git history, source files, and exports together in one project
  folder.
- **Import…** converts a MusicXML or MXL file into an MNX document.
- **Open MNX file** opens a standalone `.mnx` document for quick edits or viewing,
  without the project folder, source files, exports, or Git history.

> [!NOTE]
> **Availability: Chromium web / desktop app**
>
> Creating or opening a project folder requires directory access. Firefox and
> Safari can open standalone MNX files and import MusicXML, but cannot use
> folder-backed projects in the web editor.

You can also start with a bundled example document. Local files work without an
account.

When you create a project, Viritura creates an MNX document named after its
folder and opens **Setup** with an empty ensemble. Setup is Viritura's
score-creation workspace beside the live score, and its settings remain
available throughout the project.

## Setup mode

Setup stays beside the live score and contains project metadata, opening music,
the instrument roster, and score/part layouts. Start with those four tabs, then
return whenever the document's structure changes.

See [Scores, Parts & Layouts](/docs/instruments-and-scores) for the complete
Setup workflow. Unpitched instruments are covered in
[Percussion Maps](/docs/percussion-maps).

## Find your way around

The Activity Bar on the left organizes the workspace by task:

| Icon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Activity    | Use it for                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| <svg class="docs-activity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v16"/><path d="M16 13h2"/><path d="M16 9h2"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 002 2H8a5 5 0 014 2 5 5 0 014-2z"/><path d="M6 13h2"/><path d="M6 9h2"/></svg>                                                                                                                                                                                  | **Setup**   | Metadata, instruments, scores, and instrumental parts         |
| <svg class="docs-activity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21.174 6.812a1 1 0 00-3.986-3.987L3.842 16.174a2 2 0 00-.5.83l-1.321 4.352a.5.5 0 00.623.622l4.353-1.32a2 2 0 00.83-.497z"/><path d="m15 5 4 4"/></svg>                                                                                                                                                                                                                                                                          | **Write**   | Note entry, selection-based editing, palettes, and inspector  |
| <svg class="docs-activity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21.3 15.3a2.4 2.4 0 010 3.4l-2.6 2.6a2.4 2.4 0 01-3.4 0L2.7 8.7a2.41 2.41 0 010-3.4l2.6-2.6a2.41 2.41 0 013.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>                                                                                                                                                                                                   | **Engrave** | House style, page setup, systems, condensing, and fine layout |
| <svg class="docs-activity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5a2 2 0 013.008-1.728l11.997 6.998a2 2 0 01.003 3.458l-12 7A2 2 0 015 19z"/></svg>                                                                                                                                                                                                                                                                                                                                             | **Play**    | Transport, mixer, sound assignments, and spatial placement    |
| <svg class="docs-activity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 002 9v11a2 2 0 002 2h16a2 2 0 002-2v-8.5C22 9.6 20.4 8 18.5 8"/><path d="M2 14h20"/><path d="M6 14v4"/><path d="M10 14v4"/><path d="M14 14v4"/><path d="M18 14v4"/></svg>                                                                                                                                                                                                                 | **Roll**    | Read-only piano-roll playback visualization                   |
| <svg class="docs-activity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="m6.18 5.276 3.1 3.899"/></svg>                                                                                                                                                                                                                          | **Picture** | Video reference, timecode, spotting, and tempo solving        |
| <svg class="docs-activity-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 22a2 2 0 01-2-2V4a2 2 0 012-2h8a2.4 2.4 0 011.704.706l3.588 3.588A2.4 2.4 0 0120 8v12a2 2 0 01-2 2z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/></svg>                                                                                                                                                                                                                                                         | **Review**  | Git history and semantic visual score comparison              |
| <svg class="docs-activity-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09"/><path d="M9 12a22 22 0 012-3.95A12.88 12.88 0 0022 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/></svg> | **Publish** | Page-format checks and batch PDF export                       |

The account, Live collaboration, MCP client, and Settings buttons sit below the
activity list.

Within **Write**, two interaction states control how keystrokes behave:

- **Normal mode** edits the current selection.
- **Note input mode** enters new music and advances the cursor.

The status of note input is always visible in the toolbar; press `N` or `Esc`
to leave it.

## Enter your first notes

1. Press `N` to enter **note input mode**.
2. Pick a duration — click the toolbar or press `1`–`8` (`1` = 32nd … `4` =
   quarter … `6` = whole).
3. Either **click the staff** where you want the note, or type a pitch letter
   `A`–`G`. The note lands at the nearest octave and the cursor advances.
4. Press `N` or `Esc` to leave note input.

See [Note Entry](/docs/note-entry) for chords, tuplets, accidentals, voices, and
the full input workflow.

## Select and edit

Press `N` or `Esc` to return to normal mode, then click notation to select and
edit it. See [Notation & Editing](/docs/notation-and-editing) for selection,
transposition, palettes, radial menus, the inspector, clipboard history, and
the Jump Bar.

## Save and share

- `Mod+S` saves the current project document or standalone `.mnx` file.
- `Mod+P` opens **Publish** for print‑ready page output.
- Project folders keep Git history. Use **Review** to compare revisions and
  inspect musical changes.
- The Live button creates a temporary collaboration link when you want to edit
  with someone else.

## Where to next

- [Note Entry](/docs/note-entry) — the complete input workflow.
- [Notation &amp; Editing](/docs/notation-and-editing) — selection, palettes,
  inspector, and the jump bar.
- [Scores, Parts &amp; Layouts](/docs/instruments-and-scores) — how MNX source
  parts, layouts, score definitions, and musician-facing outputs relate.
- [Percussion Maps](/docs/percussion-maps) — connect unpitched sounds to staff
  positions, noteheads, and playback.
- [Engraving &amp; Layout](/docs/engraving-and-layout) — house style and page
  preparation.
- [Keyboard &amp; Mouse](/docs/keyboard-shortcuts) — the full shortcut reference.
