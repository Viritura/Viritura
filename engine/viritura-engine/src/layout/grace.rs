//! Grace note rendering — reduced-size notes with slurs.

use super::config::LayoutConfig;
use super::render_events::{render_note_chord, NoteChordInput, NoteChordStyle};
use super::types::*;
use crate::model::{KeySignature, KitComponent};
use crate::render::*;
use std::collections::{HashMap, HashSet};

pub(crate) const GRACE_SCALE: f64 = 0.65;

mod spacing;
pub(crate) use spacing::{position_grace_notes, GraceSpacingContext};

// ═══════════════════════════════════════════
// Grace note rendering
// ═══════════════════════════════════════════

/// Score-owned accidental decisions and percussion shapes, also used by previews.
pub(crate) struct GraceRenderContext<'a> {
    pub active_key: &'a KeySignature,
    pub measure_acc: &'a mut HashMap<(String, i32), i32>,
    pub use_accidental_display: bool,
    pub kit: Option<&'a HashMap<String, KitComponent>>,
    pub tie_accidentals: Option<&'a HashMap<String, bool>>,
}

/// Render reduced-size ink on the full staff grid. Group beams own their stems.
#[allow(clippy::too_many_arguments)] // grace geometry and score-resolved accidental context are independent inputs
pub(crate) fn render_grace_event(
    dl: &mut DisplayList,
    gn: &GraceNoteLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    beamed_ids: &HashSet<String>,
    context: &mut GraceRenderContext<'_>,
    element_id: &str,
) {
    if gn.event.is_rest() || gn.event.notes().is_empty() {
        return;
    }
    let start = dl.commands.len();
    render_note_chord(
        dl,
        NoteChordInput {
            event: &gn.event,
            x: gn.x,
            stem_up: gn.stem_up,
            note_positions: &gn.note_positions,
            note_x_offsets: &[],
            shared_noteheads: &[],
            display_pitches: &gn.display_pitches,
            id: gn.id.as_deref(),
        },
        staff_y,
        sp,
        config,
        NoteChordStyle {
            scale: GRACE_SCALE,
            slash: gn.is_slash,
        },
        beamed_ids,
        context.active_key,
        context.measure_acc,
        context.use_accidental_display,
        element_id,
        config.ledger_extension,
        config.ledger_extension,
        context.kit,
        context.tie_accidentals,
        &[],
        &[],
    );
    if let Some(color) = &gn.color {
        for command in &mut dl.commands[start..] {
            match command {
                RenderCommand::DrawGlyph { color: ink, .. } => *ink = color.clone(),
                RenderCommand::DrawLine {
                    x1,
                    x2,
                    y1,
                    y2,
                    color: ink,
                    ..
                } if x1 != x2 && y1 != y2 => *ink = color.clone(),
                _ => {}
            }
        }
    }
}

pub(super) fn render_grace_slash(
    dl: &mut DisplayList,
    stem_x: f64,
    slash_center_y: f64,
    sp: f64,
    scale: f64,
    stem_width: f64,
    color: &str,
) {
    let slash_ext = 0.6 * sp * scale;
    dl.push(RenderCommand::DrawLine {
        x1: stem_x - slash_ext * 0.8,
        y1: slash_center_y + slash_ext,
        x2: stem_x + slash_ext * 0.8,
        y2: slash_center_y - slash_ext,
        width: stem_width * sp * 1.5,
        color: color.into(),
    });
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
