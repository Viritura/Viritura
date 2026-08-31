// MNX layout pipeline — barrel module.
//
// Folder structure (cohesion unit per AGENTS.md):
//   shared.rs    — helpers used by BOTH the auto-flow and explicit-pages paths
//   auto_flow.rs — `layout_auto_flow_mnx_score` and its phase helpers
//   explicit.rs  — `layout_with_mnx_scores[_cached]` and its phase helpers
//
// Public surface is re-exported below; siblings reach shared items via
// `super::shared::*` (marked `pub(super)`) to keep them folder-internal.

mod auto_flow;
mod break_planning;
mod measure_widths;
mod mmr_grouping;
mod page_turn_planning;
mod render_hashing;
mod render_setup;
mod resolve_condensing;
mod retained_segments;
mod system_extras;
mod system_precompute;
mod system_rendering;

mod cache_hashing;
mod explicit;
mod explicit_pagination;
mod explicit_system_breaks;
mod explicit_system_layouts;
mod explicit_widths;
mod instrument_labels;
mod inter_staff_barlines;
mod shared;
mod slur_tie_collection;
mod staff_grouping;
mod staff_placement;
mod structure_flattening;
mod system_connectors;

pub use explicit::{layout_with_mnx_scores, layout_with_mnx_scores_cached};
