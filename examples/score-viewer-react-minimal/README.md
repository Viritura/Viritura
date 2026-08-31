# `<ScoreView>` minimal React example

A 30-line React app that renders an MNX score with `<ScoreView>` from
`@viritura/score-viewer-react`. Useful as a copy-paste starting point.

## What this example shows

- The minimum viable `<ScoreView>` integration
- Loading MNX from a URL at runtime
- The `<ScoreView.Playhead>` slot driven by an interval

## Run it locally

This example lives inside the Viritura monorepo and uses workspace
links. To run a standalone copy elsewhere, replace the workspace
references in `package.json` with version pins once
`@viritura/score-viewer-react` is published.

```bash
# From the repo root
corepack pnpm install
cd examples/score-viewer-react-minimal
corepack pnpm dev
```

Open http://localhost:5174 and you should see a rendered score with a
moving playhead.

## Files

- [`App.tsx`](./App.tsx) — the component
- [`main.tsx`](./main.tsx) — React 19 mount
- [`index.html`](./index.html) — Vite entry
- [`package.json`](./package.json) — minimal deps
- [`vite.config.ts`](./vite.config.ts) — Vite config

## Adapt for production

When `@viritura/score-viewer-react` ships to npm, replace the
workspace dep:

```diff
-"@viritura/score-viewer-react": "workspace:*"
+"@viritura/score-viewer-react": "^0.x.0"
```

…and the example becomes a standalone reference template.
