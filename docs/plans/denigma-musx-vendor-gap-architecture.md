# Denigma MUSX Vendor-Gap Architecture

> **Status: proposed.** Viritura can import Finale MUSX through an internally
> packaged Denigma WebAssembly converter. Denigma does not currently expose the
> structured gap catalog, source-evidence graph, or vendor-shim protocol
> described below.

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
4. **NotationRef supplies shared semantics.** Gap reports use W3C Music
   Notation Reference concept IDs for discovery and coverage reporting.
5. **Gap payloads remain separately versioned.** NotationRef identifies what a
   feature means; it does not define enough data to reconstruct an occurrence.
6. **Vendors own preservation policy.** Each consumer decides which gap payloads
   it can translate into its model or `_x` namespace.
7. **Standard MNX wins over extensions.** When MNX gains a faithful
   representation, Denigma emits it and retires the corresponding gap.

---

## Ownership boundaries

| Authority                          | Responsibility                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| W3C Music Notation Community Group | NotationRef taxonomy and MNX specification                                                                   |
| musxdom                            | Typed Finale document model, object resolution, and effective-value calculation                              |
| Denigma                            | MUSX classification, MUSX-to-NotationRef mappings, standard MNX conversion, gap schemas, and source evidence |
| Viritura                           | Viritura extension schema, Denigma-gap adapters, import policy, and user-facing loss reporting               |
| Other vendors                      | Their own gap adapters and extension/application representations                                             |

Denigma would own the assertion that a Finale construct corresponds to a
NotationRef concept. It would not own the NotationRef concept itself.

---

## Current Viritura integration

PR #64 establishes the initial converter boundary:

```text
MUSX bytes
  -> @viritura/musx-import worker
  -> Denigma WebAssembly
  -> standard MNX JSON + diagnostics
  -> Viritura MNX schema/semantic validation
  -> editor document
```

The internal package compiles Denigma's public `denigma::mnx` target through a
narrow C ABI. Its build pins the Denigma commit, Emscripten image, and
content-addressed archive dependencies; generated assets carry hashes,
provenance, and licenses.

This is a deployment mechanism, not the target vendor-gap protocol. The current
Denigma API returns MNX and diagnostics only.

Long term, the preferred upstream distribution is a reusable, versioned
MUSX-to-MNX WebAssembly package built from Denigma. Denigma Online should be a
consumer of that package rather than the application-level dependency Viritura
imports. Native executables remain useful for command-line users, but cannot be
rebundled into WebAssembly after compilation.

---

## Target conversion artifact

Denigma should return one logical artifact containing:

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

## Proposed upstream asks

These are intentionally high-level starting points for discussion with the
Denigma author:

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

Implementation details should be proposed upstream only after there is agreement
on these ownership boundaries and goals.

---

## Suggested rollout

### Phase 1: upstream contract

- Agree on ownership and terminology with the Denigma author.
- Define mapping dispositions and stable gap-code rules.
- Select one source-backed pilot such as percussion component noteheads.
- Publish an initial mapping catalog and payload schema.

### Phase 2: converter output

- Add gap collection to Denigma's public conversion result.
- Add source-graph capture for the pilot feature.
- Expose the result through native and WebAssembly APIs.
- Prove that recognized unsupported features cannot be silently discarded.

### Phase 3: Viritura adapters

- Extend `@viritura/musx-import` to validate the catalog, manifest, and graph.
- Add a versioned shim registry.
- Implement the percussion-notehead adapter.
- Present handled, partial, and unhandled gaps in the import UI.

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
