//! SVG renderer — converts a DisplayList into per-page SVG strings.
//!
//! Music glyphs (DrawGlyph) and text (DrawText) are expanded to vector
//! path outlines using `ttf-parser`, producing standalone SVGs with no
//! external font dependencies. Every coordinate comes from the layout
//! engine, so there are no coordinate-system mismatches.

use crate::render::{DisplayList, PageLayout, RenderCommand, TextAlign, TextBaseline};
use std::fmt::Write;

// ─── Public types ──────────────────────────────────────────────────

/// Configuration for SVG export.
pub struct SvgExportConfig {
    /// Staff space size in mm.
    pub spatium_mm: f64,
    /// Staff space size in layout-engine pixels.
    pub sp_pixels: f64,
    /// Output page width (mm).
    pub page_width_mm: f64,
    /// Output page height (mm).
    pub page_height_mm: f64,
}

/// A single exported SVG page.
pub struct SvgPage {
    /// 1-based page number.
    pub page_number: usize,
    /// Complete SVG markup.
    pub svg: String,
    pub width_mm: f64,
    pub height_mm: f64,
}

// ─── Outline builder ───────────────────────────────────────────────

/// Accumulates SVG path `d` data from ttf-parser glyph outlines.
/// Applies scale + offset and flips Y (font design coords are y-up,
/// SVG uses y-down).
struct PathBuilder {
    d: String,
    scale: f64,
    x_off: f64,
    y_off: f64,
}

impl PathBuilder {
    fn new(x_off: f64, y_off: f64, scale: f64) -> Self {
        Self {
            d: String::with_capacity(256),
            scale,
            x_off,
            y_off,
        }
    }
    #[inline]
    fn sx(&self, x: f32) -> f64 {
        self.x_off + x as f64 * self.scale
    }
    #[inline]
    fn sy(&self, y: f32) -> f64 {
        self.y_off - y as f64 * self.scale
    }
}

impl ttf_parser::OutlineBuilder for PathBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.d, "M{:.3} {:.3}", self.sx(x), self.sy(y));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.d, "L{:.3} {:.3}", self.sx(x), self.sy(y));
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let _ = write!(
            self.d,
            "Q{:.3} {:.3} {:.3} {:.3}",
            self.sx(x1),
            self.sy(y1),
            self.sx(x),
            self.sy(y)
        );
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let _ = write!(
            self.d,
            "C{:.3} {:.3} {:.3} {:.3} {:.3} {:.3}",
            self.sx(x1),
            self.sy(y1),
            self.sx(x2),
            self.sy(y2),
            self.sx(x),
            self.sy(y)
        );
    }
    fn close(&mut self) {
        self.d.push('Z');
    }
}

// ─── Font helpers ──────────────────────────────────────────────────

/// Compute the SVG path `d` attribute for a single glyph.
fn glyph_to_path(
    face: &ttf_parser::Face<'_>,
    codepoint: u32,
    x_mm: f64,
    y_mm: f64,
    size_mm: f64,
) -> Option<String> {
    let c = char::from_u32(codepoint)?;
    let gid = face.glyph_index(c)?;
    let scale = size_mm / face.units_per_em() as f64;
    let mut b = PathBuilder::new(x_mm, y_mm, scale);
    face.outline_glyph(gid, &mut b)?;
    Some(b.d)
}

/// Total advance width of a string, in mm.
fn text_advance_mm(face: &ttf_parser::Face<'_>, text: &str, size_mm: f64) -> f64 {
    let scale = size_mm / face.units_per_em() as f64;
    text.chars()
        .filter_map(|c| {
            let gid = face.glyph_index(c)?;
            Some(face.glyph_hor_advance(gid)? as f64 * scale)
        })
        .sum()
}

/// Render a string to SVG path data (character by character).
fn text_to_path(
    face: &ttf_parser::Face<'_>,
    text: &str,
    x_mm: f64,
    y_mm: f64,
    size_mm: f64,
) -> String {
    let scale = size_mm / face.units_per_em() as f64;
    let mut full = String::with_capacity(text.len() * 128);
    let mut cx = x_mm;
    for c in text.chars() {
        if let Some(gid) = face.glyph_index(c) {
            let mut b = PathBuilder::new(cx, y_mm, scale);
            if face.outline_glyph(gid, &mut b).is_some() {
                full.push_str(&b.d);
            }
            cx += face.glyph_hor_advance(gid).unwrap_or(0) as f64 * scale;
        }
    }
    full
}

// ─── Page splitting ────────────────────────────────────────────────

/// Primary Y coordinate of a command (for page assignment).
fn cmd_y(cmd: &RenderCommand) -> f64 {
    match cmd {
        RenderCommand::DrawLine { y1, y2, .. } => y1.min(*y2),
        RenderCommand::DrawRect { y, .. } => *y,
        RenderCommand::DrawCircle { cy, .. } => *cy,
        RenderCommand::DrawEllipse { cy, .. } => *cy,
        RenderCommand::DrawText { y, .. } => *y,
        RenderCommand::DrawGlyph { y, .. } | RenderCommand::DrawStretchedGlyph { y, .. } => *y,
        RenderCommand::DrawBezier { y1, y2, .. } => y1.min(*y2),
        RenderCommand::DrawQuadratic { y1, y2, .. } => y1.min(*y2),
        RenderCommand::DrawFilledBezier { y1, y2, .. } => y1.min(*y2),
        RenderCommand::DrawPolygon { points, .. } => {
            points.iter().map(|p| p.1).fold(f64::INFINITY, f64::min)
        }
        RenderCommand::SetOpacity { .. } => 0.0,
    }
}

// ─── XML helpers ───────────────────────────────────────────────────

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ─── Main entry point ──────────────────────────────────────────────

/// Convert a `DisplayList` into one SVG string per page.
///
/// `bravura_data` — raw bytes of Bravura.otf (SMuFL music font).
/// `text_font_data` — optional raw bytes of a text font (e.g. BravuraText.otf).
///   When `None`, text is rendered as SVG `<text>` elements instead of paths.
pub fn display_list_to_svg_pages(
    dl: &DisplayList,
    bravura_data: &[u8],
    text_font_data: Option<&[u8]>,
    cfg: &SvgExportConfig,
) -> Result<Vec<SvgPage>, String> {
    let bravura = ttf_parser::Face::parse(bravura_data, 0)
        .map_err(|e| format!("Failed to parse Bravura font: {e:?}"))?;
    let text_face = text_font_data
        .map(|d| ttf_parser::Face::parse(d, 0))
        .transpose()
        .map_err(|e| format!("Failed to parse text font: {e:?}"))?;

    // Build page list (single page fallback when no page info).
    let pages: Vec<PageLayout> = if dl.pages.is_empty() {
        vec![PageLayout {
            page_number: 0,
            system_indices: vec![],
            y_offset: 0.0,
            height: dl.height,
        }]
    } else {
        dl.pages.clone()
    };

    // Assign commands to pages.
    let mut buckets: Vec<Vec<&RenderCommand>> = vec![Vec::new(); pages.len()];
    for cmd in &dl.commands {
        let y = cmd_y(cmd);
        let mut placed = false;
        for (i, pg) in pages.iter().enumerate() {
            if y >= pg.y_offset && y < pg.y_offset + pg.height {
                buckets[i].push(cmd);
                placed = true;
                break;
            }
        }
        if !placed {
            buckets[0].push(cmd);
        }
    }

    let mut out = Vec::with_capacity(pages.len());
    for (i, pg) in pages.iter().enumerate() {
        let mut elems: Vec<String> = Vec::with_capacity(buckets[i].len());
        let mut opacity = 1.0_f64;

        for cmd in &buckets[i] {
            if let Some(el) = render_cmd(cmd, pg, cfg, &bravura, text_face.as_ref(), opacity) {
                elems.push(el);
            }
            if let RenderCommand::SetOpacity { opacity: op } = cmd {
                opacity = *op;
            }
        }

        let cap: usize = elems.iter().map(|e| e.len() + 1).sum::<usize>() + 512;
        let mut svg = String::with_capacity(cap);
        let _ = write!(
            svg,
            "<svg xmlns=\"http://www.w3.org/2000/svg\" \
             width=\"{}mm\" height=\"{}mm\" \
             viewBox=\"0 0 {} {}\">\n\
             <rect width=\"100%\" height=\"100%\" fill=\"white\"/>\n",
            cfg.page_width_mm, cfg.page_height_mm, cfg.page_width_mm, cfg.page_height_mm,
        );
        for el in &elems {
            svg.push_str(el);
            svg.push('\n');
        }
        svg.push_str("</svg>");

        out.push(SvgPage {
            page_number: pg.page_number + 1, // 1-based
            svg,
            width_mm: cfg.page_width_mm,
            height_mm: cfg.page_height_mm,
        });
    }

    Ok(out)
}

// ─── Per-command rendering ─────────────────────────────────────────

/// Coordinate helpers scoped to a single page.
struct Ctx<'a> {
    cfg: &'a SvgExportConfig,
    y_offset: f64,
}

impl Ctx<'_> {
    #[inline]
    fn mm(&self, px: f64) -> f64 {
        px * (self.cfg.spatium_mm / self.cfg.sp_pixels)
    }
    #[inline]
    fn x(&self, ex: f64) -> f64 {
        self.mm(ex)
    }
    #[inline]
    fn y(&self, ey: f64) -> f64 {
        self.mm(ey - self.y_offset)
    }
}

// Dispatch `match` over every `RenderCommand` variant. Splitting into
// per-variant helpers would scatter the SVG formatting without aiding
// readability — the function is essentially a code-generation table.
#[allow(clippy::too_many_lines)] // Exhaustive RenderCommand-to-SVG dispatch table with no separable stateful sub-concept.
fn render_cmd(
    cmd: &RenderCommand,
    pg: &PageLayout,
    cfg: &SvgExportConfig,
    bravura: &ttf_parser::Face<'_>,
    text_face: Option<&ttf_parser::Face<'_>>,
    opacity: f64,
) -> Option<String> {
    let c = Ctx {
        cfg,
        y_offset: pg.y_offset,
    };
    let op = if opacity < 1.0 {
        format!(" opacity=\"{:.3}\"", opacity)
    } else {
        String::new()
    };

    match cmd {
        // ── Lines ──────────────────────────────────────────
        RenderCommand::DrawLine {
            x1,
            y1,
            x2,
            y2,
            width,
            color,
        } => Some(format!(
            "<line x1=\"{:.3}\" y1=\"{:.3}\" x2=\"{:.3}\" y2=\"{:.3}\" \
             stroke=\"{}\" stroke-width=\"{:.3}\" stroke-linecap=\"butt\"{op}/>",
            c.x(*x1),
            c.y(*y1),
            c.x(*x2),
            c.y(*y2),
            esc(color),
            c.mm(*width),
        )),

        // ── Rectangles ────────────────────────────────────
        RenderCommand::DrawRect { x, y, w, h, color } => Some(format!(
            "<rect x=\"{:.3}\" y=\"{:.3}\" width=\"{:.3}\" height=\"{:.3}\" fill=\"{}\"{op}/>",
            c.x(*x),
            c.y(*y),
            c.mm(*w),
            c.mm(*h),
            esc(color),
        )),

        // ── Circles ───────────────────────────────────────
        RenderCommand::DrawCircle { cx, cy, r, color } => Some(format!(
            "<circle cx=\"{:.3}\" cy=\"{:.3}\" r=\"{:.3}\" fill=\"{}\"{op}/>",
            c.x(*cx),
            c.y(*cy),
            c.mm(*r),
            esc(color),
        )),

        // ── Ellipses ──────────────────────────────────────
        RenderCommand::DrawEllipse {
            cx,
            cy,
            rx,
            ry,
            angle,
            filled,
            color,
        } => {
            let cxm = c.x(*cx);
            let cym = c.y(*cy);
            let fill = if *filled { esc(color) } else { "none".into() };
            let stroke = if *filled { "none".into() } else { esc(color) };
            let xf = if *angle != 0.0 {
                format!(
                    " transform=\"rotate({:.3},{:.3},{:.3})\"",
                    angle.to_degrees(),
                    cxm,
                    cym
                )
            } else {
                String::new()
            };
            Some(format!(
                "<ellipse cx=\"{:.3}\" cy=\"{:.3}\" rx=\"{:.3}\" ry=\"{:.3}\" \
                 fill=\"{}\" stroke=\"{}\"{xf}{op}/>",
                cxm,
                cym,
                c.mm(*rx),
                c.mm(*ry),
                fill,
                stroke,
            ))
        }

        // ── Glyphs (SMuFL → path) ─────────────────────────
        RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            size,
            color,
            rotation,
            ..
        } => {
            let sz = c.mm(*size);
            if *rotation != 0.0 {
                let d = glyph_to_path(bravura, *codepoint, 0.0, 0.0, sz)?;
                Some(format!(
                    "<path d=\"{d}\" fill=\"{}\" \
                     transform=\"translate({:.3},{:.3}) rotate({:.3})\"{op}/>",
                    esc(color),
                    c.x(*x),
                    c.y(*y),
                    rotation.to_degrees(),
                ))
            } else {
                let d = glyph_to_path(bravura, *codepoint, c.x(*x), c.y(*y), sz)?;
                Some(format!("<path d=\"{d}\" fill=\"{}\"{op}/>", esc(color)))
            }
        }

        // ── Stretched glyph (brace) ───────────────────────
        RenderCommand::DrawStretchedGlyph {
            x,
            y,
            codepoint,
            size,
            scale_x,
            color,
            ..
        } => {
            let d = glyph_to_path(bravura, *codepoint, 0.0, 0.0, c.mm(*size))?;
            Some(format!(
                "<path d=\"{d}\" fill=\"{}\" \
                 transform=\"translate({:.3},{:.3}) scale({:.4},1)\"{op}/>",
                esc(color),
                c.x(*x),
                c.y(*y),
                scale_x,
            ))
        }

        // ── Text (→ path when font available, else <text>) ─
        RenderCommand::DrawText {
            x,
            y,
            text,
            font,
            size,
            color,
            align,
            baseline,
        } => {
            let face = if font == "Bravura" {
                Some(bravura)
            } else {
                text_face
            };

            if let Some(face) = face {
                let sz = c.mm(*size);
                let upem = face.units_per_em() as f64;
                let asc = face.ascender() as f64;

                // Adjust x for alignment (in engine px, before mm conversion).
                let mut xa = *x;
                if !matches!(align, TextAlign::Left) {
                    let adv_mm = text_advance_mm(face, text, sz);
                    let adv_px = adv_mm / (cfg.spatium_mm / cfg.sp_pixels);
                    match align {
                        TextAlign::Center => xa -= adv_px / 2.0,
                        TextAlign::Right => xa -= adv_px,
                        _ => {}
                    }
                }

                // Adjust y for baseline (in engine px).
                let mut ya = *y;
                match baseline {
                    TextBaseline::Top => ya += *size * asc / upem,
                    TextBaseline::Middle => ya += *size * asc / (upem * 2.0),
                    TextBaseline::Bottom | TextBaseline::Alphabetic => {}
                }

                let d = text_to_path(face, text, c.x(xa), c.y(ya), sz);
                if !d.is_empty() {
                    return Some(format!("<path d=\"{d}\" fill=\"{}\"{op}/>", esc(color)));
                }
            }
            // Font unavailable or couldn't produce outlines → SVG <text> fallback
            render_text_fallback(*x, *y, text, font, *size, color, align, baseline, &c, &op)
        }

        // ── Cubic beziers (stroked) ────────────────────────
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
        } => Some(format!(
            "<path d=\"M{:.3} {:.3} C{:.3} {:.3},{:.3} {:.3},{:.3} {:.3}\" \
                 fill=\"none\" stroke=\"{}\" stroke-width=\"{:.3}\" stroke-linecap=\"round\"{op}/>",
            c.x(*x1),
            c.y(*y1),
            c.x(*cx1),
            c.y(*cy1),
            c.x(*cx2),
            c.y(*cy2),
            c.x(*x2),
            c.y(*y2),
            esc(color),
            c.mm(*width),
        )),

        // ── Quadratic beziers ──────────────────────────────
        RenderCommand::DrawQuadratic {
            x1,
            y1,
            cx,
            cy,
            x2,
            y2,
            width,
            color,
        } => Some(format!(
            "<path d=\"M{:.3} {:.3} Q{:.3} {:.3},{:.3} {:.3}\" \
                 fill=\"none\" stroke=\"{}\" stroke-width=\"{:.3}\" stroke-linecap=\"round\"{op}/>",
            c.x(*x1),
            c.y(*y1),
            c.x(*cx),
            c.y(*cy),
            c.x(*x2),
            c.y(*y2),
            esc(color),
            c.mm(*width),
        )),

        // ── Filled beziers (slurs/ties) ────────────────────
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
        } => {
            if *line_style == 1 || *line_style == 2 {
                let w = c.mm((*ocy1 - *icy1).abs() * 0.3).max(c.mm(1.0));
                let (da, db) = if *line_style == 1 {
                    (c.mm(4.0), c.mm(3.0))
                } else {
                    (c.mm(1.0), c.mm(2.0))
                };
                Some(format!(
                    "<path d=\"M{:.3} {:.3} C{:.3} {:.3},{:.3} {:.3},{:.3} {:.3}\" \
                     fill=\"none\" stroke=\"{}\" stroke-width=\"{:.3}\" \
                     stroke-dasharray=\"{:.3} {:.3}\" stroke-linecap=\"round\"{op}/>",
                    c.x(*x1),
                    c.y(*y1),
                    c.x(*ocx1),
                    c.y(*ocy1),
                    c.x(*ocx2),
                    c.y(*ocy2),
                    c.x(*x2),
                    c.y(*y2),
                    esc(color),
                    w,
                    da,
                    db,
                ))
            } else {
                // Solid filled crescent with rounded tip caps (quadratic
                // bulging outward along the local tangent at each endpoint).
                let cap1tx = *x1 - *ocx1;
                let cap1ty = *y1 - *ocy1;
                let cap1tl = (cap1tx * cap1tx + cap1ty * cap1ty).sqrt().max(1e-6);
                let cap1w = ((*x1 - *ix1).powi(2) + (*y1 - *iy1).powi(2)).sqrt();
                let cap1ext = cap1w * 0.55;
                let cap1cx = (*x1 + *ix1) * 0.5 + (cap1tx / cap1tl) * cap1ext;
                let cap1cy = (*y1 + *iy1) * 0.5 + (cap1ty / cap1tl) * cap1ext;

                let cap2tx = *x2 - *ocx2;
                let cap2ty = *y2 - *ocy2;
                let cap2tl = (cap2tx * cap2tx + cap2ty * cap2ty).sqrt().max(1e-6);
                let cap2w = ((*x2 - *ix2).powi(2) + (*y2 - *iy2).powi(2)).sqrt();
                let cap2ext = cap2w * 0.55;
                let cap2cx = (*x2 + *ix2) * 0.5 + (cap2tx / cap2tl) * cap2ext;
                let cap2cy = (*y2 + *iy2) * 0.5 + (cap2ty / cap2tl) * cap2ext;

                Some(format!(
                    "<path d=\"M{:.3} {:.3} C{:.3} {:.3},{:.3} {:.3},{:.3} {:.3} \
                     Q{:.3} {:.3},{:.3} {:.3} C{:.3} {:.3},{:.3} {:.3},{:.3} {:.3} \
                     Q{:.3} {:.3},{:.3} {:.3} Z\" fill=\"{}\"{op}/>",
                    c.x(*x1),
                    c.y(*y1),
                    c.x(*ocx1),
                    c.y(*ocy1),
                    c.x(*ocx2),
                    c.y(*ocy2),
                    c.x(*x2),
                    c.y(*y2),
                    c.x(cap2cx),
                    c.y(cap2cy),
                    c.x(*ix2),
                    c.y(*iy2),
                    c.x(*icx2),
                    c.y(*icy2),
                    c.x(*icx1),
                    c.y(*icy1),
                    c.x(*ix1),
                    c.y(*iy1),
                    c.x(cap1cx),
                    c.y(cap1cy),
                    c.x(*x1),
                    c.y(*y1),
                    esc(color),
                ))
            }
        }

        // ── Polygons ──────────────────────────────────────
        RenderCommand::DrawPolygon { points, color } => {
            if points.len() < 2 {
                return None;
            }
            let pts: String = points
                .iter()
                .map(|(px, py)| format!("{:.3},{:.3}", c.x(*px), c.y(*py)))
                .collect::<Vec<_>>()
                .join(" ");
            Some(format!(
                "<polygon points=\"{pts}\" fill=\"{}\"{op}/>",
                esc(color)
            ))
        }

        RenderCommand::SetOpacity { .. } => None,
    }
}

/// Fallback: render text as an SVG `<text>` element (no font data available).
fn render_text_fallback(
    x: f64,
    y: f64,
    text: &str,
    font: &str,
    size: f64,
    color: &str,
    align: &TextAlign,
    baseline: &TextBaseline,
    c: &Ctx<'_>,
    op: &str,
) -> Option<String> {
    let anchor = match align {
        TextAlign::Left => "start",
        TextAlign::Center => "middle",
        TextAlign::Right => "end",
    };
    let dom_bl = match baseline {
        TextBaseline::Top => "text-before-edge",
        TextBaseline::Middle => "central",
        TextBaseline::Bottom => "text-after-edge",
        TextBaseline::Alphabetic => "alphabetic",
    };
    let style = if font.contains("italic") {
        "italic"
    } else {
        "normal"
    };
    let weight = if font.contains("bold") {
        "bold"
    } else {
        "normal"
    };
    Some(format!(
        "<text x=\"{:.3}\" y=\"{:.3}\" font-family=\"serif\" font-size=\"{:.3}\" \
         font-style=\"{style}\" font-weight=\"{weight}\" fill=\"{}\" \
         text-anchor=\"{anchor}\" dominant-baseline=\"{dom_bl}\"{op}>{}</text>",
        c.x(x),
        c.y(y),
        c.mm(size),
        esc(color),
        esc(text),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ttf_parser::OutlineBuilder;

    #[test]
    fn path_builder_produces_valid_svg_path() {
        let mut b = PathBuilder::new(10.0, 20.0, 0.5);
        b.move_to(0.0, 0.0);
        b.line_to(10.0, 20.0);
        b.close();
        assert!(b.d.starts_with('M'));
        assert!(b.d.contains('L'));
        assert!(b.d.ends_with('Z'));
    }

    #[test]
    fn empty_display_list_produces_single_page() {
        let dl = DisplayList::new(100.0, 200.0);
        assert!(dl.pages.is_empty());
        assert_eq!(dl.commands.len(), 0);
    }

    #[test]
    fn bravura_glyph_extraction_works() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let font_path = format!("{}/../../assets/fonts/Bravura.otf", manifest_dir);
        let font_data = std::fs::read(&font_path)
            .unwrap_or_else(|e| panic!("Cannot read Bravura font at {}: {}", font_path, e));

        let face = ttf_parser::Face::parse(&font_data, 0).expect("Failed to parse Bravura font");

        eprintln!(
            "Font tables: units_per_em={}, num_glyphs={}",
            face.units_per_em(),
            face.number_of_glyphs()
        );
        eprintln!("Has glyf table: {}", face.tables().glyf.is_some());
        eprintln!("Has CFF table: {}", face.tables().cff.is_some());

        // Test treble clef (U+E050)
        let treble_char = char::from_u32(0xE050).unwrap();
        let gid = face.glyph_index(treble_char);
        eprintln!("Treble clef (U+E050) glyph index: {:?}", gid);
        assert!(gid.is_some(), "Treble clef glyph not found in cmap");

        let gid = gid.unwrap();
        let mut builder = PathBuilder::new(10.0, 20.0, 0.007);
        let result = face.outline_glyph(gid, &mut builder);
        eprintln!("outline_glyph result: {:?}", result.is_some());
        eprintln!("Path length: {}", builder.d.len());
        if builder.d.len() < 200 {
            eprintln!("Path data: {}", builder.d);
        } else {
            eprintln!("Path data (first 200): {}...", &builder.d[..200]);
        }
        assert!(
            result.is_some(),
            "outline_glyph returned None for treble clef"
        );
        assert!(!builder.d.is_empty(), "Path data is empty for treble clef");

        // Also test glyph_to_path helper
        let path = glyph_to_path(&face, 0xE050, 10.0, 20.0, 7.0);
        assert!(path.is_some(), "glyph_to_path failed for treble clef");
        let path_str = path.unwrap();
        assert!(path_str.contains('M'), "Path should contain M command");
        eprintln!("glyph_to_path produced {} chars", path_str.len());
    }

    #[test]
    fn bravura_full_svg_export() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let font_path = format!("{}/../../assets/fonts/Bravura.otf", manifest_dir);
        let font_data = std::fs::read(&font_path)
            .unwrap_or_else(|e| panic!("Cannot read Bravura font at {}: {}", font_path, e));

        let text_font_path = format!("{}/../../assets/fonts/BravuraText.otf", manifest_dir);
        let text_font_data = std::fs::read(&text_font_path).ok();

        // Check text font details
        if let Some(ref td) = text_font_data {
            eprintln!("BravuraText font loaded: {} bytes", td.len());
            if let Ok(tf) = ttf_parser::Face::parse(td, 0) {
                eprintln!(
                    "BravuraText: units_per_em={}, glyphs={}",
                    tf.units_per_em(),
                    tf.number_of_glyphs()
                );
                eprintln!(
                    "BravuraText has glyf: {}, has CFF: {}",
                    tf.tables().glyf.is_some(),
                    tf.tables().cff.is_some()
                );
                // Test standard characters
                for c in ['A', 'l', 'e', 'g', 'r', 'o', '4', '/'] {
                    let gid = tf.glyph_index(c);
                    let has_outline = gid
                        .map(|g| {
                            let mut b = PathBuilder::new(0.0, 0.0, 0.01);
                            tf.outline_glyph(g, &mut b).is_some()
                        })
                        .unwrap_or(false);
                    eprintln!(
                        "  '{}': glyph_index={:?}, has_outline={}",
                        c, gid, has_outline
                    );
                }
            } else {
                eprintln!("BravuraText: FAILED to parse");
            }
        } else {
            eprintln!("BravuraText font file not found");
        }

        // Create a small display list with DrawGlyph, DrawText, DrawEllipse, DrawLine
        let mut dl = DisplayList::new(800.0, 400.0);
        dl.push(RenderCommand::DrawLine {
            x1: 50.0,
            y1: 100.0,
            x2: 750.0,
            y2: 100.0,
            width: 1.0,
            color: "#000000".into(),
        });
        dl.push(RenderCommand::DrawGlyph {
            x: 60.0,
            y: 100.0,
            codepoint: 0xE050,
            font: "Bravura".into(),
            size: 84.0,
            color: "#000000".into(),
            rotation: 0.0,
        });
        dl.push(RenderCommand::DrawEllipse {
            cx: 200.0,
            cy: 100.0,
            rx: 7.0,
            ry: 5.0,
            angle: -0.15,
            filled: true,
            color: "#000000".into(),
        });
        dl.push(RenderCommand::DrawText {
            x: 50.0,
            y: 50.0,
            text: "Allegro".into(),
            font: "serif".into(),
            size: 40.0,
            color: "#000000".into(),
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
        });

        let cfg = SvgExportConfig {
            spatium_mm: 7.0,
            sp_pixels: 84.0,
            page_width_mm: 210.0,
            page_height_mm: 297.0,
        };

        let pages = display_list_to_svg_pages(&dl, &font_data, text_font_data.as_deref(), &cfg)
            .expect("SVG export should succeed");

        assert_eq!(pages.len(), 1);
        let svg = &pages[0].svg;
        eprintln!("SVG length: {} chars", svg.len());

        // Count element types
        let path_count = svg.matches("<path").count();
        let line_count = svg.matches("<line").count();
        let ellipse_count = svg.matches("<ellipse").count();

        eprintln!(
            "Elements: {} paths, {} lines, {} ellipses",
            path_count, line_count, ellipse_count
        );

        assert!(line_count >= 1, "Should have at least 1 line");
        assert!(ellipse_count >= 1, "Should have at least 1 ellipse");
        assert!(
            path_count >= 1,
            "Should have at least 1 path (glyph or text)"
        );

        // Print first path element for debugging
        if let Some(start) = svg.find("<path") {
            let end = svg[start..]
                .find("/>")
                .map(|i| start + i + 2)
                .unwrap_or(start + 100);
            eprintln!("First path: {}", &svg[start..end.min(svg.len())]);
        }
    }
}
