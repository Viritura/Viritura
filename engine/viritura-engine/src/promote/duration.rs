//! Promote MNX note-value objects.
//!
//! The model now covers the full MNX `note-value-base` range
//! (`duplexMaxima` … `4096th`), so this is a straight 1:1 mapping.

use crate::model::duration::{Duration, NoteValueBase};
use crate::promote::PromoteError;
use crate::raw;

pub(crate) fn promote_duration(raw: raw::NoteValue) -> Result<Duration, PromoteError> {
    Ok(Duration {
        base: promote_note_value_base(raw.base)?,
        dots: raw.dots.map(|d| u32::try_from(d.0).unwrap_or(0)),
    })
}

pub(crate) fn promote_note_value_base(
    raw: raw::NoteValueBase,
) -> Result<NoteValueBase, PromoteError> {
    Ok(match raw {
        raw::NoteValueBase::DuplexMaxima => NoteValueBase::DuplexMaxima,
        raw::NoteValueBase::Maxima => NoteValueBase::Maxima,
        raw::NoteValueBase::Longa => NoteValueBase::Longa,
        raw::NoteValueBase::Breve => NoteValueBase::Breve,
        raw::NoteValueBase::Whole => NoteValueBase::Whole,
        raw::NoteValueBase::Half => NoteValueBase::Half,
        raw::NoteValueBase::Quarter => NoteValueBase::Quarter,
        raw::NoteValueBase::Eighth => NoteValueBase::Eighth,
        raw::NoteValueBase::X16th => NoteValueBase::Sixteenth,
        raw::NoteValueBase::X32nd => NoteValueBase::ThirtySecond,
        raw::NoteValueBase::X64th => NoteValueBase::SixtyFourth,
        raw::NoteValueBase::X128th => NoteValueBase::HundredTwentyEighth,
        raw::NoteValueBase::X256th => NoteValueBase::TwoHundredFiftySixth,
        raw::NoteValueBase::X512th => NoteValueBase::FiveHundredTwelfth,
        raw::NoteValueBase::X1024th => NoteValueBase::ThousandTwentyFourth,
        raw::NoteValueBase::X2048th => NoteValueBase::TwoThousandFortyEighth,
        raw::NoteValueBase::X4096th => NoteValueBase::FourThousandNinetySixth,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn promotes_dotted_quarter() {
        let json = r#"{"base":"quarter","dots":1}"#;
        let raw: raw::NoteValue = serde_json::from_str(json).unwrap();
        let direct: Duration = serde_json::from_str(json).unwrap();
        let promoted = promote_duration(raw).unwrap();
        assert_eq!(direct, promoted);
    }

    #[test]
    fn promotes_longa() {
        let raw = raw::NoteValueBase::Longa;
        assert_eq!(promote_note_value_base(raw).unwrap(), NoteValueBase::Longa);
    }

    #[test]
    fn promotes_4096th() {
        let raw = raw::NoteValueBase::X4096th;
        assert_eq!(
            promote_note_value_base(raw).unwrap(),
            NoteValueBase::FourThousandNinetySixth
        );
    }
}
