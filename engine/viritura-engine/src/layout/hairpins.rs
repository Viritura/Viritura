//! Hairpin dynamics rendering — crescendo and decrescendo wedges.

use super::config::LayoutConfig;
use super::element_id;
use super::types::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashMap;

/// Render hairpin dynamics (crescendo/decrescendo wedges) below the staff.
///
/// Hairpins span from a rhythmic position in one measure to a rhythmic position
/// in another (or the same) measure. Crescendo wedges open from left to right;
/// decrescendo wedges close from left to right.
///
/// Positioned at the same vertical level as dynamics markings, below the staff
/// with collision avoidance against notes and stems. Dynamic letters at the
/// same rhythmic position are given priority — the hairpin is offset to avoid
/// overlapping with dynamic glyph extents.
#[allow(clippy::too_many_lines)] // One ordered placement/render pass shares endpoint, skyline, and bbox state.
pub(crate) fn render_hairpins(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    part_index: usize,
    curve_cmd_start: usize,
    slur_geom_start: usize,
    // Absolute y of every staff in this part, indexed by staff number - 1. Only
    // needed for `staffEnd` (diagonal cross-staff wedges); `None` disables it.
    staff_y_offsets: Option<&[f64]>,
) {
    let line_width = 0.16 * sp; // Bravura engravingDefaults.hairpinThickness
    let opening = 0.625 * sp; // half-opening at the wide end (~1.25sp total aperture)
    let staff_bottom = staff_y + 4.0 * sp;
    let notehead_w = 1.18 * sp;
    let hairpin_dyn_gap = 0.3 * sp; // gap between dynamic glyph edge and hairpin tip

    // Snapshot this staff's below-arching slurs so a dynamic-pinned wedge can be
    // pushed below a slur that curves into it (standard engraving practice keeps
    // the wedge outside the slur, never tucked under its arc).
    let staff_slurs: Vec<SlurGeometry> =
        dl.slur_geometries[slur_geom_start.min(dl.slur_geometries.len())..].to_vec();
    let below_slurs: Vec<SlurGeometry> = staff_slurs
        .iter()
        .filter(|geometry| geometry.curve_dir > 0.0)
        .cloned()
        .collect();

    // Build measure ID → index map
    let mut measure_id_map: HashMap<String, usize> = HashMap::new();
    for (i, ml) in measure_layouts.iter().enumerate() {
        if let Some(ref id) = ml.resolved.global.id {
            measure_id_map.insert(id.clone(), i);
        }
    }

    // Vertical position each already-placed group settled on, keyed by group id.
    // A group carrying `visuallyContinues` adopts the y of the group it names so
    // the pair engraves as one continuous line of dynamics.
    let mut placed_group_y: HashMap<String, f64> = HashMap::new();

    for (start_mi, ml) in measure_layouts.iter().enumerate() {
        let dynamics = match &ml.resolved.part.dynamics {
            Some(d) if !d.is_empty() => d,
            _ => continue,
        };
        let hairpins: Vec<&DynamicGroup> = dynamics
            .iter()
            .filter(|group| group.is_gradual() && group.end.is_some() && group.wedge_type.is_some())
            .collect();

        let total_beats = ml.resolved.active_time.measure_beats();
        let content_width = super::render_barlines::rhythmic_content_width(ml, sp);
        let x_origin = ml.x + ml.prefix_width;
        let measure_idx = ml.resolved.index;

        for hp in hairpins {
            let source_part_index = hp.source_part_index.unwrap_or(part_index);
            let is_above = super::render_annotations::dynamic_places_above(ml, hp);
            let voice_index = super::render_annotations::dynamic_voice_index(ml, hp);
            // Compute start x
            let start_beat = hp.position.beats();
            let start_x = find_event_x(
                ml,
                x_origin,
                content_width,
                total_beats,
                start_beat,
                voice_index,
            );

            // Compute end x from measure-rhythmic-position
            let end = hp.end.as_ref().expect("gradual group end validated");
            let end_mi = measure_id_map
                .get(&end.measure)
                .copied()
                .unwrap_or(start_mi);
            let end_ml = &measure_layouts[end_mi];
            let end_total_beats = end_ml.resolved.active_time.measure_beats();
            let end_content_width = super::render_barlines::rhythmic_content_width(end_ml, sp);
            let end_x_origin = end_ml.x + end_ml.prefix_width;
            let end_beat = end.position.beats();
            let end_voice_index = super::render_annotations::dynamic_voice_index(end_ml, hp);
            let end_x = find_event_x(
                end_ml,
                end_x_origin,
                end_content_width,
                end_total_beats,
                end_beat,
                end_voice_index,
            );

            // Offset hairpin start/end to avoid overlapping with dynamics at the same position.
            // Dynamic letters get priority; hairpin is pushed inward to clear the glyph.
            // A dynamic at either end also pins the wedge's vertical spine to the
            // dynamic's optical midline so the hairpin lines up with the letters.
            let mut hp_start_x = start_x;
            let mut hp_end_x = end_x;
            let mut start_dyn_mid: Option<f64> = None;
            let mut end_dyn_mid: Option<f64> = None;

            // Check for dynamic at hairpin start position
            if let Some(ref dynamics) = ml.resolved.part.dynamics {
                for dyn_mark in dynamics {
                    if !dyn_mark.is_gradual()
                        && dyn_mark.voice == hp.voice
                        && super::render_annotations::dynamic_places_above(ml, dyn_mark) == is_above
                        && dyn_mark.position.fraction == hp.position.fraction
                    {
                        let value = dyn_mark.display_value();
                        let glyph_w = smufl::dynamics_glyph_width(&value) * sp;
                        let optical_center = smufl::dynamics_optical_center(&value) * sp;
                        let note_cx = start_x + notehead_w * 0.5;
                        let nominal_left = note_cx - optical_center;
                        let (dyn_left, dyn_right) = dynamic_ink_x_bounds(dl, ml, dyn_mark)
                            .unwrap_or((nominal_left, nominal_left + glyph_w));
                        hp_start_x = dyn_right + hairpin_dyn_gap;
                        let slur_edge = super::render_annotations::lowest_slur_edge_below(
                            &below_slurs,
                            dyn_left,
                            dyn_right,
                        );
                        start_dyn_mid = Some(super::render_annotations::dynamic_optical_midline_y(
                            ml,
                            dyn_mark,
                            staff_y,
                            sp,
                            config,
                            &[],
                            slur_edge,
                        ));
                        break;
                    }
                }
            }

            // Check for dynamic at hairpin end position
            if let Some(ref dynamics) = end_ml.resolved.part.dynamics {
                for dyn_mark in dynamics {
                    if !dyn_mark.is_gradual()
                        && dyn_mark.voice == hp.voice
                        && super::render_annotations::dynamic_places_above(end_ml, dyn_mark)
                            == is_above
                        && dyn_mark.position.fraction == end.position.fraction
                    {
                        let value = dyn_mark.display_value();
                        let optical_center = smufl::dynamics_optical_center(&value) * sp;
                        let glyph_w = smufl::dynamics_glyph_width(&value) * sp;
                        let note_cx = end_x + notehead_w * 0.5;
                        let nominal_left = note_cx - optical_center;
                        let (dyn_left, dyn_right) = dynamic_ink_x_bounds(dl, end_ml, dyn_mark)
                            .unwrap_or((nominal_left, nominal_left + glyph_w));
                        hp_end_x = dyn_left - hairpin_dyn_gap;
                        let slur_edge = super::render_annotations::lowest_slur_edge_below(
                            &below_slurs,
                            dyn_left,
                            dyn_right,
                        );
                        end_dyn_mid = Some(super::render_annotations::dynamic_optical_midline_y(
                            end_ml,
                            dyn_mark,
                            staff_y,
                            sp,
                            config,
                            &[],
                            slur_edge,
                        ));
                        break;
                    }
                }
            }

            // Compute Y position. When a dynamic abuts either end, the wedge
            // spine pins to the dynamic's optical midline so it aligns with the
            // letters (the lower of the two when both ends carry a dynamic, to
            // keep the spine horizontal and clear of both). Otherwise fall back
            // to below-staff collision avoidance.
            let avoid = hp.avoid_collisions.unwrap_or(true);
            let bare_y = if is_above {
                staff_y - config.dynamics_min_distance * sp
            } else {
                staff_bottom + config.dynamics_min_distance * sp
            };
            let automatic_y = match (start_dyn_mid, end_dyn_mid) {
                (Some(a), Some(b)) => {
                    if is_above {
                        a.min(b)
                    } else {
                        a.max(b)
                    }
                }
                (Some(a), None) => a,
                (None, Some(b)) => b,
                (None, None) if is_above => compute_hairpin_y_above(
                    measure_layouts,
                    start_mi,
                    end_mi,
                    start_x,
                    end_x,
                    staff_y,
                    sp,
                    config,
                    dl,
                ),
                (None, None) => compute_hairpin_y(
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
                ),
            };
            let grand_staff_center =
                super::render_annotations::grand_staff_between_y(staff_y, sp, staff_y_offsets, hp);
            let span_lo = hp_start_x.min(hp_end_x);
            let span_hi = hp_start_x.max(hp_end_x);
            let curve_clearance = 1.0 * sp;
            let curve_limit = if is_above {
                let slur_edge = super::render_annotations::highest_slur_edge_above(
                    &staff_slurs,
                    span_lo,
                    span_hi,
                );
                let tie_edge = super::render_annotations::highest_tie_edge_over_span(
                    dl,
                    curve_cmd_start,
                    span_lo,
                    span_hi,
                );
                slur_edge
                    .into_iter()
                    .chain(tie_edge)
                    .reduce(f64::min)
                    .map(|edge| edge - opening - curve_clearance)
            } else {
                let slur_edge = super::render_annotations::lowest_slur_edge_below(
                    &below_slurs,
                    span_lo,
                    span_hi,
                );
                let tie_edge = super::render_annotations::lowest_tie_edge_over_span(
                    dl,
                    curve_cmd_start,
                    span_lo,
                    span_hi,
                );
                slur_edge
                    .into_iter()
                    .chain(tie_edge)
                    .reduce(f64::max)
                    .map(|edge| edge + opening + curve_clearance)
            };
            let automatic_y = curve_limit.map_or(automatic_y, |limit| {
                if is_above {
                    automatic_y.min(limit)
                } else {
                    automatic_y.max(limit)
                }
            });
            let [off_x_sp, off_y_sp] = hp.manual_offset.unwrap_or([0.0, 0.0]);
            hp_start_x += off_x_sp * sp;
            hp_end_x += off_x_sp * sp;
            // An explicit `visuallyContinues` link overrides automatic placement:
            // the wedge adopts the vertical position of the group it continues so
            // the two read as one unit.
            let continued_y = hp.visually_continues.as_ref().and_then(|id| {
                placed_group_y.get(id).copied().or_else(|| {
                    dynamic_midline_by_id(
                        dl,
                        measure_layouts,
                        id,
                        staff_y,
                        sp,
                        config,
                        &below_slurs,
                    )
                })
            });
            let continued_is_explicit = hp.visually_continues.as_ref().is_some_and(|id| {
                measure_layouts.iter().any(|layout| {
                    layout
                        .resolved
                        .part
                        .dynamics
                        .as_ref()
                        .is_some_and(|dynamics| {
                            dynamics.iter().any(|dynamic| {
                                dynamic.id == *id
                                    && (matches!(
                                        dynamic.orient,
                                        Some(
                                            MultiStaffOrientation::Above
                                                | MultiStaffOrientation::Below
                                        )
                                    ) || dynamic
                                        .manual_offset
                                        .is_some_and(|offset| offset != [0.0, 0.0])
                                        || dynamic.avoid_collisions == Some(false))
                            })
                        })
                })
            });
            let resolved_y = if continued_is_explicit {
                continued_y.unwrap_or(automatic_y)
            } else if let Some(center_y) = grand_staff_center {
                center_y
            } else if let Some(continued_y) = continued_y {
                if avoid {
                    curve_limit.map_or(continued_y, |limit| {
                        if is_above {
                            continued_y.min(limit)
                        } else {
                            continued_y.max(limit)
                        }
                    })
                } else {
                    continued_y
                }
            } else if avoid {
                automatic_y
            } else {
                bare_y
            };
            let hairpin_y = resolved_y - off_y_sp * sp;
            placed_group_y.insert(hp.id.clone(), hairpin_y);
            // `staffEnd` angles the wedge down (or up) to a different staff of the
            // same part. Without a staff-y table the marking degrades to a level
            // wedge on its own staff.
            let end_y = hairpin_y
                + hp.staff_end
                    .and_then(|staff| {
                        let target = staff_y_offsets?.get(usize::try_from(staff).ok()? - 1)?;
                        Some(target - staff_y)
                    })
                    .unwrap_or(0.0);

            // Element ID for hit-testing / selection
            let eid = element_id::hairpin(source_part_index, ml.resolved.index, &hp.id);

            // Draw the two lines forming the wedge
            let cmd_idx = dl.commands.len();
            match hp.wedge_type.expect("gradual wedge type validated") {
                WedgeType::Increasing => {
                    // < shape: closed at start, open at end
                    dl.push(RenderCommand::DrawLine {
                        x1: hp_start_x,
                        y1: hairpin_y,
                        x2: hp_end_x,
                        y2: end_y - opening,
                        width: line_width,
                        color: "#000000".into(),
                    });
                    dl.push(RenderCommand::DrawLine {
                        x1: hp_start_x,
                        y1: hairpin_y,
                        x2: hp_end_x,
                        y2: end_y + opening,
                        width: line_width,
                        color: "#000000".into(),
                    });
                }
                WedgeType::Decreasing => {
                    // > shape: open at start, closed at end
                    dl.push(RenderCommand::DrawLine {
                        x1: hp_start_x,
                        y1: hairpin_y - opening,
                        x2: hp_end_x,
                        y2: end_y,
                        width: line_width,
                        color: "#000000".into(),
                    });
                    dl.push(RenderCommand::DrawLine {
                        x1: hp_start_x,
                        y1: hairpin_y + opening,
                        x2: hp_end_x,
                        y2: end_y,
                        width: line_width,
                        color: "#000000".into(),
                    });
                }
            }
            for ci in cmd_idx..dl.commands.len() {
                dl.tag_command(ci, eid.clone());
            }

            // Bounding box for the hairpin spanner. The selection bbox stays
            // the full envelope (what the user grabs), but the *collision*
            // shape is the actual wedge band so later elements clear the ink
            // rather than the empty triangular corners. standard engraving
            // practice: a hairpin reserves only the aperture it actually opens.
            let bbox_x = hp_start_x.min(hp_end_x);
            let bbox_w = (hp_end_x - hp_start_x).abs();
            let bbox_y = hairpin_y.min(end_y) - opening;
            let bbox_h = (hairpin_y - end_y).abs() + opening * 2.0;
            let shape_id = element_id::hairpin(source_part_index, measure_idx, &hp.id);
            dl.element_bboxes.push(ElementBBox {
                element_id: shape_id.clone(),
                bbox: BoundingBox::new(bbox_x, bbox_y, bbox_w, bbox_h),
            });
            // Wedge band: zero aperture at the closed end, full opening at the
            // open end. Crescendo (`<`) opens toward its end x; decrescendo
            // (`>`) opens toward its start x.
            let (lo_x, hi_x) = (hp_start_x.min(hp_end_x), hp_start_x.max(hp_end_x));
            let (lo_y, hi_y) = if hp_start_x <= hp_end_x {
                (hairpin_y, end_y)
            } else {
                (end_y, hairpin_y)
            };
            let cresc = matches!(hp.wedge_type, Some(WedgeType::Increasing));
            let wide_at_right = cresc == (hp_end_x >= hp_start_x);
            let band = if wide_at_right {
                vec![(lo_x, lo_y, lo_y), (hi_x, hi_y - opening, hi_y + opening)]
            } else {
                vec![(lo_x, lo_y - opening, lo_y + opening), (hi_x, hi_y, hi_y)]
            };
            dl.push_shape_band(band, shape_id, ElementKind::Hairpin, None, None);
        }
    }
}

fn dynamic_ink_x_bounds(
    dl: &DisplayList,
    ml: &MeasureLayout,
    dynamic: &DynamicGroup,
) -> Option<(f64, f64)> {
    let eid = element_id::dynamic(
        dynamic.source_part_index.unwrap_or(ml.part_index),
        ml.resolved.index,
        &dynamic.id,
    );
    dl.element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == eid)
        .map(|bbox| (bbox.bbox.x, bbox.bbox.x + bbox.bbox.width))
}

/// Optical midline of the non-gradual dynamic group with the given id, searched
/// across this staff's measures. Used to resolve an explicit
/// `visuallyContinues` link from a wedge to the dynamic letters it continues.
fn dynamic_midline_by_id(
    dl: &DisplayList,
    measure_layouts: &[MeasureLayout],
    group_id: &str,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    below_slurs: &[SlurGeometry],
) -> Option<f64> {
    for ml in measure_layouts {
        let Some(dynamics) = ml.resolved.part.dynamics.as_ref() else {
            continue;
        };
        let Some(dyn_mark) = dynamics
            .iter()
            .find(|group| group.id == group_id && !group.is_gradual())
        else {
            continue;
        };
        let dynamic_id = element_id::dynamic(
            dyn_mark.source_part_index.unwrap_or(ml.part_index),
            ml.resolved.index,
            &dyn_mark.id,
        );
        if let Some(bbox) = dl
            .element_bboxes
            .iter()
            .find(|bbox| bbox.element_id == dynamic_id)
            .map(|bbox| &bbox.bbox)
        {
            return Some(bbox.y + bbox.height * 0.5);
        }
        let value = dyn_mark.display_value();
        let glyph_w = smufl::dynamics_glyph_width(&value) * sp;
        let optical_center = smufl::dynamics_optical_center(&value) * sp;
        let total_beats = ml.resolved.active_time.measure_beats();
        let content_width = super::render_barlines::rhythmic_content_width(ml, sp);
        let x_origin = ml.x + ml.prefix_width;
        let note_cx = find_event_x(
            ml,
            x_origin,
            content_width,
            total_beats,
            dyn_mark.position.beats(),
            super::render_annotations::dynamic_voice_index(ml, dyn_mark),
        ) + 1.18 * sp * 0.5;
        let dyn_left = note_cx - optical_center;
        let slur_edge = super::render_annotations::lowest_slur_edge_below(
            below_slurs,
            dyn_left,
            dyn_left + glyph_w,
        );
        return Some(super::render_annotations::dynamic_optical_midline_y(
            ml,
            dyn_mark,
            staff_y,
            sp,
            config,
            &[],
            slur_edge,
        ));
    }
    None
}

/// Compute an above-staff hairpin center, mirroring the below-staff skyline
/// rule while respecting note/stem and already-emitted annotation ink.
#[allow(clippy::too_many_arguments)]
fn compute_hairpin_y_above(
    measure_layouts: &[MeasureLayout],
    start_mi: usize,
    end_mi: usize,
    start_x: f64,
    end_x: f64,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    dl: &DisplayList,
) -> f64 {
    let mut highest_y = staff_y;
    let mi_lo = start_mi.min(end_mi);
    let mi_hi = start_mi.max(end_mi).min(measure_layouts.len() - 1);
    for ml in &measure_layouts[mi_lo..=mi_hi] {
        highest_y = highest_y.min(super::render_annotations::highest_point_in_range(
            ml,
            staff_y,
            sp,
            config.stem_length,
            start_x - sp,
            end_x + sp,
        ));
    }

    let exclude_connectors = [
        ElementKind::Hairpin,
        ElementKind::Pedal,
        ElementKind::Tie,
        ElementKind::Volta,
    ];
    if let Some(sky_top) = dl.skyline_top(start_x - sp, end_x + sp, staff_y, |kind| {
        !kind.is_note_cluster_core() && !exclude_connectors.contains(&kind)
    }) {
        highest_y = highest_y.min(sky_top);
    }

    let max_y = staff_y - config.dynamics_min_distance * sp;
    max_y.min(highest_y - sp)
}

/// Find the x coordinate for a beat position.
/// If an event exists at (or very near) the target beat, snap to its x position.
/// Otherwise use proportional placement within the measure.
fn find_event_x(
    ml: &MeasureLayout,
    x_origin: f64,
    content_width: f64,
    total_beats: f64,
    target_beat: f64,
    voice_index: Option<usize>,
) -> f64 {
    let proportional_x = x_origin + (target_beat / total_beats) * content_width;

    // Only snap to an event if it's within a small beat tolerance. Use each
    // event's tuplet-scaled `beat_position` rather than summing nominal
    // durations — inside a tuplet the nominal durations overshoot the real
    // beat span and would otherwise snap a measure-end target onto the last
    // tuplet note, leaving a large gap to the barline.
    let snap_tolerance = 0.1; // less than a 32nd note
    let mut best_x = proportional_x;
    let mut best_dist = snap_tolerance;

    for vl in &ml.voice_layouts {
        if voice_index.is_some_and(|index| vl.voice_index != index) {
            continue;
        }
        if vl.is_centered_bar_rest(total_beats) {
            continue;
        }
        for i in 0..vl.events.len() {
            let dist = (vl.events.beat_position(i) - target_beat).abs();
            if dist < best_dist {
                best_dist = dist;
                best_x = vl.events.x(i);
            }
        }
    }
    best_x
}

/// Compute the Y position for a hairpin, avoiding collisions with notes below the staff.
fn compute_hairpin_y(
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

    // Skyline pass: pick up below-staff articulations, fermatas, dynamics,
    // ornaments, tremolos, slurs, and any other registered shapes within the
    // hairpin's X-span. This lets a hairpin clear, e.g., a staccato dot
    // below a stem-down note that the rough note/stem walk above misses, or a
    // slur arching below the staff (standard engraving practice keeps the wedge
    // outside the slur). Skip the note-cluster-core substrate the note/stem
    // walk already bounded (see `is_note_cluster_core`), and the connectors a
    // hairpin must not read: peer hairpins (same-level peers stack via
    // dynamics_min_distance), pedals (which sit below hairpins by convention),
    // ties (at notehead level, not a wedge obstacle), and voltas. Tremolos
    // remain obstacles — they are substrate the walk does not cover.
    let exclude_connectors = [
        ElementKind::Hairpin,
        ElementKind::Pedal,
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

    // Position hairpin center below the lowest element with clearance
    let min_y = staff_bottom + config.dynamics_min_distance * sp;
    let clearance = 1.0 * sp;
    min_y.max(lowest_y + clearance)
}
