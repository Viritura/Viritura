//! Page-turn-aware pagination (auto page breaks).
//!
//! Public surface for the page-turn optimizer. The pipeline has three stages
//! (see `docs/plans/auto-page-breaks.md`):
//!
//! 1. **Analysis** ([`analysis`]) — per-measure rest profiles → tempo-aware
//!    turn windows at every boundary.
//! 2. **Optimization** ([`optimizer`]) — a parity-aware DP choosing page
//!    starts that balance page density against turn quality.
//! 3. **Integration** — the chosen `page_starts` are converted to system
//!    indices and fed to the existing packer as `forced_page_starts`.
//!
//! Stages are pure functions; this module's [`plan_page_turns`] wires them
//! together from the score model plus the layout's system→measure mapping.

mod analysis;
mod config;
mod expansion;
mod natural_geometry;
mod optimizer;
mod spread_casting;
mod tempo;

pub use analysis::{
    compute_turn_windows, profile_from_part_measure, MeasureProfile, TurnAnnotation, TurnQuality,
    TurnWindow,
};
pub use config::{EngravingPreset, PageTurnConfig, PageTurnWeights, TitlePagePolicy};
use expansion::multimeasure_rest_break_flags;
pub use expansion::{expand_playback_order, structural_boundary_flags};
pub(crate) use natural_geometry::{optimize_natural_part, NaturalPartPlan};
pub use optimizer::{optimize, PageGeometry, PageTurnHint, TurnPlan, TurnWarning, TurnWarningKind};
pub use tempo::TempoMap;

use crate::model::measure::{GlobalMeasure, PartMeasure};

/// Inclusive underlying-measure span `(first, last)` of a system whose visible
/// blocks occupy positions `first_pos..=last_pos` in the visible-block list.
///
/// `block_start(pos)` returns the first underlying measure index of the
/// visible block at `pos`, or `None` past the end of the list. The last
/// visible block on a system may be a collapsed multimeasure rest spanning
/// several underlying measures, so `last` is the measure right before the next
/// visible block's start (or the final measure when this is the trailing
/// block) — **not** the block's own start. Reading the start instead lands the
/// turn window one measure-group too early and makes the courtesy "N bars
/// rest" hint count bars still printed on the outgoing page.
pub fn system_measure_range(
    first_pos: usize,
    last_pos: usize,
    total_measures: usize,
    block_start: impl Fn(usize) -> Option<usize>,
) -> Option<(usize, usize)> {
    let first = block_start(first_pos)?;
    let last = block_start(last_pos + 1)
        .map(|next| next - 1)
        .unwrap_or(total_measures - 1);
    Some((first, last))
}

/// `system_ranges[s] = (first_measure, last_measure)` gives the inclusive
/// written-measure span of system `s`, as produced by the layout's system
/// breaker. `geometry` describes the page box in pixels.
///
/// Returns `None` when the feature is disabled, there are too few systems to
/// matter, or no feasible pagination exists.
pub fn plan_page_turns(
    global_measures: &[GlobalMeasure],
    part_measures: &[PartMeasure],
    system_heights: &[f64],
    system_gaps: &[f64],
    system_ranges: &[(usize, usize)],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
) -> Option<TurnPlan> {
    if !config.enabled || system_heights.len() < 2 {
        return None;
    }
    let windows = analyze_turn_windows(global_measures, part_measures, config);
    optimize(
        system_heights,
        system_gaps,
        geometry,
        config,
        system_ranges,
        &windows,
    )
}

/// Map an internal [`TurnWarning`] to the serializable render-facing mirror.
fn to_render_warning(w: &TurnWarning) -> crate::render::PageTurnWarning {
    crate::render::PageTurnWarning {
        boundary_measure: w.boundary_measure,
        kind: match w.kind {
            TurnWarningKind::Tight => "tight",
            TurnWarningKind::Impossible => "impossible",
            TurnWarningKind::Structural => "structural",
            TurnWarningKind::Fermata => "fermata",
        }
        .to_string(),
        turn_seconds: w.turn_seconds,
    }
}

/// Outcome of [`plan_forced_starts`]: the forced page-start system indices to
/// feed the packer, optional turn warnings, and whether the optimizer elected
/// to precede the music with a dedicated title page.
pub struct ForcedPagination {
    /// System indices that must begin a new page (excludes the implicit 0).
    pub page_starts: Vec<usize>,
    /// Flagged turns for the warnings overlay, or `None` when no plan ran.
    pub warnings: Option<Vec<crate::render::PageTurnWarning>>,
    /// Courtesy "N bars rest on the next page" margin hints to paint at the
    /// foot of each outgoing page.
    pub hints: Vec<PageTurnHint>,
    /// System starts preceded by an intentionally blank parity page.
    pub blank_pages_before: Vec<usize>,
    /// `true` when a dedicated title page should precede the first music page.
    pub title_page: bool,
    /// `true` when the first physical page is a lone recto (right-hand) page, so
    /// spreads pair as `(0 alone), (1,2), (3,4)…`; `false` pairs `(0,1),
    /// (2,3)…`. Drives per-spread frame-inset grouping
    /// (`docs/plans/page-margin-bands.md`). Meaningful only when a plan ran
    /// (`warnings.is_some()`); otherwise the caller falls back to its own parity.
    pub first_page_recto: bool,
}

/// Attach warnings and courtesy hints to page membership already selected by
/// the natural system planner. This function observes the selected starts; it
/// never searches for or substitutes different page boundaries.
pub(crate) fn describe_selected_pagination(
    global_measures: &[GlobalMeasure],
    part_measures: &[PartMeasure],
    visible_indices: &[usize],
    system_ranges: &[(usize, usize)],
    page_starts: Vec<usize>,
    blank_pages_before: Vec<usize>,
    title_page: bool,
    first_page_recto: bool,
    config: &PageTurnConfig,
) -> ForcedPagination {
    let windows = analyze_turn_windows_for_visible_blocks(
        global_measures,
        part_measures,
        visible_indices,
        config,
    );
    let (warnings, hints) = optimizer::describe_selected_pagination(
        &page_starts,
        &blank_pages_before,
        system_ranges,
        &windows,
        first_page_recto,
        title_page,
        config,
    );
    ForcedPagination {
        page_starts,
        warnings: Some(
            warnings
                .into_iter()
                .map(|warning| to_render_warning(&warning))
                .collect(),
        ),
        hints,
        blank_pages_before,
        title_page,
        first_page_recto,
    }
}

/// Convenience wrapper for layout call sites: plan page turns for a single
/// part and return the [`ForcedPagination`] ready to feed the packer and
/// attach to the `DisplayList`. Returns an empty result when the feature is
/// disabled or no feasible plan exists, leaving the greedy packer untouched.
///
/// `allow_title_page` must be `false` for call sites that cannot render a
/// dedicated title page; otherwise the optimizer may reserve one (shifting
/// recto/verso parity) that the renderer never emits, offsetting every turn.
pub fn plan_forced_starts(
    global_measures: &[GlobalMeasure],
    part_measures: &[PartMeasure],
    system_heights: &[f64],
    system_gaps: &[f64],
    system_ranges: &[(usize, usize)],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
    allow_title_page: bool,
) -> ForcedPagination {
    // When the caller cannot paint a dedicated title page, forbid the
    // optimizer from reserving one — otherwise its planned parity (and thus
    // every page-turn decision) would be offset by one unrendered page.
    let effective = if allow_title_page {
        config.clone()
    } else {
        PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            ..config.clone()
        }
    };
    match plan_page_turns(
        global_measures,
        part_measures,
        system_heights,
        system_gaps,
        system_ranges,
        geometry,
        &effective,
    ) {
        Some(plan) => {
            let warnings = plan.warnings.iter().map(to_render_warning).collect();
            ForcedPagination {
                page_starts: plan.page_starts,
                warnings: Some(warnings),
                hints: plan.hints,
                blank_pages_before: plan.blank_pages_before,
                title_page: plan.title_page,
                first_page_recto: plan.first_page_recto,
            }
        }
        None => ForcedPagination {
            page_starts: Vec::new(),
            warnings: None,
            hints: Vec::new(),
            blank_pages_before: Vec::new(),
            title_page: false,
            first_page_recto: false,
        },
    }
}

/// Build the per-boundary turn windows for a part (stage 1, exposed for the
/// warnings overlay and tests).
pub fn analyze_turn_windows(
    global_measures: &[GlobalMeasure],
    part_measures: &[PartMeasure],
    config: &PageTurnConfig,
) -> Vec<TurnWindow> {
    let profiles: Vec<MeasureProfile> = part_measures
        .iter()
        .map(profile_from_part_measure)
        .collect();
    let tempo = TempoMap::from_global(global_measures, config.default_bpm);
    let structural = structural_boundary_flags(global_measures);
    let mmr_breaks = multimeasure_rest_break_flags(global_measures);
    compute_turn_windows(&profiles, &tempo, &structural, &mmr_breaks, config)
}

pub(crate) fn analyze_turn_windows_for_visible_blocks(
    global_measures: &[GlobalMeasure],
    part_measures: &[PartMeasure],
    visible_indices: &[usize],
    config: &PageTurnConfig,
) -> Vec<TurnWindow> {
    let mut profiles: Vec<MeasureProfile> = part_measures
        .iter()
        .map(profile_from_part_measure)
        .collect();
    for pair in visible_indices.windows(2) {
        if pair[1] <= pair[0] + 1 {
            continue;
        }
        for profile in &mut profiles[pair[0]..pair[1]] {
            profile.is_full_rest = true;
            profile.leading_rest_beats = profile.total_beats;
            profile.trailing_rest_beats = profile.total_beats;
        }
    }
    let tempo = TempoMap::from_global(global_measures, config.default_bpm);
    let structural = structural_boundary_flags(global_measures);
    let mmr_breaks = multimeasure_rest_break_flags(global_measures);
    compute_turn_windows(&profiles, &tempo, &structural, &mmr_breaks, config)
}

#[cfg(test)]
mod tests {
    use super::system_measure_range;

    // Visible blocks for a part whose measures 7..=9 are a single collapsed
    // 3-bar multimeasure rest. Each entry is the block's first underlying
    // measure index; the MMR appears once (at 7) even though it spans 7,8,9.
    fn visible() -> Vec<usize> {
        vec![0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17]
    }
    const TOTAL: usize = 18;

    fn at(blocks: &[usize], pos: usize) -> Option<usize> {
        blocks.get(pos).copied()
    }

    #[test]
    fn trailing_mmr_block_resolves_to_its_last_underlying_measure() {
        let v = visible();
        // A system whose last visible block (position 7) is the collapsed
        // 3-bar MMR must report measure 9 (the MMR's LAST bar), not 7.
        let range = system_measure_range(0, 7, TOTAL, |p| at(&v, p)).unwrap();
        assert_eq!(
            range,
            (0, 9),
            "trailing collapsed MMR must extend the system to its last bar (9), \
             not stop at its first (7) — stopping early is the page-turn hint bug"
        );
    }

    #[test]
    fn non_collapsed_block_spans_a_single_measure() {
        let v = visible();
        // A system ending on an ordinary one-bar block (position 8 = measure
        // 10) spans exactly that measure.
        let range = system_measure_range(8, 8, TOTAL, |p| at(&v, p)).unwrap();
        assert_eq!(range, (10, 10));
    }

    #[test]
    fn final_block_extends_to_the_last_measure() {
        let v = visible();
        // The trailing block (last position) has no following block, so it
        // extends to the final underlying measure.
        let last = v.len() - 1;
        let range = system_measure_range(last, last, TOTAL, |p| at(&v, p)).unwrap();
        assert_eq!(range, (17, 17));
    }
}
