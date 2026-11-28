use super::super::cache::LayoutCache;
use super::super::config::LayoutConfig;
use super::explicit::layout_with_mnx_scores_unrecorded;
use crate::model::Score;
use crate::render::DisplayList;

/// Layout a score using MNX layout definitions and score definitions.
///
/// Uses the first score definition (or falls back to `layout_full_score`
/// if no scores/layouts are defined).
pub fn layout_with_mnx_scores(
    score: &Score,
    config: &LayoutConfig,
    score_index: usize,
) -> DisplayList {
    layout_with_mnx_scores_cached(score, config, score_index, None)
}

pub fn layout_with_mnx_scores_cached(
    score: &Score,
    config: &LayoutConfig,
    score_index: usize,
    cache: Option<&mut LayoutCache>,
) -> DisplayList {
    crate::drawing_recorder::layout(score, || {
        layout_with_mnx_scores_unrecorded(score, config, score_index, cache)
    })
}
