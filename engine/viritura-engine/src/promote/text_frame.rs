//! Promote `scores[i]._x.viritura.textFrames` into [`TextFrame`]s.
//!
//! Each entry is decoded through the generated schema types, so a malformed
//! frame (missing or empty ID, unknown locator kind, unknown field, bad
//! anchor) is a promote error rather than a silently dropped frame. Numeric
//! constraints the generated types do not carry (width bounds, non-negative
//! padding and page index, finite offsets) and frame-ID uniqueness within the
//! score view are checked here. Import metadata (`sourceReference`) is
//! validated by the schema types and otherwise not used by layout.
//!
//! Well-formed references to measures, events, or pages absent from the
//! current layout are not errors: the frame stays authored and is simply not
//! drawn (see `layout::text_frames`).

use std::collections::HashSet;

use crate::model::{
    TextContent, TextFrame, TextFrameAlign, TextFrameAnchor, TextFrameBorder, TextFrameJustify,
    TextFrameLocator, TextFrameOffset, TextFramePlacement, TextFrameWidth,
};
use crate::promote::PromoteError;
use crate::raw_viritura as raw;

pub(crate) fn promote_text_frames(
    value: Option<&serde_json::Value>,
) -> Result<Vec<TextFrame>, PromoteError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let entries = value
        .as_array()
        .ok_or_else(|| PromoteError::InvalidTextFrame("must be an array".into()))?;
    let mut seen = HashSet::new();
    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let frame = promote_text_frame(entry)
                .map_err(|reason| PromoteError::InvalidTextFrame(format!("[{index}]: {reason}")))?;
            if !seen.insert(frame.id.clone()) {
                return Err(PromoteError::InvalidTextFrame(format!(
                    "[{index}]: duplicate id \"{}\"",
                    frame.id
                )));
            }
            Ok(frame)
        })
        .collect()
}

fn promote_text_frame(entry: &serde_json::Value) -> Result<TextFrame, String> {
    let raw: raw::TextFrame =
        serde_json::from_value(entry.clone()).map_err(|error| error.to_string())?;
    let width = match raw.width {
        raw::TextFrameWidth::StaffSpaces(value) if value.is_finite() && value > 0.0 => {
            TextFrameWidth::StaffSpaces(value)
        }
        raw::TextFrameWidth::TextColumnFraction(value) if value > 0.0 && value <= 1.0 => {
            TextFrameWidth::TextColumnFraction(value)
        }
        _ => return Err("width is out of range".into()),
    };
    if raw
        .padding
        .is_some_and(|padding| !padding.is_finite() || padding < 0.0)
    {
        return Err("padding must be a non-negative number".into());
    }
    let offset = raw.placement.offset;
    if !offset.x.is_finite() || !offset.y.is_finite() {
        return Err("placement offset must be finite".into());
    }
    Ok(TextFrame {
        id: raw.id.to_string(),
        content: TextContent::from_raw(raw.content),
        locator: promote_locator(raw.locator)?,
        placement: TextFramePlacement {
            anchor: promote_anchor(raw.placement.anchor),
            offset: TextFrameOffset {
                x: offset.x,
                y: offset.y,
            },
        },
        width,
        padding: raw.padding,
        horizontal_alignment: raw.horizontal_alignment.map(|align| match align {
            raw::TextFrameHorizontalAlignment::Left => TextFrameAlign::Left,
            raw::TextFrameHorizontalAlignment::Center => TextFrameAlign::Center,
            raw::TextFrameHorizontalAlignment::Right => TextFrameAlign::Right,
        }),
        paragraph_justification: match raw.paragraph_justification {
            None | Some(raw::TextFrameParagraphJustification::Left) => TextFrameJustify::Left,
            Some(raw::TextFrameParagraphJustification::Center) => TextFrameJustify::Center,
            Some(raw::TextFrameParagraphJustification::Right) => TextFrameJustify::Right,
            Some(raw::TextFrameParagraphJustification::Justify) => TextFrameJustify::Justify,
        },
        border: match raw.border {
            None | Some(raw::TextFrameBorder::None) => TextFrameBorder::None,
            Some(raw::TextFrameBorder::Solid) => TextFrameBorder::Solid,
        },
    })
}

fn promote_locator(locator: raw::TextFrameLocator) -> Result<TextFrameLocator, String> {
    Ok(match locator {
        raw::TextFrameLocator::Page { page_index } => TextFrameLocator::Page {
            page_index: usize::try_from(page_index)
                .map_err(|_| "pageIndex must be non-negative".to_owned())?,
        },
        raw::TextFrameLocator::GlobalMeasure { measure_id } => TextFrameLocator::GlobalMeasure {
            measure_id: measure_id.to_string(),
        },
        raw::TextFrameLocator::Event { part_id, event_id } => TextFrameLocator::Event {
            part_id: part_id.to_string(),
            event_id: event_id.to_string(),
        },
    })
}

fn promote_anchor(anchor: raw::TextFramePlacementAnchor) -> TextFrameAnchor {
    use raw::TextFramePlacementAnchor as Raw;
    match anchor {
        Raw::Top => TextFrameAnchor::Top,
        Raw::Right => TextFrameAnchor::Right,
        Raw::Bottom => TextFrameAnchor::Bottom,
        Raw::Left => TextFrameAnchor::Left,
        Raw::TopLeft => TextFrameAnchor::TopLeft,
        Raw::TopRight => TextFrameAnchor::TopRight,
        Raw::BottomRight => TextFrameAnchor::BottomRight,
        Raw::BottomLeft => TextFrameAnchor::BottomLeft,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame(id: &str, locator: serde_json::Value, width: serde_json::Value) -> serde_json::Value {
        json!({
            "id": id,
            "content": [{"text": "x"}],
            "locator": locator,
            "placement": {"anchor": "top-left", "offset": {"x": 0, "y": 0}},
            "width": width
        })
    }

    #[test]
    fn promotes_page_and_musical_locators() {
        let mut detailed = frame(
            "b",
            json!({"type": "globalMeasure", "measureId": "m3"}),
            json!({"unit": "textColumnFraction", "value": 0.5}),
        );
        let extra = json!({
            "placement": {"anchor": "bottom-right", "offset": {"x": -1, "y": 2}},
            "padding": 0.5,
            "horizontalAlignment": "center",
            "paragraphJustification": "justify",
            "border": "solid",
            "sourceReference": {"unit": "evpu", "referenceStaffSize": 96}
        });
        for (key, value) in extra.as_object().unwrap() {
            detailed[key] = value.clone();
        }
        let frames = promote_text_frames(Some(&json!([
            frame(
                "a",
                json!({"type": "page", "pageIndex": 1}),
                json!({"unit": "staffSpaces", "value": 20})
            ),
            detailed,
            frame(
                "c",
                json!({"type": "event", "partId": "P1", "eventId": "e7"}),
                json!({"unit": "staffSpaces", "value": 10})
            ),
        ])))
        .unwrap();
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].locator, TextFrameLocator::Page { page_index: 1 });
        assert_eq!(frames[0].width, TextFrameWidth::StaffSpaces(20.0));
        assert_eq!(frames[0].horizontal_alignment, None);
        assert_eq!(frames[0].paragraph_justification, TextFrameJustify::Left);
        assert_eq!(frames[0].border, TextFrameBorder::None);
        assert_eq!(
            frames[1].locator,
            TextFrameLocator::GlobalMeasure {
                measure_id: "m3".into()
            }
        );
        assert_eq!(frames[1].placement.anchor, TextFrameAnchor::BottomRight);
        assert_eq!(frames[1].placement.offset.x, -1.0);
        assert_eq!(frames[1].placement.offset.y, 2.0);
        assert_eq!(frames[1].width, TextFrameWidth::TextColumnFraction(0.5));
        assert_eq!(frames[1].horizontal_alignment, Some(TextFrameAlign::Center));
        assert_eq!(frames[1].paragraph_justification, TextFrameJustify::Justify);
        assert_eq!(frames[1].border, TextFrameBorder::Solid);
        assert_eq!(
            frames[2].locator,
            TextFrameLocator::Event {
                part_id: "P1".into(),
                event_id: "e7".into()
            }
        );
    }

    #[test]
    fn malformed_entries_are_promote_errors() {
        let page = json!({"type": "page", "pageIndex": 0});
        let ss = json!({"unit": "staffSpaces", "value": 5});
        let with = |key: &str, value: serde_json::Value| {
            let mut entry = frame("f", page.clone(), ss.clone());
            entry[key] = value;
            entry
        };
        let mut missing_id = frame("f", page.clone(), ss.clone());
        missing_id.as_object_mut().unwrap().remove("id");
        let mut missing_placement = frame("f", page.clone(), ss.clone());
        missing_placement
            .as_object_mut()
            .unwrap()
            .remove("placement");
        let cases = [
            ("missing id", missing_id),
            ("empty id", frame("", page.clone(), ss.clone())),
            (
                "unknown locator",
                with("locator", json!({"type": "staff", "staff": 1})),
            ),
            (
                "event without part",
                with("locator", json!({"type": "event", "eventId": "e1"})),
            ),
            (
                "negative page",
                with("locator", json!({"type": "page", "pageIndex": -1})),
            ),
            (
                "zero width",
                with("width", json!({"unit": "staffSpaces", "value": 0})),
            ),
            (
                "fraction above one",
                with("width", json!({"unit": "textColumnFraction", "value": 1.5})),
            ),
            (
                "unknown unit",
                with("width", json!({"unit": "evpu", "value": 5})),
            ),
            ("negative padding", with("padding", json!(-1))),
            ("missing placement", missing_placement),
            (
                "unknown anchor",
                with(
                    "placement",
                    json!({"anchor": "center", "offset": {"x": 0, "y": 0}}),
                ),
            ),
            ("unknown field", with("rotation", json!(90))),
        ];
        for (label, entry) in cases {
            let result = promote_text_frames(Some(&json!([entry])));
            assert!(
                matches!(result, Err(PromoteError::InvalidTextFrame(_))),
                "{label}: {result:?}"
            );
        }
        assert!(promote_text_frames(Some(&json!({}))).is_err(), "non-array");
    }

    #[test]
    fn duplicate_ids_are_promote_errors() {
        let page = json!({"type": "page", "pageIndex": 0});
        let ss = json!({"unit": "staffSpaces", "value": 5});
        let result = promote_text_frames(Some(&json!([
            frame("f", page.clone(), ss.clone()),
            frame("f", json!({"type": "page", "pageIndex": 3}), ss),
        ])));
        let Err(PromoteError::InvalidTextFrame(reason)) = result else {
            panic!("duplicate id must fail: {result:?}");
        };
        assert!(
            reason.contains("[1]") && reason.contains("duplicate"),
            "{reason}"
        );
    }

    #[test]
    fn unresolvable_but_well_formed_references_are_kept() {
        let frames = promote_text_frames(Some(&json!([
            frame(
                "far",
                json!({"type": "page", "pageIndex": 999}),
                json!({"unit": "staffSpaces", "value": 5})
            ),
            frame(
                "gone",
                json!({"type": "globalMeasure", "measureId": "missing"}),
                json!({"unit": "staffSpaces", "value": 5})
            ),
        ])))
        .unwrap();
        assert_eq!(frames.len(), 2);
    }
}
