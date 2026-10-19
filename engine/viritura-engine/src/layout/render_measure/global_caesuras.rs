use super::super::{config::LayoutConfig, types::MeasureLayout};
use crate::render::{smufl::smufl, DisplayList, ElementKind, HitPolicy, RenderCommand};

/// A global caesura belongs to the ending barline, not a voice or system-object lane.
pub(super) fn render_global_caesura(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    _config: &LayoutConfig,
) {
    let Some(caesura) = &ml.resolved.global.caesura else {
        return;
    };
    let codepoint = smufl::caesura_glyph(&caesura.marking.style, caesura.marking.marks);
    let (left, top, width, height) = smufl::glyph_bbox(codepoint);
    // Standard engraving practice: centre the strokes on the top staff line,
    // just before the barline, matching event-local caesuras.
    let x = ml.x + ml.width - (left + width + 0.25) * sp;
    let y = staff_y - (top + height * 0.5) * sp;
    dl.push_selectable_command(
        RenderCommand::DrawGlyph {
            x,
            y,
            codepoint,
            font: "Bravura".into(),
            size: 4.0 * sp,
            color: "#000000".into(),
            rotation: 0.0,
        },
        format!("m{}/caesura", ml.resolved.index),
        ElementKind::Caesura,
        HitPolicy::Ink,
    );
}
