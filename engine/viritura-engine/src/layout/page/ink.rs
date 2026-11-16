//! Painted vertical extents, rather than selection padding or curve control hulls.

use crate::render::{text_fonts, RenderCommand, TextBaseline};

pub(crate) fn vertical_ink_extent(command: &RenderCommand) -> Option<(f64, f64)> {
    match command {
        RenderCommand::DrawText {
            y,
            text,
            font,
            size,
            align,
            baseline: TextBaseline::Alphabetic,
            ..
        } => {
            let estimated =
                super::super::render_annotations::substrate_obstacles::text_command_bbox(command)?;
            let bounds = text_fonts::ink_bounds(text, font, *size, align);
            Some(
                bounds.map_or((estimated.y, estimated.y + estimated.height), |ink| {
                    (
                        estimated.y.min(y + ink.y),
                        (estimated.y + estimated.height).max(y + ink.y + ink.height),
                    )
                }),
            )
        }
        RenderCommand::DrawFilledBezier {
            y1,
            y2,
            ocy1,
            ocy2,
            icy1,
            icy2,
            iy1,
            iy2,
            ..
        } => {
            let outer = cubic_extent([*y1, *ocy1, *ocy2, *y2]);
            let inner = cubic_extent([*iy1, *icy1, *icy2, *iy2]);
            Some((outer.0.min(inner.0), outer.1.max(inner.1)))
        }
        RenderCommand::DrawBezier {
            y1,
            y2,
            cy1,
            cy2,
            width,
            ..
        } => {
            let (top, bottom) = cubic_extent([*y1, *cy1, *cy2, *y2]);
            Some((top - width * 0.5, bottom + width * 0.5))
        }
        RenderCommand::DrawGlyph { x, y, rotation, .. } if *rotation != 0.0 => {
            let bounds = command.bbox()?;
            let (sin, cos) = rotation.sin_cos();
            let ys = [bounds.x, bounds.x + bounds.width].map(|px| {
                [bounds.y, bounds.y + bounds.height].map(|py| y + (px - x) * sin + (py - y) * cos)
            });
            Some((
                ys.into_iter().flatten().fold(f64::INFINITY, f64::min),
                ys.into_iter().flatten().fold(f64::NEG_INFINITY, f64::max),
            ))
        }
        _ => command
            .bbox()
            .or_else(|| {
                super::super::render_annotations::substrate_obstacles::text_command_bbox(command)
            })
            .map(|bounds| (bounds.y, bounds.y + bounds.height)),
    }
}

fn cubic_extent([p0, p1, p2, p3]: [f64; 4]) -> (f64, f64) {
    let mut top = p0.min(p3);
    let mut bottom = p0.max(p3);
    let a = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
    let b = 2.0 * (p0 - 2.0 * p1 + p2);
    let c = p1 - p0;
    let roots = if a.abs() < 1e-10 {
        let root = if b.abs() < 1e-10 { -1.0 } else { -c / b };
        [root, root]
    } else {
        let discriminant = b * b - 4.0 * a * c;
        if discriminant < 0.0 {
            return (top, bottom);
        }
        let root = discriminant.sqrt();
        [(-b - root) / (2.0 * a), (-b + root) / (2.0 * a)]
    };
    for t in roots.into_iter().filter(|t| *t > 0.0 && *t < 1.0) {
        let u = 1.0 - t;
        let value = u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;
        top = top.min(value);
        bottom = bottom.max(value);
    }
    (top, bottom)
}
