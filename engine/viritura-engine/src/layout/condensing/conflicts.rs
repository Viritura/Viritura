#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::resolve::*;
use super::super::spacing::*;
use super::super::types::*;
use super::labels::*;
use super::unison::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

// ═══════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════

/// An event at a specific beat position, extracted from a sequence.
#[derive(Debug, Clone)]
pub(super) struct BeatEvent {
    pub(super) beat: f64,
    pub(super) duration_beats: f64,
    pub(super) has_notes: bool,
    pub(super) pitches: Vec<Pitch>,
    pub(super) markings: Option<Markings>,
    /// Number of slurs starting on this event
    pub(super) slur_count: usize,
}

pub(super) const BEAT_EPSILON: f64 = 1e-9;

/// Extract a timeline of beat events from a PartMeasure's sequences.
pub(super) fn extract_beat_events(pm: &PartMeasure) -> Vec<BeatEvent> {
    let mut events = Vec::new();
    for seq in &pm.sequences {
        let mut beat = 0.0;
        for content in &seq.content {
            match content {
                SequenceContent::Event(ev) => {
                    let dur = ev.duration.total_beats();
                    let pitches = ev
                        .notes
                        .as_ref()
                        .map(|n| n.iter().map(|note| note.pitch.clone()).collect::<Vec<_>>())
                        .unwrap_or_default();
                    let slur_count = ev.slurs.as_ref().map_or(0, |s| s.len());
                    events.push(BeatEvent {
                        beat,
                        duration_beats: dur,
                        has_notes: !pitches.is_empty(),
                        pitches,
                        markings: ev.markings.clone(),
                        slur_count,
                    });
                    beat += dur;
                }
                SequenceContent::Space(sp) => {
                    beat += sp.total_beats();
                }
                SequenceContent::Tuplet(tuplet) => {
                    // Walk tuplet contents, adjust beat positions by tuplet ratio
                    let outer_beats =
                        tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                    let inner_beats =
                        tuplet.inner.duration.total_beats() * tuplet.inner.multiple as f64;
                    let ratio = if inner_beats > 0.0 {
                        outer_beats / inner_beats
                    } else {
                        1.0
                    };
                    for tc in &tuplet.content {
                        if let SequenceContent::Event(ev) = tc {
                            let dur = ev.duration.total_beats() * ratio;
                            let pitches = ev
                                .notes
                                .as_ref()
                                .map(|n| {
                                    n.iter().map(|note| note.pitch.clone()).collect::<Vec<_>>()
                                })
                                .unwrap_or_default();
                            let slur_count = ev.slurs.as_ref().map_or(0, |s| s.len());
                            events.push(BeatEvent {
                                beat,
                                duration_beats: dur,
                                has_notes: !pitches.is_empty(),
                                pitches,
                                markings: ev.markings.clone(),
                                slur_count,
                            });
                            beat += dur;
                        }
                    }
                }
                _ => {}
            }
        }
    }
    // Sort by beat position
    events.sort_by(|a, b| {
        a.beat
            .partial_cmp(&b.beat)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    events
}

/// Check if two timelines have the same rhythm (same beat positions and durations).
pub(super) fn rhythms_match(a: &[BeatEvent], b: &[BeatEvent]) -> bool {
    // Filter to note events only (ignore rests for rhythm comparison)
    let a_notes: Vec<&BeatEvent> = a.iter().filter(|e| e.has_notes).collect();
    let b_notes: Vec<&BeatEvent> = b.iter().filter(|e| e.has_notes).collect();

    if a_notes.len() != b_notes.len() {
        return false;
    }

    for (ea, eb) in a_notes.iter().zip(b_notes.iter()) {
        if (ea.beat - eb.beat).abs() > BEAT_EPSILON {
            return false;
        }
        if (ea.duration_beats - eb.duration_beats).abs() > BEAT_EPSILON {
            return false;
        }
    }
    true
}

/// Check if two timelines have identical pitches at each beat position.
pub(super) fn pitches_identical(a: &[BeatEvent], b: &[BeatEvent]) -> bool {
    let a_notes: Vec<&BeatEvent> = a.iter().filter(|e| e.has_notes).collect();
    let b_notes: Vec<&BeatEvent> = b.iter().filter(|e| e.has_notes).collect();

    if a_notes.len() != b_notes.len() {
        return false;
    }

    for (ea, eb) in a_notes.iter().zip(b_notes.iter()) {
        if (ea.beat - eb.beat).abs() > BEAT_EPSILON {
            return false;
        }
        // Compare sorted pitch lists
        let mut pa = ea.pitches.clone();
        let mut pb = eb.pitches.clone();
        pa.sort_by_key(|p| p.diatonic_position());
        pb.sort_by_key(|p| p.diatonic_position());
        if pa != pb {
            return false;
        }
    }
    true
}

/// Check if per-event markings (articulations) match between two timelines.
pub(super) fn event_markings_match(a: &[BeatEvent], b: &[BeatEvent]) -> bool {
    let a_notes: Vec<&BeatEvent> = a.iter().filter(|e| e.has_notes).collect();
    let b_notes: Vec<&BeatEvent> = b.iter().filter(|e| e.has_notes).collect();

    if a_notes.len() != b_notes.len() {
        return false;
    }

    for (ea, eb) in a_notes.iter().zip(b_notes.iter()) {
        if (ea.beat - eb.beat).abs() > BEAT_EPSILON {
            return false;
        }
        // Compare markings — both None is OK, both identical is OK
        if ea.markings != eb.markings {
            return false;
        }
    }
    true
}

/// Check if two part-measures have conflicting dynamics.
pub(super) fn dynamics_conflict(a: &PartMeasure, b: &PartMeasure) -> bool {
    let a_dyn = a.dynamics.as_ref();
    let b_dyn = b.dynamics.as_ref();
    match (a_dyn, b_dyn) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(ad), Some(bd)) => {
            if ad.len() != bd.len() {
                return true;
            }
            // Compare complete authored dynamic-group semantics, excluding IDs.
            for (da, db) in ad.iter().zip(bd.iter()) {
                if !da.same_semantics(db) {
                    return true;
                }
            }
            false
        }
    }
}

/// Check if two part-measures have conflicting text expressions.
pub(super) fn expressions_conflict(a: &PartMeasure, b: &PartMeasure) -> bool {
    let a_exp = a.expressions.as_ref();
    let b_exp = b.expressions.as_ref();
    match (a_exp, b_exp) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(ae), Some(be)) => {
            if ae.len() != be.len() {
                return true;
            }
            for (ea, eb) in ae.iter().zip(be.iter()) {
                if ea.text != eb.text {
                    return true;
                }
            }
            false
        }
    }
}

/// Check if two timelines have conflicting slur patterns.
/// Different slur start counts at any beat position → conflict.
pub(super) fn slurs_conflict(a: &[BeatEvent], b: &[BeatEvent]) -> bool {
    let a_notes: Vec<&BeatEvent> = a.iter().filter(|e| e.has_notes).collect();
    let b_notes: Vec<&BeatEvent> = b.iter().filter(|e| e.has_notes).collect();

    if a_notes.len() != b_notes.len() {
        return false; // rhythm mismatch handled elsewhere
    }

    for (ea, eb) in a_notes.iter().zip(b_notes.iter()) {
        if (ea.beat - eb.beat).abs() > BEAT_EPSILON {
            return false;
        }
        if ea.slur_count != eb.slur_count {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::clef::RhythmicPosition;
    use crate::model::direction::{
        DynamicGroup, DynamicGroupType, DynamicValue, MeasureRhythmicPosition, TextExpression,
        WedgeType,
    };
    use crate::model::duration::{Duration, NoteValueBase};
    use crate::model::event::{
        Accent, Event, Note, OrnamentType, Rest, Sequence, SequenceContent, Slur, Staccato,
        Tremolo, Trill, Tuplet, TupletDuration,
    };
    use crate::model::measure::PartMeasure;
    use crate::model::pitch::Pitch;

    fn make_note_event(step: &str, octave: i32, base: NoteValueBase) -> Event {
        Event {
            duration: Duration { base, dots: None },
            id: None,
            notes: Some(vec![Note {
                pitch: Pitch {
                    step: step.to_string(),
                    octave,
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
                source_note_index: None,
                source_event_id: None,
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
        }
    }

    fn make_rest_event(base: NoteValueBase) -> Event {
        Event {
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
        }
    }

    fn make_pm(events: Vec<Event>) -> PartMeasure {
        PartMeasure {
            sequences: vec![Sequence {
                content: events.into_iter().map(SequenceContent::Event).collect(),
                full_measure: None,
                staff: None,
                voice: None,
                orient: None,
                forced_stem_up: None,
                source_part_index: None,
                source_seq_index: None,
            }],
            clefs: None,
            arpeggios: None,
            non_arpeggios: None,
            beams: None,
            dynamics: None,
            ottavas: None,
            measure_repeat: None,
            pedals: None,
            chord_symbols: None,
            expressions: None,
            condensing_override: None,
        }
    }

    fn make_dynamic(value: DynamicValue) -> DynamicGroup {
        DynamicGroup {
            id: uuid::Uuid::now_v7().to_string(),
            group_type: DynamicGroupType::Immediate,
            position: RhythmicPosition { fraction: (0, 1) },
            value: Some(value),
            residual_value: None,
            accent_prefix: None,
            accent_suffix: None,
            end: None,
            glyphs: None,
            orient: None,
            prefix: None,
            relative_value: None,
            staff: None,
            staff_end: None,
            suffix: None,
            visually_continues: None,
            voice: None,
            wedge_type: None,
            placement_above: None,
            source_part_index: None,
            manual_offset: None,
            avoid_collisions: None,
        }
    }

    fn make_hairpin(wedge_type: WedgeType) -> DynamicGroup {
        DynamicGroup {
            group_type: DynamicGroupType::Gradual,
            end: Some(MeasureRhythmicPosition {
                measure: String::new(),
                position: RhythmicPosition { fraction: (2, 1) },
            }),
            wedge_type: Some(wedge_type),
            value: None,
            ..make_dynamic(DynamicValue::Mf)
        }
    }

    #[test]
    fn test_identical_notes_is_a2() {
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_same_rhythm_different_pitches_is_amalgamate() {
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Amalgamate);
    }

    #[test]
    fn test_different_rhythms_is_divisi() {
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Half),
            make_note_event("D", 5, NoteValueBase::Half),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_one_source_resting_is_solo() {
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Solo(0));
    }

    #[test]
    fn test_second_source_solo() {
        let pm_a = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        let pm_b = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Solo(1));
    }

    #[test]
    fn test_all_rest() {
        let pm_a = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        let pm_b = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::AllRest);
    }

    #[test]
    fn test_same_notes_different_articulations_is_divisi() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            staccato: Some(Staccato::default()),
            ..Default::default()
        });
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_b.markings = Some(Markings {
            accent: Some(Accent::default()),
            ..Default::default()
        });
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_conflicting_dynamics_is_divisi() {
        let pm_a = PartMeasure {
            sequences: vec![Sequence {
                content: vec![SequenceContent::Event(make_note_event(
                    "C",
                    5,
                    NoteValueBase::Whole,
                ))],
                full_measure: None,
                staff: None,
                voice: None,
                orient: None,
                forced_stem_up: None,
                source_part_index: None,
                source_seq_index: None,
            }],
            clefs: None,
            arpeggios: None,
            non_arpeggios: None,
            beams: None,
            dynamics: Some(vec![make_dynamic(DynamicValue::F)]),
            ottavas: None,
            measure_repeat: None,
            pedals: None,
            chord_symbols: None,
            expressions: None,
            condensing_override: None,
        };
        let pm_b = PartMeasure {
            sequences: vec![Sequence {
                content: vec![SequenceContent::Event(make_note_event(
                    "C",
                    5,
                    NoteValueBase::Whole,
                ))],
                full_measure: None,
                staff: None,
                voice: None,
                orient: None,
                forced_stem_up: None,
                source_part_index: None,
                source_seq_index: None,
            }],
            clefs: None,
            arpeggios: None,
            non_arpeggios: None,
            beams: None,
            dynamics: Some(vec![make_dynamic(DynamicValue::P)]),
            ottavas: None,
            measure_repeat: None,
            pedals: None,
            chord_symbols: None,
            expressions: None,
            condensing_override: None,
        };
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_player_label_text() {
        assert_eq!(PlayerLabel::A(2).text(), Some("a 2".to_string()));
        assert_eq!(PlayerLabel::Plus(2).text(), Some("+2".to_string()));
        assert_eq!(PlayerLabel::Solo(1).text(), Some("1.".to_string()));
        assert_eq!(PlayerLabel::None.text(), None);
    }

    #[test]
    fn test_empty_sources() {
        assert_eq!(analyze_merge_mode(&[]), MergeMode::AllRest);
    }

    #[test]
    fn test_single_source() {
        let pm = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm]), MergeMode::Solo(0));
    }

    #[test]
    fn test_label_for_mode_all_variants() {
        // Unison always gets "a N" label regardless of previous mode
        assert_eq!(
            label_for_mode(&MergeMode::Unison, 2, None),
            PlayerLabel::A(2)
        );
        assert_eq!(
            label_for_mode(&MergeMode::Unison, 3, None),
            PlayerLabel::A(3)
        );
        // Amalgamate never gets "a N" — the chord notation already shows both
        // players are active. Only gets +N when returning from Solo.
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 2, None),
            PlayerLabel::None
        );
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 2, Some(&MergeMode::AllRest)),
            PlayerLabel::None
        );
        // Amalgamate gets +N when previous mode was Solo
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 2, Some(&MergeMode::Solo(0))),
            PlayerLabel::Plus(2)
        );
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 2, Some(&MergeMode::Unison)),
            PlayerLabel::None
        );
        // Solo labels
        assert_eq!(
            label_for_mode(&MergeMode::Solo(0), 2, None),
            PlayerLabel::Solo(1)
        );
        assert_eq!(
            label_for_mode(&MergeMode::Solo(1), 2, None),
            PlayerLabel::Solo(2)
        );
        // Divisi and AllRest never get labels
        assert_eq!(
            label_for_mode(&MergeMode::Divisi, 2, None),
            PlayerLabel::None
        );
        assert_eq!(
            label_for_mode(&MergeMode::AllRest, 2, None),
            PlayerLabel::None
        );
    }

    #[test]
    fn test_same_notes_same_markings_is_unison() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            staccato: Some(Staccato::default()),
            ..Default::default()
        });
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_b.markings = Some(Markings {
            staccato: Some(Staccato::default()),
            ..Default::default()
        });
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_both_rest_all_rest() {
        let pm_a = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        let pm_b = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::AllRest);
    }

    #[test]
    fn test_unison_onset_full_unison_returns_none() {
        // Entire measure is unison → no partial onset
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(find_unison_onset_beat(&[&pm_a, &pm_b]), None);
    }

    #[test]
    fn test_unison_onset_no_unison_returns_none() {
        // No unison at all → None
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(find_unison_onset_beat(&[&pm_a, &pm_b]), None);
    }

    #[test]
    fn test_unison_onset_trailing_unison() {
        // First two events differ, last two identical → onset at beat 2.0
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let onset = find_unison_onset_beat(&[&pm_a, &pm_b]);
        assert!(onset.is_some());
        assert!((onset.unwrap() - 2.0).abs() < 1e-9);
    }

    #[test]
    fn test_unison_onset_last_event_only() {
        // Only last event matches → onset at beat 3.0
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
            make_note_event("B", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let onset = find_unison_onset_beat(&[&pm_a, &pm_b]);
        assert!(onset.is_some());
        assert!((onset.unwrap() - 3.0).abs() < 1e-9);
    }

    // ═══════════════════════════════════════════════════
    // Gradual dynamic conflict tests
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_matching_hairpins_not_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![make_hairpin(WedgeType::Increasing)]);
        let mut pm_b = make_pm(vec![make_note_event("E", 5, NoteValueBase::Whole)]);
        pm_b.dynamics = Some(vec![make_hairpin(WedgeType::Increasing)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Amalgamate);
    }

    #[test]
    fn test_conflicting_hairpin_types_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![make_hairpin(WedgeType::Increasing)]);
        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_b.dynamics = Some(vec![make_hairpin(WedgeType::Decreasing)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_one_part_has_hairpin_other_does_not_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![make_hairpin(WedgeType::Increasing)]);
        let pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_different_hairpin_counts_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![
            make_hairpin(WedgeType::Increasing),
            make_hairpin(WedgeType::Decreasing),
        ]);
        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_b.dynamics = Some(vec![make_hairpin(WedgeType::Increasing)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    // ═══════════════════════════════════════════════════
    // Expression conflict tests
    // ═══════════════════════════════════════════════════

    fn make_expression(text: &str) -> TextExpression {
        TextExpression {
            text: text.to_string(),
            position: RhythmicPosition { fraction: (0, 1) },
            placement: None,
            staff: None,
            voice: None,
            source_part_index: None,
            source_expression_index: None,
            manual_offset: None,
            avoid_collisions: None,
        }
    }

    #[test]
    fn test_matching_expressions_not_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.expressions = Some(vec![make_expression("dolce")]);
        let mut pm_b = make_pm(vec![make_note_event("E", 5, NoteValueBase::Whole)]);
        pm_b.expressions = Some(vec![make_expression("dolce")]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Amalgamate);
    }

    #[test]
    fn test_conflicting_expression_text_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.expressions = Some(vec![make_expression("dolce")]);
        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_b.expressions = Some(vec![make_expression("marcato")]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_one_part_has_expression_other_does_not_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.expressions = Some(vec![make_expression("dolce")]);
        let pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_different_expression_counts_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.expressions = Some(vec![make_expression("dolce"), make_expression("cresc.")]);
        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_b.expressions = Some(vec![make_expression("dolce")]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    // ═══════════════════════════════════════════════════
    // Label-for-mode edge cases
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_label_amalgamate_after_divisi_no_label() {
        // Amalgamate continuing from Divisi → no label (not a mode that needs announcement)
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 2, Some(&MergeMode::Divisi)),
            PlayerLabel::None
        );
    }

    #[test]
    fn test_label_amalgamate_after_amalgamate_no_label() {
        // No change in mode → no label
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 2, Some(&MergeMode::Amalgamate)),
            PlayerLabel::None
        );
    }

    #[test]
    fn test_label_unison_always_shows_regardless_of_prev() {
        // Unison should always show "a N" label, regardless of previous mode
        for prev in [
            None,
            Some(MergeMode::AllRest),
            Some(MergeMode::Solo(0)),
            Some(MergeMode::Amalgamate),
            Some(MergeMode::Divisi),
            Some(MergeMode::Unison),
        ] {
            assert_eq!(
                label_for_mode(&MergeMode::Unison, 2, prev.as_ref()),
                PlayerLabel::A(2),
                "Unison should always produce A(2), but failed with prev_mode: {prev:?}"
            );
        }
    }

    #[test]
    fn test_label_solo_index_mapping() {
        // Solo(0) → "1.", Solo(1) → "2.", Solo(2) → "3."
        assert_eq!(
            label_for_mode(&MergeMode::Solo(0), 3, None),
            PlayerLabel::Solo(1)
        );
        assert_eq!(
            label_for_mode(&MergeMode::Solo(1), 3, None),
            PlayerLabel::Solo(2)
        );
        assert_eq!(
            label_for_mode(&MergeMode::Solo(2), 3, None),
            PlayerLabel::Solo(3)
        );
    }

    #[test]
    fn test_label_large_source_count() {
        assert_eq!(PlayerLabel::A(8).text(), Some("a 8".to_string()));
        assert_eq!(PlayerLabel::Plus(5).text(), Some("+5".to_string()));
        assert_eq!(PlayerLabel::Solo(10).text(), Some("10.".to_string()));
    }

    #[test]
    fn test_label_amalgamate_after_solo_shows_plus() {
        // After solo player returns, amalgamate gets +N
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 3, Some(&MergeMode::Solo(0))),
            PlayerLabel::Plus(3)
        );
        assert_eq!(
            label_for_mode(&MergeMode::Amalgamate, 3, Some(&MergeMode::Solo(1))),
            PlayerLabel::Plus(3)
        );
    }

    // ═══════════════════════════════════════════════════
    // Tuplet condensing tests
    // ═══════════════════════════════════════════════════

    fn make_tuplet_pm(
        tuplet_pitches: Vec<(&str, i32)>,
        outer_base: NoteValueBase,
        inner_base: NoteValueBase,
        inner_mult: u32,
        outer_mult: u32,
    ) -> PartMeasure {
        let inner_base_for_dur = inner_base.clone();
        let content: Vec<SequenceContent> = tuplet_pitches
            .into_iter()
            .map(|(step, oct)| {
                SequenceContent::Event(make_note_event(step, oct, inner_base.clone()))
            })
            .collect();
        PartMeasure {
            sequences: vec![Sequence {
                content: vec![SequenceContent::Tuplet(Tuplet {
                    inner: TupletDuration {
                        duration: Duration {
                            base: inner_base_for_dur,
                            dots: None,
                        },
                        multiple: inner_mult,
                    },
                    outer: TupletDuration {
                        duration: Duration {
                            base: outer_base,
                            dots: None,
                        },
                        multiple: outer_mult,
                    },
                    content,
                    bracket: None,
                    show_number: None,
                    show_value: None,
                    orient: None,
                    staff: None,
                })],
                full_measure: None,
                staff: None,
                voice: None,
                orient: None,
                forced_stem_up: None,
                source_part_index: None,
                source_seq_index: None,
            }],
            clefs: None,
            arpeggios: None,
            non_arpeggios: None,
            beams: None,
            dynamics: None,
            ottavas: None,
            measure_repeat: None,
            pedals: None,
            chord_symbols: None,
            expressions: None,
            condensing_override: None,
        }
    }

    #[test]
    fn test_tuplets_identical_pitches_is_unison() {
        // 3:2 eighth-note triplet, both parts play C D E
        let pm_a = make_tuplet_pm(
            vec![("C", 5), ("D", 5), ("E", 5)],
            NoteValueBase::Eighth,
            NoteValueBase::Eighth,
            3,
            2,
        );
        let pm_b = make_tuplet_pm(
            vec![("C", 5), ("D", 5), ("E", 5)],
            NoteValueBase::Eighth,
            NoteValueBase::Eighth,
            3,
            2,
        );
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_tuplets_different_pitches_is_amalgamate() {
        // Same triplet rhythm, different pitches
        let pm_a = make_tuplet_pm(
            vec![("C", 5), ("D", 5), ("E", 5)],
            NoteValueBase::Eighth,
            NoteValueBase::Eighth,
            3,
            2,
        );
        let pm_b = make_tuplet_pm(
            vec![("E", 5), ("F", 5), ("G", 5)],
            NoteValueBase::Eighth,
            NoteValueBase::Eighth,
            3,
            2,
        );
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Amalgamate);
    }

    #[test]
    fn test_tuplet_vs_regular_notes_is_divisi() {
        // One part plays a triplet, the other plays regular quarters
        let pm_a = make_tuplet_pm(
            vec![("C", 5), ("D", 5), ("E", 5)],
            NoteValueBase::Eighth,
            NoteValueBase::Eighth,
            3,
            2,
        );
        let pm_b = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    // ═══════════════════════════════════════════════════
    // Mixed rest/note pattern tests
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_notes_with_interspersed_rests_same_rhythm_is_unison() {
        // Both parts play note-rest-note with same pitches
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_rest_event(NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_rest_event(NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_rest_event(NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_rest_event(NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_rests_at_different_positions_with_misaligned_notes_is_divisi() {
        // Rests shift note beats → notes no longer align → divisi
        // Part A: half(0-2), rest(2-3), quarter(3-4) → notes at beats 0.0, 3.0
        // Part B: half(0-2), quarter(2-3), rest(3-4) → notes at beats 0.0, 2.0
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Half),
            make_rest_event(NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Half),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_rest_event(NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_one_note_one_rest_measure_note_part_is_solo() {
        // Part A: single quarter note + rests, Part B: all rests
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_rest_event(NoteValueBase::Quarter),
            make_rest_event(NoteValueBase::Half),
        ]);
        let pm_b = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Solo(0));
    }

    // ═══════════════════════════════════════════════════
    // Unison onset edge cases
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_unison_onset_single_part_returns_none() {
        let pm = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        assert_eq!(find_unison_onset_beat(&[&pm]), None);
    }

    #[test]
    fn test_unison_onset_all_rests_returns_none() {
        let pm_a = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        let pm_b = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        assert_eq!(find_unison_onset_beat(&[&pm_a, &pm_b]), None);
    }

    #[test]
    fn test_unison_onset_different_event_counts_returns_none() {
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Half),
            make_note_event("D", 5, NoteValueBase::Half),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Half),
        ]);
        assert_eq!(find_unison_onset_beat(&[&pm_a, &pm_b]), None);
    }

    #[test]
    fn test_unison_onset_different_markings_break_unison() {
        // First 2 events differ in pitch, last 2 have same pitch but different markings
        let mut ev_e_staccato = make_note_event("E", 5, NoteValueBase::Quarter);
        ev_e_staccato.markings = Some(Markings {
            staccato: Some(Staccato::default()),
            ..Default::default()
        });

        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            ev_e_staccato,
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter), // same pitch, no markings
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        // Only last event (F) is truly unison → onset at beat 3.0
        let onset = find_unison_onset_beat(&[&pm_a, &pm_b]);
        assert!(onset.is_some());
        assert!((onset.unwrap() - 3.0).abs() < 1e-9);
    }

    #[test]
    fn test_unison_onset_half_note_beats() {
        // Half notes: first differs, second matches → onset at beat 2.0
        let pm_a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Half),
            make_note_event("E", 5, NoteValueBase::Half),
        ]);
        let pm_b = make_pm(vec![
            make_note_event("G", 5, NoteValueBase::Half),
            make_note_event("E", 5, NoteValueBase::Half),
        ]);
        let onset = find_unison_onset_beat(&[&pm_a, &pm_b]);
        assert!(onset.is_some());
        assert!((onset.unwrap() - 2.0).abs() < 1e-9);
    }

    // ═══════════════════════════════════════════════════
    // Combined conflict scenarios
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_matching_dynamics_and_hairpins_allows_amalgamate() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![
            make_dynamic(DynamicValue::F),
            make_hairpin(WedgeType::Increasing),
        ]);

        let mut pm_b = make_pm(vec![make_note_event("E", 5, NoteValueBase::Whole)]);
        pm_b.dynamics = Some(vec![
            make_dynamic(DynamicValue::F),
            make_hairpin(WedgeType::Increasing),
        ]);

        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Amalgamate);
    }

    #[test]
    fn test_matching_dynamics_conflicting_hairpins_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![
            make_dynamic(DynamicValue::F),
            make_hairpin(WedgeType::Increasing),
        ]);

        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_b.dynamics = Some(vec![
            make_dynamic(DynamicValue::F),
            make_hairpin(WedgeType::Decreasing),
        ]);

        // Same dynamics but conflicting hairpins → divisi
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_dynamics_conflict_short_circuits_before_expression_check() {
        // Even if expressions match, conflicting dynamics should force divisi
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![make_dynamic(DynamicValue::Ff)]);
        pm_a.expressions = Some(vec![make_expression("dolce")]);

        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_b.dynamics = Some(vec![make_dynamic(DynamicValue::Pp)]);
        pm_b.expressions = Some(vec![make_expression("dolce")]);

        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    // ═══════════════════════════════════════════════════
    // Multi-note chord tests
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_chord_unison_both_parts_same_double_stop() {
        // Both parts play C+E double stop
        let ev_a = Event {
            duration: Duration {
                base: NoteValueBase::Whole,
                dots: None,
            },
            id: None,
            notes: Some(vec![
                Note {
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
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
                Note {
                    pitch: Pitch {
                        step: "E".to_string(),
                        octave: 5,
                        alter: None,
                    },
                    id: None,
                    ties: None,
                    accidental_display: None,
                    written: None,
                    staff: None,
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
            ]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        };
        let ev_b = Event {
            duration: Duration {
                base: NoteValueBase::Whole,
                dots: None,
            },
            id: None,
            notes: Some(vec![
                Note {
                    pitch: Pitch {
                        step: "E".to_string(),
                        octave: 5,
                        alter: None,
                    },
                    id: None,
                    ties: None,
                    accidental_display: None,
                    written: None,
                    staff: None,
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
                Note {
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
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
            ]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        };
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        // Same pitches (order doesn't matter — sorted by diatonic position) → Unison
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_chord_different_pitches_is_amalgamate() {
        // Part A: C+E, Part B: D+F
        let ev_a = Event {
            duration: Duration {
                base: NoteValueBase::Whole,
                dots: None,
            },
            id: None,
            notes: Some(vec![
                Note {
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
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
                Note {
                    pitch: Pitch {
                        step: "E".to_string(),
                        octave: 5,
                        alter: None,
                    },
                    id: None,
                    ties: None,
                    accidental_display: None,
                    written: None,
                    staff: None,
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
            ]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        };
        let ev_b = Event {
            duration: Duration {
                base: NoteValueBase::Whole,
                dots: None,
            },
            id: None,
            notes: Some(vec![
                Note {
                    pitch: Pitch {
                        step: "D".to_string(),
                        octave: 5,
                        alter: None,
                    },
                    id: None,
                    ties: None,
                    accidental_display: None,
                    written: None,
                    staff: None,
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
                Note {
                    pitch: Pitch {
                        step: "F".to_string(),
                        octave: 5,
                        alter: None,
                    },
                    id: None,
                    ties: None,
                    accidental_display: None,
                    written: None,
                    staff: None,
                    source_part_index: None,
                    kit_component: None,
                    perform: None,
                    source_note_index: None,
                    source_event_id: None,
                },
            ]),
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        };
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Amalgamate);
    }

    // ═══════════════════════════════════════════════════
    // Enharmonic / octave difference tests
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_same_note_different_octave_is_amalgamate() {
        let pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        let pm_b = make_pm(vec![make_note_event("C", 4, NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Amalgamate);
    }

    // ═══════════════════════════════════════════════════
    // Dynamics edge cases
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_both_no_dynamics_allows_unison() {
        let pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        let pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        // No dynamics on either → no conflict
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_matching_dynamics_allows_unison() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![make_dynamic(DynamicValue::Mf)]);
        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_b.dynamics = Some(vec![make_dynamic(DynamicValue::Mf)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_parallel_dynamic_chains_with_source_local_ids_allow_unison() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        let start_a = make_dynamic(DynamicValue::P);
        let mut hairpin_a = make_hairpin(WedgeType::Increasing);
        hairpin_a.visually_continues = Some(start_a.id.clone());
        pm_a.dynamics = Some(vec![start_a, hairpin_a]);

        let mut pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        let start_b = make_dynamic(DynamicValue::P);
        let mut hairpin_b = make_hairpin(WedgeType::Increasing);
        hairpin_b.visually_continues = Some(start_b.id.clone());
        pm_b.dynamics = Some(vec![start_b, hairpin_b]);

        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);

        pm_b.dynamics.as_mut().unwrap()[1].visually_continues = None;
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_one_part_has_dynamics_other_does_not_is_divisi() {
        let mut pm_a = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        pm_a.dynamics = Some(vec![make_dynamic(DynamicValue::F)]);
        let pm_b = make_pm(vec![make_note_event("C", 5, NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    // ═══════════════════════════════════════════════════
    // Slur conflict tests
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_matching_slurs_allows_unison() {
        // Both parts have a slur starting on the same event → no conflict
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Half);
        ev_a.slurs = Some(vec![Slur {
            target: "ev2".to_string(),
            side: None,
            side_end: None,
            line_type: None,
            start_note: None,
            end_note: None,
            shape: None,
        }]);
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Half);
        ev_b.slurs = Some(vec![Slur {
            target: "ev2".to_string(),
            side: None,
            side_end: None,
            line_type: None,
            start_note: None,
            end_note: None,
            shape: None,
        }]);
        let pm_a = make_pm(vec![ev_a, make_note_event("D", 5, NoteValueBase::Half)]);
        let pm_b = make_pm(vec![ev_b, make_note_event("D", 5, NoteValueBase::Half)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_one_part_has_slur_other_does_not_is_divisi() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Half);
        ev_a.slurs = Some(vec![Slur {
            target: "ev2".to_string(),
            side: None,
            side_end: None,
            line_type: None,
            start_note: None,
            end_note: None,
            shape: None,
        }]);
        let ev_b = make_note_event("C", 5, NoteValueBase::Half);
        let pm_a = make_pm(vec![ev_a, make_note_event("D", 5, NoteValueBase::Half)]);
        let pm_b = make_pm(vec![ev_b, make_note_event("D", 5, NoteValueBase::Half)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_different_slur_counts_at_same_beat_is_divisi() {
        // Part A has 2 slurs starting, Part B has 1
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Half);
        ev_a.slurs = Some(vec![
            Slur {
                target: "ev2".to_string(),
                side: None,
                side_end: None,
                line_type: None,
                start_note: None,
                end_note: None,
                shape: None,
            },
            Slur {
                target: "ev3".to_string(),
                side: None,
                side_end: None,
                line_type: None,
                start_note: None,
                end_note: None,
                shape: None,
            },
        ]);
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Half);
        ev_b.slurs = Some(vec![Slur {
            target: "ev2".to_string(),
            side: None,
            side_end: None,
            line_type: None,
            start_note: None,
            end_note: None,
            shape: None,
        }]);
        let pm_a = make_pm(vec![ev_a, make_note_event("D", 5, NoteValueBase::Half)]);
        let pm_b = make_pm(vec![ev_b, make_note_event("D", 5, NoteValueBase::Half)]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_slur_on_different_beats_is_divisi() {
        // Part A has slur on beat 0, Part B has slur on beat 2
        let mut ev_a1 = make_note_event("C", 5, NoteValueBase::Half);
        ev_a1.slurs = Some(vec![Slur {
            target: "ev2".to_string(),
            side: None,
            side_end: None,
            line_type: None,
            start_note: None,
            end_note: None,
            shape: None,
        }]);
        let ev_a2 = make_note_event("D", 5, NoteValueBase::Half);

        let ev_b1 = make_note_event("C", 5, NoteValueBase::Half);
        let mut ev_b2 = make_note_event("D", 5, NoteValueBase::Half);
        ev_b2.slurs = Some(vec![Slur {
            target: "ev3".to_string(),
            side: None,
            side_end: None,
            line_type: None,
            start_note: None,
            end_note: None,
            shape: None,
        }]);

        let pm_a = make_pm(vec![ev_a1, ev_a2]);
        let pm_b = make_pm(vec![ev_b1, ev_b2]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    // ═══════════════════════════════════════════════════
    // Tremolo/ornament conflict tests (via Markings equality)
    // ═══════════════════════════════════════════════════

    #[test]
    fn test_different_tremolos_is_divisi() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            tremolo: Some(Tremolo {
                marks: 2,
                orient: None,
            }),
            ..Default::default()
        });
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_b.markings = Some(Markings {
            tremolo: Some(Tremolo {
                marks: 3,
                orient: None,
            }),
            ..Default::default()
        });
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_one_part_has_tremolo_other_does_not_is_divisi() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            tremolo: Some(Tremolo {
                marks: 1,
                orient: None,
            }),
            ..Default::default()
        });
        let ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_matching_tremolos_allows_unison() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            tremolo: Some(Tremolo {
                marks: 2,
                orient: None,
            }),
            ..Default::default()
        });
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_b.markings = Some(Markings {
            tremolo: Some(Tremolo {
                marks: 2,
                orient: None,
            }),
            ..Default::default()
        });
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    #[test]
    fn test_one_part_has_trill_other_does_not_is_divisi() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            trill: Some(Trill { accidental: None }),
            ..Default::default()
        });
        let ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_different_ornaments_is_divisi() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            ornaments: Some(vec![OrnamentType::Turn]),
            ..Default::default()
        });
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_b.markings = Some(Markings {
            ornaments: Some(vec![OrnamentType::Mordent]),
            ..Default::default()
        });
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Divisi);
    }

    #[test]
    fn test_matching_ornaments_allows_unison() {
        let mut ev_a = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_a.markings = Some(Markings {
            ornaments: Some(vec![OrnamentType::Turn]),
            ..Default::default()
        });
        let mut ev_b = make_note_event("C", 5, NoteValueBase::Quarter);
        ev_b.markings = Some(Markings {
            ornaments: Some(vec![OrnamentType::Turn]),
            ..Default::default()
        });
        let pm_a = make_pm(vec![ev_a]);
        let pm_b = make_pm(vec![ev_b]);
        assert_eq!(analyze_merge_mode(&[&pm_a, &pm_b]), MergeMode::Unison);
    }

    // ───── N-way analyzer tests (3+ sources) ─────

    fn unison_quarter_run() -> PartMeasure {
        make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ])
    }

    #[test]
    fn test_three_sources_all_unison() {
        let a = unison_quarter_run();
        let b = unison_quarter_run();
        let c = unison_quarter_run();
        assert_eq!(analyze_merge_mode(&[&a, &b, &c]), MergeMode::Unison);
    }

    #[test]
    fn test_four_sources_all_unison() {
        let a = unison_quarter_run();
        let b = unison_quarter_run();
        let c = unison_quarter_run();
        let d = unison_quarter_run();
        assert_eq!(analyze_merge_mode(&[&a, &b, &c, &d]), MergeMode::Unison);
    }

    #[test]
    fn test_three_sources_one_different_pitch_is_amalgamate() {
        // Three sources share rhythm; pitches differ → Amalgamate (chord).
        let a = unison_quarter_run();
        let b = unison_quarter_run();
        let c = make_pm(vec![
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
            make_note_event("B", 5, NoteValueBase::Quarter),
            make_note_event("C", 6, NoteValueBase::Quarter),
        ]);
        assert_eq!(analyze_merge_mode(&[&a, &b, &c]), MergeMode::Amalgamate);
    }

    #[test]
    fn test_three_sources_one_different_rhythm_is_divisi() {
        let a = unison_quarter_run();
        let b = unison_quarter_run();
        let c = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Half),
            make_note_event("D", 5, NoteValueBase::Half),
        ]);
        assert_eq!(analyze_merge_mode(&[&a, &b, &c]), MergeMode::Divisi);
    }

    #[test]
    fn test_three_sources_one_solo() {
        // Two sources rest, one plays → Solo(playing index)
        let a = unison_quarter_run();
        let rest = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        assert_eq!(analyze_merge_mode(&[&rest, &a, &rest]), MergeMode::Solo(1));
    }

    #[test]
    fn test_four_sources_two_unison_one_amalgamate_one_solo_is_amalgamate() {
        // Three actively playing share rhythm but with one pitch divergence → Amalgamate.
        let a = unison_quarter_run();
        let b = unison_quarter_run();
        let c = make_pm(vec![
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
            make_note_event("B", 5, NoteValueBase::Quarter),
            make_note_event("C", 6, NoteValueBase::Quarter),
        ]);
        let rest = make_pm(vec![make_rest_event(NoteValueBase::Whole)]);
        assert_eq!(
            analyze_merge_mode(&[&a, &b, &c, &rest]),
            MergeMode::Amalgamate
        );
    }

    // ───── Label generation tests ─────

    #[test]
    fn test_label_a3_for_three_sources_unison() {
        let label = label_for_mode(&MergeMode::Unison, 3, None);
        assert_eq!(label.text(), Some("a 3".to_string()));
    }

    #[test]
    fn test_label_a4_for_four_sources_unison() {
        let label = label_for_mode(&MergeMode::Unison, 4, None);
        assert_eq!(label.text(), Some("a 4".to_string()));
    }

    #[test]
    fn test_label_first_measure_unison_emits_a2() {
        // prev_mode is None at start of score; label must still emit.
        let label = label_for_mode(&MergeMode::Unison, 2, None);
        assert_eq!(label.text(), Some("a 2".to_string()));
    }

    #[test]
    fn test_label_string_section_unison_uses_unis() {
        let label = label_for_mode_styled(&MergeMode::Unison, 2, None, LabelStyle::StringSection);
        assert_eq!(label.text(), Some("Unis.".to_string()));
    }

    #[test]
    fn test_label_string_section_amalgamate_uses_div() {
        let label =
            label_for_mode_styled(&MergeMode::Amalgamate, 2, None, LabelStyle::StringSection);
        assert_eq!(label.text(), Some("Div.".to_string()));
    }

    #[test]
    fn test_label_string_section_divisi_uses_div() {
        let label = label_for_mode_styled(&MergeMode::Divisi, 2, None, LabelStyle::StringSection);
        assert_eq!(label.text(), Some("Div.".to_string()));
    }

    #[test]
    fn test_label_string_section_solo_uses_italic_solo() {
        let label = label_for_mode_styled(&MergeMode::Solo(0), 2, None, LabelStyle::StringSection);
        assert_eq!(label.text(), Some("solo".to_string()));
    }

    #[test]
    fn test_label_string_section_suppresses_redundant_unis() {
        let label = label_for_mode_styled(
            &MergeMode::Unison,
            2,
            Some(&MergeMode::Unison),
            LabelStyle::StringSection,
        );
        assert_eq!(label.text(), None);
    }

    #[test]
    fn test_label_amalgamate_after_solo_emits_plus_n() {
        let label = label_for_mode(&MergeMode::Amalgamate, 3, Some(&MergeMode::Solo(0)));
        assert_eq!(label.text(), Some("+3".to_string()));
    }

    // ───── N-way unison onset tests ─────

    #[test]
    fn test_three_way_unison_onset() {
        // Three parts: first two beats divergent, beats 3-4 unison.
        let a = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let b = make_pm(vec![
            make_note_event("G", 4, NoteValueBase::Quarter),
            make_note_event("A", 4, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let c = make_pm(vec![
            make_note_event("E", 4, NoteValueBase::Quarter),
            make_note_event("F", 4, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let onset = find_unison_onset_beat(&[&a, &b, &c]);
        assert!(onset.is_some());
        let beat = onset.unwrap();
        assert!(
            (beat - 2.0).abs() < 1e-6,
            "expected onset at beat 2, got {beat}"
        );
    }

    #[test]
    fn test_three_way_no_trailing_unison_returns_none() {
        // Three different parts throughout → no trailing unison.
        let a = unison_quarter_run();
        let b = make_pm(vec![
            make_note_event("G", 4, NoteValueBase::Quarter),
            make_note_event("A", 4, NoteValueBase::Quarter),
            make_note_event("B", 4, NoteValueBase::Quarter),
            make_note_event("C", 5, NoteValueBase::Quarter),
        ]);
        let c = make_pm(vec![
            make_note_event("E", 4, NoteValueBase::Quarter),
            make_note_event("F", 4, NoteValueBase::Quarter),
            make_note_event("G", 4, NoteValueBase::Quarter),
            make_note_event("A", 4, NoteValueBase::Quarter),
        ]);
        assert_eq!(find_unison_onset_beat(&[&a, &b, &c]), None);
    }

    // ───── Partial unison (asymmetric note count) tests ─────

    #[test]
    fn test_partial_unison_second_voice_enters_late() {
        // Beethoven 5 m3 pattern: Fl 1 plays whole measure; Fl 2 rests beats 1-2,
        // joins beats 3-4 in unison.
        let fl1 = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let fl2 = make_pm(vec![
            make_rest_event(NoteValueBase::Half),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let onset = find_partial_unison_onset_beat(&[&fl1, &fl2]);
        assert!(onset.is_some());
        let beat = onset.unwrap();
        assert!(
            (beat - 2.0).abs() < 1e-6,
            "expected onset at beat 2, got {beat}"
        );
    }

    #[test]
    fn test_partial_unison_tails_diverge_returns_none() {
        // Fl 2 joins on beat 3 but plays different pitches → no unison
        let fl1 = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let fl2 = make_pm(vec![
            make_rest_event(NoteValueBase::Half),
            make_note_event("G", 5, NoteValueBase::Quarter),
            make_note_event("A", 5, NoteValueBase::Quarter),
        ]);
        assert_eq!(find_partial_unison_onset_beat(&[&fl1, &fl2]), None);
    }

    #[test]
    fn test_partial_unison_both_start_together_returns_none() {
        // Both start at beat 0 → use regular find_unison_onset_beat instead
        let a = unison_quarter_run();
        let b = unison_quarter_run();
        assert_eq!(find_partial_unison_onset_beat(&[&a, &b]), None);
    }

    #[test]
    fn test_partial_unison_late_entry_not_aligned_to_event_returns_none() {
        // Fl 2 enters at beat 2.5 (off-beat) while Fl 1 is mid-half-note → no clean unison
        let fl1 = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Half), // beats 0-2
            make_note_event("E", 5, NoteValueBase::Half), // beats 2-4
        ]);
        let fl2 = make_pm(vec![
            make_rest_event(NoteValueBase::Half),
            make_rest_event(NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter), // joins at beat 3 — but Fl 1's event there starts at beat 2
        ]);
        assert_eq!(find_partial_unison_onset_beat(&[&fl1, &fl2]), None);
    }

    #[test]
    fn test_partial_unison_three_way_late_entries() {
        // Hn 1 plays whole; Hn 2 enters beat 3; Hn 3 enters beat 3 — all unison from beat 3
        let hn1 = make_pm(vec![
            make_note_event("C", 5, NoteValueBase::Quarter),
            make_note_event("D", 5, NoteValueBase::Quarter),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let hn2 = make_pm(vec![
            make_rest_event(NoteValueBase::Half),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let hn3 = make_pm(vec![
            make_rest_event(NoteValueBase::Half),
            make_note_event("E", 5, NoteValueBase::Quarter),
            make_note_event("F", 5, NoteValueBase::Quarter),
        ]);
        let onset = find_partial_unison_onset_beat(&[&hn1, &hn2, &hn3]);
        assert_eq!(onset, Some(2.0));
    }
}
