use super::scoring::{is_beam_inside_staff, is_valid_beam_position, BEAM_SPACING};

/// Find a valid beam offset by walking until inner and outer beams satisfy staff-position rules.
pub(super) fn find_valid_beam_offset(
    stem_up: bool,
    outer: i32,
    beam_count: i32,
    staff_lines: i32,
    is_start: bool,
    is_ascending: bool,
    is_flat: bool,
) -> i32 {
    let mut offset = 0;
    let spacing = if stem_up { -BEAM_SPACING } else { BEAM_SPACING };
    loop {
        let inner_beam = outer + (beam_count - 1) * spacing;
        while !is_valid_beam_position(
            stem_up,
            inner_beam + offset,
            is_start,
            is_ascending,
            is_flat,
            staff_lines,
            beam_count < 2,
        ) {
            offset += if stem_up { -1 } else { 1 };
        }
        let outer_beam = inner_beam
            + offset
            + get_outer_beam_pos_offset(stem_up, inner_beam + offset, beam_count, staff_lines);
        if is_valid_beam_position(
            stem_up,
            outer_beam,
            is_start,
            is_ascending,
            is_flat,
            staff_lines,
            true,
        ) {
            return offset;
        }
        offset += if stem_up { -1 } else { 1 };
        if offset.abs() > 40 {
            return offset;
        }
    }
}

pub(super) fn get_outer_beam_pos_offset(
    stem_up: bool,
    inner_beam: i32,
    beam_count: i32,
    staff_lines: i32,
) -> i32 {
    let spacing = if stem_up { -BEAM_SPACING } else { BEAM_SPACING };
    let mut offset = (beam_count - 1) * spacing;
    let mut is_inner = false;
    while offset != 0 && !is_beam_inside_staff(inner_beam + offset, staff_lines, is_inner) {
        offset -= spacing;
        is_inner = true;
    }
    offset
}

/// Add the standard middle-line slant when a beam sits on its target staff line.
pub(super) fn add_middle_line_slant(
    stem_up: bool,
    dictator: &mut i32,
    pointer: &mut i32,
    beam_count: i32,
    target_line: i32,
    interval: i32,
    desired_slant: i32,
) {
    if interval == 0 || beam_count > 2 {
        return;
    }
    if *pointer == target_line && (*pointer - *dictator).abs() < 2 {
        let offset = if desired_slant.abs() == 1 || interval == 1 || beam_count == 2 {
            if stem_up {
                -1
            } else {
                1
            }
        } else if stem_up {
            -2
        } else {
            2
        };
        *dictator = target_line + offset;
    }
}
