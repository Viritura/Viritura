mod collect_measures;
mod grand_staff;
mod render_pipeline;
mod system_layout;

pub fn layout_score(
    score: &crate::model::Score,
    part_index: usize,
    config: &super::LayoutConfig,
) -> crate::render::DisplayList {
    super::layout_score_cached(score, part_index, config, None)
}

pub(super) use collect_measures::*;
pub(super) use grand_staff::*;
pub(super) use render_pipeline::*;
pub(super) use system_layout::*;
