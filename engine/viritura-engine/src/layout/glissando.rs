//! Glissando rendering — diagonal lines (straight or wavy) between notes.
//!
//! A glissando connects two events at different pitches with a line
//! from the right edge of the source notehead to the left edge of the
//! target notehead. Straight glissandos use a simple diagonal line; wavy
//! glissandos tile the SMuFL `wiggleGlissando` segment along that diagonal.

use super::config::LayoutConfig;
use super::element_id;
use super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashMap;

/// Cached position info for a glissando endpoint.
struct GlissEndpoint {
    x: f64,
    /// Representative note Y in half-spaces from top staff line
    y_pos: f64,
    /// Staff top Y the note is drawn against. Differs from the system's staff
    /// Y for a cross-staff event, whose notehead sits on another staff of the
    /// same part (harp/keyboard writing), so the line must follow it there.
    staff_y: f64,
    notehead_w: f64,
}

/// One staff's laid-out measures paired with the Y of its top staff line.
pub(crate) type GlissandoStaff<'a> = (&'a [MeasureLayout], f64);

/// Render glissando lines across every staff of a system.
///
/// The pass is system-wide rather than per-staff because a glissando may join
/// two staves of one part — a harp or keyboard gliss climbing from the bass
/// staff to a note written on the treble staff.
pub(crate) fn render_glissandos(
    dl: &mut DisplayList,
    staves: &[GlissandoStaff<'_>],
    sp: f64,
    config: &LayoutConfig,
    staff_y_offsets: Option<&[f64]>,
) {
    let notehead_w = config.notehead_rx * 2.0 * sp;

    // Build event-ID → position map
    let mut event_map: HashMap<String, GlissEndpoint> = HashMap::new();

    for &(measure_layouts, staff_y) in staves {
        for ml in measure_layouts {
            for vl in &ml.voice_layouts {
                for i in 0..vl.events.len() {
                    if let Some(id) = vl.events.id(i) {
                        // Use topmost note position as representative
                        let y_pos = vl
                            .events
                            .note_positions(i)
                            .iter()
                            .cloned()
                            .min_by(|a, b| a.total_cmp(b))
                            .unwrap_or(4.0);
                        let event_staff_y = super::render_measure::cross_staff_y_scalar(
                            vl.events.event(i).staff,
                            vl.events.sequence_staff(i),
                            staff_y,
                            staff_y_offsets,
                        );
                        event_map.insert(
                            id.to_string(),
                            GlissEndpoint {
                                x: vl.events.x(i),
                                y_pos,
                                staff_y: event_staff_y,
                                notehead_w,
                            },
                        );
                    }
                }
            }
        }
    }

    // Emit glissando lines
    for &(measure_layouts, _) in staves {
        for ml in measure_layouts {
            for vl in &ml.voice_layouts {
                for i in 0..vl.events.len() {
                    if let Some(ref glissandos) = vl.events.event(i).glissandos {
                        let src_id = vl.events.id(i).unwrap_or("");
                        if let Some(src) = event_map.get(src_id) {
                            for gliss in glissandos {
                                if let Some(tgt) = event_map.get(&gliss.target) {
                                    let eid = element_id::glissando(src_id, &gliss.target);
                                    let cmd_idx = dl.commands.len();
                                    emit_glissando(dl, src, tgt, gliss, sp, config);
                                    let cmd_end = dl.commands.len();
                                    for ci in cmd_idx..cmd_end {
                                        dl.tag_command(ci, eid.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Emit a single glissando line between source and target events.
fn emit_glissando(
    dl: &mut DisplayList,
    src: &GlissEndpoint,
    tgt: &GlissEndpoint,
    gliss: &Glissando,
    sp: f64,
    config: &LayoutConfig,
) {
    // Small horizontal padding from notehead edge
    let pad = 0.3 * sp;
    let x1 = src.x + src.notehead_w + pad;
    let x2 = tgt.x - pad;

    let y1 = src.staff_y + src.y_pos * sp * 0.5;
    let y2 = tgt.staff_y + tgt.y_pos * sp * 0.5;

    let line_width = config.glissando_line_width * sp;

    match gliss.style {
        GlissandoStyle::Straight => {
            dl.push(RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width: line_width,
                color: "#000000".to_string(),
            });
        }
        GlissandoStyle::Wavy => {
            emit_wiggle_line(dl, x1, y1, x2, y2, sp);
        }
    }

    // Render optional text label (e.g. "gliss.") along the line
    if let Some(ref text) = gliss.text {
        let mid_x = (x1 + x2) * 0.5;
        let mid_y = (y1 + y2) * 0.5 - 0.6 * sp;
        dl.push(RenderCommand::DrawText {
            x: mid_x,
            y: mid_y,
            text: text.clone(),
            font: "serif italic".to_string(),
            size: 0.8 * sp * 4.0,
            color: "#000000".to_string(),
            align: TextAlign::Center,
            baseline: TextBaseline::Bottom,
        });
    }
}

/// Emit a wavy glissando from (x1,y1) to (x2,y2) by tiling the SMuFL
/// `wiggleGlissando` (U+EAAF) segment.
///
/// Per SMuFL, multi-segment lines are assembled by repeating the segment glyph
/// at its `repeatOffset` — consecutive origins one advance width apart join
/// seamlessly, so the spacing is fixed and the segment count is rounded to the
/// nearest whole wave. The leftover (under half a segment) is split evenly at
/// both ends so the wave stays centered between the two noteheads.
///
/// The glyph is horizontal, so it is rotated by the line's angle. Its ink sits
/// entirely above the baseline, so the origin drops by half the ink height to
/// center the wave on the line joining the two notes.
fn emit_wiggle_line(dl: &mut DisplayList, x1: f64, y1: f64, x2: f64, y2: f64, sp: f64) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let length = dx.hypot(dy);
    if length < 0.01 {
        return;
    }

    let angle = dy.atan2(dx);
    let (sin, cos) = angle.sin_cos();
    let font_size = 4.0 * sp;
    let advance = smufl::WIGGLE_GLISSANDO_SEGMENT_WIDTH * sp;
    let count = ((length / advance).round() as usize).max(1);
    let lead = (length - count as f64 * advance) * 0.5;

    // Drop the origin perpendicular to the line by half the ink height, in the
    // glyph's own (rotated) frame.
    let half_ink = smufl::WIGGLE_GLISSANDO_HEIGHT * 0.5 * sp;
    let off_x = -half_ink * sin;
    let off_y = half_ink * cos;

    for i in 0..count {
        let along = lead + i as f64 * advance;
        dl.glyph_rotated(
            x1 + cos * along + off_x,
            y1 + sin * along + off_y,
            smufl::WIGGLE_GLISSANDO,
            "Bravura",
            font_size,
            "#000000",
            angle,
        );
    }
}
