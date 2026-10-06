use super::config::LayoutConfig;
use super::types::MeasureLayout;

pub(super) fn above_staff_extra(layouts: &[MeasureLayout], sp: f64, config: &LayoutConfig) -> f64 {
    layouts
        .iter()
        .map(|layout| super::render_annotations::system_text_vertical_extras(layout, sp, config).0)
        .fold(0.0, f64::max)
}

pub(super) fn below_staff_extra(layouts: &[MeasureLayout], sp: f64, config: &LayoutConfig) -> f64 {
    layouts
        .iter()
        .map(|layout| super::render_annotations::system_text_vertical_extras(layout, sp, config).1)
        .fold(0.0, f64::max)
}
