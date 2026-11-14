use super::{
    ExpressionPlacement, RhythmicPosition, StaffTextFramePresentation, Swing, TempoNoteValue,
    TextContent,
};
use serde::{Deserialize, Serialize};

/// Globally owned rhythmic text; staff/voice and page geometry are not its scope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SystemText {
    pub id: String,
    pub text: TextContent,
    pub position: RhythmicPosition,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tempo: Option<SystemTempo>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "showText")]
    pub show_text: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<StaffTextFramePresentation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<ExpressionPlacement>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "manualOffset"
    )]
    pub manual_offset: Option<[f64; 2]>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "avoidCollisions"
    )]
    pub avoid_collisions: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SystemTempo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<TempoNoteValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swing: Option<Swing>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "showMetronomeMark"
    )]
    pub show_metronome_mark: Option<bool>,
}
