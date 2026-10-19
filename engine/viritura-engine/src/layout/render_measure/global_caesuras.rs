use super::super::{config::LayoutConfig, types::MeasureLayout};
use crate::render::{smufl::smufl, DisplayList, ElementKind, HitPolicy, RenderCommand};

/// A global caesura belongs to the ending barline, not a voice or system-object lane.
pub(super) fn render_global_caesura(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let Some(caesura) = &ml.resolved.global.caesura else {
        return;
    };
    let codepoint = smufl::caesura_glyph(&caesura.marking.style, caesura.marking.marks);
    let (left, top, width, height) = smufl::glyph_bbox(codepoint);
    let metrics = config.placement.resolve(ElementKind::Caesura);
    // Standard engraving practice: centre the ink over the ending barline and
    // keep it above the staff. The common dependent-flow pass clears other ink.
    let x = ml.x + ml.width - (left + width * 0.5) * sp;
    let y = staff_y - (metrics.attach_gap.max(0.5) + top + height) * sp;
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
