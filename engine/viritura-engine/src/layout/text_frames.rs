//! Free rectangular text frames placed on final paginated pages.
//!
//! A frame's locator only selects its page; its rectangle is always measured
//! from the page's printable area (inside the page margins) in staff spaces, so
//! reflow can move a musically located frame to another page but never
//! reinterprets its coordinates. Frames are fixed page furniture: they take no
//! part in collision avoidance or vertical spacing, and they are omitted from
//! the unpaged horizon view, which has no pages to anchor to.

mod locator;
mod wrapping;

use super::config::LayoutConfig;
use super::element_id;
use super::render_annotations::emit_content;
use super::text_styles::FontFamily;
use crate::model::{
    Score, TextContent, TextFrame, TextFrameAlign, TextFrameAnchor, TextFrameBorder,
    TextFrameJustify, TextFrameWidth,
};
use crate::render::{
    BoundingBox, DisplayList, ElementBBox, ElementKind, RenderCommand, TextAlign, TextBaseline,
};
use locator::PageResolver;
use wrapping::{wrap, FrameFont, Line};

/// Body-text size for frame prose, in staff spaces; run `size` values scale it.
const FRAME_TEXT_SIZE_SP: f64 = 2.0;
const FRAME_FONT: &str = "serif";
const FRAME_COLOR: &str = "#000000";
const BORDER_WIDTH_SP: f64 = 0.12;

/// Printable page rectangle in display-list pixels.
#[derive(Clone, Copy)]
struct PageArea {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

/// Append frames for an automatic-flow layout whose system membership is the
/// break plan (`systems` holds indices into `visible_indices`, which maps to
/// global measure indices). Retained patch-frame systems may be absent from
/// `dl`'s measure bounds, so the plan is authoritative here.
pub(crate) fn append_text_frames_by_plan(
    dl: &mut DisplayList,
    score: &Score,
    frames: &[TextFrame],
    config: &LayoutConfig,
    (systems, visible_indices): (&[Vec<usize>], &[usize]),
) {
    if frames.is_empty() {
        return;
    }
    let measure_systems: Vec<(usize, usize)> = systems
        .iter()
        .enumerate()
        .flat_map(|(system, members)| {
            members
                .iter()
                .map(move |&visible| (visible_indices[visible], system))
        })
        .collect();
    append_text_frames(dl, score, frames, config, &measure_systems);
}

/// Append frames for a fully assembled layout, reading system membership
/// from its measure bounds.
pub(crate) fn append_text_frames_by_bounds(
    dl: &mut DisplayList,
    score: &Score,
    frames: &[TextFrame],
    config: &LayoutConfig,
) {
    if frames.is_empty() {
        return;
    }
    let measure_systems: Vec<(usize, usize)> = dl
        .measure_bounds
        .iter()
        .map(|bounds| (bounds.index, bounds.system_index))
        .collect();
    append_text_frames(dl, score, frames, config, &measure_systems);
}

/// Render every placeable frame into one appended segment. `dl` must carry its
/// final pages; nothing is drawn in the unpaged horizon view.
fn append_text_frames(
    dl: &mut DisplayList,
    score: &Score,
    frames: &[TextFrame],
    config: &LayoutConfig,
    measure_systems: &[(usize, usize)],
) {
    if config.page_width.is_none() {
        return;
    }
    let sp = config.sp;
    let resolver = PageResolver::new(score, &dl.pages, measure_systems);
    let mut segment = DisplayList::new(dl.width, dl.height);
    for frame in frames {
        let Some(page) = resolver.page_for(&frame.locator) else {
            continue;
        };
        let page = &dl.pages[page];
        let area = PageArea {
            left: config.page_margin_left * sp,
            top: page.y_offset + config.page_margin_top * sp,
            right: dl.width - config.page_margin_right * sp,
            bottom: page.y_offset + page.height - config.page_margin_bottom * sp,
        };
        render_frame(&mut segment, frame, area, sp);
    }
    if !segment.element_bboxes.is_empty() {
        dl.append(segment);
    }
}

fn render_frame(dl: &mut DisplayList, frame: &TextFrame, area: PageArea, sp: f64) {
    let font = FrameFont {
        base_size: FRAME_TEXT_SIZE_SP * sp,
        family: FontFamily::Serif,
        bold: false,
    };
    let width = match frame.width {
        TextFrameWidth::StaffSpaces(width) => width * sp,
        TextFrameWidth::TextColumnFraction(fraction) => {
            fraction * (area.right - area.left).max(0.0)
        }
    };
    let padding = frame.padding.unwrap_or(0.0) * sp;
    let inner_width = (width - 2.0 * padding).max(0.0);
    let lines = wrap(&frame.content, inner_width, &font);
    let height = lines.iter().map(|line| line.height).sum::<f64>() + 2.0 * padding;
    let (left, top) = frame_origin(frame, area, width, height, sp);

    let first_command = dl.commands.len();
    let inner_left = left + padding;
    let mut line_top = top + padding;
    for line in &lines {
        emit_line(
            dl,
            line,
            inner_left,
            inner_width,
            line_top + line.ascent,
            &font,
            frame.paragraph_justification,
        );
        line_top += line.height;
    }
    if frame.border == TextFrameBorder::Solid {
        emit_border(dl, left, top, width, height, BORDER_WIDTH_SP * sp);
    }
    tag_frame(
        dl,
        &frame.id,
        first_command,
        BoundingBox::new(left, top, width, height),
    );
}

/// Tag every command of one frame with its selection ID and publish the frame
/// rectangle (padding included) as its hit target. The shape is registered as
/// `Other` directly: frame IDs are authored, so suffix classification of the
/// ID could misread them.
fn tag_frame(dl: &mut DisplayList, frame_id: &str, first_command: usize, bbox: BoundingBox) {
    let id = element_id::text_frame(frame_id);
    for index in first_command..dl.commands.len() {
        dl.tag_command(index, id.clone());
    }
    dl.push_shape_rect(bbox.clone(), id.clone(), ElementKind::Other, None, None);
    dl.element_bboxes.push(ElementBBox {
        element_id: id,
        bbox,
    });
}

/// Top-left corner of the frame: the anchor point on the printable area, the
/// frame edge that `horizontalAlignment` (or the anchor's own side) attaches to it, then the
/// authored offset.
fn frame_origin(frame: &TextFrame, area: PageArea, width: f64, height: f64, sp: f64) -> (f64, f64) {
    use TextFrameAnchor as A;
    let anchor = frame.placement.anchor;
    let (column, row) = match anchor {
        A::TopLeft => (TextFrameAlign::Left, 0.0),
        A::Top => (TextFrameAlign::Center, 0.0),
        A::TopRight => (TextFrameAlign::Right, 0.0),
        A::Left => (TextFrameAlign::Left, 0.5),
        A::Right => (TextFrameAlign::Right, 0.5),
        A::BottomLeft => (TextFrameAlign::Left, 1.0),
        A::Bottom => (TextFrameAlign::Center, 1.0),
        A::BottomRight => (TextFrameAlign::Right, 1.0),
    };
    let anchor_x = match column {
        TextFrameAlign::Left => area.left,
        TextFrameAlign::Center => (area.left + area.right) / 2.0,
        TextFrameAlign::Right => area.right,
    };
    let anchor_y = area.top + row * (area.bottom - area.top);
    let left = match frame.horizontal_alignment.unwrap_or(column) {
        TextFrameAlign::Left => anchor_x,
        TextFrameAlign::Center => anchor_x - width / 2.0,
        TextFrameAlign::Right => anchor_x - width,
    };
    let top = anchor_y - row * height;
    let offset = frame.placement.offset;
    (left + offset.x * sp, top + offset.y * sp)
}

fn emit_line(
    dl: &mut DisplayList,
    line: &Line,
    inner_left: f64,
    inner_width: f64,
    baseline: f64,
    font: &FrameFont,
    justify: TextFrameJustify,
) {
    if line.words.is_empty() {
        return;
    }
    let stretch = justify == TextFrameJustify::Justify
        && !line.ends_paragraph
        && line.words.len() > 1
        && line.natural_width < inner_width;
    if stretch {
        let extra_space = (inner_width - line.natural_width) / (line.words.len() - 1) as f64;
        let mut x = inner_left;
        for word in &line.words {
            emit(
                dl,
                &TextContent(word.chunks.clone()),
                x,
                baseline,
                font,
                TextAlign::Left,
            );
            x += word.width + word.space_width + extra_space;
        }
        return;
    }
    let (x, align) = match justify {
        TextFrameJustify::Left | TextFrameJustify::Justify => (inner_left, TextAlign::Left),
        TextFrameJustify::Center => (inner_left + inner_width / 2.0, TextAlign::Center),
        TextFrameJustify::Right => (inner_left + inner_width, TextAlign::Right),
    };
    emit(dl, &line.joined_content(), x, baseline, font, align);
}

fn emit(
    dl: &mut DisplayList,
    content: &TextContent,
    x: f64,
    baseline: f64,
    font: &FrameFont,
    align: TextAlign,
) {
    emit_content(
        dl,
        content,
        x,
        baseline,
        font.base_size,
        FRAME_FONT,
        FRAME_COLOR,
        align,
        TextBaseline::Alphabetic,
    );
}

fn emit_border(dl: &mut DisplayList, left: f64, top: f64, width: f64, height: f64, stroke: f64) {
    let (right, bottom) = (left + width, top + height);
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
            width: stroke,
            color: FRAME_COLOR.into(),
        });
    }
}
