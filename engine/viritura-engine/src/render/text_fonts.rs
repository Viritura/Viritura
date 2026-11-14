use std::sync::LazyLock;

use super::{BoundingBox, TextAlign};

fn parse(data: &'static [u8]) -> ttf_parser::Face<'static> {
    ttf_parser::Face::parse(data, 0).expect("bundled text font must be valid")
}

static SERIF: LazyLock<ttf_parser::Face<'static>> = LazyLock::new(|| {
    parse(include_bytes!(
        "../../../../assets/fonts/LibertinusSerif-Regular.otf"
    ))
});
static SERIF_BOLD: LazyLock<ttf_parser::Face<'static>> = LazyLock::new(|| {
    parse(include_bytes!(
        "../../../../assets/fonts/LibertinusSerif-Bold.otf"
    ))
});
static SERIF_ITALIC: LazyLock<ttf_parser::Face<'static>> = LazyLock::new(|| {
    parse(include_bytes!(
        "../../../../assets/fonts/LibertinusSerif-Italic.otf"
    ))
});
static SERIF_BOLD_ITALIC: LazyLock<ttf_parser::Face<'static>> = LazyLock::new(|| {
    parse(include_bytes!(
        "../../../../assets/fonts/LibertinusSerif-BoldItalic.otf"
    ))
});

pub(crate) fn face(font: &str) -> Option<&'static ttf_parser::Face<'static>> {
    match font.split_whitespace().next()? {
        "serif" => Some(match (font.contains("bold"), font.contains("italic")) {
            (true, true) => &SERIF_BOLD_ITALIC,
            (true, false) => &SERIF_BOLD,
            (false, true) => &SERIF_ITALIC,
            (false, false) => &SERIF,
        }),
        _ => None,
    }
}

pub(crate) fn ink_bounds(
    text: &str,
    font: &str,
    size: f64,
    align: &TextAlign,
) -> Option<BoundingBox> {
    let face = face(font)?;
    let scale = size / f64::from(face.units_per_em());
    let mut advance = 0.0;
    let mut bounds: Option<BoundingBox> = None;
    for ch in text.chars() {
        let glyph = face.glyph_index(ch).unwrap_or(ttf_parser::GlyphId(0));
        if let Some(rect) = face.glyph_bounding_box(glyph) {
            let ink = BoundingBox {
                x: advance + f64::from(rect.x_min) * scale,
                y: -f64::from(rect.y_max) * scale,
                width: f64::from(rect.x_max - rect.x_min) * scale,
                height: f64::from(rect.y_max - rect.y_min) * scale,
            };
            bounds = Some(bounds.map_or(ink.clone(), |current| current.union(&ink)));
        }
        advance += f64::from(face.glyph_hor_advance(glyph).unwrap_or(0)) * scale;
    }
    let mut bounds = bounds.unwrap_or(BoundingBox {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
    });
    bounds.x -= match align {
        TextAlign::Left => 0.0,
        TextAlign::Center => advance * 0.5,
        TextAlign::Right => advance,
    };
    Some(bounds)
}
