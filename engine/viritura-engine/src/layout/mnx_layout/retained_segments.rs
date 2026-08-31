#![allow(unused_imports)]

use super::super::*;
use super::shared::*;
use crate::model::*;
use crate::render::*;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(super) fn splice_retained_slur_data(
    src: &cache::RetainedSlurData,
    dx: f64,
    dy: f64,
    slur_bounds: &mut std::collections::HashMap<
        (usize, usize, usize),
        super::super::slurs::SystemSlurBounds,
    >,
    global_slur_events: &mut Vec<super::super::slurs::GlobalSlurEvent>,
    global_tie_notes: &mut Vec<super::super::ties::GlobalTieNote>,
) {
    for &(key, bounds) in &src.bounds {
        slur_bounds.insert(
            key,
            super::super::slurs::SystemSlurBounds {
                left_x: bounds.left_x + dx,
                right_x: bounds.right_x + dx,
            },
        );
    }
    if dx == 0.0 && dy == 0.0 {
        global_slur_events.extend(src.events.iter().cloned());
        global_tie_notes.extend(src.notes.iter().cloned());
    } else {
        for ev in &src.events {
            let mut ev = ev.clone();
            ev.x += dx;
            ev.y_pos += dy;
            ev.y_pos_bottom += dy;
            ev.eff_staff_y += dy;
            if let Some(x) = ev.accidental_right_x.as_mut() {
                *x += dx;
            }
            if let Some(x) = ev.dot_right_x.as_mut() {
                *x += dx;
            }
            for np in &mut ev.note_positions {
                np.2 += dy; // (note_id, y_pos, eff_staff_y) — only eff_staff_y is absolute
            }
            global_slur_events.push(ev);
        }
        for n in &src.notes {
            let mut n = n.clone();
            n.x += dx;
            n.eff_staff_y += dy;
            global_tie_notes.push(n);
        }
    }
}

/// Reduce cross-system dependency snapshots to the graph nodes the overlay can
/// actually query: outgoing spanner sources plus their referenced event/note
/// targets. Collection initially sees every ID so targets can be resolved; the
/// compacted retained form makes subsequent edits O(spanners), not O(events).
pub(super) fn compact_cross_system_dependencies(
    events: &mut Vec<super::super::slurs::GlobalSlurEvent>,
    notes: &mut Vec<super::super::ties::GlobalTieNote>,
    bounds: &mut HashMap<(usize, usize, usize), super::super::slurs::SystemSlurBounds>,
    retained: &mut HashMap<u64, cache::RetainedSegment>,
) {
    let mut target_events: HashSet<String> = HashSet::new();
    let mut target_slur_notes: HashSet<String> = HashSet::new();
    for event in events.iter() {
        for slur in &event.slurs {
            target_events.insert(slur.target.clone());
            if let Some(note_id) = &slur.start_note {
                target_slur_notes.insert(note_id.clone());
            }
            if let Some(note_id) = &slur.end_note {
                target_slur_notes.insert(note_id.clone());
            }
        }
    }
    let mut target_tie_notes: HashSet<String> = HashSet::new();
    for note in notes.iter() {
        for tie in &note.ties {
            if let Some(target) = &tie.target {
                target_tie_notes.insert(target.clone());
            }
        }
    }

    let keep_event = |event: &super::super::slurs::GlobalSlurEvent| {
        !event.slurs.is_empty()
            || target_events.contains(event.event_id.as_ref())
            || event
                .note_positions
                .iter()
                .any(|(note_id, _, _)| target_slur_notes.contains(note_id.as_ref()))
    };
    let keep_note = |note: &super::super::ties::GlobalTieNote| {
        !note.ties.is_empty() || target_tie_notes.contains(note.note_id.as_ref())
    };
    events.retain(&keep_event);
    notes.retain(&keep_note);
    let required_bounds: HashSet<(usize, usize, usize)> = events
        .iter()
        .map(|event| (event.system_idx, event.part_index, event.staff_idx))
        .chain(
            notes
                .iter()
                .map(|note| (note.system_idx, note.part_index, note.staff_idx)),
        )
        .collect();
    bounds.retain(|key, _| required_bounds.contains(key));
    for segment in retained.values_mut() {
        if let Some(data) = segment.slur_data.as_mut() {
            data.events.retain(&keep_event);
            data.notes.retain(&keep_note);
            let segment_bounds: HashSet<(usize, usize, usize)> = data
                .events
                .iter()
                .map(|event| (event.system_idx, event.part_index, event.staff_idx))
                .chain(
                    data.notes
                        .iter()
                        .map(|note| (note.system_idx, note.part_index, note.staff_idx)),
                )
                .collect();
            data.bounds.retain(|(key, _)| segment_bounds.contains(key));
        }
    }
}

/// Slice the global content appended after the per-system render loop
/// (cross-system slurs/ties, page-turn hints) into a standalone, appendable
/// `DisplayList`. The slice runs from `marker` (store lengths captured at the
/// end of the per-system loop) to the current end of `dl`. `ShapeGeom::Cmd`
/// command indices are re-based to overlay-relative so a later `append`
/// re-bases them back correctly. The captured field set mirrors what the
/// per-system assembly carries; `element_shapes` are sliced for completeness
/// even though the binary protocol omits them.
pub(super) fn extract_overlay_segment(
    dl: &DisplayList,
    marker: (usize, usize, usize, usize, usize, usize),
    width: f64,
    height: f64,
) -> DisplayList {
    let (nc, _neid, nbb, nshape, nslur, nmb) = marker;
    let mut overlay = DisplayList::new(width, height);
    overlay.commands = dl.commands[nc..].to_vec();
    // `element_ids` obeys the invariant: empty, or length == commands.len().
    // When non-empty, the overlay-relative ids are the tail aligned to the
    // sliced commands (start at `nc`, not the captured marker length).
    if dl.element_ids.len() == dl.commands.len() {
        overlay.element_ids = dl.element_ids[nc..].to_vec();
    }
    overlay.element_bboxes = dl.element_bboxes[nbb..].to_vec();
    overlay.slur_geometries = dl.slur_geometries[nslur..].to_vec();
    overlay.measure_bounds = dl.measure_bounds[nmb..].to_vec();
    for sh in &dl.element_shapes[nshape..] {
        let mut sh = sh.clone();
        if let ShapeGeom::Cmd { cmd_idx } = &mut sh.geom {
            *cmd_idx = cmd_idx.saturating_sub(nc as u32);
        }
        overlay.element_shapes.push(sh);
    }
    overlay
}

pub(super) fn display_list_store_marker(dl: &DisplayList) -> cache::DisplayListStoreMarker {
    cache::DisplayListStoreMarker {
        commands: dl.commands.len(),
        element_bboxes: dl.element_bboxes.len(),
        element_shapes: dl.element_shapes.len(),
        slur_geometries: dl.slur_geometries.len(),
        measure_bounds: dl.measure_bounds.len(),
    }
}

pub(super) fn remap_store_marker(
    destination: cache::DisplayListStoreMarker,
    marker: cache::DisplayListStoreMarker,
    source_origin: cache::DisplayListStoreMarker,
) -> cache::DisplayListStoreMarker {
    cache::DisplayListStoreMarker {
        commands: destination.commands + marker.commands.saturating_sub(source_origin.commands),
        element_bboxes: destination.element_bboxes
            + marker
                .element_bboxes
                .saturating_sub(source_origin.element_bboxes),
        element_shapes: destination.element_shapes
            + marker
                .element_shapes
                .saturating_sub(source_origin.element_shapes),
        slur_geometries: destination.slur_geometries
            + marker
                .slur_geometries
                .saturating_sub(source_origin.slur_geometries),
        measure_bounds: destination.measure_bounds
            + marker
                .measure_bounds
                .saturating_sub(source_origin.measure_bounds),
    }
}

pub(super) fn extract_display_list_range(
    dl: &DisplayList,
    start: cache::DisplayListStoreMarker,
    end: cache::DisplayListStoreMarker,
    width: f64,
    height: f64,
) -> Option<DisplayList> {
    if start.commands > end.commands
        || end.commands > dl.commands.len()
        || start.element_bboxes > end.element_bboxes
        || end.element_bboxes > dl.element_bboxes.len()
        || start.element_shapes > end.element_shapes
        || end.element_shapes > dl.element_shapes.len()
        || start.slur_geometries > end.slur_geometries
        || end.slur_geometries > dl.slur_geometries.len()
        || start.measure_bounds > end.measure_bounds
        || end.measure_bounds > dl.measure_bounds.len()
    {
        return None;
    }

    let mut segment = DisplayList::new(width, height);
    segment.commands = dl.commands[start.commands..end.commands].to_vec();
    if dl.element_ids.len() == dl.commands.len() {
        segment.element_ids = dl.element_ids[start.commands..end.commands].to_vec();
    }
    segment.element_bboxes = dl.element_bboxes[start.element_bboxes..end.element_bboxes].to_vec();
    segment.slur_geometries =
        dl.slur_geometries[start.slur_geometries..end.slur_geometries].to_vec();
    segment.measure_bounds = dl.measure_bounds[start.measure_bounds..end.measure_bounds].to_vec();
    for shape in &dl.element_shapes[start.element_shapes..end.element_shapes] {
        let mut shape = shape.clone();
        if let ShapeGeom::Cmd { cmd_idx } = &mut shape.geom {
            *cmd_idx = cmd_idx.saturating_sub(start.commands as u32);
        }
        segment.element_shapes.push(shape);
    }
    Some(segment)
}

pub(super) fn compute_chunked_global_offsets(
    precomp_layouts: &[Vec<Vec<MeasureLayout>>],
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    dirty_region: Option<&cache::DirtyRegion>,
    margin_top: f64,
    justified_gap: f64,
    min_clearance: f64,
    sp: f64,
    staff_height: f64,
    config: &LayoutConfig,
    mut layout_cache: Option<&mut cache::LayoutCache>,
) -> StaffYPlacement {
    let prior_extents = layout_cache
        .as_deref_mut()
        .map(cache::LayoutCache::take_horizon_staff_extents)
        .unwrap_or_default();
    let can_reuse = !config.emit_layout_debug && prior_extents.len() == flat_staves.len();
    let mut reused = 0usize;
    let mut extents = Vec::with_capacity(flat_staves.len());

    for (staff_idx, _) in flat_staves.iter().enumerate() {
        let receives_meter = crate::layout::time_signatures::spanning::staff_receives_meter(
            staff_idx,
            group_ranges,
            flat_staves.len(),
            config.time_signature_settings,
        );
        let affected = dirty_region
            .map(|region| region.affects_flat_staff(staff_idx))
            .unwrap_or(true);
        if can_reuse && !affected {
            extents.push(prior_extents[staff_idx]);
            reused += 1;
            continue;
        }

        let mut below = staff_height;
        let mut above = 0.0f64;
        let mut has_dynamics = false;
        let mut has_lyrics = false;
        for measures in precomp_layouts
            .iter()
            .filter_map(|system| system.get(staff_idx))
        {
            for measure in measures {
                below = below.max(super::super::render_annotations::lowest_point_in_measure(
                    measure,
                    0.0,
                    sp,
                    config.stem_length,
                ));
                above = above.max(-super::super::render_annotations::highest_point_in_measure(
                    measure,
                    0.0,
                    sp,
                    config.stem_length,
                ));
                if receives_meter {
                    if let Some((_left, _right, meter_top)) =
                        crate::layout::time_signatures::above_staff_extent(
                            measure,
                            0.0,
                            sp,
                            config.time_signature_settings,
                        )
                    {
                        above = above.max(-meter_top);
                    }
                }
                has_dynamics |= measure
                    .resolved
                    .part
                    .dynamics
                    .as_ref()
                    .is_some_and(|dynamics| !dynamics.is_empty());
                has_lyrics |= measure.resolved.part.sequences.iter().any(|sequence| {
                    sequence.content.iter().any(|content| {
                        matches!(content, SequenceContent::Event(event)
                            if event.lyrics.as_ref().is_some_and(|lyrics|
                                lyrics.lines.as_ref().is_some_and(|lines| !lines.is_empty())))
                    })
                });
            }
        }
        if has_dynamics {
            below = below.max(staff_height + 4.5 * sp);
        }
        if has_lyrics {
            below = below.max(staff_height + 5.0 * sp);
        }
        extents.push(cache::HorizonStaffExtent { below, above });
    }

    let mut offsets = Vec::with_capacity(flat_staves.len());
    let mut y = margin_top;
    if !flat_staves.is_empty() {
        offsets.push(y);
    }
    for staff_idx in 1..flat_staves.len() {
        let content_y = y + extents[staff_idx - 1].below + extents[staff_idx].above + min_clearance;
        let standard_y = y + staff_height + justified_gap;
        y = content_y.max(standard_y);
        offsets.push(y);
    }

    if let Some(layout_cache) = layout_cache {
        layout_cache.set_horizon_staff_extents(extents, reused);
    }
    StaffYPlacement {
        offsets,
        pair_debug: Vec::new(),
    }
}
