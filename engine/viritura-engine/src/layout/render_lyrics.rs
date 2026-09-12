// Extracted from render_measure.rs — render_lyrics

use super::config::LayoutConfig;
use super::element_id;
use super::text_styles;
use super::types::*;
use crate::model::*;
use crate::render::*;
use std::collections::HashSet;

/// Resolve the lyric rows used by one rendered staff across a whole system.
///
/// Global order controls relative placement, while filtering to the staff's
/// used lines avoids reserving empty rows for unrelated vocal parts.
pub(super) fn line_order_for_staff(
    measure_layouts: &[MeasureLayout],
    global_order: Option<&[String]>,
) -> Option<Vec<String>> {
    let mut used = HashSet::new();
    for measure in measure_layouts {
        for voice in &measure.voice_layouts {
            for event_index in 0..voice.events.len() {
                if let Some(lines) = voice
                    .events
                    .event(event_index)
                    .lyrics
                    .as_ref()
                    .and_then(|lyrics| lyrics.lines.as_ref())
                {
                    used.extend(lines.keys().cloned());
                }
            }
        }
    }

    let mut ordered = Vec::with_capacity(used.len());
    if let Some(global_order) = global_order {
        for line_id in global_order {
            if used.remove(line_id) {
                ordered.push(line_id.clone());
            }
        }
    }
    let mut remaining: Vec<String> = used.into_iter().collect();
    remaining.sort();
    ordered.extend(remaining);
    (!ordered.is_empty()).then_some(ordered)
}

/// Render lyrics text below the staff for events that carry lyrics.
///
/// Each syllable is centered on its notehead's x position. If the syllable
/// type is `Start` or `Middle`, a continuation dash is drawn midway between
/// the current note and the next note (or a fixed offset at measure end).
/// Multiple lyric lines (verses) are stacked vertically.
pub(crate) fn render_lyrics(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    lyric_line_order: Option<&[String]>,
) {
    let staff_bottom = staff_y + 4.0 * sp;
    let notehead_w = 1.18 * sp;
    let font_size = 1.6 * sp;
    // First lyric line's top ink edge sits `attach_gap` below the bottom staff
    // line, and successive verses stack `padding.vertical` apart — both from the
    // placement table (`lyric.attachGap` / `.padding.vertical`) rather than
    // baked-in literals. `TextBaseline::Top` means `base_lyric_y` IS the top ink
    // edge, so the gap is edge-honest.
    let lyric_metrics = config.placement.resolve(ElementKind::Lyric);
    let base_lyric_y = staff_bottom + lyric_metrics.attach_gap * sp;
    let line_spacing = lyric_metrics.padding.vertical * sp;

    for vl in &ml.voice_layouts {
        let event_count = vl.events.len();
        for ei in 0..event_count {
            let lyrics = match &vl.events.event(ei).lyrics {
                Some(l) => l,
                None => continue,
            };
            let lines = match &lyrics.lines {
                Some(l) if !l.is_empty() => l,
                _ => continue,
            };

            let fallback_order;
            let ordered_ids = if let Some(order) = lyric_line_order {
                order
            } else {
                fallback_order = {
                    let mut ids: Vec<String> = lines.keys().cloned().collect();
                    ids.sort();
                    ids
                };
                &fallback_order
            };

            for (line_index, line_id) in ordered_ids.iter().enumerate() {
                let Some(line) = lines.get(line_id) else {
                    continue;
                };
                let lyric_y = base_lyric_y + line_index as f64 * line_spacing;
                let lyric_x = vl.events.x(ei) + notehead_w * 0.5;
                let event = vl.events.event(ei);
                let event_suffix = element_id::event_suffix(event.id.as_deref(), ei);
                let event_id = element_id::event(
                    vl.part_index_override.unwrap_or(ml.part_index),
                    ml.resolved.index,
                    vl.seq_index_override.unwrap_or(vl.voice_index),
                    &event_suffix,
                );
                let lyric_id = element_id::lyric(&event_id, line_id);
                let text_width = text_styles::text_width(
                    &line.text,
                    font_size,
                    text_styles::FontFamily::Serif,
                    false,
                );

                dl.push_tagged(
                    RenderCommand::DrawText {
                        x: lyric_x,
                        y: lyric_y,
                        text: line.text.clone(),
                        font: "serif".into(),
                        size: font_size,
                        color: "#000000".into(),
                        align: TextAlign::Center,
                        baseline: TextBaseline::Top,
                    },
                    lyric_id.clone(),
                );
                dl.push_element_bbox_with_shape(ElementBBox {
                    element_id: lyric_id.clone(),
                    bbox: BoundingBox::new(
                        lyric_x - text_width * 0.5,
                        lyric_y,
                        text_width.max(sp),
                        font_size,
                    ),
                });

                // Draw continuation dash for start/middle syllables
                if matches!(
                    line.syllable_type,
                    Some(LyricLineType::Start) | Some(LyricLineType::Middle)
                ) {
                    let next_x = if ei + 1 < event_count {
                        vl.events.x(ei + 1) + notehead_w * 0.5
                    } else {
                        lyric_x + 3.0 * sp
                    };
                    let dash_x = (lyric_x + next_x) / 2.0;

                    dl.push_tagged(
                        RenderCommand::DrawText {
                            x: dash_x,
                            y: lyric_y,
                            text: "\u{2010}".into(),
                            font: "serif".into(),
                            size: font_size,
                            color: "#000000".into(),
                            align: TextAlign::Center,
                            baseline: TextBaseline::Top,
                        },
                        lyric_id,
                    );
                }
            }
        }
    }
}
