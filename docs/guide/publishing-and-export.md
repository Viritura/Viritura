# Publishing & Export

The **Publish** activity prepares one or more scores and instrumental parts for
delivery.
It combines layout selection, page-format review, naming, and batch PDF export
while using the same engraving engine as the editor.

## Choose layouts

The left panel lists the document's full scores, section scores, and
instrumental parts.
Select one layout for an individual export or select several for a complete
delivery package.

Check each selected layout in Engrave before exporting. Page setup belongs to
the individual score or instrumental part, so a full score and its part extracts
can use different paper sizes, staff sizes, margins, and orientations.

The layout cards summarize paper and staff size, and the center preview shows
the focused output. Configure page format in
[Engraving & Layout](/docs/engraving-and-layout#page-setup) before exporting.

## Export PDFs

PDF is the currently available export format. Choose a bundle mode:

- **ZIP archive** is the default and packages separate PDFs into one download.
- **Single PDF** concatenates the selected layouts.
- **Separate files** writes one PDF per layout directly to a selected folder.
  This option is only available with a folder destination: browsers can block
  batches of separate downloads.

MusicXML, MNX, MIDI, and audio export entries are visible as coming-soon formats
and cannot currently be selected.

## Destination and file names

> [!NOTE]
> **Availability: Chromium web / desktop app**
>
> Direct folder export requires directory access. Other browsers use normal
> downloads instead.

When available, **Choose folder** selects a folder you approve. If a local
project folder is open, **Use project folder** selects its root without asking
you to pick it again. Selecting either folder destination switches to
**Separate files**, so **Export** saves the PDFs directly to disk without
browser downloads. Files with matching names are replaced.

Use **Clear** to return to browser downloads; separate-file output switches
back to ZIP automatically.

The filename pattern supports:

- `%TITLE%` — document title;
- `%PART%` — score or instrumental-part layout name;
- `%PART_NUMBER%` — zero-padded output number in score order, starting at `01`.

Numbering puts scores first, followed by instrumental parts in the full score's
top-to-bottom instrument order. It counts every layout, including those not
selected for this export, so numbers remain consistent across partial exports.
Multi-instrument layouts count as scores. If there is no usable layout named
“Full score”, the first score containing the most instruments determines the order.
If no full score can be identified, the instrument list supplies the order.
Parts absent from the full score follow the instrument list; other layouts
without identifiable instruments come last.

For example, `%PART_NUMBER% — %TITLE% — %PART%` sorts exported PDFs by score
order when sorted by filename. ZIP entries and direct folder writes are also
produced in that order. In the name of a ZIP or combined PDF, `%PART_NUMBER%`
becomes `All`; a combined PDF keeps the Publish layout-list order. The correct
extension is added automatically.

## Embed the source

Enable **Embed MNX source** to attach the document's MNX JSON to each PDF for
round-trip and archival workflows. The visible pages remain ordinary PDF
content.

## Before delivery

1. Check page turns and forced breaks in every instrumental part.
2. Confirm concert versus written pitch for each layout.
3. Review titles, credits, headers, footers, and copyright text.
4. Export a small representative layout first.
5. Open the generated PDF outside Viritura before running a large batch.

For page geometry and house style, see
[Engraving & Layout](/docs/engraving-and-layout). For the MNX and
musician-facing meanings of score and part, see
[Scores, Parts & Layouts](/docs/instruments-and-scores).
