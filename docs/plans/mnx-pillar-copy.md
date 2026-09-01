# MNX Web Copy

Working copy for the MNX pages on `viritura.com`. This is not a replacement
for the MNX specification. The W3C Music Notation Community Group publishes
and maintains the format and its reference material. Our job is to explain why
the format is interesting, show it working, and help people do something useful
with it.

---

## `/mnx`

### Page title

MNX Music Notation Format: Guide, Examples and Tools | Viritura

### Meta description

Learn what the MNX music notation format is, how an MNX document is organized,
and how to inspect and edit MNX in your browser.

### Eyebrow

Open music notation

### H1

MNX, explained through working scores.

### Introduction

MNX is an emerging format for representing music notation as structured JSON.
It describes the music itself — notes, rhythms, parts and the relationships
between them — so software can do more than reproduce a fixed picture of a
page.

The format is being developed in the open by the W3C Music Notation Community
Group, which also maintains MusicXML. MNX is still a draft. For the formal
definition and the latest decisions, the [official MNX
specification](https://mnx.formats.music/docs/) is the source of truth.

Viritura uses MNX as its native document format. The examples and tools here
come from that implementation: you can read the JSON, change it, and see how the
same document becomes engraved music.

Primary actions:

- Open the MNX playground
- Browse rendered examples

---

## What is MNX?

A notation file has to carry more than the marks visible on a page. It needs to
say that a note is a C, that it lasts a quarter note, that it belongs to a
particular voice, and that a slur continues to a later event. Once those facts
are represented directly, software can lay the music out again for a different
page, extract an instrumental part, follow playback, compare revisions, or
inspect the score without guessing from pixels.

MNX defines JSON objects for those facts. A simple event might contain a
duration and one or more pitched notes. Measures collect events into sequences;
source parts collect the measures played by an instrument or voice. Information
shared by the whole document, such as time signatures, repeats and tempo, has
its own global timeline.

That separation matters. The music does not have to be tied to one permanent
arrangement of staves on one page.

Suggested link after this section: **See a small MNX document**

---

## One document, more than one score

An orchestral work is rarely needed in only one form. A conductor may want a
full score or a condensed score. Each player needs an instrumental part. A
rehearsal score may show only a few sections. The underlying notes should not
have to be copied into a new file for every one of those uses.

MNX can keep the source music separate from the way it is arranged for display.
A layout maps source parts onto staves and staff groups. An MNX score definition
selects a layout and can describe systems and pages. More than one score
definition can refer to the same music.

In practical terms: the soprano line can be stored once, then shown on its own
staff in one layout and combined with the alto line in another. Fix a wrong note
in the source part and both views receive the correction.

Suggested interactive example: **Four-part choir shown in four-staff and
two-staff layouts**

Suggested action: **Open the multiple-layouts example**

---

## Why JSON?

JSON is ordinary working material for web applications. It can be parsed in a
browser, represented directly by objects in most programming languages, checked
with a JSON Schema, and reviewed with familiar source-control tools.

The choice of JSON is useful, but it is not the main point of MNX. Changing
angle brackets to braces would not solve notation interchange by itself. The
more important work is the model: deciding what a musical object means, where
it belongs, and how another application should interpret it.

Suggested action: **Edit MNX in the browser**

---

## MNX and MusicXML

MusicXML is the established interchange format for notation software. It is
widely supported and remains the practical choice when moving a score between
most applications today.

MNX starts from the experience gained through MusicXML and asks a somewhat
different question: what would an open notation format look like if an
application worked in it directly? Its draft model uses explicit sequences for
voices, groups chord notes into events, and can separate source music from
multiple layouts and score definitions.

This is not a reason to stop using MusicXML. It is the reason a MusicXML-to-MNX
converter is useful: one format is the common route out of existing notation
software; the other can become the working document for an MNX-based tool.

Suggested action: **Convert MusicXML to MNX**

---

## See the format at work

### Playground

Open an MNX document beside its engraved result. Change a pitch, duration,
layout or marking and render it again without uploading the file.

Action: **Open the MNX playground**

### Examples

Browse complete documents covering ordinary notation, layout behavior and
Viritura extensions. Each example pairs source data with a rendered score.

Action: **Browse MNX examples**

### MusicXML conversion

Bring in `.musicxml`, `.xml` or compressed `.mxl` files. Review what was
preserved, inspect conversion diagnostics, and download the resulting MNX.

Action: **Open the MusicXML converter**

### VS Code viewer

Open an `.mnx` file locally and preview it without leaving the editor. The
viewer includes the engraving engine and music fonts it needs to work offline.

Action: **Get the MNX Viewer for VS Code**

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

No. An MNX document is JSON. The name reflects its relationship to the music
notation work that produced MusicXML, not its serialization syntax.

### What can open an MNX file?

MNX support is still young. Viritura can open and edit MNX in the browser, and
the Viritura MNX Viewer can preview `.mnx` files in VS Code. For other software,
check that application's current import and export documentation.

### Can MNX contain a full score and instrumental parts?

An MNX document can contain source parts, layouts and multiple MNX score
definitions. A score definition can render the full ensemble, a section score,
or an instrumental part without requiring a second copy of the underlying
music.

### Does MNX preserve page layout?

MNX can describe layouts, systems and pages, but it is not limited to replaying
one fixed page. The same source music can be given another layout for a part,
screen size or working view. Because the format is still a draft, consult the
official specification before depending on a particular layout feature.

### Where can I read the specification?

Read the [official MNX draft](https://mnx.formats.music/docs/) and its [object
reference](https://mnx.formats.music/docs/mnx-reference/objects/). Viritura's
pages provide working examples, not a parallel specification.

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

Convert MusicXML to MNX in your browser.

### Opening copy

MusicXML is how scores move between most notation applications. MNX is the
working format used by Viritura. This converter joins the two: open a
`.musicxml`, `.xml` or compressed `.mxl` file, inspect the resulting score, and
download the MNX document.

Conversion runs in the browser. Your score does not need to be uploaded to a
server.

---

## What changes when MusicXML becomes MNX?

The notation on screen may look familiar, but the two formats organize it
differently.

MusicXML represents a score as XML and is designed first for exchange between
notation programs. Its structure often follows the ordered stream needed to
reconstruct a printed score. MNX uses JSON and makes several musical
relationships explicit: voices are sequences, notes sounding together belong
to one event, and objects such as ties and slurs point to their destinations.

The converter does not perform a text substitution from XML to JSON. It reads
the MusicXML score, builds a musical model, then writes that model as MNX.

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

None of these structural differences guarantees a perfect conversion. A source
application may use notation or layout behavior that the destination does not
understand. The converter reports known omissions and substitutions so they can
be reviewed alongside the score.

---

## What the converter preserves

Draft lead-in; the final list should be generated from or checked against the
converter's actual coverage data rather than maintained as freehand copy.

> The converter carries supported pitches, rhythms, voices, parts, notation
> and score-wide musical information into MNX. After conversion, use the
> preview and diagnostics to check the result. Advanced engraving, playback
> settings and application-specific data may need attention.

Do not publish a hand-written feature matrix here. Link the visible coverage
summary to implementation-backed diagnostics.

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
items. Review the preview and conversion diagnostics before treating the result
as finished.

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
- Use complete, runnable documents in examples; isolated fragments are easy to
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
