use crate::model::score::Score;

pub(super) fn engraving_flags(score: &Score) -> (bool, bool) {
    let support = score.mnx.support.as_ref();
    (
        support.and_then(|s| s.use_beams).unwrap_or(false),
        support
            .and_then(|s| s.use_accidental_display)
            .unwrap_or(false),
    )
}
