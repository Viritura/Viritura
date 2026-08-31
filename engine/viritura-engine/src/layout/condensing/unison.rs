#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::resolve::*;
use super::super::spacing::*;
use super::super::types::*;
use super::conflicts::*;
use super::labels::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Find the earliest beat in a measure from which all remaining note events
/// are in unison (identical rhythm, pitches, and markings) between **all**
/// active source parts.
///
/// Returns `Some(beat)` when a trailing unison section exists mid-measure,
/// or `None` when the entire measure is already unison, entirely non-unison,
/// or the parts have incompatible rhythms.
///
/// Used to place "a 2" / "a 3" / "a N" labels at the exact beat where unison
/// begins rather than deferring to the next measure boundary.
pub(crate) fn find_unison_onset_beat(part_measures: &[&PartMeasure]) -> Option<f64> {
    if part_measures.len() < 2 {
        return None;
    }

    let timelines: Vec<Vec<BeatEvent>> = part_measures
        .iter()
        .map(|pm| extract_beat_events(pm))
        .collect();

    // Filter each timeline to note events only (ignore rests for rhythm comparison)
    let active: Vec<Vec<&BeatEvent>> = timelines
        .iter()
        .map(|t| t.iter().filter(|e| e.has_notes).collect::<Vec<_>>())
        .collect();

    // All active timelines must have the same number of note events (same rhythm skeleton)
    let n = active[0].len();
    if n == 0 {
        return None;
    }
    if active.iter().any(|t| t.len() != n) {
        return None;
    }

    // Scan from end backwards to find the longest trailing section where ALL
    // sources agree on beat/duration/pitch/markings.
    let mut onset_idx = n;
    'outer: for i in (0..n).rev() {
        // Compare each source against the first
        let ref0 = active[0][i];
        for src in active.iter().skip(1) {
            let ev = src[i];
            if (ref0.beat - ev.beat).abs() > BEAT_EPSILON {
                break 'outer;
            }
            if (ref0.duration_beats - ev.duration_beats).abs() > BEAT_EPSILON {
                break 'outer;
            }
            let mut pa = ref0.pitches.clone();
            let mut pb = ev.pitches.clone();
            pa.sort_by_key(|p| p.diatonic_position());
            pb.sort_by_key(|p| p.diatonic_position());
            if pa != pb {
                break 'outer;
            }
            if ref0.markings != ev.markings {
                break 'outer;
            }
        }
        onset_idx = i;
    }

    // onset_idx == 0 → entire measure is unison (no partial onset)
    // onset_idx == n → no trailing unison found
    if onset_idx == 0 || onset_idx >= n {
        return None;
    }

    Some(active[0][onset_idx].beat)
}

/// Like `find_unison_onset_beat` but tolerates sources that **rest at the
/// start** of the measure and only enter mid-measure. A common Beethoven
/// pattern: Flute 2 rests for the first half of a bar, then joins Flute 1
/// in unison for the second half.
///
/// The onset is the latest "first note beat" across all sources. From that
/// beat onward, every source must contain an identical aligned tail of note
/// events (beats, durations, pitches, markings).
///
/// Returns `Some(beat > 0)` only when a clean partial-unison entry is found.
/// Returns `None` when:
///   - All sources start at beat 0 (use `find_unison_onset_beat` instead)
///   - Any source has no notes
///   - Tails diverge in length, position, pitch, or markings
///   - The "latest entry" source's onset doesn't align with an existing event
///     in every other source (i.e., another part is mid-note at that beat)
pub(crate) fn find_partial_unison_onset_beat(part_measures: &[&PartMeasure]) -> Option<f64> {
    if part_measures.len() < 2 {
        return None;
    }
    let timelines: Vec<Vec<BeatEvent>> = part_measures
        .iter()
        .map(|pm| extract_beat_events(pm))
        .collect();
    let active: Vec<Vec<&BeatEvent>> = timelines
        .iter()
        .map(|t| t.iter().filter(|e| e.has_notes).collect::<Vec<_>>())
        .collect();

    if active.iter().any(|t| t.is_empty()) {
        return None;
    }

    let t_onset = active.iter().map(|t| t[0].beat).fold(0.0_f64, f64::max);

    if t_onset <= BEAT_EPSILON {
        // All sources start at beat 0 — caller should use find_unison_onset_beat
        return None;
    }

    // Find each source's index of the event AT t_onset.
    let mut indices = Vec::with_capacity(active.len());
    for src in &active {
        let idx = src
            .iter()
            .position(|e| (e.beat - t_onset).abs() < BEAT_EPSILON);
        match idx {
            Some(i) => indices.push(i),
            None => return None,
        }
    }

    // Tails must have equal length.
    let tail_len = active[0].len() - indices[0];
    for (i, src) in active.iter().enumerate() {
        if src.len() - indices[i] != tail_len {
            return None;
        }
    }
    if tail_len == 0 {
        return None;
    }

    // Compare each event in the tails.
    for k in 0..tail_len {
        let ref0 = active[0][indices[0] + k];
        for (i, src) in active.iter().enumerate().skip(1) {
            let ev = src[indices[i] + k];
            if (ref0.beat - ev.beat).abs() > BEAT_EPSILON {
                return None;
            }
            if (ref0.duration_beats - ev.duration_beats).abs() > BEAT_EPSILON {
                return None;
            }
            let mut pa = ref0.pitches.clone();
            let mut pb = ev.pitches.clone();
            pa.sort_by_key(|p| p.diatonic_position());
            pb.sort_by_key(|p| p.diatonic_position());
            if pa != pb {
                return None;
            }
            if ref0.markings != ev.markings {
                return None;
            }
        }
    }

    Some(t_onset)
}
