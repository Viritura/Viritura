//! Piano pedal markings rendering — "Ped/*" text style and bracket style.

use super::config::LayoutConfig;
use super::element_id;
use super::text_styles::TextRole;
use super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashMap;

/// Render piano pedal markings below the staff.
///
/// Pedals span from a rhythmic position in one measure to a rhythmic position
/// in another (or the same) measure. Two visual styles are supported:
/// - **Text**: SMuFL "Ped" glyph at start, "*" glyph at release
/// - **Bracket**: horizontal line with down-hooks at start and end, notches for pedal changes
///
/// Positioned below dynamics and hairpins.
pub(crate) fn render_pedals(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    part_index: usize,
) {
    let staff_bottom = staff_y + 4.0 * sp;

    // Build measure ID → index map
    let mut measure_id_map: HashMap<String, usize> = HashMap::new();
    for (i, ml) in measure_layouts.iter().enumerate() {
        if let Some(ref id) = ml.resolved.global.id {
            measure_id_map.insert(id.clone(), i);
        }
    }

    for (start_mi, ml) in measure_layouts.iter().enumerate() {
        let pedals = match &ml.resolved.part.pedals {
            Some(p) if !p.is_empty() => p,
            _ => continue,
        };

        let total_beats = ml.resolved.active_time.measure_beats();
        let content_width = super::render_barlines::rhythmic_content_width(ml, sp);
        let x_origin = ml.x + ml.prefix_width;
        let measure_idx = ml.resolved.index;

        for (pi, ped) in pedals.iter().enumerate() {
            // Compute start x
            let start_beat = ped.position.beats();
            let start_x = find_event_x(ml, x_origin, content_width, total_beats, start_beat);

            // Compute end x from measure-rhythmic-position
            let end_mi = measure_id_map
                .get(&ped.end.measure)
                .copied()
                .unwrap_or(start_mi);
            let end_ml = &measure_layouts[end_mi];
            let end_total_beats = end_ml.resolved.active_time.measure_beats();
            let end_content_width = super::render_barlines::rhythmic_content_width(end_ml, sp);
            let end_x_origin = end_ml.x + end_ml.prefix_width;
            let end_beat = ped.end.position.beats();
            let end_x = find_event_x(
                end_ml,
                end_x_origin,
                end_content_width,
                end_total_beats,
                end_beat,
            );

            // Compute Y position: below staff, below dynamics/hairpins
            let pedal_y = compute_pedal_y(
                measure_layouts,
                start_mi,
                end_mi,
                start_x,
                end_x,
                staff_y,
                sp,
                config,
                staff_bottom,
                dl,
            );

            let style = ped.style.as_ref().unwrap_or(&PedalLineStyle::Text);

            // Element ID for hit-testing / selection
            let eid = element_id::pedal(ml.part_index, ml.resolved.index, pi);

            let cmd_idx = dl.commands.len();
            match style {
                PedalLineStyle::Text => {
                    render_text_pedal(dl, &ped.pedal_type, start_x, end_x, pedal_y, sp, config);
                }
                PedalLineStyle::Bracket => {
                    render_bracket_pedal(dl, start_x, end_x, pedal_y, sp, config);
                }
            }
            for ci in cmd_idx..dl.commands.len() {
                dl.tag_command(ci, eid.clone());
            }

            // Bounding box for the pedal spanner
            let bbox_x = start_x.min(end_x);
            let bbox_w = (end_x - start_x).abs();
            let glyph_height = 1.8 * sp; // approximate glyph height
            let bbox_y = pedal_y - glyph_height;
            let bbox_h = glyph_height
                + match style {
                    PedalLineStyle::Bracket => config.pedal_hook_height * sp,
                    PedalLineStyle::Text => 0.5 * sp,
                };
            dl.push_element_bbox_with_shape(ElementBBox {
                element_id: element_id::pedal(part_index, measure_idx, pi),
                bbox: BoundingBox::new(bbox_x, bbox_y, bbox_w, bbox_h),
            });
        }
    }
}

/// Render text-style pedal: "Ped"/"Sost" glyph at start, "*" glyph at end.
/// For una corda, renders italic text "una corda" / "tre corde" instead.
fn render_text_pedal(
    dl: &mut DisplayList,
    pedal_type: &PedalType,
    start_x: f64,
    end_x: f64,
    y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    // SMuFL convention: glyphs are designed at 4*sp (1 staff space = 0.25 em).
    let font_size = 4.0 * sp;

    if matches!(pedal_type, PedalType::UnaCorda) {
        // Una corda uses text (no SMuFL glyph exists), styled via the
        // PedalText role (italic serif by default). The resolved font string
        // round-trips through binary encoding so the canvas applies the slant.
        let style = config.text_styles.resolve(TextRole::PedalText);
        let text_size = style.size_px(sp);
        let font = style.font_string();
        let color = style.color.clone();
        dl.push(RenderCommand::DrawText {
            x: start_x,
            y,
            text: "una corda".into(),
            font: font.clone(),
            size: text_size,
            color: color.clone(),
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
        });
        dl.push(RenderCommand::DrawText {
            x: end_x,
            y,
            text: "tre corde".into(),
            font,
            size: text_size,
            color,
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
        });
        return;
    }

    // Start glyph: "Ped" or "Sost"
    let (start_glyph, _) = smufl::pedal_start_glyph(pedal_type);
    dl.push(RenderCommand::DrawGlyph {
        x: start_x,
        y,
        codepoint: start_glyph,
        size: font_size,
        color: "#000000".into(),
        font: "Bravura".into(),
        rotation: 0.0,
    });

    // End glyph: "*" (release)
    dl.push(RenderCommand::DrawGlyph {
        x: end_x,
        y,
        codepoint: smufl::KEYBOARD_PEDAL_UP,
        size: font_size,
        color: "#000000".into(),
        font: "Bravura".into(),
        rotation: 0.0,
    });
}

/// Render bracket-style pedal: horizontal line with hooks at start and end.
fn render_bracket_pedal(
    dl: &mut DisplayList,
    start_x: f64,
    end_x: f64,
    y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let line_width = config.pedal_line_width * sp;
    let hook_h = config.pedal_hook_height * sp;

    // Start hook (down from line to baseline)
    dl.push(RenderCommand::DrawLine {
        x1: start_x,
        y1: y - hook_h,
        x2: start_x,
        y2: y,
        width: line_width,
        color: "#000000".into(),
    });

    // Horizontal line
    dl.push(RenderCommand::DrawLine {
        x1: start_x,
        y1: y,
        x2: end_x,
        y2: y,
        width: line_width,
        color: "#000000".into(),
    });

    // End hook (up from baseline)
    dl.push(RenderCommand::DrawLine {
        x1: end_x,
        y1: y,
        x2: end_x,
        y2: y - hook_h,
        width: line_width,
        color: "#000000".into(),
    });
}

/// Find the x coordinate for a beat position, snapping to the nearest event.
fn find_event_x(
    ml: &MeasureLayout,
    x_origin: f64,
    content_width: f64,
    total_beats: f64,
    target_beat: f64,
) -> f64 {
    let proportional_x = x_origin + (target_beat / total_beats) * content_width;

    // Only snap to an event if it's within a small beat tolerance
    let snap_tolerance = 0.1;
    let mut best_x = proportional_x;
    let mut best_dist = snap_tolerance;

    for vl in &ml.voice_layouts {
        if vl.is_centered_bar_rest(total_beats) {
            continue;
        }
        let mut beat_cursor = 0.0_f64;
        for i in 0..vl.events.len() {
            let dist = (beat_cursor - target_beat).abs();
            if dist < best_dist {
                best_dist = dist;
                best_x = vl.events.x(i);
            }
            beat_cursor += vl.events.event(i).duration.total_beats();
        }
    }
    best_x
}

/// Compute the Y position for a pedal marking, below dynamics and hairpins.
fn compute_pedal_y(
    measure_layouts: &[MeasureLayout],
    start_mi: usize,
    end_mi: usize,
    start_x: f64,
    end_x: f64,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    staff_bottom: f64,
    dl: &DisplayList,
) -> f64 {
    let stem_length = config.stem_length;
    let mi_lo = start_mi.min(end_mi);
    let mi_hi = start_mi.max(end_mi);

    // Find the lowest point of notes/stems below the staff
    let mut lowest_y = staff_bottom;
    let hi = mi_hi.min(measure_layouts.len() - 1);
    for ml in &measure_layouts[mi_lo..=hi] {
        for vl in &ml.voice_layouts {
            for i in 0..vl.events.len() {
                let ex = vl.events.x(i);
                if ex < start_x - sp || ex > end_x + sp {
                    continue;
                }
                let note_positions = vl.events.note_positions(i);
                for &pos in note_positions {
                    let note_y = staff_y + pos * sp * 0.5;
                    if note_y > lowest_y {
                        lowest_y = note_y;
                    }
                }
                // Check down-stem tips
                if !vl.events.stem_up(i) && !note_positions.is_empty() {
                    let bottom_pos = note_positions
                        .iter()
                        .copied()
                        .fold(f64::NEG_INFINITY, f64::max);
                    let tip_y = staff_y + bottom_pos * sp * 0.5 + stem_length * sp;
                    if tip_y > lowest_y {
                        lowest_y = tip_y;
                    }
                }
            }
        }
    }

    // Skyline pass: pedals sit below dynamics + hairpins by convention, so
    // include both as obstacles. Skip the note-cluster-core substrate that the
    // note/stem walk above already bounded (see `is_note_cluster_core`), plus
    // the connectors a pedal must not read: peer pedals, slurs (a pedal tucks
    // under a slur), ties, and voltas. Tremolos and below-staff
    // articulations/dynamics remain real obstacles.
    let exclude_connectors = [
        ElementKind::Pedal,
        ElementKind::Slur,
        ElementKind::Tie,
        ElementKind::Volta,
    ];
    if let Some(sky_bot) = dl.skyline_bottom(start_x - sp, end_x + sp, staff_bottom, |k| {
        !k.is_note_cluster_core() && !exclude_connectors.contains(&k)
    }) {
        if sky_bot > lowest_y {
            lowest_y = sky_bot;
        }
    }

    // Position pedal below the lowest element with extra clearance (below dynamics/hairpins)
    let min_y = staff_bottom + config.pedal_min_distance * sp;
    let clearance = 1.5 * sp;
    min_y.max(lowest_y + clearance)
}
