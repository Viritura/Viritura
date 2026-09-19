//! Note/chord ink shared by ordinary events and entry previews.

use super::*;
use crate::layout::grace::render_grace_slash;

/// Borrowed resolved geometry; written pitches never replace source pitches.
pub(crate) struct NoteChordInput<'a> {
    pub event: &'a Event,
    pub x: f64,
    pub stem_up: bool,
    pub note_positions: &'a [f64],
    pub note_x_offsets: &'a [f64],
    pub shared_noteheads: &'a [bool],
    pub display_pitches: &'a [Pitch],
    pub id: Option<&'a str>,
}

impl<'a> NoteChordInput<'a> {
    pub fn from_arena(events: &'a EventArena, ei: usize) -> Self {
        Self {
            event: events.event(ei),
            x: events.x(ei),
            stem_up: events.stem_up(ei),
            note_positions: events.note_positions(ei),
            note_x_offsets: events.note_x_offsets(ei),
            shared_noteheads: events.shared_noteheads(ei),
            display_pitches: events.display_pitches(ei),
            id: events.id(ei),
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct NoteChordStyle {
    pub scale: f64,
    pub slash: bool,
}

impl Default for NoteChordStyle {
    fn default() -> Self {
        Self {
            scale: 1.0,
            slash: false,
        }
    }
}

pub(crate) fn notehead_for_note(
    note: Option<&Note>,
    duration: &NoteValueBase,
    kit: Option<&HashMap<String, KitComponent>>,
) -> u32 {
    let shape = note.and_then(|note| match &note.kit_component {
        Some(id) => kit
            .and_then(|k| k.get(id))
            .and_then(|c| c.notehead.as_ref()),
        None => note.notehead.as_ref(),
    });
    smufl::shaped_notehead_glyph(shape, duration)
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)] // one chord's heads, dots, accidental skyline and stem share per-note metrics
pub(crate) fn render_note_chord(
    dl: &mut DisplayList,
    chord: NoteChordInput<'_>,
    staff_y: f64,
    staff_sp: f64,
    config: &LayoutConfig,
    style: NoteChordStyle,
    beamed_ids: &HashSet<String>,
    active_key: &KeySignature,
    measure_acc: &mut HashMap<(String, i32), i32>,
    use_accidental_display: bool,
    element_id: &str,
    ledger_left_ext: f64,
    ledger_right_ext: f64,
    kit: Option<&HashMap<String, KitComponent>>,
    tie_accidentals: Option<&HashMap<String, bool>>,
    sibling_noteheads: &[(f64, f64, f64)],
    sibling_accidentals: &[(f64, f64, f64, f64, Option<i32>)],
) {
    let event = chord.event;
    let notes = event.notes();
    let x = chord.x;
    let stem_up = chord.stem_up;
    let note_positions = chord.note_positions;
    let note_x_offsets = chord.note_x_offsets;
    let shared_noteheads = chord.shared_noteheads;
    let display_pitches = chord.display_pitches;
    let sp = staff_sp * style.scale;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let notehead_codepoint = smufl::notehead_glyph(&event.duration.base);
    let glyph_size = 4.0 * sp;
    let mut acc_infos = Vec::new();

    let per_note_cp = |i: usize| notehead_for_note(notes.get(i), &event.duration.base, kit);

    // Standard engraving practice: chord dots share a right-aligned column,
    // but their vertical slots and ledger lines remain on the full staff grid.
    let dot_align_x = {
        let mut max_right = f64::NEG_INFINITY;
        for (i, _) in note_positions.iter().enumerate() {
            let offset = note_x_offsets.get(i).copied().unwrap_or(0.0) * notehead_w;
            let right = x + offset + smufl::notehead_right_extent(per_note_cp(i)) * sp;
            max_right = max_right.max(right);
        }
        max_right.max(x + smufl::notehead_right_extent(notehead_codepoint) * sp)
    };
    let dot_y_offsets = compute_dot_y_offsets(note_positions, staff_sp);

    for (i, &pos) in note_positions.iter().enumerate() {
        if shared_noteheads.get(i).copied().unwrap_or(false) {
            continue;
        }
        let cp = per_note_cp(i);
        let note_y = staff_y + pos * staff_sp * 0.5;
        let note_x = x + note_x_offsets.get(i).copied().unwrap_or(0.0) * notehead_w;
        draw_ledger_lines_for_note(
            dl,
            pos,
            note_x,
            staff_y,
            staff_sp,
            smufl::notehead_width(cp) * sp,
            ledger_left_ext * style.scale,
            ledger_right_ext * style.scale,
            config.ledger_line_width,
        );
        // The breve's SMuFL origin aligns its body with the rhythmic column.
        let nh_x = if cp == smufl::NOTEHEAD_DOUBLE_WHOLE {
            note_x - smufl::NOTEHEAD_DOUBLE_WHOLE_ORIGIN.0 * sp
        } else {
            note_x
        };
        let notehead_cmd_idx = dl.commands.len();
        dl.push(RenderCommand::DrawGlyph {
            x: nh_x,
            y: note_y,
            codepoint: cp,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        });
        let nh_eid = element_id::source_notehead(element_id, notes.get(i), i);
        dl.tag_command(notehead_cmd_idx, nh_eid.clone());
        dl.push_shape_cmd(notehead_cmd_idx, nh_eid, ElementKind::Notehead, None, None);

        for d in 0..event.duration.dots.unwrap_or(0) {
            let dot_idx = dl.commands.len();
            dl.push(RenderCommand::DrawGlyph {
                x: dot_align_x + (0.4 + d as f64 * 0.5) * sp,
                y: note_y + dot_y_offsets[i],
                codepoint: smufl::AUGMENTATION_DOT,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
            dl.push_shape_cmd(
                dot_idx,
                format!("{element_id}/dot/{i}/{d}"),
                ElementKind::AugmentationDot,
                None,
                None,
            );
        }
        if let Some(info) = collect_one_note_accidental_info(
            &notes[i],
            i,
            pos,
            note_y,
            display_pitches.get(i),
            active_key,
            use_accidental_display,
            measure_acc,
            tie_accidentals,
        ) {
            acc_infos.push(info);
        }
    }
    render_accidentals_stacked(
        dl,
        &chord,
        x,
        sp,
        staff_sp,
        notehead_w,
        ledger_left_ext,
        glyph_size,
        &acc_infos,
        element_id,
        sibling_noteheads,
        sibling_accidentals,
    );

    let is_beamed = chord.id.is_some_and(|id| beamed_ids.contains(id));
    if event.duration.base.has_stem() && !note_positions.is_empty() && !is_beamed {
        let top_pos = note_positions.iter().copied().fold(f64::INFINITY, f64::min);
        let bottom_pos = note_positions
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        let a = extreme_stem_anchor(note_positions, stem_up, per_note_cp);
        render_chord_stem(
            dl,
            x,
            top_pos,
            bottom_pos,
            stem_up,
            a,
            &event.duration.base,
            staff_y,
            staff_sp,
            config,
            style,
        );
    }
}

#[allow(clippy::too_many_arguments)] // stem metrics distinguish full staff coordinates from grace-sized ink
fn render_chord_stem(
    dl: &mut DisplayList,
    x: f64,
    top_pos: f64,
    bottom_pos: f64,
    stem_up: bool,
    anchors: smufl::StemAnchors,
    duration: &NoteValueBase,
    staff_y: f64,
    staff_sp: f64,
    config: &LayoutConfig,
    style: NoteChordStyle,
) {
    let sp = staff_sp * style.scale;
    // Grace stems retain the staff's stroke weight, as do grace ledger lines.
    let stem_w = config.stem_width * staff_sp;
    let flag_count = duration.flag_count();
    let stem_length = if flag_count > 0 {
        config
            .stem_length
            .max(smufl::flag_inward_extent(flag_count, stem_up) + config.notehead_ry + 0.25)
    } else {
        config.stem_length
    };
    let edge = if stem_up { top_pos } else { bottom_pos };
    let flag_y = if style.scale == 1.0 {
        stem_tip_y(edge, stem_up, staff_y, staff_sp, stem_length)
    } else {
        // Grace stems are short even on ledger notes; they do not reach
        // back to the middle line like ordinary-size ledger-note stems.
        staff_y + edge * staff_sp * 0.5 + if stem_up { -1.0 } else { 1.0 } * stem_length * sp
    };
    let ext = smufl::flag_stem_extension(flag_count, stem_up) * sp;
    let (stem_x, stem_top, stem_bottom) = if stem_up {
        (
            x + anchors.up_se.0 * sp - stem_w * 0.5,
            flag_y - ext,
            staff_y + bottom_pos * staff_sp * 0.5 + anchors.up_se.1 * sp,
        )
    } else {
        (
            x + anchors.down_nw.0 * sp + stem_w * 0.5,
            staff_y + top_pos * staff_sp * 0.5 + anchors.down_nw.1 * sp,
            flag_y + ext,
        )
    };
    dl.stem(stem_x, stem_top, stem_bottom, stem_w);
    render_flags(dl, stem_x, flag_y, sp, duration, stem_up);
    if style.slash && flag_count > 0 {
        let center_y = if stem_up {
            stem_top + stem_length * sp * 0.35
        } else {
            stem_bottom - stem_length * sp * 0.35
        };
        render_grace_slash(
            dl,
            stem_x,
            center_y,
            staff_sp,
            style.scale,
            config.stem_width,
            "#000000",
        );
    }
}
