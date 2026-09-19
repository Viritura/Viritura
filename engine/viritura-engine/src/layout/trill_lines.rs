//! Trill-extension rendering.
//!
//! A trill extension is a horizontal connector from a trill-bearing event to
//! another event. It tiles the SMuFL `wiggleTrill` segment and intentionally
//! uses the active engraving font rather than preserving source-application
//! font choices.

use super::config::LayoutConfig;
use super::element_id;
use super::render_measure::cross_staff_y_scalar;
use super::types::*;
use crate::model::TrillExtensionTargetEdge;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::HashMap;

struct TrillLineEndpoint {
    x: f64,
    end_x: f64,
    baseline_y: f64,
    notehead_w: f64,
}

pub(crate) type TrillLineStaff<'a> = (&'a [MeasureLayout], f64);

pub(crate) fn render_trill_lines_for_system(
    dl: &mut DisplayList,
    layouts: &[Vec<MeasureLayout>],
    staff_y_offsets: &[f64],
    sp: f64,
    config: &LayoutConfig,
) {
    let staves: Vec<TrillLineStaff<'_>> = layouts
        .iter()
        .enumerate()
        .map(|(index, measures)| (measures.as_slice(), staff_y_offsets[index]))
        .collect();
    render_trill_lines(dl, &staves, sp, config, Some(staff_y_offsets));
}

pub(crate) fn trill_baseline_y(
    el: &EventLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) -> f64 {
    let default_y = staff_y - config.trill_above_staff * sp;
    if el.note_positions.is_empty() {
        return default_y;
    }
    let top_pos = el
        .note_positions
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let note_y = staff_y + top_pos * sp * 0.5;
    let stem_tip_y = if el.stem_up && el.event.duration.base.has_stem() {
        note_y - config.stem_length * sp
    } else {
        note_y
    };
    default_y.min(stem_tip_y - sp)
}

pub(crate) fn render_trill_lines(
    dl: &mut DisplayList,
    staves: &[TrillLineStaff<'_>],
    sp: f64,
    config: &LayoutConfig,
    staff_y_offsets: Option<&[f64]>,
) {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let mut event_map: HashMap<String, TrillLineEndpoint> = HashMap::new();

    for &(measure_layouts, staff_y) in staves {
        for ml in measure_layouts {
            for vl in &ml.voice_layouts {
                for index in 0..vl.events.len() {
                    let Some(id) = vl.events.id(index) else {
                        continue;
                    };
                    let el = vl.events.to_event_layout(index);
                    let event_staff_y = cross_staff_y_scalar(
                        el.event.staff,
                        vl.events.sequence_staff(index),
                        staff_y,
                        staff_y_offsets,
                    );
                    event_map.insert(
                        id.to_string(),
                        TrillLineEndpoint {
                            x: el.x,
                            end_x: if index + 1 < vl.events.len() {
                                vl.events.x(index + 1)
                            } else {
                                ml.x + ml.width - 0.5 * sp
                            },
                            baseline_y: trill_baseline_y(&el, event_staff_y, sp, config),
                            notehead_w,
                        },
                    );
                }
            }
        }
    }

    for &(measure_layouts, _) in staves {
        for ml in measure_layouts {
            for vl in &ml.voice_layouts {
                for index in 0..vl.events.len() {
                    let event = vl.events.event(index);
                    let Some(trill) = event
                        .markings
                        .as_ref()
                        .and_then(|markings| markings.trill.as_ref())
                    else {
                        continue;
                    };
                    let Some(extension) = &trill.extension else {
                        continue;
                    };
                    let source_id = vl.events.id(index).unwrap_or("");
                    let (Some(source), Some(target)) =
                        (event_map.get(source_id), event_map.get(&extension.target))
                    else {
                        continue;
                    };

                    let symbol_width = if trill.show_symbol == Some(false) {
                        0.0
                    } else {
                        smufl::glyph_bbox(smufl::ORNAMENT_TRILL).2 * sp
                    };
                    let start_x =
                        source.x + source.notehead_w * 0.5 + symbol_width * 0.5 + 0.15 * sp;
                    let end_x = if matches!(
                        extension.target_edge.as_ref(),
                        Some(TrillExtensionTargetEdge::End)
                    ) {
                        target.end_x
                    } else {
                        target.x + target.notehead_w * 0.5
                    };
                    if end_x <= start_x {
                        continue;
                    }

                    emit_trill_wiggle(
                        dl,
                        start_x,
                        end_x,
                        source.baseline_y,
                        sp,
                        &element_id::trill_line(source_id, &extension.target),
                    );
                }
            }
        }
    }
}

fn emit_trill_wiggle(
    dl: &mut DisplayList,
    start_x: f64,
    end_x: f64,
    baseline_y: f64,
    sp: f64,
    element_id: &str,
) {
    let available = end_x - start_x;
    let advance = smufl::WIGGLE_TRILL_SEGMENT_WIDTH * sp;
    let count = (available / advance).floor() as usize;
    if count == 0 {
        return;
    }
    let lead = (available - count as f64 * advance) * 0.5;
    let mut bbox: Option<BoundingBox> = None;
    for index in 0..count {
        let command = RenderCommand::DrawGlyph {
            x: start_x + lead + index as f64 * advance,
            y: baseline_y,
            codepoint: smufl::WIGGLE_TRILL,
            font: "Bravura".into(),
            size: 4.0 * sp,
            color: "#000000".into(),
            rotation: 0.0,
        };
        if let Some(command_bbox) = command.bbox() {
            bbox = Some(match bbox {
                Some(current) => current.union(&command_bbox),
                None => command_bbox,
            });
        }
        dl.push_tagged(command, element_id.to_string());
    }
    if let Some(bbox) = bbox {
        let pad_x = 0.15 * sp;
        let pad_y = 0.35 * sp;
        dl.element_bboxes.push(ElementBBox {
            element_id: element_id.to_string(),
            bbox: BoundingBox::new(
                bbox.x - pad_x,
                bbox.y - pad_y,
                bbox.width + pad_x * 2.0,
                bbox.height + pad_y * 2.0,
            ),
        });
    }
}
