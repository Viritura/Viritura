use crate::layout::text_styles::{self, FontFamily};
use crate::model::{TextContent, TextContentChunk, TextDecoration, TextRunStyle, TextWeight};
use crate::render::smufl::smufl;
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};

pub(super) fn content_width(
    content: &TextContent,
    base_size: f64,
    default_family: FontFamily,
    default_bold: bool,
) -> f64 {
    content
        .chunks()
        .iter()
        .map(|chunk| chunk_width(chunk, base_size, default_family, default_bold))
        .sum()
}

pub(super) fn content_height(content: &TextContent, base_size: f64) -> f64 {
    let max_multiplier = content
        .chunks()
        .iter()
        .map(|chunk| match chunk {
            TextContentChunk::Text(run) => run
                .style
                .as_ref()
                .and_then(|style| style.size)
                .unwrap_or(1.0),
            TextContentChunk::Glyph(run) => {
                merge_styles(run.style.as_ref(), run.smufl_style.as_ref())
                    .and_then(|style| style.size)
                    .unwrap_or(1.0)
            }
        })
        .fold(1.0, f64::max);
    0.82 * base_size * max_multiplier
}

pub(super) fn emit_content(
    display_list: &mut DisplayList,
    content: &TextContent,
    x: f64,
    y: f64,
    base_size: f64,
    default_font: &str,
    default_color: &str,
    align: TextAlign,
    baseline: TextBaseline,
) {
    let (default_family, default_bold, default_italic) = font_parts(default_font);
    let width = content_width(content, base_size, default_family, default_bold);
    let mut cursor = match &align {
        TextAlign::Left => x,
        TextAlign::Center => x - width / 2.0,
        TextAlign::Right => x - width,
    };

    let chunks = content.chunks();
    let single_text_run = matches!(chunks, [TextContentChunk::Text(_)]);

    for chunk in chunks {
        match chunk {
            TextContentChunk::Text(run) => {
                let style = run.style.as_ref();
                let family = style
                    .and_then(|style| style.font.as_deref())
                    .map(font_family)
                    .unwrap_or(default_family);
                let bold =
                    style
                        .and_then(|style| style.weight.as_ref())
                        .map_or(default_bold, |weight| match weight {
                            TextWeight::Named(crate::model::TextWeightName::Bold) => true,
                            TextWeight::Named(crate::model::TextWeightName::Normal) => false,
                            TextWeight::Numeric(value) => *value >= 600.0,
                        });
                let italic = style.and_then(|style| style.font_style.as_ref()).map_or(
                    default_italic,
                    |value| {
                        matches!(
                            value,
                            crate::model::TextFontStyle::Italic
                                | crate::model::TextFontStyle::Oblique
                        )
                    },
                );
                let size = base_size * style.and_then(|style| style.size).unwrap_or(1.0);
                let color = style
                    .and_then(|style| style.color.as_deref())
                    .unwrap_or(default_color);
                let run_width = text_styles::text_width(&run.text, size, family, bold);
                let font = compose_font(family, bold, italic);
                display_list.push(RenderCommand::DrawText {
                    x: if single_text_run { x } else { cursor },
                    y,
                    text: run.text.clone(),
                    font,
                    size,
                    color: color.to_owned(),
                    align: if single_text_run {
                        align.clone()
                    } else {
                        TextAlign::Left
                    },
                    baseline: baseline.clone(),
                });
                emit_box_decoration(display_list, style, cursor, y, run_width, size, color);
                emit_decoration(display_list, style, cursor, y, run_width, size, color);
                cursor += run_width;
            }
            TextContentChunk::Glyph(run) => {
                let merged_style = merge_styles(run.style.as_ref(), run.smufl_style.as_ref());
                let style = merged_style.as_ref();
                let size = base_size * style.and_then(|style| style.size).unwrap_or(1.0);
                let color = style
                    .and_then(|style| style.color.as_deref())
                    .unwrap_or(default_color);
                for name in &run.glyphs {
                    if let Some(codepoint) = smufl::smufl_name_to_codepoint(name) {
                        let glyph_width = smufl::glyph_bbox(codepoint).2 * size * 0.25;
                        display_list.push(RenderCommand::DrawGlyph {
                            x: cursor,
                            y,
                            codepoint,
                            font: "Bravura".into(),
                            size,
                            color: color.to_owned(),
                            rotation: 0.0,
                        });
                        emit_box_decoration(
                            display_list,
                            style,
                            cursor,
                            y,
                            glyph_width,
                            size,
                            color,
                        );
                        emit_decoration(display_list, style, cursor, y, glyph_width, size, color);
                        cursor += glyph_width;
                    } else {
                        let fallback = format!("[{name}]");
                        let glyph_width =
                            text_styles::text_width(&fallback, size, FontFamily::Serif, false);
                        display_list.push(RenderCommand::DrawText {
                            x: cursor,
                            y,
                            text: fallback,
                            font: "serif".into(),
                            size,
                            color: color.to_owned(),
                            align: TextAlign::Left,
                            baseline: baseline.clone(),
                        });
                        cursor += glyph_width;
                    }
                }
            }
        }
    }
}

fn chunk_width(
    chunk: &TextContentChunk,
    base_size: f64,
    default_family: FontFamily,
    default_bold: bool,
) -> f64 {
    match chunk {
        TextContentChunk::Text(run) => {
            let style = run.style.as_ref();
            let family = style
                .and_then(|style| style.font.as_deref())
                .map(font_family)
                .unwrap_or(default_family);
            let bold =
                style
                    .and_then(|style| style.weight.as_ref())
                    .map_or(default_bold, |weight| {
                        matches!(
                            weight,
                            TextWeight::Named(crate::model::TextWeightName::Bold)
                        ) || matches!(weight, TextWeight::Numeric(value) if *value >= 600.0)
                    });
            text_styles::text_width(
                &run.text,
                base_size * style.and_then(|style| style.size).unwrap_or(1.0),
                family,
                bold,
            )
        }
        TextContentChunk::Glyph(run) => {
            let style = merge_styles(run.style.as_ref(), run.smufl_style.as_ref());
            let size = base_size * style.as_ref().and_then(|style| style.size).unwrap_or(1.0);
            run.glyphs
                .iter()
                .map(|name| {
                    smufl::smufl_name_to_codepoint(name)
                        .map(|codepoint| smufl::glyph_bbox(codepoint).2 * size * 0.25)
                        .unwrap_or_else(|| {
                            text_styles::text_width(
                                &format!("[{name}]"),
                                size,
                                FontFamily::Serif,
                                false,
                            )
                        })
                })
                .sum()
        }
    }
}

fn emit_decoration(
    display_list: &mut DisplayList,
    style: Option<&TextRunStyle>,
    x: f64,
    y: f64,
    width: f64,
    size: f64,
    color: &str,
) {
    let Some(decorations) = style.and_then(|style| style.decorations.as_ref()) else {
        return;
    };
    for decoration in decorations {
        let y_offset = match decoration {
            TextDecoration::Underline => size * 0.12,
            TextDecoration::Overline => -size * 0.82,
            TextDecoration::Strikethrough => -size * 0.3,
        };
        display_list.push(RenderCommand::DrawLine {
            x1: x,
            y1: y + y_offset,
            x2: x + width,
            y2: y + y_offset,
            width: (size * 0.045).max(0.5),
            color: color.to_owned(),
        });
    }
}

fn emit_box_decoration(
    display_list: &mut DisplayList,
    style: Option<&TextRunStyle>,
    x: f64,
    y: f64,
    width: f64,
    size: f64,
    color: &str,
) {
    let Some(enclosure) = style.and_then(|style| style.enclosure.as_ref()) else {
        return;
    };
    if width <= 0.0 {
        return;
    }
    let inset = size * 0.12;
    let top = y - size * 0.82 - inset;
    let bottom = y + inset;
    let left = x - inset;
    let right = x + width + inset;
    match enclosure {
        crate::model::TextEnclosure::Box => {
            for (x1, y1, x2, y2) in [
                (left, top, right, top),
                (left, bottom, right, bottom),
                (left, top, left, bottom),
                (right, top, right, bottom),
            ] {
                display_list.push(RenderCommand::DrawLine {
                    x1,
                    y1,
                    x2,
                    y2,
                    width: (size * 0.045).max(0.5),
                    color: color.to_owned(),
                });
            }
        }
        crate::model::TextEnclosure::Circle => {
            display_list.push(RenderCommand::DrawEllipse {
                cx: (left + right) * 0.5,
                cy: (top + bottom) * 0.5,
                rx: (right - left) * 0.5,
                ry: (bottom - top) * 0.5,
                angle: 0.0,
                filled: false,
                color: color.to_owned(),
            });
        }
    }
}

fn merge_styles(
    primary: Option<&TextRunStyle>,
    override_style: Option<&TextRunStyle>,
) -> Option<TextRunStyle> {
    let mut merged = primary.cloned().or_else(|| override_style.cloned())?;
    if let Some(override_style) = override_style {
        if override_style.font.is_some() {
            merged.font.clone_from(&override_style.font);
        }
        if override_style.size.is_some() {
            merged.size = override_style.size;
        }
        if override_style.weight.is_some() {
            merged.weight.clone_from(&override_style.weight);
        }
        if override_style.font_style.is_some() {
            merged.font_style.clone_from(&override_style.font_style);
        }
        if override_style.decorations.is_some() {
            merged.decorations.clone_from(&override_style.decorations);
        }
        if override_style.enclosure.is_some() {
            merged.enclosure.clone_from(&override_style.enclosure);
        }
        if override_style.color.is_some() {
            merged.color.clone_from(&override_style.color);
        }
    }
    Some(merged)
}

fn font_parts(font: &str) -> (FontFamily, bool, bool) {
    (
        font_family(font),
        font.contains("bold"),
        font.contains("italic"),
    )
}

fn font_family(font: &str) -> FontFamily {
    if font.contains("sans") {
        FontFamily::SansSerif
    } else if font.contains("mono") {
        FontFamily::Monospace
    } else {
        FontFamily::Serif
    }
}

fn compose_font(family: FontFamily, bold: bool, italic: bool) -> String {
    let family = match family {
        FontFamily::Serif => "serif",
        FontFamily::SansSerif => "sans-serif",
        FontFamily::Monospace => "monospace",
    };
    match (bold, italic) {
        (true, true) => format!("{family} bold italic"),
        (true, false) => format!("{family} bold"),
        (false, true) => format!("{family} italic"),
        (false, false) => family.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::{content_width, emit_content};
    use crate::layout::text_styles::FontFamily;
    use crate::model::{
        TextContent, TextContentChunk, TextRun, TextRunStyle, TextWeight, TextWeightName,
    };
    use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};

    #[test]
    fn emits_mixed_text_and_supported_smufl_glyph_runs_without_flattening() {
        let content = TextContent(vec![
            TextContentChunk::Text(TextRun {
                text: "con ".into(),
                style: Some(TextRunStyle {
                    font_style: Some(crate::model::TextFontStyle::Italic),
                    ..TextRunStyle::default()
                }),
            }),
            TextContentChunk::Glyph(crate::model::GlyphRun {
                glyphs: vec!["dynamicMF".into()],
                style: Some(TextRunStyle {
                    weight: Some(TextWeight::Named(TextWeightName::Bold)),
                    ..TextRunStyle::default()
                }),
                smufl_style: None,
            }),
            TextContentChunk::Text(TextRun {
                text: " subito".into(),
                style: None,
            }),
        ]);
        let width = content_width(&content, 20.0, FontFamily::Serif, false);
        let mut display_list = DisplayList::new(200.0, 100.0);

        emit_content(
            &mut display_list,
            &content,
            10.0,
            40.0,
            20.0,
            "serif",
            "#000000",
            TextAlign::Left,
            TextBaseline::Alphabetic,
        );

        assert!(width > 0.0);
        assert!(matches!(
            &display_list.commands[0],
            RenderCommand::DrawText { text, font, .. } if text == "con " && font == "serif italic"
        ));
        assert!(matches!(
            &display_list.commands[1],
            RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == 0xE52D
        ));
        assert!(matches!(
            &display_list.commands[2],
            RenderCommand::DrawText { text, .. } if text == " subito"
        ));
    }

    #[test]
    fn uses_visible_fallback_for_unmapped_glyph_names() {
        let content = TextContent(vec![TextContentChunk::Glyph(crate::model::GlyphRun {
            glyphs: vec!["notInEngineGlyphMap".into()],
            style: None,
            smufl_style: None,
        })]);
        let mut display_list = DisplayList::new(200.0, 100.0);

        emit_content(
            &mut display_list,
            &content,
            10.0,
            40.0,
            20.0,
            "serif",
            "#000000",
            TextAlign::Left,
            TextBaseline::Alphabetic,
        );

        assert!(matches!(
            &display_list.commands[0],
            RenderCommand::DrawText { text, .. } if text == "[notInEngineGlyphMap]"
        ));
    }
}
