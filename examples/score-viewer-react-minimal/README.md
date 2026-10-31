# `<ScoreView>` minimal React example

A 30-line React app that renders an MNX score with `<ScoreView>` from
`@viritura/score-viewer-react`. Useful as a copy-paste starting point.

## What this example shows

- The minimum viable `<ScoreView>` integration
- Loading MNX from a URL at runtime
- The `<ScoreView.Playhead>` slot driven by an interval

## Run it locally

This example uses published `@viritura/score-engine@0.2.0` and
`@viritura/score-viewer-react@0.1.1`, not workspace links. Vite stages the
installed engine's complete distribution, including WASM, fonts, workers and
license notices, into `public/score-engine/` before development or production
builds. `assetBaseUrl` follows Vite's deployment base so the same example can
be hosted at a subpath. Do not substitute the editor's workspace WASM.

For a standalone app, copy this directory outside the monorepo and run:

```bash
pnpm install
pnpm dev
```

Open http://localhost:5174 and you should see a rendered score with a
moving playhead.

Inside the monorepo, validate it with
`pnpm --filter @viritura-examples/score-viewer-react-minimal build`.
Use the repository's worktree development stack for any in-repository service
preview rather than starting another direct Vite server.

## Files

- [`App.tsx`](./App.tsx) — the component
- [`main.tsx`](./main.tsx) — React 19 mount
- [`index.html`](./index.html) — Vite entry
- [`package.json`](./package.json) — minimal deps
- [`vite.config.ts`](./vite.config.ts) — Vite config and published-engine asset staging

## Adapt for production

Keep the engine JavaScript, WASM, fonts and workers from the same published
release. Serve the staged assets at the URL passed to `assetBaseUrl` and retain
the bundled license notices.

The sample is a trusted, schema-validated fixture. Validate untrusted imported
MNX at the host boundary before passing it to `ScoreView`; the published engine
deliberately uses lightweight native parsing rather than full schema validators.
