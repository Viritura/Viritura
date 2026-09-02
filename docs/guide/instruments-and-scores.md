# Scores, Parts &amp; Layouts

Viritura bridges the language musicians use with the names in the **MNX** data
model. Those vocabularies overlap, but they are not identical: an MNX
`score` definition can produce either a conductor's score or a performer's
instrumental part.

## Terminology

Public guides use the musician-facing terms unless they explicitly say **MNX**:

| Term                                      | Meaning                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Document**                              | The whole `.mnx` file: musical content, layouts, full and section scores, instrumental parts, metadata, and Viritura extensions.                                 |
| **Instrument**                            | A musical source shown in Setup, such as Flute, Piano, or Percussion. Its music is normally stored in an MNX `part` object.                                      |
| **MNX part** or **source part**           | The schema object that owns musical content. It is not automatically a printed instrumental part.                                                                |
| **Layout**                                | An MNX tree of groups and staves that maps one or more source parts into visible staves.                                                                         |
| **MNX score definition**                  | A schema object that selects one layout plus page and pitch-display settings. Despite its name, it can define a full score, section score, or instrumental part. |
| **Full score** or **section score**       | A musician-facing, multi-instrument view used by a conductor, composer, or section.                                                                              |
| **Instrumental part** or **part extract** | A musician-facing view prepared for one performer or instrument, such as Flute 1 or Piano. It is represented by an MNX score definition and layout.              |

The Viritura interface groups an MNX score definition under **Scores** when its
layout references more than one source part, and under **Parts** when every
staff comes from one source part. This is a Viritura presentation convention,
not the meaning of `score` in the MNX schema.

Staff count alone does not decide the category. A grand-staff piano layout is
still one instrumental part, while a percussion or choir layout containing
several source parts is a score.

The crucial consequence is that an output's instrument membership is derived
from its layout. Adding an instrument to a score adds a staff referencing that
instrument's source part to the score's layout. Removing it from the score
leaves the source part and its music in the document.

## Where options live

The selected score or instrumental part does not own every setting shown on the
canvas. Each layer has a different job:

| Owner                     | Options                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Document**              | Project metadata, global measures, tempo, opening key and time signatures                                 |
| **Instrument / MNX part** | Music, long and short names, instrument identity, staff count, transposition, written-pitch preference    |
| **Layout**                | Which source parts appear, staff order, groups, brackets, labels, condensing sources                      |
| **MNX score definition**  | Output name, selected layout, concert or written pitch, page setup, and output-specific measure-rest data |

This separation is what allows one source part to appear in several outputs
without duplicating its music. For example, the Clarinet in B-flat source part
owns its transposition once, while the full score and clarinet instrumental
part independently choose concert or written pitch and their own page setup.

## The Setup panel

In Setup, **Instruments** edits the document's MNX source parts and
**Layouts** edits the output views that reference them. Project metadata and
opening music are document-level settings.

See [Getting Started](/docs#setup-mode) for the Setup workspace
orientation.

## Add an instrument

In **Instruments**, click **Add instrument** and pick from the catalog. Viritura
adds its MNX source part to the document and creates its instrumental-part view
automatically.

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

Expand an instrument in **Instruments** and choose **Change Instrument…**.
Changes that preserve the staff structure and MNX note kind keep the existing
music — for example, Flute to Oboe. Percussion-to-percussion changes rebind
existing hits to the nearest position in the replacement map after
confirmation.

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

Choose **Edit Percussion Map…** on an unpitched instrument to configure its
playback sounds, staff positions, and noteheads. See
[Percussion Maps](/docs/percussion-maps) for the complete workflow.

## Manage a score's instruments

In **Setup → Layouts**, right‑click a score header for **Manage Instruments…** — a
checklist (grouped by family) of every instrument in the document, pre‑checked
to the score's current contents. Check to add, uncheck to remove. Removing an
instrument here keeps its source part and music in the document; it only leaves
that score's layout.

You can also right‑click an individual staff for **Remove from this Score**, or
use the score header's **+ Add instrument** menu to add an instrument that is
not yet present.

## Build a section score

To create a score for a subset of instruments, such as a percussion section,
use **Add Score → Section Score…**:

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

### Transposition belongs to the source part

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
changes the derived pitch in every output that renders that source part at
written pitch; concert-pitch outputs continue to show the stored sounding
pitch.

### Concert or written pitch belongs to the output

In the normal editing activities, the **Concert / Written** control in the
status bar updates only the score or instrumental part currently selected in
the header. It persists on that MNX score definition as `useWritten`.

- **Concert** displays stored sounding pitches.
- **Written** applies each source part's transposition to notes and key
  signatures.

Every output chooses independently. A full score can remain at concert pitch
while the clarinet part uses written pitch. Switching the control changes
display without rewriting the stored music, which remains at sounding pitch.

New documents default the full score to concert pitch. An automatically created
instrumental part for a transposing instrument defaults to written pitch.

Review has its own presentation-only Concert / Written control so both compared
revisions use the same pitch view. That Review control does not change either
revision or the open document.

### Prefers written pitches is an instrument exception

The instrument option is **Prefers written pitches**, not “prefers concert
pitch.” It means the source part remains written even when the selected output
is set to Concert.

Viritura enables this convention for pure-octave transposers such as piccolo,
glockenspiel, xylophone, guitar, contrabassoon, and double bass. Showing their
sounding octave would add unnecessary ledger lines without helping a conductor
compare pitch classes.

The effective display rule is:

| Output `useWritten` | Source part prefers written | Display |
| ------------------- | --------------------------- | ------- |
| Off                 | Off                         | Concert |
| On                  | Off                         | Written |
| Off                 | On                          | Written |
| On                  | On                          | Written |

Use this exception only when the instrument is conventionally octave-displaced.
For ordinary transposing instruments such as B-flat clarinet or horn in F,
leave it off and let each output's Concert / Written setting decide.

## Output-specific page setup

Page setup belongs to each MNX score definition, so outputs sharing the same
music can use different paper, staff, margin, and page-turn settings. Configure
them in [Engraving & Layout](/docs/engraving-and-layout#page-setup).

## Why it's modeled this way

Keeping source parts, layouts, and score definitions separate means one
instrument's music lives in exactly one place, even though it can appear in a
full score, section score, and instrumental part. Edit a note once and it is
correct in every output.

For score-wide typography, page setup, systems, and condensing, see
[Engraving &amp; Layout](/docs/engraving-and-layout).
