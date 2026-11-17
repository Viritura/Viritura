use super::super::{config::LayoutConfig, measure::compute_prefix_width, render_annotations};
use crate::model::ResolvedMeasure;
use crate::render::ElementKind;
use std::collections::HashMap;

struct MeasureSpanConstraint {
    start: usize,
    end: usize,
    min_width: f64,
}

pub(crate) fn reserve_mmr_span_widths<'a>(
    resolved: impl Iterator<Item = &'a ResolvedMeasure>,
    mmr_starts: &HashMap<usize, u32>,
    widths: &mut [f64],
    config: &LayoutConfig,
    sp: f64,
) {
    let measures: Vec<_> = resolved
        .filter(|measure| widths.get(measure.index).is_some_and(|width| *width > 0.0))
        .collect();
    let mut visible_widths: Vec<_> = measures
        .iter()
        .map(|measure| widths[measure.index])
        .collect();
    reserve_mmr_annotation_spans(&measures, mmr_starts, &mut visible_widths, config, sp);
    for (measure, width) in measures.iter().zip(visible_widths) {
        widths[measure.index] = width;
    }
}

/// Reserve only the span blocked by a following rehearsal mark. Unobstructed
/// text can overhang resting measures without changing their natural widths.
fn collect_span_constraints(
    measures: &[&ResolvedMeasure],
    mmr_starts: &HashMap<usize, u32>,
    config: &LayoutConfig,
    sp: f64,
) -> Vec<MeasureSpanConstraint> {
    let mut constraints = Vec::new();
    for (start, measure) in measures.iter().enumerate() {
        if !mmr_starts.contains_key(&measure.index) {
            continue;
        }
        let text_width = render_annotations::mmr_start_annotation_width(measure, config, sp);
        if text_width <= 0.0 {
            continue;
        }
        let mut end = start + 1;
        while end < measures.len()
            && mmr_starts.contains_key(&measures[end].index)
            && measures[end].global.rehearsal_mark().is_none()
        {
            end += 1;
        }
        let Some(next) = measures.get(end) else {
            continue;
        };
        if next.global.rehearsal_mark().is_none() {
            continue;
        }
        let prefix = compute_prefix_width(measure, sp, measure.index == 0, config);
        let own_mark = render_annotations::measure_above_label_reserved_width(measure, sp, config);
        let anchor = prefix.max(if own_mark > 0.0 {
            own_mark + 0.5 * sp
        } else {
            0.0
        });
        let mark_left_extent = render_annotations::rehearsal_mark_left_ink_extent(next, sp, config);
        let clearance = config
            .placement
            .resolve(ElementKind::Tempo)
            .padding
            .horizontal
            .max(0.5)
            * sp;
        constraints.push(MeasureSpanConstraint {
            start,
            end,
            min_width: anchor + text_width + mark_left_extent + clearance,
        });
    }
    constraints
}

pub(crate) fn reserve_mmr_annotation_spans(
    measures: &[&ResolvedMeasure],
    mmr_starts: &HashMap<usize, u32>,
    widths: &mut [f64],
    config: &LayoutConfig,
    sp: f64,
) {
    assert_eq!(measures.len(), widths.len());
    for constraint in collect_span_constraints(measures, mmr_starts, config, sp) {
        let span = &mut widths[constraint.start..constraint.end];
        let natural: f64 = span.iter().sum();
        if natural <= 0.0 || natural >= constraint.min_width {
            continue;
        }
        let scale = constraint.min_width / natural;
        for width in span {
            *width *= scale;
        }
    }
}

pub(crate) fn reconcile_mmr_annotation_justification(
    measures: &[&ResolvedMeasure],
    mmr_starts: &HashMap<usize, u32>,
    widths: &mut [f64],
    config: &LayoutConfig,
    sp: f64,
) {
    assert_eq!(measures.len(), widths.len());
    let constraints = collect_span_constraints(measures, mmr_starts, config, sp);
    if constraints.iter().all(|constraint| {
        widths[constraint.start..constraint.end].iter().sum::<f64>() >= constraint.min_width - 1e-6
    }) {
        return;
    }
    let total: f64 = widths.iter().sum();
    let mut floors = vec![0.0_f64; widths.len()];
    for constraint in constraints {
        let span_total: f64 = widths[constraint.start..constraint.end].iter().sum();
        if span_total <= 0.0 {
            continue;
        }
        for index in constraint.start..constraint.end {
            floors[index] = floors[index].max(widths[index] * constraint.min_width / span_total);
        }
    }
    let fixed: f64 = floors.iter().sum();
    let elastic: f64 = widths
        .iter()
        .zip(&floors)
        .map(|(width, floor)| (width - floor).max(0.0))
        .sum();
    let scale = if elastic > 0.0 {
        (total - fixed).max(0.0) / elastic
    } else {
        0.0
    };
    for (width, floor) in widths.iter_mut().zip(floors) {
        *width = floor + (*width - floor).max(0.0) * scale;
    }
}
