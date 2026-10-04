//! Required-instrument headers and their framed first-page geometry.

use super::instrument_names::resolve_initial_part_display_names;
use super::{augment_part_score_name, build_display_name, resolve_part_display_names};
use crate::layout::config::LayoutConfig;
use crate::layout::text_styles::{text_width, TextRole};
use crate::model::Part;
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};

/// Stored automatic score names may predate instrument changes. Recognize the
/// initial name, but keep explicitly renamed scores verbatim.
pub(crate) fn resolve_part_score_name(
    name: Option<&str>,
    parts: &[Part],
    shown: &[usize],
) -> Option<String> {
    if shown.is_empty() || shown.len() >= parts.len() {
        return None;
    }
    let required = resolve_part_display_names(parts);
    let [index] = shown else {
        return name.map(str::to_string);
    };
    let part = &parts[*index];
    let initial = resolve_initial_part_display_names(parts);
    let initial = &initial[*index];
    let number = if let Some(name) = name {
        let (base, authored_number) = name.rsplit_once(' ').map_or((name, None), |(base, last)| {
            last.parse::<usize>()
                .ok()
                .filter(|number| *number > 0)
                .map_or((name, None), |number| (base, Some(number)))
        });
        let automatic = name == part.name
            || name == initial.display_name
            || name == required[*index].display_name
            || name == augment_part_score_name(&part.name, parts, shown)
            || base == part.name
            || base == initial.base_name;
        if !automatic {
            return Some(name.to_string());
        }
        if !required[*index].display_name.contains('\n') {
            return Some(augment_part_score_name(name, parts, shown));
        }
        authored_number
            .or(initial.number)
            .or(required[*index].number)
    } else {
        initial.number.or(required[*index].number)
    };
    Some(
        required[*index]
            .base_name
            .split('\n')
            .map(|line| build_display_name(line, None, number))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn frame_height(title: &str, config: &LayoutConfig) -> f64 {
    let size = config
        .text_styles
        .resolve(TextRole::StaffLabel)
        .size_px(config.sp);
    size + title.split('\n').count().saturating_sub(1) as f64 * size * 1.2 + 0.8 * config.sp
}

/// Reserve the same framed text stack used by rendering, plus a gap to music.
pub(crate) fn part_score_name_height(title: Option<&str>, config: &LayoutConfig) -> f64 {
    if config.page_width.is_none() {
        return 0.0;
    }
    title.map_or(0.0, |title| frame_height(title, config) + 2.0 * config.sp)
}

/// Standard engraving practice: identify an extracted part with a framed
/// instrument list below the first physical page's top margin, including covers.
pub fn render_part_score_name(
    dl: &mut DisplayList,
    title: &str,
    config: &LayoutConfig,
    _page_width: f64,
) {
    let sp = config.sp;
    let style = config.text_styles.resolve(TextRole::StaffLabel);
    let size = style.size_px(sp);
    let pad_x = 0.6 * sp;
    let pad_y = 0.4 * sp;
    let left = config.page_margin_left * sp;
    let top = config.page_margin_top * sp;
    let width = title
        .split('\n')
        .map(|line| text_width(line, size, style.family, style.bold))
        .fold(0.0_f64, f64::max)
        + 2.0 * pad_x;
    for (index, line) in title.split('\n').enumerate() {
        dl.push(RenderCommand::DrawText {
            x: left + pad_x,
            y: top + pad_y + size * 0.78 + index as f64 * size * 1.2,
            text: line.to_string(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
        });
    }
    let right = left + width;
    let bottom = top + frame_height(title, config);
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
            width: 0.1 * sp,
            color: style.color.clone(),
        });
    }
}
