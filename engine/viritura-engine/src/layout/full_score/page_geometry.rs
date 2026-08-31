//! Page and system geometry for the legacy full-score layout path.

use super::super::config::LayoutConfig;
use super::super::page::{compute_page_breaks, compute_system_y_positions, title_block_height};
use super::super::render_annotations::global_tempo_widths;
use super::super::system::{break_into_systems, enforce_tempo_system_breaks};
use crate::model::Score;
use crate::render::PageLayout;

/// Vertical gap between staves, scaled for collision-prone content.
pub(super) fn compute_inter_staff_gap(score: &Score, sp: f64) -> f64 {
    let has_dynamics = score.parts.iter().any(|part| {
        part.measures.iter().any(|measure| {
            measure
                .dynamics
                .as_ref()
                .is_some_and(|dynamics| !dynamics.is_empty())
        })
    });
    let has_multi_voice = score.parts.iter().any(|part| {
        part.measures
            .iter()
            .any(|measure| measure.sequences.len() > 1)
    });
    if has_dynamics && has_multi_voice {
        11.0 * sp
    } else if has_dynamics || has_multi_voice {
        9.0 * sp
    } else {
        7.0 * sp
    }
}

/// Resolved page/system dimensions for the legacy full-score path.
pub(super) struct FullScorePageLayout {
    pub(super) margin_left: f64,
    pub(super) brace_margin: f64,
    pub(super) label_margin: f64,
    pub(super) content_width: Option<f64>,
    pub(super) systems: Vec<Vec<usize>>,
    pub(super) system_count: usize,
    pub(super) system_y_positions: Vec<f64>,
    pub(super) justified_gaps: Vec<f64>,
    pub(super) page_w: f64,
    pub(super) total_height: f64,
    pub(super) pages: Vec<PageLayout>,
}

/// Compute all page/system geometry for the legacy full-score path.
#[allow(clippy::too_many_arguments)] // Derived page geometry consumes the complete system-size input tuple.
pub(super) fn compute_full_score_page_layout(
    score: &Score,
    config: &LayoutConfig,
    max_widths: &[f64],
    measure_count: usize,
    visual_staff_count: usize,
    staff_height: f64,
    inter_staff_gap: f64,
    sp: f64,
) -> FullScorePageLayout {
    let has_names = score.parts.iter().any(|part| !part.name.is_empty());
    let has_grand_staff = score.parts.iter().any(|part| part.staves >= 2);
    let brace_margin = if has_grand_staff { 2.0 * sp } else { 0.0 };
    let label_margin = if has_names { 6.0 * sp } else { 0.0 };
    let page_margin_l = if config.page_width.is_some() {
        config.page_margin_left * sp
    } else {
        config.margin_left * sp
    };
    let page_margin_r = if config.page_width.is_some() {
        config.page_margin_right * sp
    } else {
        config.margin_right * sp
    };
    let margin_left = page_margin_l + label_margin + brace_margin;
    let margin_top = config.margin_top * sp;

    let content_width = config
        .page_width
        .map(|width| width - margin_left - page_margin_r);
    let systems = if let Some(available) = content_width {
        if available > 0.0 {
            let systems = break_into_systems(max_widths, available);
            let tempo_widths =
                global_tempo_widths(&score.global.measures, measure_count, config, sp);
            enforce_tempo_system_breaks(systems, max_widths, &tempo_widths, available)
        } else {
            vec![(0..measure_count).collect()]
        }
    } else {
        vec![(0..measure_count).collect()]
    };

    let system_count = systems.len();
    let inter_system_gap = config.inter_system_spacing * sp;
    let single_system_height = visual_staff_count as f64 * staff_height
        + (visual_staff_count - 1) as f64 * inter_staff_gap;
    let title_height_px = title_block_height(score.metadata(), config);
    let system_heights_px = vec![single_system_height; system_count];
    let pages = compute_page_breaks(&system_heights_px, config, title_height_px);
    let staves_per_system = vec![visual_staff_count; system_count];
    let (system_y_positions, justified_gaps) = if config.page_width.is_some() {
        let (positions, gaps, _) = compute_system_y_positions(
            &staves_per_system,
            staff_height,
            &pages,
            config,
            title_height_px,
            Some(&system_heights_px),
            None,
            None,
        );
        (positions, gaps)
    } else {
        (
            (0..system_count)
                .map(|index| margin_top + index as f64 * (single_system_height + inter_system_gap))
                .collect(),
            vec![inter_staff_gap; system_count],
        )
    };

    let page_w = config
        .page_width
        .unwrap_or_else(|| margin_left + max_widths.iter().sum::<f64>() + config.margin_right * sp);
    let total_height = if config.page_width.is_some() {
        pages.last().map_or(0.0, |page| page.y_offset + page.height)
    } else {
        margin_top * 2.0
            + system_count as f64 * single_system_height
            + system_count.saturating_sub(1) as f64 * inter_system_gap
    };

    FullScorePageLayout {
        margin_left,
        brace_margin,
        label_margin,
        content_width,
        systems,
        system_count,
        system_y_positions,
        justified_gaps,
        page_w,
        total_height,
        pages,
    }
}
