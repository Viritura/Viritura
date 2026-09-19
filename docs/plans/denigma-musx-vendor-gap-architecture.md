# Denigma MUSX Vendor-Gap Architecture

> **Status: active design and staged implementation.** Viritura imports Finale
> MUSX through an internally packaged Denigma WebAssembly converter and now
> receives Denigma's schema-v1 structured gap report. The adapter registry,
> source-evidence graph, NotationRef mapping catalog, and user-facing loss
> report described below remain proposed.

This plan defines a separation of concerns for high-fidelity Finale MUSX import:
Denigma remains responsible for understanding MUSX and producing standard MNX,
while downstream applications may preserve recognized information that MNX
cannot yet represent through their own vendor extensions.

The goal is to avoid both silent conversion loss and vendor-specific behavior
inside Denigma.

---

## Principles

1. **Denigma owns MUSX interpretation.** Downstream applications should not
   reproduce EnigmaXML parsing, Finale inheritance rules, font decoding, or
   reference-chain traversal.
2. **Denigma emits standard MNX only.** It must not know about
   `_x.viritura` or any other consumer's extension schema.
3. **Known loss is explicit.** A recognized MUSX feature must be classified as
   faithfully mapped, mapped with loss, unsupported by MNX, intentionally
   omitted, or unrecognized.
4. **NotationRef supplies shared semantics.** A future mapping catalog should
   associate gap types with W3C Music Notation Reference concept IDs for
   discovery and coverage reporting. Denigma's schema-v1 reports do not yet
   carry those IDs.
5. **Gap payloads remain separately versioned.** NotationRef identifies what a
   feature means; it does not define enough data to reconstruct an occurrence.
6. **Vendors own preservation policy.** Each consumer decides which gap payloads
   it can translate into its model or `_x` namespace.
7. **Standard MNX wins over extensions.** When MNX gains a faithful
   representation, Denigma emits it and retires the corresponding gap.

---

## Ownership boundaries

| Authority                          | Responsibility                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| W3C Music Notation Community Group | NotationRef taxonomy and MNX specification                                                     |
| musxdom                            | Typed Finale document model, object resolution, and effective-value calculation                |
| Denigma                            | MUSX classification, standard MNX conversion, typed gap payloads, and stable target anchors    |
| Viritura                           | Viritura extension schema, Denigma-gap adapters, import policy, and user-facing loss reporting |
| Other vendors                      | Their own gap adapters and extension/application representations                               |

Denigma should own any future assertion that a Finale construct corresponds to
a NotationRef concept. It would not own the NotationRef concept itself.

---

## Current Viritura integration

PR #64 establishes the initial converter boundary:

```text
MUSX bytes
  -> @viritura/musx-import worker
  -> Denigma WebAssembly
  -> standard MNX JSON + diagnostics + schema-v1 gap report
  -> Viritura MNX schema/semantic validation
  -> editor document
```

The internal package consumes the WebAssembly module built and smoke-tested by
OpenMUSX Denigma. Its maintenance build pins the Denigma commit, verifies the
module's embedded provenance, and falls back to building Denigma's own
`denigma_wasm` target when the CI artifact is unavailable. Generated assets
carry hashes, provenance, and licenses.

The WebAssembly result exposes gap-report bytes through
`denigma_result_gap_report_data` and `denigma_result_gap_report_size`.
`@viritura/musx-import` validates the envelope and anchor contract and returns
it as `MusxImportResult.gapReport`. No Viritura shim mutates the MNX yet.

Denigma and Denigma Online now use this same upstream module, which supports
MNX, MusicXML, and EnigmaXML output. Official Denigma releases will attach a
versioned copy; commit-pinned builds use the corresponding GitHub Actions
artifact while it remains available. Native executables remain useful for
command-line users, but cannot be rebundled into WebAssembly after compilation.

---

## Current schema-v1 gap contract

Denigma currently serializes:

- `schemaVersion: 1`;
- producer name, version, and commit;
- a source-ordered `gaps` array;
- stable target-MNX `anchor` IDs, optional rhythmic positions and staff
  numbers, optional span `end` anchors, and optional display placements;
- `complete` or `partial` extent;
- typed chord-symbol, notehead, expression, formatted-text, playback-only,
  smart-shape, and lyric-word-extension payloads; and
- a report-level arrowhead table for custom smart-shape caps, with SVG geometry
  in staff-space units.

Consumers dispatch on `type` and ignore unknown fields and types. This is enough
for safe, incremental Viritura adapters: unsupported payloads remain reportable
instead of blocking the entire import.

The current contract deliberately lacks some of the target architecture below:
there are no per-payload versions, gap codes distinct from `type`, NotationRef
IDs, source-evidence graph, or published JSON Schemas. Viritura should
therefore keep schema-v1 readers narrow and avoid treating the current payload
shape as an indefinitely frozen vendor-extension schema.

### Viability of the September 2026 gap families

| Denigma gap family                | Existing Viritura destination                              | Viability now | Remaining loss or prerequisite                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic expressive text           | Part-measure `_x.viritura.expressions[]`                   | High          | Preserve plain text, rhythmic position, staff, and above/below placement first; rich runs and exact font metrics need a separate rich-text model.                                                         |
| Performance instructions          | Same expression extension                                  | High          | Denigma's normalized technique kind is useful for future playback, but the current Viritura field stores displayed text only.                                                                             |
| Rehearsal marks                   | Global-measure `_x.viritura.rehearsalMark`                 | High          | Map system-top placement and text now; retain style only when it maps to plain, boxed, or circled. Multiple marks in one measure require model expansion because Viritura currently stores one.           |
| Tempo text and visibility         | Standard MNX `tempos[]` plus `_x.viritura` text/show flags | High          | A partial gap can decorate the already emitted tempo by ID. Preserve plain text and playback-only visibility; defer rich runs and exact source font size.                                                 |
| Entry-attached glissando          | Event `_x.viritura.glissandos[]`                           | Medium-high   | Straight/wavy style and text map. Resolve note anchors to containing events before mutation. Chord-specific endpoints, arbitrary line widths, caps, and offsets do not fit the current event-level model. |
| Trill symbol                      | Event marking `_x.viritura.trill`                          | Medium        | A simple `tr` symbol and accidental map.                                                                                                                                                                  |
| Trill extension line              | Event marking `_x.viritura.trill.extension`                | Medium-high   | Event-anchored same-system spans now render; cross-system segmentation and exact source line appearance remain deferred.                                                                                  |
| Keyboard pedal smart shape        | Part-measure `_x.viritura.pedals[]`                        | Medium        | Basic sustain/sostenuto/una-corda spans and text/bracket styles fit; custom lines, cap geometry, and mixed text runs do not.                                                                              |
| Lyric word extension              | No rendered extender-line model                            | Low now       | Keep the gap visible. Viritura represents syllabic/melisma structure but does not render explicit extender endpoints or continuation lines.                                                               |
| General/custom lines and SVG caps | No generic line extension                                  | Low           | Do not create a catch-all drawing extension merely to absorb Finale data. Add only source-neutral semantics with an editing/rendering use case.                                                           |

Adapter order matters:

1. Parse and validate both artifacts.
2. Build an index of MNX IDs before changing arrays or object structure.
3. Dispatch by report schema version and gap `type`.
4. Apply only the semantic subset Viritura can represent faithfully.
5. Record handled-partial and unhandled gaps in import diagnostics.
6. Validate the mutated MNX again.

Standard MNX always wins. A shim must not duplicate a feature Denigma already
emitted, and a partial gap should decorate its target rather than create a
second object.

## Finale-specific follow-up priorities

This snapshot uses MNX commit
[`92f7143`](https://github.com/w3c-cg/mnx/commit/92f714347d3f721a4f61477cc9665b542ced9be1),
the Music Notation Reference taxonomy at
[`7aca090`](https://github.com/w3c-cg/music-notationref/commit/7aca090091a3f25f5ee726ba1f124612f3d39677),
and the MusicXML 4.1 draft matrix and schema at
[`1380e6a`](https://github.com/w3c-cg/musicxml/commit/1380e6a9ac61d54ae695cab2c8fc94bba82d101b).
MusicXML 4.1 is a draft; MusicXML 4.0 remains the latest published release.

Priority meanings:

- **Now** — use an existing native MNX shape; do not create a parallel
  extension.
- **Next** — a bounded Viritura bridge has clear semantics and useful import
  value.
- **Watch** — MNX explicitly plans or is actively designing the feature; retain
  source data if necessary without stabilizing a broad public model.
- **Defer** — timing, layout, or cascading semantics remain too unsettled for a
  reliable shared model.

| Priority                    | Finale feature                                       | Standards readiness                                                                                           | Viritura direction                                                                                                                       |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Now                         | Forced stem direction                                | Native MNX `event.stemDirection`; native MusicXML `<stem>`                                                    | Map directly when import policy retains authored directions.                                                                             |
| Now                         | Individual rest placement                            | Native MNX `rest.staffPosition`; MusicXML has per-rest display pitch                                          | Map explicit overrides directly. Keep a staff-wide default separate.                                                                     |
| Now                         | Ordinary compound meter and common/cut display       | Native MNX `count`, `unit`, and common/cut display                                                            | Map directly; Viritura already models compound meters.                                                                                   |
| Now                         | Staff-name display override                          | MNX layout staffs accept literal labels; MusicXML supports subsequent-system name displays                    | Use layout labels rather than changing semantic part identity.                                                                           |
| Now, with caution           | Instrument change                                    | MNX specifies layout-based changes; MusicXML has semantic `instrument-change`                                 | Follow native MNX for interchange, but do not force Viritura's internal instrument identity to be layout-owned.                          |
| Next                        | Arbitrary jump instruction text                      | MNX jump semantics have no text; MusicXML composes words with jump playback                                   | Add a textual adjunct to the semantic jump, not an unclassified system-text duplicate.                                                   |
| Next                        | Hidden key-signature display                         | MNX key has no display switch; MusicXML uses `print-object="no"`                                              | Add a small key display extension distinct from atonal/open key.                                                                         |
| Next                        | Barline-aligned per-staff key/time changes           | MNX remains global; MusicXML staff-scopes key/time                                                            | Reuse shipped synchronous `staffMeters`; add a parallel staff-key subset. Do not imply independent barlines.                             |
| Next                        | Additive and display-versus-semantic meters          | MNX cannot express arbitrary displayed/actual pairs; MusicXML has composite beats and richer display controls | Extend the existing Viritura beat-structure/display model instead of inventing a second time-signature object.                           |
| Next                        | Independent mid-part transposition                   | MNX transposition is part-wide; MusicXML can change staff-scoped transposition per measure                    | High musical value, especially orchestral brass. Requires pitch, key, playback, label, and editing pipelines, not just display metadata. |
| Next                        | Per-staff barline extent                             | Neither standard models arbitrary staff-local barline length                                                  | A bounded staff-config engraving extension is justified, especially for one-line staves.                                                 |
| Next                        | Staff-default rest position                          | Both standards model only individual rest overrides                                                           | Preserve the source rule in staff config; materialize per-rest exceptions only when needed.                                              |
| Next after asset groundwork | Measure/page graphics                                | MNX has no image object; MusicXML supports measure images and page credit images                              | Preserve an opaque resource, anchor, MIME type, and dimensions. Build project attachments and safe raster/vector handling first.         |
| Next, low priority          | Explicit cutaway intent                              | MNX layouts can express the result but not the policy; MusicXML has explicit staff hiding                     | Preserve intent only when useful; Viritura already expresses visible results through layout overrides.                                   |
| Watch                       | Measure-attached wrapped blocks and page text        | MNX text frames/rich text are planned; MusicXML text runs lack a true wrapping rectangle                      | Preserve rectangle, anchoring, alignment, justification, and authored breaks. Avoid freezing rich-run/font-unit semantics.               |
| Watch                       | Chord fretboards                                     | MNX marks fretboards planned for 1.0; MusicXML `<frame>` is mature                                            | Use a temporary bridge only if near-term round-trip demand outweighs likely migration work.                                              |
| Watch                       | Articulations, arbitrary glyph markings, and caesura | Many markings are native; caesura is planned; MusicXML has semantic caesura plus SMuFL escape hatches         | Prefer semantic MNX mappings. Use Denigma's SMuFL mapping only for truly unmapped glyphs.                                                |
| Watch                       | Key mode                                             | MNX mode/tonic design is active; MusicXML has major/minor/church modes                                        | Preserve as analysis/spelling metadata, but wait before making it authoritative.                                                         |
| Watch                       | Measure-number ranges and custom text                | MNX has only an integer now and plans the broader facility; MusicXML 4.1 draft is richer                      | Current numeric override stays native. Keep custom labels/ranges narrow and migratable.                                                  |
| Watch                       | TAB                                                  | MNX marks TAB planned for 1.0; MusicXML has a mature string/fret/tuning model                                 | Preserve source data only if work begins before MNX lands its native design.                                                             |
| Defer                       | True non-aligning polymeter                          | MNX measure topology is global; MusicXML can represent non-controlling measures                               | The shipped Viritura staff-meter bridge intentionally keeps barlines aligned. True polymeter needs structural design.                    |
| Defer selectively           | X-EDO and tuning-system semantics                    | Neither standard defines a complete tuning-system model                                                       | A displayed microtonal key-signature list is bridgeable; temperament, reference pitch, and spelling policy are not.                      |
| Defer selectively           | Universal object hide/show                           | MNX has no universal rule; MusicXML's `print-object` coverage is broad but not universal                      | Add targeted visibility only where spacing, playback, children, and references have defined behavior.                                    |

Relevant active MNX discussions include rich text
([#345](https://github.com/w3c-cg/mnx/issues/345)), fretboards
([#110](https://github.com/w3c-cg/mnx/issues/110)), local meter and polymeter
([#248](https://github.com/w3c-cg/mnx/issues/248)), additive meter
([#254](https://github.com/w3c-cg/mnx/issues/254)), key mode
([#510](https://github.com/w3c-cg/mnx/issues/510)), hidden key signatures
([#435](https://github.com/w3c-cg/mnx/issues/435)), and independent
transposition changes ([#466](https://github.com/w3c-cg/mnx/issues/466)).

### Text and staff-size units

Finale's default staff space is 24 EVPUs, so a five-line staff is 96 EVPUs or
24 typographic points high. Denigma's scalable text therefore carries a source
relationship that cannot safely be reduced to one unitless font number.
MusicXML also separates point-based font sizes, global geometric tenths, and
percentage staff scaling. MNX has not settled equivalent rich-text,
page-measurement, or staff-scaling units.

An interim text bridge should preserve:

- the numeric font value and source unit;
- the source/reference staff size;
- whether the text scales with staff resizing;
- resolved display size when available;
- absolute page geometry versus staff-relative geometry;
- authored line breaks versus automatic wrapping; and
- alignment independently from justification.

Plain-text semantic adapters should land before this richer style model.
Converting every Finale font immediately to absolute points would reproduce the
default staff but lose resized-staff behavior; treating every size as
staff-relative would conflict with MusicXML's point-based font sizes.

---

## Target conversion artifact

The longer-term contract should return one logical artifact containing:

```text
Denigma conversion artifact
├── standard MNX document
├── diagnostics
├── structured gap instances
├── shared source-evidence graph
└── producer and schema provenance
```

Illustrative TypeScript:

```ts
interface DenigmaConversionArtifact {
  mnxJson: string;
  diagnostics: DenigmaDiagnostic[];
  gaps: DenigmaGap[];
  sourceGraph: DenigmaSourceGraph;
  provenance: {
    denigmaVersion: string;
    denigmaCommit: string;
    mappingCatalogVersion: number;
    gapManifestVersion: number;
    notationRefRevision: string;
  };
}
```

MNX remains independently usable. A consumer that knows nothing about gaps can
load the standards-compliant document and report the diagnostics.

---

## Gap instances

A gap represents one recognized source occurrence that Denigma could not
faithfully express in standard MNX.

```ts
interface DenigmaGap {
  id: string;
  gapCode: string;
  payloadVersion: number;
  disposition:
    | "unsupported-by-mnx"
    | "supported-by-mnx-but-unimplemented"
    | "partially-represented"
    | "omitted-by-policy"
    | "unrecognized";
  notationRef: {
    taxonomyRevision: string;
    concepts: Array<{
      id: string;
      role: "primary" | "related";
    }>;
  };
  sourceFeature: {
    format: "finale-musx";
    type: string;
    payload: unknown;
  };
  target?: {
    mnxId?: string;
    jsonPointer?: string;
  };
  evidenceRoots: string[];
  capture:
    | { level: "complete" }
    | {
        level: "best-effort" | "raw-source-required" | "truncated";
        reason: string;
        unresolvedReferences?: string[];
      };
  message: string;
}
```

### Why both NotationRef IDs and gap codes are required

A NotationRef ID provides source-neutral classification, such as
`note-notehead-x`. It does not specify anchors, source fields, glyph identity,
inheritance, or reference chains.

A Denigma gap code identifies a concrete, versioned payload contract, such as
`finale.percussion-component-notehead@1`.

Vendors therefore:

- discover and report support using NotationRef IDs; and
- dispatch implementations using the gap code and payload version.

Dispatching only on a NotationRef ID would be unsafe because Finale, MusicXML,
MEI, and another importer could expose different payloads for the same musical
concept.

### Features outside NotationRef

NotationRef is a taxonomy of notation concepts, not every kind of application
data. Finale UI state, plugin-private records, malformed containers, and some
linked-part mechanics may have no appropriate NotationRef ID. Those gaps retain
a Denigma code and an empty concept list rather than inventing a taxonomy ID.

---

## Source-evidence graph

Finale concepts often span multiple pools and chained records. Repeating the
entire dependency closure inside every gap would duplicate data and lose shared
identity. Denigma should instead expose a graph:

```ts
interface DenigmaSourceGraph {
  schemaVersion: number;
  nodes: Record<string, DenigmaSourceNode>;
}

interface DenigmaSourceNode {
  id: string;
  kind: string;
  sourceLocator: string;
  properties: Record<string, unknown>;
  references: Array<{
    role: string;
    target: string;
    requirement: "required" | "contextual" | "optional";
  }>;
  raw?: {
    format: "enigmaxml";
    xml: string;
  };
}
```

For each recognized gap family, Denigma owns dependency traversal:

1. Add the source root.
2. Follow declared required and relevant contextual references.
3. Deduplicate by stable Finale identity.
4. Detect cycles with visited-node tracking.
5. Record dangling or invalid references.
6. State whether capture is complete.

Known relationships can have a tested closure. Unknown numeric fields cannot be
assumed to be references, so arbitrary unknown MUSX data cannot be guaranteed
lossless without retaining complete EnigmaXML or the original MUSX archive.

The graph may retain both raw and resolved values. Resolved values make adapters
practical; raw values and provenance permit later reinterpretation.

This graph is primarily an import-time artifact. Handled gaps become compact
semantic vendor extensions rather than embedding a large Finale object graph in
ordinary MNX.

---

## Denigma mapping catalog

Denigma should publish a machine-readable catalog generated from, or validated
against, the converter implementation:

```json
{
  "sourceConcept": "finale.percussion-component-notehead",
  "notationRefConcepts": ["note-unpitched-notehead-map", "note-notehead-x"],
  "mnxDisposition": "gap-profile",
  "gapCode": "finale.percussion-component-notehead",
  "payloadVersion": 1,
  "payloadSchema": "./gaps/finale-percussion-component-notehead.v1.schema.json"
}
```

Recommended published artifacts:

```text
spec/
  musx-mapping.json
  gap-manifest.schema.json
  source-graph.schema.json
  gaps/
    finale-percussion-component-notehead.v1.schema.json
  examples/
    finale-percussion-component-notehead.v1.json
```

The catalog should distinguish:

1. Finale representation to musical concept.
2. Musical concept to standard MNX representation.
3. Gap payload to a vendor representation.

Denigma owns the first two. Vendors own the third.

### Catalog invariants

- Every declared NotationRef ID exists in the pinned taxonomy.
- Every recognized source concept has an explicit disposition.
- Every emitted gap code exists in the catalog.
- Every gap code has a versioned payload schema.
- Complete captures have no dangling required references.
- A fixture exercises each mapping or marks it explicitly untested.
- A standard MNX mapping and a gap do not duplicate the same semantics.

---

## Viritura shim registry

Viritura should eventually add a registry inside `@viritura/musx-import`:

```ts
interface MusxGapShim {
  gapCode: string;
  payloadVersions: readonly number[];
  notationRefConcepts: readonly string[];
  apply(context: {
    document: unknown;
    gap: DenigmaGap;
    sourceGraph: DenigmaSourceGraph;
    diagnostics: DiagnosticCollector;
  }): void;
}
```

A handler must match both `gapCode` and `payloadVersion`. Its declared
NotationRef concepts support discovery and coverage reporting but do not replace
payload compatibility.

Each result is classified as:

- represented in standard MNX;
- preserved by a Viritura extension;
- partially preserved;
- acknowledged but intentionally dropped; or
- unhandled.

Handled gaps remain visible in the import report as
`preserved-by-vendor-extension`; applying a shim must not erase the fact that
standard MNX could not represent the source occurrence.

---

## Concrete example: percussion component noteheads

This example is grounded in existing source rather than a hypothetical Finale
feature.

musxdom models per-note `NoteAlterations` fields including `altNhead`, custom
font, size percentage, and horizontal offset. Its
`NoteInfoPtr::calcNoteheadInfo()` resolves the effective notehead across
per-note overrides, percussion configuration, and document defaults.

Denigma already classifies resolved noteheads into families including regular,
X, diamond, slash, circled, and other known glyphs. Its MNX exporter creates kit
components with instrument identity, sound, MIDI number, and staff position,
but current MNX has no standard kit-component notehead property.

Denigma could emit:

```json
{
  "gapCode": "finale.percussion-component-notehead",
  "payloadVersion": 1,
  "disposition": "unsupported-by-mnx",
  "notationRef": {
    "taxonomyRevision": "<pinned revision>",
    "concepts": [
      {
        "id": "note-unpitched-notehead-map",
        "role": "primary"
      },
      {
        "id": "note-notehead-x",
        "role": "related"
      }
    ]
  },
  "sourceFeature": {
    "format": "finale-musx",
    "type": "finale.effective-notehead",
    "payload": {
      "shape": "x",
      "fill": "filled",
      "glyphName": "noteheadXBlack",
      "origin": "percussion-layout"
    }
  },
  "target": {
    "mnxId": "kc-hihat-closed"
  },
  "evidenceRoots": ["finale:percussionNoteInfo:42"],
  "capture": {
    "level": "complete"
  },
  "message": "MNX cannot assign an X notehead to a kit component."
}
```

Viritura can translate the supported subset to:

```json
{
  "id": "kc-hihat-closed",
  "name": "Closed Hi-Hat",
  "sound": "hihat-closed",
  "staffPosition": 5,
  "_x": {
    "viritura": {
      "notehead": "x"
    }
  }
}
```

The adapter must respect scope:

| Denigma source situation                                           | Current Viritura coverage                               |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| Percussion component uses X, diamond, slash, circle-X, or triangle | Supported or supportable through `_x.viritura.notehead` |
| One note has an `altNhead` override                                | Not represented by the current kit-component extension  |
| One note has custom size or offsets                                | Not represented by the current extension                |
| Arbitrary resolved SMuFL glyph                                     | Not represented by the current extension                |

A per-note override must never be promoted to the reusable kit component.

---

## Standard evolution

Vendor shims are not a substitute for standardization. Near-term MNX work such
as caesura, percussion-clef, and rich-text proposals should normally be
implemented directly in Denigma once standardized rather than becoming durable
Viritura gap profiles.

The migration sequence is:

1. Denigma initially reports a recognized gap.
2. Viritura optionally preserves it under `_x.viritura`.
3. MNX standardizes the concept.
4. Denigma emits the standard representation and stops producing the gap.
5. The Viritura shim naturally stops running for new imports.
6. Existing Viritura documents may migrate their extension separately.

Gap retirement is a documented mapping-catalog change.

---

## Versioning and distribution

The following versions remain independent:

- Denigma release and commit;
- Denigma mapping-catalog version;
- gap-manifest schema version;
- individual gap payload version;
- source-graph schema version; and
- NotationRef taxonomy revision.

A taxonomy wording change does not require a payload version bump. A payload
field changing meaning or type does.

Consumers pin a known catalog/package version at build time. Conversion must not
download the latest catalog dynamically.

The specification could ship as a small package independent from the converter
binary, for example `@denigma/musx-gap-spec`, containing JSON Schema, generated
types, mapping metadata, and examples.

---

## Completeness and source retention

Denigma can guarantee a documented dependency closure only for recognized
features. Every gap states one of:

- `complete`;
- `best-effort`, with unresolved references;
- `raw-source-required`; or
- `truncated`, with the applicable safety reason.

Optional archival policies may retain:

```ts
type SourceRetention = "none" | "gap-closure" | "complete-enigmaxml" | "original-musx";
```

`gap-closure` is the normal application default. Complete source retention is
appropriate for archival or future reprocessing, but should be stored as a
project attachment identified by hash rather than copied into every extension
object.

All source processing remains subject to input-size, archive-entry,
decompressed-size, expansion-ratio, memory, and time limits.

---

## Upstream asks and current disposition

The reusable WebAssembly converter and first structured conversion-gap report
have landed upstream. The remaining asks are a machine-readable mapping
catalog, explicit payload-version compatibility, NotationRef associations, and
source evidence where the normalized payload is not sufficient.

The quoted requests below are retained as the historical starting point:

> **Consumable converter package:** Would you be open to publishing a reusable
> WebAssembly package for Denigma's MUSX-to-MNX converter, potentially by
> extracting the reusable conversion boundary demonstrated by Denigma Online?
> The intent would be for Denigma Online, Viritura, and other browser or desktop
> webview applications to consume the same versioned converter while Denigma
> remains the authoritative C++ implementation.

> **Structured conversion gaps:** Would you also be open to having Denigma
> report recognized MUSX features it cannot faithfully represent in standard
> MNX rather than silently omitting them? Denigma could associate those gaps
> with NotationRef concepts and maintain a public, versioned catalog and payload
> schemas, allowing applications such as Viritura to implement their own
> post-conversion shims or `_x` extensions without adding vendor-specific
> behavior to Denigma itself.

---

## Suggested rollout

### Phase 1: upstream contract — completed for the first report

- Denigma owns MUSX classification and emits standard MNX plus a separate gap
  report.
- Chord symbols and noteheads established stable target anchoring.
- Expressions, smart shapes, and lyric word extensions expanded the report.
- A published mapping catalog, gap codes, and payload schemas remain open.

### Phase 2: Viritura report ingestion — completed

- Pin a Denigma build that exposes the schema-v1 report.
- Read and validate the report through the WebAssembly result boundary.
- Return it from `@viritura/musx-import` without silently dropping unknown
  types.
- Keep source-graph capture as a later upstream enhancement.

### Step 1: adapter prerequisites

- [x] Extend the source-neutral Viritura trill model with an optional endpoint-based
      extension and an explicit initial-symbol visibility flag. This represents
      both ordinary trill-plus-line spans and extension-only lines without carrying
      Finale font choices into the document model.
- [x] Add a Notation Properties control that creates an event-anchored
      extension. New lines default to the end of the trill's own note. Trill
      endpoints remain event-anchored rather than accepting arbitrary positions.
- [x] Add same-system trill-extension rendering with stable selectable IDs.
- [x] Add an event-snapping end handle that updates the extension target and
      can choose either the start or end edge of a note.
- No new destination model is required for plain expressions, performance
  instructions rendered as text, rehearsal marks, tempo visibility, or the
  safe glissando subset.
- Defer separate displayed-versus-playback metronome values, multiple rehearsal
  marks in one measure, note-specific chord endpoints, rich text, custom line
  glyphs, exact line widths and caps, and tab-slide semantics. These are
  fidelity improvements rather than blockers for the first adapters.

### Step 2: Viritura gap conversions

- Add a schema-versioned shim registry and target-ID index.
- Implement plain expressive text and performance instructions as text
  expressions.
- Preserve rehearsal marks and tempo text/display behavior by decorating
  Denigma's existing standard MNX targets rather than creating duplicates.
- Add the safe event-level straight/wavy glissando subset.
- Convert trill lines after the extension renderer is available:
  `includesTrSymbol: true` produces a trill symbol plus an extension, while
  `false` produces an extension only.
- Keep rich formatting and unsupported line details explicitly partial or
  unhandled.
- Present handled, partial, and unhandled gaps in the import UI.

### Step 2.5: conversion test strategy

- Keep ordinary pull-request CI hermetic: unit-test adapters with compact
  hand-authored MNX and gap-report objects, reuse existing format/render tests
  for destination behavior, and add one mocked editor integration test.
- Do not clone Denigma or download MUSX fixtures during ordinary pull-request
  CI.
- When `pnpm build:denigma-wasm` updates the pinned converter, use the fixtures
  from that exact checkout for a focused WebAssembly acceptance corpus:
  `slurs_2staves.musx`, `techniques.musx`, `rehearsal_marks.musx`,
  `tempo_varied_staves.musx`, `glissando.musx`, and
  `smartshape_lines.musx`.
- Assert only Viritura's external contract: schema version, representative gap
  discriminators, resolvable anchors, and required payload fields. Do not copy
  Denigma's complete golden snapshots or classification tests.

### Step 3: remaining gaps of the gap

- Generate a report from handled, partial, and unhandled schema-v1 payload
  fields after the first adapter set lands.
- Open a follow-up issue from that report for deferred fidelity work, including
  displayed-versus-playback metronome values, multiple rehearsal marks,
  note-specific endpoints, rich text and font metrics, dashed/invisible/custom
  lines, caps and arrowheads, tab slides, and exact source appearance.
- Keep the issue tied to the pinned Denigma commit and payload schema version so
  later upstream changes can be distinguished from known Viritura limitations.

### Phase 4: ecosystem

- Publish vendor capability manifests.
- Compare document gap instances against installed adapters.
- Generate NotationRef coverage views from the same declarations.
- Establish deprecation and migration rules as MNX gains standard support.

---

## Open questions

- Should gap instances and source evidence be one JSON document or separate
  streams from the WebAssembly boundary?
- Which stable MUSX identities can Denigma expose without leaking parser
  implementation details?
- Which resolved properties also require raw source values and provenance?
- Should full source retention be managed by Denigma or by the host before
  conversion?
- What compatibility guarantees will Denigma provide for retired gap codes?
- Should shared, source-neutral payload profiles emerge for selected
  NotationRef concepts, or remain source-specific until multiple importers need
  them?
