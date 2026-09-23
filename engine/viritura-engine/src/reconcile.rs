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
//!
//! A sequence's expected duration ordinarily comes from the global measure's
//! time signature. When a sequence's staff carries an effective staff-local
//! meter (`_x.viritura.staffMeters`, resolved via
//! [`crate::model::staff_meter::resolve_staff_meter_table`]), its written
//! content is instead reconciled against that staff-local meter's own
//! duration — both `sharedDuration` and `fitMeasure` synchronization always
//! require a staff's written notation to sum to its own meter's count/unit,
//! never the global measure's.

use std::collections::HashMap;

use crate::model::staff_meter::{resolve_staff_meter_table, EffectiveStaffMeter};
use crate::model::*;

/// Reconcile all measures in the score.
///
/// Ensures every sequence in every part-measure has the correct number
/// of beats for its time signature (or, for a staff carrying an effective
/// staff-local meter, that meter's own duration).
pub fn reconcile_score(score: &mut Score) {
    let num_measures = score.global.measures.len();
    let covered = measure_repeat_coverage(score);
    let global_time_at = effective_time_signature_table(&score.global.measures);
    let staff_meter_tables = staff_meter_tables_for_parts(&score.parts, &global_time_at);

    for m in 0..num_measures {
        reconcile_measure(score, m, &covered, &global_time_at, &staff_meter_tables);
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
    // Staff-local meters inherit until changed/reset, so the table must be
    // built from measure 0 even when only reconciling a later range.
    let global_time_at = effective_time_signature_table(&score.global.measures);
    let staff_meter_tables = staff_meter_tables_for_parts(&score.parts, &global_time_at);
    for m in start..=end {
        reconcile_measure(score, m, &covered, &global_time_at, &staff_meter_tables);
    }
}

/// Resolve the per-measure effective staff-meter table for every part.
fn staff_meter_tables_for_parts(
    parts: &[Part],
    global_time_at: &[TimeSignature],
) -> Vec<Vec<HashMap<u32, EffectiveStaffMeter>>> {
    parts
        .iter()
        .map(|part| resolve_staff_meter_table(&part.measures, global_time_at).0)
        .collect()
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

fn reconcile_measure(
    score: &mut Score,
    m: usize,
    covered: &[Vec<bool>],
    global_time_at: &[TimeSignature],
    staff_meter_tables: &[Vec<HashMap<u32, EffectiveStaffMeter>>],
) {
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
        let staff_meters_at_measure = staff_meter_tables.get(part_index).and_then(|t| t.get(m));
        let pm = &mut part.measures[m];
        for seq in &mut pm.sequences {
            let staff = seq.staff.unwrap_or(1);
            let seq_time = staff_meters_at_measure
                .and_then(|staves| staves.get(&staff))
                .map(|effective| &effective.time_signature)
                .unwrap_or(&global_time_at[m]);
            reconcile_sequence(seq, seq_time.measure_beats(), seq_time, is_pickup_measure);
        }
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
fn reconcile_sequence(
    seq: &mut Sequence,
    expected_beats: f64,
    time_signature: &TimeSignature,
    preserve_short_measure: bool,
) {
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
        fill_with_rests(seq, diff, current, time_signature);
    } else if diff < -1e-9 {
        // Too long — trim trailing rests
        trim_trailing_rests(seq, -diff, time_signature);
    }
}

/// Append rests to fill the given number of beats.
fn fill_with_rests(
    seq: &mut Sequence,
    beats: f64,
    start_beat: f64,
    time_signature: &TimeSignature,
) {
    for duration in decompose_generated_rests(beats, start_beat, time_signature) {
        seq.content.push(SequenceContent::Event(Event {
            duration,
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
        }));
    }
}

/// Trim trailing rests to remove the given excess beats.
fn trim_trailing_rests(seq: &mut Sequence, mut excess: f64, time_signature: &TimeSignature) {
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
            let rest_start = sequence_beats(seq);
            fill_with_rests(seq, new_beats, rest_start, time_signature);
            excess = 0.0;
        }
    }
}

fn decompose_generated_rests(
    beats: f64,
    start_beat: f64,
    time_signature: &TimeSignature,
) -> Vec<Duration> {
    let meter = time_signature
        .resolve_meter()
        .expect("reconciliation requires a valid time-signature beat structure");
    let allow_dots =
        !meter.beat_structure.is_empty() && meter.beat_structure.iter().all(|group| *group == 3);
    let mut durations = Vec::new();
    let mut remaining = beats;
    let mut position = start_beat;

    while remaining > 1e-9 {
        let next_boundary = meter
            .beat_boundaries
            .iter()
            .copied()
            .find(|boundary| *boundary > position + 1e-9);
        let span = next_boundary
            .map(|boundary| (boundary - position).min(remaining))
            .unwrap_or(remaining);
        decompose_rest_span(span, allow_dots, &mut durations);
        remaining -= span;
        position += span;
    }

    durations
}

fn decompose_rest_span(beats: f64, allow_dots: bool, durations: &mut Vec<Duration>) {
    let mut remaining = beats;
    while remaining > 1e-9 {
        let base = largest_base_fitting(remaining);
        let base_beats = base.beats();
        let dots = if allow_dots && base_beats * 1.75 <= remaining + 1e-9 {
            Some(2)
        } else if allow_dots && base_beats * 1.5 <= remaining + 1e-9 {
            Some(1)
        } else {
            None
        };
        let multiplier = match dots {
            Some(2) => 1.75,
            Some(1) => 1.5,
            _ => 1.0,
        };
        durations.push(Duration { base, dots });
        remaining -= base_beats * multiplier;
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
                notehead: None,
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
        })
    }

    #[test]
    fn test_fill_short_measure() {
        let mut seq = Sequence {
            content: vec![make_event(NoteValueBase::Quarter)],
            full_measure: None,
            staff: None,
            voice: None,
            direction_hint: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        reconcile_sequence(&mut seq, 4.0, &TimeSignature::default(), false); // 4/4
        let total: f64 = seq.content.iter().map(content_beats).sum();
        assert!(
            (total - 4.0).abs() < 1e-9,
            "Expected 4 beats, got {}",
            total
        );
    }

    #[test]
    fn test_fill_non_compound_measure_splits_rests_at_beats() {
        let mut seq = Sequence {
            content: vec![],
            full_measure: None,
            staff: None,
            voice: None,
            direction_hint: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        let time = TimeSignature {
            count: 3,
            unit: 4,
            display: None,
            beat_structure: None,
            grouping_display: None,
        };

        reconcile_sequence(&mut seq, 3.0, &time, false);

        let durations: Vec<&Duration> = seq
            .content
            .iter()
            .map(|item| match item {
                SequenceContent::Event(event) => &event.duration,
                _ => panic!("reconciliation should create only rest events"),
            })
            .collect();
        assert_eq!(durations.len(), 3);
        assert!(durations.iter().all(|duration| {
            duration.base == NoteValueBase::Quarter && duration.dots.is_none()
        }));
    }

    #[test]
    fn test_fill_compound_measure_allows_dotted_rests_within_beat_groups() {
        let mut seq = Sequence {
            content: vec![],
            full_measure: None,
            staff: None,
            voice: None,
            direction_hint: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        let time = TimeSignature {
            count: 6,
            unit: 8,
            display: None,
            beat_structure: None,
            grouping_display: None,
        };

        reconcile_sequence(&mut seq, 3.0, &time, false);

        let durations: Vec<&Duration> = seq
            .content
            .iter()
            .map(|item| match item {
                SequenceContent::Event(event) => &event.duration,
                _ => panic!("reconciliation should create only rest events"),
            })
            .collect();
        assert_eq!(
            durations,
            vec![
                &Duration {
                    base: NoteValueBase::Quarter,
                    dots: Some(1),
                },
                &Duration {
                    base: NoteValueBase::Quarter,
                    dots: Some(1),
                },
            ]
        );
    }

    #[test]
    fn test_reconciliation_preserves_authored_dotted_rest() {
        let mut seq = Sequence {
            content: vec![SequenceContent::Event(Event {
                duration: Duration {
                    base: NoteValueBase::Half,
                    dots: Some(1),
                },
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
            })],
            full_measure: None,
            staff: None,
            voice: None,
            direction_hint: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        let time = TimeSignature {
            count: 3,
            unit: 4,
            display: None,
            beat_structure: None,
            grouping_display: None,
        };

        reconcile_sequence(&mut seq, 3.0, &time, false);

        let SequenceContent::Event(event) = &seq.content[0] else {
            panic!("authored rest should remain an event");
        };
        assert_eq!(seq.content.len(), 1);
        assert_eq!(event.duration.dots, Some(1));
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
            direction_hint: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        reconcile_sequence(&mut seq, 4.0, &TimeSignature::default(), false);
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
                fermata: None,
            }),
            staff: None,
            voice: None,
            direction_hint: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };
        reconcile_sequence(&mut seq, 4.0, &TimeSignature::default(), false);
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
            direction_hint: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        };

        reconcile_sequence(&mut seq, 4.0, &TimeSignature::default(), true);

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

    /// A staff carrying an effective `fitMeasure` staff-local meter must be
    /// reconciled against its own meter's duration, not the global measure's
    /// — otherwise `reconcile_score` would corrupt a correctly-written
    /// staff-local measure by padding/trimming it to the wrong length.
    #[test]
    fn test_reconcile_score_uses_staff_local_meter_duration() {
        let json = r#"{
            "mnx": {"version": 1},
            "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
            "parts": [{
                "measures": [{
                    "sequences": [
                        {
                            "staff": 1,
                            "content": [
                                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                            ]
                        },
                        {
                            "staff": 2,
                            "content": [
                                {"duration": {"base": "quarter", "dots": 1}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                                {"duration": {"base": "quarter", "dots": 1}, "notes": [{"pitch": {"step": "D", "octave": 3}}]}
                            ]
                        }
                    ],
                    "_x": {"viritura": {"staffMeters": [
                        {"staff": 2, "meter": {"count": 6, "unit": 8}, "synchronization": "fitMeasure"}
                    ]}}
                }]
            }]
        }"#;
        let mut score = crate::parse::parse_mnx(json).expect("fixture parses");
        reconcile_score(&mut score);

        let measure = &score.parts[0].measures[0];
        let staff1 = measure
            .sequences
            .iter()
            .find(|s| s.staff == Some(1))
            .unwrap();
        let staff2 = measure
            .sequences
            .iter()
            .find(|s| s.staff == Some(2))
            .unwrap();

        // Staff 1 already matches the global 2/4 duration (2 beats) — untouched.
        assert_eq!(staff1.content.len(), 2, "staff 1 should be unchanged");
        let staff1_beats: f64 = staff1.content.iter().map(content_beats).sum();
        assert!((staff1_beats - 2.0).abs() < 1e-9);

        // Staff 2 writes 2 dotted quarters (3 beats), matching its own 6/8
        // meter's duration exactly, not the global 2/4 measure's 2 beats.
        // A global-duration reconcile would incorrectly trim this staff.
        assert_eq!(
            staff2.content.len(),
            2,
            "staff 2 should stay at its own meter's duration, not be trimmed to global"
        );
        let staff2_beats: f64 = staff2.content.iter().map(content_beats).sum();
        assert!((staff2_beats - 3.0).abs() < 1e-9);
    }
}
