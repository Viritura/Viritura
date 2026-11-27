use crate::model::{
    ExpressionPlacement, GlyphRun, HarpPedalSetting, PositionedTextType, TextContent,
    TextContentChunk, TextExpression, TextRunStyle,
};

pub(super) fn diagram_expression(setting: &HarpPedalSetting) -> (TextExpression, String) {
    let tuning = &setting.tuning;
    // Standard engraving practice: left-foot D C B, divider, right-foot E F G A.
    let mut glyphs = [&tuning.d, &tuning.c, &tuning.b]
        .into_iter()
        .map(pedal_name)
        .collect::<Vec<_>>();
    glyphs.push("harpPedalDivider".into());
    glyphs.extend(
        [&tuning.e, &tuning.f, &tuning.g, &tuning.a]
            .into_iter()
            .map(pedal_name),
    );
    let id = format!("harpPedal/{}", setting.id);
    (
        TextExpression {
            text: TextContent(vec![TextContentChunk::Glyph(GlyphRun {
                glyphs,
                style: Some(TextRunStyle {
                    size: Some(2.0),
                    ..Default::default()
                }),
                smufl_style: None,
            })]),
            id: Some(id.clone()),
            text_type: PositionedTextType::Expression,
            frame: Some(Default::default()),
            position: crate::model::RhythmicPosition {
                fraction: setting.position.fraction,
            },
            placement: Some(ExpressionPlacement::Below),
            staff: setting.staff,
            voice: None,
            source_part_index: None,
            source_expression_index: None,
            instrument_reminder: false,
            manual_offset: None,
            avoid_collisions: None,
        },
        id,
    )
}

fn pedal_name(alter: &crate::model::HarpPedalAlter) -> String {
    match alter {
        crate::model::HarpPedalAlter::Flat => "harpPedalRaised",
        crate::model::HarpPedalAlter::Natural => "harpPedalCentered",
        crate::model::HarpPedalAlter::Sharp => "harpPedalLowered",
    }
    .into()
}
