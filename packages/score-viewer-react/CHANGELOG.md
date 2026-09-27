# Changelog

All notable changes to `@viritura/score-viewer-react` are documented
here. Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

- Delegate page arrangement, virtualized painting, zoom, horizon tiles and
  lifecycle cleanup to `@viritura/score-viewer`.
- Re-export the new opaque score-engine API; remove obsolete renderer types.
- Published to npm. Requires React 19.2 or later (the peer range was
  incorrectly `^18 || ^19`; the viewer uses `useEffectEvent`).
- The zoom slider is a native range input, so the package no longer depends
  on Viritura's internal UI package or its stylesheets. Ships a `"use client"`
  bundle for React Server Components hosts.

## [0.0.1] — Phase 5 internal release

### Added

- `<ScoreView>` component with lazy engine loading, multi-page rendering,
  zoom, and `pagesPerRow` layout.
- `<ScoreView.Page page={n}>` overlay slot.
- `<ScoreView.Playhead beat={n} partId="p1">` auto-positioned playhead.
- `useScoreEngine(mnx, opts)` hook for advanced consumers.
- Re-exports the full `@viritura/score-engine` surface so consumers only
  need one install.
- `README.md`, `CHANGELOG.md`.
