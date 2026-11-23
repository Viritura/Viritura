use super::participation::EventRenderInfo;
use super::tuning;
use std::collections::HashMap;

pub(super) fn snap_tip_off_staff_line(y: f64, eff_y: f64, curve_dir: f64, sp: f64) -> f64 {
    let half_spaces = (y - eff_y) / (sp * 0.5);
    let nearest = half_spaces.round();
    if (0.0..=8.0).contains(&nearest)
        && (nearest as i32) % 2 == 0
        && (half_spaces - nearest).abs() < 0.30
    {
        y + curve_dir * tuning::STAFF_LINE_NUDGE_SP * sp
    } else {
        y
    }
}

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

pub(super) fn correct_mixed_tilt(
    y1: f64,
    y2: f64,
    context: (f64, f64, bool, bool, bool),
) -> (f64, f64) {
    let (pitch_slope, curve_dir, src_stem_side, tgt_stem_side, mixed_stems) = context;
    if !mixed_stems || src_stem_side == tgt_stem_side {
        return (y1, y2);
    }
    let endpoint_slope = y2 - y1;
    if pitch_slope.abs() < 1.0e-6 || pitch_slope * endpoint_slope >= 0.0 {
        return (y1, y2);
    }

    // Contour must not pull a stem-side tip inward through the stem or beam.
    let stem_move = if src_stem_side { y2 - y1 } else { y1 - y2 };
    if stem_move * curve_dir < 0.0 {
        (y1, y2)
    } else if src_stem_side {
        (y2, y2)
    } else {
        (y1, y1)
    }
}

/// Standard engraving practice (Gould, *Behind Bars* p.111): when the outer
/// notes have opposite stems, the stem-side tip moves from the stem end toward
/// its notehead so the slur does not tilt against the pitch contour. The tip
/// starts just clear of the notehead and floats outward along the stem by half
/// the pitch difference. It keeps the stem-tip anchor when that float would
/// reach past the stem end, or when a flag or beam occupies the inside of the
/// stem.
pub(super) struct MixedStemContour<'a> {
    src: &'a EventRenderInfo,
    tgt: &'a EventRenderInfo,
    /// Absolute Y of the slur-side outer notehead at each endpoint.
    note_ys: (f64, f64),
    curve_dir: f64,
    sp: f64,
}

impl<'a> MixedStemContour<'a> {
    /// Stem-side endpoints never target a specific chord note, so the
    /// slur-side outer note of each endpoint snapshot is the anchoring note.
    pub(super) fn new(
        src: &'a EventRenderInfo,
        tgt: &'a EventRenderInfo,
        curve_dir: f64,
        sp: f64,
    ) -> Self {
        let note_y = |endpoint: &EventRenderInfo| {
            let pos = if curve_dir < 0.0 {
                endpoint.y_pos
            } else {
                endpoint.y_pos_bottom
            };
            endpoint.eff_staff_y + pos * sp * 0.5
        };
        Self {
            src,
            tgt,
            note_ys: (note_y(src), note_y(tgt)),
            curve_dir,
            sp,
        }
    }

    /// Returns the source tip offset and whether it still uses the stem-tip anchor.
    pub(super) fn source(&self, stem_side: bool, on_line: bool, stem_offset: f64) -> (f64, bool) {
        let rise = self.note_ys.1 - self.note_ys.0;
        self.tip(
            self.src,
            self.tgt,
            self.note_ys.0,
            rise,
            (stem_side, on_line),
            stem_offset,
        )
    }

    /// Returns the target tip offset and whether it still uses the stem-tip anchor.
    pub(super) fn target(&self, stem_side: bool, on_line: bool, stem_offset: f64) -> (f64, bool) {
        let rise = self.note_ys.0 - self.note_ys.1;
        self.tip(
            self.tgt,
            self.src,
            self.note_ys.1,
            rise,
            (stem_side, on_line),
            stem_offset,
        )
    }

    fn tip(
        &self,
        endpoint: &EventRenderInfo,
        other: &EventRenderInfo,
        note_y: f64,
        rise: f64,
        (stem_side, on_line): (bool, bool),
        stem_offset: f64,
    ) -> (f64, bool) {
        let (curve_dir, sp) = (self.curve_dir, self.sp);
        let inward_right = other.x >= endpoint.x;
        let stem_x = if endpoint.stem_up {
            endpoint.x + endpoint.notehead_w
        } else {
            endpoint.x
        };
        let inner_beam = endpoint.is_beamed
            && endpoint.beam_x_extent.is_none_or(|(left, right)| {
                if inward_right {
                    right > stem_x + 0.25 * sp
                } else {
                    left < stem_x - 0.25 * sp
                }
            });
        if !stem_side
            || endpoint.stem_up == other.stem_up
            || endpoint.mag < 1.0
            || inner_beam
            || (endpoint.has_flag && inward_right)
        {
            return (stem_offset, stem_side);
        }
        let float = if rise * curve_dir > 0.0 {
            0.5 * rise
        } else {
            0.0
        };
        let offset = curve_dir * notehead_y_offset(on_line, 1.0, false, false, sp) + float;
        if (offset - stem_offset) * curve_dir > 0.0 {
            return (stem_offset, stem_side);
        }
        // Off-line snapping moves a floated tip back toward its notehead so
        // it cannot overshoot the contour it is following.
        let y = note_y + offset;
        let snapped =
            super::render::apply_staff_line_clearance(y, -curve_dir, endpoint.eff_staff_y, sp);
        (snapped - note_y, false)
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

#[cfg(test)]
mod tests {
    use super::correct_mixed_tilt;

    #[test]
    fn mixed_tilt_flattens_outward_but_never_inward() {
        assert_eq!(
            correct_mixed_tilt(10.0, 9.0, (1.0, -1.0, true, false, true)),
            (9.0, 9.0)
        );
        assert_eq!(
            correct_mixed_tilt(9.0, 10.0, (-1.0, -1.0, true, false, true)),
            (9.0, 10.0)
        );
        assert_eq!(
            correct_mixed_tilt(10.0, 9.0, (1.0, 1.0, false, true, true)),
            (10.0, 10.0)
        );
        assert_eq!(
            correct_mixed_tilt(9.0, 10.0, (-1.0, 1.0, false, true, true)),
            (9.0, 10.0)
        );
    }
}
