# Selection Behavior Matrix

The single, human-readable description of "what does editing action _X_ do for
selection kind _Y_". It is the prose companion to the **declarative capability
contract** in [`apps/editor/src/store/selectionCapabilities.ts`](../../apps/editor/src/store/selectionCapabilities.ts)
and the resolution primitives in [`apps/editor/src/store/selectionUtils.ts`](../../apps/editor/src/store/selectionUtils.ts).

Before this contract existed, every action hand-rolled its own
`selection.kind === "single" ? … : …` ladder. Those ladders drifted: fingering
silently ignored multi/range selections while articulation didn't; transpose
was dead for ranges entirely; clipboard, delete, and the radial menu each
de-duplicated and ordered events differently. The capability contract collapses
all of that into one declaration per action plus three shared resolvers.

The target behaviors below follow established notation-editing conventions.
Where Viritura intentionally differs, it is called out.

## The five selection kinds

Defined as a discriminated union in
[`selectionStore.ts`](../../apps/editor/src/store/selectionStore.ts):

| Kind      | Created by                                  | Shape                                                          |
| --------- | ------------------------------------------- | -------------------------------------------------------------- |
| `none`    | Clicking empty space / Escape               | _(no payload)_                                                 |
| `single`  | Clicking one notehead/rest/element          | `elementId` + `elementType`                                    |
| `range`   | Shift-click, Shift+Arrow, Ctrl+A            | `startElementId` → `endElementId` (contiguous)                 |
| `multi`   | Ctrl/Cmd-click (toggle add/remove)          | `elementIds[]` (non-contiguous)                                |
| `measure` | Clicking a measure's empty staff background | part × measure rectangle (`start/endPart`, `start/endMeasure`) |

`single` is the only kind that carries `elementType`; the others are resolved
to concrete events/scope on demand.

## The three targeting modes

Every action declares one **mode** (see `SelectionTargetMode`). The mode picks
which resolver in `selectionUtils.ts` turns the abstract selection into concrete
targets:

| Mode     | Resolver                 | Meaning                                                              |
| -------- | ------------------------ | -------------------------------------------------------------------- |
| `events` | `resolveSelectionEvents` | Apply to **every note/rest event** the selection covers.             |
| `notes`  | `resolveSelectionNotes`  | Apply to **individual noteheads** the selection covers.              |
| `scope`  | `resolveSelectionScope`  | Apply across the **measure × part rectangle** the selection touches. |
| `anchor` | `resolveSelectionAnchor` | Act on a **single primary element** only.                            |

### Mode resolution per selection kind

How each kind resolves under each mode. This is the heart of the matrix —
it is identical for _all_ actions that share a mode, which is the whole point.

#### `events` mode (`resolveSelectionEvents`)

Returns a **de-duplicated, document-ordered** list of event locations.
`noteIndex` is dropped (results are event-level, so two noteheads of the same
chord collapse to one event — an event-level toggle like staccato must not
cancel itself out).

| Kind      | Events resolved                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`    | `[]` — action disabled.                                                                                                                           |
| `single`  | The one event (a notehead/articulation sub-ID resolves up to its parent event).                                                                   |
| `multi`   | Each element's parent event, de-duplicated.                                                                                                       |
| `range`   | Every event between the endpoints — **beat-aware and cross-staff** (a half-note that starts before the range start on another staff is excluded). |
| `measure` | Every event inside the part × measure rectangle, descending into tuplets.                                                                         |

#### `notes` mode (`resolveSelectionNotes`)

Like `events`, but **notehead-granular**: `noteIndex` is preserved, so a single
notehead of a chord can be targeted independently. Returns one entry per covered
event, each carrying the set of note indices to act on (or `"all"`). Used by
accidentals, whose natural unit is the notehead.

| Kind      | Notes resolved                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `none`    | `[]` — action disabled.                                                                               |
| `single`  | The specific notehead if a notehead sub-ID was picked; otherwise every note of the event (`"all"`).   |
| `multi`   | Per event, the union of picked noteheads — a whole-event pick (`"all"`) wins over specific noteheads. |
| `range`   | Every covered event, all notes (`"all"`).                                                             |
| `measure` | Every event in the rectangle, all notes (`"all"`).                                                    |

#### `scope` mode (`resolveSelectionScope`)

Returns the measure × part rectangle (`MeasureRange`), derived uniformly so
that clef / key / time-signature changes behave consistently regardless of how
the user selected.

| Kind      | Scope resolved                                     |
| --------- | -------------------------------------------------- |
| `none`    | `null` — action disabled.                          |
| `single`  | The 1×1 rectangle at the element's measure & part. |
| `multi`   | The bounding rectangle of all elements.            |
| `range`   | The measure span between the endpoints.            |
| `measure` | The selected rectangle directly.                   |

#### `anchor` mode (`resolveSelectionAnchor`)

Returns one primary element ID for single-target property edits.

| Kind      | Anchor                      |
| --------- | --------------------------- |
| `none`    | `null` — action disabled.   |
| `single`  | `elementId`.                |
| `range`   | `startElementId`.           |
| `multi`   | First element ID.           |
| `measure` | `null` — no single element. |

> Most `anchor` actions additionally declare `accepts: { single }`, so they are
> only _enabled_ for single selections even though the resolver could yield an
> anchor for `range`/`multi`. This is deliberate: editing one element's
> properties from an ambiguous multi-selection is a footgun (Dorico/Sibelius
> likewise gate per-element property panels to a single target).

## Action registry

Declared in `SELECTION_CAPABILITIES`. Adding an editing action means adding one
line here — never another `selection.kind` ladder.

| Action         | Mode     | Accepts                       | Behavior across kinds                                                                                                                                                                                                                                                                                                                            |
| -------------- | -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Articulation   | `events` | single, multi, range, measure | Match toggle: if every covered note has it, clear all; else add to all.                                                                                                                                                                                                                                                                          |
| Tremolo        | `events` | single, multi, range, measure | Set the tremolo mark count uniformly on every covered event (value, not toggle).                                                                                                                                                                                                                                                                 |
| Fingering      | `events` | single, multi, range, measure | Match toggle per finger: clear from all if every note has it, else add to all.                                                                                                                                                                                                                                                                   |
| Ornament       | `events` | single, multi, range, measure | Match toggle per ornament: clear from all if every note has it, else add to all.                                                                                                                                                                                                                                                                 |
| Trill          | `events` | single, multi, range, measure | Match toggle: clear from all if every note is trilled, else add to all.                                                                                                                                                                                                                                                                          |
| Accidental     | `notes`  | single, multi, range, measure | Notehead-granular. Direct set: `-`/`=`/`0` set flat/sharp/natural on every covered note (value, not toggle). `Shift+-`/`Shift+=` step each note's own `alter` down/up by a semitone, clamped to triple-flat…triple-sharp. A single selected notehead of a chord affects only that note; a whole-event/range/measure selection covers every note. |
| Transpose      | `events` | single, multi, range, measure | Transpose every covered note; rests untouched. _(Previously dead for range.)_                                                                                                                                                                                                                                                                    |
| Delete notes   | `events` | single, multi, range, measure | Blank covered events to rests (in-place; reversed iteration to keep indices stable).                                                                                                                                                                                                                                                             |
| Clef           | `scope`  | single, multi, range, measure | Insert clef change at the scope's start measure/part.                                                                                                                                                                                                                                                                                            |
| Key signature  | `scope`  | single, multi, range, measure | Set key at the scope's start measure (spans the measure range for endings).                                                                                                                                                                                                                                                                      |
| Time signature | `scope`  | single, multi, range, measure | Set time signature at the scope's start measure.                                                                                                                                                                                                                                                                                                 |

### Behaviors that live outside the registry (by design)

- **Slur / tie** — _span_ actions: they consult the `events` capability to find
  the covered notes, then apply a connection rather than a per-event mark. A
  bar (measure) or multi/range selection behaves as if every covered note were
  picked. Because a slur can't cross staves/voices, the covered notes are
  grouped by voice (part + sequence) and **slur** draws one slur per voice
  (first → last covered note in that voice) — so a multi-staff bar selection
  slurs every staff at once. **Tie** ties every covered note as a group
  (toggling all on if any is untied, else all off), which is already per-event
  and so spans staves naturally. A selection covering exactly one note falls
  back to the single-note behavior (slur/tie to the following note). Both the
  palette buttons and the `S` / `T` keys share this behavior.
  _(Previously single/range-only — bar select did nothing; multi-staff drew one
  nonsensical cross-staff slur.)_
- **Dynamics / hairpins / text expressions** — placed at the part/measure level
  via the radial menu. A selection resolves to one target **per affected part**,
  so a multi-staff bar (or cross-staff range/multi) selection applies the
  marking to every selected staff at once; hairpins span each staff's measure
  range independently. _(Previously the `measure` case applied to the first
  staff only.)_
- **Measure structure** (insert/remove measure, repeats, voltas) — driven from
  the palette via element-ID helpers in
  [`signatureCommands.ts`](../../apps/editor/src/commands/signatureCommands.ts).
  Voltas (endings) span the selection's measure range; a single selection spans
  exactly one measure.
- **Property inspector edits** (layout overrides, color, directions) — `anchor`
  semantics, gated to single selections. These are plain functions, not
  registry entries, because they are invoked from the inspector UI with an
  explicit target rather than from a generic action dispatcher.
- **Navigation & range extension** (Arrow, Shift+Arrow, Home/End, Ctrl+A) —
  operate on the selection's anchor (last element for multi) and produce new
  selections; they consume the selection rather than editing the score.

## Why these defaults

- **Event actions accept all four non-empty kinds.** Selecting a passage and
  pressing an articulation, dynamic, or transpose command applies to the whole
  passage. Restricting any of these to single
  selections (as several Viritura actions previously did) is a bug, not a
  feature.
- **Per-note on/off markings use "match" semantics, not independent toggles.**
  Articulations, fingerings, ornaments, trills and ties all resolve a single
  target state across the selection first: if _every_ covered note already
  carries the marking, the whole selection is cleared; otherwise (none or a
  mixed on/off set) it is added to all. A mixed selection therefore unifies to
  "on" on the first press and clears on the second, instead of inverting each
  note independently (which would scramble the mix). Value pickers
  (tremolo marks, arpeggio kind, breath/fermata shape) set the chosen value
  uniformly and intentionally do _not_ toggle off — use the explicit "none"
  option to remove them.
- **Scope actions accept all four kinds too**, but collapse to the _start_ of
  the touched rectangle. A clef/key/time change is a point event in the
  timeline; "apply across a multi-measure selection" means "place it where the
  selection begins," matching the three reference editors.
- **Anchor actions gate to single.** Per-element property editing is
  intentionally unambiguous.

## Maintaining this document

When you add or change an action's capability in `selectionCapabilities.ts`,
update the **Action registry** table above in the same change. The capability
file's header comment points here; keep the two in sync. The mode-resolution
tables only change if `resolveSelection*` semantics change in
`selectionUtils.ts`.
