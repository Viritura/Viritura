# Local development workflow

This page is the operational reference for installing the repository, running
validation, using build caches, and deploying already-validated artifacts.

## Initial setup

Prerequisites:

- Node.js 22 or newer;
- pnpm 9 through Corepack;
- the Rust toolchain pinned by `engine/rust-toolchain.toml`;
- `wasm-pack` and the `wasm32-unknown-unknown` target; and
- the .NET 10 SDK for API work.

From the repository root:

```bash
corepack enable
corepack pnpm install
cargo install wasm-pack
cargo install cargo-watch
rustup target add wasm32-unknown-unknown
corepack pnpm wasm:build
```

`pnpm install` runs the `prepare` script, which points Git's
`core.hooksPath` at the versioned `.githooks` directory. Reinstall or verify the
hooks explicitly with:

```bash
pnpm hooks:install
git config --get core.hooksPath
```

The expected hook path is `.githooks`.

## Daily commands

| Task                                                | Command                               |
| --------------------------------------------------- | ------------------------------------- |
| Start the interactive service picker                | `pnpm tsx scripts/dev.ts`             |
| Start editor, website, Storybooks, and WASM watcher | `pnpm dev:all`                        |
| Run JavaScript and TypeScript tests                 | `pnpm test`                           |
| Run the full Rust engine suite                      | `pnpm test:rust`                      |
| Run one Rust test                                   | `pnpm test:rust <test-name>`          |
| Run the Rust WASM binding tests                     | `pnpm test:rust:wasm`                 |
| Run the desktop Rust tests                          | `pnpm test:desktop`                   |
| Run the VST probe tests                             | `pnpm test:vst-probe`                 |
| Run the .NET solution tests                         | `pnpm test:dotnet`                    |
| Run the complete lint gate                          | `pnpm lint`                           |
| Run all non-browser release checks                  | `pnpm validate`                       |
| Run functional browser tests                        | `pnpm e2e`                            |
| Build the TypeScript workspace                      | `pnpm build` / `pnpm build:ts`        |
| Build the Rust workspace                            | `pnpm build:rust`                     |
| Build WASM when inputs changed                      | `pnpm build:wasm` / `pnpm wasm:build` |
| Force a WASM rebuild                                | `pnpm wasm:build:force`               |
| Build the .NET solution and server UI               | `pnpm build:dotnet`                   |
| Build the desktop app                               | `pnpm build:desktop`                  |
| Build the local API container image                 | `pnpm build:api-image`                |
| Build a VSIX                                        | `pnpm build:vsix`                     |
| Assemble the deployable static site                 | `pnpm build:site`                     |
| Build all core language ecosystems                  | `pnpm build:all`                      |

`pnpm test` covers the JavaScript and TypeScript workspace only. Run
`pnpm validate` before opening a pull request to include strict Rust and .NET
gates, every unit-test graph, all dependency lockfile audits, the generated
WASM build, and the deployable site build. Browser E2E tests remain a separate
`pnpm e2e` step because they require the worktree services to be running; their
CI profile is tracked separately from the non-browser gate.

`pnpm test:rust` owns an atomic PID lock under `engine/target`. A second full
suite exits instead of competing for Cargo artifacts or process-global test
state. Use this command for full and focused engine tests rather than creating
an alternate `CARGO_TARGET_DIR`.

The editor and website bundle with **Vite 8** (Oxc transform + Rolldown
optimizer). The React Compiler runs through Babel via `@rolldown/plugin-babel`
with `@vitejs/plugin-react`'s `reactCompilerPreset()`; see
`apps/editor/vite.config.ts`. `.npmrc` sets `virtual-store-dir-max-length`
so pnpm's virtual-store paths stay under the Windows `MAX_PATH` limit in deep
worktree checkouts — keep it when working from nested worktree directories.

## Parallel worktrees (Docker + Traefik)

To develop several Git worktrees at once without port collisions, run each
worktree's selected stack in containers behind a single shared Traefik proxy.
Each worktree has isolated API data, dependency caches, internal service DNS,
and `*.<slug>.localhost` routes with no per-worktree host ports:

```powershell
./infra/dev/worktree.ps1 up        # core: editor + hot-reload API
./infra/dev/worktree.ps1 up backend
./infra/dev/worktree.ps1 up full   # website + API + editor + all Storybooks
./infra/dev/worktree.ps1 status
./infra/dev/worktree.ps1 down
```

Chromium browsers resolve `*.localhost` to `127.0.0.1` automatically, so no
`hosts` edits are needed. VS Code ships matching tasks
(`Viritura: Worktree Core (Docker/Traefik)` and friends) so agents can start a
worktree without a terminal. Browser-facing variables use routed public URLs;
container-to-container variables use Compose DNS such as `http://api:8080`.
Full profile, environment, persistence, and cleanup reference:
[`infra/dev/README.md`](../../infra/dev/README.md).

UI-capable worktree profiles automatically build missing or stale WASM through a
one-shot Docker builder with isolated Cargo and wasm-pack caches. A fresh
worktree does not require a host dependency install before `worktree.ps1 up`.

## Build caches

### Cargo

All native builds, tests, Clippy runs, code generation, and WASM compilation
share `engine/target`. Do not create task-specific `target-*` directories. The
development and test profiles use incremental compilation with line-level debug
information to reduce Windows PDB size and linking cost.

If a Windows linker reports a corrupt PDB, stop every Cargo process and delete
only the named corrupt output. Do not create a permanent alternate target as a
workaround. Use `cargo clean` only when the shared cache is genuinely invalid;
it discards the most valuable local build cache.

### WASM

`pnpm wasm:build` hashes the Rust engine/WASM sources, Cargo manifests and lock
file, Rust configuration, `rustc -Vv`, and the `wasm-pack` version. It invokes
`wasm-pack` only when that digest changes or an expected output is missing. The
marker lives beside the ignored generated package at
`engine/viritura-wasm/pkg-browser/.build-cache.json`.

Use `pnpm wasm:build:force` after changing external tooling that is not part of
the recorded inputs or when diagnosing a suspected stale artifact.

### Turbo and site assembly

`pnpm build:site` first refreshes the content-hashed WASM producer, runs the
website, editor, and public MNX Storybook through Turbo, then copies their
declared outputs into root `dist`. Turbo keys include canonical shared assets,
the site mode, WASM input digest, API and asset base URLs, and the
external-SoundFont setting. Repeating an unchanged site build should restore
package outputs from `.turbo` and only redo the inexpensive root assembly.
The assembled MNX hub and playground live under `dist/mnx`; the MNX Storybook
is nested at `dist/mnx/examples`.

`pnpm build:desktop` prepares WASM and the editor exactly once, then invokes the
Tauri command that consumes `apps/editor/dist`. Direct
`pnpm --filter @viritura/desktop dev` and `build` remain reliable from a clean
checkout: Tauri's normal lifecycle hooks prepare those dependencies themselves.
The package-local `build:prebuilt` command is reserved for root orchestration.

`pnpm build:vsix` similarly prepares WASM, restores/builds the extension host
and webview through Turbo, stages declared extension media, and packages the
VSIX without rerunning those producers.

Do not edit package `dist`, Storybook static output, or generated WASM by hand.

## Git quality gates

The versioned hooks divide validation by cost:

- **pre-commit** checks staged formatting and runs language-specific lint for
  the staged file categories;
- **pre-push** runs complete `pnpm lint` and Git LFS pre-push.

The pre-push lint covers whole-tree checks that staged-file validation cannot:
Knip export analysis, generated schema drift, repository structure, and local
formatting exclusions. Builds and test suites run in pull-request CI.
`git push --no-verify` remains an explicit emergency bypass; it should not be
part of the normal workflow.

## Production deployments

Production deployments run through the manual **Deploy website**, **Deploy
editor**, and **Deploy API** workflows in GitHub Actions. Each static workflow
builds and validates one surface without deployment credentials, then passes
the resulting artifact to an environment-protected deployment job. There is no
local production upload command.

See [production-deployment.md](production-deployment.md) for the complete
topology, API deployment, configuration, verification, and rollback runbook.

`scripts/build-cloudflare-pages.sh` is retained for the unconfigured future
Cloudflare Pages option described in [cloudflare.md](cloudflare.md). It is not
part of the current production pipeline.
