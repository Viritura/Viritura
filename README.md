# Viritura

**Web-native, collaborative music notation software.**

Viritura is a modern music notation editor built on performant web technologies that allows composers to collaborate in real-time instead of exchanging binary files. Scores are stored in [MNX](https://w3c.github.io/mnx/docs/) (an open W3C JSON standard), making them Git-diffable and portable.

## Architecture

| Layer             | Technology                        | Purpose                                                    |
| ----------------- | --------------------------------- | ---------------------------------------------------------- |
| **UI**            | React 19 + TypeScript             | Toolbars, panels, inspectors, modes                        |
| **Core Engine**   | Rust → WebAssembly                | Layout, spacing, engraving                                 |
| **Rendering**     | Canvas 2D + SMuFL (Bravura)       | Score canvas, glyph atlas, off-screen page cache           |
| **Collaboration** | Yjs (CRDT) + y-webrtc + IndexedDB | P2P real-time editing, local persistence                   |
| **Backend**       | C# / ASP.NET Core 10              | Auth, GitHub integration, WebRTC signaling, snapshot relay |
| **AI**            | OAuth-secured MCP relay           | Read and proposal tools with mandatory in-app review       |

## Key Differentiators

- **Real-time collaboration** with offline support and CRDT merge
- **MNX (JSON) native format** — Git-diffable, LLM-readable, W3C open standard
- **Rust→WASM core engine** for near-native rendering performance
- **AI-assisted score editing** through external MCP clients and reviewed proposals
- **Visual score diff editor** — side-by-side comparison for AI review, version history, branch merge
- **Score condensing and part views**, with automatic page turns and cue suggestions queued
- **Editable condensed score** — write on the conductor's score, individual parts update

## Project Structure

```
apps/                            # Deployable/distributable applications
├── editor                       # React editor app + editor Storybooks
├── website                      # Marketing, docs, and converter site
├── server-ui                    # Browser assets embedded by ASP.NET
├── vscode-mnx-viewer            # VS Code extension + webview
└── desktop                      # Tauri desktop shell

packages/                        # Reusable TypeScript libraries (pnpm + Turbo)
├── core, format, crdt           # Model, MNX IO, collaboration
├── renderer, score-engine       # Rendering and embedding APIs
├── audio, playback, midi        # Audio and playback stack
├── musicxml                     # MusicXML to MNX converter
├── score-viewer-react           # Public read-only viewer component
└── ui                           # UI primitives + design language

server/                          # Backend (C# / .NET 10)
├── Viritura.Api                 # ASP.NET Core Web API + WebRTC signaling
├── Viritura.Infrastructure      # EF Core (Identity + SQLite)
├── Viritura.GitHub              # GitHub App integration
└── *.Tests                      # xUnit test projects

engine/                          # Engraving Engine (Rust → WASM)
├── viritura-engine              # Core layout/engraving logic
├── viritura-wasm                # wasm-bindgen bindings
└── viritura-codegen             # Type generation

docs/                            # Architecture & planning docs
```

## Documentation

The full documentation index lives at [`docs/README.md`](docs/README.md). Highlights:

| Doc                                                           | Description                                             |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| [Project Overview](docs/overview/project-overview.md)         | Vision, goals, target users                             |
| [Architecture](docs/overview/architecture.md)                 | System architecture, data flow                          |
| [Data Model Pipeline](docs/spec/data-model-pipeline.md)       | Score data model: schema → wire → in-memory → transport |
| [Collaboration](docs/spec/collaboration-system.md)            | CRDT design, conflict resolution                        |
| [File Format](docs/spec/file-format.md)                       | Single `.mnx` file with `_x.viritura` extensions        |
| [Performance](docs/plans/performance-architecture.md)         | Memory model, layout pipeline, benchmarks               |
| [Condensing & Doubling](docs/spec/condensing-and-doubling.md) | Multi-source staves: doubling and score condensing      |
| [MNX Coverage](docs/spec/mnx-coverage.md)                     | MNX spec coverage audit                                 |
| [Viritura Extensions](docs/spec/viritura-extensions.md)       | `_x.viritura` vendor extension reference                |
| [MCP Integration](docs/spec/mcp-integration.md)               | MCP relay, model tools, mandatory proposal review       |

## Getting Started

### Prerequisites

- Git and Docker Desktop for the recommended isolated-worktree workflow.
- Node.js 22+ / pnpm 9+, the Rust toolchain pinned by
  `engine/rust-toolchain.toml`, wasm-pack, and the .NET 10 SDK for direct host
  development and validation.

### Recommended: isolated worktree setup

Each Git worktree can run a complete development stack without claiming its own
host ports. One shared Traefik container binds loopback port 80 and routes
worktree-specific `.localhost` domains; every worktree gets isolated
application containers, service DNS, and dependency/build caches. The API
database and Data Protection key ring are shared across all worktrees so
the same local account credentials work everywhere.

Create a worktree and start the default editor + API stack:

```powershell
git worktree add ..\Harmonia.worktrees\my-feature -b feat/my-feature main
Set-Location ..\Harmonia.worktrees\my-feature
.\infra\dev\worktree.ps1 up
```

Docker automatically installs JavaScript/.NET dependencies and builds missing
or stale Rust→WASM output. A fresh worktree does not require `pnpm install`,
Rust, wasm-pack, or the .NET SDK on the host just to run the application.

Choose the smallest stack target that matches the work:

| Command                                     | Services                                     |
| ------------------------------------------- | -------------------------------------------- |
| `.\infra\dev\worktree.ps1 up`               | Editor + website + API + server UI (default) |
| `.\infra\dev\worktree.ps1 up ui`            | Editor + website                             |
| `.\infra\dev\worktree.ps1 up backend`       | Hot-reload API + server UI watcher           |
| `.\infra\dev\worktree.ps1 up storybook`     | UI, MNX, and composed-app Storybooks         |
| `.\infra\dev\worktree.ps1 up full`          | Core services + all Storybooks               |
| `.\infra\dev\worktree.ps1 status`           | Running containers and worktree URLs         |
| `.\infra\dev\worktree.ps1 down`             | Stop while preserving data and caches        |
| `.\infra\dev\worktree.ps1 rebuild [target]` | Refresh dependency images; preserve API data |
| `.\infra\dev\worktree.ps1 prune`            | Delete this worktree's containers and data   |

The wrapper derives a DNS-safe slug from the branch and worktree path. It prints
routes such as:

```text
http://editor.<slug>.localhost
http://api.<slug>.localhost
http://web.<slug>.localhost
http://ui.<slug>.localhost
http://mnx.<slug>.localhost
http://storybook.<slug>.localhost
```

Containers call one another through isolated Compose DNS, such as
`http://api:8080`; browser code receives the corresponding public Traefik URL.
Optional frontend settings go in `infra/dev/.env.frontend.local` and must not
contain secrets. API secrets live outside the repository at the path printed by
`worktree.ps1 url`:

```text
%LOCALAPPDATA%\Viritura\dev\<slug>\api.env
```

VS Code provides matching **Worktree Core**, **Backend**, **Storybooks**, and
**Full Stack** tasks and launch configurations. Repository agents are instructed
to use the wrapper rather than launching Vite, Storybook, or `dotnet watch`
directly.

See [infra/dev/README.md](infra/dev/README.md) for profiles, environment
variables, persistence, and cleanup details, and
[docs/setup/development.md](docs/setup/development.md) for validation and native
tooling.

### Native host setup (Frontend + WASM)

Run these steps from the `Viritura/` folder.

For validation commands, cache behavior, Git hooks, and deployment workflows,
see [docs/setup/development.md](docs/setup/development.md).

#### 1) Install toolchains

**Windows (PowerShell):**

```powershell
winget install Rustlang.Rustup
winget install Microsoft.DotNet.SDK.10
```

If Rust tools are not recognized immediately, restart your terminal/VS Code.

**macOS (Homebrew example):**

```bash
brew install node
corepack enable
brew install rustup-init
rustup-init -y
brew install --cask dotnet-sdk
```

**Ubuntu/Debian (example):**

```bash
sudo apt update
sudo apt install -y curl build-essential pkg-config libssl-dev
curl https://sh.rustup.rs -sSf | sh -s -- -y
# install Node 22+ via nvm or NodeSource
# install .NET 10 SDK from Microsoft package feed
```

#### 2) Enable pnpm and install JS dependencies

```bash
corepack enable
corepack pnpm install
```

#### 3) Install Rust WASM tooling

```bash
cargo install wasm-pack
cargo install cargo-watch
rustup target add wasm32-unknown-unknown
```

#### 4) Build the WASM engine

```bash
corepack pnpm wasm:build
```

This outputs the canonical WASM package to `engine/viritura-wasm/pkg-browser/`
and stages it into application asset directories.
The command skips `wasm-pack` when its recorded Rust and toolchain inputs have
not changed. Use `corepack pnpm wasm:build:force` to rebuild unconditionally.

#### 5) Start Storybook

```bash
corepack pnpm dev:storybook:mnx
```

The MNX engraving Storybook runs at `http://localhost:6006`. The composed app
Storybook uses `corepack pnpm dev:storybook` at `http://localhost:6007`.

#### 6) Optional: Fast Rust edit loop (auto-rebuild WASM)

```bash
corepack pnpm wasm:watch
```

This watches Rust source in `engine/viritura-engine` and `engine/viritura-wasm` and runs `wasm:build` on change.
After each rebuild, refresh Storybook/the page (hard refresh if needed).

### One-command Full Dev Mode

Run the website, editor, Storybooks, and Rust→WASM watch together:

```bash
corepack pnpm dev:all
```

This starts:

- `dev:website` (marketing site)
- `dev:editor` (Vite app)
- `dev:storybook:ui` (UI primitives, port 6005)
- `dev:storybook:mnx` (MNX engraving, port 6006)
- `dev:storybook` (composed app surfaces, port 6007)
- `wasm:watch` (Rust file watcher + auto WASM rebuild)

If an individual Storybook port is already in use, pass a different port to
that package command. For example:

```bash
corepack pnpm --filter @viritura/editor run storybook:mnx -- --port 6016
```

### Common Setup Issues

#### `cargo` / `rustc` not recognized (Windows)

- Restart terminal/VS Code after installing Rust.
- Ensure `%USERPROFILE%\\.cargo\\bin` is on `PATH`.

#### `link.exe` not found while installing/building Rust tools (Windows)

Install Visual C++ Build Tools workload:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent --accept-source-agreements --accept-package-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

This is needed to build native host binaries (such as `wasm-pack`) on Windows.

#### Port 6006 already in use

Run Storybook on another port:

```bash
corepack pnpm --filter @viritura/editor run storybook:mnx -- --port 6016
```

### Verify Your Environment

```bash
node -v
corepack pnpm -v
rustc -V
cargo -V
wasm-pack -V
dotnet --version
```

### Optional: GitHub Integration Dev Setup

Live GitHub OAuth and repository-creation testing requires a per-developer GitHub App plus local .NET user-secrets. The normal editor, engine, renderer, parser, and mocked tests do not require GitHub credentials.

See [docs/setup/github-dev.md](docs/setup/github-dev.md) for the full setup, including GitHub App permissions, local callback URL, `.secrets/` private-key storage, `dotnet user-secrets`, and trusting the ASP.NET Core HTTPS development certificate.

**Production:** [viritura.com](https://viritura.com) (marketing) · [app.viritura.com](https://app.viritura.com) (editor)

Production currently uses nginx with manual SSH static deployment and a
host-managed API container. See
[`docs/setup/production-deployment.md`](docs/setup/production-deployment.md).

## License

Original Viritura source code is available under the [MIT License](LICENSE).
Bundled assets and generated third-party components retain their own terms; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance, attribution,
and release-evidence requirements.
