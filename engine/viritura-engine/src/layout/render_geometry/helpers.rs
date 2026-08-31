#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_annotations::highest_point_in_range;
use super::super::render_barlines::render_barline;
use super::super::render_measure::MIDDLE_LINE_POS;
use super::super::render_signatures::{
    key_signature_is_rendered, key_signature_layout, key_signature_prefix_x, KeySignatureLayout,
};
use super::super::resolve::*;
use super::super::spacing::*;
use super::super::types::*;
use super::bbox_annotations::*;
use super::bbox_articulations::*;
use super::bbox_notes::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Compute the stem tip Y, ensuring stems on ledger-line notes extend at least
/// to the middle staff line (standard engraving rule).
pub(super) fn stem_tip_y(
    note_edge_pos: f64,
    stem_up: bool,
    staff_y: f64,
    sp: f64,
    stem_length: f64,
) -> f64 {
    let middle_y = staff_y + MIDDLE_LINE_POS * sp * 0.5;
    if stem_up {
        let tip = staff_y + note_edge_pos * sp * 0.5 - stem_length * sp;
        tip.min(middle_y)
    } else {
        let tip = staff_y + note_edge_pos * sp * 0.5 + stem_length * sp;
        tip.max(middle_y)
    }
}

/// Effective stem length (in staff spaces) for an UNBEAMED note, matching the
/// renderer (`render_events.rs`): a flagged stem is lengthened so the flag's
/// inward curl clears the notehead body, otherwise the default is used. Beamed
/// notes draw their stems via the beam pass, so callers must gate on
/// `!is_beamed` before using this.
pub(super) fn unbeamed_stem_length(flag_count: u32, stem_up: bool, config: &LayoutConfig) -> f64 {
    if flag_count > 0 {
        config
            .stem_length
            .max(smufl::flag_inward_extent(flag_count, stem_up) + config.notehead_ry + 0.25)
    } else {
        config.stem_length
    }
}

/// Outermost rendered stem/flag tip Y for an UNBEAMED note — the true ink
/// extreme the selection box and collision scans should see. Mirrors
/// `render_events.rs`: the stem uses the flag-lengthened length and then
/// extends *through* the flag glyph by `flag_stem_extension`, so for a flagged
/// up-stem the tip rises further (smaller y) than the bare `stem_tip_y` and for
/// a flagged down-stem it drops further (larger y). The default 3.5sp stem
/// (used by the prior bbox) stopped short of both, clipping the flag out of the
/// box.
pub(super) fn unbeamed_stem_flag_tip_y(
    note_edge_pos: f64,
    stem_up: bool,
    flag_count: u32,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let stem_length = unbeamed_stem_length(flag_count, stem_up, config);
    let tip = stem_tip_y(note_edge_pos, stem_up, staff_y, sp, stem_length);
    if flag_count > 0 {
        let ext = smufl::flag_stem_extension(flag_count, stem_up) * sp;
        if stem_up {
            tip - ext
        } else {
            tip + ext
        }
    } else {
        tip
    }
}

/// Ledger-line margin (in staff spaces) added above and below the staff body
/// when deciding whether an emitted glyph/shape belongs to *this* staff rather
/// than a vertically adjacent one. 10sp comfortably covers ledger-line notes
/// and above/below-staff markings while still excluding the neighbouring staff.
pub(crate) const STAFF_NEIGHBOR_MARGIN: f64 = 10.0;

/// Vertical band `[lo, hi]` around a single 5-line staff (top line at
/// `staff_y`, body 4sp tall) within which a display-list glyph or shape is
/// treated as belonging to *this* staff. The band is the staff body expanded by
/// [`STAFF_NEIGHBOR_MARGIN`] on each side. Collision scans (slur obstacles,
/// fermata/articulation stacking) use it so a neighbouring staff's markings at
/// the same x are never picked up. Replaces the repeated `staff_y - 10sp` /
/// `staff_y + 14sp` literals that each call site previously chose independently.
pub(crate) fn staff_obstacle_band(staff_y: f64, sp: f64) -> (f64, f64) {
    let staff_body = 4.0 * sp;
    let margin = STAFF_NEIGHBOR_MARGIN * sp;
    (staff_y - margin, staff_y + staff_body + margin)
}

/// Compute the stem tip position for an event (used for multi-note tremolo layout).
/// For stemless notes (whole notes), returns a position where an implied stem would end.
pub(crate) fn stem_tip_pos(
    el: &EventLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> (f64, f64) {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let top_pos = el
        .note_positions
        .iter()
        .cloned()
        .fold(f64::INFINITY, f64::min);
    let bottom_pos = el
        .note_positions
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);

    if el.event.duration.base.has_stem() {
        if el.stem_up {
            let stem_x = el.x + notehead_w;
            let stem_top = stem_tip_y(top_pos, true, staff_y, sp, config.stem_length);
            (stem_x, stem_top)
        } else {
            let stem_x = el.x;
            let stem_bottom = stem_tip_y(bottom_pos, false, staff_y, sp, config.stem_length);
            (stem_x, stem_bottom)
        }
    } else {
        // Stemless (whole note): compute implied stem position
        // Place implied stem on the right side, extending up
        let stem_x = el.x + notehead_w;
        let implied_stem_top = staff_y + top_pos * sp * 0.5 - config.stem_length * sp * 0.7;
        (stem_x, implied_stem_top)
    }
}

/// Snap a staff position to the nearest space (odd integer position).
/// When `going_down` is true, rounds up to the next odd position;
/// when false, rounds down to the previous odd position.
pub(crate) fn snap_to_space(pos: f64, going_down: bool) -> f64 {
    let rounded = if going_down { pos.ceil() } else { pos.floor() };
    let r = rounded as i32;
    if r % 2 != 0 {
        rounded
    } else if going_down {
        rounded + 1.0
    } else {
        rounded - 1.0
    }
}

/// Center an articulation's ink bbox in the selected staff space, pushing
/// outward from the note. `cur_pos` is the glyph's drawn origin in half-spaces;
/// the offsets describe the glyph's bbox extent relative to that origin.
///
/// Standard engraving practice centers the visible glyph body in a space, not
/// the font origin. This matters even for a staccato dot because its SMuFL bbox
/// lies wholly above or below the origin.
pub(crate) fn snap_glyph_to_space(
    cur_pos: f64,
    glyph_top_off: f64,
    glyph_bottom_off: f64,
    going_down: bool,
) -> f64 {
    let space_center = snap_to_space(cur_pos, going_down);
    let ink_center_offset = (glyph_top_off + glyph_bottom_off) * 0.5;
    space_center - ink_center_offset
}

/// Keep a staff-anchored articulation wholly outside the staff while centering
/// it in the first outside space when no preceding stack pushes it farther.
pub(crate) fn keep_glyph_outside_staff(
    cur_pos: f64,
    glyph_top_off: f64,
    glyph_bottom_off: f64,
    place_below: bool,
) -> f64 {
    let ink_center_offset = (glyph_top_off + glyph_bottom_off) * 0.5;
    if place_below {
        cur_pos
            .max(9.0 - ink_center_offset)
            .max(8.0 - glyph_top_off)
    } else {
        cur_pos.min(-1.0 - ink_center_offset).min(-glyph_bottom_off)
    }
}

pub(crate) fn is_staccatissimo_codepoint(codepoint: u32) -> bool {
    matches!(
        codepoint,
        smufl::ARTIC_STACCATISSIMO_ABOVE
            | smufl::ARTIC_STACCATISSIMO_BELOW
            | smufl::ARTIC_STACCATISSIMO_WEDGE_ABOVE
            | smufl::ARTIC_STACCATISSIMO_WEDGE_BELOW
    )
}

// ═══════════════════════════════════════════
// Bounding box computation
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// Bounding box computation
// ═══════════════════════════════════════════

/// Compute a pixel-space bounding box for a SMuFL glyph.
/// glyph_bbox returns (x, y, w, h) in staff spaces; we scale by font_size/4.
pub(crate) fn glyph_pixel_bbox(
    glyph_x: f64,
    glyph_y: f64,
    codepoint: u32,
    font_size: f64,
) -> BoundingBox {
    let (bx, by, bw, bh) = smufl::glyph_bbox(codepoint);
    let scale = font_size / 4.0; // SMuFL fonts are designed at 4 staff spaces
    BoundingBox::new(
        glyph_x + bx * scale,
        glyph_y + by * scale,
        bw * scale,
        bh * scale,
    )
}

/// Convert glyph bbox to half-space offsets for articulation stacking.
pub(super) fn glyph_vertical_offsets_half_spaces(codepoint: u32) -> (f64, f64) {
    let (_, yoff, _, h) = smufl::glyph_bbox(codepoint);
    (yoff * 2.0, (yoff + h) * 2.0)
}

/// Slack (in spaces) added around a key signature's accidental ink so the
/// signature is comfortable to click. The accidentals are thin and separated by
/// gaps, so the hitbox is the filled rectangle over the whole run rather than
/// the individual glyph boxes.
const KEY_SIG_HIT_PAD_SP: f64 = 0.4;

/// Selection hitbox for a key signature: the union of its accidentals' ink,
/// padded and extended to at least the staff body so a click anywhere in the
/// signature's column selects it instead of falling through to the barline.
fn key_signature_bbox(layout: &KeySignatureLayout, staff_y: f64, sp: f64) -> Option<BoundingBox> {
    let mut ink: Option<BoundingBox> = None;
    for glyph in &layout.glyphs {
        let gb = glyph_pixel_bbox(glyph.x, glyph.y, glyph.codepoint, layout.glyph_size);
        ink = Some(match ink {
            Some(b) => b.union(&gb),
            None => gb,
        });
    }
    let ink = ink?;
    let pad = KEY_SIG_HIT_PAD_SP * sp;
    let bbox = ink.union(&BoundingBox::new(ink.x, staff_y, ink.width, 4.0 * sp));
    Some(BoundingBox::new(
        bbox.x - pad,
        bbox.y - pad,
        bbox.width + pad * 2.0,
        bbox.height + pad * 2.0,
    ))
}

/// Compute bounding boxes for all logical elements in a measure.
/// Returns a Vec of (element_id, BoundingBox) pairs.
pub(crate) fn compute_measure_bboxes(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    part_idx: usize,
    slur_map: Option<&super::super::slurs::SlurParticipationMap>,
    beamed_ids: &HashSet<String>,
    // Leading-clef gap reserved before this measure's start barline (a mid-
    // system start-of-measure clef change shifts the barline right by this
    // amount). The barline's selection bbox must track that shift, or the click
    // hitbox lands at the un-shifted `ml.x` while the glyph is drawn further
    // right. 0 for measures with no leading clef change.
    leading_clef_gap: f64,
) -> Vec<ElementBBox> {
    let mut bboxes = Vec::new();
    let measure_idx = ml.resolved.index;
    let glyph_size = 4.0 * sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let staff_height = 4.0 * sp;

    // Clef bbox (first measure only)
    if ml.resolved.index == 0 {
        if let Some(clefs) = &ml.resolved.part.clefs {
            if let Some(pc) = clefs.first() {
                let (codepoint, y_offset) = match pc.clef.sign {
                    ClefSign::G => (smufl::G_CLEF, 3.0),
                    ClefSign::F => (smufl::F_CLEF, 1.0),
                    ClefSign::C => (smufl::C_CLEF, 2.0),
                };
                let clef_x = ml.x + 0.5 * sp;
                let clef_y = staff_y + y_offset * sp;
                let bbox = glyph_pixel_bbox(clef_x, clef_y, codepoint, glyph_size);
                bboxes.push(ElementBBox {
                    element_id: element_id::clef(part_idx, measure_idx),
                    bbox,
                });
            }
        }
    }

    // Time signature bbox (global element — ID matches render_measure.rs tag).
    // Sized from the same layout the renderer draws, so an enlarged or
    // above-staff meter keeps a hitbox on its own ink.
    if let Some(ref ts) = ml.resolved.global.time {
        let settings = config.time_signature_settings;
        if settings.distribution == crate::model::time::TimeSignatureDistribution::PerStaff {
            let ts_x = crate::layout::time_signatures::meter_origin_x(ml, ts, settings, sp);
            let layout = crate::layout::time_signatures::time_signature_layout(
                settings,
                ts,
                ts_x,
                staff_y,
                staff_y + staff_height,
                sp,
            );
            bboxes.push(ElementBBox {
                element_id: element_id::time_sig(measure_idx),
                bbox: BoundingBox::new(
                    ts_x,
                    layout.top_y,
                    layout.width,
                    layout.bottom_y - layout.top_y,
                ),
            });
        }
    }

    // Key signature bbox — union of the accidentals' actual ink, padded into a
    // solid click target. The renderer restates the signature at every system
    // start, not only on a key change, so the hitbox has to follow it there too
    // (otherwise a click on a continuation signature falls through to the bar).
    if key_signature_is_rendered(ml) {
        let key_cancel_count = if ml.resolved.global.key.is_some() {
            ml.resolved
                .prev_key
                .cancellation_count(&ml.resolved.active_key)
        } else {
            0
        };
        let clef_sign = ml
            .resolved
            .part
            .clefs
            .as_ref()
            .and_then(|c| c.first())
            .map(|pc| &pc.clef.sign)
            .unwrap_or(&ClefSign::G);
        let cancel_prev = if key_cancel_count > 0 {
            Some(&ml.resolved.prev_key)
        } else {
            None
        };
        let key_x = key_signature_prefix_x(ml, sp, leading_clef_gap);
        let placement = key_signature_layout(
            key_x,
            staff_y,
            sp,
            &ml.resolved.active_key,
            clef_sign,
            cancel_prev,
        );
        if let Some(bbox) = key_signature_bbox(&placement, staff_y, sp) {
            bboxes.push(ElementBBox {
                element_id: element_id::key_sig(part_idx, measure_idx),
                bbox,
            });
        }
    }

    // Barline bbox (at measure start, except first measure)
    if ml.resolved.index > 0 {
        // Compute actual barline visual width based on type (repeat, double, etc.)
        let has_repeat_start = ml.resolved.global.repeat_start.is_some();
        let has_repeat_end = ml.resolved.global.repeat_end.is_some();
        let bt = ml.resolved.global.barline.as_ref().map(|b| &b.barline_type);
        let visual_width = if has_repeat_start && has_repeat_end {
            2.5 * sp
        } else if has_repeat_start || has_repeat_end {
            1.5 * sp
        } else {
            match bt {
                Some(BarlineType::Final)
                | Some(BarlineType::HeavyLight)
                | Some(BarlineType::HeavyHeavy) => 1.0 * sp,
                Some(BarlineType::Double) => 0.75 * sp,
                Some(BarlineType::Heavy) => 0.5 * sp,
                _ => config.barline_width * sp,
            }
        };
        // Account for repeat_start on current measure even without explicit barline
        let visual_width = if has_repeat_start && bt.is_none() {
            1.5 * sp
        } else {
            visual_width
        };
        // Minimum hit area: 1.5sp for easy clicking
        let hit_width = visual_width.max(1.5 * sp);
        // A system-start (or first-measure) repeat-start barline is rendered
        // after the clef/key/time prefix, not at ml.x — mirror that here so the
        // selection box tracks the glyph. Otherwise a mid-system start-of-measure
        // clef change shifts the barline right by `leading_clef_gap` (the change
        // clef is engraved before the barline), so the bbox must shift too.
        let bar_center_x = if has_repeat_start && ml.is_first_on_system {
            ml.x + ml.prefix_width - 1.2 * sp - 0.75 * sp
        } else {
            ml.x + leading_clef_gap
        };
        let bbox = BoundingBox::new(
            bar_center_x - hit_width * 0.5,
            staff_y,
            hit_width,
            staff_height,
        );
        bboxes.push(ElementBBox {
            element_id: element_id::barline(measure_idx),
            bbox,
        });
    }

    // Events (notes and rests) from all voices.
    // The body for each event is split across small helpers below; this loop
    // does the voice/event walk and computes the shared element-id strings.
    for (voice_idx, vl) in ml.voice_layouts.iter().enumerate() {
        let voice_part_idx = vl.part_index_override.unwrap_or(part_idx);
        let voice_seq_idx = vl.seq_index_override.unwrap_or(voice_idx);
        for event_idx in 0..vl.events.len() {
            let el = &vl.events.to_event_layout(event_idx);
            let event_suffix = element_id::event_suffix(el.id.as_deref(), event_idx);
            let element_id_str =
                element_id::event(voice_part_idx, measure_idx, voice_seq_idx, &event_suffix);
            let is_beamed = el.id.as_deref().is_some_and(|id| beamed_ids.contains(id));
            bbox_event_notes_or_rest(
                &mut bboxes,
                el,
                staff_y,
                sp,
                config,
                notehead_w,
                glyph_size,
                &element_id_str,
                is_beamed,
            );
            bbox_event_grace_notes(
                &mut bboxes,
                el,
                voice_part_idx,
                voice_seq_idx,
                &event_suffix,
                staff_y,
                sp,
                config,
                measure_idx,
            );
            bbox_event_articulations(
                &mut bboxes,
                el,
                event_idx,
                voice_part_idx,
                voice_seq_idx,
                measure_idx,
                staff_y,
                sp,
                config,
                notehead_w,
                staff_height,
                glyph_size,
                slur_map,
            );
        }
    }
    // Per-section helpers extracted to keep the outer dispatch readable; each
    // pushes onto `bboxes` for the elements it owns. See the corresponding
    // `bbox_*` functions below.
    //
    // NOTE: dynamics are NOT computed here. Their selection bbox is published
    // at emit time by `render_dynamics` (from the SAME drawn position,
    // including collision/stacking shifts), so re-deriving it here would both
    // duplicate the box and reintroduce the drift this pass used to cause.
    //
    // NOTE: tempo markings are likewise published at emit time by
    // `render_tempo_markings`, from the resolved `resolve_tempo_placement`
    // position (which sees the full above-glyph skyline, not just the MMR
    // number extents this pass had), so they are NOT recomputed here.
    //
    // NOTE: jump markers (segno/coda/fine/D.S.) publish at emit time in
    // `render_jump_markers`, from the collision-aware `highest_point_in_measure`
    // position, so they are NOT recomputed here.
    //
    // NOTE: rehearsal marks publish at emit time in `render_rehearsal_marks`,
    // from the same resolved frame (which sees the full above-glyph obstacle
    // bands, so the box tracks any horizontal dodge / vertical lift around a
    // co-located direction), so they are NOT recomputed here.
    bbox_chord_symbols(&mut bboxes, ml, staff_y, sp, part_idx, measure_idx, config);
    // Text expressions (stacked + inline) publish their boxes at emit time in
    // `render_dynamics` / `emit_stacked_expressions`, from the shifted draw
    // position, so they are intentionally NOT recomputed here.
    bbox_measure_numbers(&mut bboxes, ml, staff_y, sp, measure_idx, config);

    bboxes
}
// ═══════════════════════════════════════════
// Per-section bbox helpers (split out of compute_measure_bboxes)
// ═══════════════════════════════════════════

// ─── Event-level helpers (rest/notes, grace notes, articulations) ───
