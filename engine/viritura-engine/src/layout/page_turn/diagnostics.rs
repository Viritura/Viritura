use super::analysis::TurnQuality;
use super::natural_geometry::NaturalPartPlan;
use super::optimizer::{is_physical_turn, turn_cost};
use super::{analyze_turn_windows_for_visible_blocks, system_measure_range};
use crate::layout::config::LayoutConfig;
use crate::model::{GlobalMeasure, PartMeasure};
use crate::render::{
    PageLayout, PaginationBoundaryDebug, PaginationDebugInfo, PaginationPageDebug,
    PaginationSystemDebug, SystemDebug,
};

pub(crate) struct PaginationDebugInputs<'a> {
    pub config: &'a LayoutConfig,
    pub global: &'a [GlobalMeasure],
    pub part: Option<&'a [PartMeasure]>,
    pub systems: &'a [Vec<usize>],
    pub visible_indices: &'a [usize],
    pub natural_widths: &'a [f64],
    pub heights: &'a [f64],
    pub protrusions: &'a [(f64, f64)],
    pub pages: &'a [PageLayout],
    pub placed: &'a [SystemDebug],
    pub title_height: f64,
    pub plan: Option<&'a NaturalPartPlan>,
    pub authored_breaks: bool,
}

fn requires_physical_turn(pages: &[PageLayout], index: usize, first_page_recto: bool) -> bool {
    !pages[index].system_indices.is_empty()
        && pages[index + 1..]
            .iter()
            .any(|page| !page.system_indices.is_empty())
        && (is_physical_turn(index % 2, first_page_recto)
            || pages[index + 1].system_indices.is_empty())
}

pub(crate) fn build_pagination_debug(input: PaginationDebugInputs<'_>) -> PaginationDebugInfo {
    let c = input.config;
    let pt = &c.page_turns;
    let title_page = input.plan.is_some_and(|p| p.title_page);
    let first_page_recto = input
        .plan
        .map_or(pt.first_page_recto.unwrap_or(true), |p| p.first_page_recto);
    let windows = input
        .part
        .map(|part| {
            analyze_turn_windows_for_visible_blocks(input.global, part, input.visible_indices, pt)
        })
        .unwrap_or_default();
    let status = if c.page_width.is_none() {
        "unpaged"
    } else if input.authored_breaks {
        "authored breaks"
    } else if input.part.is_none() {
        "multiple source parts: turn planning unavailable"
    } else if !pt.enabled {
        "automatic page turns disabled"
    } else if input.plan.is_some() {
        "automatic (joint planner or baseline fallback)"
    } else {
        "baseline: no automatic plan"
    };
    let final_music_page = input
        .pages
        .iter()
        .rposition(|p| !p.system_indices.is_empty());
    let pages: Vec<_> = input
        .pages
        .iter()
        .enumerate()
        .map(|(index, page)| {
            let first = page.system_indices.first().copied();
            let last = page.system_indices.last().copied();
            let title_reserve = if first == Some(0) && !title_page {
                input.title_height + c.first_page_footer_height
            } else {
                0.0
            };
            let frame_top = page.y_offset + c.page_margin_top * c.sp + title_reserve;
            let frame_bottom = page.y_offset + page.height - c.page_margin_bottom * c.sp;
            let mut content_height = 0.0;
            for (position, &system) in page.system_indices.iter().enumerate() {
                content_height += input.heights[system];
                if position > 0 {
                    content_height += crate::layout::page::effective_system_gap(
                        input.protrusions[system - 1].1,
                        input.protrusions[system].0,
                        c.sp,
                    );
                }
            }
            PaginationPageDebug {
                page_index: index,
                frame_top,
                frame_bottom,
                capacity: (frame_bottom - frame_top).max(0.0),
                content_height,
                placed_height: first.zip(last).map_or(0.0, |(first, last)| {
                    input.placed[last].bbox_bottom_y - input.placed[first].bbox_top_y
                }),
                is_final_music_page: final_music_page == Some(index),
                kind: if first.is_some() {
                    "music"
                } else if title_page && index == 0 {
                    "title"
                } else {
                    "blank"
                }
                .to_owned(),
                physical_turn_after: requires_physical_turn(input.pages, index, first_page_recto),
            }
        })
        .collect();
    let systems = input
        .systems
        .iter()
        .enumerate()
        .filter_map(|(index, system)| {
            let (first_measure, last_measure) = system_measure_range(
                *system.first()?,
                *system.last()?,
                input.global.len(),
                |pos| input.visible_indices.get(pos).copied(),
            )?;
            let placed = &input.placed[index];
            let page = &input.pages[placed.page_index];
            let page_break_after = page.system_indices.last() == Some(&index)
                && Some(placed.page_index) != final_music_page;
            let window = windows.get(last_measure);
            Some(PaginationSystemDebug {
                system_index: index,
                first_measure,
                last_measure,
                natural_width: system.iter().map(|&pos| input.natural_widths[pos]).sum(),
                available_width: (placed.x_end - placed.x_start).max(0.0),
                page_break_after,
                physical_turn_after: page_break_after
                    && pages[placed.page_index].physical_turn_after,
                planned_page_break_after: input
                    .plan
                    .is_some_and(|plan| plan.page_starts.contains(&(index + 1))),
                boundary: window.map(|w| PaginationBoundaryDebug {
                    tail_seconds: w.tail_seconds,
                    head_seconds: w.head_seconds,
                    head_rest_measures: w.head_rest_measures,
                    quality: match w.quality {
                        TurnQuality::Comfortable => "comfortable",
                        TurnQuality::Vs => "quick",
                        TurnQuality::Tight => "tight",
                        TurnQuality::Impossible => "impossible",
                    }
                    .to_owned(),
                    structural: w.structural,
                    fermata_blocked: w.fermata_blocked,
                    turn_cost: turn_cost(w, pt),
                }),
            })
        })
        .collect();
    let actual_starts: Vec<_> = input
        .pages
        .iter()
        .filter_map(|p| p.system_indices.first().copied())
        .collect();
    PaginationDebugInfo {
        status: status.to_owned(),
        comfortable_secs: pt.comfortable_secs,
        vs_secs: pt.vs_secs,
        min_fill_fraction: pt.min_fill_fraction,
        target_fill_fraction: pt.target_fill_fraction,
        first_page_recto,
        title_page,
        measured_repacking: input
            .plan
            .is_some_and(|p| p.page_starts != actual_starts || p.systems != input.systems),
        pages,
        systems,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pagination_debug_blank_pages_do_not_hide_turns() {
        let page = |page_number, system_indices| PageLayout {
            page_number,
            system_indices,
            y_offset: page_number as f64 * 100.0,
            height: 100.0,
        };
        let pages = vec![page(0, vec![0]), page(1, vec![]), page(2, vec![1])];
        assert!(requires_physical_turn(&pages, 0, false));
        assert!(!requires_physical_turn(&pages, 1, false));
        assert!(!requires_physical_turn(&pages, 2, false));
        let facing = vec![page(0, vec![0]), page(1, vec![1])];
        assert!(!requires_physical_turn(&facing, 0, false));
        assert!(requires_physical_turn(&facing, 0, true));
    }
}
