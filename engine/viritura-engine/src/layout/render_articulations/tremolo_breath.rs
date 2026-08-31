#![allow(unused_imports)]

use super::super::arena::EventArena;
use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_events::{ArticCategory, ArticGlyph};
use super::super::render_geometry::*;
use super::super::resolve::*;
use super::super::slurs::{SlurParticipationMap, SlurRole, SlurSide};
use super::super::spacing::*;
use super::super::types::*;
use super::arpeggios::*;
use super::articulations::*;
use super::fermatas_trills_ornaments::*;
use super::fingerings::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Render single-note tremolo marks on the stem using SMuFL glyphs.
///
/// Draws the appropriate combining tremolo glyph (tremolo1/2/3) centered
/// on the stem between the notehead and the stem tip.
pub(crate) fn render_tremolo(
    dl: &mut DisplayList,
    events: &EventArena,
    ei: usize,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    element_id: &str,
) {
    let event = events.event(ei);
    let x = events.x(ei);
    let stem_up = events.stem_up(ei);
    let note_positions = events.note_positions(ei);
    let marks = match &event.markings {
        Some(m) => match &m.tremolo {
            Some(t) => t.marks,
            None => return,
        },
        None => return,
    };
    if marks == 0 || note_positions.is_empty() {
        return;
    }

    let codepoint = match smufl::tremolo_glyph(marks) {
        Some(cp) => cp,
        None => return,
    };

    let notehead_w = config.notehead_rx * 2.0 * sp;
    let top_pos = note_positions.iter().cloned().fold(f64::INFINITY, f64::min);
    let bottom_pos = note_positions
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);

    let has_stem = event.duration.base.has_stem();

    let (trem_x, mid_y) = if !has_stem {
        // Stemless notes (whole notes, breves): center tremolo on the notehead.
        // Use the actual glyph width for centering since whole/breve noteheads
        // are wider than filled noteheads.
        let nh_glyph = smufl::notehead_glyph(&event.duration.base);
        let (_, _, nh_glyph_w, _) = smufl::glyph_bbox(nh_glyph);
        let actual_nh_w = nh_glyph_w * sp;
        let note_center_x = x + actual_nh_w * 0.5;
        let note_top_y = staff_y + top_pos * sp * 0.5;
        let note_bottom_y = staff_y + bottom_pos * sp * 0.5;
        // Use the tremolo glyph's actual extent to ensure clearance from the notehead.
        // Tremolo glyphs are vertically centered on their origin (y=0),
        // so the nearest edge is at |bbox_y| (which equals bbox_h/2).
        let (_, trem_bbox_y, _, trem_bbox_h) = smufl::glyph_bbox(codepoint);
        let trem_near_extent = (trem_bbox_y.abs()).min((trem_bbox_y + trem_bbox_h).abs()) * sp;
        let clearance = 0.5 * sp; // gap between notehead and tremolo
        let nh_half_h = 0.5 * sp; // notehead extends 0.5sp from note center
        let trem_y = if stem_up {
            note_top_y - nh_half_h - clearance - trem_near_extent
        } else {
            note_bottom_y + nh_half_h + clearance + trem_near_extent
        };
        (note_center_x, trem_y)
    } else if stem_up {
        // Stem-up: center on the free stem region (stem tip to top notehead edge).
        // The free stem is the portion above the top note in the chord (or the
        // only note for single-note events). Using top_pos (not bottom_pos)
        // prevents the tremolo from landing inside a chord cluster.
        let stem_x = x + notehead_w;
        let stem_top = staff_y + top_pos * sp * 0.5 - config.stem_length * sp;
        let nh_h = config.notehead_ry * sp;
        let note_edge = staff_y + top_pos * sp * 0.5 - nh_h;
        let (_, _trem_bbox_y, _, trem_bbox_h) = smufl::glyph_bbox(codepoint);
        let trem_half_h = trem_bbox_h.abs() * sp * 0.5;
        let min_clearance = 0.3 * sp;
        let mid = (stem_top + note_edge) * 0.5;
        // Ensure the bottom edge of the tremolo glyph doesn't overlap the top notehead
        let max_y = note_edge - trem_half_h - min_clearance;
        let clamped = mid.min(max_y);
        (stem_x, clamped)
    } else {
        // Stem-down: center on the free stem region (stem tip to bottom notehead edge).
        // The free stem is the portion below the bottom note in the chord.
        // Using bottom_pos (not top_pos) prevents the tremolo from landing
        // inside a chord cluster.
        let stem_x = x;
        let stem_bottom = staff_y + bottom_pos * sp * 0.5 + config.stem_length * sp;
        let nh_h = config.notehead_ry * sp;
        let note_edge = staff_y + bottom_pos * sp * 0.5 + nh_h;
        let (_, _trem_bbox_y, _, trem_bbox_h) = smufl::glyph_bbox(codepoint);
        let trem_half_h = trem_bbox_h.abs() * sp * 0.5;
        let min_clearance = 0.3 * sp;
        let mid = (stem_bottom + note_edge) * 0.5;
        // Ensure the top edge of the tremolo glyph doesn't overlap the bottom notehead
        let min_y = note_edge + trem_half_h + min_clearance;
        let clamped = mid.max(min_y);
        (stem_x, clamped)
    };

    let glyph_size = 4.0 * sp;

    dl.push_tagged(
        RenderCommand::DrawGlyph {
            x: trem_x,
            y: mid_y,
            codepoint,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        },
        element_id::tremolo(element_id),
    );
}

/// Render breath marks above the staff for events that have them.
///
/// Breath marks are placed above the staff at the event's X position,
/// offset to the right of the notehead. They are not part of the
/// articulation stacking system — they sit independently above the staff.
pub(crate) fn render_breath_marks(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let glyph_size = 4.0 * sp;
    let right_padding = 0.25 * sp;

    for vl in &ml.voice_layouts {
        for i in 0..vl.events.len() {
            let breath = match &vl.events.event(i).markings {
                Some(m) => match &m.breath {
                    Some(b) => b,
                    None => continue,
                },
                None => continue,
            };

            let codepoint = smufl::breath_mark_glyph(&breath.symbol);
            let (_, _, glyph_w, _) = smufl::glyph_bbox(codepoint);
            let next_x = next_event_x(ml, vl.events.beat_position(i)).unwrap_or(ml.x + ml.width);

            // Position: just before the subsequent note, or before the barline.
            let bx = next_x - right_padding - glyph_w * sp;
            let by = staff_y - config.breath_mark_above_staff * sp;

            dl.push(RenderCommand::DrawGlyph {
                x: bx,
                y: by,
                codepoint,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
        }
    }
}

/// Render caesura marks above the staff for events that have them.
///
/// Caesuras are event-level markings (like breath marks) that indicate
/// a complete break in the music. They are placed above the top staff line,
/// between the current event and the next one (or before the barline).
pub(crate) fn render_caesuras(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    _config: &LayoutConfig,
) {
    let glyph_size = 4.0 * sp;
    let right_padding = 0.25 * sp;

    for vl in &ml.voice_layouts {
        for i in 0..vl.events.len() {
            let caesura = match &vl.events.event(i).markings {
                Some(m) => match &m.caesura {
                    Some(c) => c,
                    None => continue,
                },
                None => continue,
            };

            let codepoint = smufl::caesura_glyph(&caesura.style);
            let (_, glyph_yoff, glyph_w, glyph_h) = smufl::glyph_bbox(codepoint);
            let next = next_event_after(ml, vl.events.beat_position(i));
            let next_x = next.as_ref().map(|ev| ev.x).unwrap_or(ml.x + ml.width);

            // The caesura sits in the gap before the next event. That next event
            // may carry an accidental column drawn to the LEFT of its notehead;
            // the spacing engine already reserves room for both, so the caesura
            // must be placed left of that accidental column rather than against
            // the notehead onset, or it collides with the accidental.
            let next_acc_extent = next
                .as_ref()
                .and_then(|ev| ev.event.notes.as_ref())
                .map(|notes| {
                    event_accidental_extent_sp(
                        notes,
                        &ml.resolved.active_key,
                        &mut HashMap::new(),
                        None,
                        0.0,
                        None,
                    ) * sp
                })
                .unwrap_or(0.0);
            // Gap between the accidental column's left edge and the notehead
            // onset (matches the renderer's accidental-to-notehead gap).
            let acc_offset = if next_acc_extent > 0.0 {
                next_acc_extent + 0.12 * sp
            } else {
                0.0
            };

            // Position: just left of the next event's accidental column (or the
            // notehead/barline when there is none).
            let cx = next_x - acc_offset - right_padding - glyph_w * sp;

            // Vertically align the glyph so its strokes sit from the second staff line
            // down up to the first ledger line above (midpoint on the top staff line).
            let target_center_y = staff_y;
            let cy = target_center_y - (glyph_yoff + glyph_h * 0.5) * sp;

            dl.push(RenderCommand::DrawGlyph {
                x: cx,
                y: cy,
                codepoint,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            });
        }
    }
}
