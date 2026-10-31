use super::super::cache::{LayoutCache, RetainedSegment, RetainedStaffContentLayer};
use super::super::config::LayoutConfig;
use super::super::full_score::{FlatStaff, GroupRange};
use super::super::slurs::{GlobalSlurEvent, SystemSlurBounds};
use super::super::ties::GlobalTieNote;
use super::super::types::{AccidentalObstacle, MeasureLayout};
use super::render_hashing::{staff_content_render_hash, system_has_cross_staff_events};
use super::render_setup::{clef_change_hash, score_render_context_hash};
use super::retained_segments::{display_list_store_marker, extract_display_list_range};
use super::shared::{
    collect_system_slur_data, render_system_staff_content, render_system_staff_lines,
};
use crate::model::{Clef, Score};
use crate::render::DisplayList;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;

pub(super) struct ExplicitStaffRetention {
    prior: HashMap<u64, RetainedSegment>,
    next: HashMap<u64, RetainedSegment>,
    reused: usize,
    score_dependency_hash: u64,
}

impl ExplicitStaffRetention {
    pub(super) fn new(cache: &mut LayoutCache, score: &Score) -> Self {
        let mut hasher = DefaultHasher::new();
        "authored-staff-content".hash(&mut hasher);
        super::super::lyric_extenders::cache_dependency_hash(score).hash(&mut hasher);
        super::super::volta::paged_ottava_dependency_hash(score, 0).hash(&mut hasher);
        super::super::support_flags::engraving_flags(score).hash(&mut hasher);
        Self {
            prior: cache.take_retained_segments(),
            next: HashMap::new(),
            reused: 0,
            score_dependency_hash: hasher.finish(),
        }
    }

    pub(super) fn finish(self, cache: &mut LayoutCache) {
        cache.set_retained_segments(self.next);
        cache.set_staff_content_reuses(self.reused);
        cache.set_staff_content_reuse_runs(self.reused);
    }

    fn replay(
        &mut self,
        hash: u64,
        dl: &mut DisplayList,
        obstacles: &mut Vec<AccidentalObstacle>,
    ) -> bool {
        let Some(retained) = self.prior.remove(&hash) else {
            return false;
        };
        let layer = retained
            .staff_content_layers
            .as_ref()
            .and_then(|layers| layers.first())
            .expect("retained authored staff must include accidental obstacles");
        obstacles.extend(layer.accidental_obstacles.iter().copied());
        let mut segment = retained.segment.as_ref().clone();
        segment.width = dl.width;
        segment.height = dl.height;
        dl.append(segment);
        self.next.insert(hash, retained);
        self.reused += 1;
        true
    }

    fn capture(
        &mut self,
        hash: u64,
        dl: &DisplayList,
        start: super::super::cache::DisplayListStoreMarker,
        obstacles: &[AccidentalObstacle],
    ) {
        let end = display_list_store_marker(dl);
        let mut segment = extract_display_list_range(dl, start, end, dl.width, dl.height)
            .expect("authored staff render markers must delimit valid display-list stores");
        segment.parts.clear();
        let layer = RetainedStaffContentLayer {
            render_hash: hash,
            rendered_x0: 0.0,
            rendered_y: 0.0,
            start: Default::default(),
            end: display_list_store_marker(&segment),
            accidental_obstacles: obstacles.to_vec(),
        };
        self.next.insert(
            hash,
            RetainedSegment {
                rendered_x0: 0.0,
                rendered_y0: 0.0,
                segment: Arc::new(segment),
                slur_data: None,
                staff_content_layers: Some(vec![layer]),
            },
        );
    }
}

#[allow(clippy::too_many_arguments)] // Authored staff rendering keeps layout, shared accidental ordering, and cross-system capture together.
pub(super) fn render_system_staves_and_contents(
    dl: &mut DisplayList,
    all_staff_layouts: &[Vec<MeasureLayout>],
    flat_staves: &[FlatStaff],
    measure_staves: &[HashMap<usize, &FlatStaff>],
    staff_y_offsets: &[f64],
    next_sys_clef_per_staff: &[Option<&Clef>],
    score: &Score,
    lyric_line_order: Option<&[String]>,
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    sys_idx: usize,
    system_count: usize,
    suppress_final_barline: bool,
    logical_system_index: usize,
    slur_bounds: &mut HashMap<(usize, usize, usize), SystemSlurBounds>,
    global_slur_events: &mut Vec<GlobalSlurEvent>,
    global_tie_notes: &mut Vec<GlobalTieNote>,
    clef_change_measures: &HashSet<usize>,
    tie_maps_per_staff: Option<&[HashMap<String, bool>]>,
    group_ranges: &[GroupRange],
    mut retention: Option<&mut ExplicitStaffRetention>,
) {
    render_system_staff_lines(
        dl,
        all_staff_layouts,
        flat_staves,
        staff_y_offsets,
        margin_left,
        sp,
        config,
    );
    let retain = retention.is_some()
        && !system_has_cross_staff_events(all_staff_layouts)
        && flat_staves.iter().all(|staff| staff.sources.len() == 1)
        && all_staff_layouts
            .iter()
            .flatten()
            .all(|measure| measure.resolved.effective_staff_meter.is_none());
    let context_hash = if retain {
        let context_hash = score_render_context_hash(
            sp,
            4.0 * sp,
            config.barline_width * sp,
            lyric_line_order,
            flat_staves,
            group_ranges,
            None,
        );
        let context_hash =
            super::super::instrument_changes::state_salt(score, flat_staves, context_hash);
        let mut hasher = DefaultHasher::new();
        context_hash.hash(&mut hasher);
        retention
            .as_ref()
            .expect("retention is enabled")
            .score_dependency_hash
            .hash(&mut hasher);
        hasher.finish()
    } else {
        0
    };
    let clef_hash = clef_change_hash(clef_change_measures);
    let mut acc_obstacles = Vec::new();
    for staff_idx in 0..all_staff_layouts.len() {
        let hash = retain.then(|| {
            let content_hashes: Vec<_> = all_staff_layouts[staff_idx]
                .iter()
                .map(|measure| super::super::cache::measure_content_hash(&measure.resolved))
                .collect();
            let hash = staff_content_render_hash(
                &all_staff_layouts[staff_idx],
                &content_hashes,
                staff_y_offsets,
                next_sys_clef_per_staff[staff_idx],
                margin_left,
                sys_idx,
                staff_idx,
                sys_idx == system_count - 1,
                clef_hash,
                context_hash,
            );
            let mut hasher = DefaultHasher::new();
            hash.hash(&mut hasher);
            staff_y_offsets[staff_idx].to_bits().hash(&mut hasher);
            hasher.finish()
        });
        if let (Some(retention), Some(hash)) = (retention.as_deref_mut(), hash) {
            if retention.replay(hash, dl, &mut acc_obstacles) {
                continue;
            }
        }
        let start = display_list_store_marker(dl);
        let obstacle_start = acc_obstacles.len();
        render_system_staff_content(
            dl,
            all_staff_layouts,
            flat_staves,
            measure_staves.get(staff_idx),
            staff_y_offsets,
            next_sys_clef_per_staff,
            score,
            lyric_line_order,
            sp,
            config,
            sys_idx,
            system_count,
            suppress_final_barline,
            logical_system_index,
            clef_change_measures,
            tie_maps_per_staff,
            staff_idx,
            &mut acc_obstacles,
        );
        if let (Some(retention), Some(hash)) = (retention.as_deref_mut(), hash) {
            retention.capture(hash, dl, start, &acc_obstacles[obstacle_start..]);
        }
    }
    let gliss_staves: Vec<super::super::glissando::GlissandoStaff<'_>> = all_staff_layouts
        .iter()
        .enumerate()
        .map(|(index, layouts)| (layouts.as_slice(), staff_y_offsets[index]))
        .collect();
    super::super::render_glissandos(dl, &gliss_staves, sp, config, Some(staff_y_offsets));
    super::super::trill_lines::render_trill_lines_for_system(
        dl,
        all_staff_layouts,
        staff_y_offsets,
        sp,
        config,
    );
    collect_system_slur_data(
        all_staff_layouts,
        flat_staves,
        staff_y_offsets,
        margin_left,
        sp,
        config,
        sys_idx,
        slur_bounds,
        global_slur_events,
        global_tie_notes,
    );
}
