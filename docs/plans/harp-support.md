# Harp Pedals: Implementation Plan

> **Status:** Implementation in progress; persisted harp pedal snapshots and diagram rendering are implemented.
> Source-audited at `90a417c8` on 2026-11-18.

## 1. Goals and confirmed behavior

Implement concert double-action pedal-harp support:

1. Explicit, time-positioned seven-pedal settings, shared by both staves.
2. Spelling-preserving greedy pedal calculation, plus better enharmonic
   alternatives when they exist, with at most three solutions to choose from.
3. Playback of harp glissandos through the strings selected by those pedals,
   rather than through the key signature's diatonic pitch classes.
4. Red noteheads for written notes that disagree with the pedals.

**Confirmed during planning:**

- Ordinary notes keep their authored sounding pitch in playback, even when
  incompatible with the pedals. A mismatch turns the notehead red; it does not
  retune, silence, or rewrite the note.
- Calculate without respelling by default, but also search for enharmonic
  improvements. Rank pedal results by fewer pedal-setting changes, then fewer
  individual pedal movements.
- "Suggest respelling" makes the fewest spelling changes needed to improve
  the no-respelling result, or to make an otherwise impossible passage feasible.
  Offer "Maximum respell" only when allowing more respelling improves that
  pedal result further. Neither option changes authored sounding pitches.
- Auto-apply exactly one valid, distinct solution. For two or three solutions,
  show a choice dialog, preferring "No respelling" when available.

The remaining policies below are proposed defaults, made explicit so that
implementation does not silently choose musical behavior.

Not included in v1: lever/single-action harps, pedal-motion audio, physically
modeled retuning of ringing strings, natural harmonics or other special harp
techniques, or a full MusicXML harp-marking interchange project. The calculator
is a pitch-feasibility aid, not a guarantee of human playability. The greedy
baseline is not itself a proof of globally minimal pedal changes.

## 2. Current implementation and integration points

| Area                  | Verified baseline                                                                                                                                                                                                                                                                        | Planned integration                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Instrument identity   | [Catalog](../../apps/editor/src/score/instrumentCatalogDataExtras.ts) has `pluck.harp`, two staves, brace, and GM program 46. [Active-instrument resolution](../../packages/core/src/model/instrumentChange.ts) supports mid-part changes.                                               | Resolve the active semantic identity, not the name or chosen sound patch. Keep different harp parts independent.      |
| Score model           | [PartMeasure](../../packages/core/src/model/measure.ts) stores full seven-pedal snapshots in `harpPedals`, independent from piano `pedals`.                                                                                                                                              | Add typed pedal mutations, undo/redo, bounded projection, and fast/full persistence parity.                           |
| Persistence           | [Vendor schema](../../packages/format/schemas/viritura-extensions.json), [TS parser](../../packages/format/src/mnx/parseParts.ts), [serializer](../../packages/format/src/mnx/serializePart.ts), and Rust promotion implement and validate pedal snapshots.                              | Add MusicXML import/export and editing controls without weakening strict snapshot validation.                         |
| Editing/collaboration | [Typed patches](../../packages/core/src/patches/types.ts), [delta serialization](../../packages/format/src/mnx/deltaSerializer.ts), and [Yjs patch projection](../../packages/crdt/src/yProjection/applyScorePatchesToYDoc.ts) are distinct integration surfaces.                        | Add typed pedal mutations, undo/redo, bounded projection, and fast/full persistence parity.                           |
| Glissando playback    | [Realization](../../packages/midi/src/glissandoPlayback/index.ts) runs after navigation, with chromatic, key-based diatonic, and bend modes. Its diatonic mode uses a set of pitch classes.                                                                                              | Add pedal/string realization without replacing ordinary non-harp glissando behavior.                                  |
| Playback consumers    | [Timeline](../../packages/midi/src/timeline.ts) feeds MIDI/SoundFont playback. [Native transport](../../apps/editor/src/instrumentProfiles/vstTransport.ts) currently routes parts with glissandos to browser SoundFont playback rather than the separate native performance-event path. | Preserve and test that explicit fallback; do not claim new native/VST glissando support.                              |
| Notehead rendering    | [Element-command lookup](../../packages/renderer/src/selectionHighlight.ts) indexes notehead descendants such as `/n0`; [score painting](../../apps/editor/src/components/ScoreCanvas/paintScoreFrame.ts) already layers interactive overlays over cached ink.                           | Re-ink only affected noteheads in an editor-only warning layer, without changing saved colors or Rust musical layout. |

The first implementation slice adds the snapshot model and full Bravura diagrams.
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
- Per-setting `display` chooses a diagram (default), all seven pedal names, or
  only the names that changed since the preceding setting. Printed placement
  overrides may target a staff, but the musical setting always belongs to the
  whole part. Presentation must never control whether a setting affects
  playback; the stored tuning is always the full snapshot.
- Reject invalid alterations, duplicate IDs, and duplicate positions within
  the same part measure. Compare fractions exactly, including equivalent
  fractions; array order must not decide conflicting settings.

### Resolver semantics

The first implementation slice provides schema/model persistence and full
Bravura diagrams, including Storybook examples. `placement` supports above,
below, between, and auto; auto defaults to the inter-staff gap when available,
otherwise below the associated staff. `staff` selects the presentation staff,
and optional manual offset/collision controls follow the positioned-expression
pipeline. `display` prints a diagram, all pedal names, or only changes relative
to the latest earlier setting in written order (falling back to all names when
there is none or nothing differs). In horizon view, a long written marking can
extend beyond the edge of a short score; horizontal fitting remains pending.
The editor now resolves state within active harp-instrument segments and offers
manual entry from the Edit and score context menus. The subsequent calculator,
playback, and warning stages remain planned.

For future MusicXML import, fill partial pedal changes from the preceding known
setting. Do not infer natural pedals if the preceding state is unknown; preserve
the unresolved imported notation separately and surface an import diagnostic
rather than manufacturing a complete tuning snapshot.

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
- The text popover also accepts seven positions such as `^--|--v^`: `^` is
  flat, `-` is natural, and `v` is sharp. The divider and spaces are optional.
  Up/down controls and the text input stay synchronized. **Auto** is disabled
  until the calculation stage is implemented.
  Typing a pedal symbol overwrites the character at the cursor and advances
  to the next pedal, skipping the divider; typing at the end does not append.
  Up and down arrows adjust the pedal at the cursor without advancing, with
  the last pedal selected when the cursor is at the end.
- The popover does not choose display mode or placement. New settings omit
  both so score-level engraving defaults apply; editing an existing setting
  preserves any per-setting values it already has.
- Add/select/move/delete a diagram through the normal command/selection
  system. Multiple settings within one measure must be possible.
  An unresolved selection reports an error, never defaults to measure 1.
- Apply all seven values atomically, in one undoable collaborative edit.
  A local draft must detect a concurrently changed/deleted snapshot rather
  than blindly overwriting another user's changes.
- Draw one marking for the part, between staves by default when available and
  otherwise below the associated staff. Rust owns
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

## 5. Pedal calculation and ranked enharmonic alternatives

### Inputs and scope

The editor's current Auto command solves the whole part in a cancellable
worker. Tie-chain handling and ranked tuning-state search are implemented;
bounded-selection application and restoration remain follow-up work.

**Calculate harp pedals** solves the active harp part or a bounded selection.
Always run the spelling-preserving pass and the enharmonic search before
deciding whether to auto-apply or open a solution dialog. Preserve every manual
snapshot as a hard anchor. Recompute only calculated snapshots inside the chosen
scope; change note spelling only as part of an applied enharmonic solution.
Do not run or persist the calculator automatically whenever notes change.

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

### Spelling-preserving baseline: longest compatible prefix

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
   This makes the no-respelling pass infeasible, not necessarily the complete
   calculation: the enharmonic search may still find a valid solution.

For example, C-natural followed later by F-sharp and then C-sharp needs two
settings: prepare F-sharp in the first setting even before its first use,
then change C at the C-sharp onset. C-natural and C-sharp simultaneously,
including an overlap from a held note, cannot be solved without changing
notation or performance assumptions. An enharmonic pass may instead use
C-natural and D-flat, if all other simultaneous and sustained constraints
permit it.

This is longest-prefix greedy, **not** a proof of minimum total pedal movements
or ergonomic feasibility. No `3^7` enumeration is needed while written-letter
constraints are independent. Sort/build the constraint stream once, then
advance a cursor; do not repeatedly rescan the remaining score.

### Enharmonic search and ranking

Enumerate alternative string spellings that retain each note's exact sounding
pitch, using only flat/natural/sharp harp strings. Handle B-sharp and C-flat
with their correct octave, not just pitch-class equivalence. Double accidentals
may therefore become playable by respelling; microtones with no exact harp
string equivalent remain infeasible.

Search the `3^7 = 2,187` possible tuning configurations at relevant musical
boundaries, filtering by manual anchors, simultaneous notes, and sounding
intervals. Reuse the baseline's timing stream and scope rules. A shortest-path
or dynamic-programming search should retain nondominated combinations of
pedal cost and respelling count, rather than enumerate the Cartesian product
of all note spellings. Track the selected string/spelling for active held/tied
notes across transitions; 2,187 bounds tuning configurations, not the entire
state space when those assignments are included. Cache feasibility results and
prune dominated states without silently dropping musical constraints.

The implemented search carries physical-string assignments through each tied
chain's notated sounding intervals and counts edits to every source note in
that chain. Cross-jump ties share one spelling without inventing sustain through
unplayed written measures. Laissez-vibrer ties do not extend the notated release.
The tuning transition uses a seven-axis Hamming-distance transform; alterations
never requested by any note spelling or manual anchor are safely dominated by
their natural replacements. It does not cap the candidate frontier or return a
partially completed search as a solution.

Measure each complete, feasible candidate with the following metrics; the
category rules below specify how to prioritize them:

1. **Pedal cost:** lexicographically minimize the number of pedal-setting
   changes, then the total number of individual pedals moved. A snapshot that
   changes three letters counts as one setting change and three pedal movements.
   Count each changed letter once even for flat-to-sharp movement; ergonomic
   travel distance is not part of this first cost model.
2. **Respelling count:** count source note objects whose step/alter/octave changes,
   not repeated playback occurrences. Keep a tie chain coherently spelled and
   count all changed source notes in that chain.
3. Use deterministic spelling and placement tie-breaks for otherwise equivalent
   results, and preserve existing calculated IDs where the content is unchanged.

Include transitions into and out of the selected region when their tuning is
known, including any required restoration setting. Do not count the first
setting in an unknown initial state as a pedal-setting _change_ or assign it
invented individual pedal movements. All candidates must use the same boundaries
and cost accounting.

If the enhanced search finds a better zero-respelling path than the greedy
baseline, use it as the "No respelling" candidate before comparing alternatives.
Do not label a pedal-only improvement as an enharmonic solution.

Keep at most one candidate in each category:

| Choice                 | Selection rule                                                                                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No respelling**      | Best available valid result that preserves every source spelling. Keep this option whenever feasible, even if an enharmonic result has lower pedal cost.                                                                                                                                                    |
| **Suggest respelling** | If a no-respelling result exists, choose the fewest respelled source notes that yield strictly lower pedal cost; among equally small respellings, minimize pedal cost. If the baseline is infeasible, instead choose the fewest respelled notes needed for any valid solution, then minimize pedal cost.    |
| **Maximum respell**    | Allow unrestricted respelling within scope to minimize pedal cost, with fewer respelled notes as the tie-break. Show only if its pedal cost is strictly lower than the "Suggest respelling" result. This means permission for more respelling, not maximizing the number of changed notes for its own sake. |

Discard incomplete or infeasible candidates; they are not solutions or disabled
choices in the dialog. Deduplicate normalized pedal timelines and note edits.
Do not add another alternative merely because it uses different enharmonic
spellings with the same pedal cost and more changed notes. Equal-cost respelling
alone is not an improvement over "No respelling."

### Single-solution application and choice dialog

- **Zero valid solutions:** report calculation failure and leave the document
  unchanged. Red noteheads can show incompatible notes in the score; do not
  treat an incomplete solve as a successful alternative.
- **Exactly one valid, distinct solution:** auto-apply it without a preview or
  confirmation dialog. This includes an enharmonic solution when no valid
  no-respelling solution exists. Complete both passes first; never apply the
  baseline while still searching for alternatives.
- **Two or three valid, distinct solutions:** open one dialog, ordered
  **No respelling**, **Suggest respelling**, **Maximum respell**, omitting
  unavailable categories. Default to No respelling when present, otherwise
  Suggest respelling. Do not show Maximum respell without its further
  improvement.
- For each offered choice, show its pedal-setting-change count, individual
  pedal-movement count, and respelled-note count. Preview its diagrams and
  spelling edits so the trade-off is clear. Existing note mismatches remain
  red noteheads only, with no separate mismatch message.
- Apply the selected solution with one explicit Apply; Cancel changes nothing.
  One available solution must not open this dialog merely because it includes
  respelling.
- An interrupted, cancelled, or incomplete search is not proof that only one
  solution exists. Do not auto-apply a provisional baseline or quietly omit
  unfinished alternative categories.

Required candidate-flow cases:

| Calculated result                                                                                         | Expected behavior                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Valid no-respelling result; respelling gives no strictly better pedal cost                                | Auto-apply No respelling.                                                      |
| No respelling plus a better limited-respelling result; unrestricted search cannot improve it further      | Show two choices, defaulting to No respelling.                                 |
| Limited respelling improves the baseline, and unrestricted respelling improves it further                 | Show all three choices, defaulting to No respelling.                           |
| No valid no-respelling result; limited and unrestricted search select the same solution                   | Auto-apply that one enharmonic solution.                                       |
| No valid no-respelling result; unrestricted respelling strictly improves the minimally respelled solution | Show Suggest respelling and Maximum respell, defaulting to Suggest respelling. |
| No complete valid result                                                                                  | Report failure; apply nothing.                                                 |

### Application safety

- Apply pedal snapshots and any note-spelling patches together in one undoable
  collaborative transaction. Undo restores both the previous pedal settings
  and every changed spelling. A solution that makes no changes is a no-op,
  not a new undo entry.
- Preserve exact authored sounding pitches, note/event IDs, timing, ties,
  voices, and staves. Update spelling-dependent accidental display and derived
  notation consistently. Do not transpose notes or break ties to obtain a
  better pedal cost.
- A tie chain crossing the selected boundary keeps its original spelling
  unless the entire chain is in scope. Never silently respell notes outside
  the selected region or overwrite a locked manual snapshot.
- Carry held-note constraints across both scope boundaries. Any required
  restoration must remain compatible with notes whose notated duration extends
  beyond the selection; do not truncate those notes to make a candidate valid.
- For a bounded selection, preserve tuning outside it. Restore the original
  known tuning at the exclusive end when needed, unless an existing manual
  snapshot already does so. If the original following state was unknown,
  block bounded application and explain that the scope must extend through
  the part/harp segment end or to a user-established boundary setting.
- Revalidate against the current document revision before auto-application or
  dialog Apply. If the source changed, recompute both passes and the candidate
  count rather than applying stale patches. Repeated calculation with unchanged
  input produces the same settings without duplicate markers or needless
  replacement of unchanged IDs.
- Unannotated glissando interiors contribute no invented harmonic target.
  Endpoints preserve their exact sounding pitches; the no-respelling candidate
  also preserves their string spelling. Recompute each candidate's glissando
  string path and playback from its proposed endpoint spellings and pedals.
  An enharmonic endpoint edit can change the intermediate string sequence even
  when its sounding pitch is unchanged; do not claim the entire glissando audio
  is invariant. Show the resulting sequence in the multi-solution preview.
  Inferring an intended glissando scale/chord remains deferred.

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

| Phase                 | Deliverable                                                                                                                                                            | Required evidence before moving on                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Contract and state | Vendor schema, generated artifacts, TS/Rust models, parse/promote/demote, shared resolver and structured issues.                                                       | Full/delta round-trips; schema rejection cases; both-staff inheritance; exact mid-measure boundaries; unknown state; instrument changes.                                                                                                                                              |
| 2. Explicit settings  | Typed add/update/move/remove patches, command/dialog/properties, diagram engraving, hit-testing, undo/redo, and collaboration.                                         | Save/reopen; remote edits; fast/full Yjs parity; duplicate-position conflicts; part extracts; collision and system/page placement; an MNX Storybook story.                                                                                                                            |
| 3. Ranked calculator  | Shared constraints, greedy baseline, enharmonic search, up to three ranked candidates, single-solution auto-apply, choice dialog, atomic edits, and scope restoration. | No-respelling preference; strict pedal-cost improvements; minimal versus maximum respelling; zero/one/two/three valid candidates; deduplication; exact sounding-pitch preservation; ties/manual anchors/scope boundaries; stale-result rejection; atomic undo/redo and collaboration. |
| 4. Playback           | Harp-pedal glissando mode, instrument-aware default, timed state lookup, diagnostics, and unchanged ordinary-note pitch.                                               | Exact generated pitches/times; ascending/descending; enharmonic duplicates; C-flat/B-sharp; mid-gliss changes; chords/cross-staff spans; repeats/jumps/seeking; explicit override and non-harp regressions; native fallback.                                                          |
| 5. Warning UX         | Cached analysis and red notehead-only overlay, with no warning banner or explanatory text.                                                                             | One bad chord note only; red remains visible when selected; mismatch playback unchanged; fix/delete/undo/remote edit refresh; selection/retention/zoom; warnings absent from exports and print preview; app Storybook story.                                                          |

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

## 9. Later extensions

- Add ergonomic costs and feasibility checks for pedal travel distance,
  available time, and left/right-foot conflicts. Do not confuse the initial
  count-based ranking with a complete human-playability assessment.
- For glissandos, allow an explicitly chosen target pitch set/chord/scale,
  then find pedal settings producing it, including intentional repeated
  pitches on enharmonic strings. Do not infer this intent from endpoints alone.
- Add instrument-specific fixed extreme strings, alternate tunings, or other
  harp types only through an explicit capability model.

Enharmonic alternatives and the one-versus-many application flow are part of
the initial delivery, not a separate future mode. No harmony-analysis dependency
is required to enumerate exact enharmonic equivalents.
