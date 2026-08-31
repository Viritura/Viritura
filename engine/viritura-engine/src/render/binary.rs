//! Binary display list encoder.
//!
//! Packs a `DisplayList` into a `Vec<f32>` for zero-parse transfer to JavaScript
//! via `Float32Array`. This avoids JSON serialization/parsing overhead for large
//! scores (>50 measures, ~100KB+ display lists).
//!
//! ## Binary Format
//!
//! ### Header
//! `[width, height, num_commands, num_pages, num_strings, num_element_bboxes, num_slur_geometries]`
//!
//! ### Page data (per page)
//! `[page_number, num_systems, ...system_indices, y_offset, height]`
//!
//! ### Commands
//! Each command: `[type_tag, ...params]`
//!
//! | Tag | Command          | Floats |
//! |-----|------------------|--------|
//! | 1   | DrawLine         | 7      |
//! | 2   | DrawRect         | 6      |
//! | 3   | DrawCircle       | 5      |
//! | 4   | DrawEllipse      | 8      |
//! | 5   | DrawGlyph        | 8      |
//! | 6   | DrawBezier       | 11     |
//! | 7   | DrawQuadratic    | 9      |
//! | 8   | DrawFilledBezier | 15     |
//! | 9   | DrawPolygon      | 3+2n   |
//! | 10  | DrawText         | 9+len  |
//! | 11  | SetOpacity       | 2      |
//! | 12  | DrawStretchedGlyph | 8    |

use super::{DisplayList, RenderCommand, TextAlign, TextBaseline};

// Command type tags
const TAG_DRAW_LINE: f32 = 1.0;
const TAG_DRAW_RECT: f32 = 2.0;
const TAG_DRAW_CIRCLE: f32 = 3.0;
const TAG_DRAW_ELLIPSE: f32 = 4.0;
const TAG_DRAW_GLYPH: f32 = 5.0;
const TAG_DRAW_BEZIER: f32 = 6.0;
const TAG_DRAW_QUADRATIC: f32 = 7.0;
const TAG_DRAW_FILLED_BEZIER: f32 = 8.0;
const TAG_DRAW_POLYGON: f32 = 9.0;
const TAG_DRAW_TEXT: f32 = 10.0;
const TAG_SET_OPACITY: f32 = 11.0;
const TAG_DRAW_STRETCHED_GLYPH: f32 = 12.0;

// Font IDs.
//
// ID 0 is the music font (Bravura). Text fonts pack a generic family and the
// bold/italic flags into a single ID: `1 + family*4 + style`, where
// `family` is serif=0, sans-serif=1, monospace=2 and `style` is
// `(bold as u32) | ((italic as u32) << 1)`. This yields 12 text IDs (1–12).
// IDs 1–3 stay backward-compatible with the old serif / serif-bold /
// serif-italic scheme.
const FONT_BRAVURA: f32 = 0.0;

/// Encode a "#RRGGBB" hex color string as an f32 (u32 bit pattern).
fn encode_color(color: &str) -> f32 {
    let hex = color.trim_start_matches('#');
    let rgb = u32::from_str_radix(hex, 16).unwrap_or(0);
    f32::from_bits(rgb)
}

/// Decode an f32 color back to a "#RRGGBB" string.
#[cfg(test)]
fn decode_color(val: f32) -> String {
    let rgb = f32::to_bits(val);
    format!("#{:06X}", rgb & 0xFFFFFF)
}

/// Map a font name string to a numeric ID.
///
/// Parses a canonical font string (`"serif"`, `"sans-serif bold"`,
/// `"monospace bold italic"`, …) into the packed family/style ID. `"Bravura"`
/// is the music font. Unknown families fall back to serif. Family detection
/// checks `"sans"` before `"serif"` because `"sans-serif"` contains `"serif"`.
fn encode_font(font: &str) -> f32 {
    if font == "Bravura" {
        return FONT_BRAVURA;
    }
    let family: u32 = if font.contains("sans") {
        1
    } else if font.contains("mono") {
        2
    } else {
        0
    };
    let bold = font.contains("bold");
    let italic = font.contains("italic");
    let style = (bold as u32) | ((italic as u32) << 1);
    (1 + family * 4 + style) as f32
}

/// Map a font ID back to a canonical font name string.
pub fn decode_font(id: f32) -> &'static str {
    match id as i32 {
        0 => "Bravura",
        1 => "serif",
        2 => "serif bold",
        3 => "serif italic",
        4 => "serif bold italic",
        5 => "sans-serif",
        6 => "sans-serif bold",
        7 => "sans-serif italic",
        8 => "sans-serif bold italic",
        9 => "monospace",
        10 => "monospace bold",
        11 => "monospace italic",
        12 => "monospace bold italic",
        _ => "serif",
    }
}

fn encode_text_align(align: &TextAlign) -> f32 {
    match align {
        TextAlign::Left => 0.0,
        TextAlign::Center => 1.0,
        TextAlign::Right => 2.0,
    }
}

fn encode_text_baseline(baseline: &TextBaseline) -> f32 {
    match baseline {
        TextBaseline::Top => 0.0,
        TextBaseline::Middle => 1.0,
        TextBaseline::Bottom => 2.0,
        TextBaseline::Alphabetic => 3.0,
    }
}

impl DisplayList {
    /// Serialize this display list into a packed `Vec<f32>` for binary transfer.
    ///
    /// ## Binary Format
    /// ### Header (7 floats)
    /// `[width, height, num_commands, num_pages, num_strings, num_element_bboxes, num_slur_geometries]`
    ///
    /// If measure bounds are present, they are appended as an optional trailer
    /// after the per-command element ID indices.
    pub fn to_binary(&self) -> Vec<f32> {
        let estimated_size = 7
            + self.pages.len() * 8
            + self.commands.len() * 12
            + self.element_bboxes.len() * 10
            + self.slur_geometries.len() * 13
            + self.measure_bounds.len() * 18;
        let mut buf: Vec<f32> = Vec::with_capacity(estimated_size);

        // Build string table from element_ids
        let mut string_table: Vec<&str> = Vec::new();
        let mut string_index_map: std::collections::HashMap<&str, usize> =
            std::collections::HashMap::new();
        let command_string_indices: Vec<f32> = if self.element_ids.is_empty() {
            vec![-1.0f32; self.commands.len()]
        } else {
            self.element_ids
                .iter()
                .map(|eid| match eid {
                    Some(s) => {
                        let idx = if let Some(&existing) = string_index_map.get(s.as_str()) {
                            existing
                        } else {
                            let idx = string_table.len();
                            string_table.push(s.as_str());
                            string_index_map.insert(s.as_str(), idx);
                            idx
                        };
                        idx as f32
                    }
                    None => -1.0f32,
                })
                .chain(
                    // Pad with -1.0 if element_ids is shorter than commands
                    (self.element_ids.len()..self.commands.len()).map(|_| -1.0f32),
                )
                .collect()
        };

        // Header (7 floats)
        buf.push(self.width as f32);
        buf.push(self.height as f32);
        buf.push(self.commands.len() as f32);
        buf.push(self.pages.len() as f32);
        buf.push(string_table.len() as f32);
        buf.push(self.element_bboxes.len() as f32);
        buf.push(self.slur_geometries.len() as f32);

        // Page data
        for page in &self.pages {
            buf.push(page.page_number as f32);
            buf.push(page.system_indices.len() as f32);
            for &idx in &page.system_indices {
                buf.push(idx as f32);
            }
            buf.push(page.y_offset as f32);
            buf.push(page.height as f32);
        }

        // Element bounding boxes: [id_len, ...id_codepoints, x, y, w, h]
        for eb in &self.element_bboxes {
            let codepoints: Vec<u32> = eb.element_id.chars().map(|c| c as u32).collect();
            buf.push(codepoints.len() as f32);
            for cp in &codepoints {
                buf.push(*cp as f32);
            }
            buf.push(eb.bbox.x as f32);
            buf.push(eb.bbox.y as f32);
            buf.push(eb.bbox.width as f32);
            buf.push(eb.bbox.height as f32);
        }

        // Slur geometries: [id_len, ...id_codepoints, p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, thickness, curve_dir, sp]
        for sg in &self.slur_geometries {
            let codepoints: Vec<u32> = sg.element_id.chars().map(|c| c as u32).collect();
            buf.push(codepoints.len() as f32);
            for cp in &codepoints {
                buf.push(*cp as f32);
            }
            buf.push(sg.p0_x as f32);
            buf.push(sg.p0_y as f32);
            buf.push(sg.p1_x as f32);
            buf.push(sg.p1_y as f32);
            buf.push(sg.p2_x as f32);
            buf.push(sg.p2_y as f32);
            buf.push(sg.p3_x as f32);
            buf.push(sg.p3_y as f32);
            buf.push(sg.thickness as f32);
            buf.push(sg.curve_dir as f32);
            buf.push(sg.sp as f32);
        }

        // Commands
        for cmd in &self.commands {
            encode_command(&mut buf, cmd);
        }

        // Element ID string table
        for s in &string_table {
            let codepoints: Vec<u32> = s.chars().map(|c| c as u32).collect();
            buf.push(codepoints.len() as f32);
            for cp in codepoints {
                buf.push(cp as f32);
            }
        }

        // Per-command element ID indices
        for &idx in &command_string_indices {
            buf.push(idx);
        }

        // Optional measure-bounds trailer: [count, bounds...]. Kept after the
        // command payload so existing binary command offsets remain stable.
        if !self.measure_bounds.is_empty() {
            buf.push(self.measure_bounds.len() as f32);
            for mb in &self.measure_bounds {
                if let Some(measure_id) = &mb.measure_id {
                    let codepoints: Vec<u32> = measure_id.chars().map(|c| c as u32).collect();
                    buf.push(codepoints.len() as f32);
                    for cp in &codepoints {
                        buf.push(*cp as f32);
                    }
                } else {
                    buf.push(-1.0);
                }
                buf.push(mb.index as f32);
                buf.push(mb.part_index as f32);
                buf.push(mb.staff_index as f32);
                buf.push(mb.system_index as f32);
                buf.push(mb.x as f32);
                buf.push(mb.width as f32);
                buf.push(mb.y as f32);
                buf.push(mb.height as f32);
                buf.push(mb.prefix_width as f32);
                buf.push(mb.total_beats as f32);
                buf.push(mb.beat_anchors.len() as f32);
                for (beat, x) in &mb.beat_anchors {
                    buf.push(*beat as f32);
                    buf.push(*x as f32);
                }
                buf.push(if mb.ghost_staff { 1.0 } else { 0.0 });
                buf.push(if mb.is_hidden { 1.0 } else { 0.0 });
                buf.push(if mb.has_music_hidden { 1.0 } else { 0.0 });
                buf.push(if mb.is_expansion { 1.0 } else { 0.0 });
            }
        }

        buf
    }
}

#[allow(clippy::too_many_lines)] // flat 1:1 command→wire dispatch: every arm is the same mechanical run of field pushes, and the layout documented in the table above is only checkable with the whole match visible in one place
fn encode_command(buf: &mut Vec<f32>, cmd: &RenderCommand) {
    match cmd {
        RenderCommand::DrawLine {
            x1,
            y1,
            x2,
            y2,
            width,
            color,
        } => {
            buf.push(TAG_DRAW_LINE);
            buf.push(*x1 as f32);
            buf.push(*y1 as f32);
            buf.push(*x2 as f32);
            buf.push(*y2 as f32);
            buf.push(*width as f32);
            buf.push(encode_color(color));
        }
        RenderCommand::DrawRect { x, y, w, h, color } => {
            buf.push(TAG_DRAW_RECT);
            buf.push(*x as f32);
            buf.push(*y as f32);
            buf.push(*w as f32);
            buf.push(*h as f32);
            buf.push(encode_color(color));
        }
        RenderCommand::DrawCircle { cx, cy, r, color } => {
            buf.push(TAG_DRAW_CIRCLE);
            buf.push(*cx as f32);
            buf.push(*cy as f32);
            buf.push(*r as f32);
            buf.push(encode_color(color));
        }
        RenderCommand::DrawEllipse {
            cx,
            cy,
            rx,
            ry,
            angle,
            filled,
            color,
        } => {
            buf.push(TAG_DRAW_ELLIPSE);
            buf.push(*cx as f32);
            buf.push(*cy as f32);
            buf.push(*rx as f32);
            buf.push(*ry as f32);
            buf.push(*angle as f32);
            buf.push(if *filled { 1.0 } else { 0.0 });
            buf.push(encode_color(color));
        }
        RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            font,
            size,
            color,
            rotation,
        } => {
            buf.push(TAG_DRAW_GLYPH);
            buf.push(*x as f32);
            buf.push(*y as f32);
            buf.push(*codepoint as f32);
            buf.push(encode_font(font));
            buf.push(*size as f32);
            buf.push(encode_color(color));
            buf.push(*rotation as f32);
        }
        // Same wire layout as `DrawGlyph`: the trailing float carries the
        // horizontal scale where a plain glyph carries its rotation.
        RenderCommand::DrawStretchedGlyph {
            x,
            y,
            codepoint,
            font,
            size,
            scale_x,
            color,
        } => {
            buf.push(TAG_DRAW_STRETCHED_GLYPH);
            buf.push(*x as f32);
            buf.push(*y as f32);
            buf.push(*codepoint as f32);
            buf.push(encode_font(font));
            buf.push(*size as f32);
            buf.push(encode_color(color));
            buf.push(*scale_x as f32);
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
            color,
        } => {
            buf.push(TAG_DRAW_BEZIER);
            buf.push(*x1 as f32);
            buf.push(*y1 as f32);
            buf.push(*cx1 as f32);
            buf.push(*cy1 as f32);
            buf.push(*cx2 as f32);
            buf.push(*cy2 as f32);
            buf.push(*x2 as f32);
            buf.push(*y2 as f32);
            buf.push(*width as f32);
            buf.push(encode_color(color));
        }
        RenderCommand::DrawQuadratic {
            x1,
            y1,
            cx,
            cy,
            x2,
            y2,
            width,
            color,
        } => {
            buf.push(TAG_DRAW_QUADRATIC);
            buf.push(*x1 as f32);
            buf.push(*y1 as f32);
            buf.push(*cx as f32);
            buf.push(*cy as f32);
            buf.push(*x2 as f32);
            buf.push(*y2 as f32);
            buf.push(*width as f32);
            buf.push(encode_color(color));
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
            color,
            line_style,
        } => {
            buf.push(TAG_DRAW_FILLED_BEZIER);
            buf.push(*x1 as f32);
            buf.push(*y1 as f32);
            buf.push(*x2 as f32);
            buf.push(*y2 as f32);
            buf.push(*ocx1 as f32);
            buf.push(*ocy1 as f32);
            buf.push(*ocx2 as f32);
            buf.push(*ocy2 as f32);
            buf.push(*icx1 as f32);
            buf.push(*icy1 as f32);
            buf.push(*icx2 as f32);
            buf.push(*icy2 as f32);
            buf.push(*ix1 as f32);
            buf.push(*iy1 as f32);
            buf.push(*ix2 as f32);
            buf.push(*iy2 as f32);
            buf.push(encode_color(color));
            buf.push(*line_style as f32);
        }
        RenderCommand::DrawPolygon { points, color } => {
            buf.push(TAG_DRAW_POLYGON);
            buf.push(points.len() as f32);
            for (px, py) in points {
                buf.push(*px as f32);
                buf.push(*py as f32);
            }
            buf.push(encode_color(color));
        }
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
            buf.push(TAG_DRAW_TEXT);
            buf.push(*x as f32);
            buf.push(*y as f32);
            buf.push(*size as f32);
            buf.push(encode_color(color));
            buf.push(encode_text_align(align));
            buf.push(encode_text_baseline(baseline));
            buf.push(encode_font(font));
            // Encode text as length + codepoints
            let codepoints: Vec<u32> = text.chars().map(|c| c as u32).collect();
            buf.push(codepoints.len() as f32);
            for cp in codepoints {
                buf.push(cp as f32);
            }
        }
        RenderCommand::SetOpacity { opacity } => {
            buf.push(TAG_SET_OPACITY);
            buf.push(*opacity as f32);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::PageLayout;

    #[test]
    fn test_encode_decode_color() {
        assert_eq!(decode_color(encode_color("#000000")), "#000000");
        assert_eq!(decode_color(encode_color("#FF0000")), "#FF0000");
        assert_eq!(decode_color(encode_color("#00FF00")), "#00FF00");
        assert_eq!(decode_color(encode_color("#0000FF")), "#0000FF");
        assert_eq!(decode_color(encode_color("#ABCDEF")), "#ABCDEF");
    }

    #[test]
    fn test_encode_font() {
        assert_eq!(encode_font("Bravura"), 0.0);
        assert_eq!(encode_font("serif"), 1.0);
        assert_eq!(encode_font("serif bold"), 2.0);
        assert_eq!(encode_font("serif italic"), 3.0);
        assert_eq!(encode_font("serif bold italic"), 4.0);
        assert_eq!(encode_font("sans-serif"), 5.0);
        assert_eq!(encode_font("sans-serif bold"), 6.0);
        assert_eq!(encode_font("sans-serif italic"), 7.0);
        assert_eq!(encode_font("sans-serif bold italic"), 8.0);
        assert_eq!(encode_font("monospace"), 9.0);
        assert_eq!(encode_font("monospace bold"), 10.0);
        assert_eq!(encode_font("monospace italic"), 11.0);
        assert_eq!(encode_font("monospace bold italic"), 12.0);
        assert_eq!(encode_font("unknown"), 1.0); // fallback to serif regular
    }

    #[test]
    fn test_decode_font() {
        assert_eq!(decode_font(0.0), "Bravura");
        assert_eq!(decode_font(1.0), "serif");
        assert_eq!(decode_font(2.0), "serif bold");
        assert_eq!(decode_font(3.0), "serif italic");
        assert_eq!(decode_font(4.0), "serif bold italic");
        assert_eq!(decode_font(5.0), "sans-serif");
        assert_eq!(decode_font(9.0), "monospace");
        assert_eq!(decode_font(12.0), "monospace bold italic");
        assert_eq!(decode_font(99.0), "serif");
    }

    #[test]
    fn test_empty_display_list() {
        let dl = DisplayList::new(800.0, 600.0);
        let buf = dl.to_binary();
        assert_eq!(buf.len(), 7); // header only (no commands = no element_id indices)
        assert_eq!(buf[0], 800.0);
        assert_eq!(buf[1], 600.0);
        assert_eq!(buf[2], 0.0); // num_commands
        assert_eq!(buf[3], 0.0); // num_pages
        assert_eq!(buf[4], 0.0); // num_strings
        assert_eq!(buf[5], 0.0); // num_element_bboxes
    }

    #[test]
    fn test_draw_line_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawLine {
            x1: 10.0,
            y1: 20.0,
            x2: 300.0,
            y2: 20.0,
            width: 1.5,
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        // header(7) + DrawLine(7) + element_id_indices(1)
        assert_eq!(buf.len(), 7 + 7 + 1);
        assert_eq!(buf[7], TAG_DRAW_LINE);
        assert_eq!(buf[8], 10.0);
        assert_eq!(buf[9], 20.0);
        assert_eq!(buf[10], 300.0);
        assert_eq!(buf[11], 20.0);
        assert_eq!(buf[12], 1.5);
        assert_eq!(decode_color(buf[13]), "#000000");
        // element_id index for this command = -1.0 (no ID)
        assert_eq!(buf[14], -1.0);
    }

    #[test]
    fn test_draw_glyph_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawGlyph {
            x: 50.0,
            y: 100.0,
            codepoint: 0xE050, // treble clef
            font: "Bravura".into(),
            size: 40.0,
            color: "#000000".into(),
            rotation: 0.0,
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_GLYPH);
        assert_eq!(buf[8], 50.0);
        assert_eq!(buf[9], 100.0);
        assert_eq!(buf[10], 0xE050 as f32);
        assert_eq!(buf[11], FONT_BRAVURA);
        assert_eq!(buf[12], 40.0);
    }

    #[test]
    fn test_draw_stretched_glyph_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawStretchedGlyph {
            x: 12.0,
            y: 200.0,
            codepoint: 0xE000, // brace
            font: "Bravura".into(),
            size: 150.0,
            scale_x: 0.5,
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_STRETCHED_GLYPH);
        assert_eq!(buf[8], 12.0);
        assert_eq!(buf[9], 200.0);
        assert_eq!(buf[10], 0xE000 as f32);
        assert_eq!(buf[11], FONT_BRAVURA);
        assert_eq!(buf[12], 150.0);
        // Trailing float is the horizontal scale, where a plain glyph's is its rotation.
        assert_eq!(buf[14], 0.5);
    }

    #[test]
    fn test_draw_text_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawText {
            x: 10.0,
            y: 20.0,
            text: "D.S.".into(),
            font: "serif italic".into(),
            size: 12.0,
            color: "#000000".into(),
            align: TextAlign::Right,
            baseline: TextBaseline::Alphabetic,
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_TEXT);
        assert_eq!(buf[8], 10.0); // x
        assert_eq!(buf[9], 20.0); // y
        assert_eq!(buf[10], 12.0); // size
                                   // buf[11] = color
        assert_eq!(buf[12], 2.0); // align = right
        assert_eq!(buf[13], 3.0); // baseline = alphabetic
        assert_eq!(buf[14], 3.0); // font_id = serif italic
        assert_eq!(buf[15], 4.0); // text_len = 4 chars
        assert_eq!(buf[16], 'D' as u32 as f32);
        assert_eq!(buf[17], '.' as u32 as f32);
        assert_eq!(buf[18], 'S' as u32 as f32);
        assert_eq!(buf[19], '.' as u32 as f32);
    }

    #[test]
    fn test_draw_polygon_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawPolygon {
            points: vec![(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0)],
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_POLYGON);
        assert_eq!(buf[8], 4.0); // n_points
                                 // 4 points × 2 coords = 8 floats, then color
        assert_eq!(buf[9], 0.0);
        assert_eq!(buf[10], 0.0);
        assert_eq!(buf[11], 10.0);
        assert_eq!(buf[12], 0.0);
        assert_eq!(buf[13], 10.0);
        assert_eq!(buf[14], 5.0);
        assert_eq!(buf[15], 0.0);
        assert_eq!(buf[16], 5.0);
        // buf[17] = color
    }

    #[test]
    fn test_draw_filled_bezier_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawFilledBezier {
            x1: 0.0,
            y1: 10.0,
            x2: 100.0,
            y2: 10.0,
            ocx1: 25.0,
            ocy1: -5.0,
            ocx2: 75.0,
            ocy2: -5.0,
            icx1: 25.0,
            icy1: 0.0,
            icx2: 75.0,
            icy2: 0.0,
            ix1: 0.0,
            iy1: 11.0,
            ix2: 100.0,
            iy2: 11.0,
            color: "#000000".into(),
            line_style: 0,
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_FILLED_BEZIER);
        assert_eq!(buf.len(), 7 + 19 + 1); // header + 19 floats + 1 element_id index
    }

    #[test]
    fn test_page_layout_encoding() {
        let mut dl = DisplayList::new(800.0, 1200.0);
        dl.pages.push(PageLayout {
            page_number: 0,
            system_indices: vec![0, 1, 2],
            y_offset: 0.0,
            height: 600.0,
        });
        dl.pages.push(PageLayout {
            page_number: 1,
            system_indices: vec![3, 4],
            y_offset: 600.0,
            height: 600.0,
        });
        let buf = dl.to_binary();
        // Header: 5
        assert_eq!(buf[3], 2.0); // 2 pages
        assert_eq!(buf[4], 0.0); // num_strings
        assert_eq!(buf[5], 0.0); // num_element_bboxes
                                 // Page 0: page_num(1) + num_systems(1) + 3 indices + y_offset(1) + height(1) = 7
        assert_eq!(buf[7], 0.0); // page_number
        assert_eq!(buf[8], 3.0); // num_systems
        assert_eq!(buf[9], 0.0); // system_index 0
        assert_eq!(buf[10], 1.0); // system_index 1
        assert_eq!(buf[11], 2.0); // system_index 2
        assert_eq!(buf[12], 0.0); // y_offset
        assert_eq!(buf[13], 600.0); // height
                                    // Page 1: 6 floats
        assert_eq!(buf[14], 1.0); // page_number
        assert_eq!(buf[15], 2.0); // num_systems
        assert_eq!(buf[16], 3.0);
        assert_eq!(buf[17], 4.0);
        assert_eq!(buf[18], 600.0); // y_offset
        assert_eq!(buf[19], 600.0); // height
    }

    #[test]
    fn test_multiple_commands() {
        let mut dl = DisplayList::new(400.0, 300.0);
        dl.push(RenderCommand::DrawLine {
            x1: 0.0,
            y1: 0.0,
            x2: 100.0,
            y2: 0.0,
            width: 1.0,
            color: "#000000".into(),
        });
        dl.push(RenderCommand::DrawGlyph {
            x: 10.0,
            y: 20.0,
            codepoint: 0xE0A4,
            font: "Bravura".into(),
            size: 32.0,
            color: "#000000".into(),
            rotation: 0.0,
        });
        dl.push(RenderCommand::DrawRect {
            x: 50.0,
            y: 50.0,
            w: 10.0,
            h: 100.0,
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[2], 3.0); // num_commands
                                 // DrawLine starts at offset 6
        assert_eq!(buf[7], TAG_DRAW_LINE);
        // DrawGlyph starts at offset 6+7=13
        assert_eq!(buf[14], TAG_DRAW_GLYPH);
        // DrawRect starts at offset 13+8=21 (DrawGlyph is 8 floats with rotation)
        assert_eq!(buf[22], TAG_DRAW_RECT);
        // header(7) + commands(7+8+6) + element_id_indices(3) = 30
        assert_eq!(buf.len(), 7 + 7 + 8 + 6 + 3);
    }

    #[test]
    fn test_draw_rect_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawRect {
            x: 5.0,
            y: 10.0,
            w: 20.0,
            h: 3.0,
            color: "#FF0000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_RECT);
        assert_eq!(buf[8], 5.0);
        assert_eq!(buf[9], 10.0);
        assert_eq!(buf[10], 20.0);
        assert_eq!(buf[11], 3.0);
        assert_eq!(decode_color(buf[12]), "#FF0000");
    }

    #[test]
    fn test_draw_circle_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawCircle {
            cx: 15.0,
            cy: 25.0,
            r: 2.0,
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_CIRCLE);
        assert_eq!(buf[8], 15.0);
        assert_eq!(buf[9], 25.0);
        assert_eq!(buf[10], 2.0);
    }

    #[test]
    fn test_draw_ellipse_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawEllipse {
            cx: 30.0,
            cy: 40.0,
            rx: 5.0,
            ry: 3.5,
            angle: -0.15,
            filled: true,
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_ELLIPSE);
        assert_eq!(buf[8], 30.0);
        assert_eq!(buf[9], 40.0);
        assert_eq!(buf[10], 5.0);
        assert_eq!(buf[11], 3.5);
        assert!((buf[12] - (-0.15)).abs() < 0.001); // angle
        assert_eq!(buf[13], 1.0); // filled = true
    }

    #[test]
    fn test_draw_bezier_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawBezier {
            x1: 0.0,
            y1: 10.0,
            cx1: 25.0,
            cy1: -5.0,
            cx2: 75.0,
            cy2: -5.0,
            x2: 100.0,
            y2: 10.0,
            width: 2.0,
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_BEZIER);
        assert_eq!(buf.len(), 7 + 11 + 1);
    }

    #[test]
    fn test_draw_quadratic_encoding() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawQuadratic {
            x1: 0.0,
            y1: 10.0,
            cx: 50.0,
            cy: -10.0,
            x2: 100.0,
            y2: 10.0,
            width: 1.5,
            color: "#000000".into(),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[7], TAG_DRAW_QUADRATIC);
        assert_eq!(buf.len(), 7 + 9 + 1);
    }

    #[test]
    fn test_element_ids_encoding() {
        let mut dl = DisplayList::new(200.0, 100.0);
        // Untagged command
        dl.push(RenderCommand::DrawLine {
            x1: 0.0,
            y1: 0.0,
            x2: 100.0,
            y2: 0.0,
            width: 1.0,
            color: "#000000".into(),
        });
        // Tagged command
        dl.push_tagged(
            RenderCommand::DrawGlyph {
                x: 10.0,
                y: 20.0,
                codepoint: 0xE0A4,
                font: "Bravura".into(),
                size: 32.0,
                color: "#000000".into(),
                rotation: 0.0,
            },
            "p0/m0/s0/ev1".into(),
        );
        // Another tagged command with same ID (deduplication)
        dl.push_tagged(
            RenderCommand::DrawCircle {
                cx: 15.0,
                cy: 25.0,
                r: 2.0,
                color: "#000000".into(),
            },
            "p0/m0/s0/ev1".into(),
        );
        // Tagged command with different ID
        dl.push_tagged(
            RenderCommand::DrawGlyph {
                x: 30.0,
                y: 20.0,
                codepoint: 0xE0A4,
                font: "Bravura".into(),
                size: 32.0,
                color: "#000000".into(),
                rotation: 0.0,
            },
            "p0/m0/s0/ev2".into(),
        );

        let buf = dl.to_binary();
        // Header
        assert_eq!(buf[0], 200.0); // width
        assert_eq!(buf[1], 100.0); // height
        assert_eq!(buf[2], 4.0); // num_commands
        assert_eq!(buf[3], 0.0); // num_pages
        assert_eq!(buf[4], 2.0); // num_strings (2 unique element IDs)
        assert_eq!(buf[5], 0.0); // num_element_bboxes
        assert_eq!(buf[6], 0.0); // num_slur_geometries

        // Find where commands end and string table begins
        // Commands: DrawLine(7) + DrawGlyph(8) + DrawCircle(5) + DrawGlyph(8) = 28
        let cmd_end = 7 + 28; // 35

        // String table: 2 strings
        // "p0/m0/s0/ev1" = 12 chars → [12.0, ...12 codepoints]
        assert_eq!(buf[cmd_end], 12.0); // first string length
                                        // "p0/m0/s0/ev2" = 12 chars → [12.0, ...12 codepoints]
        let str1_end = cmd_end + 1 + 12; // 45
        assert_eq!(buf[str1_end], 12.0); // second string length
        let str2_end = str1_end + 1 + 12; // 58

        // Per-command indices: 4 commands
        assert_eq!(buf[str2_end], -1.0); // cmd 0: no element_id
        assert_eq!(buf[str2_end + 1], 0.0); // cmd 1: string[0] = "p0/m0/s0/ev1"
        assert_eq!(buf[str2_end + 2], 0.0); // cmd 2: string[0] = "p0/m0/s0/ev1" (deduplicated)
        assert_eq!(buf[str2_end + 3], 1.0); // cmd 3: string[1] = "p0/m0/s0/ev2"
    }

    #[test]
    fn test_push_tagged_backfills_element_ids() {
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.push(RenderCommand::DrawLine {
            x1: 0.0,
            y1: 0.0,
            x2: 1.0,
            y2: 1.0,
            width: 1.0,
            color: "#000000".into(),
        });
        dl.push(RenderCommand::DrawLine {
            x1: 0.0,
            y1: 0.0,
            x2: 1.0,
            y2: 1.0,
            width: 1.0,
            color: "#000000".into(),
        });
        // element_ids should be empty here (lazy init)
        assert!(dl.element_ids.is_empty());

        // First tagged push should backfill
        dl.push_tagged(
            RenderCommand::DrawCircle {
                cx: 0.0,
                cy: 0.0,
                r: 1.0,
                color: "#000000".into(),
            },
            "test/id".into(),
        );
        assert_eq!(dl.element_ids.len(), 3);
        assert_eq!(dl.element_ids[0], None);
        assert_eq!(dl.element_ids[1], None);
        assert_eq!(dl.element_ids[2], Some("test/id".to_string()));

        // Subsequent push should also maintain element_ids
        dl.push(RenderCommand::DrawCircle {
            cx: 0.0,
            cy: 0.0,
            r: 1.0,
            color: "#000000".into(),
        });
        assert_eq!(dl.element_ids.len(), 4);
        assert_eq!(dl.element_ids[3], None);
    }

    #[test]
    fn test_element_bbox_encoding() {
        use crate::render::{BoundingBox, ElementBBox};
        let mut dl = DisplayList::new(100.0, 50.0);
        dl.element_bboxes.push(ElementBBox {
            element_id: "p0/m0/clef".into(),
            bbox: BoundingBox::new(10.0, 20.0, 30.0, 40.0),
        });
        let buf = dl.to_binary();
        assert_eq!(buf[4], 0.0); // num_strings
        assert_eq!(buf[5], 1.0); // num_element_bboxes
        assert_eq!(buf[6], 0.0); // num_slur_geometries
                                 // element bbox data starts at offset 7
        let id = "p0/m0/clef";
        assert_eq!(buf[7], id.len() as f32); // id_len = 10
                                             // id codepoints at buf[8..18]
        for (i, ch) in id.chars().enumerate() {
            assert_eq!(buf[8 + i], ch as u32 as f32);
        }
        // bbox at buf[18..22]
        assert_eq!(buf[18], 10.0); // x
        assert_eq!(buf[19], 20.0); // y
        assert_eq!(buf[20], 30.0); // width
        assert_eq!(buf[21], 40.0); // height
    }
}
