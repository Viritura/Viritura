use super::PathBuilder;
use ttf_parser::{Face, GlyphId};

fn glyph<'a>(
    face: &'a Face<'_>,
    fallback: Option<&'a Face<'_>>,
    c: char,
) -> Option<(&'a Face<'a>, GlyphId)> {
    if let Some(id) = face.glyph_index(c) {
        Some((face, id))
    } else {
        let fallback = fallback?;
        Some((fallback, fallback.glyph_index(c)?))
    }
}

pub(super) fn text_advance_mm(
    face: &Face<'_>,
    fallback: Option<&Face<'_>>,
    text: &str,
    size_mm: f64,
) -> Option<f64> {
    text.chars().try_fold(0.0, |width, c| {
        let (face, id) = glyph(face, fallback, c)?;
        Some(width + face.glyph_hor_advance(id)? as f64 * size_mm / face.units_per_em() as f64)
    })
}

pub(super) fn text_to_path(
    face: &Face<'_>,
    fallback: Option<&Face<'_>>,
    text: &str,
    x_mm: f64,
    y_mm: f64,
    size_mm: f64,
) -> Option<String> {
    let mut full = String::with_capacity(text.len() * 128);
    let mut cx = x_mm;
    for c in text.chars() {
        let (face, id) = glyph(face, fallback, c)?;
        let scale = size_mm / face.units_per_em() as f64;
        let mut builder = PathBuilder::new(cx, y_mm, scale);
        if face.outline_glyph(id, &mut builder).is_some() {
            full.push_str(&builder.d);
        }
        cx += face.glyph_hor_advance(id)? as f64 * scale;
    }
    Some(full)
}
