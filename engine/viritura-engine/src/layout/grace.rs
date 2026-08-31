//! Grace note rendering — reduced-size notes with slurs.

use super::config::LayoutConfig;
use super::types::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashSet;

// ═══════════════════════════════════════════
// Grace note rendering
// ═══════════════════════════════════════════

/// Render a single grace note at reduced size (0.65× spatium).
pub(crate) fn render_grace_event(
    dl: &mut DisplayList,
    gn: &GraceNoteLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    beamed_ids: &HashSet<String>,
) {
    let scale = 0.65;
    let event = &gn.event;
    let x = gn.x;
    let color: &str = gn.color.as_deref().unwrap_or("#000000");

    if event.is_rest() {
        return;
    }
    let notes = event.notes();
    if notes.is_empty() {
        return;
    }

    let notehead_w = config.notehead_rx * 2.0 * scale * sp;
    let notehead_codepoint = smufl::notehead_glyph(&event.duration.base);
    let glyph_size = 4.0 * sp * scale;

    // Noteheads + ledger lines
    for &pos in &gn.note_positions {
        let note_y = staff_y + pos * sp * 0.5;

        // Ledger lines above staff (at reduced width)
        if pos < 0.0 {
            let mut ledger = -2.0;
            while ledger >= pos {
                let ly = staff_y + ledger * sp * 0.5;
                dl.ledger_line(
                    x - config.ledger_extension * sp * scale,
                    ly,
                    notehead_w + 2.0 * config.ledger_extension * sp * scale,
                    config.ledger_line_width * sp,
                );
                ledger -= 2.0;
            }
        }

        // Ledger lines below staff
        if pos > 8.0 {
            let mut ledger = 10.0;
            while ledger <= pos {
                let ly = staff_y + ledger * sp * 0.5;
                dl.ledger_line(
                    x - config.ledger_extension * sp * scale,
                    ly,
                    notehead_w + 2.0 * config.ledger_extension * sp * scale,
                    config.ledger_line_width * sp,
                );
                ledger += 2.0;
            }
        }

        // Notehead glyph
        dl.push(RenderCommand::DrawGlyph {
            x,
            y: note_y,
            codepoint: notehead_codepoint,
            font: "Bravura".into(),
            size: glyph_size,
            color: color.into(),
            rotation: 0.0,
        });
    }

    // Stem + flag (beamed grace notes: stems drawn by render_grace_beams)
    if event.duration.base.has_stem() && !gn.note_positions.is_empty() {
        let top_pos = gn
            .note_positions
            .iter()
            .cloned()
            .fold(f64::INFINITY, f64::min);
        let bottom_pos = gn
            .note_positions
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);
        let stem_len = config.stem_length * sp * scale;

        let is_beamed = gn.id.as_ref().is_some_and(|id| beamed_ids.contains(id));

        // Beamed grace notes: stems are drawn by render_grace_beams with
        // correct beam-connected length. Only draw stems here for non-beamed.
        if !is_beamed {
            if gn.stem_up {
                // SMuFL stemUpSE anchor (scaled for grace notes)
                let stem_x = x + smufl::STEM_UP_SE.0 * sp * scale - config.stem_width * sp * 0.5;
                let stem_bottom =
                    staff_y + bottom_pos * sp * 0.5 + smufl::STEM_UP_SE.1 * sp * scale;
                let flag_y = staff_y + top_pos * sp * 0.5 - stem_len;
                // Extend stem through flag glyph (Bravura stemUpNW anchor)
                let ext =
                    smufl::flag_stem_extension(event.duration.base.flag_count(), true) * sp * scale;
                let stem_top = flag_y - ext;
                dl.stem(stem_x, stem_top, stem_bottom, config.stem_width * sp);

                let flag_count = event.duration.base.flag_count();
                if flag_count > 0 {
                    if let Some(flag_cp) = smufl::flag_glyph(flag_count, true) {
                        dl.push(RenderCommand::DrawGlyph {
                            x: stem_x,
                            y: flag_y,
                            codepoint: flag_cp,
                            font: "Bravura".into(),
                            size: glyph_size,
                            color: color.into(),
                            rotation: 0.0,
                        });
                    }
                    if gn.is_slash {
                        let slash_center_y = stem_top + stem_len * 0.35;
                        let slash_ext = 0.6 * sp * scale;
                        dl.push(RenderCommand::DrawLine {
                            x1: stem_x - slash_ext * 0.8,
                            y1: slash_center_y + slash_ext,
                            x2: stem_x + slash_ext * 0.8,
                            y2: slash_center_y - slash_ext,
                            width: config.stem_width * sp * 1.5,
                            color: color.into(),
                        });
                    }
                }
            } else {
                // SMuFL stemDownNW anchor (scaled for grace notes)
                let stem_x = x + smufl::STEM_DOWN_NW.0 * sp * scale + config.stem_width * sp * 0.5;
                let stem_top = staff_y + top_pos * sp * 0.5;
                let flag_y = staff_y + bottom_pos * sp * 0.5 + stem_len;
                // Extend stem through flag glyph (Bravura stemDownSW anchor)
                let ext = smufl::flag_stem_extension(event.duration.base.flag_count(), false)
                    * sp
                    * scale;
                let stem_bottom = flag_y + ext;
                dl.stem(stem_x, stem_top, stem_bottom, config.stem_width * sp);

                let flag_count = event.duration.base.flag_count();
                if flag_count > 0 {
                    if let Some(flag_cp) = smufl::flag_glyph(flag_count, false) {
                        dl.push(RenderCommand::DrawGlyph {
                            x: stem_x,
                            y: flag_y,
                            codepoint: flag_cp,
                            font: "Bravura".into(),
                            size: glyph_size,
                            color: color.into(),
                            rotation: 0.0,
                        });
                    }
                    if gn.is_slash {
                        let slash_center_y = stem_bottom - stem_len * 0.35;
                        let slash_ext = 0.6 * sp * scale;
                        dl.push(RenderCommand::DrawLine {
                            x1: stem_x - slash_ext * 0.8,
                            y1: slash_center_y + slash_ext,
                            x2: stem_x + slash_ext * 0.8,
                            y2: slash_center_y - slash_ext,
                            width: config.stem_width * sp * 1.5,
                            color: color.into(),
                        });
                    }
                }
            }
        }
    }
}

/// Render a slur from the first grace note to the main event.
/// Reserved for future grace note slur rendering.
#[allow(dead_code)]
pub(crate) fn render_grace_slur(
    dl: &mut DisplayList,
    grace: &GraceNoteLayout,
    main_event: &EventLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    use std::f64::consts::PI;

    let grace_scale = 0.65;
    let grace_nw = config.notehead_rx * 2.0 * grace_scale * sp;
    let color: &str = grace.color.as_deref().unwrap_or("#000000");

    // Source Y: use the note closest to the main note (last grace note's topmost)
    let grace_pos = grace
        .note_positions
        .iter()
        .cloned()
        .min_by(|a, b| a.total_cmp(b))
        .unwrap_or(4.0);
    let grace_y = staff_y + grace_pos * sp * 0.5;

    // Target Y: topmost note of the main event
    let main_pos = main_event
        .note_positions
        .iter()
        .cloned()
        .min_by(|a, b| a.total_cmp(b))
        .unwrap_or(4.0);
    let main_y = staff_y + main_pos * sp * 0.5;

    // Curve direction: opposite of grace note stem direction
    let curve_dir: f64 = if grace.stem_up { 1.0 } else { -1.0 };

    // ── Endpoints: center-top/bottom of notehead ──────────────────
    let x1 = grace.x + grace_nw * 0.5;
    let x2 = main_event.x + config.notehead_rx * 2.0 * sp * 0.5;

    let y_offset = curve_dir * 0.4 * sp;
    let y1 = grace_y + y_offset;
    let y2 = main_y + y_offset;

    // ── Chord vector and perpendicular ────────────────────────────
    let dx = x2 - x1;
    let dy = y2 - y1;
    let chord_len = (dx * dx + dy * dy).sqrt().max(0.01);
    let ux = dx / chord_len;
    let uy = dy / chord_len;
    let px = -uy * curve_dir;
    let py = ux * curve_dir;

    // ── Curve height: the asymptotic formula (scaled for grace) ──
    let h_inf: f64 = 1.5; // smaller asymptote for grace slurs
    let r0: f64 = 0.35;
    let w = chord_len / sp;
    let x_param = w * r0 / h_inf;
    let h_ss = h_inf * (2.0 / PI) * (PI * x_param / 2.0).atan();
    let curve_height = h_ss * sp;

    // ── Shoulder and control points (steep departure) ─────────────
    let indent = 0.15;
    let cp1_x = x1 + ux * chord_len * indent + px * curve_height;
    let cp1_y = y1 + uy * chord_len * indent + py * curve_height;
    let cp2_x = x1 + ux * chord_len * (1.0 - indent) + px * curve_height;
    let cp2_y = y1 + uy * chord_len * (1.0 - indent) + py * curve_height;

    // ── Thickness ─────────────────────────────────────────────────
    let base_thick = 0.25 * sp;
    let mid_thick = if chord_len < 3.0 * sp {
        (base_thick * chord_len / (3.0 * sp)).max(0.10 * sp)
    } else {
        base_thick
    };
    let half_t = mid_thick * 0.5;

    let ocx1 = cp1_x + px * half_t;
    let ocy1 = cp1_y + py * half_t;
    let ocx2 = cp2_x + px * half_t;
    let ocy2 = cp2_y + py * half_t;

    let icx1 = cp1_x - px * half_t;
    let icy1 = cp1_y - py * half_t;
    let icx2 = cp2_x - px * half_t;
    let icy2 = cp2_y - py * half_t;

    let tip_t = mid_thick * 0.45;
    let ix1 = x1 - px * tip_t;
    let iy1 = y1 - py * tip_t;
    let ix2 = x2 - px * tip_t;
    let iy2 = y2 - py * tip_t;

    dl.push(RenderCommand::DrawFilledBezier {
        x1,
        y1,
        x2,
        y2,
        ocx1,
        ocy1,
        ocx2,
        ocy2,
        icx1,
        icy1,
        icx2,
        icy2,
        ix1,
        iy1,
        ix2,
        iy2,
        color: color.into(),
        line_style: 0,
    });
}
