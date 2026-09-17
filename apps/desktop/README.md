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
installer. Do not call `build:prebuilt` directly unless those outputs were already
prepared with `pnpm build:desktop:frontend`.

The direct package command remains self-contained:

```sh
pnpm --filter @viritura/desktop build
```

It runs Tauri's normal `beforeBuildCommand` (`pnpm -w run build:desktop:frontend`)
before bundling. Both entry points use the same repository script to prepare WASM
and build the editor and its dependencies through Turbo. The script sets
`VIRITURA_EXTERNAL_SOUNDFONT=true` only in its child environment, before Turbo
computes the editor cache key. No CI-only environment setup is needed, and the
prebuilt path skips the hook rather than preparing the frontend twice.
Preparation also removes any frontend SF2 left by an earlier browser build after
Turbo completes, including cache hits where Vite's output hook does not run.

For direct package `dev` and `build`, the engine is compiled to WASM (canonically into
`engine/viritura-wasm/pkg-browser/`, then staged in
`apps/editor/public/wasm/`, a
gitignored generated artifact) as part of both commands, so a clean checkout
builds and runs without a separate `pnpm wasm:build` step. The build is
content-hash cached — it recompiles only when the Rust engine sources change.

### Offline soundfont

Desktop installers bundle `Shan-SGM-Pro-15.sf2` once as a native resource, not a
second copy in the editor's `dist/sounds`. Native playback and WebAudio playback
share that resource: WebAudio receives its bytes through the fixed, binary
`desktop_soundfont_bytes` Tauri command. The command accepts no caller-supplied
path and does not expose a general asset protocol or broaden filesystem access.
Soundfont loading works offline without an asset CDN.

The native path command (`vst_soundfont_path`) and binary command use the same
resolver: the installed resource is preferred, with a repository soundfont fallback
only in debug builds when the resource is absent. Missing or invalid data produces
an explicit sound-library warning, never a CDN fallback. WebAudio retains one
binary buffer for playback and previews across audio-mode changes; transferring
the font does not serialize it as a JSON array or base64.

Browser builds retain their existing local soundfont behavior,
and hosted browser builds retain their separately configured CDN externalization.
Desktop preview CI does not inject hosted API or asset URLs.

## Windows preview downloads

The [rolling desktop preview](https://github.com/Viritura/Viritura/releases/tag/desktop-preview)
provides **Windows x64 only** installers: `Viritura-windows-x64.exe` (NSIS)
and `Viritura-windows-x64.msi`. Install either one, not both.
These are **unsigned prereleases**, not stable releases. Windows SmartScreen may
warn, and organization policies may block installation. Updates are manual; this
workflow does not configure an automatic updater. Preview builds keep the app
version in source, so uninstall an older preview first if Windows refuses replacement.

`.github/workflows/desktop-preview.yml` runs after every push to `main`, including
PR merges and direct pushes. It uses Node 24, the repository-pinned pnpm version,
Rust 1.93.1, and wasm-pack 0.14.0, hydrates Git LFS resources, tests the desktop
crate, and runs the canonical `pnpm build:desktop`. The soundfont is bundled once
as a native resource rather than duplicated in the web assets.

Only the separate publishing job receives `contents: write` through the built-in
`GITHUB_TOKEN`; no signing credentials or additional secrets are required.
The `desktop-preview` tag points to the built commit, also recorded in the release
notes. Both installers replace the previous assets; this does not create a
versioned release for each merge or change the stable “latest release.”

Runs are serialized without cancelling an active publisher. GitHub may coalesce
pending runs, and a build is skipped at publication if `main` has already advanced,
so an older rerun cannot overwrite a newer preview. The release is temporarily
hidden as a draft during replacement and stays a draft if publishing fails;
partial or mixed installer sets are not published. A failed build leaves the
previous release untouched. Installers are also retained as workflow artifacts
for seven days.

For recovery, run **Desktop Preview** using **Run workflow** with branch `main`
(other branches are ignored). Repository policy must allow Actions to write
releases and move the `desktop-preview` tag; release immutability must not apply
to this rolling prerelease. The workflow deliberately fails rather than replacing
an unrelated release or an orphaned tag with that name.

## Notes

- **`src-tauri` is a standalone Cargo crate** (its own `[workspace]`), kept out
  of `engine/Cargo.toml` so the WASM engine build and the desktop shell stay
  decoupled.
- **COOP/COEP** are set in `tauri.conf.json` under `app.security.headers`; the
  editor requires cross-origin isolation for its WASM layout worker.
