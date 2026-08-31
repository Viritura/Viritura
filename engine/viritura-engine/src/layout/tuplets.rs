//! Tuplet bracket rendering.

use super::config::LayoutConfig;
use super::element_id;
use super::types::*;
use crate::render::smufl::smufl;
use crate::render::*;

// ═══════════════════════════════════════════
// Tuplet bracket and number rendering
// ═══════════════════════════════════════════

/// Render tuplet brackets and numbers for a measure.
///
/// For each tuplet group, draws a bracket (two short vertical lines connected
/// by a horizontal line) above or below the group, with the tuplet number
/// (e.g., "3") centered on the bracket using the SMuFL tuplet glyph.
/// Bracket placement follows stem direction: above for stems-up, below for stems-down.
///
/// Display is controlled by MNX properties:
/// - `bracket`: yes/no/auto — whether to draw the bracket lines
/// - `showNumber`: inner/both/noNumber — what number text to show
/// - `showValue`: inner/both/noNumber — not yet rendered (reserved)
///
/// standard engraving practice — bracket + number placement.
///
/// Returns the bracket extent boxes `(left, right, top, bottom)` for every
/// group drawn, so a later pass (e.g. dynamics placement) can treat the bracket
/// as an obstacle and clear it.
#[allow(clippy::too_many_lines)] // single tuplet-bracket render pass; cohesive pipeline stage
pub(crate) fn render_tuplet_brackets(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    artic_boxes: &[super::render_annotations::ArticBox],
    staff_y_offsets: Option<&[f64]>,
) -> Vec<super::render_annotations::ArticBox> {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let bracket_offset = 1.5 * sp; // distance from outermost note to bracket
    let hook_length = 0.5 * sp; // short vertical lines at bracket ends
    let bracket_line_width = 0.16 * sp; // Bravura engravingDefaults.tupletBracketThickness
    let glyph_size = 4.0 * sp;
    let mut bracket_boxes: Vec<super::render_annotations::ArticBox> = Vec::new();

    for vl in &ml.voice_layouts {
        // Most voices carry no tuplets — skip the whole-voice materialization
        // entirely for them (the readers below index `events` only within a
        // tuplet group's range).
        if vl.tuplet_groups.is_empty() {
            continue;
        }
        let events: Vec<EventLayout> = (0..vl.events.len())
            .map(|i| vl.events.to_event_layout(i))
            .collect();
        for (tuplet_idx, tg) in vl.tuplet_groups.iter().enumerate() {
            if tg.first_event_idx >= events.len() || tg.last_event_idx >= events.len() {
                continue;
            }

            // Skip entirely if both bracket and number are hidden
            if !tg.show_bracket && tg.show_number == TupletShowNumber::None {
                continue;
            }

            let first_ev = &events[tg.first_event_idx];
            let last_ev = &events[tg.last_event_idx];

            // Record command index before rendering for element ID tagging
            let cmd_start = dl.commands.len();

            // Determine bracket side: orient override > stem side.
            // Standard engraving practice: the tuplet bracket/number sits on the
            // STEM side (the beam side for beamed groups) — above when the
            // majority of stems point up, below when they point down.
            let auto_bracket_above = || {
                let stems_up_count = (tg.first_event_idx..=tg.last_event_idx)
                    .filter(|&i| events[i].stem_up)
                    .count();
                let total = tg.last_event_idx - tg.first_event_idx + 1;
                // Ties (equal up/down) resolve above, matching beam convention.
                stems_up_count * 2 >= total
            };
            let bracket_above = if let Some(orient) = tg.orient {
                use crate::model::Orientation;
                match orient {
                    Orientation::Above => true,
                    Orientation::Below => false,
                    Orientation::Auto => auto_bracket_above(),
                }
            } else {
                auto_bracket_above()
            };

            // Find extreme Y positions across all events in the tuplet group.
            // Cross-staff events are relocated to their target staff's Y, so the
            // bracket/number follows the beam into the gap instead of floating
            // on the sequence's home staff. We also carry the effective staff_y
            // of the event that set the extreme, so the staff-body clamp below
            // references the correct staff.
            let (extreme_y, ext_staff_y) = (tg.first_event_idx..=tg.last_event_idx).fold(
                (
                    if bracket_above {
                        f64::INFINITY
                    } else {
                        f64::NEG_INFINITY
                    },
                    staff_y,
                ),
                |(ext, ext_sy), i| {
                    let el = &events[i];
                    let eff_y = super::render_measure::cross_staff_y(el, staff_y, staff_y_offsets);
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

                    if bracket_above {
                        let stem_tip_y = eff_y + top_pos * sp * 0.5 - config.stem_length * sp;
                        let note_y = eff_y + top_pos * sp * 0.5;
                        let candidate = if el.stem_up { stem_tip_y } else { note_y };
                        if candidate < ext {
                            (candidate, eff_y)
                        } else {
                            (ext, ext_sy)
                        }
                    } else {
                        let stem_tip_y = eff_y + bottom_pos * sp * 0.5 + config.stem_length * sp;
                        let note_y = eff_y + bottom_pos * sp * 0.5;
                        let candidate = if !el.stem_up { stem_tip_y } else { note_y };
                        if candidate > ext {
                            (candidate, eff_y)
                        } else {
                            (ext, ext_sy)
                        }
                    }
                },
            );

            // Bracket horizontal span (also bounds the articulation scan below).
            let x_left = first_ev.x;
            let x_right = last_ev.x + notehead_w;

            // Fold in articulation glyphs on the bracket side. Standard
            // engraving practice: the tuplet bracket clears articulations
            // (accents, staccatos, marcatos, etc.) on the stem/beam side, so
            // an articulation under a stems-up group (or above a stems-down
            // group) must push the bracket farther out rather than collide.
            let extreme_y = artic_boxes
                .iter()
                .filter(|(left, right, _, _)| *left <= x_right && *right >= x_left)
                .fold(extreme_y, |ext, (_, _, top, bottom)| {
                    if bracket_above {
                        ext.min(*top)
                    } else {
                        ext.max(*bottom)
                    }
                });

            // Bracket Y position offset from extreme. The bracket/number must
            // always clear the staff body: if stem-side placement would land the
            // bracket within the staff (e.g. short stems with noteheads inside
            // the staff), push it just outside the nearest staff line. Standard
            // engraving practice: tuplet numbers are never set inside the staff.
            // For cross-staff groups this references the *effective* staff the
            // events were relocated to (`ext_staff_y`), not the home staff.
            let staff_top = ext_staff_y;
            let staff_bottom = ext_staff_y + 4.0 * sp;
            let bracket_y = if bracket_above {
                (extreme_y - bracket_offset).min(staff_top - bracket_offset)
            } else {
                (extreme_y + bracket_offset).max(staff_bottom + bracket_offset)
            };

            // Record the bracket's vertical extent as an obstacle box. The
            // number glyph is centred on the bracket line, so the box spans the
            // line plus the number's half-height (and the end hooks). A later
            // dynamics pass uses this to keep dynamics clear of the bracket.
            let bracket_half = 0.8 * sp;
            bracket_boxes.push((
                x_left,
                x_right,
                bracket_y - bracket_half,
                bracket_y + bracket_half,
            ));

            // Determine number text width for gap calculation. The bracket
            // breaks around the number, so the gap must scale with the actual
            // composed width — a multi-digit figure like "17" is wider than a
            // single digit and would otherwise be crossed by the bracket line.
            let number_glyphs = match tg.show_number {
                TupletShowNumber::Inner => tuplet_digits(tg.display_number),
                TupletShowNumber::Both => tuplet_ratio_glyphs(tg.display_number, tg.outer_number),
                TupletShowNumber::None => Vec::new(),
            };
            let has_number = !number_glyphs.is_empty();
            let number_gap = if has_number {
                tuplet_glyphs_half_width(&number_glyphs, glyph_size) + 0.2 * sp
            } else {
                0.0
            };
            let center_x = (x_left + x_right) / 2.0;

            // Horizontal anchor for the NUMBER. With a bracket, the digit sits
            // in the bracket gap, so it is centred on the bracket span (the
            // notehead extent above). Without a bracket — the common beamed
            // tuplet — standard engraving practice centres the digit on the
            // BEAM, which spans the stem positions, not the noteheads. For a
            // stem-up group the stems sit at the noteheads' right edge, so the
            // notehead-span midpoint lands ~half a notehead left of the beam
            // centre (and a stem-down group is shifted the other way). Centre on
            // the stem-span midpoint so the digit is optically under the beam.
            let number_center_x = if tg.show_bracket {
                center_x
            } else {
                let stem_w = config.stem_width * sp;
                let stem_x = |ev: &EventLayout| {
                    if ev.stem_up {
                        ev.x + smufl::STEM_UP_SE.0 * sp - stem_w * 0.5
                    } else {
                        ev.x + smufl::STEM_DOWN_NW.0 * sp + stem_w * 0.5
                    }
                };
                (stem_x(first_ev) + stem_x(last_ev)) / 2.0
            };

            // Draw bracket lines only if bracket is shown
            if tg.show_bracket {
                // Draw left hook (short vertical line)
                let hook_dir = if bracket_above { 1.0 } else { -1.0 };
                dl.push(RenderCommand::DrawLine {
                    x1: x_left,
                    y1: bracket_y,
                    x2: x_left,
                    y2: bracket_y + hook_dir * hook_length,
                    width: bracket_line_width,
                    color: "#000000".into(),
                });

                // Draw right hook
                dl.push(RenderCommand::DrawLine {
                    x1: x_right,
                    y1: bracket_y,
                    x2: x_right,
                    y2: bracket_y + hook_dir * hook_length,
                    width: bracket_line_width,
                    color: "#000000".into(),
                });

                // Draw horizontal line (left segment, stopping before number gap)
                if has_number {
                    if center_x - number_gap > x_left {
                        dl.push(RenderCommand::DrawLine {
                            x1: x_left,
                            y1: bracket_y,
                            x2: center_x - number_gap,
                            y2: bracket_y,
                            width: bracket_line_width,
                            color: "#000000".into(),
                        });
                    }
                    if center_x + number_gap < x_right {
                        dl.push(RenderCommand::DrawLine {
                            x1: center_x + number_gap,
                            y1: bracket_y,
                            x2: x_right,
                            y2: bracket_y,
                            width: bracket_line_width,
                            color: "#000000".into(),
                        });
                    }
                } else {
                    // No number: draw a single continuous horizontal line
                    dl.push(RenderCommand::DrawLine {
                        x1: x_left,
                        y1: bracket_y,
                        x2: x_right,
                        y2: bracket_y,
                        width: bracket_line_width,
                        color: "#000000".into(),
                    });
                }
            }

            // Render the tuplet number
            if has_number {
                render_tuplet_glyphs(dl, &number_glyphs, number_center_x, bracket_y, glyph_size);
            }

            // Tag all commands produced by this tuplet with a structured element ID
            let cmd_end = dl.commands.len();
            if cmd_end > cmd_start {
                let eid = element_id::tuplet(
                    vl.part_index_override.unwrap_or(ml.part_index),
                    ml.resolved.index,
                    vl.seq_index_override.unwrap_or(vl.voice_index),
                    tuplet_idx,
                );
                for ci in cmd_start..cmd_end {
                    dl.tag_command(ci, eid.clone());
                }
                // Publish a precise selection/hit box. Without this the editor
                // falls back to a crude per-command approximation (a square
                // around the glyph's draw origin) and, for a multi-command
                // bracketed tuplet, only the FIRST command — both inaccurate.
                // The union of the actual drawn ink (bracket lines + number
                // glyph/text, ink-tight) is the true clickable extent.
                if let Some(bbox) = tuplet_commands_bbox(dl, cmd_start, cmd_end) {
                    dl.push_element_bbox_with_shape(ElementBBox {
                        element_id: eid,
                        bbox,
                    });
                }
            }
        }
    }
    bracket_boxes
}

/// Union of the ink extents of the tuplet commands in `dl.commands[start..end]`
/// (bracket lines + number glyph/text), or `None` when the range is empty. The
/// number glyph uses its tight SMuFL ink bbox (not the em square) so the
/// selection box hugs the digit. This is the precise click box the editor reads
/// from `element_bboxes`.
fn tuplet_commands_bbox(dl: &DisplayList, start: usize, end: usize) -> Option<BoundingBox> {
    let mut acc: Option<BoundingBox> = None;
    let mut fold = |b: BoundingBox| {
        acc = Some(match acc.take() {
            Some(prev) => prev.union(&b),
            None => b,
        });
    };
    for cmd in &dl.commands[start..end] {
        match cmd {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } => {
                fold(super::render_geometry::glyph_pixel_bbox(
                    *x, *y, *codepoint, *size,
                ));
            }
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } => {
                let hw = width * 0.5;
                fold(BoundingBox::new(
                    x1.min(*x2) - hw,
                    y1.min(*y2) - hw,
                    (x1 - x2).abs() + width,
                    (y1 - y2).abs() + width,
                ));
            }
            RenderCommand::DrawText {
                x,
                y,
                text,
                size,
                align,
                ..
            } => {
                // Bravura ratio text ("3:2"), centred, Middle baseline.
                let w = text.chars().count() as f64 * 0.5 * size;
                let left = match align {
                    TextAlign::Center => x - w * 0.5,
                    TextAlign::Right => x - w,
                    TextAlign::Left => *x,
                };
                fold(BoundingBox::new(left, y - size * 0.5, w, *size));
            }
            _ => {}
        }
    }
    acc
}

/// Render a tuplet number or ratio glyph sequence at the given position.
fn render_tuplet_glyphs(
    dl: &mut DisplayList,
    glyphs: &[u32],
    center_x: f64,
    bracket_y: f64,
    glyph_size: f64,
) {
    // Compose the number from the SMuFL tuplet-digit glyphs (U+E880–E889) for
    // any number of digits. A multi-digit figure like "17" is laid out by
    // setting each digit glyph side by side, so it uses the same musical
    // figures as a single-digit tuplet rather than falling back to a text font.
    //
    // SMuFL glyph metrics are in staff-space units relative to an em of 4 staff
    // spaces, so `glyph_size / 4.0` converts them to canvas units.
    let scale = glyph_size / 4.0;

    // Accumulate the total ink width (sum of each glyph's bbox width plus the
    // gaps between them) so the composite can be centred on `center_x`.
    let total_w = tuplet_glyphs_width(glyphs);

    // Shared vertical origin so all digits sit on a common baseline and the
    // composite's vertical mid-height lands on `bracket_y` (the bracket line
    // then passes through the middle of the number). `min_by` is the highest
    // ink top across the digits and `max_bot` the lowest ink bottom.
    let min_by = glyphs
        .iter()
        .map(|&cp| smufl::glyph_bbox(cp).1)
        .fold(f64::INFINITY, f64::min);
    let max_bot = glyphs
        .iter()
        .map(|&cp| {
            let (_, by, _, bh) = smufl::glyph_bbox(cp);
            by + bh
        })
        .fold(f64::NEG_INFINITY, f64::max);
    let origin_y = bracket_y - (min_by + max_bot) / 2.0 * scale;

    // Pen starts at the left ink edge of the centred composite.
    let mut pen_x = center_x - total_w * scale / 2.0;
    for &cp in glyphs {
        let (bx, _by, bw, _bh) = smufl::glyph_bbox(cp);
        // Offset the glyph origin so its left ink edge lands at `pen_x`.
        let x = pen_x - bx * scale;
        dl.push(RenderCommand::DrawGlyph {
            x,
            y: origin_y,
            codepoint: cp,
            font: "Bravura".into(),
            size: glyph_size,
            color: "#000000".into(),
            rotation: 0.0,
        });
        pen_x += (bw + TUPLET_GLYPH_GAP) * scale;
    }
}

/// Inter-digit gap (staff spaces) used when composing a multi-digit tuplet
/// number. SMuFL tuplet digits carry minimal side bearings, so a small tracking
/// value keeps adjacent figures from touching.
const TUPLET_GLYPH_GAP: f64 = 0.08;

/// The SMuFL tuplet-digit glyphs (U+E880–E889) spelling out `number`.
fn tuplet_digits(number: u32) -> Vec<u32> {
    number
        .to_string()
        .bytes()
        .map(|b| smufl::tuplet_digit(u32::from(b - b'0')))
        .collect()
}

fn tuplet_ratio_glyphs(inner: u32, outer: u32) -> Vec<u32> {
    let mut glyphs = tuplet_digits(inner);
    glyphs.push(smufl::TUPLET_COLON);
    glyphs.extend(tuplet_digits(outer));
    glyphs
}

/// Total ink width (staff spaces) of a composed tuplet number: the sum of each
/// digit glyph's bbox width plus the gaps between adjacent digits.
fn tuplet_glyphs_width(glyphs: &[u32]) -> f64 {
    glyphs
        .iter()
        .map(|&cp| smufl::glyph_bbox(cp).2)
        .sum::<f64>()
        + TUPLET_GLYPH_GAP * (glyphs.len().saturating_sub(1)) as f64
}

/// Half the composed width (canvas units) of the tuplet number, used to size
/// the bracket gap so the bracket line breaks cleanly around the figures.
fn tuplet_glyphs_half_width(glyphs: &[u32], glyph_size: f64) -> f64 {
    let scale = glyph_size / 4.0;
    tuplet_glyphs_width(glyphs) * scale / 2.0
}
