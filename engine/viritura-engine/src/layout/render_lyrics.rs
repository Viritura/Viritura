// Extracted from render_measure.rs — render_lyrics

use super::config::LayoutConfig;
use super::types::*;
use crate::model::*;
use crate::render::*;

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

            // Use explicit lineOrder if provided, otherwise sort IDs alphabetically
            let ordered_ids: Vec<&String> = if let Some(order) = lyric_line_order {
                order.iter().filter(|id| lines.contains_key(*id)).collect()
            } else {
                let mut ids: Vec<&String> = lines.keys().collect();
                ids.sort();
                ids
            };

            for (li, line_id) in ordered_ids.iter().enumerate() {
                let line = &lines[*line_id];
                let lyric_y = base_lyric_y + li as f64 * line_spacing;
                let lyric_x = vl.events.x(ei) + notehead_w * 0.5;

                dl.push(RenderCommand::DrawText {
                    x: lyric_x,
                    y: lyric_y,
                    text: line.text.clone(),
                    font: "serif".into(),
                    size: font_size,
                    color: "#000000".into(),
                    align: TextAlign::Center,
                    baseline: TextBaseline::Top,
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

                    dl.push(RenderCommand::DrawText {
                        x: dash_x,
                        y: lyric_y,
                        text: "\u{2010}".into(),
                        font: "serif".into(),
                        size: font_size,
                        color: "#000000".into(),
                        align: TextAlign::Center,
                        baseline: TextBaseline::Top,
                    });
                }
            }
        }
    }
}
