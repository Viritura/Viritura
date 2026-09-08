#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::render_events::{ArticCategory, ArticGlyph};
use super::super::render_geometry::*;
use super::super::resolve::*;
use super::super::slurs::{SlurParticipationMap, SlurRole, SlurSide};
use super::super::spacing::*;
use super::super::types::*;
use super::arpeggios::*;
use super::articulations::*;
use super::fermatas_trills_ornaments::*;
use super::tremolo_breath::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Render fingering annotations near noteheads.
///
/// Fingerings are placed on the opposite side of the stem (above for stem-up,
/// below for stem-down in single voice). Multiple fingerings stack vertically
/// outward from the notehead. Uses SMuFL fingering glyphs at reduced size.
pub(crate) fn render_fingerings(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let glyph_size = 4.0 * sp * config.fingering_font_scale;

    for vl in &ml.voice_layouts {
        for i in 0..vl.events.len() {
            let event = vl.events.event(i);
            let fingerings = match &event.markings {
                Some(m) => match &m.fingerings {
                    Some(f) if !f.is_empty() => f,
                    _ => continue,
                },
                None => continue,
            };

            let note_positions = vl.events.note_positions(i);
            if note_positions.is_empty() {
                continue;
            }

            let top_pos = note_positions.iter().cloned().fold(f64::INFINITY, f64::min);
            let bottom_pos = note_positions
                .iter()
                .cloned()
                .fold(f64::NEG_INFINITY, f64::max);

            // Place on opposite side of stem (above for stem-up in single voice)
            let stem_up = vl.events.stem_up(i);
            let is_multi_voice = vl.events.num_voices(i) > 1;
            let place_below = if is_multi_voice { !stem_up } else { stem_up };

            let notehead_center_x = vl.events.x(i) + notehead_w * 0.5;

            // Starting position: outside the notehead by fingering_distance
            let mut cur_y = if place_below {
                staff_y + bottom_pos * sp * 0.5 + config.fingering_distance * sp + sp
            } else {
                staff_y + top_pos * sp * 0.5 - config.fingering_distance * sp - sp
            };

            let event_id = event
                .id
                .as_deref()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("e{}", i));
            let base_id = element_id::event(
                vl.part_index_override.unwrap_or(ml.part_index),
                ml.resolved.index,
                vl.seq_index_override.unwrap_or(vl.voice_index),
                &event_id,
            );

            for (fingering_index, f) in fingerings.iter().enumerate() {
                let codepoint = match smufl::fingering_glyph(f.finger) {
                    Some(cp) => cp,
                    None => continue,
                };

                let (_, _, glyph_w, glyph_h) = smufl::glyph_bbox(codepoint);
                let scaled_w = glyph_w * sp * config.fingering_font_scale;
                let fx = notehead_center_x - scaled_w * 0.5;

                let fingering_id = element_id::fingering(&base_id, fingering_index);
                dl.push_tagged(
                    RenderCommand::DrawGlyph {
                        x: fx,
                        y: cur_y,
                        codepoint,
                        font: "Bravura".into(),
                        size: glyph_size,
                        color: "#000000".into(),
                        rotation: 0.0,
                    },
                    fingering_id.clone(),
                );
                dl.push_element_bbox_with_shape(ElementBBox {
                    element_id: fingering_id,
                    bbox: glyph_pixel_bbox(fx, cur_y, codepoint, glyph_size),
                });

                // Stack the next fingering further out
                let step = glyph_h * sp * config.fingering_font_scale + 0.15 * sp;
                if place_below {
                    cur_y += step;
                } else {
                    cur_y -= step;
                }
            }
        }
    }
}
