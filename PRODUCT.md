# Product

## Platform

web

## Users

Viritura primarily serves professional composers and arrangers creating,
engraving, reviewing, and delivering musical scores. It also supports
collaborating musicians, publishers, educators, and theorists whose work
depends on the same score.

## Product Purpose

Viritura is a web-native collaborative music notation editor. It makes
publication-quality score creation, real-time co-editing, and versioned review
possible without exchanging opaque binary project files.

## Positioning

Viritura combines standards-based MNX score data, Git-like history and visual
diffing, real-time collaboration, and a Rust-to-WASM engraving engine in one
browser-based professional notation environment.

## Operating Context

Users work in long-lived scores and parts, often alongside collaborators. Their
workflow spans composition, arrangement, engraving, playback, review, part
preparation, publishing, and scoring to picture. Scores must remain portable,
diffable, and usable offline.

## Capabilities and Constraints

- MNX is the native score format; Viritura-specific data lives under
  `_x.viritura`.
- The editor is React and TypeScript; engraving and layout run in Rust compiled
  to WebAssembly; score rendering uses Canvas 2D and SMuFL fonts.
- The product supports professional notation, playback, collaboration,
  versioned visual review, desktop workflows, and AI-assisted composition.
- Identity work must remain legible at compact application-chrome sizes and
  credible beside publication-quality music engraving.

## Brand Commitments

- The product name is Viritura.
- The primary identity should signal professional composers and arrangers.
- Viridian green is a permanent identity commitment because the product name
  derives from viridian and _viridis_. Individual directions may vary material,
  value, and supporting neutrals, but green remains the brand anchor.
- The selected wordmark direction is Folio Display: Libertinus Serif Regular in
  a classical small-caps treatment. Compact optical cuts may reinforce its
  details while preserving that publishing character.
- The selected compact mark is Contained Versal Keyline: a Folio V optically
  centered with clear inset inside a `#215e4e` square and a fine `#dceee7`
  border. It is the favicon and native application icon.
- The public website intentionally retains the incumbent identity until its
  separate redesign worktree adopts this guidance.
- The interim V mark is useful incumbent evidence, not a final identity
  commitment.
- Logo exploration should prioritize typographic authorship over illustrative
  symbols. Any standalone icon should be derived from the lettering and remain
  robust at favicon scale.

## Evidence on Hand

- Product and architecture documentation lives under `docs/`.
- Existing brand components and guidance live in
  `packages/ui/src/BrandLogo/` and `packages/ui/src/docs/Logo.mdx`.
- The existing UI design tokens live in `packages/ui/src/tokens.css`.
- No customer endorsements or external brand claims are established; identity
  work must not fabricate them.

## Product Principles

1. Treat musical content as durable, open, reviewable data.
2. Match professional engraving expectations without inheriting desktop-era
   workflow friction.
3. Make collaboration and history native to score creation.
4. Keep advanced power accessible through progressive complexity.
5. Earn professional trust through precision, legibility, and restraint.

## Accessibility & Inclusion

Brand expressions must preserve text legibility, contrast, reduced-motion
preferences, and useful monochrome behavior across light and dark surfaces.
