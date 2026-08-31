use super::*;

impl DisplayList {
    /// Draw a staff line spanning from x1 to x2 at the given y position.
    pub fn staff_line(&mut self, x1: f64, x2: f64, y: f64, width: f64) {
        self.push(RenderCommand::DrawLine {
            x1,
            y1: y,
            x2,
            y2: y,
            width,
            color: "#000000".into(),
        });
    }

    /// Draw a stem and register its command-backed collision shape.
    pub fn stem(&mut self, x: f64, y1: f64, y2: f64, width: f64) {
        let idx = self.commands.len();
        self.push(RenderCommand::DrawLine {
            x1: x,
            y1,
            x2: x,
            y2,
            width,
            color: "#000000".into(),
        });
        self.push_shape_cmd(idx, String::new(), ElementKind::Stem, None, None);
    }

    /// Draw a notehead ellipse.
    pub fn notehead(&mut self, cx: f64, cy: f64, rx: f64, ry: f64, filled: bool) {
        self.push(RenderCommand::DrawEllipse {
            cx,
            cy,
            rx,
            ry,
            angle: -0.15,
            filled,
            color: "#000000".into(),
        });
    }

    /// Draw a ledger line and register its command-backed collision shape.
    pub fn ledger_line(&mut self, x: f64, y: f64, width: f64, line_width: f64) {
        let idx = self.commands.len();
        self.push(RenderCommand::DrawLine {
            x1: x,
            y1: y,
            x2: x + width,
            y2: y,
            width: line_width,
            color: "#000000".into(),
        });
        self.push_shape_cmd(idx, String::new(), ElementKind::LedgerLine, None, None);
    }

    /// Draw a barline.
    pub fn barline(&mut self, x: f64, y_top: f64, y_bottom: f64, width: f64) {
        self.push(RenderCommand::DrawLine {
            x1: x,
            y1: y_top,
            x2: x,
            y2: y_bottom,
            width,
            color: "#000000".into(),
        });
    }

    /// Draw an augmentation dot.
    pub fn dot(&mut self, cx: f64, cy: f64, r: f64) {
        self.push(RenderCommand::DrawCircle {
            cx,
            cy,
            r,
            color: "#000000".into(),
        });
    }

    /// Draw a horizontal beam rectangle.
    pub fn beam(&mut self, x: f64, y: f64, w: f64, h: f64) {
        self.push(RenderCommand::DrawRect {
            x,
            y,
            w,
            h,
            color: "#000000".into(),
        });
    }

    /// Draw an angled beam as a filled parallelogram.
    pub fn beam_angled(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, thickness: f64) {
        self.push(RenderCommand::DrawPolygon {
            points: vec![
                (x1, y1),
                (x2, y2),
                (x2, y2 + thickness),
                (x1, y1 + thickness),
            ],
            color: "#000000".into(),
        });
    }

    /// Draw a SMuFL glyph without rotation.
    pub fn glyph(&mut self, x: f64, y: f64, codepoint: u32, font: &str, size: f64, color: &str) {
        self.push(RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            font: font.into(),
            size,
            color: color.into(),
            rotation: 0.0,
        });
    }

    /// Draw a SMuFL glyph with clockwise rotation in radians.
    pub fn glyph_rotated(
        &mut self,
        x: f64,
        y: f64,
        codepoint: u32,
        font: &str,
        size: f64,
        color: &str,
        rotation: f64,
    ) {
        self.push(RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            font: font.into(),
            size,
            color: color.into(),
            rotation,
        });
    }
}
