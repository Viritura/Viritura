//! Shared wrapping and rectangular presentation for page and staff text.

mod wrapping;
pub(crate) use wrapping::FrameFont;

use super::super::render_annotations::emit_content;
use crate::model::{TextContent, TextFrameBorder, TextFrameJustify};
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};
use wrapping::{wrap, Line};

pub(crate) struct TextBlockLayout {
    lines: Vec<Line>,
    pub width: f64,
    pub height: f64,
    pub first_baseline: f64,
    padding: f64,
    font: FrameFont,
    justify: TextFrameJustify,
    border: TextFrameBorder,
}

impl TextBlockLayout {
    pub(crate) fn new(
        content: &TextContent,
        width: Option<f64>,
        padding: f64,
        font: FrameFont,
        justify: TextFrameJustify,
        border: TextFrameBorder,
    ) -> Self {
        let lines = wrap(
            content,
            width.map_or(f64::INFINITY, |w| (w - 2.0 * padding).max(0.0)),
            &font,
        );
        let natural_width = lines
            .iter()
            .map(|line| line.natural_width)
            .fold(0.0, f64::max);
        let height = lines.iter().map(|line| line.height).sum::<f64>() + 2.0 * padding;
        let first_baseline = padding + lines.first().map_or(0.0, |line| line.ascent);
        Self {
            width: width.unwrap_or(natural_width + 2.0 * padding),
            height,
            first_baseline,
            lines,
            padding,
            font,
            justify,
            border,
        }
    }

    pub(crate) fn emit(
        &self,
        dl: &mut DisplayList,
        left: f64,
        top: f64,
        default_font: &str,
        sp: f64,
        erase_background: bool,
    ) {
        if erase_background {
            dl.push(RenderCommand::EraseRect {
                x: left,
                y: top,
                w: self.width,
                h: self.height,
            });
        }
        let inner_width = (self.width - 2.0 * self.padding).max(0.0);
        let mut line_top = top + self.padding;
        for line in &self.lines {
            emit_line(
                dl,
                line,
                left + self.padding,
                inner_width,
                line_top + line.ascent,
                &self.font,
                self.justify,
                default_font,
            );
            line_top += line.height;
        }
        if self.border == TextFrameBorder::Solid {
            let (right, bottom) = (left + self.width, top + self.height);
            for (x1, y1, x2, y2) in [
                (left, top, right, top),
                (left, bottom, right, bottom),
                (left, top, left, bottom),
                (right, top, right, bottom),
            ] {
                dl.push(RenderCommand::DrawLine {
                    x1,
                    y1,
                    x2,
                    y2,
                    width: 0.12 * sp,
                    color: "#000000".into(),
                });
            }
        }
    }
}

fn emit_line(
    dl: &mut DisplayList,
    line: &Line,
    inner_left: f64,
    inner_width: f64,
    baseline: f64,
    font: &FrameFont,
    justify: TextFrameJustify,
    default_font: &str,
) {
    if line.words.is_empty() {
        return;
    }
    let emit = |dl: &mut DisplayList, content: &TextContent, x, align| {
        emit_content(
            dl,
            content,
            x,
            baseline,
            font.base_size,
            default_font,
            "#000000",
            align,
            TextBaseline::Alphabetic,
        );
    };
    if justify == TextFrameJustify::Justify
        && !line.ends_paragraph
        && line.words.len() > 1
        && line.natural_width < inner_width
    {
        let extra_space = (inner_width - line.natural_width) / (line.words.len() - 1) as f64;
        let mut x = inner_left;
        for word in &line.words {
            emit(dl, &TextContent(word.chunks.clone()), x, TextAlign::Left);
            x += word.width + word.space_width + extra_space;
        }
        return;
    }
    let (x, align) = match justify {
        TextFrameJustify::Left | TextFrameJustify::Justify => (inner_left, TextAlign::Left),
        TextFrameJustify::Center => (inner_left + inner_width / 2.0, TextAlign::Center),
        TextFrameJustify::Right => (inner_left + inner_width, TextAlign::Right),
    };
    emit(dl, &line.joined_content(), x, align);
}
