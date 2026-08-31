//! Viritura Engraving Engine
//!
//! Core layout and engraving algorithms for music notation.
//! Compiled to WebAssembly for browser use, also available as a native library.
//!
//! # Architecture
//!
//! ```text
//! MNX JSON → parse → promote walker → Score model → layout → DisplayList
//! ```
//!
//! The engine receives MNX JSON, runs it through [`promote::root::promote_root`]
//! (the canonical raw-JSON → model walker), computes spatial layout
//! (spacing, positioning, system/page breaks), and produces a DisplayList
//! of render commands that the TypeScript Canvas renderer paints.
//!
//! `model::*` types deliberately have no `Deserialize` impls; the promote
//! walker is the single ingest seam. See `docs/spec/data-model-pipeline.md`.

pub mod layout;
pub mod model;
pub mod parse;
pub mod promote;
// `#[rustfmt::skip]` on the module declaration tells rustfmt not to descend
// into raw.rs / raw_viritura.rs — they are code-generated (`pnpm gen:raw:rust`)
// via prettyplease, whose output differs from rustfmt's and would otherwise
// make `cargo fmt --check` permanently dirty. (The `format_generated_files` /
// `ignore` rustfmt options are nightly-only; this outer attribute is stable.)
#[rustfmt::skip]
pub mod raw;
#[rustfmt::skip]
pub mod raw_viritura;
pub mod reconcile;
pub mod render;
pub mod timing;
pub mod validator;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
