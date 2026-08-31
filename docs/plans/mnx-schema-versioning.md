# MNX Schema Versioning: Future Plan

> **Status:** Deferred. MNX is still a W3C draft (no stable v1 release yet), so
> the project tracks a single rolling schema. This document captures the
> architecture we'll adopt the first time we need to support two MNX schema
> versions side-by-side, so the eventual migration is a known shape rather
> than a redesign.
>
> **Trigger to revisit:** the first incompatible MNX schema bump after we
> have at least one shipped file format users care about preserving — i.e.
> the first time we can no longer just regenerate all `packages/format/fixtures/mnx/*.mnx`
> fixtures by hand.

---

## Today's pipeline (single version)

```
JSON ──assertRawScore──▶ RawScore ──promote──▶ Score (in-memory)
       (one schema)                (one walker)
```

Locations:

- Schema: [`packages/format/src/mnx/generated/mnx-schema.json`](../../packages/format/src/mnx/generated/mnx-schema.json) (copied
  from [`packages/format/schemas/mnx-schema.json`](../../packages/format/schemas/mnx-schema.json) by `pnpm gen:raw`)
- Generated raw types: `packages/format/src/mnx/generated/raw.ts`
- Validator: [`packages/format/src/mnx/validator.ts`](../../packages/format/src/mnx/validator.ts)
- Promote walker: [`packages/format/src/mnx/promote.ts`](../../packages/format/src/mnx/promote.ts) and siblings

The document already carries `mnx: { version: 1 }`, but `assertRawScore`
never reads it — there is only one schema to validate against.

---

## Target pipeline (multi-version)

```
JSON ──getMnxVersion──▶ version
                          │
                          ├─ v1 ──assertRawScoreV1──▶ RawScoreV1 ──promoteV1──┐
                          ├─ v2 ──assertRawScoreV2──▶ RawScoreV2 ──promoteV2──┤
                          └─ vN ──assertRawScoreVN──▶ RawScoreVN ──promoteVN──┤
                                                                              ▼
                                                                          Score
                                                                       (canonical
                                                                        superset)
```

Reverse direction:

```
Score ──serializeMnx(score, { targetVersion })──▶ JSON
                                                  (downcast diagnostics when
                                                   score uses features the
                                                   target version lacks)
```

**Key invariant:** the in-memory `Score` model is **one** type — the union /
superset across all supported MNX versions. Renderer, editor, engine, CRDT,
patches, and playback are all version-agnostic. The version split lives
entirely inside the format package, on both the parse and serialize edges.

This is the same shape protobuf, GraphQL, and Stripe-style API versioning
all converge on.

---

## Migration steps (when the first split is needed)

1. **Re-layout schemas by version.** Replace the flat layout with one folder
   per version:

   ```
   packages/format/src/mnx/generated/
     v1/mnx-schema.json
     v1/raw.ts
     v2/mnx-schema.json
     v2/raw.ts
   ```

   `pnpm gen:raw` becomes a loop over `schemas/v*/mnx-schema.json`.

2. **Version-aware validators.** `validator.ts` exports a map and reads
   `mnx.version` before dispatching:

   ```ts
   const validators = {
     1: createValidator(v1Schema),
     2: createValidator(v2Schema),
   } as const;

   export function getMnxVersion(json: unknown): number | null {
     if (typeof json !== "object" || json === null) return null;
     const v = (json as { mnx?: { version?: unknown } }).mnx?.version;
     return typeof v === "number" ? v : null;
   }

   export function assertRawScore(json: unknown): asserts json is RawScoreLatest {
     const version = getMnxVersion(json);
     if (version === null) throw new MissingMnxVersion();
     const validator = validators[version];
     if (!validator) throw new UnsupportedMnxVersion(version);
     // …existing Ajv error handling
   }
   ```

   Reading `mnx.version` before validation is safe — it's at a fixed
   top-level location and requires no schema knowledge.

3. **Per-version promoters.**

   ```
   src/mnx/promoters/v1/   ← current promote.ts + parsers split per version
   src/mnx/promoters/v2/
   src/mnx/promoters/shared/   ← _x.viritura hoister, pitch math, helpers
   ```

   Each version's `promote()` returns the same canonical `Score`.

4. **`Score` as the superset.** When v2:
   - **Adds** a field → optional on `Score`; v1 promoter leaves it `undefined`.
   - **Removes** a field → `Score` keeps it; v2 promoter never populates it.
   - **Renames** a field → v2 promoter maps old→canonical; `Score` uses
     the canonical name.
   - **Changes semantics** → that's the hard case; needs an explicit
     migration step in the v2 promoter. Document the semantic shift in
     `promoters/v2/CHANGES.md`.

5. **Version-targeted serializer.**

   ```ts
   serializeMnx(score, { targetVersion: 1 }) →
     { mnx: { version: 1 }, ... }   // strips v2-only fields,
                                     // returns downcast diagnostics for
                                     // lossy conversions
   ```

   This is where "I tried to save your v2 score as v1 and lost the harp
   pedal markings" warnings come from.

6. **Rust mirrors all of this.** Once the Rust generator (see
   [`rust-raw-generator.md`](rust-raw-generator.md)) lands, the same
   per-version folder split applies on the Rust side. Engine-facing
   decoded `Score` remains single-shape.

---

## Subtleties to flag at decision time

- **Default version on missing `mnx.version`.** Hard-fail vs.
  default-to-1. Stripe-style "always pin a version, fail loudly if missing"
  is safer long-term; default-to-latest invites silent breaks. Recommend
  hard-fail with a clear `MissingMnxVersion` error.
- **Schema migrations vs. promoter migrations.** Two different things:
  - _Promoter_: v1 document → canonical in-memory `Score`. **Mandatory**
    for as long as we support loading v1 files.
  - _Schema migration_: v1 document → v2 document, rewritten on disk.
    **Optional**, useful for a "Save As v2" button or for retiring a v1
    promoter after a deprecation window.
- **Vendor extensions are orthogonal.** `_x.viritura` lives outside the
  MNX schema, so its evolution has nothing to do with MNX version bumps.
  Keep [`packages/format/schemas/viritura-extensions.json`](../../packages/format/schemas/viritura-extensions.json)
  on its own version track (and consider giving it the same per-version
  layout if it ever splits).
- **W3C MNX is still a draft.** The realistic first split won't be
  "v1 → v2" — it'll be "draft-2025-MM → draft-2026-NN" (schema revisions
  within v1). Same machinery works; just key the dispatch on a finer
  schema-revision field if needed, or version-pin to schema fetch dates.

---

## Effort estimate

When the trigger fires:

1. Drop `v2/mnx-schema.json` into `schemas/`, re-run `gen:raw` → generated
   `RawScoreV2` appears. **Tiny.**
2. Write `promoters/v2/` — biggest chunk, scales with the v1↔v2 delta.
3. Add version dispatch in `assertRawScore`. **~30 lines.**
4. Extend `serializeMnx` with `targetVersion`. Bigger if v2 adds many new
   fields (each needs a downcast rule).

Renderer, editor, engine, CRDT layer, patch IR, and playback are
**untouched** — they consume `Score`, which stays version-agnostic.

---

## Prep we could do now (cheap, optional)

If the structure starts to feel imminent, the lowest-risk prep step is to
move the current schema into a `v1/` subfolder and have `assertRawScore`
read `mnx.version` (defaulting to 1 if absent for legacy fixtures, and
hard-failing on anything else). ~20 lines of change, no behavior shift
for valid v1 documents. Not worth doing speculatively before MNX has a
stable v1.
