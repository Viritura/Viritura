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
const TEXT_COLOR: &str = "#000000";

/// Join a text marker's generated label with its authored text, separated by
/// a word space as a single instruction reads left to right.
pub(super) fn compose_label(generated: &str, text: Option<&MarkerText>) -> TextContent {
    let Some(text) = authored_text(text) else {
        return TextContent::from(generated);
    };
    let generated = plain_run(generated);
    let authored = text.content.chunks().iter().cloned();
    let chunks = match text.placement {
        MarkerTextPlacement::Replace => authored.collect(),
        MarkerTextPlacement::Before => authored.chain([plain_run(" "), generated]).collect(),
        MarkerTextPlacement::After => [generated, plain_run(" ")]
            .into_iter()
            .chain(authored)
            .collect(),
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
) {
    let start = dl.commands.len();
    text_content::emit_content(
        dl,
        content,
        x,
        baseline_y,
        size,
        TEXT_FONT,
        TEXT_COLOR,
        align,
        TextBaseline::Alphabetic,
    );
    for index in start..dl.commands.len() {
        dl.tag_command(index, element_id.to_owned());
    }
}

/// Which edge of a glyph marker's row stays fixed as authored text grows it.
pub(super) enum RowAnchor {
    /// The row starts here and extends rightward (a segno opening its bar).
    Start(f64),
    /// The row ends here and extends leftward (a coda closing its bar).
    End(f64),
}

pub(super) struct GlyphMarker<'a> {
    pub codepoint: u32,
    pub glyph_y: f64,
    pub glyph_size: f64,
    pub text_size: f64,
    pub sp: f64,
    pub anchor: RowAnchor,
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
        glyph_y,
        glyph_size,
        text_size,
        sp,
        anchor,
        text,
        element_id,
    } = marker;
    let text = authored_text(text);
    // The glyph's origin when it stands alone keeps the legacy slot convention
    // so markers without authored text do not move.
    let (slot_offset, _, slot_units, _) = smufl::glyph_bbox(codepoint);
    let home_x = match anchor {
        RowAnchor::Start(x) => x - slot_offset * sp,
        RowAnchor::End(x) => x - (slot_offset + slot_units) * sp,
    };
    let home_ink = glyph_ink(home_x, glyph_y, codepoint, glyph_size);
    let text_w = text.map_or(0.0, |text| text_width(&text.content, text_size));
    let gap = 0.5 * sp;
    let placement = text.map(|text| text.placement);
    // Authored text grows the row away from its anchored edge: a segno row
    // keeps its left ink edge, a coda row keeps its right ink edge.
    let (glyph_x, text_left) = match (&anchor, placement) {
        (_, None) => (home_x, 0.0),
        (RowAnchor::Start(_), Some(MarkerTextPlacement::Before)) => {
            (home_x + text_w + gap, home_ink.x)
        }
        (RowAnchor::Start(_), Some(MarkerTextPlacement::After)) => {
            (home_x, home_ink.x + home_ink.width + gap)
        }
        (RowAnchor::Start(_), Some(MarkerTextPlacement::Replace)) => (home_x, home_ink.x),
        (RowAnchor::End(_), Some(MarkerTextPlacement::Before)) => {
            (home_x, home_ink.x - gap - text_w)
        }
        (RowAnchor::End(_), Some(MarkerTextPlacement::After)) => {
            (home_x - text_w - gap, home_ink.x + home_ink.width - text_w)
        }
        (RowAnchor::End(_), Some(MarkerTextPlacement::Replace)) => {
            (home_x, home_ink.x + home_ink.width - text_w)
        }
    };
    let show_glyph = placement != Some(MarkerTextPlacement::Replace);
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
                color: "#000000".into(),
                rotation: 0.0,
            },
            element_id.clone(),
        );
    }
    if let Some(text) = text {
        let height = text_height(&text.content, text_size);
        // Optical centring: the text's cap band sits on the glyph's ink centre,
        // so a lowercase-heavy phrase does not drop below the symbol.
        let baseline_y = ink.y
            + ink.height / 2.0
            + text_styles::cap_center_offset_from_baseline(FontFamily::Serif, text_size);
        emit_owned_text(
            dl,
            &text.content,
            text_left,
            baseline_y,
            text_size,
            TextAlign::Left,
            &element_id,
        );
        let text_box = BoundingBox::new(text_left, baseline_y - height, text_w, height);
        row_box = Some(match row_box {
            Some(glyph_box) => union(&glyph_box, &text_box),
            None => text_box,
        });
    }
    let bbox = row_box.unwrap_or(ink);
    let row_left = bbox.x;
    dl.push_element_bbox_with_shape(ElementBBox { element_id, bbox });
    row_left
}

/// Bravura ink extents (`bBoxSW`/`bBoxNE`, staff spaces, y up) for the glyph
/// markers. The shared glyph table has no entries for these glyphs, so its
/// fallback square cannot centre or clear neighbouring text.
fn glyph_ink(x: f64, y: f64, codepoint: u32, size: f64) -> BoundingBox {
    let ((sw_x, sw_y), (ne_x, ne_y)) = match codepoint {
        smufl::SEGNO => ((0.016, -0.108), (2.2, 3.036)),
        smufl::CODA => ((-0.016, -0.632), (3.82, 3.592)),
        _ => return glyph_screen_bbox(x, y, codepoint, size).to_bbox(),
    };
    let glyph_sp = size / 4.0;
    BoundingBox::new(
        x + sw_x * glyph_sp,
        y - ne_y * glyph_sp,
        (ne_x - sw_x) * glyph_sp,
        (ne_y - sw_y) * glyph_sp,
    )
}

fn union(a: &BoundingBox, b: &BoundingBox) -> BoundingBox {
    let left = a.x.min(b.x);
    let top = a.y.min(b.y);
    let right = (a.x + a.width).max(b.x + b.width);
    let bottom = (a.y + a.height).max(b.y + b.height);
    BoundingBox::new(left, top, right - left, bottom - top)
}
