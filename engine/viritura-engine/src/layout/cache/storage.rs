use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Weak};

use super::super::measure::AlignedPrefix;
use super::config::LayoutConfig;
use super::spacing::{DurationHistogram, LogSpacing};
use super::types::{MeasureLayout, MidClefChange, ResolvedOttavaRange, VoiceLayout};
use super::{BoundaryState, DirtyRegion, PatchFrame, RangeScope, RetainedSegment, SystemPlacement};
use crate::model::measure::ResolvedMeasure;
use crate::render::DisplayList;

/// Cached natural width entry for a single measure.
struct CachedWidth {
    content_hash: u64,
    width: f64,
}

/// A fully-assembled measure layout retained across auto-flow passes for
/// *move*-based reuse (vs. the clone-based [`CachedMeasureData`]).
///
/// Keyed by the per-measure `cache_key`; the `compound_hash` (content +
/// justified width + spacing + prefix) is the trusted reuse key — a match means
/// the assembled geometry is reusable verbatim, modulo a rigid x shift.
/// Assembling a measure deep-clones its `voice_layouts` — the dominant cost of
/// a warm re-layout. Retaining the assembled measure lets the next pass *move*
/// it back in (zero clone). Stored at its FINAL x: on reuse the geometry is
/// shifted by `new_x - x`, which is 0 whenever upstream widths are unchanged,
/// so an unchanged measure in an unchanged position is reused byte-for-byte.
///
/// Keyed by `cache_key` (= measure index + staff), reuse is always *same
/// measure, same staff* across passes — never a cross-measure content match —
/// so the retained `resolved` is moved back in too (the `resolved` of THIS
/// measure from the prior pass), avoiding a deep `ResolvedMeasure` clone.
pub(crate) struct RetainedMeasure {
    /// Trusted per-measure reuse key (content + width + spacing + prefix).
    pub compound_hash: u64,
    /// Final x the measure was assembled at last pass.
    pub x: f64,
    pub width: f64,
    pub prefix_width: f64,
    pub first_onset_padding: f64,
    pub time_signature_x_offset: Option<f64>,
    pub resolved: ResolvedMeasure,
    pub voice_layouts: Vec<VoiceLayout>,
    pub mid_clef_changes: Vec<MidClefChange>,
}

/// Cached full measure layout data (voice layouts, prefix, clef changes).
/// Stored with x=0 so it can be translated to any position.
pub(crate) struct CachedMeasureData {
    content_hash: u64,
    width: f64,
    voice_layouts: Vec<VoiceLayout>,
    prefix_width: f64,
    first_onset_padding: f64,
    time_signature_x_offset: Option<f64>,
    mid_clef_changes: Vec<MidClefChange>,
}

pub(crate) struct CachedMeasureLayout {
    pub(crate) voice_layouts: Vec<VoiceLayout>,
    pub(crate) prefix_width: f64,
    pub(crate) first_onset_padding: f64,
    pub(crate) time_signature_x_offset: Option<f64>,
    pub(crate) mid_clef_changes: Vec<MidClefChange>,
    pub(crate) width: f64,
}

/// Per-staff cache of the resolve pass output, used by Phase A
/// (range-scoped resolve). On a scoped re-resolve, the dirty-range prefix is
/// reused from `resolved[..dirty_start]`, the dirty span re-runs Phase 1, and
/// the suffix `resolved[converge..]` is spliced when the carried-state
/// fingerprint at boundary `mi` matches `boundary_fps[mi]`.
pub(crate) struct CachedResolvedStaff {
    /// Per-measure resolve output from the last full or scoped pass.
    pub resolved: Arc<[ResolvedMeasure]>,
    /// Derived whole-staff ottava ranges. Shared by the cache and current pass;
    /// recomputed only for affected staff snapshots.
    pub ottavas: Arc<[ResolvedOttavaRange]>,
    /// Quantized event-duration frequencies for global spacing-base reduction.
    pub duration_histogram: DurationHistogram,
    /// Hash of the BoundaryState going INTO measure `mi + 1` (i.e. AFTER
    /// processing measure `mi`). Length == `resolved.len()`.
    pub boundary_fps: Vec<u64>,
    /// Carried state going INTO measure `mi + 1` (AFTER processing measure
    /// `mi`). Same length as `boundary_fps`. The scoped restart point reads
    /// `boundary_states[dirty_start - 1]` (or `initial_state` if
    /// `dirty_start == 0`) to seed the rewind.
    pub boundary_states: Vec<BoundaryState>,
    /// Initial carried state at the start of the staff (before measure 0).
    pub initial_state: BoundaryState,
    /// Resolved transposition for this staff, captured once at full resolve.
    /// Invariant w.r.t. the dirty range, so carried verbatim.
    pub transposition: Option<(i32, i32)>,
    pub key_fifths_flip_at: Option<i32>,
}

pub(crate) struct CachedMmrPlan {
    pub start_map: HashMap<usize, u32>,
    pub skip_measures: HashSet<usize>,
    pub visible_indices: Vec<usize>,
}

#[derive(Clone, Copy)]
pub(crate) struct HorizonStaffExtent {
    pub below: f64,
    pub above: f64,
}

/// Measure-level layout cache.
///
/// Stores natural widths keyed by (measure_index, content_hash).
/// Optionally stores full layout data for horizon-mode reuse.
/// When the config changes, the entire cache is invalidated.
pub struct LayoutCache {
    /// Natural widths indexed by measure index.
    natural_widths: HashMap<usize, CachedWidth>,
    /// Full measure layout data indexed by cache key.
    /// Stored at x=0; consumers translate to the desired x position.
    full_layouts: HashMap<usize, CachedMeasureData>,
    /// Rendered system segments indexed by render-identity hash. Rebuilt every
    /// auto-flow pass (taken out at the start, repopulated during the loop) so
    /// stale entries from reflowed systems cannot accumulate.
    retained_segments: HashMap<u64, RetainedSegment>,
    /// Number of staff-content prefixes copied from retained system segments
    /// during the most recent pass.
    staff_content_reuses: usize,
    staff_content_reuse_runs: usize,
    staff_aux_reuses: usize,
    last_spanner_bounds_full: usize,
    last_spanner_bounds: usize,
    /// Assembled measures retained for move-based reuse, indexed by `cache_key`.
    /// Rebuilt every auto-flow pass (taken at precompute start, repopulated
    /// after the render loop) so measures dropped by an edit cannot leak.
    retained_measures: HashMap<usize, RetainedMeasure>,
    /// Step 4 (B-full system-layout retention skip): per-system assembled
    /// layouts retained for *wholesale* move-based reuse, indexed by system
    /// index. Engaged only when [`Self::system_layout_reuse_enabled`] is on, in
    /// which case it REPLACES `retained_measures` as the retention store: a
    /// system whose `layout_signature` matches the cached entry is moved back in
    /// whole (one move + a uniform x-translate), skipping the per-measure
    /// HashMap churn AND the cross-staff fix. A system whose signature changed
    /// is rebuilt fresh. Rebuilt every pass (taken at precompute start,
    /// repopulated after the render loop); trimmed to the current system count.
    cached_system_layouts: Vec<Option<CachedSystemLayout>>,
    /// Immutable MMR grouping keyed by the exact first resolved-staff snapshot
    /// and authored grouping inputs. Unaffected snapshots preserve Arc identity.
    cached_mmr_plan: Option<(Weak<[ResolvedMeasure]>, u64, Arc<CachedMmrPlan>)>,
    last_mmr_plan_reused: bool,
    /// Ordered render-identity hashes of the systems placed in the *last*
    /// patch-enabled pass — the order the client currently holds its segments
    /// in. Used to resolve `SystemPlacement::Reuse { prev_index }`.
    last_system_order: Vec<u64>,
    /// Lever 1 (per-region skip): hash of the system-break membership
    /// (`plan.systems` — which measures land in which system) from the most
    /// recent auto-flow pass. When the next pass recomputes the same membership
    /// hash, every system's measure set is provably unchanged, so a clean
    /// (outside-dirty-range) system's `render_hash` need not be recomputed —
    /// it is carried forward from `last_system_order`. `None` on a cold cache
    /// or after invalidation, which forces the full (recompute-every-hash) path.
    last_break_plan_hash: Option<u64>,
    /// Exact visible-measure membership by system from the prior pass. Used by
    /// front-half passes to establish a reconvergence frontier before render
    /// hashes are available.
    last_system_membership: Vec<Vec<usize>>,
    /// Current systems whose exact membership matched a different prior
    /// ordinal, proving a width-changing prefix reconverged to a reusable
    /// suffix rather than merely retaining an unchanged plan.
    membership_reconvergence_reuses: usize,
    /// When true, the auto-flow render loop records a [`PatchFrame`] delta into
    /// `pending_patch` for the wasm layer to encode. Off by default so the
    /// full-DisplayList path pays no extra cost.
    patch_frame_enabled: bool,
    /// Step 4 (B-full): when true, precompute engages the per-system
    /// `cached_system_layouts` wholesale-reuse store instead of the per-measure
    /// `retained_measures` store. Off by default so the shipped path is
    /// byte-for-byte unchanged; the oracle flips it on to prove byte-identity +
    /// non-vacuous engagement (`system_layout_reuse_hits > 0`).
    system_layout_reuse_enabled: bool,
    /// The delta frame produced by the most recent patch-enabled pass, awaiting
    /// retrieval + encode by the wasm layer. `None` if patch emission was
    /// disabled or the pass could not produce a valid delta (caller falls back
    /// to a full frame).
    pending_patch: Option<PatchFrame>,
    /// Inclusive measure-index range `[start, end]` covering the measures the
    /// most recent patch changed, plumbed forward from `apply_patch_and_layout_*`
    /// for range-scoped front-half passes (Phases A–D). `None` means "no range
    /// info — fall back to full" (initial load, full layout, config change, or
    /// a `globalMeasures` patch that can reflow every following system).
    /// Consumed + cleared by `layout_auto_flow_mnx_score`.
    pending_dirty_region: Option<DirtyRegion>,
    /// Per-pass toggles for each range-scoped front-half pass. Default `false`
    /// for every pass so the engine behaves identically to today; flipped on
    /// per pass by the oracle (and eventually by Phase F once each phase is
    /// proven). A scoped pass is engaged only if `pending_dirty_range` is
    /// `Some(_)` AND its toggle is on AND the range survives the `|dirty| > K`
    /// guard (see [`Self::effective_dirty_range`]).
    range_scope: RangeScope,
    /// Per-staff resolve cache for Phase A (range-scoped `resolve_staves`).
    /// `None` until the first full resolve populates it; dropped via
    /// [`Self::invalidate`] or when [`Self::take_resolved_staves`] is called
    /// with a non-matching salt (different flat-staff layout).
    resolved_staves: Option<Vec<CachedResolvedStaff>>,
    /// Salt identifying the layout structure (flat-staves identity, use_written,
    /// and measure_count) under which `resolved_staves` was built.
    /// Mismatch ⇒ drop.
    resolved_staves_salt: u64,
    /// Sum of `(converge_index - dirty_start)` across all staves on the most
    /// recent scoped resolve pass — the "resolved span." When `scoped_resolve`
    /// is on AND the cache was used, this records how few measures actually
    /// re-ran (vs. the full `staves * measure_count`). Used by the oracle for
    /// the non-vacuous "resolved_span < N" assertion. Reset every resolve pass.
    last_resolved_span: usize,
    /// Total measures the most recent resolve pass *could* have run over
    /// (staves × measure_count). The non-vacuous guard requires
    /// `last_resolved_span < last_resolved_full_span` for at least one fixture.
    last_resolved_full_span: usize,
    /// Number of staff-measure cells whose natural-width content was validated
    /// or recomputed in the most recent pass. Unaffected staff cells served by
    /// the unchecked cache path are excluded.
    last_width_span: usize,
    /// Full staff × measure width-cell count for the same pass.
    last_width_full_span: usize,
    /// Phase G/H: per-system cached output of `compute_system_spacing`,
    /// indexed by system index, keyed by the signature of the system's
    /// inputs (measure indices + per-measure content hashes + sp +
    /// chunked + is_first_in_plan). Reused when the signature matches the
    /// prior pass — skips the per-system spacing solver, which dominates
    /// `precompute_system_layouts` on warm rebuilds.
    cached_system_spacings: Vec<Option<CachedSystemSpacing>>,
    /// Phase T: per-system cached output of `compute_system_extras`,
    /// indexed by system index, keyed by a signature over the system's
    /// per-staff measure content hashes plus the layout knobs that affect
    /// the extras (sp, stem_length, default_intra_staff_clearance). When the
    /// signature matches, the three extras values (below, above,
    /// system_height) are reused — skipping the per-measure highest/lowest
    /// scans that otherwise scale with total score size every edit.
    cached_system_extras: Vec<Option<CachedSystemExtras>>,
    /// Phase P: per-measure max-width budget output of
    /// `compute_natural_measure_widths`, indexed by measure index. Reused on
    /// scoped relayout: measures outside the dirty range keep their cached
    /// width (which fed into the per-staff loop on the prior pass), so the
    /// max_widths slot is overwritten only for in-range measures. Trimmed
    /// to current measure count at end of pass.
    cached_max_widths: Vec<f64>,
    /// Phase R: cached output of only the expensive cross-system slur/tie
    /// post-pass. Page-turn hints are rendered fresh exactly once and belong
    /// only to the patch-frame overlay, not this cache. Keyed by a complete
    /// hash of the global slur/tie snapshots, bounds, and seam mode.
    cached_overlay: Option<(u64, DisplayList)>,
    /// Exact config snapshot from the last layout pass. `LayoutConfig` has
    /// dozens of nested layout/render inputs; comparing the full value avoids
    /// stale retained output when a newly-added field is forgotten by a
    /// hand-maintained subset hash.
    config_snapshot: Option<LayoutConfig>,
    time_signature_settings_prepared: bool,
    /// Number of cache hits in the last layout pass.
    hits: usize,
    /// Number of cache misses in the last layout pass.
    misses: usize,
    /// Phase C: number of trust-the-cache lookups that hit (i.e. measures
    /// outside the dirty range whose content-hash check was skipped). Reset
    /// by [`Self::reset_stats`]. The oracle proves non-vacuous engagement by
    /// asserting `unchecked_hits > 0` on at least one fixture.
    unchecked_hits: usize,
    /// Phase G/H: number of systems whose `compute_system_spacing` output was
    /// reused from cache (skipped the solver) on the most recent pass. Reset
    /// by [`Self::reset_stats`]. The oracle proves non-vacuous engagement by
    /// asserting `system_spacing_reuse_hits > 0`.
    system_spacing_reuse_hits: usize,
    /// Step 4 (B-full): number of systems reused WHOLESALE from
    /// `cached_system_layouts` on the most recent pass (signature match → one
    /// move + translate, skipping the per-measure loop + cross-staff fix). Reset
    /// by [`Self::reset_stats`]. The oracle asserts `> 0` for non-vacuous proof.
    system_layout_reuse_hits: usize,
    system_measure_reuse_hits: usize,
    /// Phase T: number of systems whose `compute_system_extras` output was
    /// reused from cache (skipped the highest/lowest scans) on the most
    /// recent pass. Reset by [`Self::reset_stats`].
    system_extras_reuse_hits: usize,
    /// Lever 1 (per-region skip): number of systems whose `system_render_hash`
    /// recompute was skipped on the most recent pass because the break plan was
    /// stable and the system (and its successor) were outside the dirty range.
    /// Reset by [`Self::reset_stats`]. The oracle proves non-vacuous engagement
    /// by asserting `render_hash_skips > 0` on a scoped edit.
    render_hash_skips: usize,
    /// Fresh/reused system placement counts in the most recently produced
    /// patch frame. These are deterministic engagement metrics exposed to the
    /// browser profiler.
    last_patch_fresh_systems: usize,
    last_patch_reused_systems: usize,
    /// Lever 1 (per-region skip): per-system staff Y offsets RELATIVE to the
    /// system base (`offset[i] - sys_y_base`), indexed by `sys_idx`. For a clean
    /// system on a stable + same-justification pass, the relative offsets are
    /// byte-identical to last pass (content + justification unchanged), so the
    /// expensive `compute_staff_y_offsets_for_system` protrusion scan is skipped
    /// and the absolute offsets are reconstructed as `rel[i] + sys_y_base`.
    /// Rebuilt every pass (entries overwritten for recomputed systems, reused
    /// for skipped ones); trimmed to `system_count`.
    cached_staff_y_rel: Vec<Vec<f64>>,
    /// Lever 1 (per-region skip): per-system `(justified_gap, intra_clearance)`
    /// from the prior pass, indexed by `sys_idx`. These two scalars are the only
    /// per-system justification inputs to a clean system's `system_render_hash`
    /// (via its relative staff offsets). A height-changing edit re-justifies
    /// only the page(s) it lands on, so comparing PER SYSTEM — rather than
    /// folding the whole vectors into the global break-plan hash — keeps every
    /// system on an unaffected page skippable. Rebuilt every pass; trimmed to
    /// `system_count`.
    cached_system_gaps: Vec<(f64, f64)>,
    /// Stitched-horizon chunk membership retained under a salt of the visible
    /// measure sequence + chunk-width configuration. Chunk seams carry no
    /// engraving semantics, so preserving a valid prior partition across
    /// local width edits prevents cumulative-width boundary fan-out while the
    /// flattened display list remains byte-identical.
    cached_horizon_chunks: Option<(u64, Vec<Vec<usize>>)>,
    last_horizon_chunks_reused: bool,
    cached_horizon_staff_extents: Vec<HorizonStaffExtent>,
    last_horizon_staff_extents_reused: usize,
    cached_horizon_tie_maps: Vec<HashMap<String, bool>>,
    last_horizon_tie_maps_reused: usize,
}

/// Phase G/H cached output of `compute_system_spacing` for one system. The
/// signature identifies what inputs produced this output; on a later pass with
/// a matching signature we reuse `merged_spacings` + `sys_prefix_widths`
/// verbatim instead of re-running the solver.
#[derive(Clone)]
pub(crate) struct CachedSystemSpacing {
    pub signature: u64,
    pub merged_spacings: Vec<LogSpacing>,
    pub sys_prefix_widths: Vec<AlignedPrefix>,
}

/// Phase T cached output of `compute_system_extras` for one system. The
/// signature folds the per-(measure, staff) content hashes for every staff in
/// the system plus the layout knobs the extras depend on (sp, stem_length,
/// default_intra_staff_clearance). When it matches, the three extras values
/// are reused verbatim — skipping the per-measure highest/lowest scans that
/// otherwise scale with total score size on every edit.
#[derive(Clone, Copy)]
pub(crate) struct CachedSystemExtras {
    pub signature: u64,
    pub below_staff_extra: f64,
    pub above_staff_extra: f64,
    pub system_height_px: f64,
}

/// Step 4 (B-full) cached assembled layouts for one whole system. The
/// `signature` (a `layout_signature` over the system's measure membership +
/// content hashes + the width-stretch inputs `scale` / `first_extra_prefix` +
/// seam state) identifies what inputs produced these layouts. On a later pass
/// with a matching signature, the entire `all_staff_layouts` is moved back in
/// and uniformly x-translated by `new_margin_left - margin_left` — skipping the
/// per-measure reuse loop, the compound-hash recompute, and the whole-system
/// cross-staff fix. `content_hashes` / `restore_meta` are carried verbatim so
/// the render loop and the next-pass re-store see the same parallel data the
/// per-measure path would have produced.
pub(crate) struct CachedSystemLayout {
    pub signature: u64,
    /// The left margin the stored layouts were assembled at; the reuse path
    /// translates by `new_margin_left - margin_left` (always 0 in paged mode,
    /// where each system independently starts at its page margin).
    pub margin_left: f64,
    pub all_staff_layouts: Vec<Vec<MeasureLayout>>,
    pub content_hashes: Vec<Vec<u64>>,
    pub restore_meta: Vec<Vec<(usize, u64)>>,
}

impl Default for LayoutCache {
    fn default() -> Self {
        Self::new()
    }
}

impl LayoutCache {
    pub fn new() -> Self {
        Self {
            natural_widths: HashMap::new(),
            full_layouts: HashMap::new(),
            retained_segments: HashMap::new(),
            staff_content_reuses: 0,
            staff_content_reuse_runs: 0,
            staff_aux_reuses: 0,
            last_spanner_bounds_full: 0,
            last_spanner_bounds: 0,
            retained_measures: HashMap::new(),
            cached_system_layouts: Vec::new(),
            cached_mmr_plan: None,
            last_mmr_plan_reused: false,
            last_system_order: Vec::new(),
            last_break_plan_hash: None,
            last_system_membership: Vec::new(),
            membership_reconvergence_reuses: 0,
            patch_frame_enabled: false,
            system_layout_reuse_enabled: false,
            pending_patch: None,
            pending_dirty_region: None,
            range_scope: RangeScope::default(),
            resolved_staves: None,
            resolved_staves_salt: 0,
            last_resolved_span: 0,
            last_resolved_full_span: 0,
            last_width_span: 0,
            last_width_full_span: 0,
            cached_system_spacings: Vec::new(),
            cached_system_extras: Vec::new(),
            cached_max_widths: Vec::new(),
            cached_overlay: None,
            config_snapshot: None,
            time_signature_settings_prepared: false,
            hits: 0,
            misses: 0,
            unchecked_hits: 0,
            system_spacing_reuse_hits: 0,
            system_layout_reuse_hits: 0,
            system_measure_reuse_hits: 0,
            system_extras_reuse_hits: 0,
            render_hash_skips: 0,
            last_patch_fresh_systems: 0,
            last_patch_reused_systems: 0,
            cached_staff_y_rel: Vec::new(),
            cached_system_gaps: Vec::new(),
            cached_horizon_chunks: None,
            last_horizon_chunks_reused: false,
            cached_horizon_staff_extents: Vec::new(),
            last_horizon_staff_extents_reused: 0,
            cached_horizon_tie_maps: Vec::new(),
            last_horizon_tie_maps_reused: 0,
        }
    }

    /// Invalidate the entire cache.
    pub fn invalidate(&mut self) {
        self.invalidate_layout_products();
        self.cached_mmr_plan = None;
        self.pending_dirty_region = None;
        self.resolved_staves = None;
        self.resolved_staves_salt = 0;
        self.time_signature_settings_prepared = false;
    }

    fn invalidate_layout_products(&mut self) {
        self.natural_widths.clear();
        self.full_layouts.clear();
        self.retained_segments.clear();
        self.staff_content_reuses = 0;
        self.staff_content_reuse_runs = 0;
        self.staff_aux_reuses = 0;
        self.last_spanner_bounds_full = 0;
        self.last_spanner_bounds = 0;
        self.retained_measures.clear();
        self.cached_system_layouts.clear();
        self.last_mmr_plan_reused = false;
        self.last_system_order.clear();
        self.last_break_plan_hash = None;
        self.last_system_membership.clear();
        self.membership_reconvergence_reuses = 0;
        self.pending_patch = None;
        self.cached_system_spacings.clear();
        self.cached_system_extras.clear();
        self.cached_max_widths.clear();
        self.cached_overlay = None;
        self.cached_staff_y_rel.clear();
        self.cached_system_gaps.clear();
        self.cached_horizon_chunks = None;
        self.last_horizon_chunks_reused = false;
        self.cached_horizon_staff_extents.clear();
        self.last_horizon_staff_extents_reused = 0;
        self.cached_horizon_tie_maps.clear();
        self.last_horizon_tie_maps_reused = 0;
        self.last_patch_fresh_systems = 0;
        self.last_patch_reused_systems = 0;
    }

    /// Reset per-pass hit/miss counters.
    pub(crate) fn reset_stats(&mut self) {
        self.hits = 0;
        self.misses = 0;
        self.unchecked_hits = 0;
        self.system_spacing_reuse_hits = 0;
        self.system_layout_reuse_hits = 0;
        self.system_measure_reuse_hits = 0;
        self.system_extras_reuse_hits = 0;
        self.render_hash_skips = 0;
    }

    /// (test) Phase C unchecked-hit count from the most recent pass.
    #[cfg(test)]
    pub(crate) fn unchecked_hits(&self) -> usize {
        self.unchecked_hits
    }

    /// Phase G/H: bump the per-pass system-spacing reuse counter. Called from
    /// `precompute_system_layouts` whenever a system's signature matches the
    /// cached entry and `compute_system_spacing` is skipped.
    pub(crate) fn bump_system_spacing_reuse(&mut self) {
        self.system_spacing_reuse_hits += 1;
    }

    /// (test) Phase G/H system-spacing reuse hits from the most recent pass.
    #[cfg(test)]
    pub(crate) fn system_spacing_reuse_hits(&self) -> usize {
        self.system_spacing_reuse_hits
    }

    /// Lever 1: record how many systems skipped their `system_render_hash`
    /// recompute on the most recent pass (set once after the render loop).
    pub(crate) fn set_render_hash_skips(&mut self, n: usize) {
        self.render_hash_skips = n;
    }

    /// (test) Lever 1 render-hash skip count from the most recent pass.
    #[cfg(test)]
    pub(crate) fn render_hash_skips(&self) -> usize {
        self.render_hash_skips
    }

    /// Lever 1: take ownership of the cached per-system relative staff offsets
    /// (leaving an empty Vec), so the render loop can both read prior entries
    /// and rebuild a fresh vector to re-store via [`Self::set_staff_y_rel`].
    pub(crate) fn take_staff_y_rel(&mut self) -> Vec<Vec<f64>> {
        std::mem::take(&mut self.cached_staff_y_rel)
    }

    /// Lever 1: store the per-system relative staff offsets for the next pass.
    pub(crate) fn set_staff_y_rel(&mut self, rel: Vec<Vec<f64>>) {
        self.cached_staff_y_rel = rel;
    }

    /// Lever 1: take ownership of the cached per-system `(justified_gap,
    /// intra_clearance)` pairs (leaving an empty Vec) so the render loop can
    /// compare each system's prior justification against the current pass and
    /// rebuild a fresh vector to re-store via [`Self::set_system_gaps`].
    pub(crate) fn take_system_gaps(&mut self) -> Vec<(f64, f64)> {
        std::mem::take(&mut self.cached_system_gaps)
    }

    /// Lever 1: store the per-system justification pairs for the next pass.
    pub(crate) fn set_system_gaps(&mut self, gaps: Vec<(f64, f64)>) {
        self.cached_system_gaps = gaps;
    }

    /// Phase G/H: lookup the cached system-spacing entry for `sys_idx`. Returns
    /// `Some(entry)` only when an entry exists at that index AND its signature
    /// matches `signature`. The caller is responsible for re-storing a fresh
    /// entry on miss via [`Self::set_cached_system_spacing`].
    pub(crate) fn get_cached_system_spacing(
        &self,
        sys_idx: usize,
        signature: u64,
    ) -> Option<&CachedSystemSpacing> {
        self.cached_system_spacings
            .get(sys_idx)
            .and_then(|slot| slot.as_ref())
            .filter(|entry| entry.signature == signature)
    }

    /// Phase G/H: store a fresh system-spacing entry at `sys_idx`, growing the
    /// vector as needed. Called on cache miss after a fresh
    /// `compute_system_spacing` call.
    pub(crate) fn set_cached_system_spacing(&mut self, sys_idx: usize, entry: CachedSystemSpacing) {
        if sys_idx >= self.cached_system_spacings.len() {
            self.cached_system_spacings
                .resize_with(sys_idx + 1, || None);
        }
        self.cached_system_spacings[sys_idx] = Some(entry);
    }

    /// Phase G/H: trim the cached system-spacing vector to `system_count`. Call
    /// at the end of a pass so a layout that shrunk the system count drops the
    /// dead trailing entries.
    pub(crate) fn truncate_cached_system_spacings(&mut self, system_count: usize) {
        self.cached_system_spacings.truncate(system_count);
    }

    /// Phase T: bump the per-pass system-extras reuse counter.
    pub(crate) fn bump_system_extras_reuse(&mut self) {
        self.system_extras_reuse_hits += 1;
    }

    /// (test) Phase T system-extras reuse hits from the most recent pass.
    #[cfg(test)]
    #[allow(dead_code)] // instrumentation accessor; called only by ignored perf probes
    pub(crate) fn system_extras_reuse_hits(&self) -> usize {
        self.system_extras_reuse_hits
    }

    /// Phase T: lookup the cached extras entry for `sys_idx`. Returns
    /// `Some(entry)` only when an entry exists at that index AND its signature
    /// matches `signature`. Caller re-stores fresh on miss via
    /// [`Self::set_cached_system_extras`].
    pub(crate) fn get_cached_system_extras(
        &self,
        sys_idx: usize,
        signature: u64,
    ) -> Option<&CachedSystemExtras> {
        self.cached_system_extras
            .get(sys_idx)
            .and_then(|slot| slot.as_ref())
            .filter(|entry| entry.signature == signature)
    }

    pub(crate) fn get_cached_system_extras_unchecked(
        &self,
        sys_idx: usize,
    ) -> Option<&CachedSystemExtras> {
        self.cached_system_extras
            .get(sys_idx)
            .and_then(|slot| slot.as_ref())
    }

    /// Phase T: store a fresh extras entry at `sys_idx`, growing the vector as
    /// needed. Called on cache miss after a fresh `compute_system_extras`
    /// call.
    pub(crate) fn set_cached_system_extras(&mut self, sys_idx: usize, entry: CachedSystemExtras) {
        if sys_idx >= self.cached_system_extras.len() {
            self.cached_system_extras.resize_with(sys_idx + 1, || None);
        }
        self.cached_system_extras[sys_idx] = Some(entry);
    }

    /// Phase T: trim the cached extras vector to `system_count`. Call at the
    /// end of a pass so a layout that shrunk the system count drops the dead
    /// trailing entries.
    pub(crate) fn truncate_cached_system_extras(&mut self, system_count: usize) {
        self.cached_system_extras.truncate(system_count);
    }

    /// Phase P: take the cached max_widths vector if its length matches
    /// `measure_count`, leaving an empty Vec behind. Caller overwrites the
    /// dirty range and re-stores via [`Self::set_cached_max_widths`]. Returns
    /// `None` on length mismatch (cold cache or measure-count change) so the
    /// caller falls back to a full compute.
    pub(crate) fn take_cached_max_widths(&mut self, measure_count: usize) -> Option<Vec<f64>> {
        if self.cached_max_widths.len() == measure_count {
            Some(std::mem::take(&mut self.cached_max_widths))
        } else {
            self.cached_max_widths.clear();
            None
        }
    }

    /// Phase P: store the rebuilt max_widths vector for the next pass to take.
    pub(crate) fn set_cached_max_widths(&mut self, max_widths: Vec<f64>) {
        self.cached_max_widths = max_widths;
    }

    /// Phase R: get the cached overlay if its signature matches. Returns
    /// `Some(&DisplayList)` to splice; the caller is responsible for
    /// re-storing via `set_cached_overlay` if it builds fresh (with the new
    /// signature).
    pub(crate) fn get_cached_overlay(&self, signature: u64) -> Option<&DisplayList> {
        self.cached_overlay
            .as_ref()
            .and_then(|(sig, dl)| if *sig == signature { Some(dl) } else { None })
    }

    /// Phase R: store the fresh overlay with its inputs' signature.
    pub(crate) fn set_cached_overlay(&mut self, signature: u64, overlay: DisplayList) {
        self.cached_overlay = Some((signature, overlay));
    }

    /// Phase G/H: expose the per-(measure, staff) content hash captured by
    /// `compute_natural_measure_widths` (it's stored alongside the cached
    /// natural width, keyed by `cache_key = mi * 1000 + staff_idx`).
    /// `precompute_system_layouts` reads this to build per-system signatures
    /// cheaply without re-running the per-measure JSON serialize. Returns
    /// `None` for measures absent from the natural-widths cache (MMR-interior
    /// measures and cold-cache misses).
    pub(crate) fn natural_width_content_hash(&self, cache_key: usize) -> Option<u64> {
        self.natural_widths.get(&cache_key).map(|c| c.content_hash)
    }

    /// Check and update the exact config snapshot. Invalidates cache if any
    /// layout/render input changed.
    /// Returns true if config changed (cache was cleared).
    pub(crate) fn check_config(&mut self, config: &LayoutConfig) -> bool {
        let Some(previous) = self.config_snapshot.as_ref() else {
            self.invalidate();
            self.config_snapshot = Some(config.clone());
            return true;
        };
        if previous == config {
            self.time_signature_settings_prepared = false;
            return false;
        }

        let mut without_time_signature_change = config.clone();
        without_time_signature_change.time_signature_settings = previous.time_signature_settings;
        if &without_time_signature_change == previous {
            if self.time_signature_settings_prepared {
                self.time_signature_settings_prepared = false;
            } else {
                self.invalidate_layout_products();
            }
        } else {
            self.invalidate();
        }
        self.config_snapshot = Some(config.clone());
        true
    }

    pub fn prepare_time_signature_settings_change(&mut self, measure_indices: &[usize]) {
        let changed: HashSet<usize> = measure_indices.iter().copied().collect();
        self.natural_widths
            .retain(|cache_key, _| !changed.contains(&(cache_key / 1000)));
        self.full_layouts.clear();
        self.time_signature_settings_prepared = true;
    }

    /// Look up a cached natural width for a measure.
    /// Returns Some(width) if the measure content hasn't changed.
    pub(crate) fn get_natural_width(
        &mut self,
        measure_index: usize,
        content_hash: u64,
    ) -> Option<f64> {
        if let Some(cached) = self.natural_widths.get(&measure_index) {
            if cached.content_hash == content_hash {
                self.hits += 1;
                return Some(cached.width);
            }
        }
        self.misses += 1;
        None
    }

    /// Phase C: trust-the-cache lookup that skips the content-hash comparison.
    /// Only safe when the caller knows the measure is OUTSIDE the patch's
    /// dirty range — outside-range measures can't have changed since the prior
    /// pass, so the cached entry must still reflect their content.
    /// Increments `unchecked_hits` so the oracle can prove non-vacuous
    /// engagement of the Phase C path.
    pub(crate) fn get_natural_width_unchecked(&mut self, measure_index: usize) -> Option<f64> {
        let r = self.natural_widths.get(&measure_index).map(|c| c.width);
        if r.is_some() {
            self.unchecked_hits += 1;
        }
        r
    }

    /// Store a measure's natural width in the cache.
    pub(crate) fn set_natural_width(
        &mut self,
        measure_index: usize,
        content_hash: u64,
        width: f64,
    ) {
        self.natural_widths.insert(
            measure_index,
            CachedWidth {
                content_hash,
                width,
            },
        );
    }

    /// Look up a cached full measure layout.
    /// Returns cloned voice_layouts, prefix_width, mid_clef_changes, and width
    /// if the content hash matches. The returned data is at x=0; the caller
    /// must translate to the desired x position.
    pub(crate) fn get_full_layout(
        &self,
        cache_key: usize,
        content_hash: u64,
    ) -> Option<CachedMeasureLayout> {
        if let Some(cached) = self.full_layouts.get(&cache_key) {
            if cached.content_hash == content_hash {
                return Some(CachedMeasureLayout {
                    voice_layouts: cached.voice_layouts.clone(),
                    prefix_width: cached.prefix_width,
                    first_onset_padding: cached.first_onset_padding,
                    time_signature_x_offset: cached.time_signature_x_offset,
                    mid_clef_changes: cached.mid_clef_changes.clone(),
                    width: cached.width,
                });
            }
        }
        None
    }

    /// Phase C: trust-the-cache lookup that skips the content-hash comparison.
    /// Only safe when the caller knows the measure is OUTSIDE the patch's
    /// dirty range. Increments `unchecked_hits`.
    #[allow(dead_code)] // WIP patch-frame fast path; not yet wired into the live pass
    pub(crate) fn get_full_layout_unchecked(
        &mut self,
        cache_key: usize,
    ) -> Option<CachedMeasureLayout> {
        let r = self
            .full_layouts
            .get(&cache_key)
            .map(|c| CachedMeasureLayout {
                voice_layouts: c.voice_layouts.clone(),
                prefix_width: c.prefix_width,
                first_onset_padding: c.first_onset_padding,
                time_signature_x_offset: c.time_signature_x_offset,
                mid_clef_changes: c.mid_clef_changes.clone(),
                width: c.width,
            });
        if r.is_some() {
            self.unchecked_hits += 1;
        }
        r
    }

    /// Store a full measure layout in the cache.
    /// The layout data should be at x=0 (caller normalizes before storing).
    pub(crate) fn set_full_layout(
        &mut self,
        cache_key: usize,
        content_hash: u64,
        width: f64,
        voice_layouts: &[VoiceLayout],
        prefix_width: f64,
        first_onset_padding: f64,
        time_signature_x_offset: Option<f64>,
        mid_clef_changes: &[MidClefChange],
    ) {
        self.full_layouts.insert(
            cache_key,
            CachedMeasureData {
                content_hash,
                width,
                voice_layouts: voice_layouts.to_vec(),
                prefix_width,
                first_onset_padding,
                time_signature_x_offset,
                mid_clef_changes: mid_clef_changes.to_vec(),
            },
        );
    }

    /// Take ownership of the retained-segment store, leaving it empty.
    ///
    /// The auto-flow render loop drains the old store at the start of a pass,
    /// reuses entries that still match, and re-inserts the survivors into a
    /// fresh map that is handed back via `set_retained_segments`. Draining (vs.
    /// in-place mutation) guarantees segments belonging to reflowed systems are
    /// evicted rather than leaking across the session.
    pub(crate) fn take_retained_segments(&mut self) -> HashMap<u64, RetainedSegment> {
        std::mem::take(&mut self.retained_segments)
    }

    /// Install the retained-segment store rebuilt during a layout pass.
    pub(crate) fn set_retained_segments(&mut self, segments: HashMap<u64, RetainedSegment>) {
        self.retained_segments = segments;
    }

    pub(crate) fn set_staff_content_reuses(&mut self, count: usize) {
        self.staff_content_reuses = count;
    }

    pub(crate) fn set_staff_content_reuse_runs(&mut self, count: usize) {
        self.staff_content_reuse_runs = count;
    }

    pub(crate) fn cached_mmr_plan(
        &mut self,
        first_staff: &Arc<[ResolvedMeasure]>,
        input_signature: u64,
    ) -> Option<Arc<CachedMmrPlan>> {
        let reused = self
            .cached_mmr_plan
            .as_ref()
            .filter(|(snapshot, signature, _)| {
                *signature == input_signature
                    && snapshot
                        .upgrade()
                        .is_some_and(|cached| Arc::ptr_eq(&cached, first_staff))
            })
            .map(|(_, _, plan)| Arc::clone(plan));
        self.last_mmr_plan_reused = reused.is_some();
        reused
    }

    pub(crate) fn set_cached_mmr_plan(
        &mut self,
        first_staff: &Arc<[ResolvedMeasure]>,
        input_signature: u64,
        plan: Arc<CachedMmrPlan>,
    ) {
        self.cached_mmr_plan = Some((Arc::downgrade(first_staff), input_signature, plan));
    }

    pub fn last_mmr_plan_reused(&self) -> bool {
        self.last_mmr_plan_reused
    }

    pub fn staff_content_reuses(&self) -> usize {
        self.staff_content_reuses
    }

    pub fn staff_content_reuse_runs(&self) -> usize {
        self.staff_content_reuse_runs
    }

    pub(crate) fn set_staff_aux_reuses(&mut self, count: usize) {
        self.staff_aux_reuses = count;
    }

    pub fn staff_aux_reuses(&self) -> usize {
        self.staff_aux_reuses
    }

    pub(crate) fn set_spanner_bound_counts(&mut self, full: usize, compact: usize) {
        self.last_spanner_bounds_full = full;
        self.last_spanner_bounds = compact;
    }

    pub fn last_spanner_bounds_full(&self) -> usize {
        self.last_spanner_bounds_full
    }

    pub fn last_spanner_bounds(&self) -> usize {
        self.last_spanner_bounds
    }

    /// Enable/disable patch-frame delta recording for subsequent passes.
    pub fn set_patch_frame_enabled(&mut self, enabled: bool) {
        self.patch_frame_enabled = enabled;
    }

    /// Whether the auto-flow render loop should record a [`PatchFrame`] delta.
    pub(crate) fn patch_frame_enabled(&self) -> bool {
        self.patch_frame_enabled
    }

    /// Set the inclusive `[start, end]` measure range covering the most recent
    /// patch's changed measures. Wasm calls this immediately before invoking
    /// layout; `layout_auto_flow_mnx_score` consumes + clears it via
    /// [`Self::take_pending_dirty_range`]. Pass `None` to force the full path
    /// (initial load, full layout, config change, or a `globalMeasures` patch
    /// that can reflow every following system).
    pub fn set_pending_dirty_region(&mut self, region: Option<DirtyRegion>) {
        self.pending_dirty_region = region;
    }

    /// Compatibility shim for range-only native callers. The resulting region
    /// deliberately affects all staves; production patch plumbing should call
    /// [`Self::set_pending_dirty_region`] with an explicit part mask.
    pub fn set_pending_dirty_range(&mut self, range: Option<(usize, usize)>) {
        self.pending_dirty_region = range.map(|(start, end)| DirtyRegion::all_staves(start, end));
    }

    /// Consume the complete pending dependency island.
    pub(crate) fn take_pending_dirty_region(&mut self) -> Option<DirtyRegion> {
        self.pending_dirty_region.take()
    }

    /// Consume the pending dirty range, leaving `None` so a subsequent layout
    /// without a fresh `set_pending_dirty_range` correctly falls back to full.
    pub(crate) fn take_pending_dirty_range(&mut self) -> Option<(usize, usize)> {
        self.take_pending_dirty_region()
            .map(|region| region.measure_range())
    }

    /// Compute the *effective* dirty range a scoped pass should respect, given
    /// the total measure count and the `|dirty| > K` guard. Returns `None` when
    /// the pass must fall back to full layout: no pending range, span exceeds
    /// `k`, or the range is out of bounds. Clamps `end` to `total - 1`.
    pub(crate) fn effective_dirty_range(
        range: Option<(usize, usize)>,
        total: usize,
        k: usize,
    ) -> Option<(usize, usize)> {
        let (start, end) = range?;
        if total == 0 || start >= total {
            return None;
        }
        let end = end.min(total - 1);
        if end < start {
            return None;
        }
        if end - start + 1 > k {
            return None;
        }
        Some((start, end))
    }

    /// Set the per-pass `RangeScope` toggles. Defaults are all `false`, which
    /// preserves today's full-rescan behavior identically.
    pub fn set_range_scope(&mut self, scope: RangeScope) {
        self.range_scope = scope;
    }

    /// Current per-pass toggles for the range-scoped front-half passes.
    pub(crate) fn range_scope(&self) -> RangeScope {
        self.range_scope
    }

    /// Take the per-staff resolve cache if its salt matches; otherwise return
    /// `None` (and the cache is dropped to free memory). Phase A calls this to
    /// own the prior resolved staves so it can splice over them; the caller is
    /// responsible for re-storing a fresh cache via [`Self::set_resolved_staves`].
    pub(crate) fn take_resolved_staves(&mut self, salt: u64) -> Option<Vec<CachedResolvedStaff>> {
        if self.resolved_staves_salt == salt {
            self.resolved_staves.take()
        } else {
            // Different staff layout — drop stale cache.
            self.resolved_staves = None;
            None
        }
    }

    /// Store the per-staff resolve cache under `salt`. Replaces any prior value.
    pub(crate) fn set_resolved_staves(&mut self, salt: u64, staves: Vec<CachedResolvedStaff>) {
        self.resolved_staves_salt = salt;
        self.resolved_staves = Some(staves);
    }

    /// Record the resolved span (sum over staves of `(converge - dirty_start)`)
    /// AND the matching full span (`staves * measure_count`) the most recent
    /// resolve pass touched. Used by the oracle's non-vacuous "scoped path
    /// actually engaged" assertion.
    pub(crate) fn set_last_resolved_span(&mut self, span: usize, full: usize) {
        self.last_resolved_span = span;
        self.last_resolved_full_span = full;
    }

    /// (test) Span the most recent resolve pass touched.
    pub fn last_resolved_span(&self) -> usize {
        self.last_resolved_span
    }

    /// (test) Full span the most recent resolve pass could have touched.
    pub fn last_resolved_full_span(&self) -> usize {
        self.last_resolved_full_span
    }

    pub(crate) fn set_last_width_span(&mut self, span: usize, full: usize) {
        self.last_width_span = span;
        self.last_width_full_span = full;
    }

    pub fn last_width_span(&self) -> usize {
        self.last_width_span
    }

    pub fn last_width_full_span(&self) -> usize {
        self.last_width_full_span
    }

    /// Snapshot of the prior pass's placement order (the order the client holds
    /// its per-system segments in), for resolving `Reuse { prev_index }`.
    pub(crate) fn last_system_order(&self) -> &[u64] {
        &self.last_system_order
    }

    /// Replace the recorded placement order after a patch-enabled pass.
    pub(crate) fn set_last_system_order(&mut self, order: Vec<u64>) {
        self.last_system_order = order;
    }

    /// Lever 1 (per-region skip): compare `new_hash` (the system-break
    /// membership hash of the current pass) against the stored hash from the
    /// previous pass, then store `new_hash` for the next comparison. Returns
    /// `true` only when a prior hash existed AND matched — i.e. the break plan
    /// is provably unchanged, so every system's measure membership is the same
    /// as last pass. A cold cache (no prior hash) returns `false`, forcing the
    /// full recompute-every-render-hash path.
    pub(crate) fn update_break_plan_stability(&mut self, new_hash: u64) -> bool {
        let stable = self.last_break_plan_hash == Some(new_hash);
        self.last_break_plan_hash = Some(new_hash);
        stable
    }

    /// Match each current system's exact measure membership to the prior pass.
    /// The returned prior index is a reconvergence frontier: it remains useful
    /// when a width-changing edit inserts/removes a system before a suffix, so
    /// callers must not assume current and prior ordinals are equal.
    pub(crate) fn update_system_membership(
        &mut self,
        systems: &[Vec<usize>],
    ) -> Vec<Option<usize>> {
        let prior_indices: HashMap<&[usize], usize> = self
            .last_system_membership
            .iter()
            .enumerate()
            .map(|(index, membership)| (membership.as_slice(), index))
            .collect();
        let matches = systems
            .iter()
            .map(|membership| prior_indices.get(membership.as_slice()).copied())
            .collect::<Vec<_>>();
        self.membership_reconvergence_reuses = matches
            .iter()
            .enumerate()
            .filter(|(current, prior)| prior.is_some_and(|prior| prior != *current))
            .count();
        self.last_system_membership = systems.to_vec();
        matches
    }

    pub fn membership_reconvergence_reuses(&self) -> usize {
        self.membership_reconvergence_reuses
    }

    /// Reuse an established stitched-horizon partition when its non-width
    /// identity matches. `candidate` is installed on cold/structural passes.
    pub(crate) fn stabilize_horizon_chunks(
        &mut self,
        salt: u64,
        candidate: Vec<Vec<usize>>,
    ) -> Vec<Vec<usize>> {
        if let Some((prior_salt, prior)) = &self.cached_horizon_chunks {
            if *prior_salt == salt {
                self.last_horizon_chunks_reused = true;
                return prior.clone();
            }
        }
        self.last_horizon_chunks_reused = false;
        self.cached_horizon_chunks = Some((salt, candidate.clone()));
        candidate
    }

    pub fn last_horizon_chunks_reused(&self) -> bool {
        self.last_horizon_chunks_reused
    }

    pub(crate) fn take_horizon_staff_extents(&mut self) -> Vec<HorizonStaffExtent> {
        std::mem::take(&mut self.cached_horizon_staff_extents)
    }

    pub(crate) fn set_horizon_staff_extents(
        &mut self,
        extents: Vec<HorizonStaffExtent>,
        reused: usize,
    ) {
        self.cached_horizon_staff_extents = extents;
        self.last_horizon_staff_extents_reused = reused;
    }

    pub fn last_horizon_staff_extents_reused(&self) -> usize {
        self.last_horizon_staff_extents_reused
    }

    pub(crate) fn take_horizon_tie_maps(&mut self) -> Vec<HashMap<String, bool>> {
        std::mem::take(&mut self.cached_horizon_tie_maps)
    }

    pub(crate) fn set_horizon_tie_maps(&mut self, maps: Vec<HashMap<String, bool>>, reused: usize) {
        self.cached_horizon_tie_maps = maps;
        self.last_horizon_tie_maps_reused = reused;
    }

    pub fn last_horizon_tie_maps_reused(&self) -> usize {
        self.last_horizon_tie_maps_reused
    }

    /// Store the delta frame produced by a patch-enabled pass.
    pub(crate) fn set_pending_patch(&mut self, patch: Option<PatchFrame>) {
        let (fresh, reused) = patch.as_ref().map_or((0, 0), |frame| {
            frame
                .placements
                .iter()
                .fold((0, 0), |(fresh, reused), placement| match placement {
                    SystemPlacement::Fresh { .. } => (fresh + 1, reused),
                    SystemPlacement::Reuse { .. } => (fresh, reused + 1),
                })
        });
        self.last_patch_fresh_systems = fresh;
        self.last_patch_reused_systems = reused;
        self.pending_patch = patch;
    }

    pub fn last_patch_fresh_systems(&self) -> usize {
        self.last_patch_fresh_systems
    }

    pub fn last_patch_reused_systems(&self) -> usize {
        self.last_patch_reused_systems
    }

    /// Take ownership of the most recent delta frame, leaving `None`.
    #[allow(dead_code)] // typed accessor; the live wasm path uses take_pending_patch_binary
    pub(crate) fn take_pending_patch(&mut self) -> Option<PatchFrame> {
        self.pending_patch.take()
    }

    /// Take the most recent delta frame and serialize it to packed `f32`s,
    /// leaving `None`. Public so the wasm layer can ship the delta across the
    /// boundary without naming the internal [`PatchFrame`] type.
    pub fn take_pending_patch_binary(&mut self) -> Option<Vec<f32>> {
        self.pending_patch.take().map(|patch| patch.to_binary())
    }

    /// Append `seg` to the pending patch frame's overlay, if one is recorded.
    /// Used by the caller to fold post-layout global content (e.g. a part-score
    /// name) into the delta so reconstruction stays byte-identical.
    pub(crate) fn fold_into_pending_overlay(&mut self, seg: DisplayList) {
        if let Some(patch) = self.pending_patch.as_mut() {
            patch.overlay.append(seg);
        }
    }

    /// Number of retained system segments currently held. For tests/diagnostics.
    #[cfg(test)]
    pub(crate) fn retained_segment_count(&self) -> usize {
        self.retained_segments.len()
    }

    /// Take ownership of the retained-measure store, leaving it empty.
    ///
    /// Precompute drains this at the start of a pass, *moves* matching measures
    /// into the system being assembled, and the caller re-installs the rebuilt
    /// map after the render loop via `set_retained_measures`. Draining evicts
    /// measures dropped by an edit (deleted/reflowed) so they cannot leak.
    pub(crate) fn take_retained_measures(&mut self) -> HashMap<usize, RetainedMeasure> {
        std::mem::take(&mut self.retained_measures)
    }

    /// Install the retained-measure store rebuilt during a pass.
    pub(crate) fn set_retained_measures(&mut self, measures: HashMap<usize, RetainedMeasure>) {
        self.retained_measures = measures;
    }

    /// Step 4 (B-full): enable/disable the per-system wholesale-reuse store.
    /// Off by default so the shipped path is byte-for-byte unchanged.
    pub fn set_system_layout_reuse_enabled(&mut self, enabled: bool) {
        self.system_layout_reuse_enabled = enabled;
    }

    /// Step 4 (B-full): whether the per-system wholesale-reuse store is engaged.
    pub(crate) fn system_layout_reuse_enabled(&self) -> bool {
        self.system_layout_reuse_enabled
    }

    /// Step 4 (B-full): take ownership of the per-system layout store, leaving
    /// it empty. Precompute drains this at the start of a pass, *moves* matching
    /// whole systems into the layout being assembled, and the caller re-installs
    /// the rebuilt vector after the render loop via `set_cached_system_layouts`.
    pub(crate) fn take_cached_system_layouts(&mut self) -> Vec<Option<CachedSystemLayout>> {
        std::mem::take(&mut self.cached_system_layouts)
    }

    /// Step 4 (B-full): install the per-system layout store rebuilt during a
    /// pass. Trims nothing — the caller sizes it to the current system count.
    pub(crate) fn set_cached_system_layouts(&mut self, systems: Vec<Option<CachedSystemLayout>>) {
        self.cached_system_layouts = systems;
    }

    /// Step 4 (B-full): bump the per-pass wholesale system-reuse counter.
    pub(crate) fn bump_system_layout_reuse(&mut self) {
        self.system_layout_reuse_hits += 1;
    }

    pub(crate) fn bump_system_measure_reuse(&mut self) {
        self.system_measure_reuse_hits += 1;
    }

    pub fn system_measure_reuse_hits(&self) -> usize {
        self.system_measure_reuse_hits
    }

    /// (test) Step 4 wholesale system-reuse hits from the most recent pass.
    #[cfg(test)]
    pub(crate) fn system_layout_reuse_hits(&self) -> usize {
        self.system_layout_reuse_hits
    }

    /// Number of retained measures currently held. For tests/diagnostics.
    #[cfg(test)]
    pub(crate) fn retained_measure_count(&self) -> usize {
        self.retained_measures.len()
    }

    /// Number of cache hits in the last layout pass.
    pub fn last_hits(&self) -> usize {
        self.hits + self.unchecked_hits
    }

    /// Number of cache misses in the last layout pass.
    pub fn last_misses(&self) -> usize {
        self.misses
    }
}

#[cfg(test)]
mod config_invalidation_tests {
    use super::*;

    #[test]
    fn any_config_change_invalidates_including_nested_policies() {
        let mut cache = LayoutCache::new();
        let mut config = LayoutConfig::default();
        assert!(cache.check_config(&config));
        assert!(!cache.check_config(&config));

        // Representative fields omitted by the former hand-maintained hash.
        config.slur_thickness += 0.01;
        assert!(cache.check_config(&config));
        assert!(!cache.check_config(&config));

        config.horizon_chunk_width = Some(1_024.0);
        assert!(cache.check_config(&config));

        config
            .text_styles
            .merge_json(&serde_json::json!({ "tempo": { "size": 2.75 } }));
        assert!(cache.check_config(&config));

        config
            .placement
            .merge_json(&serde_json::json!({ "dynamic": { "attachGap": 3.25 } }));
        assert!(cache.check_config(&config));

        config.page_turns.enabled = !config.page_turns.enabled;
        assert!(cache.check_config(&config));
    }

    #[test]
    fn time_signature_config_change_preserves_resolved_score_content() {
        let mut cache = LayoutCache::new();
        let mut config = LayoutConfig::default();
        assert!(cache.check_config(&config));
        cache.set_resolved_staves(42, Vec::new());

        config.time_signature_settings.scale = 2.0;
        assert!(cache.check_config(&config));
        assert!(cache.take_resolved_staves(42).is_some());

        cache.set_resolved_staves(42, Vec::new());
        config.slur_thickness += 0.01;
        assert!(cache.check_config(&config));
        assert!(cache.take_resolved_staves(42).is_none());
    }

    #[test]
    fn prepared_time_signature_change_invalidates_only_meter_widths() {
        let mut cache = LayoutCache::new();
        let mut config = LayoutConfig::default();
        assert!(cache.check_config(&config));
        cache.set_natural_width(0, 11, 100.0);
        cache.set_natural_width(1000, 22, 200.0);
        cache.prepare_time_signature_settings_change(&[0]);

        config.time_signature_settings.scale = 2.0;
        assert!(cache.check_config(&config));
        assert_eq!(cache.get_natural_width(0, 11), None);
        assert_eq!(cache.get_natural_width(1000, 22), Some(200.0));
    }
}
