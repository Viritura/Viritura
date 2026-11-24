# Publishing & Export

The **Publish** activity prepares one or more scores and instrumental parts for
delivery.
It combines layout selection, page-format review, naming, batch PDF export,
and whole-document MP3 or WAV audio export.

The export actions stay at the bottom of the panel while its settings scroll.
Completed exports appear in the global notifications; progress and errors
remain in the export panel.

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

Select **PDF**, then choose a bundle mode:

- **ZIP archive** is the default and packages separate PDFs into one download.
- **Single PDF** concatenates the selected layouts.
- **Separate files** writes one PDF per layout directly to a selected folder.
  This option is only available with a folder destination: browsers can block
  batches of separate downloads.

MusicXML, MNX, and MIDI export entries are visible but cannot currently be
selected.

## Export audio

Select **MP3** or **WAV** to render the entire document at its written tempo,
including repeats, with the built-in instrument sounds. Layout selection does
not limit the audio. Both formats are stereo at 44.1 kHz.

- **MP3** suits sharing and listening. Choose 128, 192 (default), 256, or
  320 kbps; higher bitrates sound closer to the original and make larger files.
- **WAV** is uncompressed, for importing into a recording program or video
  editor. Choose 16-bit (CD quality), 24-bit (default), or 32-bit float. A
  minute of audio takes about 11 MB, 16 MB, or 21 MB respectively.

The export uses the Play settings as they are when you start it, so it sounds
like playback: mute and solo states, channel/group/master faders, pan, ensemble
settings, stage seating and depth, the reverb room and level, and the master
EQ and limiter. A muted Chords track stays silent. The transport volume and
desktop VST instruments are not included; the export always uses the built-in
sounds. Reverb tails and long final releases are rendered for
up to 30 seconds; if a sound is still active after that, the export reports a
warning. You can cancel while the audio is being rendered.

> [!NOTE]
> **Availability: Built-in sound library required**
>
> The web app may need to download the sound library before exporting. The
> desktop app uses its bundled library. If the library is unavailable, the
> export cannot proceed.

## Destination and file names

> [!NOTE]
> **Availability: Chromium web / desktop app**
>
> Direct folder export requires directory access. Other browsers use normal
> downloads instead.

When available, **Choose folder** selects a folder you approve. If a local
project folder is open, its root is selected by default; after choosing another
folder or clearing it, **Use project folder** selects it again. Selecting either
folder destination switches PDF export
to **Separate files**. PDFs and audio files are then saved directly to disk without
browser downloads. Files with matching names are replaced.

Use **Clear** to return to browser downloads; separate-file output switches
back to ZIP automatically.

The filename pattern supports:

- `%TITLE%`: document title;
- `%PART%`: score or instrumental-part layout name;
- `%PART_NUMBER%`: zero-padded output number in score order, starting at `01`.

Numbering puts scores first, followed by instrumental parts in the full score's
top-to-bottom instrument order. It counts every layout, including those not
selected for this export, so numbers remain consistent across partial exports.
Multi-instrument layouts count as scores. If there is no usable layout named
“Full score”, the first score containing the most instruments determines the order.
If no full score can be identified, the instrument list supplies the order.
Parts absent from the full score follow the instrument list; other layouts
without identifiable instruments come last.

For example, `%PART_NUMBER% - %TITLE% - %PART%` sorts exported PDFs by score
order when sorted by filename. ZIP entries and direct folder writes are also
produced in that order. In the name of a ZIP or combined PDF, `%PART_NUMBER%`
becomes `All`; a combined PDF keeps the Publish layout-list order. The correct
extension is added automatically. For audio export, `%PART%` becomes `Full Score`
and `%PART_NUMBER%` becomes `All`.

## Embed the source

Enable **Embed MNX source** to attach a copy of the entire editable document
as an `.mnx` file to each individual PDF, including every instrument rather
than just the selected score or part. The visible pages remain ordinary PDF
content.

> [!NOTE]
> **Availability: ZIP or separate PDFs**
>
> **Single PDF** combines only the pages and does not retain the attached
> document.

## Before delivery

1. Check page turns and forced breaks in every instrumental part.
2. Confirm concert versus written pitch for each layout.
3. Review titles, credits, headers, footers, and copyright text.
4. Export a small representative layout first.
5. Open the generated PDF outside Viritura before running a large batch.

For page geometry and house style, see
[Engraving & Layout](/docs/engraving-and-layout). For managing scores and parts,
see
[Scores, Parts, & Layouts](/docs/instruments-and-scores).
