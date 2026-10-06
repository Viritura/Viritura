use super::config::LayoutConfig;
use super::render_annotations;
use super::types::MeasureLayout;

pub(super) fn measure_number_extra(
    layouts: &[MeasureLayout],
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let staff_bottom = 4.0 * sp;
    let font_size = 2.0 * sp;
    layouts
        .iter()
        .map(|layout| {
            if layout.multimeasure_rest_count.is_some() {
                0.5 * sp + font_size
            } else if render_annotations::measure_number_value(layout).is_some() {
                let top = render_annotations::below_staff_number_top_y(layout, 0.0, sp, config);
                (top + font_size - staff_bottom).max(0.0)
            } else {
                0.0
            }
        })
        .fold(0.0, f64::max)
}
