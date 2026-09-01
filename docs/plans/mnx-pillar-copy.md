# MNX Web Copy

Working copy for the MNX pages on `viritura.com`. This is not a replacement
for the MNX specification. The W3C Music Notation Community Group publishes
and maintains the format and its reference material. Our job is to explain why
the format is interesting, show it working, and help people do something useful
with it.

---

## `/mnx`

### Implementation baseline after PR #14

PR #14 already gives this page a working shape. Keep these pieces:

- the rendered MNX sample in the hero;
- the primary links to the playground and examples;
- the three paths for examples, live editing and MusicXML conversion;
- the boundary between standard MNX and `_x.viritura` extensions;
- the separate VS Code viewer section.

The copy below adds the missing explanation of what MNX is and how it relates
to MusicXML. It should sit after the three tool paths and before the extension
boundary. There is no need to replace the interactive hero or repeat the tool
cards farther down the page.

PR #14 currently links its converter tile to `/mnx-converter`. PR #13 moves the
converter to `/mnx/mxl-converter`. When these branches are combined, keep the
nested route from PR #13 and update the hub tile to match it.

### Page title

MNX Music Notation Format: Guide, Examples and Tools | Viritura

### Meta description

Learn what the MNX music notation format is, how an MNX document is organized,
and how to inspect and edit MNX in your browser.

### Eyebrow

Open music notation, made tangible

### H1

MNX, rendered in the open.

### Introduction

MNX is an emerging format for representing music notation as structured data.
It describes notes, rhythms, parts and the relationships between them, so
software can work with the music rather than a fixed picture of a page.

The format is being developed in the open by the W3C Music Notation Community
Group, which also maintains MusicXML. MNX is still a draft. For the formal
definition and the latest decisions, the [official MNX
specification](https://mnx.formats.music/docs/) is the source of truth.

Viritura uses MNX as its native document format. The sample above and the tools
on this page come from that implementation. You can read an MNX document,
change it, and see how it becomes engraved music.

Primary actions:

- Open the MNX playground
- Browse rendered examples

---

## What is MNX?

A notation file has to carry more than the marks visible on a page. It needs to
say that a note is a C, that it lasts a quarter note, that it belongs to a
particular voice, and that a slur continues to a later event. MNX gives notation
software a common way to record those facts.

MNX documents are written as JSON. Musical content is organized into source
parts and measures, while score-wide information such as time signatures,
repeats and tempo has its own global timeline. The format can also describe how
the source music is arranged into staves for a particular score or
instrumental part.

Suggested links after this section:

- **Open Hello world in the playground** at `/mnx/playground#hello-world`
- **Read the official MNX introduction** at
  `https://mnx.formats.music/docs/`

---

## MNX and MusicXML

MusicXML and MNX overlap, but they were designed for different jobs.

MusicXML is the established interchange format for notation software. Its job
is to carry a score from one application to another. Broad support is its main
advantage: Finale, Dorico, Sibelius, MuseScore and many other programs can read
or write it. When moving an existing score between applications, MusicXML is
usually the practical choice.

MNX is intended for interchange and for use as an application's working
format. It represents relationships such as voices, chords and tuplets more
directly, and it can keep source music separate from a particular score layout.
The tradeoff is maturity and reach. MusicXML works with a large existing
software ecosystem; MNX is still a draft with limited support.

The two formats therefore have different roles in Viritura. MusicXML is an
import format for bringing scores out of existing notation software. MNX is the
document Viritura works in after import.

Suggested action: **Compare the formats and convert MusicXML to MNX**

---

## Common questions

### Is MNX a W3C standard?

MNX is a draft developed by the W3C Music Notation Community Group. It is not a
finished W3C Recommendation. The official specification describes the current
draft and should be used for implementation decisions.

### Is MNX replacing MusicXML?

Not in the practical sense that applications should stop supporting MusicXML.
MusicXML has broad support and is the standard route for exchanging scores
today. MNX is newer work by the same community. It represents relationships
such as voices, tuplets and layouts more directly, and is intended to be usable
as an application's working format.

### Is an MNX file XML?

No. An MNX document is JSON.

### What does MNX stand for?

MNX is the name of the format. The official documentation does not expand it
into a longer phrase. The X does not mean that MNX is an XML format.

### What can open an MNX file?

MNX support is still young. Viritura can open and edit MNX in the browser, and
the Viritura MNX Viewer can preview `.mnx` files in VS Code. For other software,
check that application's current import and export documentation.

### Where can I find MNX examples?

The Viritura playground includes a grouped catalog of complete MNX documents.
Choose an example to open its JSON beside the rendered score. Examples with
more than one MNX score definition also let you switch between the available
scores and instrumental parts.

Individual examples have direct links. For example:

- `/mnx/playground#multiple-voices`
- `/mnx/playground#multiple-layouts`
- `/mnx/playground#orchestral-layout`
- `/mnx/playground#multimeasure-rests`

### Where can I read the specification?

Read the [official MNX draft](https://mnx.formats.music/docs/). Viritura's pages
provide working examples, not a parallel specification.

### Notes for the existing PR #14 sections

The **Start with the format** section should remain the primary tool directory.
Its example tile can continue to open the broad published examples collection;
the playground tile opens a curated catalog in a source, editor and preview
workspace. PR #14 gives each playground example a stable hash link, so the
pillar can link to a specific working document instead of only linking to the
top of the tool.

Keep **A clear boundary** after the explanatory copy. It answers a different
question: how Viritura handles notation that is not part of standard MNX.

Keep the VS Code viewer as its own final section. It is a distinct local
workflow, not a fourth introductory card.

---

## `/mnx/mxl-converter` companion copy

This page owns detailed `MNX vs MusicXML` and conversion questions. The pillar
page should link here rather than growing a second comparison article.

### Page title

MusicXML to MNX Converter: Convert MXL Online | Viritura

### Meta description

Convert MusicXML and compressed MXL files to MNX in your browser. Preview the
score, review conversion details and download the MNX document.

### H1

MusicXML to MNX

### Opening copy

Convert MusicXML and compressed MXL files to MNX in your browser. Your files
stay on your device.

This matches the concise header in PR #13. Do not put the longer comparison
above the drop zone. The file picker and conversion settings should remain the
first task on the page.

### Placement of the following copy

Place the explanatory sections below the converter workbench, coverage panel
and result area. The top of the page is a tool. The lower part of the page can
answer questions about the two formats without delaying someone who arrived to
convert a file.

---

## Why convert MusicXML to MNX?

MusicXML is how scores move between most notation applications. MNX is the
working format used by Viritura. The converter joins the two: bring in a
`.musicxml`, `.xml` or compressed `.mxl` file, inspect the resulting score, and
download an MNX document.

This is a conversion between two music models, not a change from angle brackets
to braces. The converter reads the musical structure in the MusicXML file,
maps supported notation into MNX, and reports source details that need review.

## How MusicXML and MNX differ

The notation on screen may look familiar, but the two formats organize it
differently.

MusicXML represents a score as XML and is designed first for exchange between
notation programs. Its structure uses an ordered stream of notes and directions.
MNX uses JSON and makes several musical relationships explicit: voices are
sequences, notes sounding together belong to one event, and objects such as
ties and slurs can point to their destinations.

### Chords

MusicXML writes the notes of a chord as adjacent note elements and marks the
later notes as belonging to the chord. MNX places the notes together in one
event. This makes the shared duration and rhythmic position explicit.

### Voices

MusicXML can move an internal reading position backward to begin another voice.
MNX stores simultaneous voices as separate sequences within the measure.

### Tuplets

MusicXML describes tuplet timing on notes and uses start and stop notation to
mark the visible group. MNX represents a tuplet as a container with its own
musical content and rhythmic relationship.

### Layout

MusicXML carries a large amount of print and positioning information so another
application can reconstruct the exported appearance. MNX can define layouts and
score definitions separately from source parts, allowing the same music to be
arranged in more than one form.

### Format tradeoffs

MusicXML has broad support and remains the safer choice for exchanging scores
between existing notation applications. It can also carry detailed print and
positioning data. That flexibility comes with complexity: the same musical
relationship may be reconstructed from several elements in an ordered stream.

MNX has a more direct shape for many relationships and is intended to be usable
as a working document, not only an export. It is also a draft with a much
smaller software ecosystem. Converting a MusicXML file to MNX is useful when
the destination works in MNX. It is not a general upgrade that makes MusicXML
obsolete.

---

## What carries into MNX

The converter handles the basic structure needed to keep working on a score:
parts and staves, notes and rests, chords, multiple voices, tuplets, ties,
slurs, lyrics, clefs, key and time signatures, tempo, repeats and common
articulations. It also maps supported transposing instruments and multi-staff
parts.

Some source details do not have a standard MNX equivalent. With **Viritura
extensions** enabled, the converter can retain supported details such as
ornaments, rehearsal marks, text expressions, pedal markings, fingerings,
glissando and slide lines, common chord symbols, coda markers and score
metadata in `_x.viritura` data.

The page already has an **Extensions and import limitations** panel backed by
`conversionCoverage.ts`. Keep the detailed list there. It distinguishes:

- details preserved with Viritura extensions;
- details that MNX or Viritura can represent but the importer does not fully
  map yet;
- source details that are not preserved.

This prose should explain how to read the panel, not repeat every row. The panel
must remain the maintained statement of feature coverage.

---

## Choose the output you want

### Viritura extensions

Leave Viritura extensions on when the destination is Viritura and retaining
supported source-specific notation matters. Turn them off to produce strict
MNX output. When an extension-backed detail cannot be written, the converter
reports it in the diagnostics.

### Stem directions

MusicXML may include explicit stem directions. Keep them to follow the source,
or ask Viritura to recompute stems from the music. Stemless and double-stemmed
MusicXML events are not represented by standard MNX and need review.

### Tempo text

MusicXML can carry both written tempo text and a numeric metronome value. The
converter can keep the numeric value for playback without engraving the
metronome mark when written text should lead the printed result.

---

## Review before you continue

The preview answers one question: does the converted score look right? The
other result tabs answer different questions.

- **Validation** checks the output against the MNX JSON Schema.
- **Diagnostics** lists details that were omitted or approximated for the
  selected file.
- **MNX Output** shows the generated document itself.

A valid MNX document can still differ from the source. Validation checks the
shape of the output; it does not prove that every MusicXML detail survived.
Use the preview and diagnostics together before treating the conversion as
finished.

---

## Converter questions

### What is an MXL file?

An `.mxl` file is compressed MusicXML. It contains the same kind of notation
data as an uncompressed MusicXML document, packaged into a smaller file for
sharing. The converter accepts both forms.

### Can the converter open Finale files?

It cannot open Finale `.mus` or `.musx` files directly. Export the score from
Finale as MusicXML 4.0 or compressed MusicXML, then open that exported file in
the converter. Keep the original Finale file and a PDF alongside any converted
copy.

### Will the MNX score look exactly like the original?

Not necessarily. MusicXML can preserve much of a score, but notation programs
do not all interpret its layout data in the same way. Pitches, rhythms and basic
score structure often transfer more reliably than individually positioned
items. The converter also reports unsupported MusicXML details and mappings
that use Viritura extensions. Review the preview and diagnostics before treating
the result as finished.

### Is MusicXML or MNX better for archiving a score?

MusicXML is mature, documented and supported by many applications, so it is the
safer interchange copy today. MNX is still a draft. For important work, keep
the native source file, an authoritative PDF, MusicXML, and any audio or
playback exports you would need to reconstruct the project.

### Does conversion upload my score?

No. Conversion and preview run locally in the browser. This statement must stay
true in the implementation; if the architecture changes, update the copy at the
same time.

---

## Editorial guardrails

- Link to the official MNX specification for normative definitions and current
  status.
- Say "draft," not "standard," when the distinction matters.
- Do not maintain a list of every application that supports MNX.
- Do not copy the MNX object reference into prose.
- Use complete, runnable documents in examples. Isolated fragments are easy to
  misunderstand.
- Keep `MNX source part`, `MNX score definition`, `layout`, `full score` and
  `instrumental part` distinct.
- Treat MusicXML as the established interchange format, not a legacy format
  that MNX has already displaced.
- Tie conversion claims to tested converter behavior and diagnostics.
- Avoid claims about archival permanence. Recommend layered archives instead.

## Source notes

- [MNX 1.0 draft specification](https://mnx.formats.music/docs/)
- [MNX object reference](https://mnx.formats.music/docs/mnx-reference/objects/)
- [MNX multiple-layouts example](https://mnx.formats.music/docs/mnx-reference/examples/multiple-layouts/)
- [Comparing MNX and MusicXML](https://mnx.formats.music/docs/comparisons/musicxml/)
- [MusicXML overview](https://www.musicxml.com/)
- [Finale to Dorico migration guide](https://www.finalemusic.com/blog/from-finale-to-dorico-a-migration-guide/)
- [`mnx-converter-coverage.md`](../spec/mnx-converter-coverage.md)

## Delivery order

This copy assumes PR #14 has landed. Rebase the content branch onto `main` after
that merge so the final implementation edits the expanded hub and playground,
not their older versions. It also assumes the nested converter route from PR
#13 is retained when route conflicts are resolved.
