# Parallel Git-worktree development

Run any number of frontend worktrees behind one shared Traefik proxy. Every
worktree gets its own Compose project, compiler output, and
`*.<slug>.viritura.localhost` UI routes. A single API from the primary checkout serves
every worktree at `api.viritura.localhost`. Worktrees with the same dependency
manifests share one read-only Node dependency set; all worktrees share
package-download caches, the development API database, and one Data Protection
key ring. Application containers do not publish host ports.

## Quick start

Start the shared backend once from the primary checkout:

```bash
pnpm dev:stack up backend
```

Then run the frontend from any worktree:

```bash
pnpm dev:stack up     # app: editor using the shared API
pnpm dev:stack watch  # app plus continuous Rust/WASM rebuilding
pnpm dev:stack status
```

The wrapper prints the worktree slug and routes. Chromium browsers resolve
`*.localhost` automatically; no hosts-file entries are required.

## Stack targets

Targets select Compose profiles and can be combined:

| Target          | Services                                                            |
| --------------- | ------------------------------------------------------------------- |
| `app`           | Editor using the shared API (default)                               |
| `core`          | Compatibility alias for `app`                                       |
| `editor`        | Editor only                                                         |
| `ui`            | Editor and marketing website                                        |
| `website`       | Website using the shared API                                        |
| `backend`       | Shared hot-reload API and server UI watcher (primary checkout only) |
| `storybook-ui`  | UI design-system Storybook                                          |
| `storybook-mnx` | MNX and Viritura extension Storybook                                |
| `storybook-app` | Composed-app Storybook                                              |
| `storybook`     | All three Storybooks                                                |
| `full`          | All UI surfaces plus the shared backend (primary checkout only)     |

Use `pnpm dev:stack watch [targets]` instead of `up [targets]` when Rust/WASM
changes should rebuild continuously. UI and API watching is enabled in both
modes; `watch` adds a polling Rust/WASM builder because bind-mounted Windows
files do not reliably deliver Linux filesystem events. For example:

```bash
pnpm dev:stack watch full
pnpm dev:stack watch storybook-mnx # MNX stories plus continuous Rust/WASM rebuilds
```

Examples:

```bash
pnpm dev:stack up backend
pnpm dev:stack up storybook-mnx
pnpm dev:stack up ui storybook-app
pnpm dev:stack up full
```

Rust is a build dependency rather than a long-running network service.
Rust-only changes do not require the application stack. Run `pnpm test:rust` for
engine validation. Before starting an editor, website, Storybook, or full
profile, the wrapper automatically runs a one-shot Docker builder. It hashes the
Rust inputs and skips compilation when that worktree's generated WASM is current.
A fresh worktree therefore needs Git, Docker, Node.js 24, Corepack, and
`pnpm dev:stack up`; it does not need host Rust, .NET, or wasm-pack installations
to render scores or run the API.

## Routes

For a slug such as `feature-collab-a1b2`:

| Service       | Public browser URL                                        | Internal container URL         |
| ------------- | --------------------------------------------------------- | ------------------------------ |
| Editor        | `http://editor.feature-collab-a1b2.viritura.localhost`    | `http://editor:5173`           |
| API           | `http://api.viritura.localhost`                           | `http://viritura-dev-api:8080` |
| Website       | `http://web.feature-collab-a1b2.viritura.localhost`       | `http://website:5180`          |
| UI Storybook  | `http://ui.feature-collab-a1b2.viritura.localhost`        | `http://storybook-ui:6005`     |
| MNX Storybook | `http://mnx.feature-collab-a1b2.viritura.localhost`       | `http://storybook-mnx:6006`    |
| App Storybook | `http://storybook.feature-collab-a1b2.viritura.localhost` | `http://storybook-app:6007`    |

The Traefik dashboard is at <http://traefik.localhost> or
<http://127.0.0.1:8080>.

## Service environment

Compose injects these values into services:

```text
VIRITURA_PUBLIC_EDITOR_URL=http://editor.<slug>.viritura.localhost
VIRITURA_PUBLIC_WEBSITE_URL=http://web.<slug>.viritura.localhost
VIRITURA_PUBLIC_API_URL=http://api.viritura.localhost
VIRITURA_INTERNAL_API_URL=http://viritura-dev-api:8080
```

The distinction is important:

- Browser code receives `VITE_VIRITURA_API_BASE_URL` with the public Traefik
  URL. A browser cannot resolve Docker service names.
- Server-side container calls use `VIRITURA_INTERNAL_API_URL`; the shared
  proxy network resolves `viritura-dev-api`.
- In Development, the API accepts only routed `http://editor.<slug>.viritura.localhost`
  and `http://web.<slug>.viritura.localhost` frontend origins in addition to explicit
  local origins. Production retains its exact-origin allowlist.

Optional local settings are split to avoid leaking backend secrets into
frontend processes:

- Copy entries from `.env.api.example` to the machine-wide external path shown
  by `pnpm dev:stack url` for API secrets such as GitHub or Google OAuth
  credentials. It is `%LOCALAPPDATA%\Viritura\dev\api.env` on Windows,
  `~/Library/Application Support/Viritura/dev/api.env` on macOS, and
  `$XDG_STATE_HOME/viritura/dev/api.env` (or
  `~/.local/state/viritura/dev/api.env`) on Linux. Never place API secrets
  inside the repository: frontend containers bind-mount the source tree.
- Copy entries from `.env.frontend.example` to ignored
  `.env.frontend.local` for non-secret browser build settings. Every `VITE_`
  value is public.

Explicit worktree routing and storage settings in Compose take precedence over
local env files so services cannot accidentally connect to another worktree.

## Lifecycle

| Command                               | Effect                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev:stack up [targets]`         | Build and start selected targets; defaults to `app`.                      |
| `pnpm dev:stack watch [targets]`      | Start selected targets with incremental development Rust/WASM rebuilding. |
| `pnpm dev:stack restart [targets]`    | Restart services in selected targets.                                     |
| `pnpm dev:stack rebuild [targets]`    | Recreate worktree compiler output and rebuild selected images.            |
| `pnpm dev:stack status`               | Show containers and all possible routes.                                  |
| `pnpm dev:stack logs [service]`       | Follow all logs or one Compose service.                                   |
| `pnpm dev:stack wasm`                 | Build missing/stale WASM with the isolated Docker toolchain.              |
| `pnpm dev:stack url` / `slug`         | Print routes or the derived slug.                                         |
| `pnpm dev:stack keepalive`            | Renew the worktree's eight-hour runtime lease.                            |
| `pnpm dev:stack stop`                 | Stop containers while preserving them for a fast restart.                 |
| `pnpm dev:stack down`                 | Remove containers and networks; preserve compiler output temporarily.     |
| `pnpm dev:stack prune`                | Delete containers and worktree compiler output; preserve shared caches.   |
| `pnpm dev:stack cleanup`              | Stop expired stacks and remove stacks past the cleanup grace period.      |
| `pnpm dev:stack proxy` / `proxy-down` | Start or stop the machine-wide Traefik proxy.                             |

Every successful `up`, `watch`, `restart`, or `rebuild` grants the stack an
eight-hour lease. Before starting or restarting a stack, the wrapper stops
expired stacks and removes stacks that have remained stopped for 24 hours. Run
`keepalive` to extend an active session. The same startup cleanup removes unused
content-addressed dependency volumes and development images after seven days.
No background cleanup task is installed, so expired resources can remain until
the next worktree stack starts. Cleanup never touches unmanaged Docker
resources.

A JavaScript or .NET dependency-manifest change automatically selects a new
content-addressed image on the next `up`. Use `rebuild` only to discard stale
worktree-local compiler output or force selected images to rebuild. The API uses
`dotnet watch` with polling, so C# source edits rebuild automatically.
Vite and Storybook source edits also update without rebuilding images.
The `watch` command uses `wasm-pack --dev` with development `opt-level=1`;
Cargo reuses the per-worktree target volume and the build skips optimized WASM
post-processing. The lower optimization level keeps the browser artifact and
startup compilation substantially smaller while preserving fast incremental
Rust rebuilds. Use `pnpm dev:stack wasm` when you need the optimized release
artifact.

The shared API's SQLite database and Data Protection keys live in the machine-wide
external volume `viritura-dev-api-data`. Sharing both is required because
Identity and provider tokens stored in the database are encrypted with the Data
Protection key ring. Local email registration skips mailbox verification in the
worktree stack, so an account created in any worktree can immediately sign in to
all of them with the same credentials. Browser sessions remain host-specific,
so each worktree still requires its own sign-in.

Node and API development images use hashes of their restore inputs rather than
worktree names. Node dependency volumes use the same dependency hash and are
mounted read-only by every matching worktree. Vite, Storybook, and asset-staging
caches remain private in container tmpfs storage.

Cargo registry and Git downloads, wasm-pack tools, and NuGet packages use
machine-wide external cache volumes. Rust `target`, .NET `bin`/`obj`, and other
branch-dependent compiler output remain worktree-specific. Normal `stop` and
`down` preserve this output; `prune` removes it. All lifecycle commands preserve
the shared API volume.

Only the primary checkout may start the backend profile, preventing competing
worktree APIs from migrating the shared SQLite schema. The shared database also
contains OpenIddict and GitHub installation records in addition to Identity
accounts.

## Troubleshooting

### Edits are not appearing

Bind mounts from a Windows or macOS host do not deliver inotify events into a
Linux container, so a native file watcher sees nothing at all. The editor and
website dev servers therefore poll whenever they detect a container
(`server.watch.usePolling` in their `vite.config.ts`, keyed off
`VIRITURA_CONTAINER_HOST`), and the API uses `dotnet watch` with polling for the
same reason.

The Storybook services do not set `VIRITURA_CONTAINER_HOST` and have no polling
configured, so they are likely affected by the same problem. Untested so far.

The failure mode to know about: **if the checked-out tree does not enable
polling, the dev server goes blind and silently serves stale code.** Vite reads
its config at startup and again on every config change, so a `git stash`,
`rebase`, `bisect` or branch switch that momentarily reverts a `vite.config.ts`
will restart Vite without polling — after which it cannot even see the change
that would restore it.

Nothing in the logs indicates this; the server just keeps serving what it last
transformed. To confirm, ask the server directly rather than trusting the file on
disk:

```bash
curl.exe -s -H "Host: editor.<slug>.viritura.localhost" http://127.0.0.1/src/main.tsx
```

If that output is stale, restart the service:

```bash
pnpm dev:stack restart editor
```

Restarting after any change to a Vite config is the safe habit.

Note that `CHOKIDAR_USEPOLLING` does not help here. Vite 8 watches through
Rolldown and ignores it, so polling has to come from the config rather than the
container environment.

### Everything in the container is slow

Polling is not just a watcher cost. The dev server is single-threaded, so a
poller that saturates the event loop slows down _every_ request it serves —
module graph, HMR, and static assets alike.

Unscoped polling at a 300 ms interval measured, on this repo:

| watch config        | idle CPU | static throughput |
| ------------------- | -------- | ----------------- |
| unscoped, 300 ms    | 32%      | 0.19 MB/s         |
| scoped, 300 ms      | 32%      | 1.9 MB/s          |
| **scoped, 1000 ms** | **11%**  | **25 MB/s**       |
| scoped, 2000 ms     | 4%       | 22 MB/s           |

At 0.19 MB/s the 124 MB soundfont takes about eleven minutes, so the transport's
play button stays a spinner indefinitely and the whole editor feels laggy. The
symptom looks like an application bug and is not one.

The bind mount itself is not the problem — reading that same file straight off
the mount inside the container runs at 204 MB/s, and Traefik adds nothing
measurable. It is entirely the poller.

Both settings live in [`viteWatch.ts`](./viteWatch.ts): poll only what a human
edits (never `node_modules`, `dist`, `target`, or `public`), and poll at 1 s.

### Static assets are slow

Windows bind mounts are usable with WSL2, but Vite's streamed public-file
middleware can still be very slow when the file lives on the Windows filesystem.
This is not the old WSL1 filesystem behavior: direct reads from the mounted tree
are fast, while Vite's chunked response path is the bottleneck. The editor's
container configuration therefore serves files under `public/` through a
buffered read middleware. It is enabled only in the container and preserves
Vite's normal fallback for missing files and application routes.

If a large `.mnx`, image, or WASM asset is still slow, compare the direct
container read with the browser route before changing Rust or application
loading code. MNX fixtures are canonically owned by
`packages/format/fixtures/mnx` and staged into the editor path below:

```bash
docker exec <editor-container> node -e "const fs=require('fs'); const t=Date.now(); fs.readFileSync('/workspace/apps/editor/public/scores/<file>.mnx'); console.log(Date.now()-t)"
```

Throughput is already saturated at 1 s, so a slower interval buys nothing a
developer can feel.

If the container's idle CPU is more than a few percent, suspect the watcher
first:

```bash
docker stats --no-stream --format "{{.Name}} CPU={{.CPUPerc}}"
```

## VS Code and agents

VS Code tasks and launch configurations expose core, backend, Storybook, and
full-stack targets. Repository agents are instructed in `AGENTS.md` to use this
wrapper instead of directly launching Vite, Storybook, or `dotnet watch`.
