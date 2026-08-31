---
name: "Rust Engraving Module Cohesion"
description: "Use when editing Rust engraving, layout, rendering, collision, spacing, pagination, slur, beam, or annotation code. Enforces folder growth, private module surfaces, and concept-based extraction."
applyTo: "engine/viritura-engine/src/{layout,render}/**/*.rs"
---

# Rust engraving module cohesion

- Treat the folder as the unit of cohesion. A feature exposes one internal surface through `feature.rs`, with implementation modules in `feature/`; do not use `feature/mod.rs`. Child modules remain private unless a caller genuinely needs the symbol.
- An authored Rust file must stay at or below 800 lexical code lines; blank and comment-only lines do not count. Existing oversized algorithmic files are ratcheted debt tracked by `scripts/check-rust-source-size.ts`.
- Legacy files receive at most 25 fixed lines of headroom for small correctness fixes. Never add or increase a legacy baseline as part of feature work. Meaningful shrinkage must lower the baseline; larger features must extract the concept being expanded.
- Only explicitly listed cohesive data tables and protocol codecs use justified non-800 limits. Do not classify an algorithmic pipeline as a codec to evade extraction.
- At the 800-line boundary, grow a folder by engraving concept. For annotations, use concepts such as `dynamics`, `expressions`, `tempo`, `rehearsal_marks`, `curve_clearance`, and `dependent_flow`; do not create numbered chunks.
- Never create `helpers.rs`, `utils.rs`, `shared.rs`, `internal.rs`, `misc.rs`, or `part1.rs`/`part2.rs`. Name each module for the rule or state it owns.
- Keep the substrate → connector → dependent architecture centralized. Annotation modules may measure preferred geometry and emit typed records; they must not clone stacking, skyline, horizontal-dodge, or `SpaceRequest` policy.
- Preserve behavior during extraction: move code and tests first, validate, then redesign types or algorithms in a separate change.
- Keep public visibility narrow: prefer private items, then `pub(super)`, then `pub(crate)` only for actual cross-feature consumers.
- `#[allow(clippy::too_many_lines)]` is an exceptional function-level escape hatch, not permission for a monolithic file. It must have a specific trailing justification. Do not add file-level lint allows.
- Feature test modules under `tests/` are exempt from the file-size gate because fixtures are verbose, but tests must remain split by feature area.
- Before finishing, run `pnpm lint:rust:size`, focused Rust tests for the moved feature, and `pnpm lint:rust` when the change is ready for full validation.
