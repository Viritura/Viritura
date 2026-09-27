//! Stem-direction resolution for a sequence and its events.
//!
//! MNX carries three direction controls at decreasing scope, and this module
//! owns the order in which they win:
//!
//! 1. `event.stemDirection` — a per-event override. The MNX enum has no
//!    `auto` member, so an absent value (not a sentinel) means "decide".
//! 2. `staff-source.stem` — a *layout*-scoped force, reaching us as
//!    [`Sequence::forced_stem_up`]. Because it lives in `score.layouts`, the
//!    same content can be forced in a conductor score and float in a part.
//! 3. `sequence.directionHint` — a *content*-scoped hint, restated per part
//!    measure. It is explicitly a hint, not a force: the spec offers it "as a
//!    hint for individual events' stem directions, if they're not explicitly
//!    encoded as event.stemDirection", and permits several sequences in one
//!    part measure to share a value. It therefore cannot impose a total
//!    ordering, and array position survives only as a tiebreaker.
//!
//! A hint applies only while the sequence is *contested* — that is, while some
//! other sequence in the same part measure engraves something the reader can
//! see. MNX has no way to hide a rest (`clef.hide` is the spec's only `hide`
//! property), so a voice that is silent but present is encoded either as
//! `space`, which is defined as time "in which no sequence content occurs", or
//! by omitting the sequence entirely. Neither displaces another voice, so an
//! uncontested sequence falls through to pitch analysis and engraves as though
//! it were the only voice — which it visually is.

use crate::model::event::{DirectionHint, Sequence, SequenceContent, StemDirection};

/// Staff position of the middle staff line, the pivot for automatic stems.
const MIDDLE_LINE_POSITION: f64 = 4.0;

/// Whether this sequence engraves anything a reader can see, and so competes
/// for stem directions with the other sequences of its part measure.
///
/// A sequence built only from `space` occupies time without occupying the
/// staff; it is MNX's encoding for the voice being absent here, and is how a
/// "hidden rest" round-trips. A visible rest, by contrast, does contest: it is
/// engraved, offset against the other voice, and standard engraving practice
/// keeps the surviving voice on its own side of the staff.
pub(crate) fn sequence_is_contesting(sequence: &Sequence) -> bool {
    if sequence.full_measure.is_some() {
        return true;
    }
    sequence
        .content
        .iter()
        .any(|item| !matches!(item, SequenceContent::Space(_)))
}

/// Number of sequences in a part measure that engrave visible content.
pub(crate) fn contesting_voice_count(sequences: &[Sequence]) -> usize {
    sequences
        .iter()
        .filter(|sequence| sequence_is_contesting(sequence))
        .count()
}

/// The sequence-level inputs to stem resolution, carried together because they
/// are fixed for a whole sequence while `voice_index` and note positions vary
/// per call site.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct StemContext {
    /// Layout-scoped force from `staff-source.stem`.
    pub forced_stem_up: Option<bool>,
    /// Content-scoped hint from `sequence.directionHint`.
    pub direction_hint: Option<DirectionHint>,
    /// Sequences in this part measure that engrave visible content.
    pub contesting_voices: usize,
}

impl StemContext {
    /// Build the context for one sequence of a part measure.
    pub(crate) fn for_sequence(sequence: &Sequence, contesting_voices: usize) -> Self {
        Self {
            forced_stem_up: sequence.forced_stem_up,
            direction_hint: sequence.direction_hint,
            contesting_voices,
        }
    }
}

/// The sequence-level stem intent applied to events that carry no explicit
/// `stemDirection`.
///
/// `None` means the sequence expresses no intent and direction should be
/// derived from pitch. That is the case for an uncontested sequence even when
/// it carries a `upper`/`lower` hint, because the hint describes this voice's
/// position *relative to other sequences* that are not currently engraved.
pub(crate) fn sequence_stem_intent(stem: StemContext, voice_index: usize) -> Option<bool> {
    if let Some(forced) = stem.forced_stem_up {
        return Some(forced);
    }
    if stem.contesting_voices <= 1 {
        return None;
    }
    match stem.direction_hint {
        Some(DirectionHint::Upper) => Some(true),
        Some(DirectionHint::Lower) => Some(false),
        // An absent hint defaults to `auto`. Several sequences may also share
        // one hint (three or more voices), so array order remains the only
        // available tiebreaker among equally-hinted voices.
        Some(DirectionHint::Auto) | None => Some(voice_index == 0),
    }
}

/// Automatic stem direction from pitch alone: notes sitting above the middle
/// line take downward stems.
pub(crate) fn stem_up_from_pitch(note_positions: &[f64]) -> bool {
    let average = if note_positions.is_empty() {
        MIDDLE_LINE_POSITION
    } else {
        note_positions.iter().sum::<f64>() / note_positions.len() as f64
    };
    average > MIDDLE_LINE_POSITION
}

/// Resolve one event's stem direction against the full precedence order.
pub(crate) fn resolve_stem_up(
    stem_direction: Option<&StemDirection>,
    stem: StemContext,
    voice_index: usize,
    note_positions: &[f64],
) -> bool {
    if let Some(direction) = stem_direction {
        return matches!(direction, StemDirection::Up);
    }
    if let Some(intent) = sequence_stem_intent(stem, voice_index) {
        return intent;
    }
    stem_up_from_pitch(note_positions)
}
