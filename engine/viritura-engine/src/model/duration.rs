use serde::{Deserialize, Serialize};

/// Note value base — the rhythmic duration type (MNX spec names).
///
/// Rendering coverage:
/// - `DuplexMaxima`, `Maxima`, `Longa` share the double-whole notehead glyph
///   (no dedicated SMuFL glyph in standard CMN); each has a dedicated rest glyph.
/// - `Breve` → `N4096th` have proper SMuFL noteheads/rests/flags through
///   `N1024th`. `N2048th` and `N4096th` have no SMuFL flag or rest glyph;
///   the renderer falls back to extra beam levels at the layout layer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum NoteValueBase {
    #[serde(rename = "duplexMaxima")]
    DuplexMaxima,
    #[serde(rename = "maxima")]
    Maxima,
    #[serde(rename = "longa")]
    Longa,
    #[serde(rename = "breve")]
    Breve,
    #[serde(rename = "whole")]
    Whole,
    #[serde(rename = "half")]
    Half,
    #[serde(rename = "quarter")]
    Quarter,
    #[serde(rename = "eighth")]
    Eighth,
    #[serde(rename = "16th")]
    Sixteenth,
    #[serde(rename = "32nd")]
    ThirtySecond,
    #[serde(rename = "64th")]
    SixtyFourth,
    #[serde(rename = "128th")]
    HundredTwentyEighth,
    #[serde(rename = "256th")]
    TwoHundredFiftySixth,
    #[serde(rename = "512th")]
    FiveHundredTwelfth,
    #[serde(rename = "1024th")]
    ThousandTwentyFourth,
    #[serde(rename = "2048th")]
    TwoThousandFortyEighth,
    #[serde(rename = "4096th")]
    FourThousandNinetySixth,
}

impl NoteValueBase {
    /// Duration in quarter-note beats.
    pub fn beats(&self) -> f64 {
        match self {
            Self::DuplexMaxima => 64.0,
            Self::Maxima => 32.0,
            Self::Longa => 16.0,
            Self::Breve => 8.0,
            Self::Whole => 4.0,
            Self::Half => 2.0,
            Self::Quarter => 1.0,
            Self::Eighth => 0.5,
            Self::Sixteenth => 0.25,
            Self::ThirtySecond => 0.125,
            Self::SixtyFourth => 0.0625,
            Self::HundredTwentyEighth => 0.03125,
            Self::TwoHundredFiftySixth => 0.015625,
            Self::FiveHundredTwelfth => 0.0078125,
            Self::ThousandTwentyFourth => 0.00390625,
            Self::TwoThousandFortyEighth => 0.001953125,
            Self::FourThousandNinetySixth => 0.0009765625,
        }
    }

    /// Number of flags/beams (0 for quarter and longer).
    pub fn flag_count(&self) -> u32 {
        match self {
            Self::Eighth => 1,
            Self::Sixteenth => 2,
            Self::ThirtySecond => 3,
            Self::SixtyFourth => 4,
            Self::HundredTwentyEighth => 5,
            Self::TwoHundredFiftySixth => 6,
            Self::FiveHundredTwelfth => 7,
            Self::ThousandTwentyFourth => 8,
            Self::TwoThousandFortyEighth => 9,
            Self::FourThousandNinetySixth => 10,
            _ => 0,
        }
    }

    /// Whether this note value has a filled (solid) notehead.
    pub fn is_filled(&self) -> bool {
        matches!(
            self,
            Self::Quarter
                | Self::Eighth
                | Self::Sixteenth
                | Self::ThirtySecond
                | Self::SixtyFourth
                | Self::HundredTwentyEighth
                | Self::TwoHundredFiftySixth
                | Self::FiveHundredTwelfth
                | Self::ThousandTwentyFourth
                | Self::TwoThousandFortyEighth
                | Self::FourThousandNinetySixth
        )
    }

    /// Whether this note value has a stem.
    pub fn has_stem(&self) -> bool {
        !matches!(
            self,
            Self::Whole | Self::Breve | Self::Longa | Self::Maxima | Self::DuplexMaxima
        )
    }
}

/// Duration of a note/rest (MNX note value).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Duration {
    /// Base note value type
    pub base: NoteValueBase,
    /// Number of augmentation dots
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dots: Option<u32>,
}

impl Duration {
    /// Total duration in quarter-note beats (including dots).
    pub fn total_beats(&self) -> f64 {
        let base = self.base.beats();
        let dots = self.dots.unwrap_or(0);
        let mut total = base;
        for d in 0..dots {
            total += base / (2.0_f64.powi(d as i32 + 1));
        }
        total
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_beats() {
        assert_eq!(NoteValueBase::Quarter.beats(), 1.0);
        assert_eq!(NoteValueBase::Half.beats(), 2.0);
        assert_eq!(NoteValueBase::Eighth.beats(), 0.5);
    }

    #[test]
    fn test_dotted_duration() {
        let dotted_quarter = Duration {
            base: NoteValueBase::Quarter,
            dots: Some(1),
        };
        assert!((dotted_quarter.total_beats() - 1.5).abs() < 0.001);

        let double_dotted_half = Duration {
            base: NoteValueBase::Half,
            dots: Some(2),
        };
        assert!((double_dotted_half.total_beats() - 3.5).abs() < 0.001);
    }
}
