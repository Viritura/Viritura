//! Page and system geometry for the legacy full-score layout path.

use super::super::config::LayoutConfig;
use super::super::page::{
    compute_page_breaks_with_extras, compute_system_y_positions, title_block_height,
};
use super::super::render_annotations::global_tempo_widths;
use super::super::system::{break_into_systems, enforce_tempo_system_breaks};
use super::super::types::ResolvedOttavaRange;
use crate::model::{BarNumberPlacement, ResolvedMeasure, Score};
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

fn number_ink_extras(
    score: &Score,
    config: &LayoutConfig,
    systems: &[Vec<usize>],
    max_widths: &[f64],
    margin_left: f64,
    content_width: Option<f64>,
    resolved: &[Vec<ResolvedMeasure>],
    ottavas: &[Vec<ResolvedOttavaRange>],
    shortest_beats: f64,
) -> Vec<(f64, f64)> {
    let placement = config.bar_numbers.placement.unwrap_or_default();
    let part_index = if placement == BarNumberPlacement::BelowSystem {
        score.parts.len() - 1
    } else {
        0
    };
    let target_staff = if placement == BarNumberPlacement::AboveSystem {
        0
    } else {
        score.parts[part_index].staves.max(1) as usize - 1
    };
    let visual_index = score.parts[..part_index]
        .iter()
        .map(|part| part.staves.max(1) as usize)
        .sum::<usize>()
        + target_staff;
    systems
        .iter()
        .enumerate()
        .map(|(system_index, system)| {
            let total: f64 = system.iter().map(|&index| max_widths[index]).sum();
            let available = content_width.unwrap_or(total);
            let preserve_natural =
                system_index + 1 == systems.len() && systems.len() > 1 && total < available * 0.65;
            let scale = if total > 0.0 && content_width.is_some() && !preserve_natural {
                available / total
            } else {
                1.0
            };
            let mut cursor = margin_left;
            let layouts: Vec<_> = system
                .iter()
                .enumerate()
                .filter_map(|(index, &measure)| {
                    let mut layout = super::super::layout_measure(
                        resolved[visual_index].get(measure)?,
                        config.sp,
                        cursor,
                        config,
                        Some(max_widths[measure] * scale),
                        &ottavas[visual_index],
                        shortest_beats,
                    );
                    layout.is_first_on_system = index == 0;
                    layout.part_index = part_index;
                    cursor += layout.width;
                    Some(layout)
                })
                .collect();
            let extras = super::super::system_spacing::number_ink_extras(
                &layouts, score, part_index, config,
            );
            if placement != BarNumberPlacement::BelowTopInstrument
                || (config.bar_numbers.on_staff != Some(true)
                    && config.bar_numbers.distance.is_none())
                || visual_index + 1 >= resolved.len()
                || extras.1 == 0.0
            {
                return extras;
            }
            let next = visual_index + 1;
            let next_layouts: Vec<_> = layouts
                .iter()
                .filter_map(|template| {
                    let mut layout = super::super::layout_measure(
                        resolved[next].get(template.resolved.index)?,
                        config.sp,
                        template.x,
                        config,
                        Some(template.width),
                        &ottavas[next],
                        shortest_beats,
                    );
                    layout.is_first_on_system = template.is_first_on_system;
                    layout.part_index = part_index + 1;
                    Some(layout)
                })
                .collect();
            let mut without_numbers = config.clone();
            without_numbers.bar_numbers.frequency = Some(crate::model::BarNumberFrequency::Hidden);
            let above = super::super::system_spacing::staff_ink_extras(
                &next_layouts,
                score,
                part_index + 1,
                &without_numbers,
            )
            .0;
            (extras.0, extras.1 + above)
        })
        .collect()
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
    resolved: &[Vec<ResolvedMeasure>],
    ottavas: &[Vec<ResolvedOttavaRange>],
    shortest_beats: f64,
) -> FullScorePageLayout {
    let has_names = score.parts.iter().any(|part| !part.name.is_empty());
    let has_grand_staff = score.parts.iter().any(|part| part.staves >= 2);
    let brace_margin = if has_grand_staff { 2.0 * sp } else { 0.0 };
    let has_instrument_changes = score.parts.iter().any(|part| {
        part.measures
            .iter()
            .any(|measure| measure.instrument_changes.is_some())
    });
    let mut label_measures = if has_instrument_changes {
        vec![0]
    } else {
        Vec::new()
    };
    for part in &score.parts {
        label_measures.extend(
            part.measures
                .iter()
                .enumerate()
                .filter_map(|(index, measure)| {
                    measure
                        .instrument_changes
                        .as_ref()
                        .filter(|changes| !changes.is_empty())
                        .map(|_| index)
                }),
        );
    }
    label_measures.sort_unstable();
    label_measures.dedup();
    let active_name_width = label_measures
        .into_iter()
        .flat_map(|index| super::super::page::resolve_part_display_names_at(&score.parts, index))
        .flat_map(|info| [info.display_name, info.display_short_name])
        .map(|line| {
            crate::layout::text_styles::text_width(
                &line,
                2.0 * sp,
                crate::layout::text_styles::FontFamily::Serif,
                false,
            )
        })
        .fold(0.0_f64, f64::max);
    let label_margin = if has_names {
        (6.0 * sp).max(active_name_width + 2.0 * sp)
    } else {
        0.0
    };
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
    let placement = config.bar_numbers.placement.unwrap_or_default();
    let number_extras = number_ink_extras(
        score,
        config,
        &systems,
        max_widths,
        margin_left,
        content_width,
        resolved,
        ottavas,
        shortest_beats,
    );
    let between_numbers = if placement == BarNumberPlacement::BelowTopInstrument {
        number_extras
            .iter()
            .map(|extras| extras.1)
            .fold(0.0_f64, f64::max)
    } else {
        0.0
    };
    let inter_staff_gap = inter_staff_gap.max(between_numbers + sp);
    let extras: Vec<_> = number_extras
        .iter()
        .map(|&(above, below)| match placement {
            BarNumberPlacement::AboveSystem => (above, 0.0),
            BarNumberPlacement::BelowSystem => (0.0, below),
            BarNumberPlacement::BelowTopInstrument => (0.0, 0.0),
        })
        .collect();
    let margin_top = margin_top.max(extras.iter().map(|extra| extra.0).fold(0.0_f64, f64::max));
    let single_system_height = visual_staff_count as f64 * staff_height
        + (visual_staff_count - 1) as f64 * inter_staff_gap;
    let title_height_px = title_block_height(score.metadata(), config);
    let system_heights_px: Vec<_> = extras
        .iter()
        .map(|(above, below)| single_system_height + above + below)
        .collect();
    let pages = compute_page_breaks_with_extras(
        &system_heights_px,
        Some(&extras),
        config,
        title_height_px,
        &[],
    );
    let staves_per_system = vec![visual_staff_count; system_count];
    let (system_y_positions, justified_gaps) = if config.page_width.is_some() {
        let (mut positions, mut gaps, _) = compute_system_y_positions(
            &staves_per_system,
            staff_height,
            &pages,
            config,
            title_height_px,
            Some(&system_heights_px),
            Some(&extras),
            None,
        );
        for (index, (position, (above, _))) in positions.iter_mut().zip(&extras).enumerate() {
            *position += above;
            if config.bar_numbers.on_staff == Some(true) || config.bar_numbers.distance.is_some() {
                gaps[index] = (inter_staff_gap + gaps[index] - 7.0 * sp).max(0.0);
            }
        }
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
        margin_top
            + (config.margin_top * sp)
                .max(extras.iter().map(|extra| extra.1).fold(0.0_f64, f64::max))
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
