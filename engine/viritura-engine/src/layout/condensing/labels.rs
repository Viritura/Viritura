#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::resolve::*;
use super::super::spacing::*;
use super::super::types::*;
use super::beam_compatibility::beam_groups_compatible;
use super::conflicts::*;
use super::unison::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Result of merge analysis for a condensed staff at a given measure.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MergeMode {
    /// All sources play identical notes with compatible markings.
    /// Render as a single voice with "a 2" (or "a N") label.
    Unison,
    /// Sources have the same rhythm but different pitches, with compatible markings.
    /// Render as a single voice with combined chords, "+N" courtesy label.
    Amalgamate,
    /// Sources have different rhythms or conflicting markings.
    /// Render as separate voices with stem up/down.
    Divisi,
    /// Only one source is active (the other(s) rest for the entire measure).
    /// Render as a single voice with solo label ("1." or "2.").
    Solo(usize), // index of the active source
    /// All sources rest for the entire measure.
    AllRest,
}

/// Style hint that the call site supplies based on instrument family.
/// Determines the label idiom used: orchestral (`a 2`, `1.`, `2.`) vs.
/// string-section (`Unis.`, `Div.`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum LabelStyle {
    /// Default orchestral idiom: `a 2`, `1.`, `2.`, `+2`.
    #[default]
    Orchestral,
    /// String-section idiom: `Unis.` for unison, `Div.` for divisi/amalgamate,
    /// `solo` (italic) when a single desk plays. Used for grouped Vln/Vla/Vc/Cb
    /// sections where the convention is to mark unison/divisi rather than
    /// stand numbers.
    StringSection,
}

/// Player label to display at the start of a condensed passage.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PlayerLabel {
    /// "a 2", "a 3", etc. — all sources in unison
    A(u32),
    /// "+2", "+3" — sources join in harmony (amalgamation)
    Plus(u32),
    /// "1.", "2." — solo player
    Solo(u32),
    /// "Unis." — string-section unison idiom
    Unis,
    /// "Div." — string-section divisi/amalgamation idiom
    Div,
    /// "Tutti" — explicit tutti marker (rare; for return from soloist passage)
    #[allow(dead_code)]
    Tutti,
    /// Solo italic ("solo") — used for soloist callouts when style requests it
    SoloItalic,
    /// No label needed (continuation of same mode)
    None,
}

impl PlayerLabel {
    /// Render the label as display text.
    pub(crate) fn text(&self) -> Option<String> {
        match self {
            PlayerLabel::A(n) => Some(format!("a {n}")),
            PlayerLabel::Plus(n) => Some(format!("+{n}")),
            PlayerLabel::Solo(n) => Some(format!("{n}.")),
            PlayerLabel::Unis => Some("Unis.".to_string()),
            PlayerLabel::Div => Some("Div.".to_string()),
            PlayerLabel::Tutti => Some("Tutti".to_string()),
            PlayerLabel::SoloItalic => Some("solo".to_string()),
            PlayerLabel::None => None,
        }
    }
}

/// Analyze the music from multiple source part-measures to determine the merge mode.
///
/// N-way correct: with 3+ sources, all pairs are compared. The merge mode is
/// the "weakest link":
///   - Unison only if every active source has identical pitches+rhythm+markings.
///   - Amalgamate only if every active source shares rhythm + compatible markings.
///   - Otherwise Divisi.
///
/// This examines:
/// - Rhythmic alignment (same beat positions, same durations)
/// - Authored beam grouping
/// - Pitch identity (unison vs different pitches)
/// - Marking compatibility (dynamics, articulations, slurs)
/// - Rest patterns (solo detection)
pub(crate) fn analyze_merge_mode(part_measures: &[&PartMeasure]) -> MergeMode {
    if part_measures.is_empty() {
        return MergeMode::AllRest;
    }
    if part_measures.len() == 1 {
        return MergeMode::Solo(0);
    }

    // Extract event timelines from each source
    let timelines: Vec<Vec<BeatEvent>> = part_measures
        .iter()
        .map(|pm| extract_beat_events(pm))
        .collect();

    // Check for all-rest sources
    let active_sources: Vec<usize> = timelines
        .iter()
        .enumerate()
        .filter(|(_, t)| t.iter().any(|be| be.has_notes))
        .map(|(i, _)| i)
        .collect();

    if active_sources.is_empty() {
        return MergeMode::AllRest;
    }
    if active_sources.len() == 1 {
        return MergeMode::Solo(active_sources[0]);
    }

    // From here at least 2 sources have notes. Compare them n-way.
    // The merge mode is the strongest relationship that ALL pairs share.
    let first = active_sources[0];
    let a = &timelines[first];

    // Pairwise: does every other active source share rhythm with `first`?
    let mut all_same_rhythm = true;
    let mut any_dynamics_conflict = false;
    let mut any_expressions_conflict = false;
    let mut any_slurs_conflict = false;
    let mut any_beams_conflict = false;
    for &idx in &active_sources[1..] {
        let other = &timelines[idx];
        if !rhythms_match(a, other) {
            all_same_rhythm = false;
            break;
        }
        if dynamics_conflict(part_measures[first], part_measures[idx]) {
            any_dynamics_conflict = true;
        }
        if expressions_conflict(part_measures[first], part_measures[idx]) {
            any_expressions_conflict = true;
        }
        if slurs_conflict(a, other) {
            any_slurs_conflict = true;
        }
        if !beam_groups_compatible(part_measures[first], part_measures[idx]) {
            any_beams_conflict = true;
        }
    }

    if !all_same_rhythm
        || any_dynamics_conflict
        || any_expressions_conflict
        || any_slurs_conflict
        || any_beams_conflict
    {
        return MergeMode::Divisi;
    }

    // All active sources share rhythm + non-conflicting per-measure directions.
    // Now compare pitches+markings pairwise to choose Unison vs Amalgamate.
    let mut all_pitches_identical = true;
    let mut all_markings_match = true;
    for &idx in &active_sources[1..] {
        let other = &timelines[idx];
        if !pitches_identical(a, other) {
            all_pitches_identical = false;
        }
        if !event_markings_match(a, other) {
            all_markings_match = false;
        }
    }

    if !all_markings_match {
        return MergeMode::Divisi;
    }
    if all_pitches_identical {
        MergeMode::Unison
    } else {
        MergeMode::Amalgamate
    }
}

/// Determine the appropriate player label for a merge mode transition.
/// `prev_mode` is the mode from the previous measure (if any), used to suppress
/// courtesy labels when they aren't needed (e.g., +N only after Solo).
#[allow(dead_code)]
pub(crate) fn label_for_mode(
    mode: &MergeMode,
    source_count: u32,
    prev_mode: Option<&MergeMode>,
) -> PlayerLabel {
    label_for_mode_styled(mode, source_count, prev_mode, LabelStyle::Orchestral)
}

/// Style-aware variant of `label_for_mode`. The caller picks the idiom based
/// on instrument family (orchestral vs. string-section). String sections
/// prefer `Unis.` / `Div.` over numbered labels.
pub(crate) fn label_for_mode_styled(
    mode: &MergeMode,
    source_count: u32,
    prev_mode: Option<&MergeMode>,
    style: LabelStyle,
) -> PlayerLabel {
    match (mode, style) {
        (MergeMode::Unison, LabelStyle::Orchestral) => PlayerLabel::A(source_count),
        (MergeMode::Unison, LabelStyle::StringSection) => {
            // Suppress redundant Unis. if we're already in unison
            match prev_mode {
                Some(MergeMode::Unison) => PlayerLabel::None,
                _ => PlayerLabel::Unis,
            }
        }
        (MergeMode::Amalgamate, LabelStyle::Orchestral) => {
            // Amalgamate = same rhythm, different pitches. The chord notation
            // already shows both players are active, so "a N" is only needed
            // when returning from Solo (courtesy "+N").
            match prev_mode {
                Some(MergeMode::Solo(_)) => PlayerLabel::Plus(source_count),
                _ => PlayerLabel::None,
            }
        }
        (MergeMode::Amalgamate, LabelStyle::StringSection) => {
            // For string sections, amalgamation prints as Div. on first entry
            match prev_mode {
                Some(MergeMode::Amalgamate) | Some(MergeMode::Divisi) => PlayerLabel::None,
                _ => PlayerLabel::Div,
            }
        }
        (MergeMode::Divisi, LabelStyle::StringSection) => match prev_mode {
            Some(MergeMode::Divisi) | Some(MergeMode::Amalgamate) => PlayerLabel::None,
            _ => PlayerLabel::Div,
        },
        (MergeMode::Solo(idx), LabelStyle::Orchestral) => PlayerLabel::Solo(*idx as u32 + 1),
        (MergeMode::Solo(_), LabelStyle::StringSection) => {
            // For string sections, a single desk = "solo" in italic
            match prev_mode {
                Some(MergeMode::Solo(_)) => PlayerLabel::None,
                _ => PlayerLabel::SoloItalic,
            }
        }
        (MergeMode::Divisi, LabelStyle::Orchestral) => PlayerLabel::None,
        (MergeMode::AllRest, _) => PlayerLabel::None,
    }
}
