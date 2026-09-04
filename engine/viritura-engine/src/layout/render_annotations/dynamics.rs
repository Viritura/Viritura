use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::text_styles::{self, FontFamily};
use super::super::types::*;
use super::substrate_obstacles::{glyph_screen_bbox, stem_tip_y, ArticBox};
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;

pub(crate) fn dynamic_voice_index(ml: &MeasureLayout, dynamic: &DynamicGroup) -> Option<usize> {
    let voice = dynamic.voice.as_deref()?;
    ml.resolved
        .part
        .sequences
        .iter()
        .position(|sequence| sequence.voice.as_deref() == Some(voice))
        .or_else(|| {
            voice
                .strip_prefix('v')
                .and_then(|number| number.parse::<usize>().ok())
                .and_then(|number| number.checked_sub(1))
                .filter(|index| *index < ml.voice_layouts.len())
        })
}

pub(crate) fn dynamic_places_above(ml: &MeasureLayout, dynamic: &DynamicGroup) -> bool {
    if dynamic.orient.is_some() || dynamic.placement_above.is_some() {
        return dynamic.places_above();
    }
    dynamic_voice_index(ml, dynamic).is_some_and(|index| {
        dynamic.voice.is_some() && ml.voice_layouts.len() > 1 && index % 2 == 0
    })
}

/// Render dynamic markings (pp, ff, etc.) below the staff.
///
/// Y coordinate of the baseline for a dynamic glyph, given which side of the
/// staff it sits on. Walks every voice's events and pushes the glyph past any
/// notehead or stem tip that horizontally overlaps the dynamic's bounding box.
///
/// `is_above`: glyph sits above the staff (smaller Y is "further out"). When
/// false, glyph sits below the staff (larger Y is "further out").
#[allow(clippy::too_many_arguments)]
fn dynamic_baseline_y(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    dyn_left: f64,
    dyn_right: f64,
    notehead_w: f64,
    is_above: bool,
    default_y: f64,
    glyph_ascent: f64,
    clearance: f64,
    artic_boxes: &[ArticBox],
    slur_edge: Option<f64>,
    voice_index: Option<usize>,
) -> f64 {
    let staff_bottom = staff_y + 4.0 * sp;
    let init = if is_above { staff_y } else { staff_bottom };
    let mut extreme = init;

    for vl in &ml.voice_layouts {
        if voice_index.is_some_and(|index| vl.voice_index != index) {
            continue;
        }
        for i in 0..vl.events.len() {
            if vl.events.event(i).is_rest() {
                continue;
            }
            let ex = vl.events.x(i);
            let ev_left = ex;
            let ev_right = ex + notehead_w;
            if ev_right < dyn_left - 0.5 * sp || ev_left > dyn_right + 0.5 * sp {
                continue;
            }
            let note_positions = vl.events.note_positions(i);
            for &pos in note_positions {
                // Fold in the notehead's near EDGE, not its centre. A notehead
                // is 1sp tall (bbox y −0.5..+0.5 around the staff position), so
                // the ink reaches half a space past the centre toward the
                // dynamic. Measuring from the centre would let the requested
                // clearance collapse to zero (the half-notehead eats it),
                // leaving the dynamic visually touching the note.
                let note_center = staff_y + pos * sp * 0.5;
                let note_edge = if is_above {
                    note_center - 0.5 * sp
                } else {
                    note_center + 0.5 * sp
                };
                if is_above {
                    if note_edge < extreme {
                        extreme = note_edge;
                    }
                } else if note_edge > extreme {
                    extreme = note_edge;
                }
            }
            // Stem tip only matters on the side the stem points to.
            if vl.events.stem_up(i) == is_above && !note_positions.is_empty() {
                let edge_pos = if is_above {
                    note_positions.iter().copied().fold(f64::INFINITY, f64::min)
                } else {
                    note_positions
                        .iter()
                        .copied()
                        .fold(f64::NEG_INFINITY, f64::max)
                };
                let stem_tip = stem_tip_y(edge_pos, is_above, staff_y, sp, config.stem_length);
                if is_above {
                    if stem_tip < extreme {
                        extreme = stem_tip;
                    }
                } else if stem_tip > extreme {
                    extreme = stem_tip;
                }
            }
        }
    }

    // Fold in articulations (accents, staccatos, marcatos, …) that overlap the
    // dynamic horizontally. Articulations sit on the note side opposite the
    // stem, so an accent under a stem-up note lands below the staff exactly
    // where a below-staff dynamic wants to go; the dynamic must clear it.
    for &(ax_left, ax_right, ax_top, ax_bottom) in artic_boxes {
        if ax_right < dyn_left - 0.5 * sp || ax_left > dyn_right + 0.5 * sp {
            continue;
        }
        if is_above {
            if ax_top < extreme {
                extreme = ax_top;
            }
        } else if ax_bottom > extreme {
            extreme = ax_bottom;
        }
    }

    // Fold in a slur arching toward the dynamic (below-staff dynamic vs a slur
    // curving below; above-staff dynamic vs a slur curving above). The dynamic
    // must clear the slur's near edge — standard engraving practice keeps
    // dynamics outside the slur, never tucked inside its arc.
    if let Some(edge) = slur_edge {
        if is_above {
            if edge < extreme {
                extreme = edge;
            }
        } else if edge > extreme {
            extreme = edge;
        }
    }

    if is_above {
        // Glyph baseline must be above (smaller Y than) both anchors.
        default_y.min(extreme - clearance)
    } else {
        default_y.max(extreme + clearance + glyph_ascent)
    }
}

/// X-coordinate of the centre of the notehead a dynamic applies to.
///
/// The notehead width depends on the note value — a whole notehead (~1.66sp)
/// is markedly wider than a black/half notehead (1.18sp). Using a single fixed
/// width centres dynamics correctly under quarter/eighth notes but pushes them
/// too far left under whole/half notes, making centring look inconsistent from
/// note to note. Measuring the actual notehead keeps every dynamic optically
/// centred on its note regardless of duration.
pub(super) fn dynamic_note_center_x(
    ml: &MeasureLayout,
    dynamic: &DynamicGroup,
    beat: f64,
    sp: f64,
    x_origin: f64,
    content_width: f64,
    total_beats: f64,
) -> f64 {
    let fallback_w = 1.18 * sp;
    let voice_index = dynamic_voice_index(ml, dynamic);
    match ml.voice_layouts.iter().find_map(|vl| {
        if voice_index.is_some_and(|index| vl.voice_index != index) {
            return None;
        }
        (0..vl.events.len())
            .find(|&i| (vl.events.beat_position(i) - beat).abs() < 0.01)
            .map(|i| (vl.events.event(i).duration.base.clone(), vl.events.x(i)))
    }) {
        Some((base, ex)) => {
            let head_w = smufl::notehead_width(smufl::notehead_glyph(&base)) * sp;
            ex + head_w * 0.5
        }
        None => x_origin + (beat / total_beats) * content_width + fallback_w * 0.5,
    }
}

/// Vertical optical midline of a dynamic's letterforms at its rhythmic
/// position — the Y a crescendo/decrescendo spine should sit on so the wedge
/// lines up with the *centre* of the dynamic letters rather than their
/// baseline. Mirrors the placement math in [`render_dynamics`] so the hairpin
/// tracks exactly where the glyph is engraved.
pub(crate) fn dynamic_optical_midline_y(
    ml: &MeasureLayout,
    dyn_mark: &DynamicGroup,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    artic_boxes: &[ArticBox],
    slur_edge: Option<f64>,
) -> f64 {
    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let staff_bottom = staff_y + 4.0 * sp;
    let notehead_w = 1.18 * sp;
    let glyph_ascent = 1.78 * sp;
    let clearance = 0.5 * sp;
    let min_dynamics_y = staff_bottom + config.dynamics_min_distance * sp;
    let max_dynamics_y_above = staff_y - config.dynamics_min_distance * sp;

    let beat = dyn_mark.position.beats();
    let value = dyn_mark.display_value();
    let optical_center = smufl::dynamics_optical_center(&value) * sp;
    let voice_index = dynamic_voice_index(ml, dyn_mark);
    let note_center_x =
        dynamic_note_center_x(ml, dyn_mark, beat, sp, x_origin, content_width, total_beats);
    let dyn_x = note_center_x - optical_center;
    let dyn_w = smufl::dynamics_glyph_width(&value) * sp;
    let is_above = dynamic_places_above(ml, dyn_mark);
    let datum = if is_above {
        max_dynamics_y_above
    } else {
        min_dynamics_y
    };
    let baseline = if dyn_mark.avoid_collisions.unwrap_or(true) {
        dynamic_baseline_y(
            ml,
            staff_y,
            sp,
            config,
            dyn_x,
            dyn_x + dyn_w,
            notehead_w,
            is_above,
            datum,
            glyph_ascent,
            clearance,
            artic_boxes,
            slur_edge,
            voice_index,
        )
    } else {
        datum
    } - dyn_mark.manual_offset.unwrap_or([0.0, 0.0])[1] * sp;
    // The dynamic letters' optical centre sits ~0.5sp above the glyph baseline
    // (the glyphs are drawn from their baseline and rise into the letterform);
    // the hairpin spine aligns to that centre.
    baseline - 0.5 * sp
}

/// A dynamic's final placed ink box, returned so later dependents (text
/// expressions) can clear it through the shared stacking field. `above` records
/// which side of the staff it settled on, so an expression only treats a
/// dynamic on its own side as an obstacle. See
/// `docs/plans/horizontal-collision-avoidance.md`: dynamics are *earlier-placed
/// dependents*, fed to the resolver as pinned source nodes.
#[derive(Clone, Copy, Debug)]
pub(crate) struct PlacedDynamic {
    pub beat: f64,
    pub baseline_y: f64,
    pub x0: f64,
    pub x1: f64,
    pub y_top: f64,
    pub y_bottom: f64,
    pub above: bool,
}

/// Dynamics are positioned at the x coordinate corresponding to their rhythmic
/// position, centered on the notehead column. They sit below the staff with
/// collision avoidance: at least `dynamics_min_distance` below the bottom staff
/// line, pushed further down if stems or notes extend below the staff.
///
/// Returns each dynamic's final ink box (see [`PlacedDynamic`]) so the
/// text-expression pass can clear them via the shared stacking field.
#[allow(clippy::too_many_lines)] // single dynamics placement+collision pass; cohesive pipeline stage
pub(crate) fn render_dynamics(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    artic_boxes: &[ArticBox],
    staff_y_offsets: Option<&[f64]>,
) -> Vec<PlacedDynamic> {
    let dynamics = match &ml.resolved.part.dynamics {
        Some(d) if !d.is_empty() => d,
        _ => return Vec::new(),
    };

    let mut placed_dynamics: Vec<PlacedDynamic> = Vec::new();

    let total_beats = ml.resolved.active_time.measure_beats();
    let content_width = super::super::render_barlines::rhythmic_content_width(ml, sp);
    let x_origin = ml.x + ml.prefix_width;
    let staff_bottom = staff_y + 4.0 * sp;
    let glyph_size = 4.0 * sp;
    let affix_size = 1.5 * sp;
    let affix_gap = 0.25 * sp;
    let notehead_w = 1.18 * sp;

    // Dynamics glyph ascent: how far the TOP of the glyph extends above the
    // baseline. forte-based glyphs (f,ff,fff,mf) extend ~1.78sp above baseline;
    // piano-based (p,pp,ppp,mp) extend ~1.10sp. Use the max for consistency.
    let glyph_ascent = 1.78 * sp;
    let clearance = 0.5 * sp; // desired gap between lowest element and glyph top
    let min_dynamics_y = staff_bottom + config.dynamics_min_distance * sp;
    // For above-staff placement, mirror: baseline above the top staff line by
    // dynamics_min_distance. (Used for stem-up sources in condensed divisi.)
    let max_dynamics_y_above = staff_y - config.dynamics_min_distance * sp;

    let mi = ml.resolved.index;
    for dyn_mark in dynamics {
        if dyn_mark.is_gradual() {
            continue;
        }
        let value = dyn_mark.display_value();
        // Ordered custom SMuFL glyph overrides take priority over value lookup.
        let resolved: Option<Vec<u32>> = if let Some(glyph_names) = dyn_mark.glyphs.as_ref() {
            glyph_names
                .iter()
                .map(|name| smufl::smufl_name_to_codepoint(name))
                .collect()
        } else {
            match smufl::dynamics_glyph(&value) {
                Some(cp) => Some(vec![cp]),
                None => {
                    // Custom dynamics: build from individual letter glyphs
                    // Per SMuFL spec: "Scoring applications may choose to draw
                    // dynamics either using multiple glyphs or using the
                    // pre-composed glyph."
                    let letters: Vec<u32> = value
                        .chars()
                        .filter_map(smufl::dynamics_letter_glyph)
                        .collect();
                    if letters.is_empty() || letters.len() != value.len() {
                        continue;
                    }
                    Some(letters)
                }
            }
        };

        let codepoints = match resolved {
            Some(cps) => cps,
            None => continue,
        };
        let explicit_glyphs = dyn_mark.glyphs.is_some();

        // Convert fractional position to beat position, then to x coordinate
        let beat = dyn_mark.position.beats();

        // Center the dynamic on the actual notehead, whose width depends on the
        // note value (whole noteheads are wider than black/half noteheads).
        let (run_left_sp, run_width_sp, optical_center_sp) =
            if explicit_glyphs && codepoints.len() == 1 {
                let (x, _, width, _) = smufl::glyph_bbox(codepoints[0]);
                (x, width, x + width * 0.5)
            } else if explicit_glyphs {
                let width = codepoints
                    .iter()
                    .map(|codepoint| smufl::glyph_bbox(*codepoint).2 + 0.1)
                    .sum::<f64>()
                    - 0.1;
                (0.0, width.max(0.0), width.max(0.0) * 0.5)
            } else {
                let width = smufl::dynamics_glyph_width(&value);
                (0.0, width, smufl::dynamics_optical_center(&value))
            };
        let optical_center = optical_center_sp * sp;
        let voice_index = dynamic_voice_index(ml, dyn_mark);
        let note_center_x =
            dynamic_note_center_x(ml, dyn_mark, beat, sp, x_origin, content_width, total_beats);
        let dyn_x = note_center_x - optical_center;
        let prefix_width = dyn_mark
            .prefix
            .as_deref()
            .map(|text| text_styles::text_width(text, affix_size, FontFamily::Serif, false))
            .unwrap_or(0.0);
        let suffix_width = dyn_mark
            .suffix
            .as_deref()
            .map(|text| text_styles::text_width(text, affix_size, FontFamily::Serif, false))
            .unwrap_or(0.0);

        // Per-dynamic collision avoidance: only consider events near this dynamic's x position
        let dyn_w = run_width_sp * sp;
        let glyph_left = dyn_x + run_left_sp * sp;
        let glyph_right = glyph_left + dyn_w;
        let dyn_left = glyph_left
            - if prefix_width > 0.0 {
                prefix_width + affix_gap
            } else {
                0.0
            };
        let dyn_right = glyph_right
            + if suffix_width > 0.0 {
                suffix_width + affix_gap
            } else {
                0.0
            };
        let is_above = dynamic_places_above(ml, dyn_mark);
        // Manual placement: a pinned dynamic (`avoidCollisions == false`) sits at
        // the bare datum (just below/above the staff) and ignores the per-event
        // skyline; otherwise it auto-clears notes/articulations as before. The
        // manual [dx, dy] offset (+x right, +y up) is applied on top either way.
        let avoid = dyn_mark.avoid_collisions.unwrap_or(true);
        let [off_x_sp, off_y_sp] = dyn_mark.manual_offset.unwrap_or([0.0, 0.0]);
        let between_y = grand_staff_between_y(staff_y, sp, staff_y_offsets, dyn_mark);
        let dynamics_y = if let Some(center_y) = between_y {
            center_y - dynamic_ink_center_from_baseline(&codepoints) * sp - off_y_sp * sp
        } else if !avoid {
            (if is_above {
                max_dynamics_y_above
            } else {
                min_dynamics_y
            }) - off_y_sp * sp
        } else {
            dynamic_baseline_y(
                ml,
                staff_y,
                sp,
                config,
                dyn_left,
                dyn_right,
                notehead_w,
                is_above,
                if is_above {
                    max_dynamics_y_above
                } else {
                    min_dynamics_y
                },
                glyph_ascent,
                clearance,
                artic_boxes,
                None,
                voice_index,
            ) - off_y_sp * sp
        };
        let dyn_x = dyn_x + off_x_sp * sp;
        let glyph_left = glyph_left + off_x_sp * sp;
        let glyph_right = glyph_right + off_x_sp * sp;
        let eid = element_id::dynamic(
            dyn_mark.source_part_index.unwrap_or(ml.part_index),
            mi,
            &dyn_mark.id,
        );
        let mut union_bbox: Option<BoundingBox> = None;

        if let Some(prefix) = dyn_mark.prefix.as_deref().filter(|text| !text.is_empty()) {
            let x = glyph_left - affix_gap - prefix_width;
            dl.push_tagged(
                RenderCommand::DrawText {
                    x,
                    y: dynamics_y,
                    text: prefix.into(),
                    font: "serif italic".into(),
                    size: affix_size,
                    color: "#000000".into(),
                    align: TextAlign::Left,
                    baseline: TextBaseline::Alphabetic,
                },
                eid.clone(),
            );
            union_bbox = Some(BoundingBox::new(
                x,
                dynamics_y - affix_size * 0.8,
                prefix_width,
                affix_size,
            ));
        }

        if let Some(suffix) = dyn_mark.suffix.as_deref().filter(|text| !text.is_empty()) {
            let x = glyph_right + affix_gap;
            dl.push_tagged(
                RenderCommand::DrawText {
                    x,
                    y: dynamics_y,
                    text: suffix.into(),
                    font: "serif italic".into(),
                    size: affix_size,
                    color: "#000000".into(),
                    align: TextAlign::Left,
                    baseline: TextBaseline::Alphabetic,
                },
                eid.clone(),
            );
            let bbox = BoundingBox::new(x, dynamics_y - affix_size * 0.8, suffix_width, affix_size);
            union_bbox = Some(match union_bbox {
                Some(current) => current.union(&bbox),
                None => bbox,
            });
        }

        if codepoints.len() == 1 {
            // Pre-composed glyph: single draw command
            dl.push_tagged(
                RenderCommand::DrawGlyph {
                    x: dyn_x,
                    y: dynamics_y,
                    codepoint: codepoints[0],
                    font: "Bravura".into(),
                    size: glyph_size,
                    color: "#000000".into(),
                    rotation: 0.0,
                },
                eid.clone(),
            );
            // Selection bbox derives from the SAME drawn position (including
            // the collision/stacking shift baked into `dynamics_y`), so it can
            // never drift from the glyph. See the module note on emit-time
            // geometry being authoritative.
            let dyn_bbox =
                glyph_screen_bbox(dyn_x, dynamics_y, codepoints[0], glyph_size).to_bbox();
            let dyn_bbox = match union_bbox {
                Some(current) => current.union(&dyn_bbox),
                None => dyn_bbox,
            };
            placed_dynamics.push(PlacedDynamic {
                beat,
                baseline_y: dynamics_y,
                x0: dyn_bbox.x,
                x1: dyn_bbox.x + dyn_bbox.width,
                y_top: dyn_bbox.y,
                y_bottom: dyn_bbox.y + dyn_bbox.height,
                above: is_above,
            });
            dl.push_element_bbox_with_shape(ElementBBox {
                element_id: eid,
                bbox: dyn_bbox,
            });
        } else {
            // Custom dynamics: render each letter glyph in sequence with kerning
            let mut cur_x = dyn_x;
            let chars: Vec<char> = value.chars().collect();
            for (j, &cp) in codepoints.iter().enumerate() {
                dl.push_tagged(
                    RenderCommand::DrawGlyph {
                        x: cur_x,
                        y: dynamics_y,
                        codepoint: cp,
                        font: "Bravura".into(),
                        size: glyph_size,
                        color: "#000000".into(),
                        rotation: 0.0,
                    },
                    eid.clone(),
                );
                let letter_bbox = glyph_screen_bbox(cur_x, dynamics_y, cp, glyph_size).to_bbox();
                union_bbox = Some(match union_bbox {
                    Some(u) => u.union(&letter_bbox),
                    None => letter_bbox,
                });
                let advance = if let Some(ch) = chars.get(j) {
                    smufl::dynamics_letter_width(*ch) * sp
                } else {
                    smufl::glyph_bbox(cp).2 * sp
                };
                let kern = if let (Some(a), Some(b)) = (chars.get(j), chars.get(j + 1)) {
                    smufl::dynamics_kern_pair(*a, *b) * sp
                } else {
                    0.1 * sp
                };
                cur_x += advance + kern;
            }
            if let Some(bbox) = union_bbox {
                placed_dynamics.push(PlacedDynamic {
                    beat,
                    baseline_y: dynamics_y,
                    x0: bbox.x,
                    x1: bbox.x + bbox.width,
                    y_top: bbox.y,
                    y_bottom: bbox.y + bbox.height,
                    above: is_above,
                });
                dl.push_element_bbox_with_shape(ElementBBox {
                    element_id: eid,
                    bbox,
                });
            }
        }
    }

    placed_dynamics
}

fn dynamic_ink_center_from_baseline(codepoints: &[u32]) -> f64 {
    let top = codepoints
        .iter()
        .map(|codepoint| smufl::glyph_bbox(*codepoint).1)
        .fold(f64::INFINITY, f64::min);
    let bottom = codepoints
        .iter()
        .map(|codepoint| {
            let (_, y, _, height) = smufl::glyph_bbox(*codepoint);
            y + height
        })
        .fold(f64::NEG_INFINITY, f64::max);
    (top + bottom) * 0.5
}

pub(crate) fn grand_staff_between_y(
    staff_y: f64,
    sp: f64,
    staff_y_offsets: Option<&[f64]>,
    dynamic: &DynamicGroup,
) -> Option<f64> {
    if matches!(
        dynamic.orient,
        Some(MultiStaffOrientation::Above | MultiStaffOrientation::Below)
    ) {
        return None;
    }
    grand_staff_gap_center(staff_y, sp, staff_y_offsets)
}

pub(crate) fn grand_staff_gap_center(
    staff_y: f64,
    sp: f64,
    staff_y_offsets: Option<&[f64]>,
) -> Option<f64> {
    let offsets = staff_y_offsets.filter(|offsets| offsets.len() > 1)?;
    let index = offsets
        .iter()
        .position(|offset| (*offset - staff_y).abs() < 0.01)?;
    if let Some(next) = offsets.get(index + 1) {
        return Some((staff_y + 4.0 * sp + next) * 0.5);
    }
    offsets
        .get(index.checked_sub(1)?)
        .map(|previous| (previous + 4.0 * sp + staff_y) * 0.5)
}
