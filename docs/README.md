# Viritura Documentation

Documentation for Viritura — a web-native collaborative music notation editor built around the W3C MNX format.

Project status and prioritization are maintained in GitHub. This directory owns
technical specifications, active design documents, user guides, and operational
runbooks.

## Folder map

| Folder                   | Purpose                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`overview/`](overview/) | What Viritura is, why it exists, and its current technology choices.                                       |
| [`guide/`](guide/)       | Task-oriented user documentation published at `viritura.com/docs` and linked from in-app Help.             |
| [`spec/`](spec/)         | Stable reference material: data model, MNX coverage, Viritura extensions, file format, keyboard shortcuts. |
| [`plans/`](plans/)       | Active or in-flight design documents. Each carries a status banner.                                        |
| [`setup/`](setup/)       | Local development, authentication, deployment, hosting, and production configuration runbooks.             |

## Where to start

- **New to Viritura:** read [overview/project-overview.md](overview/project-overview.md) → [overview/architecture.md](overview/architecture.md).
- **Setting up and validating a local checkout:** read [setup/development.md](setup/development.md).
- **Setting up local GitHub auth:** read [setup/github-dev.md](setup/github-dev.md).
- **Configuring production auth and early access:** read [setup/production-auth.md](setup/production-auth.md).
- **Managing production configuration and secrets:** read [setup/production-secrets.md](setup/production-secrets.md).
- **Deploying current production:** read [setup/production-deployment.md](setup/production-deployment.md).
- **Evaluating the future Cloudflare/Railway topology:** read [setup/cloudflare.md](setup/cloudflare.md) and [plans/production-infrastructure.md](plans/production-infrastructure.md).
- **Working on authentication and production security:** read [spec/auth.md](spec/auth.md), [setup/production-auth.md](setup/production-auth.md), and [setup/production-deployment.md](setup/production-deployment.md).
- **Working on the engine or layout:** [spec/data-model-pipeline.md](spec/data-model-pipeline.md), the performance [single source of truth](plans/performance-architecture.md), and the target-achieved/current-follow-ups [60 FPS incremental-layout plan](plans/sixty-fps-incremental-layout.md).
- **Working on MNX parsing/serialization:** [spec/mnx-coverage.md](spec/mnx-coverage.md), [spec/viritura-extensions.md](spec/viritura-extensions.md), [spec/mnx-converter-coverage.md](spec/mnx-converter-coverage.md), [spec/dynamics.md](spec/dynamics.md).
- **Working on the editor UI:** [spec/engrave-mode.md](spec/engrave-mode.md), [spec/keyboard-shortcuts.md](spec/keyboard-shortcuts.md), [plans/score-and-parts.md](plans/score-and-parts.md).
- **Working on external MCP integration:** [spec/mcp-integration.md](spec/mcp-integration.md).
- **Working on film/video scoring:** [plans/video-sync.md](plans/video-sync.md) — native Picture-in-Picture, shared transport synchronization, and the boundary between Video Reference and Advanced Scoring to Picture.
- **Looking at what's next:** browse [plans/](plans/) for in-flight work.

## Public guide terminology

The public guides bridge musician-facing language with MNX schema names. Their
terminology contract is defined in
[guide/instruments-and-scores.md](guide/instruments-and-scores.md#terminology).

- **Document** means the whole `.mnx` file.
- **MNX part** or **source part** means the music-bearing schema object, not
  automatically a performer's printed part.
- **MNX score definition** means the schema object that selects a layout; it can
  render a full score, section score, or instrumental part.
- Bare **score**, **instrumental part**, and **part extract** refer to
  musician-facing outputs.

New public documentation must preserve these distinctions. When discussing
file-level state, prefer “the document stores…” over the internal TypeScript
model's looser “the score stores…”.

## Availability callouts

Use a GitHub-compatible Availability alert when a workflow has a material
browser, platform, host, permission, or account limitation:

```markdown
> [!NOTE]
> **Availability: Desktop app only**
>
> VST instruments require the native audio host.
```

Use a short label, explain the effect on the user, and name the fallback when
one exists. The public site renders these as editorial callouts; GitHub renders
the same source as an alert.

## Interactive documentation examples

Guide pages can mount a live React snippet instead of embedding a screenshot:

```md
:::interactive id="editor.percussion-palette"
:::
```

The ID resolves through the website's snippet registry. Snippets are lazy-loaded
and can include their own state, keyboard handling, and demonstration animation.
The first proof-of-concept snippet shows a simulated cursor and Space key; the
animation stops as soon as a reader focuses or interacts with the control.

## Overview

| Doc                                              | Description                    |
| ------------------------------------------------ | ------------------------------ |
| [project-overview](overview/project-overview.md) | Vision, goals, target users    |
| [architecture](overview/architecture.md)         | System architecture, data flow |

## Specification & reference

| Doc                                                                   | Description                                                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [data-model-pipeline](spec/data-model-pipeline.md)                    | Score data model: schema → wire → in-memory → transport                                                                                                             |
| [file-format](spec/file-format.md)                                    | Single `.mnx` file with `_x.viritura` vendor extensions                                                                                                             |
| [id-system](spec/id-system.md)                                        | Stable element IDs (UUID v7): format, generator, rules                                                                                                              |
| [mnx-coverage](spec/mnx-coverage.md)                                  | What MNX covers vs. where Viritura uses vendor extensions                                                                                                           |
| [viritura-extensions](spec/viritura-extensions.md)                    | `_x.viritura` vendor extension reference                                                                                                                            |
| [mnx-converter-coverage](spec/mnx-converter-coverage.md)              | MusicXML→MNX converter coverage matrix                                                                                                                              |
| [dynamics](spec/dynamics.md)                                          | Dynamic groups: storage, validation, encoding policy, engraving, and playback                                                                                       |
| [score-and-parts](plans/score-and-parts.md)                           | Competitive analysis + long-term architecture for condensing & part prep                                                                                            |
| [condensing-and-doubling](spec/condensing-and-doubling.md)            | Canonical condensing & doubling spec: multi-source staves, merge analysis, routing                                                                                  |
| [page-layout](spec/page-layout.md)                                    | Horizontal/vertical spacing, the page packer, and the page-turn-aware pagination DP                                                                                 |
| [slur-engraving](spec/slur-engraving.md)                              | Slur endpoint, obstacle, continuation, candidate-scoring, collision-band, and taper contract                                                                        |
| [engrave-mode](spec/engrave-mode.md)                                  | Per-view-state authoring on top of music data                                                                                                                       |
| [collaboration-system](spec/collaboration-system.md)                  | CRDT design, conflict resolution                                                                                                                                    |
| [performance-architecture](plans/performance-architecture.md)         | **Single source of truth** for shipped worker/retention architecture, headed-browser measurements, rejected experiments, and prioritized remaining performance work |
| [sixty-fps-incremental-layout](plans/sixty-fps-incremental-layout.md) | Target-achieved implementation record for 2-D dirty scope, retained staff/system layers, stable Horizon work, optimistic feedback, gates, and remaining hardening   |
| [keyboard-shortcuts](spec/keyboard-shortcuts.md)                      | Authoritative list (drives the in-app help dialog) + reservation policy for new bindings                                                                            |
| [selection-behavior-matrix](spec/selection-behavior-matrix.md)        | What each editing action does for every selection kind (capability contract)                                                                                        |
| [auth](spec/auth.md)                                                  | Authentication, sessions, 2FA, OAuth, GitHub App                                                                                                                    |
| [mcp-integration](spec/mcp-integration.md)                            | External MCP relay, OAuth/session routing, tool catalogue, proposal review, and known limitations                                                                   |
| [orchestral-audio](spec/orchestral-audio.md)                          | Concert-hall playback engine: section pooling, convolution reverb, master bus                                                                                       |
| [sound-profiles](spec/sound-profiles.md)                              | Proposed sound-profile model: instrument identity, MIDI/SF2 and VST routing, VirituraSounds compatibility baseline                                                  |
| [instrument-profiles-vst](plans/instrument-profiles-vst.md)           | Remaining mixer, diagnostics, audio-routing, custom-binding, and profile-portability work                                                                           |
