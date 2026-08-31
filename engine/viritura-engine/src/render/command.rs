#![allow(unused_imports)]

use super::*;
use serde::{Deserialize, Serialize};

/// A single render command in the display list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RenderCommand {
    /// Draw a filled ellipse (for noteheads).
    DrawEllipse {
        cx: f64,
        cy: f64,
        rx: f64,
        ry: f64,
        angle: f64,
        filled: bool,
        color: String,
    },
    /// Draw a straight line (for stems, staff lines, barlines, ledger lines).
    DrawLine {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        width: f64,
        color: String,
    },
    /// Draw a cubic bezier curve (for slurs, ties).
    DrawBezier {
        x1: f64,
        y1: f64,
        cx1: f64,
        cy1: f64,
        cx2: f64,
        cy2: f64,
        x2: f64,
        y2: f64,
        width: f64,
        color: String,
    },
    /// Draw a quadratic curve (for flags).
    DrawQuadratic {
        x1: f64,
        y1: f64,
        cx: f64,
        cy: f64,
        x2: f64,
        y2: f64,
        width: f64,
        color: String,
    },
    /// Draw a filled rectangle (for beams, whole/half rests).
    DrawRect {
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        color: String,
    },
    /// Draw a filled circle (for augmentation dots, staccato).
    DrawCircle {
        cx: f64,
        cy: f64,
        r: f64,
        color: String,
    },
    /// Draw a text string (for time signatures, dynamics, clef symbols).
    DrawText {
        x: f64,
        y: f64,
        text: String,
        font: String,
        size: f64,
        color: String,
        align: TextAlign,
        baseline: TextBaseline,
    },
    /// Draw a SMuFL glyph by codepoint (for real music font rendering).
    DrawGlyph {
        x: f64,
        y: f64,
        codepoint: u32,
        font: String,
        size: f64,
        color: String,
        /// Rotation in radians (clockwise). 0.0 = no rotation.
        /// Used for multi-segment arpeggio glyphs which are horizontal in the font
        /// but rendered vertically.
        #[serde(default, skip_serializing_if = "is_zero")]
        rotation: f64,
    },
    /// Draw a SMuFL glyph with an independent horizontal scale.
    ///
    /// Separate from `DrawGlyph` because stretching a glyph is the exception,
    /// not the rule: the brace is the one symbol a score has to fit to a
    /// distance its design never anticipated. `size` sets the vertical scale
    /// exactly as it does for `DrawGlyph`; `scale_x` then multiplies the
    /// horizontal axis about the glyph origin, so a value below 1 narrows the
    /// glyph without touching its height.
    DrawStretchedGlyph {
        x: f64,
        y: f64,
        codepoint: u32,
        font: String,
        size: f64,
        /// Horizontal scale about `(x, y)`. 1.0 draws the glyph proportionally.
        scale_x: f64,
        color: String,
    },
    /// Draw a filled polygon (for angled beams). 4 vertices forming a parallelogram.
    DrawPolygon {
        points: Vec<(f64, f64)>,
        color: String,
    },
    /// Draw a filled bezier shape (two contour curves) for variable-width ties/slurs.
    /// Outer and inner cubic bezier curves. When `ix1/iy1/ix2/iy2` differ from
    /// `x1/y1/x2/y2`, the tips have a finite width (perpendicular offset
    /// between outer endpoint at x1/y1 and inner endpoint at ix1/iy1), giving
    /// a tapered-but-not-pointed look. The `(x1,y1)/(x2,y2)` pair is the
    /// outer contour endpoint; `(ix*,iy*)` is the inner contour endpoint.
    DrawFilledBezier {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        /// Outer contour control points (farther from staff)
        ocx1: f64,
        ocy1: f64,
        ocx2: f64,
        ocy2: f64,
        /// Inner contour control points (closer to staff)
        icx1: f64,
        icy1: f64,
        icx2: f64,
        icy2: f64,
        /// Inner contour endpoints (for finite tip width). When omitted in
        /// JSON, default to `(x1,y1)/(x2,y2)` (zero-width pointed tips).
        #[serde(default)]
        ix1: f64,
        #[serde(default)]
        iy1: f64,
        #[serde(default)]
        ix2: f64,
        #[serde(default)]
        iy2: f64,
        color: String,
        /// Line style: 0=solid (filled crescent), 1=dashed, 2=dotted.
        /// Non-zero values render as a stroked bezier through the midline.
        #[serde(default)]
        line_style: u8,
    },
    /// Set the global opacity for subsequent render commands (0.0–1.0).
    /// Used to dim expansion staves.
    SetOpacity { opacity: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextBaseline {
    Top,
    Middle,
    Bottom,
    Alphabetic,
}

impl RenderCommand {
    /// Tight-ish axis-aligned bbox for this command, or `None` if the command
    /// has no spatial extent (`SetOpacity`) or its geometry isn't yet derivable
    /// without external metadata (`DrawGlyph` / `DrawText` — return `None`
    /// today; callers should publish those via `ShapeGeom::Rect` with a
    /// glyph-metrics-derived rect at emit time).
    ///
    /// Used by the shape registry to derive geometry on demand for primitives
    /// whose draw-command coordinates ARE the geometry.
    pub fn bbox(&self) -> Option<BoundingBox> {
        match self {
            RenderCommand::DrawEllipse { cx, cy, rx, ry, .. } => {
                Some(BoundingBox::new(cx - rx, cy - ry, 2.0 * rx, 2.0 * ry))
            }
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } => {
                let half = *width * 0.5;
                let lx = x1.min(*x2) - half;
                let rx = x1.max(*x2) + half;
                let ty = y1.min(*y2) - half;
                let by = y1.max(*y2) + half;
                Some(BoundingBox::new(lx, ty, rx - lx, by - ty))
            }
            RenderCommand::DrawRect { x, y, w, h, .. } => Some(BoundingBox::new(*x, *y, *w, *h)),
            RenderCommand::DrawCircle { cx, cy, r, .. } => {
                Some(BoundingBox::new(cx - r, cy - r, 2.0 * r, 2.0 * r))
            }
            RenderCommand::DrawPolygon { points, .. } => {
                if points.is_empty() {
                    return None;
                }
                let (mut lx, mut ty) = points[0];
                let (mut rx, mut by) = points[0];
                for &(x, y) in points.iter().skip(1) {
                    if x < lx {
                        lx = x;
                    }
                    if x > rx {
                        rx = x;
                    }
                    if y < ty {
                        ty = y;
                    }
                    if y > by {
                        by = y;
                    }
                }
                Some(BoundingBox::new(lx, ty, rx - lx, by - ty))
            }
            RenderCommand::DrawQuadratic {
                x1,
                y1,
                cx,
                cy,
                x2,
                y2,
                width,
                ..
            } => {
                // Conservative hull: control polygon extents expanded by stroke half-width.
                let half = *width * 0.5;
                let lx = x1.min(*cx).min(*x2) - half;
                let rx = x1.max(*cx).max(*x2) + half;
                let ty = y1.min(*cy).min(*y2) - half;
                let by = y1.max(*cy).max(*y2) + half;
                Some(BoundingBox::new(lx, ty, rx - lx, by - ty))
            }
            RenderCommand::DrawBezier {
                x1,
                y1,
                cx1,
                cy1,
                cx2,
                cy2,
                x2,
                y2,
                width,
                ..
            } => {
                let half = *width * 0.5;
                let lx = x1.min(*cx1).min(*cx2).min(*x2) - half;
                let rx = x1.max(*cx1).max(*cx2).max(*x2) + half;
                let ty = y1.min(*cy1).min(*cy2).min(*y2) - half;
                let by = y1.max(*cy1).max(*cy2).max(*y2) + half;
                Some(BoundingBox::new(lx, ty, rx - lx, by - ty))
            }
            RenderCommand::DrawFilledBezier {
                x1,
                y1,
                x2,
                y2,
                ocx1,
                ocy1,
                ocx2,
                ocy2,
                icx1,
                icy1,
                icx2,
                icy2,
                ix1,
                iy1,
                ix2,
                iy2,
                ..
            } => {
                let xs = [*x1, *x2, *ocx1, *ocx2, *icx1, *icx2, *ix1, *ix2];
                let ys = [*y1, *y2, *ocy1, *ocy2, *icy1, *icy2, *iy1, *iy2];
                let lx = xs.iter().copied().fold(f64::INFINITY, f64::min);
                let rx = xs.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                let ty = ys.iter().copied().fold(f64::INFINITY, f64::min);
                let by = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                Some(BoundingBox::new(lx, ty, rx - lx, by - ty))
            }
            // Glyph bbox derived from SMuFL metrics. Bravura convention:
            // `size` is the px-per-em where 1 em = 4 staff spaces, and
            // `smufl::glyph_bbox` returns (x, y, w, h) in staff spaces with
            // y measured downward from origin. Returns `None` for unknown
            // glyphs (smufl falls back to a generic box). DrawText still
            // needs producer-side bbox via ShapeGeom::Rect.
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } => {
                let (bx, by, bw, bh) = smufl::smufl::glyph_bbox(*codepoint);
                if bw <= 0.0 || bh <= 0.0 {
                    return None;
                }
                let s = *size * 0.25; // px per staff-space
                Some(BoundingBox::new(x + bx * s, y + by * s, bw * s, bh * s))
            }
            RenderCommand::DrawStretchedGlyph {
                x,
                y,
                codepoint,
                size,
                scale_x,
                ..
            } => {
                let (bx, by, bw, bh) = smufl::smufl::glyph_bbox(*codepoint);
                if bw <= 0.0 || bh <= 0.0 {
                    return None;
                }
                let s = *size * 0.25; // px per staff-space
                Some(BoundingBox::new(
                    x + bx * s * scale_x,
                    y + by * s,
                    bw * s * scale_x,
                    bh * s,
                ))
            }
            RenderCommand::DrawText { .. } => None,
            RenderCommand::SetOpacity { .. } => None,
        }
    }

    /// Translate all coordinates of this command by (dx, dy) in place.
    /// Used by `DisplayList::translate` to apply a global shift uniformly.
    pub fn translate_in_place(&mut self, dx: f64, dy: f64) {
        if dx == 0.0 && dy == 0.0 {
            return;
        }
        match self {
            RenderCommand::DrawEllipse { cx, cy, .. } => {
                *cx += dx;
                *cy += dy;
            }
            RenderCommand::DrawLine { x1, y1, x2, y2, .. } => {
                *x1 += dx;
                *y1 += dy;
                *x2 += dx;
                *y2 += dy;
            }
            RenderCommand::DrawBezier {
                x1,
                y1,
                cx1,
                cy1,
                cx2,
                cy2,
                x2,
                y2,
                ..
            } => {
                *x1 += dx;
                *y1 += dy;
                *cx1 += dx;
                *cy1 += dy;
                *cx2 += dx;
                *cy2 += dy;
                *x2 += dx;
                *y2 += dy;
            }
            RenderCommand::DrawQuadratic {
                x1,
                y1,
                cx,
                cy,
                x2,
                y2,
                ..
            } => {
                *x1 += dx;
                *y1 += dy;
                *cx += dx;
                *cy += dy;
                *x2 += dx;
                *y2 += dy;
            }
            RenderCommand::DrawRect { x, y, .. } => {
                *x += dx;
                *y += dy;
            }
            RenderCommand::DrawCircle { cx, cy, .. } => {
                *cx += dx;
                *cy += dy;
            }
            RenderCommand::DrawText { x, y, .. } => {
                *x += dx;
                *y += dy;
            }
            RenderCommand::DrawGlyph { x, y, .. }
            | RenderCommand::DrawStretchedGlyph { x, y, .. } => {
                *x += dx;
                *y += dy;
            }
            RenderCommand::DrawPolygon { points, .. } => {
                for (px, py) in points.iter_mut() {
                    *px += dx;
                    *py += dy;
                }
            }
            RenderCommand::DrawFilledBezier {
                x1,
                y1,
                x2,
                y2,
                ocx1,
                ocy1,
                ocx2,
                ocy2,
                icx1,
                icy1,
                icx2,
                icy2,
                ix1,
                iy1,
                ix2,
                iy2,
                ..
            } => {
                *x1 += dx;
                *y1 += dy;
                *x2 += dx;
                *y2 += dy;
                *ocx1 += dx;
                *ocy1 += dy;
                *ocx2 += dx;
                *ocy2 += dy;
                *icx1 += dx;
                *icy1 += dy;
                *icx2 += dx;
                *icy2 += dy;
                *ix1 += dx;
                *iy1 += dy;
                *ix2 += dx;
                *iy2 += dy;
            }
            RenderCommand::SetOpacity { .. } => {}
        }
    }

    /// Return a copy of this command with all y-coordinates shifted by `dy`.
    pub fn offset_y(self, dy: f64) -> Self {
        match self {
            RenderCommand::DrawEllipse {
                cx,
                cy,
                rx,
                ry,
                angle,
                filled,
                color,
            } => RenderCommand::DrawEllipse {
                cx,
                cy: cy + dy,
                rx,
                ry,
                angle,
                filled,
                color,
            },
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                color,
            } => RenderCommand::DrawLine {
                x1,
                y1: y1 + dy,
                x2,
                y2: y2 + dy,
                width,
                color,
            },
            RenderCommand::DrawBezier {
                x1,
                y1,
                cx1,
                cy1,
                cx2,
                cy2,
                x2,
                y2,
                width,
                color,
            } => RenderCommand::DrawBezier {
                x1,
                y1: y1 + dy,
                cx1,
                cy1: cy1 + dy,
                cx2,
                cy2: cy2 + dy,
                x2,
                y2: y2 + dy,
                width,
                color,
            },
            RenderCommand::DrawQuadratic {
                x1,
                y1,
                cx,
                cy,
                x2,
                y2,
                width,
                color,
            } => RenderCommand::DrawQuadratic {
                x1,
                y1: y1 + dy,
                cx,
                cy: cy + dy,
                x2,
                y2: y2 + dy,
                width,
                color,
            },
            RenderCommand::DrawRect { x, y, w, h, color } => RenderCommand::DrawRect {
                x,
                y: y + dy,
                w,
                h,
                color,
            },
            RenderCommand::DrawCircle { cx, cy, r, color } => RenderCommand::DrawCircle {
                cx,
                cy: cy + dy,
                r,
                color,
            },
            RenderCommand::DrawText {
                x,
                y,
                text,
                font,
                size,
                color,
                align,
                baseline,
            } => RenderCommand::DrawText {
                x,
                y: y + dy,
                text,
                font,
                size,
                color,
                align,
                baseline,
            },
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                font,
                size,
                color,
                rotation,
            } => RenderCommand::DrawGlyph {
                x,
                y: y + dy,
                codepoint,
                font,
                size,
                color,
                rotation,
            },
            RenderCommand::DrawStretchedGlyph {
                x,
                y,
                codepoint,
                font,
                size,
                scale_x,
                color,
            } => RenderCommand::DrawStretchedGlyph {
                x,
                y: y + dy,
                codepoint,
                font,
                size,
                scale_x,
                color,
            },
            RenderCommand::DrawPolygon { points, color } => RenderCommand::DrawPolygon {
                points: points.into_iter().map(|(px, py)| (px, py + dy)).collect(),
                color,
            },
            RenderCommand::DrawFilledBezier {
                x1,
                y1,
                x2,
                y2,
                ocx1,
                ocy1,
                ocx2,
                ocy2,
                icx1,
                icy1,
                icx2,
                icy2,
                ix1,
                iy1,
                ix2,
                iy2,
                color,
                line_style,
            } => RenderCommand::DrawFilledBezier {
                x1,
                y1: y1 + dy,
                x2,
                y2: y2 + dy,
                ocx1,
                ocy1: ocy1 + dy,
                ocx2,
                ocy2: ocy2 + dy,
                icx1,
                icy1: icy1 + dy,
                icx2,
                icy2: icy2 + dy,
                ix1,
                iy1: iy1 + dy,
                ix2,
                iy2: iy2 + dy,
                color,
                line_style,
            },
            RenderCommand::SetOpacity { opacity } => RenderCommand::SetOpacity { opacity },
        }
    }

    /// Replace the color field of this command with `new_color`.
    pub fn recolor(&mut self, new_color: &str) {
        match self {
            RenderCommand::DrawEllipse { color, .. }
            | RenderCommand::DrawLine { color, .. }
            | RenderCommand::DrawBezier { color, .. }
            | RenderCommand::DrawQuadratic { color, .. }
            | RenderCommand::DrawRect { color, .. }
            | RenderCommand::DrawCircle { color, .. }
            | RenderCommand::DrawText { color, .. }
            | RenderCommand::DrawGlyph { color, .. }
            | RenderCommand::DrawStretchedGlyph { color, .. }
            | RenderCommand::DrawPolygon { color, .. }
            | RenderCommand::DrawFilledBezier { color, .. } => {
                *color = new_color.to_string();
            }
            RenderCommand::SetOpacity { .. } => {}
        }
    }
}
