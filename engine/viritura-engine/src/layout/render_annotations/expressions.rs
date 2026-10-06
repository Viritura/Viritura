use super::super::config::LayoutConfig;
use super::super::dependent_stacking::{self, StackBox, StackSide};
use super::super::element_id;
use super::super::text_frames::{FrameFont, TextBlockLayout};
use super::super::text_styles::{self, FontFamily};
use super::super::types::*;
use super::dynamics::PlacedDynamic;
use super::substrate_obstacles::{above_glyph_top_in_range, stem_tip_y, AboveGlyphBox};
use crate::model::{
    ExpressionPlacement, MultiStaffPlacement, StaffTextFrameWidth, SystemText, TextExpression,
    TextFrameAlign,
};
use crate::render::*;

fn expression_span(anchor: f64, width: f64, right_aligned: bool) -> (f64, f64) {
    if right_aligned {
        (anchor - width, anchor)
    } else {
        (anchor, anchor + width)
    }
}

fn below_expression_baseline(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    font_size: f64,
) -> f64 {
    let staff_bottom = staff_y + 4.0 * sp;

    // Find the lowest point of any stem/note below the staff (same as dynamics)
    let mut lowest_y = staff_bottom;
    for vl in &ml.voice_layouts {
        for i in 0..vl.events.len() {
            if vl.events.event(i).is_rest() {
                continue;
            }
            let note_positions = vl.events.note_positions(i);
            for &pos in note_positions {
                let note_y = staff_y + pos * sp * 0.5;
                if note_y > lowest_y {
                    lowest_y = note_y;
                }
            }
            if !vl.events.stem_up(i) && !note_positions.is_empty() {
                let bottom_pos = note_positions
                    .iter()
                    .copied()
                    .fold(f64::NEG_INFINITY, f64::max);
                let stem_tip = stem_tip_y(bottom_pos, false, staff_y, sp, config.stem_length);
                if stem_tip > lowest_y {
                    lowest_y = stem_tip;
                }
            }
        }
    }

    let text_ascent = 0.8 * font_size;
    let clearance = 0.5 * sp;
    (staff_bottom + config.expression_min_distance * sp).max(lowest_y + clearance + text_ascent)
}

/// Render text expressions (e.g. "dolce", "espressivo", "rit.", "a tempo") below the staff.
///
/// Text expressions are positioned at the x coordinate corresponding to their
/// rhythmic position. They sit below the staff, below dynamics, rendered in
/// italic serif font. Collision avoidance ensures they don't overlap with
/// notes, stems, or dynamics.
pub(crate) fn render_text_expressions(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    above_glyph_boxes: &[AboveGlyphBox],
    dynamic_boxes: &[PlacedDynamic],
    staff_y_offsets: Option<&[f64]>,
) {
    let mi = ml.resolved.index;
    let pi = ml.part_index;
    let mut expressions: Vec<(TextExpression, String)> = ml
        .resolved
        .part
        .expressions
        .as_deref()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(index, expression)| {
            (
                expression.clone(),
                element_id::expression(
                    expression.source_part_index.unwrap_or(pi),
                    mi,
                    expression.source_expression_index.unwrap_or(index),
                ),
            )
        })
        .collect();
    if let Some(system_text) = ml.resolved.global.system_text() {
        for text in system_text {
            let is_above = matches!(text.placement, Some(ExpressionPlacement::Above));
            if (is_above && ml.is_first_staff) || (!is_above && ml.is_last_staff) {
                expressions.push((
                    system_text_expression(text),
                    element_id::system_text(mi, &text.id),
                ));
            }
        }
    }
    if expressions.is_empty() {
        return;
    }

    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let staff_bottom = staff_y + 4.0 * sp;
    let font_size = 2.0 * sp; // ~10pt = 2.0sp (standard engraving default)
    let expr_y = below_expression_baseline(ml, staff_y, sp, config, font_size);
    let text_ascent = 0.8 * font_size;
    let notehead_w = 1.18 * sp;

    // Stack multiple Above/Below expressions that share an ink column. The
    // per-kind clearances come from the placement table and feed the shared
    // `dependent_stacking` resolver, which pushes overlapping expressions
    // outward (Above grows upward, Below downward) in one acyclic pass.
    let expr_metrics = config.placement.resolve(ElementKind::Expression);

    let mut pending: Vec<PendingExpr> = Vec::new();

    for (expr, text_element_id) in &expressions {
        let is_above = matches!(expr.placement, Some(ExpressionPlacement::Above));

        let beat = expr.position.beats();

        // Look up actual event X position from voice layouts to match real note spacing.
        // Fall back to linear interpolation if no matching event is found.
        let event_x = ml.voice_layouts.iter().find_map(|vl| {
            (0..vl.events.len())
                .find(|&i| {
                    (vl.events.beat_position(i) - beat).abs() < 0.01
                        && (!expr.instrument_reminder || !vl.events.event(i).is_rest())
                })
                .map(|i| vl.events.x(i))
        });
        // A position at or past the measure's own duration (e.g. `[1,1]` in a
        // 2/4 bar) is the standard idiom for "anchor this to the barline",
        // used by repeat/jump instructions (D.C. al Coda, D.S. al Fine, ...)
        // that conclude the bar they're written in rather than opening it.
        // Such text is right-aligned so it hugs the barline instead of
        // spilling left-anchored into (or past) the next measure.
        let right_aligned = event_x.is_none() && beat >= total_beats - 1e-6;
        let measure_right = x_origin + content_width;
        // Left edge of the notehead — text is left-aligned with the note
        // (right edge of the measure for a barline-anchored instruction).
        let note_x = match event_x {
            // A change reminder belongs after the final notehead, not at the
            // onset of the following rest.
            Some(ex) if expr.instrument_reminder => ex + notehead_w + 0.5 * sp,
            Some(ex) => ex,
            None if right_aligned => measure_right,
            None => {
                let beat_pos = beat / total_beats;
                x_origin + beat_pos * content_width
            }
        };

        // The text's LEFT border is its rhythmic anchor, so it is always
        // left-aligned at the note and simply extends rightward however far the
        // string runs — it is never shifted left to "clear" a following event.
        // Shifting left would move the unambiguous left edge off the beat it
        // marks (e.g. Vln I m.136: an accented eighth at 3/4 had "arco" dragged
        // left off the chord). Following notes the text may overlap are a
        // vertical-stacking concern, handled later by the dependent solver.
        // Real per-glyph advance widths (serif AFM table). The previous flat
        // 0.5 em/char estimate badly overshot the box for narrow strings like
        // "pizz." (i/./, are far narrower than 0.5 em), leaving the selection
        // box gaping past the text. Italic shares the upright advance table.
        let block = expression_block(expr, font_size, sp);
        let text_width = block.as_ref().map_or_else(
            || super::text_content::content_width(&expr.text, font_size, FontFamily::Serif, false),
            |block| block.width,
        );
        let alignment = expression_alignment(expr, right_aligned);
        let [off_x_sp, off_y_sp] = expr.manual_offset.unwrap_or([0.0, 0.0]);
        // Standard engraving practice: expression text sharing a rhythmic
        // position and side with a dynamic continues inline after that dynamic.
        let inline_dynamic = dynamic_boxes.iter().find(|dynamic| {
            !expr.instrument_reminder
                && dynamic.above == is_above
                && (dynamic.beat - beat).abs() < 0.01
        });
        let draw_x = inline_dynamic
            .map(|dynamic| dynamic.x1 + 0.5 * sp)
            .unwrap_or(note_x)
            + off_x_sp * sp;

        // When the user pins the expression (`avoidCollisions == false`), the
        // manual offset is measured from a FIXED bare datum: 1sp above the top
        // staff line (above) or the standard below-staff line (below). The
        // skyline scan (notes / stems / articulations) and the sibling stacking
        // resolver are both skipped, so the text sits exactly where placed even
        // if that overlaps notes or other directions. Default/unset = auto.
        let avoid = expr.avoid_collisions.unwrap_or(true);
        let between_center = expr
            .placement
            .is_none()
            .then(|| super::dynamics::grand_staff_gap_center(staff_y, sp, staff_y_offsets))
            .flatten();
        let inline_dynamic_is_explicit = inline_dynamic.is_some()
            && ml.resolved.part.dynamics.as_ref().is_some_and(|dynamics| {
                dynamics.iter().any(|dynamic| {
                    !dynamic.is_gradual()
                        && (dynamic.position.beats() - beat).abs() < 0.01
                        && (matches!(
                            dynamic.placement,
                            Some(MultiStaffPlacement::Above | MultiStaffPlacement::Below)
                        ) || dynamic
                            .manual_offset
                            .is_some_and(|offset| offset != [0.0, 0.0])
                            || dynamic.avoid_collisions == Some(false))
                })
            });

        let base_y = if inline_dynamic_is_explicit {
            inline_dynamic
                .expect("explicit inline dynamic exists")
                .baseline_y
        } else if let Some(center_y) = between_center {
            center_y
                + text_styles::lowercase_center_offset_from_baseline(FontFamily::Serif, font_size)
        } else if let Some(dynamic) = inline_dynamic {
            dynamic.baseline_y
        } else if !avoid {
            if is_above {
                staff_y - expr_metrics.attach_gap_above() * sp
            } else {
                staff_bottom + config.expression_min_distance * sp
            }
        } else if is_above {
            // Text spans several rhythmic columns: clear every note and stem
            // under its ink, including music after a rest-anchored direction.
            let mut highest_y = staff_y; // top staff line
            let mut has_obstacle_above = false;
            let (scan_left, scan_right) = expression_span(note_x, text_width, right_aligned);
            for vl in &ml.voice_layouts {
                for i in 0..vl.events.len() {
                    let event_x = vl.events.x(i);
                    if event_x + notehead_w >= scan_left && event_x <= scan_right {
                        let note_positions = vl.events.note_positions(i);
                        for &pos in note_positions {
                            let note_y = staff_y + pos * sp * 0.5;
                            if note_y < staff_y {
                                has_obstacle_above = true;
                            }

                            if note_y < highest_y {
                                highest_y = note_y;
                            }
                        }
                        // Stem-up stems protrude above the chord; the text must
                        // clear the stem tip, not just the noteheads (otherwise
                        // an above-staff direction such as "pizz." sits right at
                        // the stem tip even though the notes are inside the staff).
                        // Gate on `has_stem()`: a whole note (or breve) carries a
                        // notional `stem_up` for tie/slur orientation but draws NO
                        // stem, so counting a phantom stem tip would lift the
                        // direction to clear ink that is never rendered (e.g. an
                        // octave dyad of whole notes whose notional up-stem
                        // reaches 2sp above the staff pushed "arco" up for
                        // nothing). Only a real, drawn stem widens the skyline.
                        if vl.events.stem_up(i)
                            && vl.events.event(i).duration.base.has_stem()
                            && !note_positions.is_empty()
                        {
                            let top_pos =
                                note_positions.iter().copied().fold(f64::INFINITY, f64::min);
                            let stem_tip =
                                stem_tip_y(top_pos, true, staff_y, sp, config.stem_length);
                            if stem_tip < staff_y {
                                has_obstacle_above = true;
                            }
                            if stem_tip < highest_y {
                                highest_y = stem_tip;
                            }
                        }
                    }
                }
            }
            // Articulations (accents/marcato/staccato dots) protrude above the
            // noteheads; an above-staff direction such as "arco" must clear them
            // too, not just the noteheads and stems. Standard engraving practice
            // stacks performance directions above any articulation on the note.
            //
            // Scan around the rhythmic ANCHOR (`note_x`), never the manually
            // offset `draw_x`: the auto datum `base_y` must NOT depend on the
            // manual offset, or the vertical anchor would shift as the user
            // drags horizontally (the offset feeding back into the datum it is
            // measured from → a jumpy drag). For an un-offset expression
            // `draw_x == note_x`, so this is identical to the old range. A
            // right-aligned instruction's ink extends LEFT from `note_x`
            // instead of right.
            let (artic_scan_left, artic_scan_right) = match alignment {
                TextFrameAlign::Right => (note_x - text_width.max(notehead_w), note_x),
                TextFrameAlign::Center => (note_x - text_width / 2.0, note_x + text_width / 2.0),
                TextFrameAlign::Left => (note_x, note_x + text_width.max(notehead_w)),
            };
            if let Some(gtop) =
                above_glyph_top_in_range(above_glyph_boxes, artic_scan_left, artic_scan_right)
            {
                has_obstacle_above = true;
                if gtop < highest_y {
                    highest_y = gtop;
                }
            }
            // Baseline anchoring (matches tempo): `base_y` IS the alphabetic
            // baseline, and the box bottom sits on it so descenders protrude
            // toward the staff exactly as tempo's do. Two distances, both from
            // the placement table — no standalone "lift" property:
            //   - rest gap: `attach_gap_above` (the staff datum reserve, 1sp).
            //   - lift clearance: `padding.vertical` (the SINGLE inter-ink gap;
            //     "ink is ink", so clearing a notehead uses the same value as
            //     stacking over a sibling dependent).
            // The above-staff reserve (`attach_gap_above` = 1sp) differs from
            // the below-staff one (`attach_gap_below` = 3sp, the dynamics line);
            // placement isn't intrinsic to the text, so it's a per-side field.
            let attach_gap = expr_metrics.attach_gap_above() * sp;
            let clearance = expr_metrics.padding.vertical * sp;
            if has_obstacle_above {
                highest_y - clearance
            } else {
                staff_y - attach_gap
            }
        } else {
            expr_y
        };

        let frame_clearance =
            if avoid && !is_above && between_center.is_none() && inline_dynamic.is_none() {
                block
                    .as_ref()
                    .map_or(0.0, |block| (block.first_baseline - text_ascent).max(0.0))
            } else {
                0.0
            };
        pending.push(PendingExpr {
            draw_x,
            text_width,
            alignment,
            block,
            erase_background: erases_background(expr),
            // manualOffset y is positive-UP; canvas y grows downward, so
            // subtract to move up for a positive value.
            base_y: base_y + frame_clearance - off_y_sp * sp,
            is_above,
            text: expr.text.clone(),
            element_id: text_element_id.clone(),
            // Computed above; unset defaults to true (auto-avoidance on).
            avoid_collisions: avoid,
            inline: inline_dynamic.is_some(),
        });
    }

    // Resolve mutual vertical overlap between the preferred boxes, then emit
    // each expression at its displaced baseline.
    emit_stacked_expressions(dl, &pending, font_size, sp, &expr_metrics, dynamic_boxes);
}

/// One expression's preferred placement, before mutual stacking.
struct PendingExpr {
    draw_x: f64,
    text_width: f64,
    /// Block alignment around the rhythmic anchor.
    alignment: TextFrameAlign,
    block: Option<TextBlockLayout>,
    erase_background: bool,
    /// Preferred baseline `y` (Bottom-baselined above, Middle-baselined below),
    /// before the resolver's outward displacement.
    base_y: f64,
    is_above: bool,
    text: crate::model::TextContent,
    element_id: String,
    /// When false, the expression is manually placed: the stacking resolver
    /// treats it as a pinned obstacle (others flow around it) and never moves
    /// it, so it renders exactly at `base_y`. Unset/true = re-flow (default).
    avoid_collisions: bool,
    inline: bool,
}

/// Run the dependent-stacking resolver over a measure's preferred expression
/// boxes and emit each at its displaced baseline. Above expressions are
/// Bottom-baselined (baseline = box bottom); below expressions are
/// Alphabetic-baselined (the `base_y` IS the text baseline), so a below
/// expression sharing a dynamic's beat sits on the same baseline as the
/// Bravura dynamic glyph (whose SMuFL origin is its alphabetic baseline).
fn emit_stacked_expressions(
    dl: &mut DisplayList,
    pending: &[PendingExpr],
    font_size: f64,
    sp: f64,
    metrics: &crate::layout::placement_metrics::PlacementMetrics,
    dynamic_boxes: &[PlacedDynamic],
) {
    let stack_gap = metrics.padding.vertical * sp;
    let side_bearing = metrics.padding.horizontal * sp;
    // Movable expression boxes first (their `dy` aligns with `pending` by
    // index), then the already-placed dynamics as **pinned** source nodes so an
    // expression sharing a dynamic's ink column stacks clear of it instead of
    // overlapping. Pinned boxes always resolve to `dy == 0` and trail the
    // movable ones, so the `pending.zip(dy)` below still lines up.
    // Below-staff text anchors its box on the cap-height line (the inverse of
    // the above-staff baseline rule): the box bottom sits ON the baseline and
    // the staff-facing TOP edge is `cap_height` above it. The cap-height line
    // is a stable face metric (unlike per-glyph top ink), so the box edge — and
    // therefore the collision/attach-gap geometry — stays put regardless of
    // which letters appear; ascenders/accents protrude above as ink, symmetric
    // to descenders protruding below an above-staff box.
    let below_cap = text_styles::cap_height_from_baseline(FontFamily::Serif, font_size);
    // Above-staff text anchors its box bottom on the baseline (like tempo) and
    // spans up by the ascender/cap band; descenders protrude below toward the
    // staff. `0.82 em` matches tempo's box height exactly.
    let above_band = 0.82 * font_size;
    let mut boxes: Vec<StackBox> = pending
        .iter()
        .map(|p| {
            // Both sides put the box bottom ON the baseline (`base_y`). Above:
            // the ascender band rises away from the staff. Below: the cap band
            // rises toward the staff. Identical to each side's published
            // selection bbox, so collision geometry and the bbox agree.
            let (y_top, y_bottom) = if let Some(block) = &p.block {
                let top = p.base_y
                    - if p.is_above {
                        block.height
                    } else {
                        block.first_baseline
                    };
                (top, top + block.height)
            } else if p.is_above {
                (p.base_y - above_band, p.base_y)
            } else {
                (p.base_y - below_cap, p.base_y)
            };
            let x0 = p.left();
            let x1 = x0 + p.text_width;
            StackBox {
                x0,
                x1,
                y_top,
                y_bottom,
                stack_gap,
                side_bearing,
                stack_rank: metrics.stack_rank,
                side: if p.is_above {
                    StackSide::Above
                } else {
                    StackSide::Below
                },
                // Manually-placed expressions (avoid_collisions == false) are
                // pinned: the resolver leaves them at `base_y` (dy == 0) and
                // other movable boxes flow around them. So they land exactly
                // where the user dropped them.
                pinned: !p.avoid_collisions || p.inline,
            }
        })
        .collect();
    boxes.extend(dynamic_boxes.iter().map(|d| StackBox {
        x0: d.x0,
        x1: d.x1,
        y_top: d.y_top,
        y_bottom: d.y_bottom,
        // Ignored for pinned nodes except `side_bearing`, which feeds the
        // shared horizontal-overlap test; the expression's own bearing already
        // dominates via the `max` in `horizontally_shares_column`.
        stack_gap,
        side_bearing,
        stack_rank: metrics.stack_rank,
        side: if d.above {
            StackSide::Above
        } else {
            StackSide::Below
        },
        pinned: true,
    }));
    let dy = dependent_stacking::resolve_stacking(&boxes);

    for (p, &delta) in pending.iter().zip(dy.iter()) {
        let draw_y = p.base_y + delta;
        let element_id = p.element_id.clone();
        let command_start = dl.commands.len();
        let block_top = p.block.as_ref().map(|block| {
            draw_y
                - if p.is_above {
                    block.height
                } else {
                    block.first_baseline
                }
        });
        if let (Some(block), Some(top)) = (&p.block, block_top) {
            block.emit(
                dl,
                p.left(),
                top,
                if p.is_above { "serif" } else { "serif italic" },
                sp,
                p.erase_background,
            );
        } else {
            super::text_content::emit_content(
                dl,
                &p.text,
                p.draw_x,
                draw_y,
                font_size,
                if p.is_above { "serif" } else { "serif italic" },
                "#000000",
                match p.alignment {
                    TextFrameAlign::Right => TextAlign::Right,
                    TextFrameAlign::Center => TextAlign::Center,
                    TextFrameAlign::Left => TextAlign::Left,
                },
                TextBaseline::Alphabetic,
            );
        }
        for command_index in command_start..dl.commands.len() {
            dl.tag_command(command_index, element_id.clone());
        }
        // Publish the selection bbox from the SAME shifted baseline (`draw_y`),
        // so it tracks the stacking delta the resolver just applied. Both sides
        // put the box bottom ON the baseline (`draw_y`); above spans up by the
        // ascender band (like tempo), below spans up to the cap-height line.
        // Width reuses the AFM advance the stacking layout used.
        let text_w = p.text_width;
        let (bbox_y, bbox_h) = if let (Some(block), Some(top)) = (&p.block, block_top) {
            (top, block.height)
        } else if p.is_above {
            (draw_y - above_band, above_band)
        } else {
            (draw_y - below_cap, below_cap)
        };
        let bbox_x = p.left();
        dl.push_element_bbox_with_shape(ElementBBox {
            element_id: p.element_id.clone(),
            bbox: BoundingBox::new(bbox_x, bbox_y, text_w, bbox_h),
        });
        if p.block.is_some() {
            if let Some(shape) = dl.element_shapes.last_mut() {
                shape.authored_bounds = true;
            }
        }
    }
}

impl PendingExpr {
    fn left(&self) -> f64 {
        self.draw_x
            - match self.alignment {
                TextFrameAlign::Left => 0.0,
                TextFrameAlign::Center => self.text_width / 2.0,
                TextFrameAlign::Right => self.text_width,
            }
    }
}

fn expression_alignment(
    expr: &crate::model::TextExpression,
    right_aligned: bool,
) -> TextFrameAlign {
    expr.frame
        .as_ref()
        .and_then(|frame| frame.horizontal_alignment)
        .unwrap_or(if right_aligned {
            TextFrameAlign::Right
        } else {
            TextFrameAlign::Left
        })
}

fn erases_background(expr: &crate::model::TextExpression) -> bool {
    expr.frame
        .as_ref()
        .and_then(|frame| frame.erase_background)
        .unwrap_or(false)
}

fn expression_block(
    expr: &crate::model::TextExpression,
    font_size: f64,
    sp: f64,
) -> Option<TextBlockLayout> {
    let natural_frame = crate::model::StaffTextFramePresentation::default();
    let frame = expr.frame.as_ref().or_else(|| {
        expr.text.chunks().iter().any(|chunk| matches!(chunk, crate::model::TextContentChunk::Text(run) if run.text.contains('\n')))
            .then_some(&natural_frame)
    })?;
    Some(TextBlockLayout::new(
        &expr.text,
        frame
            .width
            .map(|StaffTextFrameWidth::StaffSpaces(width)| width * sp),
        frame.padding.unwrap_or(0.0) * sp,
        FrameFont {
            base_size: font_size,
            family: FontFamily::Serif,
            bold: false,
        },
        frame.paragraph_justification,
        frame.border,
    ))
}

fn system_text_expression(text: &SystemText) -> TextExpression {
    TextExpression {
        text: text.text.clone(),
        frame: text.frame.clone(),
        position: text.position.clone(),
        placement: text.placement,
        staff: None,
        voice: None,
        source_part_index: None,
        source_expression_index: None,
        instrument_reminder: false,
        manual_offset: text.manual_offset,
        avoid_collisions: text.avoid_collisions,
    }
}

pub(crate) fn system_text_vertical_extras(
    ml: &MeasureLayout,
    sp: f64,
    config: &LayoutConfig,
) -> (f64, f64) {
    let Some(texts) = ml.resolved.global.system_text() else {
        return (0.0, 0.0);
    };
    let font_size = 2.0 * sp;
    let ascent = 0.8 * font_size;
    let below_cap = text_styles::cap_height_from_baseline(FontFamily::Serif, font_size);
    let metrics = config.placement.resolve(ElementKind::Expression);
    let mut above = 0.0_f64;
    let mut below = 0.0_f64;
    let mut stack_boxes = Vec::with_capacity(texts.len());
    let highest =
        super::substrate_obstacles::highest_point_in_measure(ml, 0.0, sp, config.stem_length);
    let lowest = below_expression_baseline(ml, 0.0, sp, config, font_size);
    let staff_bottom = 4.0 * sp;
    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let measure_right = x_origin + content_width;
    let stack_gap = metrics.padding.vertical * sp;
    let side_bearing = metrics.padding.horizontal * sp;

    for text in texts {
        let expression = system_text_expression(text);
        let is_above = matches!(text.placement, Some(ExpressionPlacement::Above));
        let block = expression_block(&expression, font_size, sp);
        let text_width = block.as_ref().map_or_else(
            || super::text_content::content_width(&text.text, font_size, FontFamily::Serif, false),
            |block| block.width,
        );
        let beat = text.position.beats();
        let event_x = ml.voice_layouts.iter().find_map(|vl| {
            (0..vl.events.len())
                .find(|&i| (vl.events.beat_position(i) - beat).abs() < 0.01)
                .map(|i| vl.events.x(i))
        });
        let right_aligned = event_x.is_none() && beat >= total_beats - 1e-6;
        let note_x = event_x.unwrap_or_else(|| {
            if right_aligned {
                measure_right
            } else {
                x_origin + (beat / total_beats) * content_width
            }
        });
        let alignment = expression_alignment(&expression, right_aligned);
        let [offset_x, offset_y] = text.manual_offset.unwrap_or([0.0, 0.0]);
        let draw_x = note_x + offset_x * sp;
        let left = draw_x
            - match alignment {
                TextFrameAlign::Left => 0.0,
                TextFrameAlign::Center => text_width / 2.0,
                TextFrameAlign::Right => text_width,
            };
        let (height, first_baseline) = block.as_ref().map_or_else(
            || {
                if is_above {
                    (0.82 * font_size, 0.82 * font_size)
                } else {
                    (below_cap, below_cap)
                }
            },
            |block| (block.height, block.first_baseline),
        );
        let offset_y = offset_y * sp;
        let base_y;
        if is_above {
            if !ml.is_first_staff {
                continue;
            }
            let attach = metrics.attach_gap_above() * sp;
            let obstacle = (-highest).max(0.0) + metrics.padding.vertical * sp;
            let baseline_distance = if text.avoid_collisions.unwrap_or(true) {
                attach.max(obstacle)
            } else {
                attach
            };
            above = above.max((baseline_distance + height + offset_y).max(0.0));
            base_y = -baseline_distance - offset_y;
        } else {
            if !ml.is_last_staff {
                continue;
            }
            let stack_gap = metrics.padding.vertical * sp;
            let dynamic_reserve = if ml
                .resolved
                .part
                .dynamics
                .as_ref()
                .is_some_and(|dynamics| !dynamics.is_empty())
            {
                4.5 * sp + stack_gap + below_cap
            } else {
                0.0
            };
            let baseline = (lowest - staff_bottom)
                .max(config.expression_min_distance * sp)
                .max(dynamic_reserve);
            let descent = block.as_ref().map_or(below_cap, |_| {
                height - first_baseline + (first_baseline - ascent).max(0.0)
            });
            below = below.max((baseline + descent - offset_y).max(0.0));
            base_y = baseline - offset_y;
        }
        let (y_top, y_bottom) = if let Some(block) = &block {
            let top = base_y
                - if is_above {
                    block.height
                } else {
                    block.first_baseline
                };
            (top, top + block.height)
        } else if is_above {
            (base_y - 0.82 * font_size, base_y)
        } else {
            (base_y - below_cap, base_y)
        };
        stack_boxes.push(StackBox {
            x0: left,
            x1: left + text_width,
            y_top,
            y_bottom,
            stack_gap,
            side_bearing,
            stack_rank: metrics.stack_rank,
            side: if is_above {
                StackSide::Above
            } else {
                StackSide::Below
            },
            pinned: !text.avoid_collisions.unwrap_or(true),
        });
    }
    let displacements = dependent_stacking::resolve_stacking(&stack_boxes);
    let above_stack = stack_boxes
        .iter()
        .zip(&displacements)
        .filter(|(box_, _)| box_.side == StackSide::Above)
        .map(|(_, dy)| (-dy).max(0.0))
        .fold(0.0, f64::max);
    let below_stack = stack_boxes
        .iter()
        .zip(&displacements)
        .filter(|(box_, _)| box_.side == StackSide::Below)
        .map(|(_, dy)| dy.max(0.0))
        .fold(0.0, f64::max);
    above += above_stack;
    below += below_stack;
    (above, below)
}
