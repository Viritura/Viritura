use super::RhythmicPosition;
use serde::{Deserialize, Serialize};

pub use crate::raw_viritura::GlobalFermataClickBehavior;

/// Score-wide hold at a whole-note fraction of the global measure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GlobalFermata {
    pub id: String,
    pub position: RhythmicPosition,
    #[serde(default = "default_multiplier")]
    pub multiplier: f64,
    #[serde(default, rename = "clickBehavior")]
    pub click_behavior: GlobalFermataClickBehavior,
}

fn default_multiplier() -> f64 {
    2.0
}
