# MNX v40 to v46: End-to-End Support Plan

> **Status:** Proposed. Audited against current Viritura `main` on
> 2026-10-18. This document plans implementation; it does not change the
> schema or application.

## 1. Baseline and scope

| Item              | Pinned revision                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viritura baseline | [`main@3b43bc7af5049c8c2fccff8ddd74b881f831d1e1`](https://github.com/Viritura/Viritura/tree/3b43bc7af5049c8c2fccff8ddd74b881f831d1e1)                                                                                                  |
| Current schema    | v40, upstream `7dd6d0316fd9bd19327e79f622e729dcfe790012`, recorded in [the main-branch source lock](https://github.com/Viritura/Viritura/blob/3b43bc7af5049c8c2fccff8ddd74b881f831d1e1/packages/format/schemas/mnx-schema-source.json) |
| Target upstream   | [`f2a9b5b9864f3c9bfdc74380ff2a760f74c7ce54`](https://github.com/w3c-cg/mnx/commit/f2a9b5b9864f3c9bfdc74380ff2a760f74c7ce54), October 14, 2026                                                                                          |
| Target schema     | [v46](https://github.com/w3c-cg/mnx/blob/f2a9b5b9864f3c9bfdc74380ff2a760f74c7ce54/docs/mnx-schema.json), blob `f27bfbd53b28ac03eb60350b8c38c2aa82422bc3`                                                                               |
| Upstream delta    | [8 commits, 6 schema revisions, 79 changed files](https://github.com/w3c-cg/mnx/compare/7dd6d0316fd9bd19327e79f622e729dcfe790012...f2a9b5b9864f3c9bfdc74380ff2a760f74c7ce54)                                                           |

The source audit used `origin/main` at the pinned Viritura commit, not the
working branch's application files. Relative implementation links below name
the corresponding paths on that main-branch baseline; the main commit above
is authoritative if a local checkout differs.

Scope is the entire v40-to-v46 delta across engine/model, MNX and MusicXML/MXL
import, rendering/export, editing UI, persistence/collaboration, and affected
playback. It is not a general backlog for earlier MNX revisions.

MNX is pre-stable. This upgrade targets v46 directly, without investing in
backward compatibility for older drafts or previously emitted encodings.
Existing documents that already satisfy v46 remain valid; obsolete forms
are not translated automatically at runtime. Repository-owned MNX assets
must instead be updated in place as part of this upgrade and verified with
the v46 parser and engine before release.

Already present on main and **not new implementation work here**:
standard `placement`, sequence `directionHint` stem resolution (Viritura
#256), percussion/hidden-clef schema support, native event caesuras, and
automatic slur/tie-side values. Preserve these behaviors as regressions;
do not redo their rollout.

The schema revision is not `mnx.version`: documents continue to use
`mnx.version: 1`, not `46`.

## 2. Complete upstream change ledger

Semantics were checked against the pinned
[metaspec](https://github.com/w3c-cg/mnx/blob/f2a9b5b9864f3c9bfdc74380ff2a760f74c7ce54/doctools/mnx-metaspec.json)
and schema, not only commit titles.

| Date   | Revision / commit                                                     | Change                                                                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sep 24 | [`25b7d367fd`](https://github.com/w3c-cg/mnx/commit/25b7d367fd)       | Documentation clarifies omitted `sequence.directionHint` defaults to `auto`. Main already implements this feature; retain default-behavior tests.                                                                                     |
| Sep 28 | [`e9b7271b14`](https://github.com/w3c-cg/mnx/commit/e9b7271b14)       | Notationref metadata updates. Refresh affected coverage during release; this is not additional engraving work.                                                                                                                        |
| Sep 29 | v41 / [`0be1b2a7d0`](https://github.com/w3c-cg/mnx/commit/0be1b2a7d0) | Splits dynamics into immediate, gradual, relative and accent schema types with variant-specific required/allowed properties. Intended valid encoding is unchanged, but generated types and permissive aggregate consumers must adapt. |
| Oct 5  | v42 / [`282a7ed5e6`](https://github.com/w3c-cg/mnx/commit/282a7ed5e6) | Allows `glyphs` on every dynamic variant; relative dynamics gain optional `value`.                                                                                                                                                    |
| Oct 6  | v43 / [`55f370eaa2`](https://github.com/w3c-cg/mnx/commit/55f370eaa2) | Adds `global.measures[].caesura`: a caesura centered above the ending barline, distinct from an event attachment.                                                                                                                     |
| Oct 6  | v44 / [`df908ced63`](https://github.com/w3c-cg/mnx/commit/df908ced63) | Adds per-note `markings.slideIn.type: scoop/plop` and `slideOut.type: falloff/doit`. These are not between-note glissando spans.                                                                                                      |
| Oct 14 | v45 / [`ac4d76e4fb`](https://github.com/w3c-cg/mnx/commit/ac4d76e4fb) | Adds lyric `extender: {show?, target?}` and `mnx.support.useLyricExtenders`.                                                                                                                                                          |
| Oct 14 | v46 / [`f2a9b5b986`](https://github.com/w3c-cg/mnx/commit/f2a9b5b986) | Adds native coda and jumps `dc`, `dcAlCoda`, `dcAlFine`, `dsAlCoda`, `dsAlFine`, `toCoda`; retains `segno` and replaces spelling `dsalfine`. Adds D.C. al Fine and D.S. al Coda examples.                                             |

Also bring in the changed existing D.S. al Fine example and check the
measure-repeat example changes in the comparison. Generated reference HTML,
example images and notationref edits are supporting artifacts, not separate
application features.

**Upstream inconsistency:** notationref calls the fall type `fall`, but the
schema and type definition require `falloff`. Implement `falloff`; do not
modify the vendored schema to match the metadata typo.

## 3. Main-branch support audit

| Feature                        | Existing implementation on main                                                                                                                                                                                                                                                                         | Remaining work                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamics                       | [model](../../packages/core/src/model/measure.ts) already has four TS variants, optional `value`, glyphs and `placement`; [parser](../../packages/format/src/mnx/parseGlobal.ts) enforces required variant fields; [serializer](../../packages/format/src/mnx/serializePart.ts) copies populated fields | Raw v40 still uses aggregate `DynamicGroup`/`DynamicGroupType`; v46 removes those schema definitions. Update generated-union consumers and disallow cross-variant properties in canonical output.                                                                                                                                                          |
| Dynamic presentation/UI        | [authoring](../../packages/core/src/operations/dynamicGroups.ts) preserves relative spelling through glyphs; [inspector](../../apps/editor/src/components/inspector/DynamicGroupSection.tsx) exposes relative direction but not relative printed value or a glyph-list editor                           | Complete authoring/editing of the new optional relative value and glyph overrides across variants. Reuse existing dynamic/hairpin rendering rather than replacing it.                                                                                                                                                                                      |
| Dynamic playback               | [envelope](../../packages/midi/src/dynamicsEnvelope.ts) applies relative louder/softer steps independently of glyph spelling                                                                                                                                                                            | Preserve semantics/presentation separation. New printed value must not accidentally become an absolute playback jump.                                                                                                                                                                                                                                      |
| Global caesura                 | [model](../../packages/core/src/model/measure.ts) has `GlobalMeasure.caesura`; event caesuras already parse/serialize natively and render with stroke counts                                                                                                                                            | [global parser](../../packages/format/src/mnx/parseGlobal.ts) does not read native global caesura; [global serializer](../../packages/format/src/mnx/serializer.ts) does not emit it. Existing [Rust caesura renderer](../../engine/viritura-engine/src/layout/render_articulations/tremolo_breath.rs) is event-oriented. Wire the global path end to end. |
| Note slides                    | No slide-in/out model/promotion path found in the audited TS note parser, Rust event model or MusicXML note converter                                                                                                                                                                                   | New native note-marking import/export, engraving, selection, commands and UI. Existing glissando/portamento spans are a different feature.                                                                                                                                                                                                                 |
| Lyric extenders                | [lyric model](../../packages/core/src/model/event.ts) stores text/type; [renderer](../../engine/viritura-engine/src/layout/render_lyrics.rs) draws syllabic hyphens for start/middle syllables                                                                                                          | No extender object/support flag or target-aware word-extension rendering in the audited main paths. Add explicit/inferred lines and target lifecycle management.                                                                                                                                                                                           |
| Lyric import/UI                | [MusicXML extraction](../../packages/musicxml/src/convert/notes.ts) reads text/syllabic/elision; [inspector](../../apps/editor/src/components/inspector/LyricSection.tsx) edits text/type/line                                                                                                          | Add `<extend>` state resolution, including textless continuation nodes; add show/hide/auto and endpoint editing without disrupting Lyrics Panel workflows.                                                                                                                                                                                                 |
| Coda/jump storage              | [jump model](../../packages/core/src/model/measure.ts) supports `segno`, `dsalfine`, vendor `dsalcoda`/`dcalcoda`; coda has location/glyph/color and marker text                                                                                                                                        | Adopt v46 names and native coda. [Parsing](../../packages/format/src/mnx/parseGlobal.ts) currently overlays vendor jumps; [serialization](../../packages/format/src/mnx/serializer.ts) emits al-Coda jumps/coda through vendor blocks. Preserve marker text while migrating storage.                                                                       |
| Navigation playback            | [repeat expansion](../../packages/midi/src/repeatExpansion.ts) handles existing D.S./D.C. variants using measure indices and a text-derived To Coda hint                                                                                                                                                | Native To Coda activation, additional jump types and arbitrary marker locations need a location-aware shared traversal, not just added enum cases.                                                                                                                                                                                                         |
| MusicXML navigation            | [global converter](../../packages/musicxml/src/convert/globalMeasures.ts) supports existing markers and vendor coda                                                                                                                                                                                     | Current `dacapo=yes` maps to `dsalfine`; fix D.C./D.S. distinction and resolve al-Fine/al-Coda/To Coda. Native coda must no longer require vendor-extension opt-in.                                                                                                                                                                                        |
| Fast persistence/collaboration | [delta serializer](../../packages/format/src/mnx/deltaSerializer.ts), [Yjs bridge](../../packages/crdt/src/MnxYjsBridge.ts) and [patch projection](../../packages/crdt/src/yProjection/applyScorePatchesToYDoc.ts) already exist                                                                        | Add typed note/lyric/support edits and fast/full parity coverage. Cold projection being schema-blind does not make the patch adapter automatically correct.                                                                                                                                                                                                |

Current event caesura's decoded property is named `style` and the serializer
maps it to native `shape`. Reuse that mapping; a blanket internal rename is
not required for global caesura support. Existing stroke-rendering limitations
are not a new v43 feature and should not expand this rollout into unrelated
event-caesura redesign.

## 4. Target-format contract: v46 only

1. **One canonical decoded model and v46 output.** Standardized coda and
   jump types use native fields. Preserve unrelated vendor extensions,
   including the current marker-text presentation feature.
2. **No backward-compatibility layer.** Remove the old `dsalfine` spelling,
   vendor `dsalcoda`/`dcalcoda` jump handling and vendor coda storage from
   active models/readers/writers. Do not add aliases, shape normalization,
   dual-schema validation, legacy fixtures or runtime migration/repair
   workflows. Migrating repository-owned assets during implementation is
   required and is not a runtime compatibility feature.
3. **Explicit invalid-input errors.** Reject obsolete jump spellings through
   normal validation. Diagnose retired Viritura vendor navigation fields as
   unsupported input rather than silently dropping them or overlaying native
   fields. Do not merge duplicate old/native representations.
4. **Preserve touched-node metadata.** Retain `id`, `_c`, `_x`, other vendors'
   data, coda glyph/color, and marker-text content/placement. Generated types
   alone do not make handwritten walkers lossless.
5. **Strict variant output.** Dynamics formerly accepted by the aggregate
   schema may contain irrelevant fields. Diagnose illegal combinations;
   do not silently discard authored data to make v46 validate.
6. **Do not dispatch by `mnx.version`.** It does not distinguish these
   drafts. Validate against the single pinned v46 schema; do not retry
   against earlier schemas or infer a compatibility mode from input shape.
7. **Apply the same boundary contract to Rust/WASM callers.** Not every
   engine consumer passes through the editor's TS parser. Share input/
   expected-output fixtures and test equivalent handling at both boundaries.
8. **No runtime persisted-data upgrade.** Invalid input must produce an
   actionable error without rewriting disk/Git/snapshot content. New saves
   use v46 through the normal save flow. Mixed-version collaboration is not
   supported; do not add field translation or compatibility negotiation.

## 5. Implementation packages

```text
A: schema, generation and v46-only boundaries
  +-> B: dynamics
  +-> C: global caesura
  +-> D: note slides
  +-> E: lyric extenders
  +-> F: coda, jumps and performance traversal

A + all B-F -> G: integration, host/export validation and release
```

B-F share A but need not be serialized artificially. Coordinate edits to
shared model/parser/serializer files. Finish each feature as a vertical
slice, not separate import-only and UI-only releases presented as complete.

### A. Schema, code generation and v46-only boundaries

**Surfaces:** [schema sync](../../scripts/sync-mnx-schema.ts),
[format generation scripts](../../packages/format/scripts/),
[TS models](../../packages/core/src/model/),
[format boundary](../../packages/format/src/mnx/),
[Rust promotion](../../engine/viritura-engine/src/promote/).

- Start implementation from the pinned main baseline or newer main after
  checking intervening changes. Do not implement against an older feature
  branch.
- Set `MNX_REPO` to the actual local upstream checkout and `MNX_REF` to the
  target SHA. Run the existing sync and generation tools; never hand-edit
  vendored schemas/generated raw files.
- Regenerate TS and Rust raw types, schema copies and standalone validators.
  Adapt to `dynamic-groups` as an array of four variants and the removal of
  `dynamic-group`/`dynamic-group-type`; derive the canonical discriminator
  from the generated union.
- Apply the v46-only contract above at each input boundary. Remove obsolete
  aliases/vendor readers and update affected consumers directly; do not
  retain an older schema or add a normalization stage.
- Update handwritten node walks and unknown-field diagnostic traversal for
  global caesura/coda, note markings, lyric extender and the support flag.
- Keep full/subtree/delta serialization identical. Update both native
  promotion paths and WASM input paths.
- Add the two new upstream examples, update the renamed jump example and
  affected fixtures/stories directly to v46.

#### Repository-owned MNX corpus migration

- Inventory every tracked `.mnx` file across the implementation checkout,
  not only the upstream fixture list. Include local scores/templates in
  [format fixtures](../../packages/format/fixtures/mnx/) and the
  [minimal viewer sample](../../examples/score-viewer-react-minimal/public/sample.mnx).
  Also find embedded MNX objects/JSON in stories, tests, templates and public
  demo assets; an extension-only search is not sufficient.
- Validate the complete inventory against v46 and inspect retired vendor
  navigation fields, which can otherwise remain schema-valid inside `_x`.
  Update obsolete jump spellings and vendor navigation to native forms,
  correct invalid dynamics combinations, and make any other changes needed
  to preserve each score's musical and presentation intent.
- Preserve IDs, references, marker text/placement, glyph/color and unrelated
  extensions. Resolve ambiguous authored intent explicitly rather than
  deleting content, adding test exclusions or accepting a rendering failure.
  Leave already-valid assets unchanged unless their intended semantics
  require an update.
- Commit the migrated assets alongside the affected implementation. For
  upstream-derived fixtures, prefer the pinned v46 source where available;
  retain intentional local additions. Do not retain an old-schema corpus
  or ship an adapter solely to keep these assets working.
- Add corpus-wide validation and parser/engine smoke coverage using existing
  test infrastructure. Every renderable asset must pass the v46 TS parser
  and Rust/WASM promotion/layout paths, with no unsupported-field loss,
  failed layout or non-finite geometry. Keep intentionally invalid negative
  fixtures explicitly classified and assert their expected errors instead.
- Render changed scores and compare their notation with the intended result;
  cover affected Storybook/demo/viewer consumers and navigation playback
  where applicable. Schema validation alone does not prove a migrated score
  still renders or performs correctly.

**Acceptance:** valid v46 inputs produce valid v46 output; obsolete forms
produce explicit validation/unsupported-input errors without translation.
All repository-owned renderable MNX assets parse and lay out successfully
with v46; no previously working sample is left broken by the upgrade.
Assert raw input-field retention, not only decoded-model equality after
parse/serialize/parse, which can pass even when the first parse dropped data.

### B. Dynamics variants and presentation

- Narrow promotion and serialization by the generated variant discriminator.
  Immediate/accent require `value`; gradual requires `end`/`wedgeType`;
  relative requires `relativeValue` and may have printed `value`.
- Separate shared and variant-only properties in the TS canonical type and
  serializer. Preserve existing accent prefix/suffix/residual values,
  staff/voice scope, cross-staff gradual endpoints and visual continuation.
- Adapt Rust to the generated raw variants. Its decoded layout model may
  remain a validated aggregate if that is simpler; an unrelated model
  redesign is not necessary.
- Reuse [dynamic authoring](../../packages/core/src/operations/dynamicGroups.ts)
  and [rendering](../../engine/viritura-engine/src/layout/render_annotations/dynamics.rs).
  Verify glyph lists work on all four types, with prefix/suffix geometry and
  selection bounds. Resolve unsupported glyphs through explicit capability
  diagnostics, not silent spelling substitution.
- Prefer explicit `glyphs` for UI-authored markings where an appropriate
  supported glyph or sequence exists, alongside the required semantic fields.
  For example, choosing fff stores its semantic value and the precomposed
  fortississimo glyph. Do not require a glyph override for a hairpin or other
  notation that is not naturally represented by a glyph sequence.
- Accept both semantic-only and explicit-glyph encodings from other
  applications. Honor explicit glyph sequences without consolidating them;
  otherwise derive the normal appearance from semantic fields. Equivalent
  encodings must have consistent user-facing selection and editing behavior.
  Preserve incoming glyph presence/absence and sequence on unedited
  round-trips; opening or saving must not introduce a visible change or
  silently impose Viritura's authoring preference on imported markings.
- Extend [the inspector](../../apps/editor/src/components/inspector/DynamicGroupSection.tsx)
  with musical marking/appearance controls and the relative printed marking.
  Users must not need to understand `value`, `relativeValue`, glyph arrays or
  which encoding the source application chose. A deliberate marking change
  updates semantics and appearance together using the UI authoring policy;
  unrelated edits preserve the imported representation. Keep any advanced
  appearance customization separate from performance intent. Update
  relative-group construction to retain the printed value where appropriate
  rather than only its glyph spelling.
- Preserve existing relative playback policy: glyph changes are presentation,
  and the optional printed value must not accidentally override louder/softer
  performance interpretation.

**Acceptance:** required/forbidden properties for each variant; glyph overrides
on all four variants; relative value present/absent; empty glyph-array
behavior; accent residual levels; cross-staff hairpins; undo/save/reload and
full/delta/CRDT parity. Test UI-authored explicit glyphs, imported semantic-only
marks, precomposed overrides and multi-glyph overrides through open/render/
edit/save/reopen. Assert unchanged appearance on unedited round-trips,
consistent controls regardless of encoding, no stale override after changing
a marking, and unchanged playback semantics when only appearance changes.

### C. Global caesuras

- Reuse the existing event caesura model/mapping: native `shape` defaults to
  normal and `marks` defaults to 2. Preserve native global attributes.
- Add native global parsing/serialization and Rust promotion. Close the
  global-model persistence gap rather than rebuilding event support.
- Add a global engraving path centered above the measure's ending barline,
  including repeated/system-final barlines. Render the global caesura on
  every displayed staff, including each staff of multi-staff instruments,
  in both full scores and part extracts. Reserve collision space and emit
  selectable bounds for each rendered instance, all referring to the same
  global caesura; editing any instance updates the shared marking.
- Wire barline selection to global caesura authoring; keep note/rest selection
  attached to an event. Add attachment-aware inspector shape/stroke/remove
  controls using existing commands/palette patterns.
- Update [holds](../../packages/midi/src/holds.ts) for a global pause at bar
  end. Merge coincident pauses rather than applying one per staff or doubling
  an event/global coincidence. Preserve the existing playback duration policy;
  stroke count is not a pause multiplier.

**Acceptance:** global save retention, defaults and all supported shapes/stroke
counts; correct barline anchor on every displayed staff in scores/extracts;
event/global distinction; system breaks; editing/deleting any instance and
undo updating all instances; one merged performance hold regardless of staff
count; and cached/cold parity.

### D. Note markings: scoop, plop, falloff and doit

- Add a separate typed `NoteMarkings` container on individual TS/Rust notes,
  initially supporting `slideIn` and `slideOut`, with nested metadata and
  handwritten promotion/serialization. Follow existing event-marking model
  and operation patterns, but target a specific note rather than its grouped
  event/chord. Do not add these fields to the event articulation union or
  introduce a generic framework for hypothetical future marking types.
- Implement Rust note-anchored glyph/path geometry with spacing and collision
  accounting for chords, accidentals, ledger lines, stems, slurs and system
  edges. Reuse existing display-list commands; no new opcode unless required.
- Emit stable note-scoped IDs and selection bounds. Extend typed patches,
  clone/copy/paste and deletion so different notes of a chord remain distinct.
- Add a separate **Note markings** palette immediately after **Articulations**
  in the UI, initially offering Scoop, Plop, Falloff and Doit. Keep it separate
  from the articulation palette while reusing its interaction patterns.
  Route actions and inspector slide-in/slide-out controls through note-targeted
  commands, with independent remove/reset and multi-selection rules. An
  operation must not modify unselected chord members. Keep between-note
  glissando/portamento commands separate.
- Convert MusicXML articulation scoop/plop/doit/falloff onto the originating
  note, not every note in the chord. Native output must work with vendor
  extensions disabled. MusicXML `<slide>` remains a span.
- Do not invent pitch-bend amounts or durations: upstream defines notation,
  not a timed performance curve. Preserve notation and state the playback
  capability explicitly.

**Acceptance:** each type, simultaneous in/out, mixed chord members,
grace/tuplet/cross-staff notes, system-edge spacing, edit/delete/undo/paste,
MusicXML/MXL conversion, and Canvas/SVG/PDF output. Verify the separate palette
appears immediately after Articulations and edits only the targeted notes,
without changing existing event/chord articulation behavior.

### E. Lyric extenders

| Input                                               | Required interpretation                                        |
| --------------------------------------------------- | -------------------------------------------------------------- |
| Support flag omitted/false; no extender on syllable | Infer whether/how far to extend.                               |
| Support flag true; no extender                      | No extender.                                                   |
| `extender: {}` or `show:true`                       | Draw; infer endpoint if absent, regardless of support flag.    |
| `show:false`                                        | Suppress; ignore target.                                       |
| Active `target`                                     | End through the full width of the target event, not its onset. |

- Add extender and support flag to TS/Rust models and every format path.
  Preserve omission versus explicit false and retain nested global attrs.
- Resolve target by stable ID and musical time. It may be the carrier itself
  or any event at/after it, including another voice/part. For an active
  target, diagnose missing/backward references and conflicting syllable
  intent in the same lyric line.
- Implement word-extension lines separately from existing syllabic hyphens.
  Specify automatic inference through textless passages, tied notes and rest
  boundaries using engraving examples; do not treat start/middle syllabic
  hyphens as existing melisma-line support.
- Add system/page segmentation, text-to-line gaps, verse-specific vertical
  placement, collisions and selectable segment geometry. Part extracts must
  resolve target time even when the target part is not displayed.
- Track source/target/intermediate-system dependencies so endpoint duration/
  position changes or reflow invalidate all affected segments, not merely
  the edited target measure.
- Extend [lyric commands](../../apps/editor/src/commands/lyricCommands.ts),
  [inspector](../../apps/editor/src/components/inspector/LyricSection.tsx),
  keyboard entry and Lyrics Panel workflows with Auto/Show/Hide and endpoint
  picking/clearing. Expose document explicit-extender policy in advanced
  settings; adding one explicit line must not flip that global policy.
- Extend MusicXML `<extend>` start/continue/stop resolution across measures
  and textless continuation nodes, independently for each verse/voice. Set
  the support flag true only when all extender intent is explicit.
- Remap references on paste/duplicate; maintain them across split/join,
  deletion, redistribution, undo and collaboration. External clipboard
  targets need a documented preserve/remap/clear-with-diagnostic policy.

**Acceptance:** every table row; multiple verses, self/other-voice/other-part
targets, target duration edits, tied melismas/rest boundaries, system/page
breaks, extracts, invalid active refs, ignored refs under `show:false`, and
remote endpoint edits.

### F. Native coda, all jumps and correct performance traversal

- Canonical jump union is `dc`, `dcAlCoda`, `dcAlFine`, `dsAlCoda`,
  `dsAlFine`, `segno`, `toCoda`. Replace current aliases/vendor storage
  in the implementation with native coda/jump; do not read old encodings.
- Preserve main's existing marker-text content/placement feature while moving
  coda storage. Preserve native glyph/color and other vendor metadata.
- Extend [jump rendering](../../engine/viritura-engine/src/layout/render_annotations/jump_markers.rs),
  collision/spacing, coda geometry, semantic IDs and navigation/deletion.
  Distinguish a coda destination from a To Coda instruction.
- Replace string-based palette edits with typed commands for all seven
  jumps. Add marker location and applicable glyph/color/text inspector
  controls. Landing markers and concluding instructions must use the proper
  selected bar/beat; do not write every location as zero.
- Fix MusicXML D.C./D.S. interpretation and combine sound/direction
  `dacapo`, `dalsegno`, `tocoda`, coda/segno destinations and Fine intent.
  Native coda must not depend on extension opt-in; update drop diagnostics.
- Replace first-jump/whole-measure expansion with a bounded itinerary carrying
  repeat/replay state and armed Fine/Coda conditions. Ignore `toCoda` before
  an al-Coda replay; take it after `dcAlCoda`/`dsAlCoda`. Plain D.C./D.S.
  must not stop unconditionally at Fine.
- Honor rhythmic locations for jump, destination and Fine. A `number[]` of
  measure indices cannot express partial measures; use played measure spans
  or an equivalent location-aware representation.
- Thread the same itinerary through MIDI, performance events, tempo,
  dynamics/holds, transport seeking/playhead and video synchronization.
  Add loop detection and actionable invalid-route errors.
- Validate unique required destinations: v46 assumes exactly one referenced
  segno/coda/Fine, not multiple named destinations. Do not choose the last
  one silently.
- Remove text-inferred To Coda. Require an explicit native trigger; do not
  synthesize jumps from text or add a legacy conversion/repair workflow.

**Acceptance:** both new upstream examples; all seven jump types; initial/
armed To Coda behavior; missing/duplicate destinations; nonzero fractions;
Fine on replay; repeats/voltas plus jumps; finite termination; timing/state
and seek/playhead correctness across shared playback consumers.

### G. Integration and release

- Extend [typed patches](../../packages/core/src/patches/types.ts),
  [patch application](../../packages/core/src/patches/applyToScore.ts),
  [affected measures](../../packages/core/src/patches/affectedMeasures.ts),
  Yjs fast projection and delta serialization for new note/lyric/support
  edits. Reuse cohesive patch kinds rather than creating redundant APIs.
- Test cold/cached layout after create/change/delete, including remote lyric
  targets and global support-policy changes. Serialization hashes alone do
  not prove dependency invalidation correct.
- Exercise save/open, autosave, Git versions, snapshots, clipboard,
  collaboration reconnect and semantic diff using v46 data and matching
  client versions; mixed-version room support is outside this upgrade.
- Validate editor and public converter MNX/MusicXML/MXL flows. Check actual
  [MUSX/Denigma output](../../packages/musx-import/src/denigmaModule.ts)
  against the v46 boundary rather than assuming the external WASM producer
  has upgraded. Require an updated producer for affected output; report
  unsupported output explicitly instead of adding an old-draft adapter.
- Verify shared WASM/schema assets in editor, website previews/tools,
  embedded viewer, desktop and VS Code viewer. Keep Monaco schema declarations
  consistent with runtime validation.
- Re-run the complete repository MNX corpus gate after all feature packages
  land. Verify migrated files are the actual assets loaded by stories,
  demos and packaged viewers, not only test copies.
- Reuse Canvas/SVG/PDF glyph/path painters; keep engraving in Rust. Add native
  MNX stories per feature and composed-app stories for new editing workflows.
- Update [file format](../spec/file-format.md),
  [data-model pipeline](../spec/data-model-pipeline.md),
  [vendor extensions](../spec/viritura-extensions.md),
  [dynamics](../spec/dynamics.md),
  [converter coverage](../spec/mnx-converter-coverage.md),
  affected public guides and site support labels. Refresh
  [notationref coverage](../spec/music-notationref-coverage.md) with its
  repository audit workflow, not upstream metadata alone. Correct the
  `fall`/`falloff` mismatch in local audit interpretation.

## 6. Validation and completion gates

Every feature needs native/invalid fixtures, input-field preservation,
validated output, correct geometry and selectable bounds, discoverable
create/edit/remove, undo/redo/paste, save/reopen, full/delta/Yjs parity,
cached/cold parity and applicable playback/export checks.

Reuse [format round-trip tests](../../packages/format/src/__tests__/roundtrip.test.ts),
[schema tests](../../packages/format/src/__tests__/schemaValidation.test.ts),
[delta tests](../../packages/format/src/__tests__/deltaSerializer.test.ts),
[Yjs patch tests](../../packages/crdt/src/__tests__/applyScorePatchesToYDoc.test.ts),
and feature-organized Rust layout tests. Add direct raw-field retention
assertions where decoded-model round-trip tests cannot detect first-parse loss.

Planned commands below are implementation gates, not tests already run by
this source audit. Use targeted file selectors during development, then the
affected package suites at integration:

```powershell
# After setting MNX_REPO and MNX_REF to the verified target:
pnpm mnx:schema:sync
pnpm --filter @viritura/format gen:validators
pnpm mnx:schema:check
pnpm --filter @viritura/format gen:raw:check
pnpm --filter @viritura/format gen:raw-viritura:check
pnpm --filter @viritura/format gen:validators:check
pnpm gen:raw:rust:check

pnpm --filter @viritura/format test
pnpm --filter @viritura/core test
pnpm --filter @viritura/musicxml test
pnpm --filter @viritura/crdt test
pnpm --filter @viritura/midi test
pnpm --filter @viritura/renderer test
pnpm --filter @viritura/editor test
pnpm --filter @viritura/musx-import test
pnpm test:rust
pnpm test:rust:wasm
pnpm lint:rust:size
pnpm build:ts
pnpm notationref:test
```

For visual acceptance use `pnpm dev:stack`, never direct dev-server startup:

```powershell
pnpm test:rust
pnpm dev:stack up storybook-mnx
pnpm dev:stack up ui
pnpm dev:stack url
```

UI-capable profiles run the cache-aware WASM builder; invoke
`pnpm dev:stack wasm` explicitly when needed. Verify route readiness and
hard-refresh before comparing reference images/new upstream examples.
Cover score/part extracts, condensed views, system/page breaks and export.
Add targeted Playwright create/edit/save/reload and collaboration workflows;
run the configured `pnpm e2e:smoke` gate against the stack.

Keep existing `directionHint`, placement, clef, event-caesura and slur/tie
tests green. They are regression gates, not new delivery packages.

## 7. Recommended implementation order

Deliver as stacked GitHub PRs. Each branch targets the previous branch;
the first targets `main`. Each feature PR owns its models, format paths,
engine behavior, UI, patches/collaboration, tests, stories and directly related
documentation. The final integration PR is not a substitute for vertical
feature completion.

| PR  | Branch                           | Scope                                                                                                                          |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `feat/mnx46-foundation`          | A: v46 schema/generation, existing-consumer alignment, native navigation storage, required corpus migration and approved plan. |
| 2   | `feat/mnx46-dynamics`            | B: strict variants, explicit-glyph UI authoring and transparent imported dynamics handling.                                    |
| 3   | `feat/mnx46-global-caesuras`     | C: global caesura persistence, every-staff rendering, editing and merged performance holds.                                    |
| 4   | `feat/mnx46-note-markings`       | D: per-note markings, separate palette, conversion and engraving.                                                              |
| 5   | `feat/mnx46-lyric-extenders`     | E: extender semantics, target lifecycle, layout, conversion and editing.                                                       |
| 6   | `feat/mnx46-navigation`          | F: native navigation authoring, rhythmic locations, engraving and interchange.                                                 |
| 7   | `feat/mnx46-navigation-playback` | F: shared location-aware itinerary and all playback consumers.                                                                 |
| 8   | `feat/mnx46-integration`         | G: complete corpus, host/export/collaboration evidence and release documentation.                                              |

PR 1 must preserve working baseline behavior, not merely update generated
files. Migrate assets alongside the implementation that needs each change,
then re-run the complete corpus gate at integration. Publish only implemented
work, report exact validation results and keep incomplete or unverified work
clearly marked as draft. Merge in stack order; the overall upgrade is not
release-complete until all gates pass.

The largest new work is lyric-span dependency/layout and navigation
traversal. Dynamics is primarily schema-consumer and presentation completion;
global caesura extends existing event infrastructure.

**Release criterion:** all six schema revisions have end-to-end evidence
across applicable surfaces, both documentation-only commits are accounted
for, current-main behavior remains intact, and no feature is claimed complete
while available only through raw JSON or import-only preservation. Every
repository-owned renderable MNX asset has been migrated where necessary and
verified against the v46 parser and engine; broken bundled scores are a
release blocker.
