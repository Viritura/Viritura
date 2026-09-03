# Viritura - AGENTS.md

## Project Description

Viritura is a web-native collaborative music notation editor. It uses:

- **Rust → WASM** for the layout/engraving engine
- **TypeScript + React** for the editor UI
- **Canvas 2D** for score rendering with SMuFL fonts (Bravura)
- **MNX** (W3C JSON standard) as the native score format

## Project Structure

```
engine/viritura-engine/     # Rust core (model, layout, render)
  src/layout/               # Layout engine (~42 modules)
  src/layout/tests/          # 55 test files by feature area
  src/parse/                 # MNX parser (Rust)
  src/model/                 # Data model structs
  src/render/                # Render commands + SMuFL
engine/viritura-wasm/       # WASM bindings (wasm-bindgen)
apps/desktop/               # Tauri v2 shell (VST3 host, Lua mapper, native playback)
apps/editor/            # React app (Vite)
  src/stories/               # Storybook stories (MNX kitchen sink)
  .storybook/                # Storybook config
packages/renderer/          # Canvas renderer (TS)
packages/core/              # Data model types, enums, and constants (TS)
packages/format/            # MNX parser/serializer (TS, split into 5 modules)
   fixtures/mnx/              # 71 upstream examples + 15 local fixtures
  schemas/                   # viritura-extensions.json schema
packages/musicxml/          # MusicXML → MNX converter (TS, isomorphic)
packages/crdt/              # Yjs bridge, live session, awareness
packages/playback/          # Playback context + transport
packages/video-sync/        # Score-to-picture sync (video, native PiP)
packages/audio/             # Samplers, reverb, mixing
packages/midi/              # MIDI timeline, dynamics, tempo
packages/piano-roll/        # Piano-roll view
packages/instrument-profiles/ # Instrument profile model + registry
packages/sound-profiles/    # Sound profile model
packages/ui/                # UI primitives (own Storybook)
apps/website/               # Marketing site + /mnx tooling routes
apps/server-ui/             # Server-rendered admin/consent UI
server/Viritura.Api/        # ASP.NET Core: auth, MCP relay, signalling, snapshots
server/Viritura.GitHub/     # GitHub App / OAuth / git proxy
server/Viritura.Infrastructure/
docs/                       # Architecture documents
```

## Key References

- Documentation index: [`docs/README.md`](docs/README.md)
- Architecture overview: `docs/overview/project-overview.md` → `docs/overview/architecture.md`
- Music Notation Reference coverage: `docs/spec/music-notationref-coverage.md`
- Viritura vendor extensions: `docs/spec/viritura-extensions.md` (schema: `packages/format/schemas/viritura-extensions.json`)
- MNX spec examples: `packages/format/fixtures/mnx/*.mnx` (71 upstream official examples + 15 locally-authored fixtures; all pass MNX schema validation)
- SMuFL glyphs: `engine/viritura-engine/src/render/smufl.rs`
- SMuFL specification: `../smufl/`
- MNX specification: `../mnx-spec/`

## Validation

- **Build:** `pnpm build`
- **TypeScript build alias:** `pnpm build:ts`
- **Complete core polyglot build:** `pnpm build:all`
- **Test:** `pnpm test`
- **Lint:** `pnpm lint`
- **Rust build:** `pnpm build:rust`
- **Rust test:** `pnpm test:rust` (process-locked to prevent concurrent full suites)
- **WASM build:** `pnpm build:wasm` (`pnpm wasm:build` is preserved)
- **.NET + server UI build:** `pnpm build:dotnet`
- **Desktop build:** `pnpm build:desktop`
- **API image:** `pnpm build:api-image`
- **VSIX package:** `pnpm build:vsix`
- **Storybook (UI primitives + design language):** `pnpm dev:storybook:ui` (port 6005)
- **Storybook (MNX spec + Viritura extensions):** `pnpm dev:storybook:mnx` (port 6006)
- **Storybook (composed app surfaces):** `pnpm dev:storybook` (port 6007)
- **MNX schema validation:** `pnpm --filter @viritura/format test`

## Worktree development servers

When an agent needs to start, run, preview, or visually inspect any web or API
service, it must use `infra/dev/worktree.ps1` rather than launching Vite,
Storybook, or `dotnet watch` directly. The wrapper gives every worktree isolated
containers, data, internal service DNS, and `*.<slug>.localhost` routes without
host-port collisions.

- Default/core work: `./infra/dev/worktree.ps1 up` (editor + website + API + server UI watcher).
- Frontend-only work: `./infra/dev/worktree.ps1 up ui`.
- API/server work: `./infra/dev/worktree.ps1 up backend`.
- Storybook work: `./infra/dev/worktree.ps1 up storybook`.
- Cross-stack or uncertain scope: `./infra/dev/worktree.ps1 up full`.
- Report routes with `./infra/dev/worktree.ps1 url`; inspect with `status` and
  `logs [service]`.
- Use `rebuild [target]` after dependency-manifest changes. Use `down` for normal
  cleanup; `prune` deletes that worktree's per-worktree caches (the shared API database volume is preserved).
- Rust-only builds and tests do not need a server. UI-capable profiles
  automatically run the cache-aware Docker WASM builder before startup; use
  `./infra/dev/worktree.ps1 wasm` to invoke it explicitly.
- On Windows, `worktree.ps1` starts Docker Desktop when the standard installation
  is present but the Docker engine is stopped; if startup times out, start it
  manually and retry.

Inside containers, services use Compose DNS (for example
`VIRITURA_INTERNAL_API_URL=http://api:8080`). Browser code must use the routed
public URL (`VITE_VIRITURA_API_BASE_URL=http://api.<slug>.localhost`), never a
Docker-only hostname. Never store backend secrets inside a worktree; the wrapper
prints the external per-worktree API environment-file path under
`%LOCALAPPDATA%\Viritura\dev`. See `infra/dev/README.md`.

## Coding Standards

- Rust: Use `serde` derive macros for all model types, snake_case
- TypeScript: Strict mode, no `any`, prefer `interface` over `type`
- All music glyphs use SMuFL codepoints from `render/smufl.rs`, rendered via `DrawGlyph` command with `font: "Bravura"`
- Layout computation happens in Rust, Canvas painting happens in TypeScript
- **Engraving decisions:** Ground rendering rules in established engraving practice rather than inventing them ad hoc. Comments should describe the rule itself ("standard engraving practice: …") and not name any particular third-party implementation.
- **MNX extensions:** Features not in the MNX spec use `_x.viritura` vendor dicts (NOT top-level properties). See `docs/spec/viritura-extensions.md`.
- **Testing:** Rust layout tests are split into `engine/viritura-engine/src/layout/tests/*.rs` by feature area (34 files). Add tests to the appropriate file.
- **Storybook:** New engraving features require a story in `apps/editor/src/stories/mnx-spec/` or `viritura-extensions/` (shown in the MNX storybook). New UI primitives require a story in `packages/ui/src/<Name>/` (shown in the UI storybook). New composed app surfaces go under `apps/editor/src/stories/app/` (shown in the App storybook).
- Commit and push frequently with descriptive messages. Never leave unpushed work.

## Module Structure

The unit of cohesion is the **folder**, not the file. ES modules are our only
namespace mechanism — without classes or TS `namespace` blocks, conventions
have to do the work.

**Rules:**

1. **Every feature is a folder.** A folder may contain multiple files, but
   exposes exactly one public surface: its `index.ts` barrel. Anything not
   re-exported from `index.ts` is implicitly private to the folder.
2. **External consumers import only from the barrel.** Never deep-import
   into another package's internals (e.g. `from "@viritura/midi/timeline"`).
   The `no-restricted-imports` ESLint rule enforces this for all `@viritura/*`
   packages. (Raw `.css` deep imports are allowed for stylesheet entry points
   that can't flow through a JS barrel.)
3. **Name internal files by sub-concept, never by kind.** Good: `tempoMap.ts`,
   `repeatExpansion.ts`, `playbackReducer.ts`. Bad: `utils.ts`, `helpers.ts`,
   `shared.ts`, `internal.ts`, `misc.ts`. If you can't name a new file in
   <3 words around a single concept, the split is wrong — find a better seam
   or leave the file whole.
4. **File-size limits prompt folder growth, not arbitrary slicing.** When a
   file hits the 800-line limit, the question is "is there a sub-concept
   here that deserves its own name?" — not "let me move some functions to
   a sibling." If no coherent sub-concept exists, the file is fine; bump the
   threshold with a targeted `// eslint-disable-next-line max-lines` and a
   comment explaining why.
5. **`react-refresh/only-export-components` is a real signal.** A `.tsx` file
   should export components only. Hooks, types, constants, and helpers go
   in `.ts` siblings inside the same folder.
6. **ESLint disables must carry a `--` justification.** Both file-level
   (`/* eslint-disable rule -- why */`) and inline
   (`// eslint-disable-next-line rule -- why`). No justification = the next
   pass will delete it. If the justification ages out (e.g. "in flight, will
   refactor soon"), the disable goes too.
7. **The folder-cohesion rule applies to authored Rust too.** Rust files have
   an 800-code-line limit (excluding blank and comment-only lines) enforced by
   `pnpm lint:rust:size`. Existing oversized algorithmic files are explicit
   **ratcheted debt**: a fixed allowance of at most 25 lines permits small
   correctness fixes, but meaningful shrinkage lowers the baseline permanently.
   Do not add or increase a legacy baseline during feature work. Narrow,
   explicit limits exist only for cohesive data tables and protocol codecs.
   Grow a private feature module as `feature.rs` with child modules in a
   `feature/` folder, named for engraving concepts (for example
   `dynamics.rs`, `tempo.rs`, `curve_clearance.rs`, `dependent_flow.rs`). Never
   split into numbered chunks or generic `helpers.rs` / `utils.rs` /
   `shared.rs`. A function-level `#[allow(clippy::too_many_lines)]` must carry
   a specific trailing justification and does not exempt its file from the
   800-line limit. Feature test modules under `tests/` are exempt from the file
   limit because fixture setup is verbose, but must remain organized by feature.

### Extraction playbook (cheapest → most invasive)

When a component crosses a complexity threshold, work down this list — each
step is strictly less risky than the next. Stop as soon as you're under the
limit.

1. **Types → `types.ts` sibling.** Pure declarative; zero behavior change.
   Often the only step needed. Re-export from the host file's barrel to keep
   the public API stable.
2. **Constants → `constants.ts` sibling.** Hoisted `CSSProperties`, lookup
   tables, magic numbers. Side benefit: stable module-scope identity helps
   React-Compiler.
3. **Orchestration `useEffect` blocks → custom `use*` hooks.** A `useEffect`
   owning 30+ lines and a non-trivial cleanup _is_ a custom hook. Each
   extraction removes the effect, its dep array, and its imports from the
   host.
4. **`useCallback` bodies → `xImpl(args)` siblings.** Leave the
   `useCallback` wrapper in the component; move the body to
   `xImpl(args: XImplArgs)` in a sibling `.ts` file with an explicit args
   interface. The interface forces the dependency surface to be named, which
   is what makes the helper readable in isolation. When 3+ handlers share
   the same surface, group it into a `*Ctx` interface (see
   `ScoreCanvas/canvasHandlers.ts` and its `CanvasHandlerCtx`).
5. **`complexity` / `max-depth` violations → discriminated unions + early
   returns.** Most `complexity > 25` errors are `if/else` ladders dispatching
   on a string kind — replace with a `switch` on a discriminated union or a
   `Record<Kind, Handler>` lookup table. Most `max-depth > 6` errors are
   nested `if` chains that flatten cleanly with guard clauses.

**Anti-patterns** (don't reach for these):

- Reducer-for-its-own-sake when independent `useState` calls would do.
- Container/presenter splits — pure ceremony, no real complexity reduction.
- Generic `helpers.ts` / `utils.ts` / `shared.ts` (already forbidden by rule 3).

**Example (good):**

```
packages/playback/src/
  index.ts                   ← public barrel
  PlaybackContext.tsx        ← public provider component
  usePlayback.ts             ← public hooks
  playbackReducer.ts         ← internal: reducer + action types
  playbackSamplerHelpers.ts  ← internal: pure helpers
```

## Capability Status

Project status and prioritization are maintained in GitHub rather than duplicated
in the repository. Technical contracts live under `docs/spec/`; active design
work lives under `docs/plans/`; operational procedures live under `docs/setup/`.
Check the owning implementation and tests before assuming a capability is absent.

Within-document phase numbers in plans are local to that document and do not
form a project-wide sequence.

## Visual Validation

Compare rendered output against reference images in `apps/editor/public/reference-images/`.

### Visual Review Workflow (Web App)

When the user asks to visually review changes in the web app, run these steps **in order**:

1. **Run Rust tests:** `pnpm test:rust`
2. **Build WASM:** `pnpm wasm:build` (cached; canonical output in `engine/viritura-wasm/pkg-browser/`, staged into app asset directories)
3. **Start dev server (if not running):** `pnpm --filter @viritura/editor dev`
4. **Tell user to hard-refresh** (Ctrl+Shift+R) and provide the URL
