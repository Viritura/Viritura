//! Note-cluster and emitted-glyph geometry queried by annotation placement.

use super::super::render_measure::MIDDLE_LINE_POS;
use super::super::text_styles::{self, FontFamily};
use super::super::types::*;
use crate::render::smufl::smufl;
use crate::render::*;

/// Compute the stem tip Y, ensuring stems on ledger-line notes extend at least
/// to the middle staff line (standard engraving rule).
pub(super) fn stem_tip_y(
    note_edge_pos: f64,
    stem_up: bool,
    staff_y: f64,
    sp: f64,
    stem_length: f64,
) -> f64 {
    let middle_y = staff_y + MIDDLE_LINE_POS * sp * 0.5;
    if stem_up {
        let tip = staff_y + note_edge_pos * sp * 0.5 - stem_length * sp;
        tip.min(middle_y)
    } else {
        let tip = staff_y + note_edge_pos * sp * 0.5 + stem_length * sp;
        tip.max(middle_y)
    }
}

/// Bounding box of an already-emitted articulation glyph, in pixels:
/// `(left, right, top_y, bottom_y)`. Used as a skyline obstacle so dynamics and
/// hairpins clear accents, staccatos, marcatos, etc. that sit on the same side
/// of the staff (standard engraving practice: a dynamic must not collide with an
/// articulation, so it is pushed past the articulation's outer edge).
pub(crate) type ArticBox = (f64, f64, f64, f64);

/// Screen-space (pixel) bounding box of an already-emitted `DrawGlyph`.
/// `left`/`right` are x edges, `top`/`bottom` are y edges (y grows downward).
pub(crate) struct GlyphScreenBox {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}

impl GlyphScreenBox {
    /// Horizontal center of the glyph box.
    pub fn center_x(&self) -> f64 {
        (self.left + self.right) * 0.5
    }

    /// Vertical center of the glyph box.
    pub fn center_y(&self) -> f64 {
        (self.top + self.bottom) * 0.5
    }

    /// Convert to an axis-aligned `BoundingBox` (origin + size).
    pub fn to_bbox(&self) -> BoundingBox {
        BoundingBox::new(
            self.left,
            self.top,
            self.right - self.left,
            self.bottom - self.top,
        )
    }
}

/// Compute the screen-space bounding box of a `DrawGlyph` from its draw origin
/// (`x`, `y`), `codepoint`, and em `size`. The glyph em spans 4 staff-spaces,
/// so 1 space = `size / 4`; the SMuFL bbox (in spaces, relative to the draw
/// origin) is scaled by that and offset to screen coordinates.
pub(crate) fn glyph_screen_bbox(x: f64, y: f64, codepoint: u32, size: f64) -> GlyphScreenBox {
    let glyph_sp = size / 4.0;
    let (bx, by, bw, bh) = smufl::glyph_bbox(codepoint);
    GlyphScreenBox {
        left: x + bx * glyph_sp,
        right: x + (bx + bw) * glyph_sp,
        top: y + by * glyph_sp,
        bottom: y + (by + bh) * glyph_sp,
    }
}

/// Scan emitted commands for articulation glyphs and return their ink boxes.
pub(crate) fn collect_articulation_boxes(commands: &[RenderCommand]) -> Vec<ArticBox> {
    let mut boxes = Vec::new();
    for cmd in commands {
        if let RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            size,
            ..
        } = cmd
        {
            if smufl::is_articulation(*codepoint) {
                let b = glyph_screen_bbox(*x, *y, *codepoint, *size);
                boxes.push((b.left, b.right, b.top, b.bottom));
            }
        }
    }
    boxes
}

/// A horizontal band `(left, right, top)` occupied by a glyph that protrudes
/// above the top staff line.
pub(crate) type AboveGlyphBox = (f64, f64, f64);
pub(crate) type FixedAboveInkBox = (f64, f64, f64, Option<usize>);

fn element_measure_index(id: Option<&str>) -> Option<usize> {
    id?.split('/')
        .find_map(|part| part.strip_prefix('m')?.parse().ok())
}

/// Collect note-attached glyph bands that protrude above the top staff line.
pub(crate) fn collect_above_glyph_boxes(
    commands: &[RenderCommand],
    element_ids: &[Option<String>],
    staff_y: f64,
) -> Vec<AboveGlyphBox> {
    let mut boxes = Vec::new();
    for (i, cmd) in commands.iter().enumerate() {
        if let RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            size,
            ..
        } = cmd
        {
            let id = element_ids.get(i).and_then(|o| o.as_ref());
            let is_substrate = id.is_some_and(|s| s.contains("/s") && !s.contains("/tuplet"));
            if !is_substrate {
                continue;
            }
            let b = glyph_screen_bbox(*x, *y, *codepoint, *size);
            if b.top >= staff_y {
                continue;
            }
            boxes.push((b.left, b.right, b.top));
        }
    }
    boxes
}

pub(super) fn text_command_bbox(command: &RenderCommand) -> Option<BoundingBox> {
    let RenderCommand::DrawText {
        x,
        y,
        text,
        font,
        size,
        align,
        baseline,
        ..
    } = command
    else {
        return None;
    };
    let family = if font.contains("sans-serif") {
        FontFamily::SansSerif
    } else if font.contains("monospace") {
        FontFamily::Monospace
    } else {
        FontFamily::Serif
    };
    let width = text_styles::text_width(text, *size, family, font.contains("bold"));
    let left = match align {
        TextAlign::Left => *x,
        TextAlign::Center => *x - width * 0.5,
        TextAlign::Right => *x - width,
    };
    let (top, bottom) = match baseline {
        TextBaseline::Top => (*y, *y + *size),
        TextBaseline::Middle => (*y - *size * 0.5, *y + *size * 0.5),
        TextBaseline::Bottom => (*y - *size, *y),
        TextBaseline::Alphabetic => (*y - *size * 0.82, *y),
    };
    Some(BoundingBox::new(left, top, width, bottom - top))
}

/// Collect fixed ink after a whole staff has rendered. Tempo and expression
/// dependents are excluded because the outward flow pass moves them; curves,
/// rehearsal frames, and tuplets have dedicated geometry stages.
pub(crate) fn collect_fixed_above_ink_boxes(
    commands: &[RenderCommand],
    element_ids: &[Option<String>],
    staff_y: f64,
) -> Vec<FixedAboveInkBox> {
    commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let id = element_ids.get(index).and_then(|id| id.as_deref());
            if id.is_some_and(|id| {
                id.contains("/tempo")
                    || id.contains("/expr")
                    || id.contains("/rehearsal")
                    || id.contains("/tuplet")
                    || id.starts_with("tie/")
                    || id.starts_with("slur/")
            }) {
                return None;
            }
            let bbox = match command {
                RenderCommand::DrawText { .. } => text_command_bbox(command)?,
                _ => command.bbox()?,
            };
            (bbox.y < staff_y).then_some((
                bbox.x,
                bbox.x + bbox.width,
                bbox.y,
                element_measure_index(id),
            ))
        })
        .collect()
}

/// Topmost edge among glyph bands overlapping `[x_left, x_right]`.
pub(crate) fn above_glyph_top_in_range(
    boxes: &[AboveGlyphBox],
    x_left: f64,
    x_right: f64,
) -> Option<f64> {
    let mut top: Option<f64> = None;
    for &(left, right, glyph_top) in boxes {
        if right < x_left || left > x_right {
            continue;
        }
        top = Some(top.map_or(glyph_top, |current| current.min(glyph_top)));
    }
    top
}

/// Find the highest notehead or stem point overlapping an X range.
pub(crate) fn highest_point_in_range(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    stem_length: f64,
    x_left: f64,
    x_right: f64,
) -> f64 {
    let notehead_w = 1.18 * sp;
    let ledger_ext = 0.4 * sp;
    let mut highest = staff_y;
    for vl in &ml.voice_layouts {
        for i in 0..vl.events.len() {
            if vl.events.event(i).is_rest() {
                continue;
            }
            let note_positions = vl.events.note_positions(i);
            let has_ledger_above = note_positions.iter().any(|&p| p <= -2.0);
            let extra = if has_ledger_above { ledger_ext } else { 0.0 };
            let ex = vl.events.x(i);
            let ev_left = ex - extra;
            let ev_right = ex + notehead_w + extra;
            if ev_right < x_left || ev_left > x_right {
                continue;
            }

            for &pos in note_positions {
                let note_y = staff_y + pos * sp * 0.5;
                if note_y < highest {
                    highest = note_y;
                }
            }
            if vl.events.stem_up(i)
                && vl.events.event(i).duration.base.has_stem()
                && !note_positions.is_empty()
            {
                let top_pos = note_positions.iter().copied().fold(f64::INFINITY, f64::min);
                let tip = stem_tip_y(top_pos, true, staff_y, sp, stem_length);
                if tip < highest {
                    highest = tip;
                }
            }
        }
    }
    highest
}

/// Find the highest point across all events in a measure.
pub(crate) fn highest_point_in_measure(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    stem_length: f64,
) -> f64 {
    highest_point_in_range(
        ml,
        staff_y,
        sp,
        stem_length,
        f64::NEG_INFINITY,
        f64::INFINITY,
    )
}

/// Find the lowest notehead or stem point across all events in a measure.
pub(crate) fn lowest_point_in_measure(
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    stem_length: f64,
) -> f64 {
    let staff_bottom = staff_y + 4.0 * sp;
    let mut lowest = staff_bottom;
    for vl in &ml.voice_layouts {
        for i in 0..vl.events.len() {
            if vl.events.event(i).is_rest() {
                continue;
            }
            let note_positions = vl.events.note_positions(i);
            for &pos in note_positions {
                let note_y = staff_y + pos * sp * 0.5;
                if note_y > lowest {
                    lowest = note_y;
                }
            }
            if !vl.events.stem_up(i) && !note_positions.is_empty() {
                let bottom_pos = note_positions
                    .iter()
                    .copied()
                    .fold(f64::NEG_INFINITY, f64::max);
                let tip = stem_tip_y(bottom_pos, false, staff_y, sp, stem_length);
                if tip > lowest {
                    lowest = tip;
                }
            }
        }
    }
    lowest
}
