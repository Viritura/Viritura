use crate::model::{
    ExpressionPlacement, GlyphRun, HarpPedalAlter, HarpPedalDisplay, HarpPedalSetting,
    HarpPedalTuning, MultiStaffPlacement, PositionedTextType, TextContent, TextContentChunk,
    TextExpression, TextFontStyle, TextRun, TextRunStyle,
};
use crate::render::smufl::smufl;

const DIAGRAM_SIZE: f64 = 2.0;

/// The optional third result is the bar-to-baseline offset in text font sizes.
pub(super) fn diagram_expression(
    setting: &HarpPedalSetting,
) -> (TextExpression, String, Option<f64>) {
    let (text, between_baseline_offset) = match setting.display {
        None | Some(HarpPedalDisplay::Diagram) => {
            let (_, top, _, height) = smufl::glyph_bbox(smufl::HARP_PEDAL_DIVIDER);
            let offset = -(top + height * 0.5) * DIAGRAM_SIZE / 4.0;
            (diagram_content(&setting.tuning), Some(offset))
        }
        Some(HarpPedalDisplay::Names) => (names_content(&setting.tuning, None), None),
        Some(HarpPedalDisplay::Changes) => (
            names_content(&setting.tuning, setting.preceding_tuning.as_ref()),
            None,
        ),
    };
    let id = format!("harpPedal/{}", setting.id);
    (
        TextExpression {
            text,
            id: Some(id.clone()),
            text_type: PositionedTextType::Expression,
            frame: Some(crate::model::StaffTextFramePresentation {
                erase_background: (setting.display == Some(HarpPedalDisplay::Names))
                    .then_some(true),
                ..Default::default()
            }),
            position: crate::model::RhythmicPosition {
                fraction: setting.position.fraction,
            },
            placement: match setting.placement {
                Some(MultiStaffPlacement::Above) => Some(ExpressionPlacement::Above),
                Some(MultiStaffPlacement::Below) => Some(ExpressionPlacement::Below),
                Some(MultiStaffPlacement::Between | MultiStaffPlacement::Auto) | None => None,
            },
            staff: setting.staff,
            voice: None,
            source_part_index: None,
            source_expression_index: None,
            instrument_reminder: false,
            manual_offset: setting.manual_offset,
            avoid_collisions: setting.avoid_collisions,
        },
        id,
        between_baseline_offset,
    )
}

fn diagram_content(tuning: &HarpPedalTuning) -> TextContent {
    // Standard engraving practice: left-foot D C B, divider, right-foot E F G A.
    let mut glyphs: Vec<String> = Vec::with_capacity(8);
    for (index, (_, alter)) in tuning.in_foot_order().into_iter().enumerate() {
        if index == 3 {
            glyphs.push("harpPedalDivider".into());
        }
        glyphs.push(pedal_name(alter).into());
    }
    TextContent(vec![TextContentChunk::Glyph(GlyphRun {
        glyphs,
        style: Some(TextRunStyle {
            size: Some(DIAGRAM_SIZE),
            ..Default::default()
        }),
        smufl_style: None,
    })])
}

/// Upright letter names with accidentals in foot order. With a preceding
/// tuning, only the pedals that move are written (standard practice for pedal
/// changes); with nothing to compare or nothing moving, all seven are written
/// with a bar separating the feet.
fn names_content(tuning: &HarpPedalTuning, preceding: Option<&HarpPedalTuning>) -> TextContent {
    let pedals = tuning.in_foot_order();
    let changed: Vec<usize> = preceding
        .map(|previous| {
            let previous = previous.in_foot_order();
            (0..7).filter(|&i| pedals[i].1 != previous[i].1).collect()
        })
        .unwrap_or_default();
    let full = changed.is_empty();
    let indices: Vec<usize> = if full { (0..7).collect() } else { changed };
    let upright = || {
        Some(TextRunStyle {
            font_style: Some(TextFontStyle::Normal),
            ..Default::default()
        })
    };
    let mut chunks = Vec::new();
    for (position, &index) in indices.iter().enumerate() {
        let separator = match position {
            0 => "",
            _ if full && index == 3 => " | ",
            _ => " ",
        };
        let (letter, alter) = pedals[index];
        chunks.push(TextContentChunk::Text(TextRun {
            text: format!("{separator}{letter}"),
            style: upright(),
        }));
        chunks.push(TextContentChunk::Glyph(GlyphRun {
            glyphs: vec![accidental_name(alter).into()],
            style: None,
            smufl_style: None,
        }));
    }
    TextContent(chunks)
}

fn pedal_name(alter: HarpPedalAlter) -> &'static str {
    match alter {
        HarpPedalAlter::Flat => "harpPedalRaised",
        HarpPedalAlter::Natural => "harpPedalCentered",
        HarpPedalAlter::Sharp => "harpPedalLowered",
    }
}

fn accidental_name(alter: HarpPedalAlter) -> &'static str {
    match alter {
        HarpPedalAlter::Flat => "accidentalFlat",
        HarpPedalAlter::Natural => "accidentalNatural",
        HarpPedalAlter::Sharp => "accidentalSharp",
    }
}
