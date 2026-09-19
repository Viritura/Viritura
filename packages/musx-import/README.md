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

- generic expressive text and performance instructions as plain text
  expressions;
- rehearsal marks;
- tempo text, metronome visibility, and playback-only tempo visibility;
- ordinary straight and standard wavy glissandos with one plain center label;
- trill symbols and event-anchored trill-extension spans.

Formatting runs, performance-technique playback semantics, multiple rehearsal
marks in one measure, separate displayed/playback metronome values,
note-specific chord endpoints, custom/dashed/invisible lines, and tab slides
remain explicit partial or unhandled outcomes.
