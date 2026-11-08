//! Structural ties use endpoint fragments, never a curve through skipped music.

use super::{
    chord_tie_dir, has_continuing_tie, is_inner_chord_note, tie_endpoint_x, GlobalTieNote,
};
use crate::layout::config::LayoutConfig;
use crate::layout::curves::{compute_filled_bezier, filled_bezier_band, FilledBezierParams};
use crate::layout::{element_id, slurs::tuning::TIE_NOTEHEAD_STANDOFF_SP};
use crate::render::{DisplayList, ElementKind};
use std::collections::{HashMap, HashSet};

fn emit(dl: &mut DisplayList, params: FilledBezierParams, id: String) {
    if params.x2 - params.x1 < 0.4 * params.sp {
        return;
    }
    let band = filled_bezier_band(&params);
    dl.push_tagged(compute_filled_bezier(&params), id.clone());
    dl.push_shape_band(band, id, ElementKind::Tie, None, None);
}

pub(super) fn render(
    dl: &mut DisplayList,
    notes: &[GlobalTieNote],
    sp: f64,
    config: &LayoutConfig,
) {
    let targets: HashSet<&str> = notes
        .iter()
        .flat_map(|note| &note.ties)
        .filter(|tie| tie.lv != Some(true) && tie.target_type.as_deref() == Some("crossJump"))
        .filter_map(|tie| tie.target.as_deref())
        .collect();
    if targets.is_empty() {
        return;
    }
    let incoming: HashSet<&str> = notes
        .iter()
        .flat_map(|note| &note.ties)
        .filter_map(|tie| tie.target.as_deref())
        .collect();
    let mut lookup: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, note) in notes.iter().enumerate() {
        if targets.contains(note.note_id.as_ref()) {
            lookup.entry(note.note_id.as_ref()).or_default().push(index);
        }
    }
    let mut outgoing_drawn = HashSet::new();
    let mut incoming_drawn = HashSet::new();
    for source in notes {
        for tie in &source.ties {
            if tie.lv == Some(true) || tie.target_type.as_deref() != Some("crossJump") {
                continue;
            }
            let Some(indices) = tie.target.as_deref().and_then(|id| lookup.get(id)) else {
                continue;
            };
            let Some(index) = super::super::cross_system::prefer_target(
                indices,
                source.part_index,
                source.staff_idx,
                |index| notes[index].part_index,
                |index| notes[index].staff_idx,
            ) else {
                continue;
            };
            let target = &notes[index];
            let direction = match tie.side.as_deref() {
                Some("up") => -1.0,
                Some("down") => 1.0,
                _ => chord_tie_dir(
                    source.y_pos,
                    &source.chord_positions,
                    source.stem_up,
                    source.num_voices > 1,
                ),
            };
            let endpoint = |note: &GlobalTieNote, from: bool, chained: bool| {
                tie_endpoint_x(
                    note.x,
                    note.notehead_center_offset,
                    note.stem_x,
                    note.stem_up,
                    is_inner_chord_note(note.y_pos, &note.chord_positions),
                    direction,
                    from,
                    chained,
                    1.0,
                    sp,
                )
            };
            let params = |x1, x2, note: &GlobalTieNote| {
                let y = note.eff_staff_y
                    + note.y_pos * sp * 0.5
                    + direction * TIE_NOTEHEAD_STANDOFF_SP * sp;
                FilledBezierParams {
                    x1,
                    y1: y,
                    x2,
                    y2: y,
                    curve_dir: direction,
                    height_inf: config.tie_height_inf,
                    rise_rate: config.tie_rise_rate,
                    cp_indent: config.tie_cp_indent,
                    thickness: config.tie_thickness * sp,
                    min_thickness: config.tie_min_thickness * sp,
                    endpoint_thickness: config.tie_endpoint_thickness * sp,
                    sp,
                    line_style: 0,
                }
            };
            let id = element_id::tie(&source.note_id, &target.note_id);
            let has_written_continuation = source.ties.iter().any(|other| {
                other.lv != Some(true)
                    && other.target.is_some()
                    && other.target_type.as_deref() != Some("crossJump")
            });
            // An ordinary tie into the first ending already supplies the source-side ink.
            if !has_written_continuation
                && outgoing_drawn.insert((
                    source.system_idx,
                    source.part_index,
                    source.staff_idx,
                    source.note_id.as_ref(),
                ))
            {
                let x1 = endpoint(source, true, incoming.contains(source.note_id.as_ref()));
                let x2 = (source.measure_right_x - 0.3 * sp)
                    .max(x1 + sp)
                    .min(x1 + 2.5 * sp);
                emit(dl, params(x1, x2, source), format!("{id}/lh"));
            }
            if incoming_drawn.insert((
                target.system_idx,
                target.part_index,
                target.staff_idx,
                target.note_id.as_ref(),
                direction as i32,
            )) {
                let x2 = endpoint(target, false, has_continuing_tie(&target.ties));
                let x1 = (x2 - 2.5 * sp).max(target.measure_left_x + 0.3 * sp);
                emit(dl, params(x1, x2, target), id);
            }
        }
    }
}
