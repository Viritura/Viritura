use super::PromoteError;
use crate::model::{
    StaffTextFramePresentation, StaffTextFrameWidth, TextFrameAlign, TextFrameBorder,
    TextFrameJustify,
};
use crate::raw_viritura as raw;

pub(super) fn promote_presentation(
    frame: raw::StaffTextFramePresentation,
) -> StaffTextFramePresentation {
    StaffTextFramePresentation {
        width: frame
            .width
            .map(|width| StaffTextFrameWidth::StaffSpaces(width.value)),
        padding: frame.padding,
        horizontal_alignment: frame.horizontal_alignment.map(|align| match align {
            raw::StaffTextFramePresentationHorizontalAlignment::Left => TextFrameAlign::Left,
            raw::StaffTextFramePresentationHorizontalAlignment::Center => TextFrameAlign::Center,
            raw::StaffTextFramePresentationHorizontalAlignment::Right => TextFrameAlign::Right,
        }),
        paragraph_justification: match frame.paragraph_justification {
            None | Some(raw::StaffTextFramePresentationParagraphJustification::Left) => {
                TextFrameJustify::Left
            }
            Some(raw::StaffTextFramePresentationParagraphJustification::Center) => {
                TextFrameJustify::Center
            }
            Some(raw::StaffTextFramePresentationParagraphJustification::Right) => {
                TextFrameJustify::Right
            }
            Some(raw::StaffTextFramePresentationParagraphJustification::Justify) => {
                TextFrameJustify::Justify
            }
        },
        border: match frame.border {
            None | Some(raw::StaffTextFramePresentationBorder::None) => TextFrameBorder::None,
            Some(raw::StaffTextFramePresentationBorder::Solid) => TextFrameBorder::Solid,
        },
    }
}

pub(super) fn validate_presentations(measure: &serde_json::Value) -> Result<(), PromoteError> {
    let expressions = measure
        .pointer("/_x/viritura/expressions")
        .or_else(|| measure.get("expressions"));
    for (index, expression) in expressions
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let Some(value) = expression.get("frame") else {
            continue;
        };
        let error = |reason: String| {
            PromoteError::InvalidTextFrame(format!("expressions[{index}].frame: {reason}"))
        };
        crate::validator::validate_staff_text_frame(value).map_err(error)?;
        let frame: StaffTextFramePresentation =
            serde_json::from_value(value.clone()).map_err(|e| error(e.to_string()))?;
        if frame
            .width
            .is_some_and(|StaffTextFrameWidth::StaffSpaces(width)| {
                !width.is_finite() || width <= 0.0
            })
            || frame
                .padding
                .is_some_and(|padding| !padding.is_finite() || padding < 0.0)
        {
            return Err(error("dimensions are out of range".into()));
        }
        let _: raw::TextExpression =
            serde_json::from_value(expression.clone()).map_err(|e| error(e.to_string()))?;
    }
    Ok(())
}
