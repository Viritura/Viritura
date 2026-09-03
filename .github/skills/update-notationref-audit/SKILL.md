---
name: update-notationref-audit
description: Refresh the W3C notationref taxonomy and format matrices, then source-audit affected Viritura MNX and MusicXML/MXL coverage rows.
---

# Update the Music Notation Reference audit

Use this skill when asked to update, refresh, or re-audit
`docs/spec/music-notationref-coverage.md` or the `/mnx/feature-support` page.

The update has two distinct owners:

- The repository script synchronizes W3C-owned taxonomy, names, grouping, and
  MNX/MusicXML status levels.
- The agent audits Viritura-owned MNX-pipeline and MusicXML/MXL-importer status
  against current implementation source.

Never infer Viritura support from old documentation or from schema acceptance
alone.

## 1. Preview upstream drift

Run:

```powershell
pnpm notationref:preview
```

The JSON report identifies:

- `added`: new taxonomy IDs that need both Viritura surfaces audited
- `removed`: local rows no longer present upstream
- `renamed`: display-name changes
- `moved`: taxonomy path changes
- `upstreamStatusChanged`: MNX or MusicXML level changes
- `matrixOnlyIds`: format entries not present in the visible taxonomy
- `matrixMissingIds`: visible taxonomy rows absent from a format matrix

The preview does not write files.

## 2. Synchronize upstream-owned data

Run:

```powershell
pnpm notationref:update
```

The updater fetches exact commits from:

- `w3c-cg/music-notationref` `main` (`concepts.json`)
- `w3c-cg/mnx` `main` (`docs/notationref.json`)
- `w3c-cg/musicxml` `gh-pages` (`notationref.json`)

It updates the recorded upstream revisions, taxonomy paths/names, upstream
statuses, totals, and group summaries. Existing Viritura statuses and partial
reasons are preserved by concept ID.

New concepts are deliberately written as `?` for both Viritura surfaces with a
`Semantic gap` review marker. Do not leave those markers unresolved.

## 3. Determine the Viritura audit scope

Read the `virituraCommit` from the audit's
`notationref-audit-meta` comment. Compare that revision with the current source:

```powershell
$previous = "<virituraCommit>"
git diff --name-only "$previous..HEAD" -- engine packages apps/editor
```

Audit every new taxonomy row plus concepts affected by changed implementation.
Trace the complete relevant path:

- TypeScript MNX parser/serializer and core model
- Rust promotion/model/layout/rendering
- MusicXML/MXL converter
- focused tests, fixtures, and stories

Use existing docs only as search leads. A symbol or model field alone is not
proof of meaningful support.

## 4. Update only Viritura-owned assessments

For each affected row, update:

- `Viritura MNX`
- `Viritura MXL`
- `Viritura partial gap`

Use `S`, `P`, `N`, `NA`, or `?` consistently with the document legend.

Every Viritura `P` or `?` must include a concise durable reason:

```text
Viritura MXL [Lossy]: Decimal alterations are rounded to semitones
```

Allowed reason categories:

- `Subset`
- `Approximation`
- `Lossy`
- `Extension required`
- `Fixed style`
- `Semantic gap`

Describe behavior and the remaining gap. Do not add source paths, line numbers,
or evidence keys; those become stale and can be rediscovered during future
work.

Do not add local descriptors for upstream MNX or MusicXML statuses.

## 5. Record the audited Viritura revision

The Viritura implementation being audited must be committed and the relevant
source directories must be clean before finalizing the revision. Then run:

```powershell
$revision = git rev-parse HEAD
pnpm notationref:update -- --viritura-revision $revision
```

This updates `virituraCommit` and `virituraAuditedAt`. If implementation source
has uncommitted changes, do not claim `HEAD` as the audited revision.

## 6. Validate

Run:

```powershell
pnpm notationref:test
pnpm --filter @viritura/website test
pnpm --filter @viritura/website build
pnpm lint
```

Confirm:

- every visible taxonomy ID appears exactly once
- summary totals equal detail rows
- every Viritura `P`/`?` has a categorized partial reason
- no other row carries a partial reason
- `/mnx/feature-support` prerenders
- local filters do not pollute copied URLs
- concept hashes still open the correct accordion row

## 7. Report

Summarize:

- upstream revisions before and after
- added, removed, renamed, and moved concepts
- upstream status changes
- Viritura status changes by surface
- unresolved rows, if any
- updated aggregate totals
