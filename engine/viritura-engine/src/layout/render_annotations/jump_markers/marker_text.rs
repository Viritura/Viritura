//! Authored text owned by segno, coda, fine, and jump markers.
//!
//! The owning marker stays authoritative for navigation; authored text only
//! changes what is printed beside or instead of its generated glyph or label.

use super::super::substrate_obstacles::glyph_screen_bbox;
use super::super::text_content;
use crate::layout::text_styles::{self, FontFamily};
use crate::model::{MarkerText, MarkerTextPlacement, TextContent, TextContentChunk, TextRun};
use crate::render::smufl::smufl;
use crate::render::*;

// Navigation instructions engrave in italic; the inspector mirrors this
// default (`MARKER_TEXT_INHERITED_STYLE`) so its italic toggle can opt out.
const TEXT_FONT: &str = "serif italic";

/// Join a text marker's generated label with its authored text, separated by
/// a word space as a single instruction reads left to right.
pub(super) fn compose_label(generated: &str, text: Option<&MarkerText>) -> TextContent {
    compose_content(TextContent::from(generated), text)
}

pub(super) fn compose_to_coda(text: Option<&MarkerText>) -> TextContent {
    compose_content(
        TextContent(vec![
            plain_run("To"),
            plain_run(" "),
            TextContentChunk::Glyph(crate::model::GlyphRun {
                glyphs: vec!["coda".into()],
                style: None,
                smufl_style: Some(crate::model::TextRunStyle {
                    size: Some(1.5),
                    ..Default::default()
                }),
            }),
        ]),
        text,
    )
}

fn compose_content(generated: TextContent, text: Option<&MarkerText>) -> TextContent {
    let Some(text) = authored_text(text) else {
        return generated;
    };
    let generated = generated.0.into_iter();
    let authored = text.content.chunks().iter().cloned();
    let chunks = match text.placement {
        MarkerTextPlacement::Replace => authored.collect(),
        MarkerTextPlacement::Before => authored.chain([plain_run(" ")]).chain(generated).collect(),
        MarkerTextPlacement::After => generated.chain([plain_run(" ")]).chain(authored).collect(),
    };
    TextContent(chunks)
}

/// Blank authored content (for example a just-added, still-empty field) leaves
/// the marker's generated glyph or label untouched rather than erasing it.
fn authored_text(text: Option<&MarkerText>) -> Option<&MarkerText> {
    text.filter(|text| {
        text.content.chunks().iter().any(|chunk| match chunk {
            TextContentChunk::Text(run) => !run.text.trim().is_empty(),
            TextContentChunk::Glyph(run) => !run.glyphs.is_empty(),
        })
    })
}

fn plain_run(text: &str) -> TextContentChunk {
    TextContentChunk::Text(TextRun {
        text: text.to_owned(),
        style: None,
    })
}

pub(super) fn text_width(content: &TextContent, size: f64) -> f64 {
    text_content::content_width(content, size, FontFamily::Serif, false)
}

pub(super) fn text_height(content: &TextContent, size: f64) -> f64 {
    text_content::content_height(content, size)
}

/// Stacked navigation rows retain their beat anchors while clearing earlier
/// signs/instructions. Their full authored-text bounds participate.
pub(super) fn clear_marker_rows(dl: &DisplayList, bounds: &BoundingBox, sp: f64) -> f64 {
    let mut shift: f64 = 0.0;
    for prior in dl.element_bboxes.iter().rev() {
        let marker = prior.element_id.rsplit('/').next().unwrap_or("");
        if !matches!(marker, "segno" | "coda" | "fine" | "jump") {
            continue;
        }
        let bbox = &prior.bbox;
        if bounds.x < bbox.x + bbox.width
            && bounds.x + bounds.width > bbox.x
            && bounds.y + shift < bbox.y + bbox.height + 0.5 * sp
            && bounds.y + bounds.height + shift > bbox.y - 0.5 * sp
        {
            shift = shift.min(bbox.y - 0.5 * sp - bounds.y - bounds.height);
        }
    }
    shift
}

/// Emit marker text on an alphabetic baseline, tagging every run with the
/// owning marker so selection highlights the whole instruction.
pub(super) fn emit_owned_text(
    dl: &mut DisplayList,
    content: &TextContent,
    x: f64,
    baseline_y: f64,
    size: f64,
    align: TextAlign,
    element_id: &str,
    color: &str,
) -> BoundingBox {
    let start = dl.commands.len();
    let width = text_width(content, size);
    let height = text_height(content, size);
    let left = match align {
        TextAlign::Left => x,
        TextAlign::Center => x - width / 2.0,
        TextAlign::Right => x - width,
    };
    let mut bounds = BoundingBox::new(left, baseline_y - height, width, height);
    text_content::emit_content(
        dl,
        content,
        x,
        baseline_y,
        size,
        TEXT_FONT,
        color,
        align,
        TextBaseline::Alphabetic,
    );
    for index in start..dl.commands.len() {
        dl.tag_command(index, element_id.to_owned());
        if let RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            size,
            ..
        } = &dl.commands[index]
        {
            bounds = union(&bounds, &glyph_ink(*x, *y, *codepoint, *size));
        }
    }
    bounds
}

pub(super) fn emit_text_marker(
    dl: &mut DisplayList,
    content: &TextContent,
    x: f64,
    baseline_y: f64,
    size: f64,
    align: TextAlign,
    element_id: String,
    color: &str,
    sp: f64,
) {
    let start = dl.commands.len();
    let mut bbox = emit_owned_text(dl, content, x, baseline_y, size, align, &element_id, color);
    // SMuFL runs can extend below the alphabetic baseline. Preserve the
    // requested clearance to the actual ink edge, not just to text metrics.
    let edge_shift = (baseline_y - bbox.y - bbox.height).min(0.0);
    bbox.y += edge_shift;
    let row_shift = clear_marker_rows(dl, &bbox, sp);
    bbox.y += row_shift;
    for command in &mut dl.commands[start..] {
        command.translate_in_place(0.0, edge_shift + row_shift);
    }
    dl.push_element_bbox_with_shape(ElementBBox { element_id, bbox });
}

pub(super) struct GlyphMarker<'a> {
    pub codepoint: u32,
    pub color: &'a str,
    pub glyph_y: f64,
    pub glyph_size: f64,
    pub text_size: f64,
    pub sp: f64,
    pub anchor: f64,
    pub text: Option<&'a MarkerText>,
    pub element_id: String,
}

/// Emit a glyph marker as one row of `[before text] glyph [after text]`, or
/// its authored text alone when it replaces the glyph. Text is centred on the
/// glyph's ink so a mixed instruction such as "To Coda ⊕" reads on one line.
/// Returns the row's left edge so a neighbouring instruction can clear it.
pub(super) fn emit_glyph_marker(dl: &mut DisplayList, marker: GlyphMarker<'_>) -> f64 {
    let GlyphMarker {
        codepoint,
        color,
        glyph_y,
        glyph_size,
        text_size,
        sp,
        anchor,
        text,
        element_id,
    } = marker;
    let text = authored_text(text);
    let (slot_offset, _, _, _) = smufl::glyph_bbox(codepoint);
    let glyph_sp = glyph_size / 4.0;
    let home_x = anchor - slot_offset * glyph_sp;
    let home_ink = glyph_ink(home_x, glyph_y, codepoint, glyph_size);
    let text_w = text.map_or(0.0, |text| text_width(&text.content, text_size));
    let gap = 0.5 * sp;
    let placement = text.map(|text| text.placement);
    // Landing signs and their authored text open the passage at this beat.
    let (glyph_x, text_left) = match placement {
        None => (home_x, 0.0),
        Some(MarkerTextPlacement::Before) => (home_x + text_w + gap, home_ink.x),
        Some(MarkerTextPlacement::After) => (home_x, home_ink.x + home_ink.width + gap),
        Some(MarkerTextPlacement::Replace) => (home_x, home_ink.x),
    };
    let show_glyph = placement != Some(MarkerTextPlacement::Replace);
    let command_start = dl.commands.len();
    let ink = glyph_ink(glyph_x, glyph_y, codepoint, glyph_size);
    let mut row_box = show_glyph.then(|| ink.clone());
    if show_glyph {
        dl.push_tagged(
            RenderCommand::DrawGlyph {
                x: glyph_x,
                y: glyph_y,
                codepoint,
                font: "Bravura".into(),
                size: glyph_size,
                color: color.into(),
                rotation: 0.0,
            },
            element_id.clone(),
        );
    }
    if let Some(text) = text {
        // Optical centring: the text's cap band sits on the glyph's ink centre,
        // so a lowercase-heavy phrase does not drop below the symbol.
        let baseline_y = ink.y
            + ink.height / 2.0
            + text_styles::cap_center_offset_from_baseline(FontFamily::Serif, text_size);
        let text_box = emit_owned_text(
            dl,
            &text.content,
            text_left,
            baseline_y,
            text_size,
            TextAlign::Left,
            &element_id,
            color,
        );
        row_box = Some(match row_box {
            Some(glyph_box) => union(&glyph_box, &text_box),
            None => text_box,
        });
    }
    let mut bbox = row_box.unwrap_or(ink);
    let shift = clear_marker_rows(dl, &bbox, sp);
    if shift != 0.0 {
        for command in &mut dl.commands[command_start..] {
            command.translate_in_place(0.0, shift);
        }
        bbox.y += shift;
    }
    let row_left = bbox.x;
    dl.push_element_bbox_with_shape(ElementBBox { element_id, bbox });
    row_left
}

fn glyph_ink(x: f64, y: f64, codepoint: u32, size: f64) -> BoundingBox {
    glyph_screen_bbox(x, y, codepoint, size).to_bbox()
}

fn union(a: &BoundingBox, b: &BoundingBox) -> BoundingBox {
    let left = a.x.min(b.x);
    let top = a.y.min(b.y);
    let right = (a.x + a.width).max(b.x + b.width);
    let bottom = (a.y + a.height).max(b.y + b.height);
    BoundingBox::new(left, top, right - left, bottom - top)
}
