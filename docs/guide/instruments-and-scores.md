# Scores, Parts, &amp; Layouts

Viritura keeps the music for your instruments together in one document. You
can work with that music in a full score, section scores, and individual
instrumental parts.

## Terminology

- A **document** contains the piece, its instruments, scores, parts, and settings.
- An **instrument** has its own music and settings, such as a flute or piano.
- A **full score** brings the ensemble together. A **section score** shows a
  group of instruments, such as the strings or percussion.
- An **instrumental part** shows the music for one instrument, prepared for a
  performer. It can contain more than one staff, as in a piano part.
- A **layout** determines which instruments and staves appear in a score or
  part, their order, and how they are grouped.

An instrument can appear in the full score, section scores, and its own part.
Edits to its music show up in each of those views. Removing it from a score
changes that score's layout, but keeps the instrument and its music in the
document.

## Where options live

Different settings apply to different parts of your work:

| Applies to        | Examples                                                                             |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Document**      | Project details, bars, tempo, and opening key and time signatures                    |
| **Instrument**    | Music, names, staff count, transposition, and written-pitch preference               |
| **Layout**        | Included instruments and staves, their order, groups, brackets, and condensing       |
| **Score or part** | Name, chosen layout, concert or written pitch, page setup, and measure-rest settings |

For example, set a B-flat clarinet's transposition on the instrument. The full
score and clarinet part can then independently use concert or written pitch
and have different page setups.

## The Setup panel

In Setup, **Instruments** lets you add and configure instruments. **Layouts**
controls which staves appear in scores and parts, as well as their order and
grouping. Other tabs hold project details and opening music.

See [Getting Started](/docs#setup-mode) for the Setup workspace
orientation.

## Add an instrument

In **Instruments**, click **Add instrument** and pick from the catalog. Viritura
adds it to the document and creates its instrumental part automatically.

If the document contains multiple full or section scores, choose which of those
multi-instrument scores should include the new instrument. This checklist
updates only the selected score layouts; it does not decide whether the
instrument or its instrumental part exists.

When you add a multi‑piece percussion kit, the percussion-map editor opens so
you can map sounds and noteheads right away.

To add several instruments at once, use an **ensemble template** (string
quartet, concert band, …) from the Instruments tab. Templates are not
restricted to score creation — adding one to an already‑populated score is a
single undoable edit.

## Change an instrument

In **Instruments**, right-click an instrument or open its **Instrument actions**
menu, then choose **Change instrument**. Compatible changes keep the existing
music — for example, Flute to Oboe. Percussion-to-percussion changes rebind
existing hits to the nearest position in the replacement map after confirmation.

The picker labels each choice **Compatible**, **Review**, or **Add instead**
before selection. Expanding a one-staff instrument to a multi-staff instrument
is safe: existing music stays on staff 1 and the additional staves start empty.

Viritura blocks destructive staff-count reductions such as Piano to Flute, and
a populated pitched instrument cannot be changed directly to unpitched
percussion. Use **Add instead** to create a new destination instrument, then
move or rewrite the music deliberately.

When MusicXML identifies percussion only by staff position, import opens each
uncertain **Percussion Map** for review. Confirm or edit the inferred sounds;
recognized MusicXML instrument-sound mappings import without interruption.

## Percussion maps

Choose **Edit percussion map** from the **Instrument actions** menu on an
unpitched instrument to configure its playback sounds, staff positions, and
noteheads. See
[Percussion Maps](/docs/percussion-maps) for the complete workflow.

## Manage a score's instruments

In **Setup → Layouts**, right‑click a score header for **Manage Instruments** — a
checklist (grouped by family) of every instrument in the document, pre‑checked
to the score's current contents. Check to add, uncheck to remove. Removing an
instrument here removes it from that score's layout, but keeps the instrument
and its music in the document.

You can also right‑click an individual staff for **Remove from this Score**, or
use the score header's **+ Add instrument** menu to add an instrument that is
not yet present.

## Build a section score

To create a score for a subset of instruments, such as a percussion section,
use **Add score → Section score**:

1. Name the score.
2. Tick the instruments to include — grouped by family.
3. **Create.**

You get a new section score containing exactly those instruments, with
multi‑member families bracketed together (so glock + timpani share one
_Percussion_ bracket). The other instruments and outputs remain unchanged.

## Grouping and brackets

In **Layouts** you can select sibling staves or groups and **Create Group** to
wrap them in a bracket. Selecting every member of adjacent groups rolls them up
into one parent bracket while preserving the existing groups as nested
sub‑brackets — the standard way to bracket a whole brass section while keeping
the horn and trumpet sub‑groups intact.

Drag staves and groups to reorder them; drag a row near the top or bottom edge
and the list auto‑scrolls.

## Transposing instruments

<a id="transposition-belongs-to-the-source-part"></a>

### Set an instrument's transposition

Expand an instrument in **Setup → Instruments** to edit its transposition:

- **Chromatic** is the sounding-to-written distance in semitones.
- **Staff distance** is the same interval measured in diatonic staff steps. It
  controls the written note name and spelling.
- **Key flip at** is the advanced enharmonic threshold used to avoid impractical
  written key signatures with too many sharps or flats.

The interval convention is:

> sounding pitch + transposition interval = written pitch

For example, a B-flat clarinet uses `+2` chromatic semitones and `+1` staff
step: sounding B-flat is displayed as written C. Editing the transposition
changes how that instrument is notated wherever written pitch is used; its
sounding pitch stays the same.

<a id="concert-or-written-pitch-belongs-to-the-output"></a>

### Choose concert or written pitch

In the normal editing activities, the **Concert / Written** control in the
status bar updates only the score or instrumental part currently selected in
the header. The choice is saved with that score or part.

- **Concert** displays sounding pitches, except for instruments set to prefer
  written pitches, described below.
- **Written** applies each instrument's transposition to notes and key
  signatures.

Each score or part chooses independently. A full score can remain at concert pitch
while the clarinet part uses written pitch. Switching the control changes
display without rewriting the music.

New documents default the full score to concert pitch. An automatically created
instrumental part for a transposing instrument defaults to written pitch.

Review has its own presentation-only Concert / Written control so both compared
revisions use the same pitch view. That Review control does not change either
revision or the open document.

### Prefers written pitches is an instrument exception

The instrument option is **Prefers written pitches**, not “prefers concert
pitch.” It means the instrument stays at written pitch even when the selected
score or part is set to Concert.

Viritura enables this convention for pure-octave transposers such as piccolo,
glockenspiel, xylophone, guitar, contrabassoon, and double bass. Showing their
sounding octave would add unnecessary ledger lines without helping a conductor
compare pitch classes.

The effective display rule is:

| Score or part | Prefers written pitches | Display |
| ------------- | ----------------------- | ------- |
| Concert       | Off                     | Concert |
| Written       | Off                     | Written |
| Concert       | On                      | Written |
| Written       | On                      | Written |

Use this exception only when the instrument is conventionally octave-displaced.
For ordinary transposing instruments such as B-flat clarinet or horn in F,
leave it off and let each score or part's Concert / Written setting decide.

<a id="output-specific-page-setup"></a>

## Page setup for scores and parts

Each score and part has its own page setup, so the same music can appear with
different paper, staff, margin, and page-turn settings. Configure them in
[Engraving & Layout](/docs/engraving-and-layout#page-setup).

<a id="why-it-s-modeled-this-way"></a>

For score-wide typography, page setup, systems, and condensing, see
[Engraving &amp; Layout](/docs/engraving-and-layout).
