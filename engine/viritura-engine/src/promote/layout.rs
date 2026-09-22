//! Promote MNX `system-layout` (the `layout` definition) — staves, staff
//! groups, page/system definitions, layout changes.
//!
//! Dispatch for `SystemLayoutContent` (staff vs staff-group) goes via the
//! raw JSON because typify's flatten-union for `SystemLayoutContentItem`
//! silently drops all variants (same bug as `SequenceContentItem`).
//!
//! `_expansion`, `_condensedNumbers`, `_condensedNumberRows` on
//! `LayoutStaff` are TOP-LEVEL `_`-prefixed fields (NOT under `_x.viritura`).

use crate::model::direction::MeasureRhythmicPosition as ModelMeasureRhythmicPosition;
use crate::model::layout::{
    LayoutChange as ModelLayoutChange, LayoutChangeLocation as ModelLayoutChangeLocation,
    LayoutChangePosition as ModelLayoutChangePosition, LayoutContent as ModelLayoutContent,
    LayoutDefinition as ModelLayoutDefinition, LayoutGroup as ModelLayoutGroup,
    LayoutSource as ModelLayoutSource, LayoutStaff as ModelLayoutStaff,
    PageDefinition as ModelPageDefinition, SystemDefinition as ModelSystemDefinition,
};
use crate::promote::direction::promote_measure_rhythmic_position;
use crate::promote::PromoteError;
use crate::raw;

// ─── Leaves ──────────────────────────────────────────────────────────

pub(crate) fn promote_staff_source(r: raw::StaffSource) -> ModelLayoutSource {
    ModelLayoutSource {
        part: String::from(r.part),
        staff: r.staff.map(|s| u32::try_from(s.0).unwrap_or(1)),
        stem: r.stem.map(|s| match s {
            raw::StemDirection::Up => "up".to_string(),
            raw::StemDirection::Down => "down".to_string(),
        }),
        voice: r.voice.map(|v| v.0),
        labelref: r.labelref.map(|l| l.to_string()),
    }
}

fn staff_symbol_to_string(s: raw::StaffSymbol) -> String {
    match s {
        raw::StaffSymbol::Bracket => "bracket".into(),
        raw::StaffSymbol::Brace => "brace".into(),
        raw::StaffSymbol::NoSymbol => "noSymbol".into(),
    }
}

fn barline_style_to_string(s: raw::StaffGroupBarlineStyle) -> String {
    match s {
        raw::StaffGroupBarlineStyle::Individual => "individual".into(),
        raw::StaffGroupBarlineStyle::Instrument => "instrument".into(),
        raw::StaffGroupBarlineStyle::Unified => "unified".into(),
        raw::StaffGroupBarlineStyle::Mensurstrich => "mensurstrich".into(),
    }
}

// ─── Staff (incorporates _expansion / _condensedNumbers extras) ──────

pub(crate) fn promote_staff(r: raw::Staff, original_json: &serde_json::Value) -> ModelLayoutStaff {
    let expansion = original_json
        .get("_expansion")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let condensed_numbers_override = original_json
        .get("_condensedNumbers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_u64().and_then(|n| u32::try_from(n).ok()))
                .collect::<Vec<_>>()
        });
    let condensed_number_rows_override = original_json
        .get("_condensedNumberRows")
        .and_then(|v| v.as_array())
        .map(|outer| {
            outer
                .iter()
                .filter_map(|row| row.as_array())
                .map(|row| {
                    row.iter()
                        .filter_map(|x| x.as_u64().and_then(|n| u32::try_from(n).ok()))
                        .collect::<Vec<u32>>()
                })
                .collect::<Vec<_>>()
        });
    ModelLayoutStaff {
        sources: r.sources.into_iter().map(promote_staff_source).collect(),
        label: r.label.map(|l| l.0),
        labelref: r.labelref.map(|l| l.to_string()),
        symbol: r.symbol.map(staff_symbol_to_string),
        expansion,
        condensed_numbers_override,
        condensed_number_rows_override,
    }
}

pub(crate) fn promote_staff_group(
    r: raw::StaffGroup,
    original_json: &serde_json::Value,
) -> ModelLayoutGroup {
    let content_json = original_json
        .get("content")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
    let content = promote_layout_content_array(content_json);
    ModelLayoutGroup {
        content,
        symbol: r.symbol.map(staff_symbol_to_string),
        label: r.label.map(|l| l.0),
        barline_style: r.barline_style.map(barline_style_to_string),
    }
}

/// Dispatch a single layout content item from raw JSON (typify flatten-union
/// is broken; see [`super::event::promote_sequence_content_item`]).
pub(crate) fn promote_layout_content_item(v: serde_json::Value) -> Option<ModelLayoutContent> {
    let type_str = v.get("type").and_then(|t| t.as_str()).map(str::to_owned);
    match type_str.as_deref() {
        Some("group") => {
            // Replace `content` with empty so raw::StaffGroup parses (its
            // SystemLayoutContent typify alias is broken).
            let mut obj = v.as_object().cloned()?;
            obj.insert("content".into(), serde_json::Value::Array(Vec::new()));
            let g: raw::StaffGroup = serde_json::from_value(serde_json::Value::Object(obj)).ok()?;
            Some(ModelLayoutContent::Group(promote_staff_group(g, &v)))
        }
        Some("staff") => {
            let s: raw::Staff = serde_json::from_value(v.clone()).ok()?;
            Some(ModelLayoutContent::Staff(promote_staff(s, &v)))
        }
        _ => None,
    }
}

pub(crate) fn promote_layout_content_array(
    content_json: serde_json::Value,
) -> Vec<ModelLayoutContent> {
    match content_json {
        serde_json::Value::Array(arr) => arr
            .into_iter()
            .filter_map(promote_layout_content_item)
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn promote_system_layout(
    r: raw::SystemLayout,
    original_json: &serde_json::Value,
) -> ModelLayoutDefinition {
    let id = r.id.map(String::from).unwrap_or_default();
    let content_json = original_json
        .get("content")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));
    ModelLayoutDefinition {
        id,
        content: promote_layout_content_array(content_json),
    }
}

// ─── LayoutChange / Page / System ────────────────────────────────────

pub(crate) fn promote_layout_change(r: raw::LayoutChange) -> ModelLayoutChange {
    let mrp: ModelMeasureRhythmicPosition = promote_measure_rhythmic_position(r.location);
    ModelLayoutChange {
        layout: String::from(r.layout),
        location: ModelLayoutChangeLocation {
            measure: mrp.measure,
            position: Some(ModelLayoutChangePosition {
                fraction: (
                    mrp.position.fraction.0 as i32,
                    mrp.position.fraction.1 as i32,
                ),
            }),
        },
    }
}

pub(crate) fn promote_system(r: raw::System) -> ModelSystemDefinition {
    ModelSystemDefinition {
        layout: r.layout.map(String::from),
        measure: String::from(r.measure),
        layout_changes: r
            .layout_changes
            .into_iter()
            .map(promote_layout_change)
            .collect(),
    }
}

pub(crate) fn promote_page(r: raw::Page) -> ModelPageDefinition {
    ModelPageDefinition {
        systems: r.systems.into_iter().map(promote_system).collect(),
    }
}

#[allow(dead_code)] // wired up in chunk 8
pub(crate) fn _layout_promote_error_marker(_: PromoteError) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_simple_staff() {
        let json = r#"{
            "type": "staff",
            "sources": [{"part": "p1"}],
            "label": "Violin I"
        }"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let item = promote_layout_content_item(v).unwrap();
        match item {
            ModelLayoutContent::Staff(s) => {
                assert_eq!(s.sources.len(), 1);
                assert_eq!(s.sources[0].part, "p1");
                assert_eq!(s.label.as_deref(), Some("Violin I"));
            }
            _ => panic!("expected Staff"),
        }
    }

    #[test]
    fn promotes_staff_with_expansion_flag() {
        let json = r#"{
            "type": "staff",
            "sources": [{"part": "p1"}],
            "_expansion": true,
            "_condensedNumbers": [2, 1]
        }"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let item = promote_layout_content_item(v).unwrap();
        match item {
            ModelLayoutContent::Staff(s) => {
                assert!(s.expansion);
                assert_eq!(
                    s.condensed_numbers_override.as_deref(),
                    Some(&[2u32, 1][..])
                );
            }
            _ => panic!("expected Staff"),
        }
    }

    #[test]
    fn promotes_group_with_nested_staff() {
        let json = r#"{
            "type": "group",
            "symbol": "bracket",
            "content": [
                {"type": "staff", "sources": [{"part": "p1"}]},
                {"type": "staff", "sources": [{"part": "p2"}]}
            ]
        }"#;
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let item = promote_layout_content_item(v).unwrap();
        match item {
            ModelLayoutContent::Group(g) => {
                assert_eq!(g.symbol.as_deref(), Some("bracket"));
                assert_eq!(g.content.len(), 2);
            }
            _ => panic!("expected Group"),
        }
    }
}
