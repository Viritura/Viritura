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
```

The result includes standard MNX, Denigma diagnostics, and the versioned
structured conversion-gap report produced by Denigma. Gap payloads use stable
target MNX IDs as anchors. Consumers must dispatch on `type`, tolerate unknown
fields and gap types, and preserve unhandled gaps in import diagnostics rather
than silently discarding them.
