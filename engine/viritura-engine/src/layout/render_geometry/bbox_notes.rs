#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_annotations::highest_point_in_range;
use super::super::render_articulations::collect_articulation_glyphs;
use super::super::render_barlines::render_barline;
use super::super::render_events::ArticCategory;
use super::super::render_measure::MIDDLE_LINE_POS;
use super::super::resolve::*;
use super::super::spacing::*;
use super::super::types::*;
use super::bbox_annotations::*;
use super::bbox_articulations::*;
use super::helpers::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

#[allow(clippy::too_many_arguments)] // dispatches rest + chord + per-notehead bboxes
pub(super) fn bbox_event_notes_or_rest(
    bboxes: &mut Vec<ElementBBox>,
    el: &EventLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    notehead_w: f64,
    glyph_size: f64,
    element_id_str: &str,
    is_beamed: bool,
) {
    let event = &el.event;
    let x = el.x;
    if event.is_rest() {
        if el.shared_rest {
            return;
        }
        let rest_codepoint = smufl::rest_glyph(&event.duration.base);
        let rest_y = match event.rest.as_ref().and_then(|r| r.staff_position) {
            Some(pos) => staff_y + (4.0 - pos as f64) * 0.5 * sp,
            None => match event.duration.base {
                NoteValueBase::Whole => staff_y + 1.0 * sp,
                _ => staff_y + 2.0 * sp,
            },
        };
        let bbox = glyph_pixel_bbox(x + 0.2 * sp, rest_y, rest_codepoint, glyph_size);
        bboxes.push(ElementBBox {
            element_id: element_id_str.to_string(),
            bbox,
        });
        return;
    }

    let notes = event.notes();
    if notes.is_empty() {
        return;
    }

    let notehead_codepoint = smufl::notehead_glyph(&event.duration.base);

    let first_pos = el.note_positions.first().copied().unwrap_or(4.0);
    let first_y = staff_y + first_pos * sp * 0.5;
    let first_offset = el.note_x_offsets.first().copied().unwrap_or(0.0) * notehead_w;
    let mut combined = glyph_pixel_bbox(x + first_offset, first_y, notehead_codepoint, glyph_size);

    for (ni, &pos) in el.note_positions.iter().enumerate().skip(1) {
        let note_y = staff_y + pos * sp * 0.5;
        let note_x_offset = el.note_x_offsets.get(ni).copied().unwrap_or(0.0) * notehead_w;
        let nh_bbox = glyph_pixel_bbox(x + note_x_offset, note_y, notehead_codepoint, glyph_size);
        combined = combined.union(&nh_bbox);
    }

    if event.duration.base.has_stem() && !el.note_positions.is_empty() {
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
        let stem_w = config.stem_width * sp;
        // Unbeamed flagged notes render a LENGTHENED stem (so the flag clears
        // the notehead) plus a flag glyph; the bbox must enclose both, else the
        // selection box / hit-test / overlay ink-detection clip the flag out
        // (the box would stop at the default-3.5sp stem tip while the flag
        // reaches ~0.5sp further). Beamed notes draw their stems via the beam
        // pass with no flag, so they keep the plain default-length stem here.
        let flag_count = if is_beamed {
            0
        } else {
            event.duration.base.flag_count()
        };
        if el.stem_up {
            let stem_x = x + smufl::STEM_UP_SE.0 * sp - stem_w * 0.5;
            let stem_bottom = staff_y + bottom_pos * sp * 0.5 + smufl::STEM_UP_SE.1 * sp;
            let stem_top = unbeamed_stem_flag_tip_y(top_pos, true, flag_count, staff_y, sp, config);
            let stem_bbox = BoundingBox::new(
                stem_x - stem_w * 0.5,
                stem_top,
                stem_w,
                stem_bottom - stem_top,
            );
            combined = combined.union(&stem_bbox);
            // Union the flag glyph itself (its curl extends right of the stem).
            if flag_count > 0 {
                if let Some(flag_cp) = smufl::flag_glyph(flag_count, true) {
                    let flag_y = stem_tip_y(
                        top_pos,
                        true,
                        staff_y,
                        sp,
                        unbeamed_stem_length(flag_count, true, config),
                    );
                    combined =
                        combined.union(&glyph_pixel_bbox(stem_x, flag_y, flag_cp, glyph_size));
                }
            }
        } else {
            let stem_x = x + smufl::STEM_DOWN_NW.0 * sp + stem_w * 0.5;
            let stem_top = staff_y + top_pos * sp * 0.5 + smufl::STEM_DOWN_NW.1 * sp;
            let stem_bottom =
                unbeamed_stem_flag_tip_y(bottom_pos, false, flag_count, staff_y, sp, config);
            let stem_bbox = BoundingBox::new(
                stem_x - stem_w * 0.5,
                stem_top,
                stem_w,
                stem_bottom - stem_top,
            );
            combined = combined.union(&stem_bbox);
            if flag_count > 0 {
                if let Some(flag_cp) = smufl::flag_glyph(flag_count, false) {
                    let flag_y = stem_tip_y(
                        bottom_pos,
                        false,
                        staff_y,
                        sp,
                        unbeamed_stem_length(flag_count, false, config),
                    );
                    combined =
                        combined.union(&glyph_pixel_bbox(stem_x, flag_y, flag_cp, glyph_size));
                }
            }
        }
    }

    bboxes.push(ElementBBox {
        element_id: element_id_str.to_string(),
        bbox: combined,
    });

    // Per-notehead sub-bboxes for chord-member click targets.
    let pad = 2.0;
    for (ni, &pos) in el.note_positions.iter().enumerate() {
        let note_y = staff_y + pos * sp * 0.5;
        let note_x_offset = el.note_x_offsets.get(ni).copied().unwrap_or(0.0) * notehead_w;
        let note_x = x + note_x_offset;
        let nh_bbox = glyph_pixel_bbox(note_x, note_y, notehead_codepoint, glyph_size);
        let padded = BoundingBox::new(
            nh_bbox.x - pad,
            nh_bbox.y - pad,
            nh_bbox.width + pad * 2.0,
            nh_bbox.height + pad * 2.0,
        );
        // For merged condensing chords, route the click to the source part's note.
        let note_eid = element_id::source_notehead(element_id_str, notes.get(ni), ni);
        bboxes.push(ElementBBox {
            element_id: note_eid,
            bbox: padded,
        });
    }
}

#[allow(clippy::too_many_arguments)] // grace-note bboxes mirror grace.rs rendering
pub(super) fn bbox_event_grace_notes(
    bboxes: &mut Vec<ElementBBox>,
    el: &EventLayout,
    voice_part_idx: usize,
    voice_seq_idx: usize,
    event_suffix: &str,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    measure_idx: usize,
) {
    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    for (gi, gn) in el.grace_notes.iter().enumerate() {
        if gn.event.is_rest() {
            continue;
        }
        let notes = gn.event.notes();
        if notes.is_empty() {
            continue;
        }

        let grace_suffix = element_id::event_suffix(gn.id.as_deref(), gi);
        let grace_eid = element_id::grace(
            voice_part_idx,
            measure_idx,
            voice_seq_idx,
            event_suffix,
            &grace_suffix,
        );

        let gn_codepoint = smufl::notehead_glyph(&gn.event.duration.base);

        let first_pos = gn.note_positions.first().copied().unwrap_or(4.0);
        let first_y = staff_y + first_pos * sp * 0.5;
        let mut combined = glyph_pixel_bbox(gn.x, first_y, gn_codepoint, grace_glyph_size);

        for &pos in gn.note_positions.iter().skip(1) {
            let note_y = staff_y + pos * sp * 0.5;
            let nh_bbox = glyph_pixel_bbox(gn.x, note_y, gn_codepoint, grace_glyph_size);
            combined = combined.union(&nh_bbox);
        }

        if gn.event.duration.base.has_stem() && !gn.note_positions.is_empty() {
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
            let stem_len = config.stem_length * sp * grace_scale;

            if gn.stem_up {
                let stem_x = gn.x + smufl::STEM_UP_SE.0 * sp * grace_scale;
                let stem_bottom =
                    staff_y + bottom_pos * sp * 0.5 + smufl::STEM_UP_SE.1 * sp * grace_scale;
                let flag_y = staff_y + top_pos * sp * 0.5 - stem_len;
                let ext = smufl::flag_stem_extension(gn.event.duration.base.flag_count(), true)
                    * sp
                    * grace_scale;
                let stem_top = flag_y - ext;
                let sw = config.stem_width * sp;
                let stem_bbox =
                    BoundingBox::new(stem_x - sw, stem_top, sw * 2.0, stem_bottom - stem_top);
                combined = combined.union(&stem_bbox);
            } else {
                let stem_x = gn.x + smufl::STEM_DOWN_NW.0 * sp * grace_scale;
                let stem_top = staff_y + top_pos * sp * 0.5;
                let flag_y = staff_y + bottom_pos * sp * 0.5 + stem_len;
                let ext = smufl::flag_stem_extension(gn.event.duration.base.flag_count(), false)
                    * sp
                    * grace_scale;
                let stem_bottom = flag_y + ext;
                let sw = config.stem_width * sp;
                let stem_bbox =
                    BoundingBox::new(stem_x - sw, stem_top, sw * 2.0, stem_bottom - stem_top);
                combined = combined.union(&stem_bbox);
            }
        }

        let gpad = 2.0;
        combined = BoundingBox::new(
            combined.x - gpad,
            combined.y - gpad,
            combined.width + gpad * 2.0,
            combined.height + gpad * 2.0,
        );

        bboxes.push(ElementBBox {
            element_id: grace_eid,
            bbox: combined,
        });
    }
}

/// Translate an event's articulation markings into the corresponding SMuFL
/// codepoints, selecting above/below variants based on `place_below`.
/// Articulation glyphs for the bbox pass, as `(codepoint, marking name)`.
///
/// Delegates to the render pass's own collector so the two agree on which
/// glyphs exist, in what order they stack, and what each is called — including
/// combo ligatures, which this pass used to miss. The name has to come from
/// the marking rather than the codepoint because `softAccent` and
/// `tenuto.accent` share one.
///
/// The category argument only steers placement, which this pass approximates
/// anyway, so a fixed value is fine here.
pub(super) fn collect_articulation_codepoints(
    markings: &crate::model::Markings,
    place_below: bool,
) -> Vec<(u32, &'static str)> {
    collect_articulation_glyphs(markings, ArticCategory::CloseToNote)
        .into_iter()
        .map(|g| (if place_below { g.below } else { g.above }, g.name))
        .collect()
}

#[allow(clippy::too_many_arguments)] // bundles articulation + fermata + ornament + trill
pub(super) fn bbox_event_articulations(
    bboxes: &mut Vec<ElementBBox>,
    el: &EventLayout,
    event_idx: usize,
    voice_part_idx: usize,
    voice_seq_idx: usize,
    measure_idx: usize,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    notehead_w: f64,
    staff_height: f64,
    glyph_size: f64,
    slur_map: Option<&super::super::slurs::SlurParticipationMap>,
) {
    if el.event.markings.is_none() && el.event.fermata.is_none() {
        return;
    }
    let markings_opt = el.event.markings.as_ref();
    let base_id = {
        let suffix = el.id.clone().unwrap_or_else(|| format!("e{}", event_idx));
        element_id::event(voice_part_idx, measure_idx, voice_seq_idx, &suffix)
    };

    // **Slur side override**: when this event participates in a slur,
    // articulations follow the slur side, not the stem side.
    let slur_role = el
        .id
        .as_deref()
        .and_then(|id| slur_map.and_then(|m| m.get(id).copied()));
    let place_below = match slur_role {
        Some(r) if !r.mixed_stems => matches!(r.side, super::super::slurs::SlurSide::Below),
        _ => {
            if el.num_voices > 1 {
                !el.stem_up
            } else {
                el.stem_up
            }
        }
    };

    if let Some(markings) = markings_opt {
        let artic_cps = collect_articulation_codepoints(markings, place_below);
        if !artic_cps.is_empty() && !el.note_positions.is_empty() {
            stack_articulations(
                bboxes,
                el,
                &artic_cps,
                slur_role,
                place_below,
                &base_id,
                staff_y,
                sp,
                config,
                notehead_w,
                glyph_size,
            );
        }
    }

    if let Some(ref fermata) = el.event.fermata {
        push_fermata_bbox(
            bboxes,
            el,
            fermata,
            &base_id,
            staff_y,
            sp,
            config,
            notehead_w,
            staff_height,
            glyph_size,
        );
    }

    if let Some(markings) = markings_opt {
        push_ornament_and_trill_bboxes(
            bboxes, el, markings, &base_id, staff_y, sp, config, notehead_w, glyph_size,
        );
    }
}
