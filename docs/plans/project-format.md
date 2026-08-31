# Project file format — design discussions

> **Status:** Exploration. Some sections are concrete proposals (the `.viritura` ZIP container, ready to start); others are open design space (multi-file semantic split). Treat the table of contents as a menu of independently-shippable ideas, not a sequential plan.
>
> **Owner:** TBD
>
> **Related:** [`spec/file-format.md`](../spec/file-format.md), [`plans/git-versioning.md`](./git-versioning.md), [`plans/desktop-delivery.md`](./desktop-delivery.md)

## Sections

1. **`.viritura` ZIP project container** — concrete proposal to unblock Firefox/Safari local-first and provide a single-file project artifact. Ready to start.
2. **Sibling artifacts (PDF, MIDI, audio bounce)** — concrete proposal layered on the container.
3. **Multi-file semantic split** — exploration. Treats a project as a tree of per-(part, measure-range) JSON chunks rather than one big `score.mnx`. Improves diffability and concurrent-merge behavior for collaborative orchestral projects; offers nothing for solo-piano work.

---

## Non-negotiable constraint: no vendor lock-in

Everything in this document is bound by the **"every file must be parseable without Viritura"** principle established in [`spec/file-format.md` §0](../spec/file-format.md). Restated here so it's visible to anyone designing a new container shape or persistence layer:

- The on-disk artifact must be openable by software that has never heard of Viritura.
- A plain `unzip` on a `.viritura` must reveal documented JSON (MNX) and documented open-format payloads (PDF, MIDI, WAV, etc.) — nothing proprietary or encrypted.
- The MNX content inside must round-trip through any standards-compliant MNX reader with all musical content intact (vendor extensions strippable; musical content never hostage to them).
- Performance optimizations (binary caches, indexes, derived data) live alongside but never replace the canonical on-disk artifact, and the file remains readable without them.

This is why every proposal below uses **ZIP with documented inner structure** and **MNX JSON content** — not a custom binary format, even when one would be faster or smaller. The industry's recent history (Finale sunsetted 2024 with files unreadable without a working install; Sibelius subscription-gated; countless DAW projects orphaned by vendor decisions) is the negative example. Users' scores must outlive Viritura.

Any future proposal in this document or its descendants that violates this constraint should be rejected on principle, regardless of technical merit.

---

# 1. `.viritura` ZIP project container

## Problem

Local-first project persistence currently relies on the **File System Access API's directory picker** (`showDirectoryPicker`) to expose a real folder containing `score.mnx` + `.git/`. This is Chromium-only:

- **Firefox** declined to implement `showDirectoryPicker` citing fingerprinting / user-confusion concerns; [no plans to ship](https://mozilla.github.io/standards-positions/#native-file-system).
- **Safari** has no implementation and no public roadmap.

Consequence today: on Firefox or Safari, **the entire local-first git-versioning experience is unavailable**. Users can only work with single in-memory scores or via cloud collaboration. The shipped capabilities documented in [`plans/git-versioning.md`](./git-versioning.md) — versioned commits, branch UI, history sidebar, GitHub push/fetch — are silently gated on browser choice.

## Proposal

Introduce a **single-file project container** with extension `.viritura`. The container is a ZIP archive bundling everything that today lives in the project folder:

```
project.viritura            (ZIP, one OS-level file)
├── manifest.json           { version, createdBy, mimetype, ... }
├── score.mnx               canonical MNX (unchanged byte-for-byte vs. folder mode)
└── .git/                   full isomorphic-git tree
    ├── HEAD
    ├── config
    ├── refs/heads/main
    ├── refs/remotes/origin/main
    └── objects/…
```

This is the same pattern as `.docx` / `.odt` / `.epub` / `.jar` / `.3mf` — a ZIP container with a known internal structure that an application can open, mutate, and re-bundle.

`isomorphic-git` already runs against a virtual filesystem (`@isomorphic-git/lightning-fs` / `memfs`) inside the editor. It doesn't care whether the underlying storage is a real folder, IndexedDB, or a ZIP we unpacked into memory. The new container is a **persistence-layer concern only** — every layer above `FsAdapter` is unchanged.

## What this preserves

The diffability value-prop in [`spec/file-format.md`](../spec/file-format.md) §7 is preserved at every level that matters:

1. **The inner `score.mnx` is byte-for-byte identical to folder mode.** Same alphabetical key order, same document-order arrays, same `_x.viritura` extension layout.
2. **`git push` to GitHub still works.** `isomorphic-git` talks HTTPS to GitHub directly from the app; the _remote_ repository sees a normal git tree with diffable `score.mnx` commits, regardless of whether the local working copy lives in a folder or inside a ZIP. PR diffs on GitHub are unaffected.
3. **Single-file `.mnx` export remains a first-class command.** Anyone who wants a maximally portable, diffable artifact for emailing or committing to an outer repo gets it with one click.

## What this loses

| Loss                                                                                                | Mitigation                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| External CLI `git` can't see inside `.viritura`                                                     | "Export project as folder" command (one-click extract). Chromium users can still pick folder mode at create time. |
| External git GUI tools (GitKraken, SourceTree) can't open it                                        | Same — extract or use folder mode                                                                                 |
| Diff-tool integration in IDEs / GitHub Desktop                                                      | Same                                                                                                              |
| `git log` from terminal on the local file                                                           | In-app history panel covers the case; for true CLI access, export                                                 |
| **Sibling artifacts (PDF, MIDI, audio bounce) not directly reachable** by file managers / consumers | See "Sibling artifacts" below — the trade-off cuts both ways and the plan accommodates both modes                 |

These are real losses for power users on non-Chromium browsers, but they're recoverable via the "export as folder" escape hatch. No data is trapped; the format is open ZIP with a documented layout.

---

# 2. Sibling artifacts (PDF, MIDI, audio)

A folder project has a genuine ergonomic win the container loses: derived artifacts can live **next to** `score.mnx` as ordinary files. A user (or a CI workflow) wanting the PDF just opens the folder and double-clicks it. Drag it into an email. Upload it to a wiki. No tooling needed.

Stuffing those same artifacts **inside** `.viritura` gets you something different and also valuable: **they're git-tracked alongside the score that produced them**. Every commit captures `score.mnx` + the PDF generated from that exact state. `git log` becomes a release timeline. Reverting a commit reverts the rendered output too. This is the same value proposition that makes embedded screenshots-in-Word documents useful (whether you like it or not, they travel with the document).

Both shapes are legitimate; the right answer depends on whether the user thinks of the PDF as a _publication artifact_ (folder mode wins — they want filesystem access to it) or as a _historical record_ (container mode wins — they want it pinned to a commit).

### How the container handles it

The manifest grows an explicit `artifacts/` section so the container, the in-app UI, and any future export tooling all agree on what's in there:

```jsonc
{
  "version": 1,
  "files": { "score": "score.mnx", "git": ".git" },
  "artifacts": {
    "dir": "artifacts/",
    "entries": [
      { "kind": "pdf", "path": "artifacts/score.pdf", "generatedFrom": "score.mnx", "generatedAt": "..." },
      { "kind": "midi", "path": "artifacts/score.mid", "generatedFrom": "score.mnx", "generatedAt": "..." },
    ],
  },
}
```

On-disk layout:

```
project.viritura
├── manifest.json
├── score.mnx
├── artifacts/
│   ├── score.pdf       STORED (PDFs are already DEFLATE-compressed internally)
│   ├── score.mid       STORED or DEFLATE (MIDI is tiny either way)
│   └── score.wav       STORED (PCM compresses badly; FLAC/OGG would be STORED anyway)
└── .git/
```

### UX surface

- **"Export PDF…" command** — works on every project type. On `RawMnxAdapter` and `FolderProjectAdapter`, behaves exactly as it does today (file-save dialog). On `ZipProjectAdapter`, prompts: _"Save PDF to disk, or store inside the project?"_ — first option writes a sibling file outside the container; second writes into `artifacts/` inside the ZIP, registers it in the manifest, and includes it in the next commit.
- **"Extract artifacts…" command** on `.viritura` projects — one-click "give me the latest PDF/MIDI as real files next to the `.viritura`". Matches the folder-mode ergonomic for consumers without forcing the user to fully unpack the project.
- **Auto-generate on save** (opt-in, off by default) — if enabled, every Ctrl+S regenerates the PDF into `artifacts/` so commits always have a current rendered copy. Pairs naturally with container mode (the artifact gets git-tracked); in folder mode it just overwrites the sibling file.

### What folder mode keeps as a win

Folder mode users get **filesystem-native access** to artifacts for free, no "extract" step needed. For users whose workflow is _"render the PDF, drag it into Slack"_, that's strictly better and is one of the reasons folder mode stays a first-class option for Chromium users. The plan doesn't try to paper over this — it accepts it as one of the legitimate reasons someone would pick folder mode over container mode.

## Three persistence modes, side by side

| Mode                  | Browsers      | In-app git | External CLI git | GitHub remote diff | Best for                                                                    |
| --------------------- | ------------- | ---------- | ---------------- | ------------------ | --------------------------------------------------------------------------- |
| **Single `.mnx`**     | All           | n/a        | n/a              | ✅ (the file)      | Publishing on GitHub; sharing with non-Viritura users; quick scratch scores |
| **`.viritura` (ZIP)** | All           | ✅         | ❌               | ✅ (after push)    | Cross-browser portable project with local history                           |
| **Folder + `.git/`**  | Chromium only | ✅         | ✅               | ✅                 | Power users who want real CLI git tooling on the working copy               |

Three independent escape hatches. Users pick based on what they care about for _that_ file. The single-`.mnx` mode is always one click away from any other mode (Export → Plain MNX).

## On-disk format

### Manifest (`manifest.json`)

```jsonc
{
  "mimetype": "application/vnd.viritura.project+zip",
  "version": 1,
  "createdBy": "viritura/0.x.y",
  "createdAt": "2026-05-27T12:34:56Z",
  "files": {
    "score": "score.mnx",
    "git": ".git",
  },
}
```

Reasons to have a manifest at all rather than a bare ZIP:

- **Magic-number robustness.** Sniffing `PK\x03\x04` is necessary but not sufficient — we want to confirm it's _our_ ZIP, not a random one a user renamed. The manifest's `mimetype` field is the same mechanism `.odt` and `.epub` use.
- **Forward compatibility.** A future container version (multiple scores in one project? sample library bundled in?) reads the manifest first and dispatches.
- **Tooling hook.** External tools (the planned diff textconv, the planned `git-viritura` CLI — _out of scope for this plan_) can validate before unzipping the full payload.

### Compression strategy

| Path pattern                       | Method  | Why                                                     |
| ---------------------------------- | ------- | ------------------------------------------------------- |
| `.git/objects/pack/*.pack`         | STORED  | Already zlib-compressed by git; re-deflating wastes CPU |
| `.git/objects/??/*`                | STORED  | Loose objects are already zlib-compressed               |
| `score.mnx`                        | DEFLATE | Raw JSON compresses 3–5×                                |
| `manifest.json`                    | DEFLATE | Tiny but compresses fine; consistency                   |
| Other (`HEAD`, `config`, `refs/…`) | DEFLATE | Tiny text files                                         |

### Detection

Open path sniffs the first 4 bytes of the input:

- `PK\x03\x04` → ZIP. Read central directory, validate `manifest.json` mimetype, unzip into memfs, hand to `GitProjectAdapter`.
- `{` (or any JSON whitespace then `{`) → legacy single MNX. Hand directly to `RawMnxAdapter`.
- Anything else → reject with helpful error.

Folder mode is unchanged; it's a separate code path triggered by `showDirectoryPicker` rather than file input.

## Performance

The "re-bundle the whole ZIP on every save" worry is real in principle but small in practice with three mitigations layered together:

1. **CRC-32 cache for content-addressed git objects.** `objects/ab/cdef…` is named after the SHA-1 of its contents; the file is immutable, so its CRC-32 never changes. Cache `Map<filepath, crc32>` alongside the memfs; on re-bundle, skip CRC recompute for cached entries. Typical commit changes 2–5 of 10,000+ files; CRC work drops by ~3 orders of magnitude.
2. **Bundle only on explicit save**, not per-keystroke. Editor mutations write to memfs (cheap, in-process hashmap). The ZIP is rebuilt only on Ctrl+S, autosave debounce (≥30 s idle), and `beforeunload`. Same model every modern editor uses.
3. **STORED compression for already-compressed git data** (above). DEFLATE only for new text content.

With all three, the re-bundle cost for a Beethoven-5-sized project (~10 MB git tree) stays under ~50 ms on a typical laptop's NVMe — invisible to the user. Profiling will calibrate but no clever streaming or in-place ZIP editing is needed at the sizes we expect.

## Implementation outline

### Phase 1 — Container library

- Pick `fflate` for the ZIP work (smaller, faster than JSZip; sync + async APIs; worker-friendly).
- New package `@viritura/project-container` (or fold into `@viritura/format` — TBD) with:
  - `bundleProject(memfs, options) → Uint8Array` — synchronous re-zip with per-file compression method and CRC cache.
  - `unbundleProject(bytes) → { memfs, manifest }` — inflate ZIP into a LightningFS instance, validate manifest.
  - Manifest schema + validator.
- Unit tests covering: round-trip preservation, manifest validation, CRC cache hit, mixed STORED/DEFLATE, corrupt-input rejection.

### Phase 2 — Adapter

- New `ZipProjectAdapter` in [`apps/editor/src/git/`](../../apps/editor/src/git/) implementing the existing `ProjectAdapter` interface. Internally:
  - Holds a memfs and the bytes of the on-disk ZIP.
  - `writeScore` mutates the memfs, marks dirty, defers re-bundle.
  - On `commit`/`save`, re-bundles via `bundleProject`, writes the new ZIP atomically (temp file + rename via FS Access API on Chromium; download blob on Firefox/Safari).
  - Delegates all git operations to the existing isomorphic-git stack pointed at the memfs.
- `ProjectStore` learns to discriminate `ZipProjectAdapter` from `GitProjectAdapter` only for the "where am I saving to" UI label.

### Phase 3 — Editor wiring

- `useFileSaveActions` learns the ZIP path: re-bundle + write file via `FileSystemFileHandle.createWritable()` (Chromium) or `URL.createObjectURL` download (others).
- `useFolderOpen` becomes `useProjectOpen` and accepts either a folder or a `.viritura` file. Sniff first 4 bytes; dispatch.
- `NewScoreDialog` adds a third project option: "Single-file project (`.viritura`)" alongside "Standalone score (`.mnx`)" and "Folder project". On Firefox/Safari, the "Folder project" option is hidden or shown disabled with an explanatory tooltip.
- "Export → Plain MNX" command exists on all project types; existing `useFileSaveActions` export path is reused.
- "Export → Folder" command on `ZipProjectAdapter` (Chromium-only path): pick a directory, extract the memfs into it. Useful escape hatch when a user later wants CLI git access.
- Recent Projects store now persists `FileSystemFileHandle` for ZIP projects (single-file handles work in IndexedDB the same way directory handles do).

### Phase 4 — Format documentation + interop

- Update [`spec/file-format.md`](../spec/file-format.md) with a new §"Project container" describing `.viritura` alongside the existing single-file `.mnx` description. Document the manifest schema, compression strategy, and detection sniff.
- Add a JSON Schema for `manifest.json` at `packages/format/schemas/viritura-manifest.json` for future external-tool validators.
- Update the decision-record table in `file-format.md` with the new container decision.

### Phase 5 — Outer-git diff driver (optional, separate ship)

For users who commit `.viritura` files into some _outer_ git repo (Dropbox, "all my scores" repo, etc.), `git diff` shows binary-blob nonsense. Ship a tiny textconv driver — `git-viritura-textconv` — distributed via Homebrew / Scoop / Cargo:

```gitconfig
# ~/.gitconfig
[diff "viritura"]
    textconv = git-viritura-textconv
    binary = false
```

```gitattributes
*.viritura diff=viritura
```

The textconv binary unzips `score.mnx` and prints it; `git log -p` on the outer repo now shows meaningful MNX diffs (same trick that makes `.docx` diff usefully when configured).

This phase is **independent** of phases 1–4 and can ship later — it's purely additive convenience for a niche workflow. (Earlier conversation explored shipping a fuller `git-viritura` CLI wrapper for in-place git operations on the container; that's dropped from this plan as overkill — the in-app history UI plus "Export as folder" cover the practical need.)

## Out of scope

- **External CLI git wrapper.** The `git-viritura` subcommand that wraps unzip/git/re-zip was considered and dropped. The "Export as folder" command + the in-app history UI cover the same use cases at much lower maintenance cost.
- **FUSE mount.** Considered and dropped — macOS kernel-extension friction is too high for the audience size.
- **Multi-score projects.** The container format supports it in principle (the manifest could list multiple `score.mnx` paths) but no UI for it ships in this plan. Anchor the v1 manifest to a single score; bump `version` field when multi-score arrives.
- **Embedded sample libraries / soundfonts.** Same — the manifest could grow a `samples/` section, but persistence of playback assets is its own conversation ([`spec/file-format.md`](../spec/file-format.md), playback row).
- **Server-side storage of `.viritura` files.** Cloud collab (Phase 2a) is the canonical multi-device home for projects-with-history; the ZIP container is a local-only artifact and the server has no need to know about it.

## Migration & compatibility

- **No corpus migration needed.** The existing 71 MNX examples in `packages/format/fixtures/mnx/` stay single-file `.mnx`. They're sample/test data, not projects.
- **No format break.** A user with a folder project today keeps using it. The new container is a parallel storage option, never a forced migration.
- **No MNX schema change.** The container wraps `score.mnx` verbatim; the schema in [`packages/format/schemas/viritura-extensions.json`](../../packages/format/schemas/viritura-extensions.json) is unaffected.

## Open questions

1. **Extension naming.** `.viritura` (clear product association, brand-bound), `.mnxz` (analogous to `.docx`/`.xlsx`, format-bound), `.virproj` (descriptive but ugly). Bikeshed before shipping; ZIP magic-byte sniff means extension is mostly cosmetic.
2. **MIME type.** Propose `application/vnd.viritura.project+zip`. Could go through the IANA vendor-tree registration if we care about formal registration.
3. **Manifest version bump cadence.** Reserve `version: 1` for the single-score, single-git-tree layout. Plan to bump to `version: 2` if multi-score or embedded samples arrive — readers fail loudly on unknown major versions and warn on unknown minor extensions.
4. **Save-As-Project upgrade path.** Today [`git-versioning.md`](./git-versioning.md) lists "Save as Project…" as outstanding work for standalone-to-folder upgrades. The same command should grow a "Save as `.viritura`…" branch — design once, ship both targets.
5. **Storage quota.** ZIP projects in the Recent Projects IndexedDB store can grow large (full git history); the existing handle-only persistence is fine because handles are small, but if we ever cache contents we need an LRU or quota-aware eviction. Not urgent.
6. **Artifact regeneration policy.** If `auto-generate on save` is on and the user reverts to an old commit, do we (a) trust the artifact stored at that commit, (b) regenerate from `score.mnx` at that commit and diff against the stored artifact (warning if they disagree — e.g. engine version drift), or (c) always regenerate and ignore the stored copy? Default (a) keeps history honest; (b) is nice for debugging engine regressions; (c) defeats the purpose of storing artifacts at all.
7. **Artifact size budgeting.** A 100-page orchestral score's PDF can be 5–20 MB; storing one per commit blows up the git tree quickly. Mitigation candidates: store artifacts in a separate orphan branch (like `gh-pages`), use git-lfs-style pointers, or simply make artifact regeneration opt-in per save with manual "snapshot artifacts" command for milestone commits.

## Sequencing relative to other work

- **Blocks nothing critical.** The shipped folder-mode workflow is fully functional on Chromium.
- **Unblocks the local-first git story on Firefox and Safari**, which is currently silently unavailable.
- **Should land before** any messaging that positions Viritura as "works in every modern browser with full history". Today that claim is false on Firefox/Safari for the history feature.
- **Independent of** the MNX-schema-versioning, condensing-rework, and engrave-mode plans.

---

# 3. Multi-file semantic split (exploration)

> **Status:** Open design space, no commitment to ship. Captured here because the question "would multi-file improve git diffs?" keeps coming up and deserves a written answer to refer back to.

Instead of one `score.mnx` (whether on disk directly or inside a `.viritura`), the project stores its content as a tree of small JSON files chunked along musical boundaries:

```
project/                       # folder OR inside .viritura
├── manifest.json              # version + file index
├── score.mnx                  # global metadata, parts header, layouts, cross-cutting refs
├── parts/
│   ├── violin-1/
│   │   ├── m0001-m0032.mnx    # JSON array of part-measure objects
│   │   ├── m0033-m0064.mnx
│   │   └── m0065-m0096.mnx
│   ├── violin-2/...
│   └── viola/...
├── global/
│   ├── time-signatures.mnx
│   ├── tempos.mnx
│   └── key-signatures.mnx
└── .git/
```

The in-memory model (what the engine + editor consume) is unchanged — a single fully-assembled MNX document. On open, the chunks are merged. On save, the assembled document is sliced back into chunks. **Spec-compliant `.mnx` is generated on demand** via an "Export single `.mnx`" command for sharing or interop.

## Why this is cheaper than it looks

The slicing algorithm already exists. The [diff engine](../../apps/editor/src/diff/) decomposes scores into per-(part, measure) chunks via [`stableStringify` + LCS alignment](../../apps/editor/src/diff/measureAlign.ts) — same algorithm, different output target. We'd be exposing the diff engine's internal chunking as a persistence-layer view rather than reinventing it.

Because chunks are **mechanical** — no symbolic IDs, no JSONC comments, no shorthand sugars, no human file-grouping choices — the round-trip between assembled `score.mnx` and chunk tree is **lossless and deterministic**. There's no "ugly auto-organized import" problem. Any spec `.mnx` can be sliced into chunks and reassembled byte-for-byte identical.

## Why it's not a free win

The diffability gain is **concentrated in specific edit patterns**, not uniform:

| Edit pattern                                       | Single-file MNX                                                                  | Multi-file split                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Change one pitch / duration / dynamic              | clean diff                                                                       | clean diff (no gain)                                                                       |
| Add slur, articulation, tempo within a region      | clean diff                                                                       | clean diff (no gain)                                                                       |
| Bulk pass on one part (transpose, articulate all)  | scattered hunks, correct, large                                                  | scattered hunks, but **file tree telegraphs "only vln 2 touched"** before opening any diff |
| Insert / delete a measure globally                 | Myers handles correctly; some sliding risk if measure resembles existing content | one inserted entry per file, no sliding                                                    |
| **Reorder parts**                                  | **delete-block + insert-block — semantic lost**                                  | **manifest line change; clean**                                                            |
| **Replace a repeated motif with a varied version** | **Myers may produce nonsense alignment due to sliding on shared boundary notes** | **per-chunk file isolates the change; no sliding**                                         |
| Cross-part slur (vln 1 → vln 2)                    | one diff, both ends visible together                                             | edits in two files OR a cross-cutting file; reviewer context-switches                      |
| **Concurrent edits to different parts** (collab)   | **false merge conflicts when adjacent lines belong to different parts**          | **different files = automatic merge, no conflict**                                         |
| Concurrent edits to the same element               | genuine conflict, human resolves                                                 | genuine conflict, human resolves (no gain)                                                 |
| Whitespace / key-sort / formatting churn           | catastrophic                                                                     | catastrophic (no gain)                                                                     |

The wins concentrate in three places: **reorders, sliding-risk replacements, and concurrent-collaboration merges**. The cross-cutting case (slurs, score-wide rules) is the one place split actively _loses_.

## Real-world implication

- **Solo piano, lead sheet, single-author song-style:** split offers nothing meaningful. The win-rate is zero in the common edit patterns for these projects.
- **Mid-large ensemble, single author:** modest gains, mainly reorder-cleanliness and the file-tree-as-summary signal during PR review.
- **Multi-author collaboration on the same project:** the concurrent-merge story alone may justify split — three-way merges in single-file JSON produce false conflicts often enough to erode the PR workflow over time. Split makes "different parts merge automatically" a structural guarantee, not a probabilistic outcome.
- **Orchestral with movements, multiple authors:** split is essentially required if PR-based collaboration is the intended workflow.

## What `score.mnx` would still hold in split mode

Not everything moves to per-(part, measure) files. The top-level `score.mnx` retains:

- `mnx` version block
- `global` non-measure data (style, page setup, layouts catalog)
- `parts` array headers (name, instrument, transposition) — but with the heavy `measures` payload elided in favor of file refs
- Cross-cutting things that span parts: cross-staff slurs, cues, condensing references
- A manifest of which chunk files exist and their ranges

This is the place where decisions get tricky. Cross-cutting features (cross-part slurs are the canonical example) have to live _somewhere_; splitting them awkwardly creates the cross-file-edit cost that erodes the diffability win. The realistic answer is probably "cross-cutting features stay in `score.mnx` and accept that an edit to a cross-part slur touches the parent file plus the two endpoint chunks", which is fine.

## How chunks would actually be referenced

Two viable shapes:

1. **Manifest-driven** — `score.mnx` contains an explicit `"$chunks": { "parts[0].measures": ["parts/violin-1/m0001-m0032.mnx", ...] }` map. Reader inflates by string-substituting chunks for refs. Explicit and discoverable.
2. **Convention-driven** — no refs in `score.mnx`; the loader globs `parts/*/m*.mnx` and assembles by naming convention. Simpler files, less robust to renames.

Leaning toward (1) because explicit refs survive partial reads, broken filesystems, and tools that want to validate the manifest before parsing chunks.

## Sequencing if we ever ship this

This should **not** be shipped before the basic `.viritura` ZIP container (§1). Order:

1. ZIP container with single inner `score.mnx` (§1) — solves the Firefox/Safari blocker, ships independently.
2. Sibling artifacts (§2) — orthogonal capability, ships when PDF export ships.
3. _(Maybe)_ multi-file split as an **opt-in project template** — "New collaborative orchestral project" picks split layout; "New lead sheet" picks single. The container holds either layout transparently; the inner structure is the only difference.

Deferring §3 until after §1 ships has two benefits: we learn from real `.viritura` usage whether the diffability complaints justify split (today the demand is speculative), and the chunking algorithm gets more bake time in its current diff-engine role before being promoted to a persistence-layer concern.

## What this is NOT proposing

- **Not a new authoring source format.** Chunks are vanilla MNX JSON, no comments, no shortcuts, no symbolic IDs. Anyone who opens a chunk file in a text editor sees the same MNX they see today, just smaller.
- **Not a replacement for `.mnx`.** Single-file `.mnx` remains a first-class output ("Export single `.mnx`") and the default for small/casual projects.
- **Not a change to the MNX spec.** Splitting is a Viritura persistence convention. Spec MNX is what you get when you export.
- **Not a path toward hand-authored text source.** That's a separately worthwhile conversation (sugar, comments, symbolic IDs, lockfile-stabilized UUIDs), parked indefinitely. It would layer on top of the chunked format if ever pursued, but is not required for the diffability wins documented above.

## Open questions if we ever pursue this

1. **Chunk granularity.** Per-32-measures? Per-rehearsal-section? User-configurable? Granularity affects which edits land in which file. Too coarse → still some sliding. Too fine → many tiny files, ZIP-entry overhead dominates.
2. **Chunk boundary stability under measure insert/delete.** If chunks are `m0001-m0032.mnx` and a measure is deleted, do file names update (causing file renames)? Or do chunks become `m0001-m0031.mnx`? Or do we leave gaps and let chunks grow/shrink to whatever measures they contain? Each has trade-offs for git rename detection.
3. **Cross-cutting feature housing.** Cross-part slurs in `score.mnx` (centralized, parent file changes often) vs. in cross-cutting feature files (`cross-part/slurs.mnx`) vs. duplicated on each endpoint (a sync hazard). The right choice probably differs per feature; ties (same-part) go in chunks, slurs (cross-part) go centralized.
4. **Validator surface.** The MNX validator runs against the assembled document. Should it ALSO run against individual chunks for early errors? Probably yes for tooling DX, but chunk-level schema is a strict subset of full-document schema and needs definition.
5. **Streaming / partial load.** Could the editor load chunks on demand to support arbitrarily large scores? Possibly, but the engine assumes whole-document layout today. Not a near-term concern.

---

## References

- Current persistence: [`apps/editor/src/git/`](../../apps/editor/src/git/), [`apps/editor/src/app/useFolderOpen.ts`](../../apps/editor/src/app/useFolderOpen.ts), [`apps/editor/src/app/useFileSaveActions.ts`](../../apps/editor/src/app/useFileSaveActions.ts)
- Diff engine chunking algorithm: [`apps/editor/src/diff/measureAlign.ts`](../../apps/editor/src/diff/measureAlign.ts), [`apps/editor/src/diff/semanticDiff.ts`](../../apps/editor/src/diff/semanticDiff.ts)
- Git stack: [`plans/git-versioning.md`](./git-versioning.md)
- Format spec: [`spec/file-format.md`](../spec/file-format.md)
- ZIP library candidate: [fflate](https://github.com/101arrowz/fflate)
- Pattern precedents: OOXML (`.docx`), OpenDocument (`.odt`), EPUB, 3MF, JAR
