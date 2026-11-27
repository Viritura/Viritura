use serde::{Deserialize, Serialize};

pub use crate::raw_viritura::HarpPedalSettingDisplay as HarpPedalDisplay;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placement: Option<crate::model::MultiStaffPlacement>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "manualOffset")]
    pub manual_offset: Option<[f64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "avoidCollisions")]
    pub avoid_collisions: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display: Option<HarpPedalDisplay>,
    /// Derived during layout: the tuning in effect just before this setting
    /// in written order. Never serialized.
    #[serde(skip)]
    pub preceding_tuning: Option<HarpPedalTuning>,
}

impl HarpPedalSetting {
    pub(crate) fn presentation_staff(&self, staff_count: u32) -> u32 {
        let default_staff = if self.placement == Some(crate::model::MultiStaffPlacement::Above) {
            1
        } else {
            staff_count
        };
        self.staff.unwrap_or(default_staff)
    }
}

impl HarpPedalTuning {
    /// Pedals in standard foot order: left foot D C B, then right foot E F G A.
    pub fn in_foot_order(&self) -> [(char, HarpPedalAlter); 7] {
        [
            ('D', self.d),
            ('C', self.c),
            ('B', self.b),
            ('E', self.e),
            ('F', self.f),
            ('G', self.g),
            ('A', self.a),
        ]
    }
}

/// Fill `preceding_tuning` for settings of `measures[measure_index]`, using the
/// last earlier setting in written order (repeats and jumps are not followed).
pub fn annotate_preceding_harp_tunings(
    settings: &mut [HarpPedalSetting],
    measures: &[super::PartMeasure],
    measure_index: usize,
) {
    for setting in settings {
        setting.preceding_tuning =
            preceding_harp_tuning(measures, measure_index, setting.position.fraction);
    }
}

fn preceding_harp_tuning(
    measures: &[super::PartMeasure],
    measure_index: usize,
    fraction: (u32, u32),
) -> Option<HarpPedalTuning> {
    let before = |(n, d): (u32, u32), (on, od): (u32, u32)| {
        u64::from(n) * u64::from(od) < u64::from(on) * u64::from(d)
    };
    let latest = |settings: &mut dyn Iterator<Item = &HarpPedalSetting>| {
        settings
            .reduce(|best, s| {
                if before(best.position.fraction, s.position.fraction) {
                    s
                } else {
                    best
                }
            })
            .map(|s| s.tuning.clone())
    };
    if let Some(found) = measures.get(measure_index).and_then(|measure| {
        latest(
            &mut measure
                .harp_pedals
                .iter()
                .flatten()
                .filter(|s| before(s.position.fraction, fraction)),
        )
    }) {
        return Some(found);
    }
    measures
        .get(..measure_index.min(measures.len()))?
        .iter()
        .rev()
        .find_map(|measure| latest(&mut measure.harp_pedals.iter().flatten()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct HarpPedalPosition {
    pub fraction: (u32, u32),
}
