//! Per-dependent placement metrics: the clearances a *dependent* element keeps
//! as it reads the keep-out field and settles into place.
//!
//! See `docs/plans/horizontal-collision-avoidance.md`. A dependent (dynamic,
//! expression, tempo, …) has a single anchor and is free to displace within a
//! bounded allowance; the distances here describe that allowance:
//!
//! - `attach_gap` — minimum clearance from the element's own anchor edge
//!   (typically the nearest staff line) before any obstacle stacking. This is
//!   the old `*_min_distance` / `*_above_staff` family of constants.
//! - `padding` — CSS-like clearance kept on each axis as the dependent settles
//!   into the field. `padding.vertical` is the gap kept above the previous
//!   dependent it stacks against (the old `*_padding` family);
//!   `padding.horizontal` is the clearance from neighbouring ink. Like CSS, a
//!   scalar sets both axes; an object overrides each independently.
//! - `stack_rank` — ordering within a stacked column; lower sits closer to the
//!   staff. Ties broken by emit order.
//!
//! All distances are in staff spaces (spatium). Clearance lives entirely on the
//! dependent — substrate/connectors contribute boundary geometry only.
//!
//! The table mirrors [`crate::layout::text_styles::TextStylesheet`]: a built-in
//! default loaded from a JSON file shared with the TypeScript editor
//! (`packages/core/src/placementDefaults.json`), overlaid per-document via the
//! `_x.viritura.placement` vendor extension (see [`PlacementTable::merge_json`]).

use crate::render::ElementKind;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// CSS-like padding for a dependent: the clearance it keeps on each axis as it
/// settles into the keep-out field.
///
/// - `vertical` — gap kept above the previous dependent it stacks against.
/// - `horizontal` — clearance kept from neighbouring ink.
///
/// Like CSS `padding`, a scalar sets both axes equally and an object overrides
/// each independently. In JSON, `"padding": 0.5` is exactly
/// `"padding": { "vertical": 0.5, "horizontal": 0.5 }`. All distances are in
/// staff spaces (spatium).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Padding {
    /// Vertical clearance: gap above the previous stacked dependent (spatium).
    pub vertical: f64,
    /// Horizontal clearance: gap from neighbouring ink (spatium).
    pub horizontal: f64,
}

impl Padding {
    /// Uniform padding on both axes — the CSS `padding: X` shorthand.
    pub const fn all(v: f64) -> Self {
        Self {
            vertical: v,
            horizontal: v,
        }
    }
}

impl<'de> Deserialize<'de> for Padding {
    /// Accept either a scalar (`0.5` → both axes) or an object
    /// (`{ "vertical": …, "horizontal": … }`). A missing axis in the object
    /// form falls back to the other axis, mirroring the CSS single-value rule.
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Scalar(f64),
            Axes {
                vertical: Option<f64>,
                horizontal: Option<f64>,
            },
        }
        match Raw::deserialize(deserializer)? {
            Raw::Scalar(v) => Ok(Padding::all(v)),
            Raw::Axes {
                vertical,
                horizontal,
            } => Ok(Padding {
                vertical: vertical.or(horizontal).unwrap_or(0.0),
                horizontal: horizontal.or(vertical).unwrap_or(0.0),
            }),
        }
    }
}

/// Clearances a single dependent kind keeps when settling into the field.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementMetrics {
    /// Minimum clearance from the staff datum (the nearest staff line) to the
    /// element's resting edge, in spatium. This is the **rest reserve** off the
    /// staff — deliberately larger than `padding` (engraving hangs text a
    /// comfortable distance off the staff, but keeps only a hair of clearance
    /// over stray ink). Single-sided kinds (tempo above, lyric below) read this
    /// scalar directly; two-sided kinds (expressions) override per side via
    /// [`Self::attach_gap_above`] / [`Self::attach_gap_below`].
    #[serde(default = "default_attach_gap")]
    pub attach_gap: f64,
    /// Per-side override of [`Self::attach_gap`] for an ABOVE-staff placement.
    /// `None` falls back to the scalar `attach_gap`. Used by kinds whose staff
    /// reserve differs by side — an expression sits ~1sp above the staff but
    /// ~3sp below it (clearing the dynamics line).
    #[serde(default)]
    pub attach_gap_above: Option<f64>,
    /// Per-side override of [`Self::attach_gap`] for a BELOW-staff placement.
    /// `None` falls back to the scalar `attach_gap`.
    #[serde(default)]
    pub attach_gap_below: Option<f64>,
    /// CSS-like clearance kept on each axis as the dependent settles into the
    /// field. This is the SINGLE inter-ink spacing value: `vertical` governs
    /// **both** the stacking gap above a sibling dependent **and** the lift
    /// clearance over a substrate obstacle (a protruding notehead/accidental) —
    /// "ink is ink", there is no separate lift property. `horizontal` is the
    /// side bearing.
    #[serde(default = "default_padding")]
    pub padding: Padding,
    /// Ordering within a stacked column; lower sits closer to the staff.
    #[serde(default)]
    pub stack_rank: i32,
}

impl PlacementMetrics {
    /// Staff-reserve gap for an above-staff placement (per-side override, or the
    /// scalar `attach_gap` fallback).
    pub fn attach_gap_above(&self) -> f64 {
        self.attach_gap_above.unwrap_or(self.attach_gap)
    }

    /// Staff-reserve gap for a below-staff placement (per-side override, or the
    /// scalar `attach_gap` fallback).
    pub fn attach_gap_below(&self) -> f64 {
        self.attach_gap_below.unwrap_or(self.attach_gap)
    }
}

/// Default `attach_gap` for a partially-specified JSON entry — matches
/// [`PlacementMetrics::default`].
fn default_attach_gap() -> f64 {
    2.0
}

/// Default `padding` for a partially-specified JSON entry — matches
/// [`PlacementMetrics::default`].
fn default_padding() -> Padding {
    Padding::all(0.5)
}

impl Default for PlacementMetrics {
    /// Neutral fallback for kinds not yet present in the table. Each kind gets a
    /// grounded entry in `placementDefaults.json` as it is migrated off the
    /// scattered `LayoutConfig` constants; until then `resolve` returns this.
    /// The fallback padding is symmetric, so an unconfigured kind keeps equal
    /// vertical and horizontal clearance.
    fn default() -> Self {
        Self {
            attach_gap: 2.0,
            attach_gap_above: None,
            attach_gap_below: None,
            padding: Padding::all(0.5),
            stack_rank: 0,
        }
    }
}

/// A document's placement table: one [`PlacementMetrics`] per dependent
/// [`ElementKind`]. Kinds absent from the map resolve to
/// [`PlacementMetrics::default`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlacementTable {
    entries: HashMap<ElementKind, PlacementMetrics>,
}

/// The built-in default table, shared with the TypeScript editor as the single
/// source of truth (`packages/core/src/placementDefaults.json`).
const DEFAULT_PLACEMENT_JSON: &str =
    include_str!("../../../../packages/core/src/placementDefaults.json");

impl Default for PlacementTable {
    fn default() -> Self {
        // Parsed from the shared defaults file embedded at build time. The file
        // is a fixed asset validated by tests, so a parse failure here is a
        // build/repo error, not a runtime condition.
        let entries = serde_json::from_str(DEFAULT_PLACEMENT_JSON)
            .expect("placementDefaults.json must be a map of ElementKind → PlacementMetrics");
        Self { entries }
    }
}

impl PlacementTable {
    /// Resolve a dependent kind to its metrics, falling back to the neutral
    /// [`PlacementMetrics::default`] for kinds not present in the table.
    pub fn resolve(&self, kind: ElementKind) -> PlacementMetrics {
        self.entries.get(&kind).copied().unwrap_or_default()
    }

    /// Overlay per-document overrides parsed from a `placement` JSON object.
    ///
    /// The JSON is a partial map of kind name → partial metrics, e.g.
    /// `{ "dynamic": { "attachGap": 2.5 }, "expression": { "padding": 1.5 } }`.
    /// `padding` accepts the CSS shorthand (a scalar sets both axes) or an
    /// object overriding only the axes it names. Unspecified kinds and fields
    /// keep their default value. Malformed entries are ignored (best-effort,
    /// never panics).
    pub fn merge_json(&mut self, json: &serde_json::Value) {
        let Some(obj) = json.as_object() else {
            return;
        };
        for (kind_key, kind_val) in obj {
            let Some(kind) = kind_from_key(kind_key) else {
                continue;
            };
            let metrics = self.entries.entry(kind).or_default();
            merge_metric_fields(metrics, kind_val);
        }
    }
}

/// Map a camelCase JSON key to its dependent [`ElementKind`]. Only dependents
/// participate in placement; other kinds are rejected.
fn kind_from_key(key: &str) -> Option<ElementKind> {
    DEPENDENT_KINDS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, kind)| *kind)
}

/// The dependent kinds that participate in placement, paired with the camelCase
/// key used in `placementDefaults.json` and the `_x.viritura.placement` vendor
/// extension. Single source of truth for both [`kind_from_key`] and the debug
/// sidecar builder.
pub const DEPENDENT_KINDS: [(&str, ElementKind); 18] = [
    ("dynamic", ElementKind::Dynamic),
    ("expression", ElementKind::Expression),
    ("fermata", ElementKind::Fermata),
    ("articulation", ElementKind::Articulation),
    ("lyric", ElementKind::Lyric),
    ("ornament", ElementKind::Ornament),
    ("trill", ElementKind::Trill),
    ("breathMark", ElementKind::BreathMark),
    ("caesura", ElementKind::Caesura),
    ("tempo", ElementKind::Tempo),
    ("rehearsalMark", ElementKind::RehearsalMark),
    ("measureNumber", ElementKind::MeasureNumber),
    ("chordSymbol", ElementKind::ChordSymbol),
    ("segno", ElementKind::Segno),
    ("coda", ElementKind::Coda),
    ("fine", ElementKind::Fine),
    ("jump", ElementKind::Jump),
    // Pedal is a connector, not a dependent, but its below-staff anchor gap is
    // table-driven (`pedal.attachGap`) and tunable per document, so it rides the
    // same key map for `merge_json` overrides and the debug sidecar.
    ("pedal", ElementKind::Pedal),
];

/// Apply the present fields of a partial metrics JSON object onto `metrics`.
fn merge_metric_fields(metrics: &mut PlacementMetrics, val: &serde_json::Value) {
    let Some(obj) = val.as_object() else {
        return;
    };
    if let Some(v) = obj.get("attachGap").and_then(|v| v.as_f64()) {
        metrics.attach_gap = v;
    }
    if let Some(v) = obj.get("attachGapAbove").and_then(|v| v.as_f64()) {
        metrics.attach_gap_above = Some(v);
    }
    if let Some(v) = obj.get("attachGapBelow").and_then(|v| v.as_f64()) {
        metrics.attach_gap_below = Some(v);
    }
    if let Some(p) = obj.get("padding") {
        merge_padding(&mut metrics.padding, p);
    }
    if let Some(v) = obj.get("stackRank").and_then(|v| v.as_i64()) {
        metrics.stack_rank = v as i32;
    }
}

/// Apply a partial `padding` override (CSS shorthand): a scalar sets both axes;
/// an object overrides only the axes it names, leaving the other untouched.
fn merge_padding(padding: &mut Padding, val: &serde_json::Value) {
    if let Some(v) = val.as_f64() {
        padding.vertical = v;
        padding.horizontal = v;
        return;
    }
    let Some(obj) = val.as_object() else {
        return;
    };
    if let Some(v) = obj.get("vertical").and_then(|v| v.as_f64()) {
        padding.vertical = v;
    }
    if let Some(v) = obj.get("horizontal").and_then(|v| v.as_f64()) {
        padding.horizontal = v;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_table_grounds_dynamics_at_three_sp() {
        let table = PlacementTable::default();
        assert_eq!(table.resolve(ElementKind::Dynamic).attach_gap, 3.0);
        assert_eq!(table.resolve(ElementKind::Dynamic).padding.vertical, 0.5);
    }

    #[test]
    fn unlisted_kind_resolves_to_neutral_default() {
        let table = PlacementTable::default();
        // `Other` has no entry in `placementDefaults.json`, so it falls back to
        // the neutral default. (Most concrete dependents are now listed.)
        assert_eq!(
            table.resolve(ElementKind::Other),
            PlacementMetrics::default()
        );
    }

    #[test]
    fn neutral_default_padding_is_symmetric() {
        let m = PlacementMetrics::default();
        assert_eq!(m.padding.vertical, m.padding.horizontal);
    }

    #[test]
    fn merge_json_overrides_present_fields_only() {
        let mut table = PlacementTable::default();
        table.merge_json(&serde_json::json!({ "dynamic": { "attachGap": 2.5 } }));
        let m = table.resolve(ElementKind::Dynamic);
        assert_eq!(m.attach_gap, 2.5);
        // padding untouched.
        assert_eq!(m.padding.vertical, 0.5);
    }

    #[test]
    fn merge_json_scalar_padding_sets_both_axes() {
        let mut table = PlacementTable::default();
        table.merge_json(&serde_json::json!({ "dynamic": { "padding": 1.25 } }));
        let m = table.resolve(ElementKind::Dynamic);
        assert_eq!(m.padding.vertical, 1.25);
        assert_eq!(m.padding.horizontal, 1.25);
    }

    #[test]
    fn merge_json_object_padding_overrides_one_axis_only() {
        let mut table = PlacementTable::default();
        // dynamic defaults to vertical 0.5 / horizontal 0.0.
        table.merge_json(&serde_json::json!({ "dynamic": { "padding": { "horizontal": 0.75 } } }));
        let m = table.resolve(ElementKind::Dynamic);
        assert_eq!(m.padding.vertical, 0.5, "untouched axis keeps its value");
        assert_eq!(m.padding.horizontal, 0.75);
    }

    #[test]
    fn padding_deserializes_from_scalar_or_object() {
        let scalar: Padding = serde_json::from_str("0.5").unwrap();
        assert_eq!(scalar, Padding::all(0.5));
        let object: Padding =
            serde_json::from_str(r#"{ "vertical": 0.4, "horizontal": 0.1 }"#).unwrap();
        assert_eq!(
            object,
            Padding {
                vertical: 0.4,
                horizontal: 0.1
            }
        );
    }

    #[test]
    fn merge_json_ignores_unknown_kind() {
        let mut table = PlacementTable::default();
        let before = table.clone();
        table.merge_json(&serde_json::json!({ "notADependent": { "attachGap": 9.0 } }));
        assert_eq!(table, before);
    }
}
