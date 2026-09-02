// Extracted from render_measure.rs — render_signatures

use super::types::MeasureLayout;
use crate::layout::time_signatures::{render_time_signature_layout, time_signature_layout};
use crate::model::clef::Clef;
use crate::model::time::TimeSignatureSettings;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;

pub(crate) fn render_clef(dl: &mut DisplayList, x: f64, staff_y: f64, sp: f64, clef: &Clef) {
    let (codepoint, y_offset) = clef_glyph_and_offset(clef);

    dl.push(RenderCommand::DrawGlyph {
        x,
        y: staff_y + y_offset * sp,
        codepoint,
        font: "Bravura".into(),
        size: 4.0 * sp,
        color: clef.color.as_deref().unwrap_or("#000000").into(),
        rotation: 0.0,
    });
}

/// Horizontal prefix advance for a full-size clef.
///
/// The advance ends at the clef's actual right ink edge plus the standard
/// inter-signature clearance, rather than at a fixed slot width.
pub(crate) fn clef_prefix_advance_sp(clef: &Clef) -> f64 {
    let (codepoint, _y_offset) = clef_glyph_and_offset(clef);
    let (bbox_x, _bbox_y, bbox_width, _bbox_height) = smufl::glyph_bbox(codepoint);
    (0.5 + bbox_x + bbox_width + 0.8).max(0.0)
}

/// Resolve a clef's SMuFL codepoint and vertical origin offset (in staff
/// spaces, +Y down from the top staff line). Single source of truth for clef
/// placement, shared by [`render_clef`], [`render_change_clef`], and
/// [`clef_bottom_y`].
fn clef_glyph_and_offset(clef: &Clef) -> (u32, f64) {
    let eff_glyph = clef.effective_glyph();
    let glyph = eff_glyph.as_deref().or(clef.glyph.as_deref());
    if let Some(name) = glyph {
        // Custom or ottava SMuFL glyph — use the named glyph and derive y
        // from staffPosition (half-spaces from center line).
        let cp = smufl::smufl_name_to_codepoint(name).unwrap_or(smufl::G_CLEF);
        (cp, 2.0 - clef.staff_position as f64 * 0.5)
    } else {
        match clef.sign {
            ClefSign::G => (smufl::G_CLEF, 3.0), // G clef baseline on line 2 from bottom
            ClefSign::F => (smufl::F_CLEF, 1.0), // F clef baseline on line 4 from bottom
            // C clef: staffPosition is in half-spaces from center line.
            // Alto (0) → y=2.0, Tenor (2) → y=1.0
            ClefSign::C => (smufl::C_CLEF, 2.0 - clef.staff_position as f64 * 0.5),
        }
    }
}

/// Lowest point (largest Y, +Y down) of a clef glyph, in pixels. Combines the
/// glyph's origin offset with its Bravura glyphBBox southern extent, so
/// below-staff annotations (e.g. system bar numbers) can be placed clear of a
/// descending clef such as the treble clef's tail.
pub(crate) fn clef_bottom_y(clef: &Clef, staff_y: f64, sp: f64) -> f64 {
    let (codepoint, y_offset) = clef_glyph_and_offset(clef);
    // glyph_bbox returns (x, y_top, width, height) in staff spaces, where y_top
    // is signed (+Y down) from the origin; the southern edge is y_top + height.
    let (_x, bbox_top, _w, bbox_height) = smufl::glyph_bbox(codepoint);
    staff_y + (y_offset + bbox_top + bbox_height) * sp
}

/// Highest point (smallest Y, +Y down) of a clef glyph, in pixels. Combines the
/// glyph's origin offset with its Bravura glyphBBox northern extent, so the
/// system bounding box can reserve for a clef whose top rises above the top
/// staff line (the treble clef's upper curl reaches ~1sp above line 5).
pub(crate) fn clef_top_y(clef: &Clef, staff_y: f64, sp: f64) -> f64 {
    let (codepoint, y_offset) = clef_glyph_and_offset(clef);
    let (_x, bbox_top, _w, _h) = smufl::glyph_bbox(codepoint);
    staff_y + (y_offset + bbox_top) * sp
}

/// Render a mid-measure clef change at 2/3 of normal size.
/// Uses the same regular clef glyphs as initial clefs, uniformly scaled down.
/// This avoids needing separate SMuFL "change" glyph variants and works for
/// all clef types including ottava, percussion, and tab clefs.
/// Horizontal ink width (in pixels) of the 2/3-size change clef glyph, taken
/// from its Bravura glyphBBox. Used to right-align a mid-system change clef
/// against the preceding barline so wide barlines (double/final) clear the
/// clef instead of overhanging it.
pub(crate) fn change_clef_width(clef: &Clef, sp: f64) -> f64 {
    change_clef_width_sp(clef) * sp
}

/// Horizontal ink width of a 2/3-size change clef in staff spaces.
pub(crate) fn change_clef_width_sp(clef: &Clef) -> f64 {
    let (codepoint, _y_offset) = clef_glyph_and_offset(clef);
    // glyph_bbox width is in staff spaces; the change clef renders at 2/3 size.
    let (_x, _top, bbox_w, _h) = smufl::glyph_bbox(codepoint);
    bbox_w * (2.0 / 3.0)
}

pub(crate) fn render_change_clef(dl: &mut DisplayList, x: f64, staff_y: f64, sp: f64, clef: &Clef) {
    let (codepoint, y_offset) = clef_glyph_and_offset(clef);

    // 2/3 of normal staff size per SMuFL clef change convention
    let change_size = 4.0 * sp * 2.0 / 3.0;
    let (bbox_x, _, _, _) = smufl::glyph_bbox(codepoint);
    let glyph_scale = change_size / 4.0;

    dl.push(RenderCommand::DrawGlyph {
        // `x` denotes the ink column. Normalize each clef's SMuFL side bearing
        // so tenor and bass changes share the same left edge.
        x: x - bbox_x * glyph_scale,
        y: staff_y + y_offset * sp,
        codepoint,
        font: "Bravura".into(),
        size: change_size,
        color: clef.color.as_deref().unwrap_or("#000000").into(),
        rotation: 0.0,
    });
}

/// One accidental glyph of a key signature, in pixel coordinates.
pub(crate) struct KeySignatureGlyph {
    pub x: f64,
    pub y: f64,
    pub codepoint: u32,
}

/// Every glyph a key signature engraves, plus the x cursor it leaves behind.
///
/// Single source of truth for key-signature placement: the renderer draws these
/// glyphs and the geometry pass unions their ink into the selection hitbox, so
/// the clickable region can never drift from the engraved accidentals.
pub(crate) struct KeySignatureLayout {
    pub glyphs: Vec<KeySignatureGlyph>,
    /// X cursor just past the signature's actual ink.
    pub advance: f64,
    /// Font size the glyphs are drawn at.
    pub glyph_size: f64,
}

/// Place a key signature's accidentals (cancellation naturals first, then the
/// new signature's sharps or flats) starting at `x`.
pub(crate) fn key_signature_layout(
    x: f64,
    staff_y: f64,
    sp: f64,
    key: &KeySignature,
    clef_sign: &ClefSign,
    cancel_prev: Option<&KeySignature>,
) -> KeySignatureLayout {
    let count = key.accidental_count();
    let codepoint = if key.is_sharps() {
        smufl::ACCIDENTAL_SHARP
    } else {
        smufl::ACCIDENTAL_FLAT
    };

    // Staff positions for sharps/flats in half-spaces from top line.
    // Values are tuned per clef so key signatures align with the active clef context
    // rather than always using treble placement.
    let (sharp_positions, flat_positions): (&[f64; 7], &[f64; 7]) = match clef_sign {
        ClefSign::F => (
            &[2.0, 5.0, 1.0, 4.0, 7.0, 3.0, 6.0],
            &[6.0, 3.0, 7.0, 4.0, 8.0, 5.0, 2.0],
        ),
        ClefSign::C => (
            &[1.0, 4.0, 0.0, 3.0, 6.0, 2.0, 5.0],
            &[5.0, 2.0, 6.0, 3.0, 7.0, 4.0, 8.0],
        ),
        _ => (
            &[0.0, 3.0, -1.0, 2.0, 5.0, 1.0, 4.0],
            &[4.0, 1.0, 5.0, 2.0, 6.0, 3.0, 7.0],
        ),
    };

    let mut glyphs = Vec::new();
    let mut x_cur = x;

    // Cancellation naturals: a key change shows naturals for the outgoing key's
    // accidentals that the new signature drops. They precede the new key's
    // accidentals (standard engraving practice).
    if let Some(prev) = cancel_prev {
        let cancel_n = prev.cancellation_count(key) as usize;
        if cancel_n > 0 {
            let prev_count = prev.accidental_count() as usize;
            let prev_positions = if prev.is_sharps() {
                &sharp_positions[..]
            } else {
                &flat_positions[..]
            };
            // Cancel the dropped accidentals: the trailing ones when the new key
            // keeps a prefix of the same kind, otherwise the whole old set.
            let start = prev_count.saturating_sub(cancel_n);
            for &pos in &prev_positions[start..prev_count.min(7)] {
                glyphs.push(KeySignatureGlyph {
                    x: x_cur,
                    y: staff_y + pos * sp * 0.5,
                    codepoint: smufl::ACCIDENTAL_NATURAL,
                });
                x_cur += 1.1 * sp;
            }
        }
    }

    let positions = if key.is_sharps() {
        &sharp_positions[..]
    } else {
        &flat_positions[..]
    };

    for i in 0..count.min(7) {
        glyphs.push(KeySignatureGlyph {
            x: x_cur,
            y: staff_y + positions[i as usize] * sp * 0.5,
            codepoint,
        });
        x_cur += 1.1 * sp;
    }

    // Make `x` the actual left ink edge. This keeps the signature's clearance
    // independent of the accidental glyph's side bearing.
    if let Some(ink_left) = glyphs
        .iter()
        .map(|glyph| {
            let (bbox_x, _bbox_y, _bbox_width, _bbox_height) = smufl::glyph_bbox(glyph.codepoint);
            glyph.x + bbox_x * sp
        })
        .min_by(f64::total_cmp)
    {
        let shift = x - ink_left;
        for glyph in &mut glyphs {
            glyph.x += shift;
        }
    }
    let ink_right = glyphs
        .iter()
        .map(|glyph| {
            let (bbox_x, _bbox_y, bbox_width, _bbox_height) = smufl::glyph_bbox(glyph.codepoint);
            glyph.x + (bbox_x + bbox_width) * sp
        })
        .max_by(f64::total_cmp)
        .unwrap_or(x);

    KeySignatureLayout {
        glyphs,
        advance: ink_right,
        glyph_size: 4.0 * sp,
    }
}

/// Whether this measure engraves a key signature in its prefix — on a key
/// change, at the start of the score, and as a continuation restatement at the
/// start of every system.
pub(crate) fn key_signature_is_rendered(ml: &MeasureLayout) -> bool {
    let rm = &ml.resolved;
    let is_key_change = rm.global.key.is_some();
    let cancel_count = if is_key_change {
        rm.prev_key.cancellation_count(&rm.active_key)
    } else {
        0
    };
    (is_key_change || rm.index == 0 || ml.is_first_on_system)
        && (rm.active_key.accidental_count() != 0 || cancel_count > 0)
}

/// X where this measure's key signature starts — the prefix cursor after the
/// start barline and any restated clef. Mirrors `render_measure_prefix` (and
/// `render_multimeasure_rest`, which draws its barline without advancing the
/// cursor) so the geometry pass places the hitbox on the engraved glyphs.
pub(crate) fn key_signature_prefix_x(ml: &MeasureLayout, sp: f64, leading_clef_gap: f64) -> f64 {
    let rm = &ml.resolved;
    let at_start = rm.index == 0 || ml.is_first_on_system;
    let is_mmr = ml.multimeasure_rest_count.is_some();
    let mut x = ml.x;

    if !at_start && !is_mmr {
        // The cursor clears the mid-system change clef's leading gap and the
        // start barline. A repeat-start reserves a wider slot than a plain bar.
        x += leading_clef_gap;
        x += if rm.global.repeat_start.is_some() {
            1.5 * sp
        } else {
            0.5 * sp
        };
    }

    if at_start {
        if let Some(clef) = prefix_clef(ml, is_mmr) {
            x += clef_prefix_advance_sp(clef) * sp;
        }
    }
    x
}

/// Resolve the full-size clef that precedes the key signature in the prefix.
fn prefix_clef(ml: &MeasureLayout, is_mmr: bool) -> Option<&Clef> {
    let clefs = ml.resolved.part.clefs.as_ref()?;
    if is_mmr {
        return clefs.first().map(|pc| &pc.clef);
    }
    clefs
        .iter()
        .find(|c| match &c.position {
            None => true,
            Some(p) => p.fraction.0 == 0,
        })
        .map(|pc| &pc.clef)
}

pub(crate) fn render_key_signature(
    dl: &mut DisplayList,
    x: f64,
    staff_y: f64,
    sp: f64,
    key: &KeySignature,
    clef_sign: &ClefSign,
    cancel_prev: Option<&KeySignature>,
) -> f64 {
    let color: &str = key.color.as_deref().unwrap_or("#000000");
    let layout = key_signature_layout(x, staff_y, sp, key, clef_sign, cancel_prev);

    for glyph in &layout.glyphs {
        dl.push(RenderCommand::DrawGlyph {
            x: glyph.x,
            y: glyph.y,
            codepoint: glyph.codepoint,
            font: "Bravura".into(),
            size: layout.glyph_size,
            color: color.into(),
            rotation: 0.0,
        });
    }

    layout.advance - x
}

/// Engrave a measure's time signature in the document's style, with the
/// meter's left ink edge at `x`.
///
/// Styles that engrave outside the staff draw nothing in the staff:
/// `aboveStaff` places its glyphs over the top staff line from the same `x`,
/// and `spanning` is drawn once per bracket group by the system pass.
pub(crate) fn render_time_signature(
    dl: &mut DisplayList,
    x: f64,
    staff_y: f64,
    sp: f64,
    ts: &TimeSignature,
    settings: TimeSignatureSettings,
) {
    let layout = time_signature_layout(settings, ts, x, staff_y, staff_y + 4.0 * sp, sp);
    render_time_signature_layout(dl, &layout);
}
