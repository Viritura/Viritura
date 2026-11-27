use crate::render::smufl::smufl;

pub(super) fn center_offset(base: &crate::model::NoteValueBase, sp: f64) -> f64 {
    let codepoint = smufl::notehead_glyph(base);
    let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(codepoint);
    let origin_x = -smufl::notehead_origin(codepoint);
    (origin_x + bbox_x + bbox_w * 0.5) * sp
}
