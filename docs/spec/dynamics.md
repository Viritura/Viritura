# Dynamics — Storage, Engraving, and Playback

Canonical reference for how Viritura stores, engraves, edits, and plays
dynamics. Dynamics are standard MNX `dynamic-group` objects; Viritura defines
no separate hairpin storage.

> **Upstream baseline:** `w3c/mnx@e41322cb9794d7e1dd5e25e9f4475a847d114f1b`
> (schema 19, 2026-06-16). `mnx.version` remains `1` — the project follows the
> single rolling-draft policy.

## 1. Storage

Every dynamic — immediate marking, hairpin, relative marking, or accent — is
one entry in `parts[].measures[].dynamics[]`. There is no second stored model.
A hairpin remains a rendering and UI concept, expressed as a `gradual` group.

The four standard group types are:

| Type        | Notated as                           | Required fields    |
| ----------- | ------------------------------------ | ------------------ |
| `immediate` | `p`, `mf`, `fff`, `fp`, …            | `value`            |
| `gradual`   | cresc./dim. wedges and `cresc.` text | `end`, `wedgeType` |
| `relative`  | `più p`, `più f`                     | `relativeValue`    |
| `accent`    | `sf`, `sfz`, `fz`, `rfz`, …          | `value`            |

## 2. Canonical model

### 2.1 TypeScript

```ts
export type DynamicGroupType = "immediate" | "gradual" | "relative" | "accent";
export type DynamicValue = "ppp" | "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fff" | "n";
export type RelativeDynamicValue = "louder" | "softer";
export type WedgeType = "increasing" | "decreasing";
export type MultiStaffOrientation = "above" | "auto" | "below" | "between";

interface DynamicGroupBase {
  id: string;
  type: DynamicGroupType;
  position: RhythmicPosition;

  // Schema-defined optional attributes. The variants below refine which are
  // required; parse/serialize preserves any schema-valid optional attribute.
  value?: DynamicValue;
  attackValue?: DynamicValue;
  end?: MeasureRhythmicPosition;
  glyphs?: string[];
  orient?: MultiStaffOrientation;
  prefix?: string;
  relativeValue?: RelativeDynamicValue;
  staff?: number;
  suffix?: string;
  voice?: string;
  wedgeType?: WedgeType;

  // _x.viritura on this dynamic-group object.
  manualOffset?: [number, number];
  avoidCollisions?: boolean;
}

export type DynamicGroup =
  | (DynamicGroupBase & { type: "immediate"; value: DynamicValue })
  | (DynamicGroupBase & {
      type: "gradual";
      end: MeasureRhythmicPosition;
      wedgeType: WedgeType;
    })
  | (DynamicGroupBase & { type: "relative"; relativeValue: RelativeDynamicValue })
  | (DynamicGroupBase & { type: "accent"; value: DynamicValue });
```

`PartMeasure.dynamics?: DynamicGroup[]` is the only dynamics collection.

### 2.2 Rust

`raw::DynamicGroup` mirrors the upstream schema.
[`model::DynamicGroup`](../../engine/viritura-engine/src/model/direction.rs) is
the promoted form: the `type` discriminator plus the shared attribute payload,
`manual_offset` / `avoid_collisions` hoisted out of `_x.viritura`, and a
serialization-skipped `placement_above` hint owned by the condensing layer.
Promotion performs the semantic variant check and supplies an ID when absent.

The discriminator is the MNX wire name `type` in both languages — Viritura does
not introduce a second translation vocabulary such as `kind`.

## 3. Semantic validation

The upstream JSON Schema requires only `position` and `type`; its reference
prose imposes more. Parsers in both languages additionally enforce:

- `immediate` and `accent` require `value`;
- `gradual` requires `end` and `wedgeType`;
- `relative` requires `relativeValue`;
- `end.measure` resolves to a global-measure ID;
- `staff`, when present, addresses an existing staff;
- `orient: "between"` has a usable adjacent staff pair;
- each glyph name resolves through the supported SMuFL metadata;
- group IDs are unique.

An empty `glyphs` array is accepted while upstream allows it, but Viritura
omits it when serializing. These are format diagnostics: invalid input is
reported rather than guessed into another variant.

## 4. Encoding policy

### 4.1 Common markings

- `p`, `mf`, `fff`: `immediate` with the corresponding `value`.
- `fp`: `immediate`, `attackValue: "f"`, `value: "p"`.
- Crescendo / diminuendo: `gradual` with `wedgeType` and `end`.
- `p < f`: a gradual group with `value: "p"`, plus a separate immediate `f`
  exactly at `end`.
- `più p` / `più f`: `relative` with `relativeValue` and suitable
  `prefix`/`glyphs`.
- `sfz`: `accent`, `value: "f"`, and explicit `glyphs` when exact spelling
  matters.
- Niente: `value: "n"` at the start or endpoint dictated by the musical
  meaning.

### 4.2 Spellings outside the schema enum

Schema 19 restricts semantic `value` to `ppp`–`fff` plus `n`. Richer printed
spellings use standard semantics plus explicit SMuFL presentation, never a
non-standard `value` string:

- `pppp`…`pppppp` → `value: "ppp"` with `glyphs` spelling the authored letters;
- `ffff`…`ffffff` → `value: "fff"` with explicit `glyphs`;
- `sf`, `sfz`, `sffz`, `fz`, `rf`, `rfz` → `accent` with a standard `value` for
  the accent strength and explicit `glyphs`;
- `fp`, `sfp`, `sfpp` → `attackValue` + `value`, with `glyphs` only to
  distinguish the printed spelling.

Playback reads `type`, `value`, `attackValue`, `relativeValue`, and gradual
endpoints; it never infers semantics from `glyphs`. So `pppp` plays
interoperably as `ppp` while its notation stays exact.

## 5. Vendor extensions

Two `_x.viritura` fields live on each standard dynamic-group object, validated
by the `dynamic-group-extensions` definition in
[`viritura-extensions.json`](../../packages/format/schemas/viritura-extensions.json):

- `manualOffset` — MNX has semantic orientation but no user-authored XY
  engraving delta;
- `avoidCollisions` — Viritura's pin/reflow behavior is not represented in MNX.

Gradual groups use the same extension object; there is no hairpin-specific
copy. Text attached grammatically to a dynamic uses standard `prefix`/`suffix`;
standalone directions such as `dolce` or `rit.` remain text expressions in
`_x.viritura.expressions`. See
[viritura-extensions.md](viritura-extensions.md).

## 6. Identity and editing

### 6.1 Patches and CRDT

Position is not identity: several groups may start at one position (an accent
and a gradual group, for example). Every group carries a stable UUID-v7 `id`,
and editing is ID-addressed through `SetMeasureDynamicGroupPatch`:

- `groupId` is the identity; `value` is a full group without the duplicated ID,
  or `undefined` to delete;
- changing position or type updates the same group;
- two groups may share a rhythmic position without overwriting each other;
- CRDT projection keys entries by ID and preserves deterministic display order
  `(position, type-rank, id)`.

### 6.2 Selection, navigation, inspector

Storage unifies; the UX keeps the visual distinction:

- immediate, relative, and accent groups classify as `dynamic`;
- gradual groups classify as `hairpin` for hit testing, navigation filters,
  inspector labels, and accessibility;
- both resolve to the same group ID and array;
- Rust keeps `ElementKind::Dynamic` and `ElementKind::Hairpin` as rendering
  concepts, with element IDs `p{part}/m{measure}/dyn{groupId}` and
  `p{part}/m{measure}/hairpin{groupId}`.

The inspector exposes variant-appropriate fields — value/attack value/glyph
override/affixes for immediate and accent, direction/endpoint/optional start
value/orientation for gradual, louder-softer plus affixes for relative, and
staff, voice, orientation, manual placement, and collision pinning for all.

### 6.3 Clipboard

Gradual groups are spans:

- capture groups whose start is inside the selection;
- remap both start and `end` measure/position on paste;
- mint a new UUID for every pasted group;
- copy immediate endpoint groups separately;
- drop a gradual group with a diagnostic when its remapped end lies outside the
  target score rather than leaving a dangling measure reference.

## 7. Rendering and layout

One dispatch over `DynamicGroup.type` routes glyph/text rendering for
`immediate`, `relative`, and `accent`, and wedge rendering for `gradual`.

- A dynamic display run is prefix text, zero or more SMuFL glyphs, and suffix
  text. When `glyphs` is present it renders exactly that ordered sequence;
  otherwise the run derives from the semantic fields.
- `n` renders with the SMuFL niente glyph and aligns with adjoining wedges.
- Optical-midline alignment, endpoint shortening, skyline avoidance, shape
  bands, cross-measure/system segmentation, manual offsets, and pinned
  collision behavior apply to both dynamics and wedges.

### 7.1 Multi-staff placement

An omitted `staff` applies the group to every staff in the part (not staff 1).

- Explicit `staff`: scope semantics and placement to that staff.
- `orient: "above"` / `"below"`: the requested side of the scoped staff, or the
  outer edge of the all-staff group.
- `orient: "between"`: between `staff` and `staff + 1`; with `staff` omitted
  this is accepted automatically only for a two-staff part, otherwise `staff`
  is required and its absence is a diagnostic.
- `orient: "auto"` or omitted: automatic placement; a two-staff keyboard part
  with all-staff scope prefers the inter-staff gap.

### 7.2 Condensing

Condensing compares complete group semantics. Different type, scope, value,
attack, relative direction, wedge direction/span, glyph sequence, or attached
text is a conflict unless an existing condensing rule explicitly normalizes a
presentation-only difference. See
[condensing-and-doubling.md](condensing-and-doubling.md).

## 8. Playback

Dynamic groups compile into a backend-neutral semantic program before any MIDI
realization; the score model never stores velocity or controller values. The
compiler lives in
[`packages/midi/src/dynamicPlayback/`](../../packages/midi/src/dynamicPlayback).

### 8.1 Per-type realization

- `immediate` — persist `value` from its position onward. With `attackValue`,
  that value drives note-on attack velocity at the onset while the standing
  level becomes `value`.
- `accent` — apply `value` to note-on attacks at that position, then retain the
  previously active standing level. Accents are not a part-wide CC11 spike,
  which would swell unrelated sounding notes.
- `relative` — step one semantic rung louder or softer from the level active in
  the same scope, clamped at `n`/`fff`. Prefix text such as `molto` stays
  presentational.
- `gradual` — begin at its explicit `value` or the active scoped level; end at
  an applicable immediate group exactly at `end`, else the documented one-rung
  directional fallback. Consecutive spans that meet exactly inherit the
  preceding endpoint, giving a continuous messa di voce.
- `value: "n"` — CC11 zero, but a held note beginning at niente still starts a
  very-low-velocity voice so a niente crescendo is possible.

`glyphs`, `prefix`, `suffix`, `orient`, `manualOffset`, and `avoidCollisions`
have no playback effect.

### 8.2 Ordering and scope

Compilation runs against the expanded measure order, so repeats and jumps keep
correct behavior, and a cross-measure gradual end resolves to the nearest
forward expanded occurrence. At equal times:

1. persistent changes process before gradual spans starting at the same time;
2. an immediate group at a gradual endpoint supplies the target level;
3. `staff + voice` is more specific than staff-only or voice-only, and either
   is more specific than part-wide;
4. intersecting equal-specificity scopes emit a `scope-conflict` diagnostic and
   fall back to stable group-ID order;
5. overlapping gradual groups in one effective scope emit an
   `overlapping-gradual` diagnostic instead of silently picking an entry.

### 8.3 Lanes

One MIDI channel carries one CC11 stream, so simultaneous `voice: "1"` at `p`
and `voice: "2"` at `f` need separate streams. A `PlaybackLaneId` identifies
each independently controlled `(part, staff, voice)` lane; parts without scoped
dynamics stay on a single lane.

- An unscoped group compiles into every lane in the part.
- A staff-scoped group applies to every voice sounding on that staff.
- A voice-scoped group follows that named voice across measures and staves.
- A staff-and-voice-scoped group applies to their intersection only.
- Event staff is `event.staff ?? sequence.staff ?? 1`; voice is the authored
  `sequence.voice`. Targeting a voice that does not exist is a `missing-voice`
  diagnostic, not an invented sequence-index match.

Routing, sampler loading, controller chase on seek, view filtering, mute/solo,
and panic all operate per lane. `partIndex` remains the mixer/UI identity.
Panic sends channel-local CC120/CC123 to the lane's channels; synth-global
`stopAll` is reserved for destruction or an explicit global panic.

### 8.4 Level scale, response profiles, automation

Levels are semantic (`n` through `fff`) on a perceptual scale calibrated to the
current ~30 dB orchestral range, projected to MIDI axes at realization time.
Niente approaches amplitude zero smoothly rather than being one more evenly
spaced dB rung.

A runtime `DynamicResponseProfile` — `sustained-expressive`, `struck-plucked`,
`organ-fixed-attack`, or `fallback` — is selected from instrument identity and
sampler capability and is never persisted in MNX. Sustained instruments split
level across velocity and CC11; struck/plucked instruments put most change into
velocity so decaying notes do not swell; fixed-attack instruments hold velocity
and move continuous expression.

Controller ownership: CC11 belongs exclusively to notated dynamics, CC7 is
mixer/spatial channel volume, CC10 is pan, and technique controllers must not
overwrite CC11. Timbre controllers such as CC1 are used only when the
sampler/patch declares a supported dynamic-crossfade controller.

Note velocity samples the semantic curve at the exact onset. CC11 ramps emit
quantization-crossing events — one event when the rounded 7-bit value changes,
at the exact crossing time — so a monotonic span emits at most 127 events and
seek/chase reads exact state. Abrupt persistent CC11 changes get a short
click-prevention slew where the backend does not smooth controllers.

### 8.5 External MIDI degradation

A physical MIDI 1 output has 16 channels. Web MIDI and future SMF export
allocate separate channels to independent lanes while channels remain, preserve
the percussion channel policy, merge only lanes with equivalent dynamic and
program automation when capacity runs out, and emit a visible diagnostic if
inequivalent lanes must merge. Staff/voice dynamics are never silently
collapsed to a part-wide envelope.

## 9. MusicXML conversion

- ordinary `<dynamics>` values → immediate groups;
- `fp`/`sfp`/`sfpp` → `attackValue` + `value`, with glyphs for exact spelling;
- `sf`/`sfz`/`sffz`/`fz`/`rf`/`rfz` → accent groups;
- `<wedge type="crescendo|diminuendo">` start/stop pairs → gradual groups in
  `dynamics[]`;
- `niente="yes"` → `value: "n"` at the appropriate wedge endpoint;
- placement and `<staff>` → `orient` / `staff`;
- associated `<words>` → `prefix`/`suffix` where structurally unambiguous;
- unknown `<other-dynamics>` → a text expression plus a converter diagnostic,
  unless a standard semantic mapping exists.

Unsupported wedge spread, dash, and endpoint engraving attributes continue to
produce diagnostics. See
[mnx-converter-coverage.md](mnx-converter-coverage.md).

## 10. Fixtures and stories

Committed `.mnx` fixtures cover all four variants plus niente, prefix/suffix,
glyph lists, and inter-staff placement, and every committed score validates
against schema 19 (`pnpm --filter @viritura/format test`). Dynamic and hairpin
stories live under `apps/editor/src/stories/mnx-spec/directions/` because
they are standard MNX objects, not vendor extensions.

## References

- [music-notationref-coverage.md](music-notationref-coverage.md) — source-validated feature coverage matrix
- [viritura-extensions.md](viritura-extensions.md) — `_x.viritura` reference
- [file-format.md](file-format.md) — on-disk format strategy
- [id-system.md](id-system.md) — UUID-v7 identity rules
- MNX reference: `../mnx-spec/docs/mnx-reference/objects/dynamic-group/`
