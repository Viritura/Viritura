use super::super::element_id;
use super::super::render_geometry::staff_obstacle_band;
use super::participation::{EventRenderInfo, SlurObstacle};
use super::tie_lanes::TieTips;
use super::tuning;
use crate::render::{DisplayList, ElementKind, ShapeGeom};
use std::collections::HashMap;

#[derive(Clone, Copy)]
pub(super) struct TupletObstacle {
    pub(super) left: f64,
    pub(super) right: f64,
    pub(super) top: f64,
    pub(super) bottom: f64,
}

/// Merge exact event-owned substrate geometry from the score-global shape
/// registry into one staff's endpoint snapshots and obstacle list.
pub(super) fn collect_shape_obstacles(
    dl: &DisplayList,
    event_map: &mut HashMap<String, EventRenderInfo>,
    obstacles: &mut Vec<SlurObstacle>,
    staff_shape_start: usize,
    staff_y: f64,
    sp: f64,
) -> Vec<TupletObstacle> {
    let mut tuplet_obstacles = Vec::new();
    let (shape_band_lo, shape_band_hi) = staff_obstacle_band(staff_y, sp);
    for shape in dl.element_shapes.iter().skip(staff_shape_start) {
        let is_articulation = matches!(shape.kind, ElementKind::Articulation);
        let is_fermata = matches!(shape.kind, ElementKind::Fermata);
        let is_beam = matches!(shape.kind, ElementKind::Beam);
        let is_tuplet = matches!(shape.kind, ElementKind::Tuplet);
        let is_accidental = matches!(shape.kind, ElementKind::Accidental);
        let is_dot = matches!(shape.kind, ElementKind::AugmentationDot);
        let is_ledger = matches!(shape.kind, ElementKind::LedgerLine);
        let is_tie = matches!(shape.kind, ElementKind::Tie);
        if !(is_articulation
            || is_fermata
            || is_beam
            || is_tuplet
            || is_accidental
            || is_dot
            || is_ledger
            || is_tie)
        {
            continue;
        }
        let Some(bbox) = shape.bbox(&dl.commands) else {
            continue;
        };
        let center_y = bbox.y + bbox.height * 0.5;
        let inside_shape_band = center_y >= shape_band_lo && center_y <= shape_band_hi;
        if is_articulation || is_fermata {
            merge_articulation_shape(
                event_map,
                obstacles,
                &shape.element_id,
                bbox,
                is_articulation,
                inside_shape_band,
            );
            continue;
        }
        if !inside_shape_band {
            continue;
        }

        if is_tie {
            if let ShapeGeom::Band { samples } = &shape.geom {
                let tie_extra =
                    (tuning::TIE_CLEARANCE_SP - tuning::ENCOMPASS_CLEARANCE_SP).max(0.0) * sp;
                let left_x = samples.first().map(|sample| sample.0).unwrap_or(bbox.x);
                let right_x = samples
                    .last()
                    .map(|sample| sample.0)
                    .unwrap_or(bbox.x + bbox.width);
                let midpoint_x = (left_x + right_x) * 0.5;
                let left_owner = nearest_event_id(event_map, left_x, sp);
                let right_owner = nearest_event_id(event_map, right_x, sp);
                record_tie_tips(
                    event_map,
                    samples,
                    left_owner.as_deref(),
                    right_owner.as_deref(),
                );
                obstacles.extend(samples.iter().map(|&(x, y_top, y_bottom)| SlurObstacle {
                    event_id: if x <= midpoint_x {
                        left_owner.clone()
                    } else {
                        right_owner.clone()
                    },
                    voice_idx: 0,
                    x,
                    y_top: y_top - tie_extra,
                    y_bottom: y_bottom + tie_extra,
                    notehead_y_top: None,
                    notehead_y_bottom: None,
                    is_tie: true,
                    is_articulation: false,
                }));
            } else {
                obstacles.push(shape_obstacle(None, 0, bbox, false, true));
            }
        } else if is_beam {
            let polygon = match &shape.geom {
                ShapeGeom::Cmd { cmd_idx } => {
                    dl.commands
                        .get(*cmd_idx as usize)
                        .and_then(|command| match command {
                            crate::render::RenderCommand::DrawPolygon { points, .. } => {
                                Some(points.as_slice())
                            }
                            _ => None,
                        })
                }
                _ => None,
            };
            merge_beam_shape(event_map, obstacles, bbox, polygon, sp);
        } else if is_tuplet {
            tuplet_obstacles.push(TupletObstacle {
                left: bbox.x,
                right: bbox.x + bbox.width,
                top: bbox.y,
                bottom: bbox.y + bbox.height,
            });
        } else if is_accidental || is_dot {
            merge_event_shape(event_map, obstacles, &shape.element_id, bbox, is_accidental);
        } else {
            obstacles.push(shape_obstacle(None, 0, bbox, false, false));
        }
    }
    tuplet_obstacles
}

/// Collect tie bands overlapping `[x_lo, x_hi]` on the staff at `staff_y`,
/// and report the tie tips landing on the two endpoint X positions.
///
/// The per-staff pass above only ever looks at shapes published *after* its
/// own staff started rendering, which is exactly right while a slur lives
/// inside one system. A slur spanning a stitched horizon chunk seam is
/// emitted by the cross-system path instead, whose obstacle set is built from
/// the global event list — noteheads and stems, but no ties. Without this
/// sweep such a slur has no idea the tie exists and collapses inside it.
pub(super) fn collect_seam_span_tie_obstacles(
    dl: &DisplayList,
    obstacles: &mut Vec<SlurObstacle>,
    staff_y: f64,
    src_x: f64,
    tgt_x: f64,
    sp: f64,
) -> (TieTips, TieTips) {
    let (band_lo, band_hi) = staff_obstacle_band(staff_y, sp);
    let (x_lo, x_hi) = if src_x <= tgt_x {
        (src_x, tgt_x)
    } else {
        (tgt_x, src_x)
    };
    let tie_extra = (tuning::TIE_CLEARANCE_SP - tuning::ENCOMPASS_CLEARANCE_SP).max(0.0) * sp;
    let mut src_tips = TieTips::default();
    let mut tgt_tips = TieTips::default();
    for shape in &dl.element_shapes {
        if !matches!(shape.kind, ElementKind::Tie) {
            continue;
        }
        let ShapeGeom::Band { samples } = &shape.geom else {
            continue;
        };
        let (Some(first), Some(last)) = (samples.first(), samples.last()) else {
            continue;
        };
        if last.0 < x_lo || first.0 > x_hi {
            continue;
        }
        let middle = samples[samples.len() / 2];
        let tip_center = (first.1 + first.2 + last.1 + last.2) * 0.25;
        if tip_center < band_lo || tip_center > band_hi {
            continue;
        }
        obstacles.extend(samples.iter().map(|&(x, y_top, y_bottom)| SlurObstacle {
            event_id: None,
            voice_idx: 0,
            x,
            y_top: y_top - tie_extra,
            y_bottom: y_bottom + tie_extra,
            notehead_y_top: None,
            notehead_y_bottom: None,
            is_tie: true,
            is_articulation: false,
        }));
        let curves_above = (middle.1 + middle.2) * 0.5 < tip_center;
        for sample in [first, last] {
            let tip = if curves_above { sample.1 } else { sample.2 };
            if (sample.0 - src_x).abs() <= 1.25 * sp {
                src_tips.merge(tip, curves_above);
            }
            if (sample.0 - tgt_x).abs() <= 1.25 * sp {
                tgt_tips.merge(tip, curves_above);
            }
        }
    }
    (src_tips, tgt_tips)
}

fn nearest_event_id(
    event_map: &HashMap<String, EventRenderInfo>,
    target_x: f64,
    sp: f64,
) -> Option<String> {
    event_map
        .iter()
        .map(|(event_id, endpoint)| {
            let note_center_x = endpoint.x + endpoint.notehead_w * 0.5;
            (event_id, (note_center_x - target_x).abs())
        })
        // Break distance ties on the event id. Two events are routinely
        // equidistant here — the notes of a chord, or two voices sharing a
        // column — and `min_by` keeps the first minimum it meets, so without
        // a tie-break the winner follows `HashMap` iteration order. That
        // order is not stable even within one process: `RandomState` bumps
        // its seed for every map created, so successive layouts of the same
        // score would attribute a tie's tip to different events and place any
        // slur sharing that notehead in a different lane.
        .min_by(|left, right| left.1.total_cmp(&right.1).then_with(|| left.0.cmp(right.0)))
        .filter(|(_, distance)| *distance <= 1.25 * sp)
        .map(|(event_id, _)| event_id.clone())
}

/// Record each tie tip's outer Y on the event that owns it, keyed by the side
/// the tie curves toward.
///
/// Slurs and ties obey one nesting rule: at a shared notehead the shorter span
/// hugs the head and every enclosing span takes the next lane outward. The slur
/// endpoint pass needs the tie's *actual* tip to place that lane, because a
/// fixed offset either collapses onto the tie (when the tie sits far from the
/// head) or floats away from it. When several ties stack on one chord, the
/// outermost tip per side wins — that is the one an enclosing slur must clear.
fn record_tie_tips(
    event_map: &mut HashMap<String, EventRenderInfo>,
    samples: &[(f64, f64, f64)],
    left_owner: Option<&str>,
    right_owner: Option<&str>,
) {
    let (Some(first), Some(last)) = (samples.first(), samples.last()) else {
        return;
    };
    let middle = samples[samples.len() / 2];
    let tip_center = (first.1 + first.2 + last.1 + last.2) * 0.25;
    let curves_above = (middle.1 + middle.2) * 0.5 < tip_center;
    for (owner, sample) in [(left_owner, first), (right_owner, last)] {
        let Some(endpoint) = owner.and_then(|id| event_map.get_mut(id)) else {
            continue;
        };
        if curves_above {
            let tip = sample.1;
            endpoint.tie_tip_above_y = Some(endpoint.tie_tip_above_y.map_or(tip, |y| y.min(tip)));
        } else {
            let tip = sample.2;
            endpoint.tie_tip_below_y = Some(endpoint.tie_tip_below_y.map_or(tip, |y| y.max(tip)));
        }
    }
}
fn merge_beam_shape(
    event_map: &mut HashMap<String, EventRenderInfo>,
    obstacles: &mut Vec<SlurObstacle>,
    bbox: crate::render::BoundingBox,
    polygon: Option<&[(f64, f64)]>,
    sp: f64,
) {
    let right = bbox.x + bbox.width;
    let bottom = bbox.y + bbox.height;
    for endpoint in event_map.values_mut() {
        let stem_x = if endpoint.stem_up {
            endpoint.x + endpoint.notehead_w
        } else {
            endpoint.x
        };
        if endpoint.is_beamed && stem_x >= bbox.x - 0.1 * sp && stem_x <= right + 0.1 * sp {
            let (top, bottom) = polygon
                .and_then(|points| polygon_vertical_slice(points, stem_x))
                .unwrap_or((bbox.y, bottom));
            endpoint.beam_top_y = Some(endpoint.beam_top_y.map_or(top, |y| y.min(top)));
            endpoint.beam_bottom_y = Some(endpoint.beam_bottom_y.map_or(bottom, |y| y.max(bottom)));
        }
    }

    obstacles.push(shape_obstacle(None, 0, bbox, false, false));
}

fn polygon_vertical_slice(points: &[(f64, f64)], x: f64) -> Option<(f64, f64)> {
    if points.len() < 3 {
        return None;
    }
    let mut intersections = Vec::with_capacity(4);
    for index in 0..points.len() {
        let (x1, y1) = points[index];
        let (x2, y2) = points[(index + 1) % points.len()];
        let lo = x1.min(x2);
        let hi = x1.max(x2);
        if x < lo - 1.0e-6 || x > hi + 1.0e-6 {
            continue;
        }
        if (x2 - x1).abs() < 1.0e-9 {
            intersections.push(y1);
            intersections.push(y2);
        } else {
            let t = ((x - x1) / (x2 - x1)).clamp(0.0, 1.0);
            intersections.push(y1 + (y2 - y1) * t);
        }
    }
    if intersections.len() < 2 {
        return None;
    }
    Some((
        intersections.iter().copied().fold(f64::INFINITY, f64::min),
        intersections
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max),
    ))
}

fn merge_event_shape(
    event_map: &mut HashMap<String, EventRenderInfo>,
    obstacles: &mut Vec<SlurObstacle>,
    element_id: &str,
    bbox: crate::render::BoundingBox,
    is_accidental: bool,
) {
    let marker = if is_accidental {
        "/accidental/"
    } else {
        "/dot/"
    };
    let Some((owner_prefix, _)) = element_id.split_once(marker) else {
        return;
    };
    let owner = if event_map.contains_key(owner_prefix) {
        owner_prefix
    } else {
        owner_prefix.rsplit('/').next().unwrap_or(owner_prefix)
    };
    let Some(endpoint) = event_map.get_mut(owner) else {
        return;
    };
    let right = bbox.x + bbox.width;
    if is_accidental {
        endpoint.accidental_right_x =
            Some(endpoint.accidental_right_x.map_or(right, |x| x.max(right)));
    } else {
        endpoint.dot_right_x = Some(endpoint.dot_right_x.map_or(right, |x| x.max(right)));
    }
    obstacles.push(shape_obstacle(
        Some(owner.to_string()),
        endpoint.voice_idx,
        bbox,
        false,
        false,
    ));
}

fn merge_articulation_shape(
    event_map: &mut HashMap<String, EventRenderInfo>,
    obstacles: &mut Vec<SlurObstacle>,
    element_id: &str,
    bbox: crate::render::BoundingBox,
    is_articulation: bool,
    include_obstacle: bool,
) {
    let base = if is_articulation {
        if let Some(base) = element_id.strip_suffix("/artic") {
            base
        } else {
            // Per-glyph articulation ids name their marking: `/art-accent`,
            // `/art-accent.staccato`.
            let Some((base, name)) = element_id.rsplit_once("/art-") else {
                return;
            };
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.')
            {
                return;
            }
            base
        }
    } else {
        let Some(base) = element_id
            .strip_suffix("/fermata")
            .or_else(|| element_id.strip_suffix("/ferm"))
        else {
            return;
        };
        base
    };
    let event_id = base.rsplit('/').next().unwrap_or(base);
    let Some(endpoint) = event_map.get_mut(event_id) else {
        return;
    };
    if is_articulation {
        let right = bbox.x + bbox.width;
        let bottom = bbox.y + bbox.height;
        endpoint.articulation_extent = Some(match endpoint.articulation_extent {
            Some((top, old_bottom)) => (top.min(bbox.y), old_bottom.max(bottom)),
            None => (bbox.y, bottom),
        });
        endpoint.articulation_x_extent = Some(match endpoint.articulation_x_extent {
            Some((left, old_right)) => (left.min(bbox.x), old_right.max(right)),
            None => (bbox.x, right),
        });
        if !endpoint
            .articulation_element_ids
            .iter()
            .any(|id| id == element_id)
        {
            endpoint
                .articulation_element_ids
                .push(element_id.to_string());
        }
    } else {
        for id in [element_id.to_string(), element_id::fermata(base)] {
            if !endpoint
                .fermata_element_ids
                .iter()
                .any(|current| current == &id)
            {
                endpoint.fermata_element_ids.push(id);
            }
        }
    }
    if include_obstacle {
        obstacles.push(shape_obstacle(
            Some(event_id.to_string()),
            endpoint.voice_idx,
            bbox,
            is_articulation,
            false,
        ));
    }
}

fn shape_obstacle(
    event_id: Option<String>,
    voice_idx: usize,
    bbox: crate::render::BoundingBox,
    is_articulation: bool,
    is_tie: bool,
) -> SlurObstacle {
    SlurObstacle {
        event_id,
        voice_idx,
        x: bbox.x + bbox.width * 0.5,
        y_top: bbox.y,
        y_bottom: bbox.y + bbox.height,
        notehead_y_top: None,
        notehead_y_bottom: None,
        is_tie,
        is_articulation,
    }
}
