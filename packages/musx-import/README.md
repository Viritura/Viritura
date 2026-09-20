# `@viritura/musx-import`

Browser and Tauri-webview adapter for converting Finale MUSX files to standard
MNX with Denigma WebAssembly.

The generated runtime comes from a pinned revision of
[`openmusx/denigma`](https://github.com/openmusx/denigma). Run this from the
repository root to download that revision's CI-built `denigma-wasm` artifact,
verify its embedded commit, run a conversion smoke test, and stage the assets:

```powershell
pnpm build:denigma-wasm
```

If the commit artifact is unavailable or expired, the command builds Denigma's
own `denigma_wasm` target from source in the pinned Emscripten Docker image. Use
`pnpm build:denigma-wasm:source` to exercise that fallback explicitly.

The generated module, WASM binary, source revisions, hashes, and upstream
licenses live in `assets/`. Vite stages the runtime under `/denigma/`; conversion
runs in a dedicated Web Worker.

Imports are bounded by archive-size, entry-count, expansion-ratio, decoded-score,
WASM-memory, and conversion-time limits before untrusted MUSX data can exhaust
the editor process.

```ts
import { convertMusxToMnx } from "@viritura/musx-import";

const result = await convertMusxToMnx(await file.arrayBuffer(), file.name, {
  includeTempoTool: true,
});

for (const gap of result.gapReport.gaps) {
  console.log(gap.type, gap.anchor, gap.extent);
}

for (const outcome of result.gapOutcomes) {
  console.log(outcome.type, outcome.subtype, outcome.disposition, outcome.reason);
}
```

The result includes standard MNX, Denigma diagnostics, and the versioned
structured conversion-gap report produced by Denigma. Viritura applies its
supported schema-v1 adapters in the worker and returns one outcome for every
source gap. The consuming editor validates the adapted document against the
MNX and Viritura extension schemas before loading it. Gap payloads use stable
target MNX IDs as anchors. Unknown fields and gap types remain visible as
unhandled outcomes and import diagnostics rather than being silently
discarded.

The current schema-v1 adapters preserve:

- score-wide chord roots, slash bass notes, normalized qualities, common
  extensions, authored text, and a plain display override for complex Finale
  chord suffixes;
- recognized per-note notehead families (`normal`, X, diamond, slash,
  circle-X, and triangles);
- generic expressive text and performance instructions as plain text
  expressions;
- rehearsal marks;
- tempo text, metronome visibility, and playback-only tempo visibility;
- ordinary straight and standard wavy glissandos with one plain center label;
- trill symbols and event-anchored trill-extension spans.

Chord-suffix typography and visibility flags, arbitrary notehead glyphs and
explicit fills, formatting runs, performance-technique playback semantics,
multiple rehearsal marks in one measure, separate displayed/playback metronome
values, note-specific chord endpoints, custom/dashed/invisible lines, and tab
slides remain explicit partial or unhandled outcomes.

### Global harmony and source pitch

Chord events are written only to
`global.measures[n]._x.viritura.chordSymbols`. Source parts receive
`_x.viritura.chordSymbolVisibility: "show"` (including previously hidden parts);
no part-measure chord arrays or per-chord display-staff fields are created.
Incoming events replace only matching exact rational positions. Multiple source
parts/staves coalesce into one harmony stream: the topmost part, then topmost
staff, wins regardless of gap order. Equivalent harmony is silent; discarded
different harmony is reported through import diagnostics.

The pinned Denigma revision classifies both chord roots and slash basses as
**written** pitches (`KeyContext::Written` in
[`mnx_chords.cpp`](https://github.com/openmusx/denigma/blob/5864f4eb358dafabc06c7448ead5c16fd6481776/src/formats/mnx/mnx_chords.cpp)).
The adapter negates the **source** MNX part's sounding-to-written
`transposition.interval` to store concert harmony, preserving diatonic spelling.
Absent transposition means unison; `prefersWrittenPitches` does not change this
source representation. No destination instrument or display preference is used.
This assumes Denigma's part-level interval describes all chord-bearing staves
and measures in that part; the schema-v1 gap payload supplies no separate
staff-specific or time-varying transposition metadata.

The shared core resolver distinguishes supported harmony, silent `NC`/`N.C.`,
and unsupported syntax. Unsupported symbols retain `rawText` and produce a
warning rather than being simplified into playable major chords. Recognizable
roots and slash basses in unsupported text are also converted to concert pitch.
Malformed source transposition, rhythmic positions, and existing global chord
containers fail structurally rather than being swallowed as harmony warnings.
