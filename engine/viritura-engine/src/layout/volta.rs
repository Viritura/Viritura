//! Volta brackets and ottava line rendering.

use super::element_id;
use super::types::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashMap;

// ═══════════════════════════════════════════
// Volta brackets (alternate endings)
// ═══════════════════════════════════════════

/// Render volta brackets above the staff for measures with `ending` fields.
/// Each ending defines a bracket spanning `duration` measures, with number labels
/// like "1.", "2.", or "1, 2.". Open endings have no right hook; closed ones do.
pub(crate) fn render_volta_brackets(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    _part_index: usize,
) {
    // Alternate-ending brackets are system furniture: draw once on the same
    // top-level staff that owns tempo and rehearsal marks.
    if !measure_layouts
        .first()
        .is_some_and(|ml| ml.show_system_objects)
    {
        return;
    }
    let default_bracket_y = staff_y - 1.8 * sp; // above top staff line
    let hook_length = 1.2 * sp; // vertical hook height
    let line_width = 0.16 * sp; // Bravura engravingDefaults.repeatEndingLineThickness
    let text_size = 1.5 * sp;
    let text_x_offset = 0.5 * sp; // text inset from left edge
    let text_y_offset = 0.3 * sp; // text below bracket line
    let stem_length = 3.5 * sp;
    let min_clearance = 1.0 * sp;
    // Gap left before a closed ending's right hook so it doesn't run into the
    // next ending's left hook/label at the shared barline.
    let closed_end_gap = 1.0 * sp;

    struct VoltaSpan {
        x_left: f64,
        x_right: f64,
        is_open: bool,
        color: String,
        label: String,
        local_bracket_y: f64,
        measure_index: usize,
    }

    let mut spans: Vec<VoltaSpan> = Vec::new();

    for (i, ml) in measure_layouts.iter().enumerate() {
        if let Some(ref ending) = ml.resolved.global.ending {
            let x_left = ml.x;
            // Bracket spans `duration` measures from this one
            let span_end = (i + ending.duration as usize).min(measure_layouts.len());
            let last_ml = &measure_layouts[span_end - 1];
            let is_open = ending.open.unwrap_or(false);
            // A closed ending stops short of the barline so its right hook
            // doesn't merge into the next ending's opening hook/label.
            let natural_x_right = last_ml.x + last_ml.width;
            let x_right = if is_open {
                natural_x_right
            } else {
                (natural_x_right - closed_end_gap).max(x_left + closed_end_gap)
            };
            let color: &str = ending.color.as_deref().unwrap_or("#000000");

            // Skyline-like vertical placement: keep bracket above the highest
            // note/stem tip in the spanned measures with minimum clearance.
            let mut highest_y = f64::INFINITY;
            for span_ml in measure_layouts.iter().take(span_end).skip(i) {
                for vl in &span_ml.voice_layouts {
                    for ev in 0..vl.events.len() {
                        if vl.events.event(ev).is_rest() {
                            continue;
                        }
                        for &pos in vl.events.note_positions(ev) {
                            let note_y = staff_y + pos * sp * 0.5;
                            if note_y < highest_y {
                                highest_y = note_y;
                            }

                            if vl.events.stem_up(ev) {
                                let stem_tip_y = note_y - stem_length;
                                if stem_tip_y < highest_y {
                                    highest_y = stem_tip_y;
                                }
                            }
                        }
                    }
                }
            }

            // Also clear articulations/fermatas/ornaments/tremolos already
            // registered on this staff (e.g. a staccato dot above a note)
            // — the manual note/stem scan above doesn't know their glyph extent.
            if let Some(sky_top) = dl.skyline_top(x_left, natural_x_right, staff_y, |kind| {
                matches!(
                    kind,
                    ElementKind::Articulation
                        | ElementKind::Fermata
                        | ElementKind::Ornament
                        | ElementKind::Tremolo
                )
            }) {
                highest_y = highest_y.min(sky_top);
            }

            let label_depth = text_y_offset + text_size;
            let local_bracket_y = if highest_y.is_finite() {
                default_bracket_y.min(highest_y - min_clearance - label_depth)
            } else {
                default_bracket_y
            };

            let label = format!(
                "{}.",
                ending
                    .numbers
                    .iter()
                    .map(|n| n.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );

            spans.push(VoltaSpan {
                x_left,
                x_right,
                is_open,
                color: color.to_string(),
                label,
                local_bracket_y,
                measure_index: ml.resolved.index,
            });
        }
    }

    // Treat all alternate-ending brackets as a single skyline item so they align
    // to the same Y elevation within the system.
    let shared_bracket_y = spans
        .iter()
        .map(|s| s.local_bracket_y)
        .fold(default_bracket_y, f64::min);

    for span in &spans {
        let bracket_y = shared_bracket_y;
        let color = span.color.as_str();
        let cmd_start = dl.commands.len();

        // Left vertical hook (always drawn)
        dl.push(RenderCommand::DrawLine {
            x1: span.x_left,
            y1: bracket_y,
            x2: span.x_left,
            y2: bracket_y + hook_length,
            width: line_width,
            color: color.into(),
        });

        // Horizontal line across top
        dl.push(RenderCommand::DrawLine {
            // Overlap each hook by half a stroke so antialiasing cannot leave
            // a pinhole where two centerline-terminated strokes meet.
            x1: span.x_left - line_width * 0.5,
            y1: bracket_y,
            x2: span.x_right + line_width * 0.5,
            y2: bracket_y,
            width: line_width,
            color: color.into(),
        });

        // Right vertical hook (only for closed endings)
        if !span.is_open {
            dl.push(RenderCommand::DrawLine {
                x1: span.x_right,
                y1: bracket_y,
                x2: span.x_right,
                y2: bracket_y + hook_length,
                width: line_width,
                color: color.into(),
            });
        }

        // Number label (e.g., "1.", "2.", "1, 2.")
        dl.push(RenderCommand::DrawText {
            x: span.x_left + text_x_offset,
            y: bracket_y + text_y_offset,
            text: span.label.clone(),
            font: "serif bold".into(),
            size: text_size,
            color: color.into(),
            align: TextAlign::Left,
            baseline: TextBaseline::Top,
        });

        // Tag all commands for this volta bracket with a structured element ID
        let eid = element_id::volta(span.measure_index);
        let cmd_end = dl.commands.len();
        for ci in cmd_start..cmd_end {
            dl.tag_command(ci, eid.clone());
        }

        // Bounding box for the volta bracket
        let bbox_w = span.x_right - span.x_left;
        let bbox_top = bracket_y - line_width * 0.5;
        let bbox_h = hook_length.max(text_y_offset + text_size) + line_width;
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: element_id::volta(span.measure_index),
            bbox: BoundingBox::new(
                span.x_left - line_width * 0.5,
                bbox_top,
                bbox_w + line_width,
                bbox_h,
            ),
        });
    }
}

/// Render ottava lines (8va, 15ma, 8vb, etc.) above or below the staff.
///
/// Ottavas span from a rhythmic position in one measure to a rhythmic position
/// in another (or the same) measure. Renders: SMuFL glyph label at the start,
/// a dashed horizontal line, and a short vertical hook at the end.
/// The Y position is adjusted to avoid colliding with notes under the ottava.
pub(crate) fn render_ottavas(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    part_index: usize,
) {
    let line_width = 0.16 * sp; // Bravura engravingDefaults.octaveLineThickness
    let hook_length = 1.0 * sp;
    let dash_length = 0.8 * sp;
    let gap_length = 0.5 * sp;
    let glyph_size = 3.0 * sp; // large enough to match reference proportions
                               // Scale factor: glyph rendered at glyph_size, but smufl widths assume 4sp (1em)
    let glyph_scale = glyph_size / (4.0 * sp);
    // Glyph ascent: top of glyph above the baseline (from Bravura metadata)
    let glyph_ascent = 1.852 * glyph_scale * sp;
    // Minimum clearance between ottava glyph bottom and note extremes
    let min_clearance = 1.0 * sp;
    // Default positions when no notes need avoidance
    let default_above_y = staff_y - 1.5 * sp - glyph_ascent;
    let default_below_y = staff_y + 4.0 * sp + 2.0 * sp;
    // Stem length in half-spaces (3.5sp = 7 half-spaces)
    let stem_half_spaces: f64 = 7.0;

    // Build measure ID → index map
    let mut measure_id_map: HashMap<String, usize> = HashMap::new();
    for (i, ml) in measure_layouts.iter().enumerate() {
        if let Some(ref id) = ml.resolved.global.id {
            measure_id_map.insert(id.clone(), i);
        }
    }

    for (start_mi, ml) in measure_layouts.iter().enumerate() {
        let ottavas = match &ml.resolved.part.ottavas {
            Some(o) if !o.is_empty() => o,
            _ => continue,
        };

        let total_beats = ml.resolved.active_time.measure_beats();
        let content_width = super::render_barlines::rhythmic_content_width(ml, sp);
        let x_origin = ml.x + ml.prefix_width;
        let measure_idx = ml.resolved.index;

        for (oi, ott) in ottavas.iter().enumerate() {
            let above = match ott.orient {
                Some(crate::model::Orientation::Above) => true,
                Some(crate::model::Orientation::Below) => false,
                _ => ott.value > 0,
            };

            // Get SMuFL glyph and its width (scaled to actual render size)
            let (codepoint, glyph_width_sp) = smufl::ottava_glyph(ott.value);
            let glyph_width = glyph_width_sp * sp * glyph_scale;

            // Compute start x: try to align with the actual note at this beat position
            let start_beat = ott.position.beats();
            // Look up the nearest event's X position for alignment
            let start_x = {
                let proportional_x = x_origin + (start_beat / total_beats) * content_width;
                // Only snap to an event if it's within a small beat tolerance
                let snap_tolerance = 0.1;
                let mut best_x = proportional_x;
                let mut best_dist = snap_tolerance;
                for vl in &ml.voice_layouts {
                    if vl.is_centered_bar_rest(total_beats) {
                        continue;
                    }
                    let mut beat_cursor = 0.0_f64;
                    for el in 0..vl.events.len() {
                        let dist = (beat_cursor - start_beat).abs();
                        if dist < best_dist {
                            best_dist = dist;
                            best_x = vl.events.x(el);
                        }
                        beat_cursor += vl.events.event(el).duration.total_beats();
                    }
                }
                best_x
            };

            // Compute end x from measure-rhythmic-position
            let end_mi = measure_id_map
                .get(&ott.end.measure)
                .copied()
                .unwrap_or(start_mi);
            let end_ml = &measure_layouts[end_mi];
            let end_total_beats = end_ml.resolved.active_time.measure_beats();
            let end_content_width = super::render_barlines::rhythmic_content_width(end_ml, sp);
            let end_x_origin = end_ml.x + end_ml.prefix_width;
            let end_beat = ott.end.position.beats();
            let end_x = end_x_origin + (end_beat / end_total_beats) * end_content_width;

            // Collision avoidance: scan note positions in spanned measures
            let ottava_y = compute_ottava_y(
                measure_layouts,
                start_mi,
                end_mi,
                start_x,
                end_x,
                staff_y,
                sp,
                above,
                stem_half_spaces,
                min_clearance,
                default_above_y,
                default_below_y,
                glyph_ascent,
            );

            // Element ID for hit-testing / selection
            let eid = element_id::ottava(ml.part_index, ml.resolved.index, oi);

            // Draw SMuFL glyph — left-aligned with the note's X position
            let cmd_idx = dl.commands.len();
            dl.push(RenderCommand::DrawGlyph {
                x: start_x,
                y: ottava_y, // baseline of glyph
                codepoint,
                font: "Bravura".into(),
                size: glyph_size,
                color: "#000000".into(),
                rotation: 0.0,
            });

            // Dashed line position:
            // - Above staff: line at the TOP of the glyph (above baseline)
            // - Below staff: line at the BOTTOM, below the baseline
            let line_y = if above {
                ottava_y - glyph_ascent
            } else {
                ottava_y + 0.3 * sp // small gap below baseline for below-staff line
            };
            let dash_start_x = start_x + glyph_width + 0.3 * sp;

            // Draw dashed horizontal line from after glyph to end
            if end_x > dash_start_x {
                let mut cx = dash_start_x;
                while cx < end_x {
                    let seg_end = (cx + dash_length).min(end_x);
                    dl.push(RenderCommand::DrawLine {
                        x1: cx,
                        y1: line_y,
                        x2: seg_end,
                        y2: line_y,
                        width: line_width,
                        color: "#000000".into(),
                    });
                    cx += dash_length + gap_length;
                }
            }

            // Draw vertical hook at the end
            let hook_dir = if above { 1.0 } else { -1.0 };
            dl.push(RenderCommand::DrawLine {
                x1: end_x,
                y1: line_y,
                x2: end_x,
                y2: line_y + hook_length * hook_dir,
                width: line_width,
                color: "#000000".into(),
            });
            for ci in cmd_idx..dl.commands.len() {
                dl.tag_command(ci, eid.clone());
            }

            // Bounding box for the ottava spanner
            let bbox_x = start_x.min(end_x);
            let bbox_w = (end_x - start_x).abs();
            let bbox_top = if above {
                line_y
            } else {
                ottava_y - glyph_ascent
            };
            let bbox_bottom = if above {
                ottava_y
            } else {
                line_y + hook_length
            };
            let bbox_h = (bbox_bottom - bbox_top).abs().max(glyph_ascent);
            dl.push_element_bbox_with_shape(ElementBBox {
                element_id: element_id::ottava(part_index, measure_idx, oi),
                bbox: BoundingBox::new(bbox_x, bbox_top, bbox_w, bbox_h),
            });
        }
    }
}

/// Compute the Y position for an ottava line, avoiding collisions with notes.
///
/// Scans all note positions in the spanned measures and adjusts the Y coordinate
/// so the ottava line clears the most extreme notes (including stems).
fn compute_ottava_y(
    measure_layouts: &[MeasureLayout],
    start_mi: usize,
    end_mi: usize,
    start_x: f64,
    end_x: f64,
    staff_y: f64,
    sp: f64,
    above: bool,
    stem_half_spaces: f64,
    min_clearance: f64,
    default_above_y: f64,
    default_below_y: f64,
    glyph_ascent: f64,
) -> f64 {
    // Scan note positions in all measures spanned by this ottava
    let mi_lo = start_mi.min(end_mi);
    let mi_hi = start_mi.max(end_mi);

    if above {
        // Find the highest point (smallest Y) of notes+stems in the range
        let mut min_y = default_above_y + min_clearance; // sentinel
        let hi = mi_hi.min(measure_layouts.len() - 1);
        for ml in &measure_layouts[mi_lo..=hi] {
            for vl in &ml.voice_layouts {
                for i in 0..vl.events.len() {
                    // Only consider events within the ottava's x range
                    let ex = vl.events.x(i);
                    if ex < start_x - sp || ex > end_x + sp {
                        continue;
                    }
                    let stem_up = vl.events.stem_up(i);
                    for &pos in vl.events.note_positions(i) {
                        let note_y = staff_y + pos * sp * 0.5;
                        // Account for stem tip if stem goes up
                        let extreme_y = if stem_up {
                            note_y - stem_half_spaces * sp * 0.5
                        } else {
                            note_y
                        };
                        if extreme_y < min_y {
                            min_y = extreme_y;
                        }
                    }
                }
            }
        }
        // Place ottava above the highest point with clearance
        let candidate = min_y - min_clearance;
        candidate.min(default_above_y)
    } else {
        // Find the lowest point (largest Y) of notes+stems in the range
        let mut max_y = default_below_y - min_clearance; // sentinel
        let hi = mi_hi.min(measure_layouts.len() - 1);
        for ml in &measure_layouts[mi_lo..=hi] {
            for vl in &ml.voice_layouts {
                for i in 0..vl.events.len() {
                    let ex = vl.events.x(i);
                    if ex < start_x - sp || ex > end_x + sp {
                        continue;
                    }
                    let stem_up = vl.events.stem_up(i);
                    for &pos in vl.events.note_positions(i) {
                        let note_y = staff_y + pos * sp * 0.5;
                        // Account for stem tip if stem goes down
                        let extreme_y = if !stem_up {
                            note_y + stem_half_spaces * sp * 0.5
                        } else {
                            note_y
                        };
                        if extreme_y > max_y {
                            max_y = extreme_y;
                        }
                    }
                }
            }
        }
        // Place ottava below the lowest point with clearance.
        // The glyph ascent extends above the baseline, so we need to account for it:
        // baseline must be far enough below that the top of the glyph clears the notes.
        let candidate = max_y + min_clearance + glyph_ascent;
        candidate.max(default_below_y)
    }
}
