use super::config::LayoutConfig;
use super::render_annotations;
use super::types::MeasureLayout;
use crate::model::Score;
use crate::render::DisplayList;

pub(super) fn system_ink_extras(
    systems: &[Vec<MeasureLayout>],
    score: &Score,
    part_index: usize,
    config: &LayoutConfig,
) -> (Vec<f64>, Vec<f64>, f64) {
    let mut above = Vec::with_capacity(systems.len());
    let mut below = Vec::with_capacity(systems.len());
    let mut number_above = 0.0_f64;
    for layouts in systems {
        let numbers = number_ink_extras(layouts, score, part_index, config);
        let measures: Vec<_> = layouts.iter().map(|layout| &layout.resolved).collect();
        above.push(
            super::compute_above_staff_extra(
                &measures,
                Some(layouts),
                config.sp,
                config.stem_length,
                config,
            )
            .max(numbers.0),
        );
        below.push(
            super::compute_below_staff_extra_from_layouts(
                layouts,
                config.sp,
                config.stem_length,
                config,
            )
            .max(numbers.1),
        );
        number_above = number_above.max(numbers.0);
    }
    (above, below, number_above)
}

pub(super) fn number_ink_extras(
    layouts: &[MeasureLayout],
    score: &Score,
    part_index: usize,
    config: &LayoutConfig,
) -> (f64, f64) {
    if !layouts
        .iter()
        .any(|layout| render_annotations::number_label(layout, 0.0, config.sp, config).is_some())
    {
        return (0.0, 0.0);
    }
    let mut ink = DisplayList::new(0.0, 0.0);
    let clef_changes =
        super::render_measure::clef_change_measure_set_from_layouts(&[layouts.to_vec()]);
    super::render_system_contents(
        &mut ink,
        layouts,
        0.0,
        config.sp,
        config,
        score,
        &[super::full_score::FlatSource::whole_part(part_index)],
        None,
        false,
        part_index,
        None,
        None,
        None,
        0,
        false,
        false,
        &clef_changes,
        &mut Vec::new(),
        None,
    );
    ink.element_bboxes
        .iter()
        .filter(|element| element.element_id.ends_with("/mnum"))
        .fold((0.0_f64, 0.0_f64), |(above, below), element| {
            (
                above.max(-element.bbox.y),
                below.max(element.bbox.y + element.bbox.height - 4.0 * config.sp),
            )
        })
}

pub(super) fn measure_number_extra(
    layouts: &[MeasureLayout],
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let staff_bottom = 4.0 * sp;
    if config.bar_numbers.placement == Some(crate::model::BarNumberPlacement::AboveSystem) {
        return 0.0;
    }
    layouts
        .iter()
        .map(|layout| {
            render_annotations::number_label(layout, 0.0, sp, config).map_or(0.0, |label| {
                (label.bbox.y + label.bbox.height - staff_bottom).max(0.0)
            })
        })
        .fold(0.0, f64::max)
}
