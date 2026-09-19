//! Rest glyph anchors and augmentation dots.

use crate::model::{Duration, NoteValueBase};
use crate::render::smufl::smufl;
use crate::render::*;

pub(crate) fn render_rest(
    dl: &mut DisplayList,
    element_id: &str,
    x: f64,
    staff_y: f64,
    sp: f64,
    duration: &Duration,
    staff_position: Option<i32>,
    centered_on_anchor: bool,
) {
    render_rest_scaled(
        dl,
        element_id,
        x,
        staff_y,
        sp,
        duration,
        staff_position,
        centered_on_anchor,
        1.0,
    );
}

pub(crate) fn render_rest_scaled(
    dl: &mut DisplayList,
    element_id: &str,
    x: f64,
    staff_y: f64,
    staff_sp: f64,
    duration: &Duration,
    staff_position: Option<i32>,
    centered_on_anchor: bool,
    scale: f64,
) {
    let sp = staff_sp * scale;
    let rest_codepoint = smufl::rest_glyph(&duration.base);
    // MNX staffPosition: zero is the middle line, positive is upward.
    let y = if let Some(pos) = staff_position {
        staff_y + (4.0 - pos as f64) * 0.5 * staff_sp
    } else {
        match duration.base {
            NoteValueBase::Whole => staff_y + staff_sp,
            _ => staff_y + 2.0 * staff_sp,
        }
    };
    let glyph_x = rest_glyph_origin_x(x, rest_codepoint, sp, centered_on_anchor);
    dl.push_selectable_command(
        RenderCommand::DrawGlyph {
            x: glyph_x,
            y,
            codepoint: rest_codepoint,
            font: "Bravura".into(),
            size: 4.0 * sp,
            color: "#000000".into(),
            rotation: 0.0,
        },
        element_id.to_string(),
        ElementKind::Rest,
        HitPolicy::Ink,
    );
    // Standard engraving practice: dots occupy the staff space above the
    // rest's reference, even when the glyph itself is reduced.
    if let Some(dots) = duration.dots {
        let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(rest_codepoint);
        let dot_align_x = glyph_x + (bbox_x + bbox_w) * sp;
        let dot_y = y - 0.5 * staff_sp;
        for d in 0..dots {
            dl.push(RenderCommand::DrawGlyph {
                x: dot_align_x + (0.3 + d as f64 * 0.35) * sp,
                y: dot_y,
                codepoint: smufl::AUGMENTATION_DOT,
                font: "Bravura".into(),
                size: 4.0 * sp,
                color: "#000000".into(),
                rotation: 0.0,
            });
        }
    }
}

pub(crate) fn rest_glyph_origin_x(
    event_x: f64,
    codepoint: u32,
    sp: f64,
    centered_on_anchor: bool,
) -> f64 {
    if centered_on_anchor {
        let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(codepoint);
        event_x - (bbox_x + bbox_w * 0.5) * sp
    } else {
        event_x + 0.2 * sp
    }
}

pub(crate) fn rest_ink_center_x(
    event_x: f64,
    duration: &Duration,
    sp: f64,
    centered_on_anchor: bool,
) -> f64 {
    let codepoint = smufl::rest_glyph(&duration.base);
    let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(codepoint);
    rest_glyph_origin_x(event_x, codepoint, sp, centered_on_anchor) + (bbox_x + bbox_w * 0.5) * sp
}
