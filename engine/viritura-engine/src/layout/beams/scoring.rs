//! Pure beam slope constraints and engraving-position scoring.

pub(super) const MAX_SLOPES: [i32; 8] = [0, 1, 2, 3, 4, 5, 6, 7];
pub(super) const MIN_STEM_LENGTHS_QS: [i32; 8] = [14, 14, 15, 18, 21, 24, 27, 30];
pub(super) const BEAM_SPACING: i32 = 3;
pub(super) const STAFF_LINES: i32 = 5;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum SlopeConstraint {
    NoConstraint,
    Flat,
    SmallSlope,
}

pub(crate) fn min_stem_length_qs(beam_count: u32) -> i32 {
    let index = (beam_count as usize)
        .saturating_sub(1)
        .min(MIN_STEM_LENGTHS_QS.len() - 1);
    MIN_STEM_LENGTHS_QS[index]
}

pub(crate) fn is_beam_inside_staff(y_pos: i32, staff_lines: i32, allow_floater: bool) -> bool {
    let above_staff = if allow_floater { -2 } else { -3 };
    let below_staff = (staff_lines - 1) * 4 + if allow_floater { 2 } else { 3 };
    y_pos > above_staff && y_pos < below_staff
}

pub(crate) fn is_valid_beam_position(
    is_up: bool,
    y_pos: i32,
    is_start: bool,
    is_ascending: bool,
    is_flat: bool,
    staff_lines: i32,
    is_outer: bool,
) -> bool {
    let slants_away = (is_up && is_ascending == is_start) || (!is_up && is_ascending != is_start);
    if !is_beam_inside_staff(y_pos, staff_lines, is_outer && (slants_away || is_flat)) {
        return true;
    }
    let y = y_pos + 8;
    if y % 4 == 2 {
        return false;
    }
    if is_flat || y % 4 == 0 {
        return true;
    }
    if y % 4 == 3 {
        return is_ascending != is_start;
    }
    is_ascending == is_start
}

pub(crate) fn get_max_slope(beam_width_sp: f64) -> i32 {
    if beam_width_sp < 3.0 {
        MAX_SLOPES[1]
    } else if beam_width_sp < 5.0 {
        MAX_SLOPES[2]
    } else if beam_width_sp < 7.5 {
        MAX_SLOPES[3]
    } else if beam_width_sp < 10.0 {
        MAX_SLOPES[4]
    } else if beam_width_sp < 15.0 {
        MAX_SLOPES[5]
    } else if beam_width_sp < 20.0 {
        MAX_SLOPES[6]
    } else {
        MAX_SLOPES[7]
    }
}

pub(crate) fn get_target_staff_line(stem_up: bool, staff_lines: i32, beam_count: u32) -> i32 {
    let beam_overlap = if beam_count == 3 {
        12
    } else if beam_count >= 4 {
        (beam_count as i32 - 4) * BEAM_SPACING + 14
    } else {
        8
    };
    let staff_overlap = beam_overlap.min((staff_lines - 1) * 4);
    if stem_up {
        (staff_lines - 1) * 4 - staff_overlap + 1
    } else {
        staff_overlap - 1
    }
}

pub(crate) fn get_slope_constraint(
    note_lines: &[i32],
    stem_up: bool,
    start_line: i32,
    end_line: i32,
) -> SlopeConstraint {
    if note_lines.is_empty() {
        return SlopeConstraint::NoConstraint;
    }
    if start_line == end_line {
        return SlopeConstraint::Flat;
    }
    if note_lines.len() <= 2 {
        return SlopeConstraint::NoConstraint;
    }

    let mut sorted = note_lines.to_vec();
    sorted.sort();
    let count = note_lines.len();
    if stem_up {
        let higher_end = start_line.min(end_line);
        if higher_end > sorted[0] {
            return SlopeConstraint::Flat;
        }
        if higher_end == sorted[0] && higher_end >= sorted[1] {
            if higher_end > sorted[1] {
                return SlopeConstraint::Flat;
            }
            if count >= 3 && sorted.len() >= 3 {
                if higher_end >= sorted[2] {
                    return SlopeConstraint::Flat;
                }
                let second_same = start_line < end_line && note_lines[1] == higher_end;
                let penultimate_same = end_line < start_line && note_lines[count - 2] == higher_end;
                if !(second_same || penultimate_same) {
                    return SlopeConstraint::Flat;
                }
                return SlopeConstraint::SmallSlope;
            }
            return SlopeConstraint::Flat;
        }
    } else {
        let lower_end = start_line.max(end_line);
        if lower_end < sorted[sorted.len() - 1] {
            return SlopeConstraint::Flat;
        }
        if lower_end == sorted[sorted.len() - 1] && lower_end <= sorted[sorted.len() - 2] {
            if lower_end < sorted[sorted.len() - 2] {
                return SlopeConstraint::Flat;
            }
            if count >= 3 && sorted.len() >= 3 {
                if lower_end <= sorted[sorted.len() - 3] {
                    return SlopeConstraint::Flat;
                }
                let second_same = start_line > end_line && note_lines[1] == lower_end;
                let penultimate_same = end_line > start_line && note_lines[count - 2] == lower_end;
                if !(second_same || penultimate_same) {
                    return SlopeConstraint::Flat;
                }
                return SlopeConstraint::SmallSlope;
            }
            return SlopeConstraint::Flat;
        }
    }
    SlopeConstraint::NoConstraint
}

#[allow(clippy::too_many_arguments)] // Pure slant score consumes both endpoint and quantization inputs.
pub(crate) fn compute_desired_slant(
    note_lines: &[i32],
    stem_up: bool,
    start_line: i32,
    end_line: i32,
    target_line: i32,
    dictator: i32,
    pointer: i32,
    beam_width_sp: f64,
) -> i32 {
    let dictator_extension = if stem_up {
        (target_line - dictator).min(0)
    } else {
        (target_line - dictator).max(0)
    };
    let pointer_extension = if stem_up {
        (target_line - pointer).min(0)
    } else {
        (target_line - pointer).max(0)
    };
    if dictator + dictator_extension == target_line && pointer + pointer_extension == target_line {
        return 0;
    }
    if start_line == end_line {
        return 0;
    }
    match get_slope_constraint(note_lines, stem_up, start_line, end_line) {
        SlopeConstraint::Flat => return 0,
        SlopeConstraint::SmallSlope => return if dictator > pointer { -1 } else { 1 },
        SlopeConstraint::NoConstraint => {}
    }
    let interval = (end_line - start_line)
        .unsigned_abs()
        .min(MAX_SLOPES.len() as u32 - 1) as usize;
    get_max_slope(beam_width_sp).min(MAX_SLOPES[interval]) * if stem_up { 1 } else { -1 }
}
