# @viritura/desktop

A [Tauri v2](https://v2.tauri.app) desktop shell that wraps the Viritura web
editor (`@viritura/editor`) in a native window.

The shell keeps the engraving engine in WASM and adds native capabilities that
are unavailable in a browser:

- a native, installable window (no browser chrome);
- cross-origin isolation headers (`COOP`/`COEP`) so the editor's
  `SharedArrayBuffer` (WASM threads) works under the Tauri asset protocol;
- VST3 plugin scanning and hosting;
- native SF2/VST playback, mixing, and convolution reverb;
- sandboxed Lua articulation mapping; and
- filesystem-backed instrument profiles.

The web build continues to ship in parallel; nothing here changes the editor.

## Layout

```
apps/desktop/
  package.json         @viritura/desktop — Tauri CLI + scripts
  src-tauri/
    Cargo.toml         standalone crate (not part of engine/ workspace)
    tauri.conf.json    dev → editor Vite :5173; build → apps/editor/dist
    build.rs
    capabilities/      Tauri v2 capabilities (default)
    icons/             app icons
    src/
      main.rs          entry point
      lib.rs           Tauri builder
```

## Develop

Requires the Rust toolchain (plus `wasm-pack` / the `wasm32-unknown-unknown`
target for the engine build) and, on Windows, WebView2 (preinstalled on Windows
11). From the repo root:

```sh
pnpm install
pnpm --filter @viritura/desktop dev
```

`tauri dev` runs `beforeDevCommand`, which first builds the WASM engine
(`pnpm -w run wasm:build`) and then starts the editor Vite dev server on
`http://localhost:5173`, and opens the native window pointing at it.

## Build

```sh
pnpm build:desktop
```

The root command prepares WASM and the editor once, then calls the package-local
`build:prebuilt` Tauri command to bundle `apps/editor/dist` into a native
installer. Do not call `build:prebuilt` directly unless those outputs already
exist.

The direct package command remains self-contained:

```sh
pnpm --filter @viritura/desktop build
```

It runs Tauri's normal `beforeBuildCommand` (`pnpm -w run wasm:build && pnpm
--filter @viritura/editor build`) before bundling.

For direct package `dev` and `build`, the engine is compiled to WASM (canonically into
`engine/viritura-wasm/pkg-browser/`, then staged in
`apps/editor/public/wasm/`, a
gitignored generated artifact) as part of both commands, so a clean checkout
builds and runs without a separate `pnpm wasm:build` step. The build is
content-hash cached — it recompiles only when the Rust engine sources change.

## Notes

- **`src-tauri` is a standalone Cargo crate** (its own `[workspace]`), kept out
  of `engine/Cargo.toml` so the WASM engine build and the desktop shell stay
  decoupled.
- **COOP/COEP** are set in `tauri.conf.json` under `app.security.headers`; the
  editor requires cross-origin isolation for its WASM layout worker.
