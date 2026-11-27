use serde::{Deserialize, Serialize};

pub use crate::raw_viritura::HarpPedalSettingSource as HarpPedalSource;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(try_from = "i8", into = "i8")]
pub enum HarpPedalAlter {
    Flat,
    Natural,
    Sharp,
}

impl TryFrom<i8> for HarpPedalAlter {
    type Error = &'static str;

    fn try_from(value: i8) -> Result<Self, Self::Error> {
        match value {
            -1 => Ok(Self::Flat),
            0 => Ok(Self::Natural),
            1 => Ok(Self::Sharp),
            _ => Err("harp pedal alteration must be -1, 0, or 1"),
        }
    }
}

impl From<HarpPedalAlter> for i8 {
    fn from(value: HarpPedalAlter) -> Self {
        match value {
            HarpPedalAlter::Flat => -1,
            HarpPedalAlter::Natural => 0,
            HarpPedalAlter::Sharp => 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HarpPedalTuning {
    #[serde(rename = "D")]
    pub d: HarpPedalAlter,
    #[serde(rename = "C")]
    pub c: HarpPedalAlter,
    #[serde(rename = "B")]
    pub b: HarpPedalAlter,
    #[serde(rename = "E")]
    pub e: HarpPedalAlter,
    #[serde(rename = "F")]
    pub f: HarpPedalAlter,
    #[serde(rename = "G")]
    pub g: HarpPedalAlter,
    #[serde(rename = "A")]
    pub a: HarpPedalAlter,
}

/// The setting is part-wide; staff controls only where its diagram is printed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HarpPedalSetting {
    pub id: String,
    pub position: HarpPedalPosition,
    pub tuning: HarpPedalTuning,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<HarpPedalSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staff: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HarpPedalPosition {
    pub fraction: (u32, u32),
}
