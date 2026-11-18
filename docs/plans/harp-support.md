# Harp Pedals: Implementation Plan

> **Status:** Proposed; no application behavior is changed by this document.
> Source-audited at `90a417c8` on 2026-11-18.

## 1. Goals and confirmed behavior

Implement concert double-action pedal-harp support:

1. Explicit, time-positioned seven-pedal settings, shared by both staves.
2. A simple greedy calculation that chooses a setting covering the longest
   upcoming passage before another setting is needed.
3. Playback of harp glissandos through the strings selected by those pedals,
   rather than through the key signature's diatonic pitch classes.
4. Red noteheads for written notes that disagree with the pedals.

**Confirmed during planning:** ordinary notes keep their written/sounding
pitch in playback, even when incompatible with the pedals. Warn rather than
retune, silence, or rewrite them. The first calculator preserves spelling.
An enharmonic-aware solver is a later extension, not natural-harmonic support.

The remaining policies below are proposed defaults, made explicit so that
implementation does not silently choose musical behavior.

Not included in v1: automatic enharmonic respelling, lever/single-action
harps, pedal-motion audio, physically modeled retuning of ringing strings,
special harp techniques, or a full MusicXML harp-marking interchange project.
The calculator is a pitch-feasibility aid, not a guarantee of human
playability or globally minimal pedal changes.

## 2. Current implementation and integration points

| Area                  | Verified baseline                                                                                                                                                                                                                                                                        | Planned integration                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrument identity   | [Catalog](../../apps/editor/src/score/instrumentCatalogDataExtras.ts) has `pluck.harp`, two staves, brace, and GM program 46. [Active-instrument resolution](../../packages/core/src/model/instrumentChange.ts) supports mid-part changes.                                               | Resolve the active semantic identity, not the name or chosen sound patch. Keep different harp parts independent.                                               |
| Score model           | [PartMeasure](../../packages/core/src/model/measure.ts) has positioned directions and piano `pedals`, but no harp tuning.                                                                                                                                                                | Add a separate `harpPedals` collection; do not reuse sustain-pedal spans or CC64.                                                                              |
| Persistence           | [Vendor schema](../../packages/format/schemas/viritura-extensions.json), [TS parser](../../packages/format/src/mnx/parseParts.ts), and [serializer](../../packages/format/src/mnx/serializePart.ts) own measure extensions.                                                              | Add vendor-schema definitions, regenerate wire types/validators, and wire both decoded models using the [data-model pipeline](../spec/data-model-pipeline.md). |
| Editing/collaboration | [Typed patches](../../packages/core/src/patches/types.ts), [delta serialization](../../packages/format/src/mnx/deltaSerializer.ts), and [Yjs patch projection](../../packages/crdt/src/yProjection/applyScorePatchesToYDoc.ts) are distinct integration surfaces.                        | Add typed pedal mutations, undo/redo, bounded projection, and fast/full persistence parity.                                                                    |
| Glissando playback    | [Realization](../../packages/midi/src/glissandoPlayback/index.ts) runs after navigation, with chromatic, key-based diatonic, and bend modes. Its diatonic mode uses a set of pitch classes.                                                                                              | Add pedal/string realization without replacing ordinary non-harp glissando behavior.                                                                           |
| Playback consumers    | [Timeline](../../packages/midi/src/timeline.ts) feeds MIDI/SoundFont playback. [Native transport](../../apps/editor/src/instrumentProfiles/vstTransport.ts) currently routes parts with glissandos to browser SoundFont playback rather than the separate native performance-event path. | Preserve and test that explicit fallback; do not claim new native/VST glissando support.                                                                       |
| Notehead rendering    | [Element-command lookup](../../packages/renderer/src/selectionHighlight.ts) indexes notehead descendants such as `/n0`; [score painting](../../apps/editor/src/components/ScoreCanvas/paintScoreFrame.ts) already layers interactive overlays over cached ink.                           | Re-ink only affected noteheads in an editor-only warning layer, without changing saved colors or Rust musical layout.                                          |

No harp-pedal authoring/model implementation was found in the audited paths.
Existing generic harp sounds and cross-staff glissando engraving remain useful
and should not be reimplemented.

## 3. Persisted contract and pedal-state resolution

### Wire shape

Add `parts[].measures[]._x.viritura.harpPedals[]`. Example:

```json
{
  "_x": {
    "viritura": {
      "harpPedals": [
        {
          "id": "pedal-setting-id",
          "position": { "fraction": [0, 1] },
          "tuning": { "C": 0, "D": -1, "E": 0, "F": 1, "G": 0, "A": 0, "B": -1 },
          "source": "manual"
        }
      ]
    }
  }
}
```

- Every entry is a **full seven-pedal snapshot**. Alterations are exactly
  `-1`, `0`, or `1`; unknown/missing letters are not implicitly natural.
- Require a stable ID, an explicit native rhythmic position, and all seven
  tuning keys. `source` is `manual` or `calculated`; omission means manual.
  Editing a calculated snapshot manually changes its source to manual.
- The decoded `PartMeasure.harpPedals` promotes the wire collection, following
  existing measure-extension patterns. Do not hand-edit generated files.
- Begin with one canonical diagram presentation. Printed placement overrides
  may target a staff, but the musical setting always belongs to the whole part.
  Visibility must never control whether a setting affects playback.
- Reject invalid alterations, duplicate IDs, and duplicate positions within
  the same part measure. Compare fractions exactly, including equivalent
  fractions; array order must not decide conflicting settings.

### Resolver semantics

Create a cohesive `harp` feature folder in `@viritura/core`, exported through
package barrels. It owns pedal types, ordered state resolution, source-note
compatibility, and the calculator. MIDI owns performed-time realization.

1. A snapshot takes effect at its exact position, before notes at that position,
   across every voice and staff, and inherits until replaced.
2. State before the first snapshot is **unknown**, not C major and not the
   key signature. Do not mark notes red without a known setting. The
   explicit-setting dialog can offer all-natural as a clearly labeled starting
   value, without persisting it until Apply.
3. The active `pluck.harp` instrument segment gates analysis. Resolve existing
   instrument definitions/changes; changing the sample sound does not disable
   pedals. Leaving and re-entering harp starts a new unknown segment unless
   an explicit snapshot establishes its tuning.
4. Key signatures do not move pedals. Use the note's semantic spelled pitch,
   not the displayed accidental glyph; absent `alter` means natural.
   Concert harp is non-transposing. Do not reinterpret a concert/transposed
   view toggle as a pedal change; report unsupported nonstandard harp
   transposition rather than guessing a physical string spelling.
5. Cache ordered snapshots per immutable part revision, and use indexed
   lookups. Do not rescan the entire score for every note or paint frame.
6. On seek, loop restart, or a discontinuous navigation jump, reconstruct the
   destination's score-order state, including snapshots before the destination.
   Do not accidentally carry the last chronological playback state into a
   repeated passage. A destination before any snapshot remains unknown.

Ordinary compatibility is spelling-specific: C-sharp requires the C pedal
at `1`, even when the D pedal at `-1` would make the same MIDI pitch.
All octaves of a letter share the constraint. Double accidentals and microtones
cannot be satisfied by this pedal model and have red noteheads when the setting
is known.
Instrument range checks remain separate. Instrument-specific fixed extreme
strings and alternate tunings require a later capability model; v1 does not
certify those physical details.

## 4. Explicit authoring and engraving

- Add **Set harp pedals** at the resolved selection/caret position and a
  properties section for an existing setting. Selecting either staff targets
  the same part-wide snapshot; deduplicate multi-staff selections.
- Present controls in physical diagram order **D C B | E F G A**, with
  flat/natural/sharp states, keyboard access, and readable labels.
- Add/select/move/delete a diagram through the normal command/selection
  system. Multiple settings within one measure must be possible.
  An unresolved selection reports an error, never defaults to measure 1.
- Apply all seven values atomically, in one undoable collaborative edit.
  A local draft must detect a concurrently changed/deleted snapshot rather
  than blindly overwriting another user's changes.
- Draw one diagram for the part, below the lower staff by default. Rust owns
  geometry, rhythmic anchoring, horizontal spacing, collision avoidance,
  measure-rest consolidation barriers, and page/system placement. Carry the
  stable setting ID through selection/hit-testing and part extracts.
- Use Bravura SMuFL pedal glyphs: raised/flat `U+E680`, centered/natural
  `U+E681`, lowered/sharp `U+E682`, and divider `U+E683`. Verify glyph metrics
  and diagram geometry, rather than inventing unrelated symbols.

Notation references:
[MusicXML harp-pedals](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/harp-pedals/)
documents the conventional pedal order;
[SMuFL harp techniques](https://w3c-cg.github.io/smufl/latest/tables/harp-techniques.html)
defines pedal positions and glyphs.

## 5. Greedy calculation: longest compatible prefix

### Inputs and scope

**Calculate harp pedals** opens a preview for the active harp part or a bounded
selection. Preserve every manual snapshot as a hard anchor. Recompute only
calculated snapshots inside the chosen scope. Do not run or persist the
calculator automatically whenever notes change.

Build one ordered stream of musical constraints across both staves and all
voices. Use exact score-time positions and existing rhythmic traversal/timing
primitives, including tuplets, spaces, pickups, grace groups, and ties.
[The event walker](../../packages/core/src/model/sequenceWalk.ts) supplies
structural traversal, not complete timing; do not mistake it for a beat map.

Group simultaneous attacks before choosing a setting. A tied/held written note
constrains its letter through its notated release, using half-open intervals.
Do not use reverb tails or sampler envelope lengths as notation constraints.
Treat a grace cluster conservatively as one pedal-stable group and disclose
that policy rather than promising sub-grace pedal choreography.

### Algorithm

For each region bounded by manual snapshots or the requested end:

1. If a manual snapshot fixes the current boundary, retain it exactly and
   advance until its first incompatible onset. A conflict at the manual
   snapshot's own position is unsolved; never insert a calculated snapshot
   at that same position to override it. Otherwise start at the requested
   boundary, where the calculator may choose a new setting.
2. At a free boundary, collect sounding constraints and the next onset group.
   Two required alterations for the same letter at the same time are
   unsatisfiable, even in different octaves or voices.
3. Scan forward, accumulating at most one required alteration per letter.
   Stop immediately before the first conflicting demand, a manual snapshot,
   or the region end. This is the longest prefix one fixed tuning can cover.
4. Fill constrained pedals from that prefix. For unused letters, retain the
   incoming known setting; if there is none, use natural as a deterministic
   calculator tie-break, not as an implicit playback default.
5. Emit a snapshot at the boundary only if tuning changes or initial state is
   unknown. Continue at the first incompatible onset, carrying held-note
   constraints. Respect explicit manual snapshots, even if they cause warnings;
   never quietly edit them to make the result work.
6. If held notes conflict with a new attack, report the exact notes, letter,
   and location. A pedal cannot simultaneously satisfy both. Do not generate
   repeated zero-length settings, respell notes, or silently drop constraints.

For example, C-natural followed later by F-sharp and then C-sharp needs two
settings: prepare F-sharp in the first setting even before its first use,
then change C at the C-sharp onset. C-natural and C-sharp simultaneously,
including an overlap from a held note, cannot be solved without changing
notation or performance assumptions.

This is longest-prefix greedy, **not** a proof of minimum total pedal movements
or ergonomic feasibility. No `3^7` enumeration is needed while written-letter
constraints are independent. Sort/build the constraint stream once, then
advance a cursor; do not repeatedly rescan the remaining score.

### Preview and application safety

- Preview proposed diagrams, changed pedals, covered spans, and unsolved
  locations. Show existing manual-marker mismatches as red noteheads, without
  a separate mismatch message.
- Use one explicit Apply and one undo transaction. If the requested region
  has unsolved requirements, block Apply and let the user revise the scope
  or music; do not present partial calculation as a successful solve.
- For a bounded selection, preserve tuning outside it. Restore the original
  known tuning at the exclusive end when needed, unless an existing manual
  snapshot already does so. If the original following state was unknown,
  block bounded application and explain that the scope must extend through
  the part/harp segment end or to a user-established boundary setting.
- Revalidate against the current document revision on Apply. Repeated
  calculation with unchanged input produces the same settings, without
  duplicate markers or needless replacement of unchanged IDs.
- Unannotated glissando interiors contribute no invented harmonic target.
  Their endpoints constrain spelling; unconstrained pedals follow the stated
  tie-break. Show the resulting glissando pitch sequence in the preview.
  Inferring an intended glissando scale/chord is deferred.

## 6. Playback contract

### Ordinary notes

Keep the existing semantic pitch, articulation, ties, and timing for every
authored note. A pedal mismatch is a validation issue, not permission to change
its sound. Sustain-pedal CC64 behavior remains unrelated.

### Harp glissandos

Add explicit `playbackType: "harp-pedals"` to the vendor schema/model and
inspector. When playback type is omitted, a glissando on an active harp uses
pedals; other instruments retain the current diatonic default. Portamento
retains its bend default. Existing explicit chromatic/diatonic/bend overrides
remain intentional overrides and stay visible in the playback-type control.
Changing the old omitted harp default is intentional and must be documented.

Realize a pedal glissando as an ordered sweep of **physical spelled strings**:

1. Resolve source and target notes back to their spelled letter/octave.
   Current MIDI events retain event IDs but not individual spelled-note
   identity; carry a stable note reference through realization so chords,
   enharmonic unisons, and cross-staff endpoints are not guessed from MIDI
   numbers alone.
2. Walk intervening letter/octave strings ascending or descending. At each
   generated attack's score position, resolve the active pedal and calculate
   `naturalMidi(letter, octave) + pedalAlter(letter)`.
3. Preserve duplicate sounding pitches from different strings. For example,
   C-sharp and D-flat are two attacks, not one deduplicated pitch class.
   Handle C-flat and B-sharp across octave boundaries without modulo errors.
4. Retain the existing sweep-duration policy, lane isolation, dynamics, and
   target-once behavior. Source and target attacks retain their authored
   pitches, including mismatches; only generated interior string attacks
   derive their pitch from pedals.
5. A snapshot inside the glissando affects generated attacks at or after its
   position. Scheduling walks strings independently of tuning, so a change
   does not restart the sweep or change its event count. Previously attacked
   strings are not retroactively retuned.
6. Use the actual performed itinerary and source-beat mapping, not a naive
   expanded measure index. Never sweep across an unplayed jump; seek and
   repeated occurrences resolve the correct source setting.

For unknown tuning, invalid endpoints, or an unsupported span, emit a
structured diagnostic and preserve ordinary endpoint playback without
inventing intermediate pitches. Do not silently substitute C major,
key-signature diatonic playback, or a guessed setting.
An explicit harp-pedal playback mode on a non-harp segment is unsupported,
not an instruction to treat another instrument as a harp.

Reuse [timeline diagnostics](../../packages/midi/src/types.ts), extending
codes and source detail as needed. Browser playback and MIDI scheduling must
consume the same realized pitches. Retain the native/VST browser-SoundFont
fallback until the separate performance-event path supports equivalent
realization; test that fallback and its notice rather than broadening this
work into a native transport rewrite.

## 7. Derived notehead warnings

- The core analysis identifies mismatches by stable part/event/note identity.
  Reuse the result for the calculator preview and notehead overlay.
- Render each confirmed mismatched notehead red, not the whole chord, stem,
  accidental, or staff. Red is the only note-level warning: do not add a
  warning banner, explanatory text, issue list, inspector message, or new
  visibility control. A missing initial tuning does not turn notes red.
- Calculator failures and unsupported glissando playback remain explicit
  operation errors; they are not additional note-mismatch warnings.
- Re-ink indexed notehead commands in a dedicated editor overlay. Do not
  mutate the display list, saved note colors, binary protocol, or score data.
  Reuse shared renderer painting and exact command indexing; avoid scanning
  every command for every warned note on each frame.
- Paint warnings over cached score ink and selection ink so selected
  mismatched noteheads remain red; preserve the selection halo and playhead.
  Exclude warnings from PDF/SVG, print preview, and exported notation by default.
- Keep overlays correct in page/horizon modes, part extracts, zooming,
  cross-staff placement, retained chunks, and optimistic note edits.
  Invalidate analysis from an edited snapshot through the next snapshot or
  instrument boundary; deletion must extend the invalidation to that boundary.
  Refresh warning colors even when no Rust geometry changed.
- A held/tied note crossing a conflicting manual setting has its source
  notehead rendered red; ordinary audio still stays pitched as authored.

## 8. Delivery sequence and acceptance gates

| Phase                 | Deliverable                                                                                                                    | Required evidence before moving on                                                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Contract and state | Vendor schema, generated artifacts, TS/Rust models, parse/promote/demote, shared resolver and structured issues.               | Full/delta round-trips; schema rejection cases; both-staff inheritance; exact mid-measure boundaries; unknown state; instrument changes.                                                                                     |
| 2. Explicit settings  | Typed add/update/move/remove patches, command/dialog/properties, diagram engraving, hit-testing, undo/redo, and collaboration. | Save/reopen; remote edits; fast/full Yjs parity; duplicate-position conflicts; part extracts; collision and system/page placement; an MNX Storybook story.                                                                   |
| 3. Greedy calculator  | Constraint stream, longest-prefix solver, protected manual anchors, preview, atomic Apply, and scope restoration.              | Future-unused-pedal preparation; simultaneous/overlapping conflicts; ties/tuplets/graces; stable reruns; selection boundaries; no mutations before Apply.                                                                    |
| 4. Playback           | Harp-pedal glissando mode, instrument-aware default, timed state lookup, diagnostics, and unchanged ordinary-note pitch.       | Exact generated pitches/times; ascending/descending; enharmonic duplicates; C-flat/B-sharp; mid-gliss changes; chords/cross-staff spans; repeats/jumps/seeking; explicit override and non-harp regressions; native fallback. |
| 5. Warning UX         | Cached analysis and red notehead-only overlay, with no warning banner or explanatory text.                                     | One bad chord note only; red remains visible when selected; mismatch playback unchanged; fix/delete/undo/remote edit refresh; selection/retention/zoom; warnings absent from exports and print preview; app Storybook story. |

Phases 2 and 3 depend on phase 1; playback and warning analysis also depend
on the shared contract. Ship the complete vertical slice only after all five
acceptance gates; intermediate PRs must not advertise finished harp support.

### Validation commands for implementation

Use focused Vitest selectors for each changed feature before wider package
suites. Existing package-level commands include:

```powershell
pnpm --filter @viritura/core test
pnpm --filter @viritura/format test
pnpm --filter @viritura/crdt test
pnpm --filter @viritura/midi test
pnpm --filter @viritura/renderer test
pnpm --filter @viritura/editor test
```

Run targeted Rust harp-diagram tests first; run `pnpm test:rust` and rebuild
WASM for the integrated visual gate. Start only needed app/Storybook services
with `pnpm dev:stack`, and compare diagram/warning fixtures visually.
Run affected TypeScript builds, generated-output checks, and lint before
delivery. Do not install dependencies or build WASM merely to review this plan.

Implementation must update the
[extension reference](../spec/viritura-extensions.md),
[selection contract](../spec/selection-behavior-matrix.md), and musician-facing
guidance. Update affected notation-reference coverage only after delivered
behavior is source-audited. No implementation tests were run for this
documentation-only plan.

## 9. Later extension: enharmonic-aware solving

The next step should optimize **alternative string spellings for the same
sounding pitches**, not change the composition:

- Enumerate feasible letter/alteration choices for each sounding pitch,
  restricted to the harp's flat/natural/sharp strings. Preserve sounding
  octave correctly for B-sharp and C-flat.
- Search the small `3^7 = 2,187` tuning space, filtering by simultaneous and
  sustained-note requirements. Use shortest-path/dynamic programming over
  relevant boundaries, with costs for pedal movements, required time,
  left/right-foot conflicts, distance moved, and respelling.
- Treat explicit manual settings as locked. Prefer unchanged spellings;
  preview any spelling changes with cautionary accidentals and tie consistency.
  Never mutate notes as an invisible side effect of calculating pedals.
- For glissandos, allow an explicitly chosen target pitch set/chord/scale,
  then find pedal settings producing it, including intentional repeated
  pitches on enharmonic strings. Do not infer this intent from endpoints alone.
- Offer ranked alternatives when useful: fewer pedal changes versus fewer
  respellings. Keep deterministic scoring and report unsatisfiable regions.

Keep this behind a separate future mode. V1 needs no general solver framework,
respelling permissions, or speculative harmony-analysis dependency.
