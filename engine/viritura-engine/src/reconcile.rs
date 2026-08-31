//! Score reconciliation — validates and normalizes measure durations.
//!
//! Runs after every score mutation to ensure all sequences have the correct
//! number of beats matching their time signatures. If a sequence is too short,
//! rests are appended. If too long, trailing rests are trimmed.
//!
//! This is the Rust equivalent of the TS `reconcileScore()` function.
//! It should be called from the WASM entry points before layout, so that
//! the layout engine always receives valid input regardless of how the
//! score was modified (note entry, AI generation, direct MNX edit, etc.).

use crate::model::*;

/// Reconcile all measures in the score.
///
/// Ensures every sequence in every part-measure has the correct number
/// of beats for its time signature.
pub fn reconcile_score(score: &mut Score) {
    let num_measures = score.global.measures.len();
    let covered = measure_repeat_coverage(score);

    for m in 0..num_measures {
        reconcile_measure(score, m, &covered);
    }
}

/// Reconcile a contiguous range of measures.
///
/// This is used by patch-based layout when only part-measure content changed.
/// If a global measure changes time-signature context, callers should use
/// `reconcile_score` because following measures may inherit the new duration.
pub fn reconcile_score_range(score: &mut Score, start: usize, end: usize) {
    if score.global.measures.is_empty() || start >= score.global.measures.len() {
        return;
    }
    let end = end.min(score.global.measures.len() - 1);
    let covered = measure_repeat_coverage(score);
    for m in start..=end {
        reconcile_measure(score, m, &covered);
    }
}

/// Per-part flags marking every measure that a simile sign stands in for.
///
/// A sign at index `j` spanning `n` bars covers `j … j + n - 1`. Computed once
/// per reconcile pass so the hot per-measure loop stays O(1) per part.
fn measure_repeat_coverage(score: &Score) -> Vec<Vec<bool>> {
    score
        .parts
        .iter()
        .map(|part| {
            let mut covered = vec![false; part.measures.len()];
            for (index, measure) in part.measures.iter().enumerate() {
                let Some(repeat) = measure.measure_repeat.as_ref() else {
                    continue;
                };
                let span = repeat.number.max(1) as usize;
                for slot in covered.iter_mut().skip(index).take(span) {
                    *slot = true;
                }
            }
            covered
        })
        .collect()
}

fn reconcile_measure(score: &mut Score, m: usize, covered: &[Vec<bool>]) {
    let ts = effective_time_signature(&score.global.measures, m);
    let expected = ts.measure_beats();
    let is_pickup_measure = m == 0 && matches!(score.global.measures[m].number, Some(0));
    let is_senza_misura = score.global.measures[m]
        .time
        .as_ref()
        .is_some_and(|time| matches!(time.display, Some(TimeSignatureDisplay::SenzaMisura)));
    // A senza-misura bar has no fixed duration. Its count/unit establish the
    // meter inherited by following bars, but this bar's written content must
    // not be padded or trimmed to that nominal duration.
    if is_senza_misura {
        return;
    }

    for (part_index, part) in score.parts.iter_mut().enumerate() {
        if m >= part.measures.len() {
            continue;
        }
        // A simile sign stands in for the music of earlier bars, so neither the
        // bar carrying it nor the bars it covers get filled with rests.
        if covered.get(part_index).and_then(|f| f.get(m)) == Some(&true) {
            continue;
        }
        let pm = &mut part.measures[m];
        for seq in &mut pm.sequences {
            reconcile_sequence(seq, expected, is_pickup_measure);
        }
    }
}

/// Resolve the effective time signature at a given measure index.
fn effective_time_signature(measures: &[GlobalMeasure], measure_idx: usize) -> TimeSignature {
    for i in (0..=measure_idx).rev() {
        if let Some(ref ts) = measures[i].time {
            return ts.clone();
        }
    }
    // Default: 4/4
    TimeSignature {
        count: 4,
        unit: 4,
        display: None,
    }
}

/// Compute total beats of a sequence's content.
fn sequence_beats(seq: &Sequence) -> f64 {
    let mut total = 0.0;
    for item in &seq.content {
        total += content_beats(item);
    }
    total
}

/// Compute beats for a single content item.
fn content_beats(item: &SequenceContent) -> f64 {
    match item {
        SequenceContent::Event(ev) => ev.duration.total_beats(),
        SequenceContent::Tuplet(t) => t.outer.multiple as f64 * t.outer.duration.total_beats(),
        SequenceContent::MultiNoteTremolo(t) => {
            t.outer.multiple as f64 * t.outer.duration.total_beats()
        }
        SequenceContent::Grace(_) => 0.0,
        SequenceContent::Space(sp) => {
            // Space duration is [numerator, denominator] as fraction of whole note
            (sp.duration.0 as f64 / sp.duration.1 as f64) * 4.0
        }
        SequenceContent::Other(_) => 0.0,
    }
}

/// Reconcile a single sequence to match the expected measure beats.
fn reconcile_sequence(seq: &mut Sequence, expected_beats: f64, preserve_short_measure: bool) {
    // Skip sequences with fullMeasure flag and no explicit content
    if seq.full_measure.is_some() && seq.content.is_empty() {
        return;
    }

    let current = sequence_beats(seq);
    let diff = expected_beats - current;

    if diff > 1e-9 {
        if preserve_short_measure {
            return;
        }
        // Too short — fill with rests
        fill_with_rests(seq, diff);
    } else if diff < -1e-9 {
        // Too long — trim trailing rests
        trim_trailing_rests(seq, -diff);
    }
}

/// Append rests to fill the given number of beats.
fn fill_with_rests(seq: &mut Sequence, mut beats: f64) {
    while beats > 1e-9 {
        let base = largest_base_fitting(beats);
        let base_beats = base.beats();
        seq.content.push(SequenceContent::Event(Event {
            duration: Duration { base, dots: None },
            id: None,
            notes: None,
            rest: Some(Rest {
                staff_position: None,
            }),
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        }));
        beats -= base_beats;
    }
}

/// Trim trailing rests to remove the given excess beats.
fn trim_trailing_rests(seq: &mut Sequence, mut excess: f64) {
    while excess > 1e-9 && !seq.content.is_empty() {
        let last = seq.content.last().unwrap();
        // Only trim rests, never notes
        let is_rest = match last {
            SequenceContent::Event(ev) => ev.rest.is_some(),
            _ => false,
        };
        if !is_rest {
            break;
        }

        let last_beats = content_beats(last);
        if last_beats <= excess + 1e-9 {
            seq.content.pop();
            excess -= last_beats;
        } else {
            // Shrink the rest
            seq.content.pop();
            let new_beats = last_beats - excess;
            fill_with_rests(seq, new_beats);
            excess = 0.0;
        }
    }
}

/// Find the largest NoteValueBase that fits within the given beat count.
fn largest_base_fitting(beats: f64) -> NoteValueBase {
    let bases = [
        NoteValueBase::DuplexMaxima,
        NoteValueBase::Maxima,
        NoteValueBase::Longa,
        NoteValueBase::Breve,
        NoteValueBase::Whole,
        NoteValueBase::Half,
        NoteValueBase::Quarter,
        NoteValueBase::Eighth,
        NoteValueBase::Sixteenth,
        NoteValueBase::ThirtySecond,
        NoteValueBase::SixtyFourth,
        NoteValueBase::HundredTwentyEighth,
        NoteValueBase::TwoHundredFiftySixth,
        NoteValueBase::FiveHundredTwelfth,
        NoteValueBase::ThousandTwentyFourth,
        NoteValueBase::TwoThousandFortyEighth,
        NoteValueBase::FourThousandNinetySixth,
    ];
    for base in &bases {
        if base.beats() <= beats + 1e-9 {
            return base.clone();
        }
    }
    NoteValueBase::FourThousandNinetySixth
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(base: NoteValueBase) -> SequenceContent {
        SequenceContent::Event(Event {
            duration: Duration { base, dots: None },
            id: None,
            notes: Some(vec![Note {
                pitch: Pitch {
                    step: "C".to_string(),
                    octave: 5,
                    alter: None,
                },
                id: None,
                ties: None,
                accidental_display: None,
                written: None,
                staff: None,
                kit_component: None,
                perform: None,
                source_part_index: None,
                source_event_id: None,
                source_note_index: None,
            }]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        })
    }

    fn make_rest(base: NoteValueBase) -> SequenceContent {
        SequenceContent::Event(Event {
            duration: Duration { base, dots: None },
            id: None,
            notes: None,
            rest: Some(Rest {
                staff_position: None,
            }),
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        })
    }

    #[test]
    fn test_fill_short_measure() {
        let mut seq = Sequence {
            content: vec![make_event(NoteValueBase::Quarter)],
            full_measure: None,
            staff: None,
            voice: None,
            orient: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        reconcile_sequence(&mut seq, 4.0, false); // 4/4
        let total: f64 = seq.content.iter().map(content_beats).sum();
        assert!(
            (total - 4.0).abs() < 1e-9,
            "Expected 4 beats, got {}",
            total
        );
    }

    #[test]
    fn test_trim_overflow() {
        let mut seq = Sequence {
            content: vec![
                make_event(NoteValueBase::Quarter),
                make_rest(NoteValueBase::Whole), // 4 beats of rest = too much
            ],
            full_measure: None,
            staff: None,
            voice: None,
            orient: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        reconcile_sequence(&mut seq, 4.0, false);
        let total: f64 = seq.content.iter().map(content_beats).sum();
        assert!(
            (total - 4.0).abs() < 1e-9,
            "Expected 4 beats, got {}",
            total
        );
    }

    #[test]
    fn test_skip_full_measure_rest() {
        let mut seq = Sequence {
            content: vec![],
            full_measure: Some(FullMeasure {
                visual_duration: Duration {
                    base: NoteValueBase::Whole,
                    dots: None,
                },
                staff_position: None,
            }),
            staff: None,
            voice: None,
            orient: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        reconcile_sequence(&mut seq, 4.0, false);
        assert!(
            seq.content.is_empty(),
            "fullMeasure sequences should stay empty"
        );
    }

    #[test]
    fn test_preserve_short_pickup_measure() {
        let mut seq = Sequence {
            content: vec![make_event(NoteValueBase::Quarter)],
            full_measure: None,
            staff: None,
            voice: None,
            orient: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };

        reconcile_sequence(&mut seq, 4.0, true);

        assert_eq!(
            seq.content.len(),
            1,
            "Pickup measure should not be padded with rests"
        );
        let total: f64 = seq.content.iter().map(content_beats).sum();
        assert!(
            (total - 1.0).abs() < 1e-9,
            "Expected 1 beat pickup content, got {}",
            total
        );
    }
}
