use serde::{Deserialize, Serialize};

/// Barline type — re-exported from the MNX raw schema.
///
/// The decoded model uses the MNX `barline-type` enum verbatim (11 variants:
/// `Regular`, `Dotted`, `Dashed`, `Heavy`, `Double`, `Final`, `HeavyLight`,
/// `HeavyHeavy`, `Tick`, `Short`, `NoBarline`). Repeat barlines are *not*
/// part of this enum — MNX represents them as separate `measure.repeatStart`
/// and `measure.repeatEnd` sibling objects, which the decoded model preserves
/// faithfully on `Measure`. Layout combines the two at rendering time via
/// `layout::render_barlines::BarlineKind`.
pub use crate::raw::BarlineType;

/// Barline definition.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Barline {
    #[serde(rename = "type")]
    pub barline_type: BarlineType,
}
