#![allow(unused_imports)]

use super::super::beams::rest_ink_center_x;
use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_annotations::glyph_screen_bbox;
use super::super::render_events::{ArticCategory, ArticGlyph};
use super::super::render_geometry::*;
use super::super::resolve::*;
use super::super::slurs::{SlurParticipationMap, SlurRole, SlurSide};
use super::super::spacing::*;
use super::super::types::*;
use super::arpeggios::*;
use super::articulations::*;
use super::fingerings::*;
use super::tremolo_breath::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// X of the next event after onset `current_beat`, across all voices.
///
/// The "next event" is selected by **onset beat**, not by rendered x. A
/// full-span rest in another voice (a half/whole rest filling the bar) is
/// drawn CENTERED near the measure middle even though its onset is beat 0; an
/// x-based search would mistake that centered glyph for the next event and
/// anchor a breath mark / caesura to it. Comparing onsets keeps such rests out
/// — only events that actually begin later than `current_beat` qualify — then
/// returns that event's rendered x for placement.
pub(super) fn next_event_x(ml: &MeasureLayout, current_beat: f64) -> Option<f64> {
    next_event_after(ml, current_beat).map(|ev| ev.x)
}

/// Find the next event (by onset beat) after `current_beat`, across all voices,
/// returning a copy of its layout. Used when the caller needs more than the
/// bare x — e.g. the next event's accidental extent. Among events sharing the
/// smallest qualifying onset, the leftmost (smallest x) wins, so the caller
/// reserves the gap before the earliest-drawn glyph at that beat.
///
/// See `next_event_x` for why this compares onsets rather than rendered x.
pub(super) fn next_event_after(ml: &MeasureLayout, current_beat: f64) -> Option<EventLayout> {
    let mut best: Option<(f64, f64, usize, usize)> = None; // (beat, x, voice_idx, event_idx)
    for (vi, voice) in ml.voice_layouts.iter().enumerate() {
        for i in 0..voice.events.len() {
            let beat = voice.events.beat_position(i);
            if beat <= current_beat + 1e-6 {
                continue;
            }
            let x = voice.events.x(i);
            let better = match best {
                None => true,
                Some((bb, bx, _, _)) => beat < bb - 1e-6 || ((beat - bb).abs() <= 1e-6 && x < bx),
            };
            if better {
                best = Some((beat, x, vi, i));
            }
        }
    }
    best.map(|(_, _, vi, i)| ml.voice_layouts[vi].events.to_event_layout(i))
}

/// Screen-space extent of any articulation/ornament/trill glyph already drawn
/// over this event's notehead column, on the requested side of the staff.
///
/// For the above side it returns the smallest `y` (topmost edge) reached; for
/// the below side, the largest `y` (bottommost edge). Glyphs are matched to the
/// event by horizontal proximity to the notehead centre and constrained to a
/// vertical band hugging this staff so an upper/lower staff sharing the same x
/// is not picked up. Returns `None` when nothing is stacked on that side yet.
///
/// This lets a fermata sit outside (beyond) every other marking on the event
/// regardless of how those markings stacked — standard engraving practice puts
/// the fermata furthest from the staff.
fn marking_extent_on_side(
    dl: &DisplayList,
    measure_cmd_start: usize,
    notehead_center_x: f64,
    staff_y: f64,
    sp: f64,
    below: bool,
) -> Option<f64> {
    // Markings centre on the same notehead; the nearest adjacent event sits at
    // least a notehead-plus-spacing away, so a tight tolerance is unambiguous.
    let x_tol = 1.5 * sp;
    let mut extent = if below {
        f64::NEG_INFINITY
    } else {
        f64::INFINITY
    };
    // Scoped to THIS measure's own commands. `staff_obstacle_band` alone isn't
    // enough to rule out a neighbouring staff at the same beat x: its margin
    // (10sp each side) can exceed the gap between two staves in a dense full
    // score, so an unscoped scan can snag another instrument's articulation.
    for cmd in &dl.commands[measure_cmd_start..] {
        let RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            size,
            ..
        } = cmd
        else {
            continue;
        };
        // SMuFL Articulation supplement (U+E4A0–E4BF) and Common-ornament range
        // (U+E560–E5AF, includes trills). Fermatas (U+E4C0+) are deliberately
        // excluded so fermatas don't stack against each other.
        let is_artic = smufl::is_articulation(*codepoint);
        let is_ornament = smufl::is_ornament(*codepoint);
        if !is_artic && !is_ornament {
            continue;
        }
        let gb = glyph_screen_bbox(*x, *y, *codepoint, *size);
        if (gb.center_x() - notehead_center_x).abs() > x_tol {
            continue;
        }
        let glyph_center_y = gb.center_y();
        // Keep to the requested side and within ~one staff's reach so a glyph
        // belonging to a neighbouring staff at the same x is never matched.
        // The above/below split is the staff's middle line (`staff_y + 2sp`);
        // the outer bounds are the shared single-staff obstacle band.
        let (band_lo, band_hi) = staff_obstacle_band(staff_y, sp);
        let side_split = staff_y + 2.0 * sp;
        if below {
            if glyph_center_y < side_split || glyph_center_y > band_hi {
                continue;
            }
            extent = extent.max(gb.bottom);
        } else {
            if glyph_center_y > side_split || glyph_center_y < band_lo {
                continue;
            }
            extent = extent.min(gb.top);
        }
    }
    extent.is_finite().then_some(extent)
}

/// Render fermatas above or below notes/rests that have them.
///
/// Fermatas are placed above the staff by default (opposite the stem side in
/// multi-voice contexts). They are centered horizontally on the notehead and
/// placed outside any articulation stacking — above all other markings when
/// above, below all when below.
pub(crate) fn render_fermatas(
    dl: &mut DisplayList,
    measure_cmd_start: usize,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let glyph_size = 4.0 * sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;

    for vl in &ml.voice_layouts {
        for ei in 0..vl.events.len() {
            // Pre-check on the arena before materializing — fermatas are rare,
            // so only clone the events that carry one.
            if vl.events.event(ei).fermata.is_none() {
                continue;
            }
            let el = vl.events.to_event_layout(ei);
            let el = &el;
            let fermata = match &el.event.fermata {
                Some(f) => f,
                None => continue,
            };

            let (above_cp, below_cp) = smufl::fermata_glyph(
                fermata
                    .symbol
                    .as_ref()
                    .unwrap_or(&crate::model::FermataSymbol::Normal),
            );

            // Placement: explicit `orient` wins; otherwise above by default,
            // below in multi-voice when stem is down. The `pointing` field
            // (which way the curve faces) is independent of placement; for
            // now we always use the matched-orientation glyph.
            let is_multi_voice = el.num_voices > 1;
            let place_below = match fermata.orient {
                Some(crate::model::Orientation::Above) => false,
                Some(crate::model::Orientation::Below) => true,
                _ => is_multi_voice && !el.stem_up,
            };
            let codepoint = if place_below { below_cp } else { above_cp };

            let (glyph_x, _, glyph_w, _) = smufl::glyph_bbox(codepoint);

            let attachment_center_x = if el.event.is_rest() {
                rest_ink_center_x(
                    el.x,
                    &el.event.duration,
                    sp,
                    vl.events
                        .is_centered_bar_rest(ei, ml.resolved.active_time.measure_beats()),
                )
            } else {
                let notehead = smufl::notehead_glyph(&el.event.duration.base);
                let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(notehead);
                let left_offset =
                    el.note_x_offsets.iter().copied().fold(0.0_f64, f64::min) * notehead_w;
                let right_offset =
                    el.note_x_offsets.iter().copied().fold(0.0_f64, f64::max) * notehead_w;
                el.x + (left_offset + right_offset + (2.0 * bbox_x + bbox_w) * sp) * 0.5
            };
            let fx = attachment_center_x - (glyph_x + glyph_w * 0.5) * sp;

            // Compute notehead extents (and stem tip if pointing in our direction).
            // `note_positions` are in half-spaces from the top staff line; positive
            // values go down. The top-most note has the smallest position value.
            // Ref: standard engraving practice — fermatas above the staff sit a fixed
            // distance above the top line, but yield to high notes/stems with a
            // minimum clearance. Mirror behaviour for the below case.
            let has_stem = el.event.duration.base.has_stem();
            let fy = if place_below {
                let staff_bottom = staff_y + 4.0 * sp;
                let default_y = staff_bottom + config.fermata_above_staff * sp;
                let mut fy = if el.note_positions.is_empty() {
                    default_y
                } else {
                    let bottom_pos = el
                        .note_positions
                        .iter()
                        .cloned()
                        .fold(f64::NEG_INFINITY, f64::max);
                    let note_bottom_y = staff_y + bottom_pos * sp * 0.5;
                    // If the stem points down, its tip extends below the lowest notehead.
                    let stem_tip_y = if !el.stem_up && has_stem {
                        note_bottom_y + config.stem_length * sp
                    } else {
                        note_bottom_y
                    };
                    let note_clear_y = stem_tip_y + config.fermata_note_clearance * sp;
                    default_y.max(note_clear_y)
                };
                // Sit below every articulation/ornament already placed below the
                // staff on this event, so the fermata stays outermost.
                if let Some(obstacle_bottom) = marking_extent_on_side(
                    dl,
                    measure_cmd_start,
                    attachment_center_x,
                    staff_y,
                    sp,
                    true,
                ) {
                    let (_, fby, _, _) = smufl::glyph_bbox(codepoint);
                    let fy_needed = obstacle_bottom + config.fermata_note_clearance * sp - fby * sp;
                    fy = fy.max(fy_needed);
                }
                fy
            } else {
                let default_y = staff_y - config.fermata_above_staff * sp;
                let mut fy = if el.note_positions.is_empty() {
                    default_y
                } else {
                    let top_pos = el
                        .note_positions
                        .iter()
                        .cloned()
                        .fold(f64::INFINITY, f64::min);
                    let note_top_y = staff_y + top_pos * sp * 0.5;
                    // If the stem points up, its tip extends above the highest notehead.
                    let stem_tip_y = if el.stem_up && has_stem {
                        note_top_y - config.stem_length * sp
                    } else {
                        note_top_y
                    };
                    let note_clear_y = stem_tip_y - config.fermata_note_clearance * sp;
                    default_y.min(note_clear_y)
                };
                // Sit above every articulation/ornament/trill already placed
                // above the staff on this event, so the fermata stays outermost.
                if let Some(obstacle_top) = marking_extent_on_side(
                    dl,
                    measure_cmd_start,
                    attachment_center_x,
                    staff_y,
                    sp,
                    false,
                ) {
                    // Fermata glyph bottom edge = fy + (fby + fbh) * sp (size = 4sp,
                    // scale = 1sp); keep it above the obstacle by the clearance gap.
                    let (_, fby, _, fbh) = smufl::glyph_bbox(codepoint);
                    let fy_needed =
                        obstacle_top - config.fermata_note_clearance * sp - (fby + fbh) * sp;
                    fy = fy.min(fy_needed);
                }
                fy
            };

            let event_id = el
                .id
                .as_deref()
                .map(|id| id.to_string())
                .unwrap_or_else(|| format!("e{}", ei));
            let ferm_event = element_id::event(
                vl.part_index_override.unwrap_or(ml.part_index),
                ml.resolved.index,
                vl.seq_index_override.unwrap_or(vl.voice_index),
                &event_id,
            );
            let ferm_id = element_id::fermata(&ferm_event);
            dl.push_tagged(
                RenderCommand::DrawGlyph {
                    x: fx,
                    y: fy,
                    codepoint,
                    font: "Bravura".into(),
                    size: glyph_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                },
                ferm_id,
            );
        }
    }
}

/// Render trill ornaments above notes that have them.
///
/// Trills are placed above the staff, centered horizontally on the notehead.
/// The ornamentTrill glyph is used from SMuFL. If an accidental is specified,
/// a small accidental glyph is rendered above the trill symbol.
pub(crate) fn render_trills(
    dl: &mut DisplayList,
    measure_cmd_start: usize,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let glyph_size = 4.0 * sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;

    for vl in &ml.voice_layouts {
        for ei in 0..vl.events.len() {
            // Pre-check before materializing — most events carry no trill.
            let has_trill = vl
                .events
                .event(ei)
                .markings
                .as_ref()
                .is_some_and(|m| m.trill.is_some());
            if !has_trill {
                continue;
            }
            let el = vl.events.to_event_layout(ei);
            let el = &el;
            let trill = match &el.event.markings {
                Some(m) => match &m.trill {
                    Some(t) => t,
                    None => continue,
                },
                None => continue,
            };

            let codepoint = smufl::trill_glyph(&trill.accidental);
            let (_, _, glyph_w, _) = smufl::glyph_bbox(codepoint);

            // Center on notehead, above note/staff with clearance
            // Ref: industry-standard engravers — trills are placed above the highest
            // point (top of staff or highest note/stem, whichever is higher).
            let tx = el.x + notehead_w * 0.5 - glyph_w * sp * 0.5;
            let default_y = staff_y - config.trill_above_staff * sp;
            let highest_note_y = if !el.note_positions.is_empty() {
                let top_pos = el
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                let note_y = staff_y + top_pos * sp * 0.5;
                // If stem up, stem tip is even higher
                let stem_tip_y = if el.stem_up && el.event.duration.base.has_stem() {
                    note_y - config.stem_length * sp
                } else {
                    note_y
                };
                stem_tip_y - 1.0 * sp // clearance above stem tip
            } else {
                default_y
            };
            let mut ty = default_y.min(highest_note_y);

            // Sit above any articulation (accent, marcato, staccato, ...)
            // already stacked above this notehead: notehead, then
            // articulation, then trill/ornament is the priority order. Reuses
            // `artic_distance_head` so the articulation-to-trill gap matches
            // the notehead-to-articulation gap.
            let notehead_center_x = el.x + notehead_w * 0.5;
            if let Some(obstacle_top) =
                marking_extent_on_side(dl, measure_cmd_start, notehead_center_x, staff_y, sp, false)
            {
                let (_, gy, _, gh) = smufl::glyph_bbox(codepoint);
                ty = ty.min(obstacle_top - config.artic_distance_head * sp - (gy + gh) * sp);
            }

            dl.push(RenderCommand::DrawGlyph {
                x: tx,
                y: ty,
                codepoint,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            });

            // Render optional accidental above the trill symbol
            if let Some(alter) = trill.accidental {
                if let Some(acc_cp) = smufl::accidental_glyph(alter) {
                    let acc_size = 3.0 * sp; // smaller than trill glyph
                    let acc_scale = acc_size / glyph_size; // 0.75
                    let (_, _, acc_w, _) = smufl::glyph_bbox(acc_cp);
                    let (_, trill_bbox_y, _, _) = smufl::glyph_bbox(codepoint);
                    let (_, acc_bbox_y, _, acc_bbox_h) = smufl::glyph_bbox(acc_cp);
                    // Position accidental centered on trill, above the trill's top edge
                    let ax = tx + glyph_w * sp * 0.5 - acc_w * acc_scale * sp * 0.5;
                    // trill_top = ty + trill_bbox_y * sp (highest point of trill in screen coords)
                    // acc_bottom extends (acc_bbox_y + acc_bbox_h) below baseline, scaled
                    // Place accidental so its bottom has a gap above the trill top
                    let trill_top = ty + trill_bbox_y * sp;
                    let acc_bottom_extent = (acc_bbox_y + acc_bbox_h) * acc_scale * sp;
                    let ay = trill_top - acc_bottom_extent - 0.25 * sp;
                    dl.push(RenderCommand::DrawGlyph {
                        x: ax,
                        y: ay,
                        codepoint: acc_cp,
                        font: "Bravura".into(),
                        size: acc_size,
                        color: "#000000".into(),
                        rotation: 0.0,
                    });
                }
            }
        }
    }
}

/// Render ornaments (turn, mordent, inverted mordent, etc.) above notes.
///
/// Ornaments are single-glyph symbols placed above the note, centered
/// horizontally on the notehead. They are placed above articulations but
/// in the same vertical zone as trills and fermatas.
pub(crate) fn render_ornaments(
    dl: &mut DisplayList,
    measure_cmd_start: usize,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let glyph_size = 4.0 * sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;

    for vl in &ml.voice_layouts {
        for ei in 0..vl.events.len() {
            // Pre-check before materializing — most events carry no ornaments.
            let has_ornaments = vl
                .events
                .event(ei)
                .markings
                .as_ref()
                .is_some_and(|m| m.ornaments.as_ref().is_some_and(|o| !o.is_empty()));
            if !has_ornaments {
                continue;
            }
            let el = vl.events.to_event_layout(ei);
            let el = &el;
            let ornaments = match &el.event.markings {
                Some(m) => match &m.ornaments {
                    Some(o) if !o.is_empty() => o,
                    _ => continue,
                },
                None => continue,
            };

            // Compute base y: above note/staff with clearance
            // Ref: industry-standard engravers — ornaments placed above the highest
            // point (top of staff or highest note/stem, whichever is higher).
            let default_y = staff_y - config.ornament_above_staff * sp;
            let highest_note_y = if !el.note_positions.is_empty() {
                let top_pos = el
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                let note_y = staff_y + top_pos * sp * 0.5;
                let stem_tip_y = if el.stem_up && el.event.duration.base.has_stem() {
                    note_y - config.stem_length * sp
                } else {
                    note_y
                };
                stem_tip_y - 1.0 * sp
            } else {
                default_y
            };
            let mut base_oy = default_y.min(highest_note_y);

            // Sit above any articulation already stacked above this notehead —
            // same priority order as trills (notehead, then articulation, then
            // ornament), reusing the same notehead-to-articulation gap.
            let notehead_center_x = el.x + notehead_w * 0.5;
            if let Some(obstacle_top) =
                marking_extent_on_side(dl, measure_cmd_start, notehead_center_x, staff_y, sp, false)
            {
                if let Some(first) = ornaments.first() {
                    let (_, gy, _, gh) = smufl::glyph_bbox(smufl::ornament_glyph(first));
                    base_oy = base_oy
                        .min(obstacle_top - config.artic_distance_head * sp - (gy + gh) * sp);
                }
            }

            // Render each ornament (typically just one per event)
            let mut y_offset = 0.0;
            for ornament_type in ornaments {
                let codepoint = smufl::ornament_glyph(ornament_type);
                let (_, _, glyph_w, glyph_h) = smufl::glyph_bbox(codepoint);

                // Center on notehead, above note/staff
                let ox = el.x + notehead_w * 0.5 - glyph_w * sp * 0.5;
                let oy = base_oy - y_offset;

                dl.push(RenderCommand::DrawGlyph {
                    x: ox,
                    y: oy,
                    codepoint,
                    font: "Bravura".into(),
                    size: glyph_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                });

                // Stack multiple ornaments vertically (rare but possible)
                y_offset += glyph_h * sp + 0.25 * sp;
            }
        }
    }
}
