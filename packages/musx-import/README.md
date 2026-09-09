# `@viritura/musx-import`

Browser and Tauri-webview adapter for converting Finale MUSX files to standard
MNX with Denigma WebAssembly.

The generated runtime is built from a pinned revision of
[`rpatters1/denigma`](https://github.com/rpatters1/denigma). Run this from the
repository root to clone that revision, compile the public `denigma::mnx`
converter through a small Viritura-owned C ABI in a pinned Docker image, run a
WASM smoke test, and stage the resulting assets:

```powershell
pnpm build:denigma-wasm
```

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
```

The current upstream wrapper returns standard MNX and Denigma diagnostics. It
does not yet expose the proposed structured conversion-gap manifest.
