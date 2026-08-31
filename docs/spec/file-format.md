# File Format Strategy — MNX with Vendor Extensions

## Executive Summary

A Viritura project saves as a **single `.mnx` file**. Application-specific
metadata that MNX does not yet cover (rehearsal marks, pedals,
condensing overrides, slur shape overrides, per-score page setup, …) lives
inside that same file under the MNX-standard `_x.viritura` vendor namespace.
Any MNX-compatible reader can still parse the file and ignore the
`_x.viritura` blocks.

Hairpins and all other dynamic semantics use standard MNX dynamic groups.
Viritura adds only optional engraving placement under each group's
`_x.viritura` dictionary — see [dynamics.md](./dynamics.md).

| What's saved      | Where it lives                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Musical content   | MNX-standard JSON (notes, rhythm, beams, ties, slurs, repeats, jumps, layouts, pages…)                                                 |
| Layout decisions  | `score.pages[]`, `score.layouts[]` (native MNX) — even forced page/system breaks ride on the native `pages[].systems[].measure` field. |
| Page setup        | `_x.viritura.pageSetup` on each `ScoreDefinition`                                                                                      |
| Vendor extensions | `_x.viritura.*` on the relevant MNX object (see [viritura-extensions.md](./viritura-extensions.md))                                    |

---

## 0. Non-negotiable principle: no vendor lock-in

**Every Viritura file on disk must be openable, readable, and parseable without any Viritura software.** This is a hard requirement that shapes every other format decision and supersedes any short-term convenience that would compromise it.

The industry has shown repeatedly why this matters:

- **Finale (MakeMusic, sunsetted Aug 2024).** Proprietary binary format that MakeMusic [openly admits](https://makemusic.zendesk.com/hc/en-us/articles/25843888130839-Finale-Sunset-FAQ) was "specifically designed to be read only by Finale." Existing activated installs still work, but any re-authorization event (new computer, OS reinstall, drive failure) needs MakeMusic's servers — and macOS Sequoia is already incompatible. No third-party tool can rescue these files because the format was never opened. MusicXML export (lossy) before your install dies is the only escape.
- **Sibelius (Avid, subscription).** Files are intact on the user's drive but unreadable without an active subscription. The data isn't lost; access to it is rented.
- **SCORE (Leland Smith, dead 2013).** Cautionary tale even when the format is _more_ open: SCORE's binary format is documented, and a third-party ecosystem (Brodhead's utilities, Ararat Software, Jan de Kloe's SIP) keeps files parseable 13+ years after the author's death. But SCORE itself is DOS-only, runs only under DOSBox, and its rendering broke when Adobe ended PostScript Type 1 fonts in Jan 2023. Open format is necessary but not sufficient — when the _editing software_ dies, maintaining engraved sources becomes a specialist effort. Plain-text formats over standard containers (JSON over ZIP, what we ship) survive even when no specialist community exists to maintain the editor.

The pattern is consistent: when a format is **only** parseable by one vendor's binary, users' work is hostage to that vendor's business decisions — not their own goodwill, not their long-term existence, not their pricing model.

Viritura refuses to be that vendor.

### Concrete requirements this principle imposes

1. **Every on-disk artifact must be parseable from its raw bytes without Viritura.** Either it's directly human-readable text (MNX JSON), or it's a documented open container (ZIP) holding directly human-readable text.
2. **No proprietary binary formats.** Not for scores, not for project containers, not for sidecar metadata. If we need binary efficiency for a specific payload (a soundfont, a sample), it must be a documented open format (SF2, WAV, FLAC — not a Viritura-specific binary).
3. **No required-runtime-decoding.** A user with the file and a JSON parser must be able to extract their music. We cannot ship a format whose meaning lives in a Viritura-specific decoder.
4. **No encryption / DRM on the user's own work.** Ever. Collaboration / sharing flows may use transport encryption, but the artifact on the user's disk is theirs and is plaintext.
5. **Schema is published and versioned.** MNX is a W3C spec; our `_x.viritura` extensions are documented in [`viritura-extensions.md`](./viritura-extensions.md) and have a JSON Schema at [`packages/format/schemas/viritura-extensions.json`](../../packages/format/schemas/viritura-extensions.json). A future archaeologist with the schema and a JSON parser can recover the data.
6. **MNX-only files round-trip through any MNX reader.** A Viritura file stripped of `_x.viritura` blocks is still a valid MNX document with all musical content intact. Users who migrate away keep their notes, rhythms, layouts, and structure — they only lose Viritura-specific layout/playback refinements.
7. **Container formats use documented open standards.** The planned `.viritura` ZIP container ([`plans/project-format.md`](../plans/project-format.md)) is plain ZIP — unzippable by `unzip`, 7-Zip, `Expand-Archive`, every file manager on every OS. Inside is MNX JSON. No Viritura software required at any step.

### What this rules out

- A custom binary format "for performance" — even if it would be faster to load. Performance optimizations live in caches that are derived from, never the source of truth for, the on-disk artifact.
- A proprietary container with a sniffer that only Viritura can validate.
- Encrypted project files, even with user-provided keys (the key gets lost; the user gets locked out of their own work).
- Required online activation, cloud-only storage, or any DRM-like mechanism gating local file access.
- Format extensions that aren't documented in the public schema repo.

### What this allows

- `_x.viritura.*` extensions for things MNX doesn't cover, **provided they're documented in the public schema**. Other readers ignore them safely; we don't compromise musical-content portability to add features.
- Open-format payload files inside project containers (PDF, MIDI, WAV, SF2, FLAC, OGG, PNG, SVG — all readable without Viritura).
- Optional compression of text payloads inside ZIP containers (DEFLATE is open and ubiquitous).
- Performance-optimized caches and derived data, as long as they're rebuildable from the canonical on-disk artifact and never required to read it.

Viritura being open-source provides a _second_ layer of guarantee — even if the format weren't independently parseable, the source would always be available. But we don't rely on that. The **format itself** must be parseable without Viritura, source code or otherwise. Open source is a backstop, not the primary defense.

---

## 1. Why MNX?

### Formats considered

| Format           | Type   | Strengths                                                                                       | Weaknesses for our use case                                                                         |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **MusicXML 4.0** | XML    | 250+ apps support it; de facto interchange standard                                             | Designed for interchange only; verbose XML; ambiguous encoding for many concepts; not web-native    |
| **MNX**          | JSON   | Next-gen MusicXML successor from the same W3C group; JSON; semantic-first; unambiguous encoding | Still in draft; doesn't cover layout/playback                                                       |
| **MEI**          | XML    | Extremely rich scholarly encoding                                                               | Massively verbose; designed for archival/academic use; overkill for real-time collaborative editing |
| **MIDI**         | Binary | Universal playback; tiny files                                                                  | No notation data — only performance events                                                          |
| **Custom JSON**  | JSON   | Total control                                                                                   | Creates "yet another standard"; no interop; ecosystem fragmentation                                 |
| **ABC**          | Text   | Simple, human-readable                                                                          | Limited to folk/simple music                                                                        |

### Why MNX specifically

From the [MNX specification](https://w3c.github.io/mnx/docs/):

> _MNX is designed to be easy for software to read, write and pass through.
> It uses JSON, the most widely used format for data exchange on the web.
> Its objects map closely to how concepts tend to be implemented in
> applications. And our philosophy is to provide clear, unambiguous ways to
> encode musical concepts — "one and only one way to do things."_

Key advantages over MusicXML:

1. **JSON, not XML** — native to web applications, maps directly to TypeScript objects.
2. **Unambiguous encoding** — one way to express each concept.
3. **Designed for native use** — explicitly usable as an application's internal format, not just an interchange wrapper.
4. **Semantic-first** — encodes musical meaning, not visual presentation; multiple layouts can be derived from one source.
5. **Cleaner data model** — global measures, explicit sequences for voices (no `<backup>`/`<forward>` hacks), reference-by-id rather than positional.
6. **Vendor extensions are first-class** — every object has an optional `_x` field, so we never have to monkey-patch the schema.

### Why not a fully custom format

- [xkcd 927](https://xkcd.com/927/) — we don't want to be standard #15.
- Building on MNX **contributes to adoption** of an emerging open standard.
- Users' scores remain portable even if they stop using Viritura.
- Other developers can build tools that read our files without reverse-engineering them.

---

## 2. MNX coverage

For an up-to-date inventory of every MNX object Viritura reads and writes,
see [mnx-coverage.md](./mnx-coverage.md). For the catalogue of vendor
extensions we add on top of MNX, see [viritura-extensions.md](./viritura-extensions.md).

What MNX intentionally does **not** cover, and how we handle it:

| Category                                           | MNX stance      | Viritura's handling                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-score page setup (size, margins, rastral)      | Not in MNX      | `ScoreDefinition._x.viritura.pageSetup`                                                                                                                                                                                                                                                                                                |
| Slur shape overrides (bezier handles)              | Not in MNX      | `event.slurs[]._x.viritura.shape`                                                                                                                                                                                                                                                                                                      |
| Hairpins                                           | Standard in MNX | `parts[].measures[].dynamics[]` with `type: "gradual"`                                                                                                                                                                                                                                                                                 |
| Pedals, expressions, chord symbols                 | Not yet in MNX  | `parts[].measures[]._x.viritura.*`                                                                                                                                                                                                                                                                                                     |
| Rehearsal marks, coda variants, jumps              | Partial in MNX  | `global.measures[]._x.viritura.*`                                                                                                                                                                                                                                                                                                      |
| Glissandos, trills, ornaments, fingerings, caesura | Not yet in MNX  | `event._x.viritura.*` / `markings._x.viritura.*`                                                                                                                                                                                                                                                                                       |
| Condensing-mode override per measure               | Not in MNX      | `parts[].measures[]._x.viritura.condensingOverride`                                                                                                                                                                                                                                                                                    |
| Engraving style / music font                       | Not in MNX      | Out of file: user/workspace preferences, not score-scoped                                                                                                                                                                                                                                                                              |
| Playback mixer / soundfont assignments             | Not in MNX      | Runtime-only today (per-part mute/solo/volume/pan held in `PlaybackContext` refs); not persisted. When persistence ships it'll live in `_x.viritura` on `Part` / `ScoreDefinition`.                                                                                                                                                    |
| Collaboration state                                | Not in MNX      | Held in the CRDT (see [collaboration-system.md](./collaboration-system.md)). For live sessions, the host periodically PUTs a binary Yjs snapshot to the API server (in-memory store, room-scoped) so late joiners can bootstrap past the 256 KB WebRTC initial-sync limit. Nothing collaboration-related is written to the score file. |

---

## 3. What ships on disk

When the editor saves a project today:

```
project/
├── .git/           # (only when the project is git-versioned)
└── score.mnx       # One file. Music + _x.viritura extensions.
```

The save path is [`useFileSaveActions.ts`](../../apps/editor/src/app/useFileSaveActions.ts);
the git-backed write path is [`GitProjectAdapter.writeScore`](../../apps/editor/src/git/GitProjectAdapter.ts);
the load path is [`useFolderOpen.ts`](../../apps/editor/src/app/useFolderOpen.ts).

For multi-user live sessions, the host uploads a periodic binary Yjs snapshot
to the API server (`PUT /live/room/{roomId}/snapshot`, stored in an in-memory
`InMemoryRoomSnapshotStore` keyed by room id; see
[`server/Viritura.Api/Signaling/SnapshotEndpoint.cs`](../../server/Viritura.Api/Signaling/SnapshotEndpoint.cs)).
The snapshot is **not** a file written to disk — it exists only as a server-side
blob that joining peers `GET` and apply via `Y.applyUpdate` before P2P sync
takes over. It's collaboration transport state, lost on server restart, and
**not** required for offline editing.

---

## 4. Vendor extension pattern

Features the MNX spec hasn't formalized yet ride on the spec-sanctioned `_x`
namespace, scoped to a vendor key. Viritura uses `_x.viritura`:

```jsonc
// Inside score.mnx — standard gradual group with a placement extension
{
  "type": "gradual",
  "position": { "fraction": [0, 1] },
  "end": { "measure": "m2", "position": { "fraction": [2, 4] } },
  "wedgeType": "increasing",
  "_x": { "viritura": { "avoidCollisions": false } }
}

// Inside score.mnx — on event markings
{
  "markings": {
    "staccato": {},
    "_x": {
      "viritura": {
        "trill": { "shape": "normal" }
      }
    }
  }
}

// Inside score.mnx — on a slur
{
  "slurs": [{
    "target": "ev42",
    "_x": {
      "viritura": {
        "shape": { "p1": [0.0, -0.4], "p2": [0.0, -0.6] }
      }
    }
  }]
}
```

The complete extension catalogue and JSON Schema live at
[viritura-extensions.md](./viritura-extensions.md) and
[`packages/format/schemas/viritura-extensions.json`](../../packages/format/schemas/viritura-extensions.json).
Schema validation runs against the provenance-locked `mnx-schema.json` for the
core file and `viritura-extensions.json` for every supported `_x.viritura`
block. Unknown extension keys and extension blocks at unsupported object
locations are rejected by both strict parser implementations.

When the W3C MNX group adopts one of these features, we migrate from
`_x.viritura.<thing>` to the standard property and keep a one-version
reader for backwards compatibility.

---

## 5. MNX as in-memory model

MNX's JSON structure maps directly onto our TypeScript runtime model
([`packages/core/src/model/`](../../packages/core/src/model)) and onto the
Yjs CRDT projection ([`packages/crdt/src/MnxYjsBridge.ts`](../../packages/crdt/src/MnxYjsBridge.ts)).

The CRDT projection is a **schema-blind structural mirror** of the parsed
score: every JSON object becomes a `Y.Map`, every JSON array becomes a
`Y.Array`, primitives stay primitive. There is no parallel "viritura
sidecar" CRDT; everything (including the `_x` blocks) is one tree under the
root `Y.Map("score")` key.

| MNX concept      | MNX JSON path                               | TypeScript type    | Yjs shape                     |
| ---------------- | ------------------------------------------- | ------------------ | ----------------------------- |
| Score root       | `{ mnx, global, parts, scores, layouts }`   | `Score`            | `Y.Map("score")`              |
| Global measures  | `global.measures[]`                         | `GlobalMeasure[]`  | `Y.Array` of `Y.Map`          |
| Time signature   | `global.measures[n].time`                   | `TimeSignature`    | Nested `Y.Map`                |
| Key signature    | `global.measures[n].key`                    | `KeySignature`     | Nested `Y.Map`                |
| Part             | `parts[n]`                                  | `Part`             | `Y.Map` in `Y.Array("parts")` |
| Part measure     | `parts[n].measures[m]`                      | `PartMeasure`      | `Y.Map` in nested `Y.Array`   |
| Clefs            | `parts[n].measures[m].clefs[]`              | `PositionedClef[]` | `Y.Array`                     |
| Beams            | `parts[n].measures[m].beams[]`              | `Beam[]`           | `Y.Array`                     |
| Ottavas          | `parts[n].measures[m].ottavas[]`            | `Ottava[]`         | `Y.Array`                     |
| Sequence (voice) | `parts[n].measures[m].sequences[]`          | `Sequence[]`       | `Y.Array`                     |
| Event            | `sequence.content[]`                        | `NoteEvent`        | `Y.Map` in `Y.Array`          |
| Note             | `event.notes[]`                             | `Note[]`           | `Y.Array` of `Y.Map`          |
| Pitch            | `note.pitch`                                | `Pitch`            | `Y.Map`                       |
| Duration         | `event.duration`                            | `NoteValue`        | `Y.Map`                       |
| Tuplet           | `{ type: "tuplet", content, inner, outer }` | `Tuplet`           | `Y.Map`                       |
| Grace            | `{ type: "grace", content }`                | `Grace`            | `Y.Map`                       |
| Tie              | `note.ties[]`                               | `Tie[]`            | `Y.Array`                     |
| Slur             | `event.slurs[]`                             | `Slur[]`           | `Y.Array`                     |
| Repeat start/end | `global.measures[n].repeatStart/End`        | `RepeatStart/End`  | `Y.Map` fields                |
| Ending           | `global.measures[n].ending`                 | `Ending`           | `Y.Map`                       |
| Jump             | `global.measures[n].jump`                   | `Jump`             | `Y.Map`                       |
| Segno/Fine       | `global.measures[n].segno/fine`             | `Segno/Fine`       | `Y.Map`                       |

For the performance-side of the CRDT bridge (patch IR, delta packing, snapshot
cadence) see [collaboration-system.md](./collaboration-system.md) and
[performance-architecture.md](./performance-architecture.md).

### ID strategy

MNX makes `id` optional on most elements. For CRDT collaboration **every**
element needs a stable id. Our approach:

1. On load, assign canonical UUID v7 ids to MNX elements that lack one via the
   single `generateId()` entry point in [`packages/core/src/id.ts`](../../packages/core/src/id.ts).
2. On save, write all ids back to the `.mnx` file (MNX accepts arbitrary string ids). Source-provided ids round-trip unchanged; auto-assigned ids persist so they stay stable across sessions.
3. `_x.viritura` payloads use those same ids when they reference other elements (slur shape overrides reference the slur target id, etc.).
4. Ids are never reassigned during normal editing.

---

## 6. Handling MNX's draft status

MNX is still a draft. Our risk mitigation:

| Risk                            | Mitigation                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MNX spec changes**            | The `@viritura/format` package is the only translation layer; the internal model is decoupled from on-disk serialization. A spec change is a one-package update.                                       |
| **MNX missing features**        | Use `_x.viritura.*` until the spec catches up. Schema-valid and namespaced, so other implementations preserve the data.                                                                                |
| **MNX abandoned**               | Unlikely (W3C-backed, same group as MusicXML, led by Soundslice founder Adrian Holovaty). Even if it stalls, the JSON file is still readable and our parser already owns the canonical interpretation. |
| **Need to store pre-spec data** | `_x.viritura` is the answer. When the spec adopts the feature we add a one-version reader that auto-migrates the field, then drop the legacy path.                                                     |

---

## 7. Git-friendliness

The single-file layout is friendly to `git diff`:

- Measures are written in document order (array index = measure number).
- Parts in score order; events within a sequence in time order.
- JSON keys are serialized in alphabetical order.
- No computed layout data (positions, beam angles, page coordinates) is written.
- `_x.viritura` blocks are sparse — absent properties mean defaults.

Example diff (user forces a system break after measure 4 on the full score):

```diff
--- a/score.mnx
+++ b/score.mnx
@@ -120,7 +120,8 @@
   "scores": [{
     "id": "S-full",
     "pages": [{
       "systems": [
         { "measure": "m1" },
-        { "measure": "m3" }
+        { "measure": "m3" },
+        { "measure": "m5" }
       ]
     }]
   }]
```

---

## 8. Import / export matrix

| Format                       | Import     | Export     | Notes                                                                              |
| ---------------------------- | ---------- | ---------- | ---------------------------------------------------------------------------------- |
| **MNX**                      | ✅ Native  | ✅ Native  | Primary format.                                                                    |
| **MusicXML 4.0**             | ✅ Full    | 🟡 Planned | Importer ships ([`packages/musicxml`](../../packages/musicxml)). Export is queued. |
| **MusicXML 3.1**             | ✅ Full    | 🟡 Planned | Same importer; backward compatible.                                                |
| **MIDI**                     | 🟡 Planned | 🟡 Planned | Not yet wired into the editor.                                                     |
| **PDF**                      | ❌         | 🟡 Planned | Vector export (server-side Skia or client Canvas). Not yet shipped.                |
| **PNG / SVG**                | ❌         | 🟡 Planned | Same renderer path as PDF.                                                         |
| **WAV / MP3**                | ❌         | 🟡 Planned | Render of playback output. Not yet shipped.                                        |
| **MEI / ABC / .musx / .sib** | 🔲 Future  | ❌         | No active work.                                                                    |

For the MusicXML importer's coverage detail, see
[mnx-converter-coverage.md](./mnx-converter-coverage.md).

---

## 9. Decision record

| Decision                                                               | Rationale                                                                                   | Date       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------- |
| Use MNX as the canonical format                                        | Open standard; JSON; semantic-first; designed for native use                                | 2026-02-27 |
| Store pre-spec features in `_x.viritura` blocks                        | Schema-valid, co-located with the object they describe, spec-sanctioned extension mechanism | 2026-03-01 |
| Reject a custom proprietary format                                     | Avoid fragmenting the ecosystem; scores must remain portable                                | 2026-02-27 |
| Reject MEI as the native format                                        | Too verbose (XML); designed for scholarly archival use                                      | 2026-02-27 |
| Reject MusicXML as the native format                                   | Ambiguous encoding; XML overhead; designed for interchange only                             | 2026-02-27 |
| Require stable ids on every MNX element                                | Needed for CRDT collaboration and for `_x.viritura` cross-references                        | 2026-02-27 |
| Project on disk is a single `.mnx` file (optionally inside a git repo) | Matches actual save/load pipeline                                                           | 2026-03-01 |
