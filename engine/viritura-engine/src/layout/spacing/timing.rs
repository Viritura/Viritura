use crate::model::{Event, Orientation, Sequence, SequenceContent};
use std::collections::HashMap;

const BEAT_KEY_SCALE: f64 = 1_000_000.0;

/// Canonical identity for a rhythmic position.
///
/// Spacing comparisons and hash keys must not independently truncate `f64`
/// beats: equivalent nested tuplets can reach the same rational position by
/// slightly different floating-point paths. Rounding once at microbeat
/// precision keeps those representations on the same shared column.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct BeatKey(i64);

impl BeatKey {
    pub(crate) fn new(beats: f64) -> Self {
        debug_assert!(beats.is_finite(), "spacing beats must be finite");
        Self((beats * BEAT_KEY_SCALE).round() as i64)
    }

    pub(crate) fn beats(self) -> f64 {
        self.0 as f64 / BEAT_KEY_SCALE
    }
}

#[derive(Clone, Copy)]
pub(super) struct SpacingEvent<'a> {
    pub key: BeatKey,
    pub event: &'a Event,
    pub duration_beats: f64,
    pub forced_stem_up: Option<bool>,
    pub sequence_index: usize,
    pub sequence_count: usize,
    pub sequence_staff: u32,
}

pub(super) struct SequenceTimeline<'a> {
    pub events: Vec<SpacingEvent<'a>>,
    pub grace_before: HashMap<BeatKey, usize>,
    pub grace_after: HashMap<BeatKey, usize>,
}

/// Traverse every timed spacing event in a sequence exactly once.
///
/// Tuplet scaling, tremolo subdivision, spaces, inherited orientation, and
/// grace attachment are centralized here so every spacing fact observes the
/// same rhythmic timeline.
pub(super) fn sequence_timeline(
    sequence: &Sequence,
    sequence_index: usize,
    sequence_count: usize,
) -> SequenceTimeline<'_> {
    let mut timeline = SequenceTimeline {
        events: Vec::new(),
        grace_before: HashMap::new(),
        grace_after: HashMap::new(),
    };
    let mut beat = 0.0;
    let mut pending_graces = 0;
    let forced_stem_up = sequence
        .orient
        .and_then(Orientation::force_stem_up)
        .or(sequence.forced_stem_up);
    walk_content(
        &sequence.content,
        &mut beat,
        1.0,
        forced_stem_up,
        sequence_index,
        sequence_count,
        sequence.staff.unwrap_or(1),
        &mut pending_graces,
        &mut timeline,
    );
    if pending_graces > 0 {
        if let Some(last_event) = timeline.events.last() {
            timeline.grace_after.insert(last_event.key, pending_graces);
        }
    }
    timeline
}

#[allow(clippy::too_many_arguments)] // traversal state is explicit to keep all timing rules in one recursion
fn walk_content<'a>(
    content: &'a [SequenceContent],
    beat: &mut f64,
    duration_scale: f64,
    forced_stem_up: Option<bool>,
    sequence_index: usize,
    sequence_count: usize,
    sequence_staff: u32,
    pending_graces: &mut usize,
    timeline: &mut SequenceTimeline<'a>,
) {
    for item in content {
        match item {
            SequenceContent::Event(event) => {
                push_event(
                    event,
                    *beat,
                    event.duration.total_beats() * duration_scale,
                    forced_stem_up,
                    sequence_index,
                    sequence_count,
                    sequence_staff,
                    pending_graces,
                    timeline,
                );
                *beat += event.duration.total_beats() * duration_scale;
            }
            SequenceContent::Tuplet(tuplet) => {
                let inner = tuplet.inner.duration.total_beats() * f64::from(tuplet.inner.multiple);
                let outer = tuplet.outer.duration.total_beats() * f64::from(tuplet.outer.multiple);
                let scale = if inner > 0.0 { outer / inner } else { 1.0 };
                let tuplet_forced = tuplet
                    .orient
                    .and_then(Orientation::force_stem_up)
                    .or(forced_stem_up);
                walk_content(
                    &tuplet.content,
                    beat,
                    duration_scale * scale,
                    tuplet_forced,
                    sequence_index,
                    sequence_count,
                    sequence_staff,
                    pending_graces,
                    timeline,
                );
            }
            SequenceContent::MultiNoteTremolo(tremolo) => {
                let outer =
                    tremolo.outer.duration.total_beats() * f64::from(tremolo.outer.multiple);
                let per_event = if tremolo.content.is_empty() {
                    outer
                } else {
                    outer / tremolo.content.len() as f64
                };
                for event in &tremolo.content {
                    push_event(
                        event,
                        *beat,
                        per_event * duration_scale,
                        forced_stem_up,
                        sequence_index,
                        sequence_count,
                        sequence_staff,
                        pending_graces,
                        timeline,
                    );
                    *beat += per_event * duration_scale;
                }
            }
            SequenceContent::Grace(grace) => *pending_graces += grace.content.len(),
            SequenceContent::Space(space) => {
                *beat += space.total_beats() * duration_scale;
            }
            SequenceContent::Other(_) => {}
        }
    }
}

#[allow(clippy::too_many_arguments)] // mirrors the traversal context captured in SpacingEvent
fn push_event<'a>(
    event: &'a Event,
    beat: f64,
    duration_beats: f64,
    forced_stem_up: Option<bool>,
    sequence_index: usize,
    sequence_count: usize,
    sequence_staff: u32,
    pending_graces: &mut usize,
    timeline: &mut SequenceTimeline<'a>,
) {
    let key = BeatKey::new(beat);
    if *pending_graces > 0 {
        *timeline.grace_before.entry(key).or_default() += *pending_graces;
        *pending_graces = 0;
    }
    timeline.events.push(SpacingEvent {
        key,
        event,
        duration_beats,
        forced_stem_up,
        sequence_index,
        sequence_count,
        sequence_staff,
    });
}

#[cfg(test)]
mod tests {
    use super::BeatKey;

    #[test]
    fn equivalent_floating_paths_share_a_beat_key() {
        assert_eq!(BeatKey::new(1.0 / 3.0 * 3.0), BeatKey::new(1.0));
    }
}
