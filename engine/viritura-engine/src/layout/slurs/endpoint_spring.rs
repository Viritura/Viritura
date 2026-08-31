use super::participation::EventRenderInfo;
use super::tuning;
use std::collections::HashMap;

pub(super) fn endpoint_note_position(
    authored_note_id: Option<&str>,
    note_map: &HashMap<String, (f64, f64)>,
    endpoint: &EventRenderInfo,
    use_top: bool,
) -> (f64, f64) {
    authored_note_id
        .and_then(|id| note_map.get(id).copied())
        .unwrap_or((
            if use_top {
                endpoint.y_pos
            } else {
                endpoint.y_pos_bottom
            },
            endpoint.eff_staff_y,
        ))
}

#[allow(clippy::too_many_arguments)] // Compares both rendered endpoint frames.
pub(super) fn grace_source_needs_stem_escape(
    src: &EventRenderInfo,
    tgt_eff_y: f64,
    tgt_y_pos: f64,
    src_eff_y: f64,
    src_y_pos: f64,
    curve_above: bool,
    src_targets_note: bool,
    sp: f64,
) -> bool {
    src.mag < 1.0
        && src.stem_up
        && !src_targets_note
        && (curve_above
            || tgt_eff_y + tgt_y_pos * sp * 0.5 < src_eff_y + src_y_pos * sp * 0.5 - 0.5 * sp)
}

pub(super) fn notehead_y_offset(
    on_line: bool,
    mag: f64,
    grace_slur: bool,
    grace_to_chord: bool,
    sp: f64,
) -> f64 {
    if grace_to_chord {
        return 0.10 * sp;
    }
    let base = if on_line {
        tuning::STAFF_LINE_CLEARANCE_LINE_SP
    } else {
        tuning::STAFF_LINE_CLEARANCE_SPACE_SP
    };
    base * sp
        * if grace_slur {
            if mag < 1.0 {
                0.65
            } else {
                0.8
            }
        } else {
            1.0
        }
}

pub(super) fn targets_outer_stem_note(
    targeted: bool,
    y_pos: f64,
    endpoint: &EventRenderInfo,
) -> bool {
    !targeted
        || if endpoint.stem_up {
            (y_pos - endpoint.y_pos).abs() < 1.0e-6
        } else {
            (y_pos - endpoint.y_pos_bottom).abs() < 1.0e-6
        }
}

pub(super) fn uses_stem_side(
    endpoint: &EventRenderInfo,
    targets_note: bool,
    s_curve: bool,
    curve_above: bool,
) -> bool {
    endpoint.has_stem && !targets_note && !s_curve && curve_above == endpoint.stem_up
}

pub(super) fn uses_stem_side_x(
    endpoint: &EventRenderInfo,
    targets_note: bool,
    y_pos: f64,
    s_curve: bool,
    curve_above: bool,
) -> bool {
    endpoint.has_stem
        && !s_curve
        && curve_above == endpoint.stem_up
        && targets_outer_stem_note(targets_note, y_pos, endpoint)
}

#[allow(clippy::too_many_arguments)] // Endpoint eligibility is the rule's complete input surface.
pub(super) fn level_note_targeted_stem_pair(
    y1: f64,
    y2: f64,
    src_targets_note: bool,
    tgt_targets_note: bool,
    src_stem_side_x: bool,
    tgt_stem_side_x: bool,
    src: &EventRenderInfo,
    tgt: &EventRenderInfo,
    src_eff_y: f64,
    tgt_eff_y: f64,
) -> (f64, f64) {
    if src_targets_note
        && tgt_targets_note
        && src_stem_side_x
        && tgt_stem_side_x
        && src.note_count == 2
        && tgt.note_count == 2
        && (src_eff_y - tgt_eff_y).abs() < 1.0e-6
    {
        let spring_y = (y1 + y2) * 0.5;
        (spring_y, spring_y)
    } else {
        (y1, y2)
    }
}

pub(super) fn correct_mixed_tilt(y1: f64, y2: f64, context: (f64, bool, bool, bool)) -> (f64, f64) {
    let (pitch_slope, src_stem_side, tgt_stem_side, mixed_stems) = context;
    if !mixed_stems || src_stem_side == tgt_stem_side {
        return (y1, y2);
    }
    let endpoint_slope = y2 - y1;
    if pitch_slope.abs() < 1.0e-6 || pitch_slope * endpoint_slope >= 0.0 {
        return (y1, y2);
    }

    if src_stem_side {
        (y2, y2)
    } else {
        (y1, y1)
    }
}

pub(super) fn stem_contained_x(
    endpoint: &EventRenderInfo,
    inward_sign: f64,
    inward_tuck: f64,
) -> f64 {
    let stem_x = if endpoint.stem_up {
        endpoint.x + endpoint.notehead_w
    } else {
        endpoint.x
    };
    stem_x + inward_sign * inward_tuck
}

pub(super) fn apply_beam_tip_clearance(
    y: f64,
    endpoint: &EventRenderInfo,
    curve_dir: f64,
    stem_side: bool,
    sp: f64,
) -> f64 {
    if !stem_side {
        return y;
    }
    let clearance = tuning::BEAM_TIP_CLEARANCE_SP * sp;
    if curve_dir < 0.0 {
        endpoint
            .beam_top_y
            .map_or(y, |beam_top| y.min(beam_top - clearance))
    } else {
        endpoint
            .beam_bottom_y
            .map_or(y, |beam_bottom| y.max(beam_bottom + clearance))
    }
}
