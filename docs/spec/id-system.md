# ID System

Stable, unique identifiers on every score element. Required by CRDT
collaboration (Y.Doc reconciliation, peer-to-peer merges), incremental
rendering (per-measure dirty-checking), undo/redo (operations target
elements by id, not array index), and selections / annotations
(everything that pins to a thing in the score).

## Format

Canonical **RFC 9562 UUID v7**, 36-character hyphenated string.

```
0196f3a8-7c4b-7d8a-9b3e-2f1c4d5e6f70
```

Why UUID v7:

- **Polyglot ergonomics.** Built-in generator in Rust
  (`uuid::Uuid::now_v7()`) and C# (`Guid.CreateVersion7()` on .NET 9+). TS
  uses a ~20-line manual byte-layout shim around `crypto.getRandomValues`
  with no library dependency.
- **Time-ordered prefix** (48-bit big-endian unix-ms timestamp) gives free
  DB index locality and debug-friendly sort order.
- **Single format end-to-end.** No second id scheme anywhere in the
  pipeline, so there is exactly one place to look when reasoning about
  identity.

## Generation

Single source of truth: `generateId()` in
[`packages/core/src/id.ts`](../../packages/core/src/id.ts). Every
id-bearing element in every code path goes through this function.

Four mint sites:

1. **Editor edits** — new notes, measures, parts, slurs, ties, etc.
2. **MNX parser auto-assign** — fills `id` on elements that arrived
   without one ([`packages/format/src/mnx/parser.ts`](../../packages/format/src/mnx/parser.ts), `assignMissingIds`).
3. **MusicXML import** — every element minted during conversion
   ([`packages/musicxml/src/convert/idGenerator.ts`](../../packages/musicxml/src/convert/idGenerator.ts)).
4. **Score creation** — empty-score scaffolding in the editor.

Rust and C# both call their language's `now_v7()` directly; the TS shim
exists because Node and browser stdlibs don't ship a UUID-v7 helper yet
(only v4 via `crypto.randomUUID()`).

## Stability

**IDs are stable because they are persisted, not because they are
deterministic.** Re-parsing the same source MNX file produces _different_
auto-assigned ids each time. This is fine — and intentional. The mutated
`Score` is saved back through the normal save path, so the assigned ids
live in the canonical file from that point onward.

A previous attempt to make auto-assignment deterministic (counter-based
`auto-N` ids) was a workaround for "we don't write back assigned ids
immediately." The fix turned out to be persistence, not determinism.

## Assignment rules

1. **On creation** — every new element gets a `generateId()` id
   immediately.
2. **On parse** — if a source MNX file has explicit `id` values, they are
   preserved as-is (MNX ids are opaque strings; we don't care what shape
   they have). Elements without an `id` receive a freshly minted UUID v7.
3. **On collision** — `mintId(usedIds)` in the parser re-rolls if a newly
   generated id collides with a source-provided id. With UUID v7's 74
   random bits this is theoretically negligible (~10⁻²² for a 10K-element
   score), but the check is cheap and explicit.
4. **Never reassigned** — once an element has an id, it keeps that id for
   its lifetime. Across reorders, splits, ties, copies. Newly derived
   elements get fresh ids; original ids stay put.
5. **Never recycled** — ids of deleted elements are not reused within a
   session.

## What carries an id today

Decoded model (TS and Rust, parity enforced by round-trip tests):

- `GlobalMeasure` (one per measure in `global.measures`)
- `Part`
- Per-part `Measure` (one per part per measure)
- `Sequence` (voice)
- `Event` (chord / rest, the smallest schedulable unit)
- `Note` (one per pitch within a chord)
- `LayoutDefinition` (one per entry in `score.layouts[]`; referenced by
  `ScoreDefinition.layout`, `SystemDefinition.layout`, and
  `LayoutChange.layout` as opaque keys). Auto-derived layouts (e.g.
  Engrave-mode hide-staff prunes) carry `_x.viritura.derived: true` so
  the GC pass can distinguish them from user-authored layouts; the id
  itself is a UUID v7 like every other entity. Dedup is structural — two
  layouts with identical content collapse to one shared id — see
  [`engrave-mode.md`](engrave-mode.md#derived-layouts-hide-staff).
- Slurs, ties, beams — spanning elements reference event/note ids via
  `target`.

Every source MNX file in the corpus has all of the above pre-assigned to
canonical UUID v7.

## How the rest of the system uses ids

- **Renderer.** `DisplayList` carries `element_ids`, `ElementBBox`, and
  `MeasureBounds` so the editor can hit-test a click back to a model
  element and so per-measure dirty rectangles invalidate the right tiles.
- **CRDT projection.** The schema-blind Y.Doc walker
  ([`packages/crdt/src/yProjection/`](../../packages/crdt/src/yProjection/))
  treats `id` as just another JSON leaf, but the _uniqueness_ of those ids
  is the precondition that makes the queued LCS-aware array diff
  tractable: string equality on `id` replaces deep structural equality on
  the subtree. See
  [`data-model-pipeline.md`](data-model-pipeline.md#yjs--whats-queued-non-blocking).
- **Selection.** Editor selection state stores `elementId` strings, never
  indices.
- **Patches.** `ScorePatch[]` operations target elements by id;
  index-based operations would be fragile under concurrent edits.

## Wire format

Ids ride in the standard MNX `id` field. No separate registry, no sidecar.

```json
{
  "global": {
    "measures": [
      {
        "id": "0196f3a8-7c4b-7d8a-9b3e-2f1c4d5e6f70",
        "time": { "count": 4, "unit": 4 }
      }
    ]
  },
  "parts": [
    {
      "id": "0196f3a8-7c4c-7a11-b2d7-c5e8b91a4f04",
      "measures": [
        {
          "id": "0196f3a8-7c4d-7c93-9f3a-04bc6d2e8714",
          "sequences": [
            {
              "content": [
                {
                  "id": "0196f3a8-7c4e-7e2b-a014-eb6f3d5c8907",
                  "type": "event",
                  "duration": { "base": "quarter" },
                  "notes": [
                    {
                      "id": "0196f3a8-7c4f-7d3f-9b71-fa84d2e91c08",
                      "pitch": { "step": "C", "octave": 5 }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Size cost

The worst-case score in our corpus, Beethoven 5 Finale, has 5,467 ids:
~51 KB → ~132 KB gzip with UUID v7. The cost of one id format end-to-end.

## Related

- [`data-model-pipeline.md`](data-model-pipeline.md) — full model pipeline
- [`collaboration-system.md`](collaboration-system.md) — Y.Doc / CRDT
- [`packages/core/src/id.ts`](../../packages/core/src/id.ts) — the generator
