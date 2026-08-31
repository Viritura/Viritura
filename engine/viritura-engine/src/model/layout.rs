use serde::{Deserialize, Serialize};

/// MNX layout definition — describes how parts are arranged into staves and groups.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LayoutDefinition {
    pub id: String,
    pub content: Vec<LayoutContent>,
}

/// A node in the layout content tree: either a group or a staff.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum LayoutContent {
    /// A group of staves or nested groups, optionally with a bracket/brace.
    #[serde(rename = "group")]
    Group(LayoutGroup),
    /// A single staff, possibly with multiple part sources.
    #[serde(rename = "staff")]
    Staff(LayoutStaff),
}

/// A group node in the layout tree.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutGroup {
    pub content: Vec<LayoutContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub barline_style: Option<String>,
}

/// A staff node in the layout tree.
///
/// Model-internal type — construction goes through
/// `promote::layout::promote_layout_staff`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LayoutStaff {
    #[serde(default)]
    pub sources: Vec<LayoutSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labelref: Option<String>,
    /// Staff symbol type (MNX `symbol`): "brace", "bracket", "noSymbol".
    /// Nested brackets automatically render as thin lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    /// Whether this is an expansion staff (source staves shown below a condensed staff).
    /// Set by the editor UI via `_expansion: true` on the layout staff node.
    #[serde(
        default,
        rename = "_expansion",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub expansion: bool,
    /// Override for the per-source numbers shown stacked in the staff label
    /// (e.g. `[2, 1]` displays "2./1." instead of the auto-derived "1./2.").
    /// Used to indicate voice crossings when the parts render chord-merged
    /// in a single voice (rather than split into separate divisi voices).
    #[serde(skip_serializing_if = "Option::is_none", rename = "_condensedNumbers")]
    pub condensed_numbers_override: Option<Vec<u32>>,
    /// Override for grouped stacked rows in the staff label (e.g. `[[3], [1, 2]]`
    /// renders "3" on top and "1·2" below). Used when one source plays a
    /// distinct upper voice over a unison group below (partial-unison voicing).
    /// When set, takes precedence over `condensed_numbers_override` for row
    /// composition. Each inner array becomes one stacked row; numbers within
    /// a row are joined with a middle dot.
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "_condensedNumberRows"
    )]
    pub condensed_number_rows_override: Option<Vec<Vec<u32>>>,
}

/// A source mapping a part (and optionally a staff/voice within it) to a layout staff.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutSource {
    pub part: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stem: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labelref: Option<String>,
}

impl LayoutStaff {
    /// A staff is in condensing mode when it has multiple source parts.
    pub fn is_condensing(&self) -> bool {
        self.sources.len() > 1
    }
}

/// A multimeasure rest range within a score definition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MultimeasureRestRange {
    /// Starting measure ID.
    pub start: String,
    /// Number of measures to collapse.
    pub duration: u32,
    /// Display label override (e.g. "10" instead of computed count).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// MNX score definition — describes page/system structure for one score view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreDefinition {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Top-level layout reference for automatic system layout.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    /// Explicit multimeasure rest ranges (measure ID + duration).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub multimeasure_rests: Vec<MultimeasureRestRange>,
    /// Whether this score displays transposed (written) pitches.
    /// When true, notes and key signatures are transposed per each part's transposition.
    /// Ref: MNX spec objects/score `useWritten`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_written: Option<bool>,
    #[serde(default)]
    pub pages: Vec<PageDefinition>,
}

/// A page within a score definition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageDefinition {
    #[serde(default)]
    pub systems: Vec<SystemDefinition>,
}

/// A system within a page definition — references a layout and starting measure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemDefinition {
    /// Layout ID to use for this system (optional for simple scores).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    /// Starting measure ID for this system.
    pub measure: String,
    /// Layout changes within this system.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layout_changes: Vec<LayoutChange>,
}

/// A layout change within a system (e.g., switching to a different staff arrangement mid-system).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutChange {
    pub layout: String,
    pub location: LayoutChangeLocation,
}

/// Location of a layout change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutChangeLocation {
    pub measure: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<LayoutChangePosition>,
}

/// Position within a measure for a layout change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutChangePosition {
    pub fraction: (i32, i32),
}
