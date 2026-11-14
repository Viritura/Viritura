//! Bundled text faces used for vector export.

use std::sync::LazyLock;
use ttf_parser::Face;

use super::{BoundingBox, TextAlign};

const REGULAR: &[u8] = include_bytes!("../../../../assets/fonts/LibertinusSerif-Regular.otf");
const BOLD: &[u8] = include_bytes!("../../../../assets/fonts/LibertinusSerif-Bold.otf");
const ITALIC: &[u8] = include_bytes!("../../../../assets/fonts/LibertinusSerif-Italic.otf");
const BOLD_ITALIC: &[u8] =
    include_bytes!("../../../../assets/fonts/LibertinusSerif-BoldItalic.otf");

static FACES: LazyLock<[Face<'static>; 4]> = LazyLock::new(|| {
    [REGULAR, BOLD, ITALIC, BOLD_ITALIC]
        .map(|data| Face::parse(data, 0).expect("bundled Libertinus face must be valid"))
});

/// Resolve the family independently of the position of style tokens.
pub(super) fn family(font: &str) -> &str {
    font.split_whitespace()
        .find(|part| !matches!(*part, "bold" | "italic"))
        .unwrap_or("serif")
}

/// Resolve serif command fonts; other families have no bundled face.
pub(crate) fn face(font: &str) -> Option<&'static Face<'static>> {
    if family(font) != "serif" {
        return None;
    }
    let (mut bold, mut italic) = (false, false);
    for part in font.split_whitespace() {
        match part {
            "serif" => {}
            "bold" => bold = true,
            "italic" => italic = true,
            _ => return None,
        }
    }
    Some(&FACES[usize::from(bold) + 2 * usize::from(italic)])
}

pub(super) fn is_bundled_regular(data: &[u8]) -> bool {
    data == REGULAR
}

pub(crate) fn ink_bounds(
    text: &str,
    font: &str,
    size: f64,
    align: &TextAlign,
) -> Option<BoundingBox> {
    let face = face(font)?;
    let regular = &FACES[0];
    let mut advance = 0.0;
    let mut bounds: Option<BoundingBox> = None;
    for ch in text.chars() {
        let (glyph_face, glyph) = face
            .glyph_index(ch)
            .map(|glyph| (face, glyph))
            .or_else(|| regular.glyph_index(ch).map(|glyph| (regular, glyph)))?;
        let scale = size / f64::from(glyph_face.units_per_em());
        if let Some(rect) = glyph_face.glyph_bounding_box(glyph) {
            let ink = BoundingBox {
                x: advance + f64::from(rect.x_min) * scale,
                y: -f64::from(rect.y_max) * scale,
                width: f64::from(rect.x_max - rect.x_min) * scale,
                height: f64::from(rect.y_max - rect.y_min) * scale,
            };
            bounds = Some(bounds.map_or(ink.clone(), |current| current.union(&ink)));
        }
        advance += f64::from(glyph_face.glyph_hor_advance(glyph)?) * scale;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ink_bounds_use_regular_glyph_fallback() {
        assert!(face("serif bold").unwrap().glyph_index('♭').is_none());
        let bold = ink_bounds("♭", "serif bold", 10.0, &TextAlign::Center).unwrap();
        let regular = ink_bounds("♭", "serif", 10.0, &TextAlign::Center).unwrap();
        assert_eq!(
            (bold.x, bold.y, bold.width, bold.height),
            (regular.x, regular.y, regular.width, regular.height)
        );
    }
}
