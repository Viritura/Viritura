#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_annotations::highest_point_in_range;
use super::super::render_barlines::render_barline;
use super::super::render_measure::MIDDLE_LINE_POS;
use super::super::resolve::*;
use super::super::spacing::*;
use super::super::types::*;
use super::bbox_annotations::*;
use super::bbox_notes::*;
use super::helpers::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Vertical extent (absolute Y, top and bottom) of all articulation glyphs in
/// a measure, for vertical-space reservation. Mirrors the placement + stacking
/// used by the bbox render pass (via `stack_articulations`) so the reserved
/// system height encompasses accents, staccato, marcato, etc. — which the raw
/// note/stem extremes ignore.
///
/// Slur-side overrides are deliberately not threaded here: reservation only
/// needs the extent magnitude, and the dominant case is unslurred. Returns
/// `(staff_y, staff_y + staff_height)` collapsed to the staff edges when a
/// measure has no articulations, so callers can `min`/`max` it harmlessly.
pub(crate) fn measure_articulation_extent(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> (f64, f64) {
    let glyph_size = 4.0 * sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    let mut top = staff_y;
    let mut bottom = staff_bottom;
    let mut scratch: Vec<ElementBBox> = Vec::new();
    for (voice_idx_0based, vl) in ml.voice_layouts.iter().enumerate() {
        for i in 0..vl.events.len() {
            let el = vl.events.to_event_layout(i);
            let markings = match &el.event.markings {
                Some(m) => m,
                None => continue,
            };
            if el.note_positions.is_empty() {
                continue;
            }
            // Single voice: articulations sit opposite the stem
            // (place_below = stem_up). Multi-voice: forced to the voice's outer
            // side by parity (voice 1/3/5 above, voice 2/4/6 below), matching
            // the render path in `render_articulations`. Cross-staff receiving
            // staves carry a per-event override (the arriving voice makes the
            // native voice's articulations sit on the outer side).
            let place_below = if let Some(forced) = vl.events.artic_force_below(i) {
                forced
            } else if el.num_voices > 1 {
                voice_idx_0based % 2 == 1
            } else {
                el.stem_up
            };
            let artic_cps = collect_articulation_codepoints(markings, place_below);
            if artic_cps.is_empty() {
                continue;
            }
            scratch.clear();
            stack_articulations(
                &mut scratch,
                &el,
                &artic_cps,
                None,
                place_below,
                "",
                staff_y,
                sp,
                config,
                notehead_w,
                glyph_size,
            );
            for b in &scratch {
                top = top.min(b.bbox.y);
                bottom = bottom.max(b.bbox.y + b.bbox.height);
            }
        }
    }
    (top, bottom)
}

#[allow(clippy::too_many_arguments)] // mirrors render_articulations stacking
pub(super) fn stack_articulations(
    bboxes: &mut Vec<ElementBBox>,
    el: &EventLayout,
    // Glyphs to stack, as `(codepoint, marking name)`.
    artic_cps: &[(u32, &'static str)],
    slur_role: Option<super::super::slurs::SlurRole>,
    place_below: bool,
    base_id: &str,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    notehead_w: f64,
    glyph_size: f64,
) {
    let notehead_center_x = el.x + notehead_w * 0.5;
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
    let stem_tip_pos = if el.stem_up {
        top_pos - config.stem_length * 2.0
    } else {
        bottom_pos + config.stem_length * 2.0
    };
    let min_gap = config.artic_min_distance * 2.0;
    let has_outside_glyph = artic_cps.iter().any(|&(cp, _)| {
        cp == smufl::ARTIC_ACCENT_ABOVE
            || cp == smufl::ARTIC_ACCENT_BELOW
            || cp == smufl::ARTIC_MARCATO_ABOVE
            || cp == smufl::ARTIC_MARCATO_BELOW
            || cp == smufl::ARTIC_SOFT_ACCENT_ABOVE
            || cp == smufl::ARTIC_SOFT_ACCENT_BELOW
            || cp == smufl::ARTIC_STRESS_ABOVE
            || cp == smufl::ARTIC_STRESS_BELOW
            || cp == smufl::ARTIC_ACCENT_STACCATO_ABOVE
            || cp == smufl::ARTIC_ACCENT_STACCATO_BELOW
            || cp == smufl::ARTIC_MARCATO_STACCATO_ABOVE
            || cp == smufl::ARTIC_MARCATO_STACCATO_BELOW
            || cp == smufl::ARTIC_MARCATO_TENUTO_ABOVE
            || cp == smufl::ARTIC_MARCATO_TENUTO_BELOW
            || cp == smufl::ARTIC_TENUTO_ACCENT_ABOVE
            || cp == smufl::ARTIC_TENUTO_ACCENT_BELOW
            || is_staccatissimo_codepoint(cp)
    });
    let use_slur_side = slur_role.is_some_and(|r| !r.mixed_stems);
    let slope_extra: f64 = match slur_role {
        Some(r) if r.is_boundary && use_slur_side => {
            if let Some(partner_top) = r.partner_top_pos {
                let my_top = el
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                if my_top.is_finite() {
                    let delta = match r.side {
                        super::super::slurs::SlurSide::Above => partner_top - my_top,
                        super::super::slurs::SlurSide::Below => my_top - partner_top,
                    };
                    if delta > 0.0 {
                        (delta * 0.10).min(0.5)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                }
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    let boundary_extra: f64 = match slur_role {
        Some(r) if r.is_boundary && has_outside_glyph && use_slur_side => 1.0 + slope_extra,
        _ => 0.0,
    };

    let head_offset = (config.artic_distance_head + config.notehead_ry) * 2.0;

    let mut cur_pos = if place_below {
        let from_head = bottom_pos + head_offset + boundary_extra;
        let from_stem = if el.event.duration.base.has_stem() && !el.stem_up {
            stem_tip_pos + config.artic_distance_stem * 2.0
        } else {
            from_head
        };
        let start = from_head.max(from_stem);
        if start <= 8.0 {
            snap_to_space(start, true)
        } else {
            start
        }
    } else {
        let from_head = top_pos - head_offset - boundary_extra;
        let from_stem = if el.event.duration.base.has_stem() && el.stem_up {
            stem_tip_pos - config.artic_distance_stem * 2.0
        } else {
            from_head
        };
        let start = from_head.min(from_stem);
        if start >= 0.0 {
            snap_to_space(start, false)
        } else {
            start
        }
    };

    let mut artic_combined: Option<BoundingBox> = None;
    let mut prev_far_edge: Option<f64> = None;
    let anchor_edge = cur_pos;

    for &(cp, name) in artic_cps.iter() {
        let (glyph_top_off, glyph_bottom_off) = glyph_vertical_offsets_half_spaces(cp);

        if place_below {
            let desired_top = match prev_far_edge {
                Some(prev_bottom) => prev_bottom + min_gap,
                None => anchor_edge,
            };
            cur_pos = desired_top - glyph_top_off;
            if cur_pos <= 8.0 {
                cur_pos = snap_glyph_to_space(cur_pos, glyph_top_off, glyph_bottom_off, true);
            }
        } else {
            let desired_bottom = match prev_far_edge {
                Some(prev_top) => prev_top - min_gap,
                None => anchor_edge,
            };
            cur_pos = desired_bottom - glyph_bottom_off;
            if cur_pos >= 0.0 {
                cur_pos = snap_glyph_to_space(cur_pos, glyph_top_off, glyph_bottom_off, false);
            }
        }
        if is_staccatissimo_codepoint(cp) {
            cur_pos =
                keep_glyph_outside_staff(cur_pos, glyph_top_off, glyph_bottom_off, place_below);
        }

        let artic_w = smufl::articulation_width(cp) * sp;
        let artic_x = notehead_center_x - artic_w * 0.5;
        let y = staff_y + cur_pos * sp * 0.5;
        let glyph_bb = glyph_pixel_bbox(artic_x, y, cp, glyph_size);
        bboxes.push(ElementBBox {
            element_id: element_id::articulation(base_id, name),
            bbox: glyph_bb.clone(),
        });
        artic_combined = Some(match artic_combined {
            Some(prev) => prev.union(&glyph_bb),
            None => glyph_bb,
        });

        if place_below {
            prev_far_edge = Some(cur_pos + glyph_bottom_off);
        } else {
            prev_far_edge = Some(cur_pos + glyph_top_off);
        }
    }

    if let Some(bbox) = artic_combined {
        bboxes.push(ElementBBox {
            element_id: element_id::artic_bbox(base_id),
            bbox,
        });
    }
}

#[allow(clippy::too_many_arguments)] // fermata placement needs the full geometry context
pub(super) fn push_fermata_bbox(
    bboxes: &mut Vec<ElementBBox>,
    el: &EventLayout,
    fermata: &crate::model::Fermata,
    base_id: &str,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    notehead_w: f64,
    staff_height: f64,
    glyph_size: f64,
) {
    let (above_cp, below_cp) = smufl::fermata_glyph(
        fermata
            .symbol
            .as_ref()
            .unwrap_or(&crate::model::FermataSymbol::Normal),
    );
    let is_multi = el.num_voices > 1;
    let ferm_below = match fermata.orient {
        Some(crate::model::Orientation::Above) => false,
        Some(crate::model::Orientation::Below) => true,
        _ => is_multi && !el.stem_up,
    };
    let codepoint = if ferm_below { below_cp } else { above_cp };
    let (_, _, gw, _) = smufl::glyph_bbox(codepoint);
    let fx = el.x + notehead_w * 0.5 - gw * sp * 0.5;
    let fy = if ferm_below {
        staff_y + staff_height + config.fermata_above_staff * sp
    } else {
        staff_y - config.fermata_above_staff * sp
    };
    let bbox = glyph_pixel_bbox(fx, fy, codepoint, glyph_size);
    bboxes.push(ElementBBox {
        element_id: element_id::fermata_bbox(base_id),
        bbox,
    });
}

#[allow(clippy::too_many_arguments)] // ornaments and trill share the same anchor geometry
pub(super) fn push_ornament_and_trill_bboxes(
    bboxes: &mut Vec<ElementBBox>,
    el: &EventLayout,
    markings: &crate::model::Markings,
    base_id: &str,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    notehead_w: f64,
    glyph_size: f64,
) {
    if let Some(ref ornaments) = markings.ornaments {
        if !ornaments.is_empty() {
            let mut orn_combined: Option<BoundingBox> = None;
            let mut y_offset = 0.0;
            for ornament_type in ornaments {
                let codepoint = smufl::ornament_glyph(ornament_type);
                let (_, _, gw, gh) = smufl::glyph_bbox(codepoint);
                let ox = el.x + notehead_w * 0.5 - gw * sp * 0.5;
                let oy = staff_y - config.ornament_above_staff * sp - y_offset;
                let glyph_bb = glyph_pixel_bbox(ox, oy, codepoint, glyph_size);
                orn_combined = Some(match orn_combined {
                    Some(prev) => prev.union(&glyph_bb),
                    None => glyph_bb,
                });
                y_offset += gh * sp + 0.25 * sp;
            }
            if let Some(bbox) = orn_combined {
                bboxes.push(ElementBBox {
                    element_id: element_id::ornament_bbox(base_id),
                    bbox,
                });
            }
        }
    }

    if let Some(ref trill) = markings.trill {
        let codepoint = smufl::trill_glyph(&trill.accidental);
        let (_, _, gw, _) = smufl::glyph_bbox(codepoint);
        let tx = el.x + notehead_w * 0.5 - gw * sp * 0.5;
        let ty = staff_y - config.trill_above_staff * sp;
        let bbox = glyph_pixel_bbox(tx, ty, codepoint, glyph_size);
        bboxes.push(ElementBBox {
            element_id: element_id::trill_bbox(base_id),
            bbox,
        });
    }
}
