//! Per-measure rest profiles and turn-window analysis.
//!
//! Stage 1 of the page-turn pipeline (see `docs/plans/auto-page-breaks.md`):
//! convert the score's musical content at each potential page boundary into a
//! "how many seconds of rest does the player get to turn the page" figure,
//! tempo-aware and conservative.
//!
//! Analysis is **single-line**: a boundary is restful only when *every* voice
//! of the part is silent across it. We deliberately do NOT try to be clever
//! about one hand being free on a grand staff.

use crate::layout::page_turn::config::PageTurnConfig;
use crate::layout::page_turn::tempo::TempoMap;
use crate::model::event::{Sequence, SequenceContent};
use crate::model::measure::PartMeasure;

/// Rest/timing summary of a single written measure, voice-combined.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MeasureProfile {
    /// Total notated length of the measure in quarter beats.
    pub total_beats: f64,
    /// Silent beats from the measure start until the first sounding event in
    /// any voice (0 if the measure begins with sound).
    pub leading_rest_beats: f64,
    /// Silent beats from the last sounding event in any voice to the measure
    /// end (0 if the measure ends with sound).
    pub trailing_rest_beats: f64,
    /// Whether every voice rests for the whole measure.
    pub is_full_rest: bool,
    /// Whether any event in the measure carries a fermata.
    pub has_fermata: bool,
    /// Whether the measure carries a caesura or breath mark.
    pub has_caesura: bool,
}

/// Coarse turn-quality band derived from the available seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnQuality {
    /// Ample time — a relaxed turn (cost ≈ 0).
    Comfortable,
    /// Quick but doable — *volti subito* band.
    Vs,
    /// Below the V.S. band but still nonzero — a desperation turn.
    Tight,
    /// No rest at all — turning here drops a sounding note.
    Impossible,
}

/// Printed annotation suggested for a boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnAnnotation {
    /// No annotation.
    None,
    /// Mark **V.S.** (volti subito) — turn quickly.
    Vs,
    /// Mark "time" — there is ample time (e.g. an MMR was pushed forward).
    Time,
}

/// Analysis of one potential page-turn boundary (between measure
/// `boundary_index` and `boundary_index + 1`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TurnWindow {
    /// Boundary sits between measure `boundary_index` and the next.
    pub boundary_index: usize,
    /// Available turn time in seconds (tail rest + head rest, tempo-aware).
    pub turn_seconds: f64,
    /// Rest seconds *before* the turn — the trailing rest at the foot of the
    /// outgoing page. A player rests here, then turns: the natural V.S.
    pub tail_seconds: f64,
    /// Rest seconds *after* the turn — the leading rest at the top of the
    /// incoming page. Relying on this forces a "time" marking (turn first,
    /// rest after), which engravers avoid except when unavoidable.
    pub head_seconds: f64,
    /// Count of consecutive whole-bar rests at the very top of the incoming
    /// page (the leading multimeasure rest the player rests through after the
    /// turn). Drives the courtesy "N bars" hint printed in the outgoing page's
    /// margin.
    pub head_rest_measures: usize,
    /// Quality band.
    pub quality: TurnQuality,
    /// Whether repeat/volta/jump structure makes this boundary unsafe.
    pub structural: bool,
    /// Whether a fermata/caesura at the boundary makes a turn here jarring.
    pub fermata_blocked: bool,
    /// Suggested printed annotation.
    pub annotation: TurnAnnotation,
}

// ── Sequence walking ──────────────────────────────────────────────────────

/// First sounding onset and last sounding offset (in quarter beats) within one
/// voice, plus the voice's total notated length.
struct VoiceSpan {
    first_onset: Option<f64>,
    last_offset: Option<f64>,
    total: f64,
}

fn content_beats(item: &SequenceContent) -> f64 {
    match item {
        SequenceContent::Event(e) => e.duration.total_beats(),
        SequenceContent::Space(s) => s.total_beats(),
        SequenceContent::Tuplet(t) => t.outer.duration.total_beats() * t.outer.multiple as f64,
        SequenceContent::MultiNoteTremolo(t) => {
            t.outer.duration.total_beats() * t.outer.multiple as f64
        }
        SequenceContent::Grace(_) => 0.0,
        SequenceContent::Other(_) => 0.0,
    }
}

fn tuplet_has_sound(t: &crate::model::event::Tuplet) -> bool {
    t.content.iter().any(|c| match c {
        SequenceContent::Event(e) => !e.is_rest(),
        SequenceContent::Tuplet(inner) => tuplet_has_sound(inner),
        SequenceContent::MultiNoteTremolo(_) => true,
        SequenceContent::Grace(_) => true,
        _ => false,
    })
}

fn voice_span(seq: &Sequence) -> VoiceSpan {
    // A full-measure rest sequence is silent for its whole length.
    let mut pos = 0.0;
    let mut first_onset: Option<f64> = None;
    let mut last_offset: Option<f64> = None;
    for item in &seq.content {
        let dur = content_beats(item);
        let sounds = match item {
            SequenceContent::Event(e) => !e.is_rest(),
            SequenceContent::Tuplet(t) => tuplet_has_sound(t),
            SequenceContent::MultiNoteTremolo(_) => true,
            SequenceContent::Grace(_) => true,
            _ => false,
        };
        if sounds {
            if first_onset.is_none() {
                first_onset = Some(pos);
            }
            last_offset = Some(pos + dur);
        }
        pos += dur;
    }
    VoiceSpan {
        first_onset,
        last_offset,
        total: pos,
    }
}

fn measure_has_fermata(m: &PartMeasure) -> bool {
    m.sequences.iter().any(|s| {
        s.content.iter().any(|c| match c {
            SequenceContent::Event(e) => e.fermata.is_some(),
            _ => false,
        })
    })
}

fn measure_has_caesura(m: &PartMeasure) -> bool {
    m.sequences.iter().any(|s| {
        s.content.iter().any(|c| match c {
            SequenceContent::Event(e) => e
                .markings
                .as_ref()
                .is_some_and(|mk| mk.caesura.is_some() || mk.breath.is_some()),
            _ => false,
        })
    })
}

/// Build a voice-combined rest profile for one part measure.
pub fn profile_from_part_measure(m: &PartMeasure) -> MeasureProfile {
    let mut total: f64 = 0.0;
    // Earliest first onset and latest last offset across all voices.
    let mut earliest_onset: Option<f64> = None;
    let mut latest_offset: Option<f64> = None;
    let mut any_sound = false;

    for seq in &m.sequences {
        let span = voice_span(seq);
        total = total.max(span.total);
        if let Some(on) = span.first_onset {
            any_sound = true;
            earliest_onset = Some(earliest_onset.map_or(on, |e: f64| e.min(on)));
        }
        if let Some(off) = span.last_offset {
            latest_offset = Some(latest_offset.map_or(off, |l: f64| l.max(off)));
        }
    }

    let is_full_rest = !any_sound;
    let leading_rest_beats = if is_full_rest {
        total
    } else {
        earliest_onset.unwrap_or(0.0).max(0.0)
    };
    let trailing_rest_beats = if is_full_rest {
        total
    } else {
        (total - latest_offset.unwrap_or(total)).max(0.0)
    };

    MeasureProfile {
        total_beats: total,
        leading_rest_beats,
        trailing_rest_beats,
        is_full_rest,
        has_fermata: measure_has_fermata(m),
        has_caesura: measure_has_caesura(m),
    }
}

// ── Turn-window computation ───────────────────────────────────────────────

fn tail_seconds(profiles: &[MeasureProfile], tempo: &TempoMap, end_measure: usize) -> f64 {
    let mut secs = 0.0;
    let mut m = end_measure as isize;
    while m >= 0 {
        let p = &profiles[m as usize];
        secs += tempo.seconds(m as usize, p.trailing_rest_beats);
        if !p.is_full_rest {
            break;
        }
        m -= 1;
    }
    secs
}

fn head_seconds(profiles: &[MeasureProfile], tempo: &TempoMap, start_measure: usize) -> f64 {
    let mut secs = 0.0;
    let mut m = start_measure;
    while m < profiles.len() {
        let p = &profiles[m];
        secs += tempo.seconds(m, p.leading_rest_beats);
        if !p.is_full_rest {
            break;
        }
        m += 1;
    }
    secs
}

/// Count the consecutive whole-bar rests at the top of the incoming page,
/// starting at `start_measure` — the leading multimeasure rest the player
/// rests through right after turning.
///
/// `mmr_breaks[i]` marks measures that *start a new* multimeasure rest group
/// (rehearsal mark, time/key change, barline change, repeat/jump structure,
/// etc.). The count stops at the first such break after `start_measure`, so the
/// hint reports only the first rest group rather than summing every consecutive
/// resting bar across separate multimeasure rests.
fn head_rest_measures(
    profiles: &[MeasureProfile],
    mmr_breaks: &[bool],
    start_measure: usize,
) -> usize {
    let mut count = 0;
    let mut m = start_measure;
    while m < profiles.len() && profiles[m].is_full_rest {
        // The head measure (m == start_measure) always counts; a later measure
        // that begins a fresh multimeasure rest ends the first group.
        if m > start_measure && mmr_breaks.get(m).copied().unwrap_or(false) {
            break;
        }
        count += 1;
        m += 1;
    }
    count
}

fn classify(seconds: f64, config: &PageTurnConfig) -> TurnQuality {
    if seconds <= 0.0 {
        TurnQuality::Impossible
    } else if seconds >= config.comfortable_secs {
        TurnQuality::Comfortable
    } else if seconds >= config.vs_secs {
        TurnQuality::Vs
    } else {
        TurnQuality::Tight
    }
}

/// Compute a turn window for every measure boundary.
///
/// `structural_flags` must have length `profiles.len() - 1` (see
/// [`crate::layout::page_turn::expansion::structural_boundary_flags`]); a
/// shorter slice treats missing entries as non-structural.
///
/// `mmr_breaks` is per-measure (length `profiles.len()`, see
/// [`crate::layout::page_turn::expansion::multimeasure_rest_break_flags`]) and
/// bounds the courtesy rest-bar count to the first multimeasure rest group.
pub fn compute_turn_windows(
    profiles: &[MeasureProfile],
    tempo: &TempoMap,
    structural_flags: &[bool],
    mmr_breaks: &[bool],
    config: &PageTurnConfig,
) -> Vec<TurnWindow> {
    if profiles.len() < 2 {
        return Vec::new();
    }
    let mut windows = Vec::with_capacity(profiles.len() - 1);
    for b in 0..profiles.len() - 1 {
        let tail_seconds = tail_seconds(profiles, tempo, b);
        let head_seconds = head_seconds(profiles, tempo, b + 1);
        let head_rest_measures = head_rest_measures(profiles, mmr_breaks, b + 1);
        let turn_seconds = tail_seconds + head_seconds;
        let quality = classify(turn_seconds, config);
        let fermata_blocked = profiles[b].has_fermata
            || profiles[b].has_caesura
            || profiles[b + 1].has_fermata
            || profiles[b + 1].has_caesura;
        let structural = structural_flags.get(b).copied().unwrap_or(false);
        // A viable turn whose rest sits mostly AFTER the turn (the next page
        // opens with the rest — typically a multimeasure rest) needs a "time"
        // marking; the player turns first and rests after. A turn with enough
        // rest BEFORE it (tail) in the V.S. band is a normal volti subito.
        let viable = matches!(quality, TurnQuality::Comfortable | TurnQuality::Vs);
        let is_time_case = viable && head_seconds > tail_seconds && tail_seconds < config.vs_secs;
        let annotation = if !config.emit_vs_marks {
            TurnAnnotation::None
        } else if is_time_case {
            TurnAnnotation::Time
        } else if quality == TurnQuality::Vs {
            TurnAnnotation::Vs
        } else {
            TurnAnnotation::None
        };
        windows.push(TurnWindow {
            boundary_index: b,
            turn_seconds,
            tail_seconds,
            head_seconds,
            head_rest_measures,
            quality,
            structural,
            fermata_blocked,
            annotation,
        });
    }
    windows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> PageTurnConfig {
        PageTurnConfig::default()
    }

    fn full_rest(total: f64) -> MeasureProfile {
        MeasureProfile {
            total_beats: total,
            leading_rest_beats: total,
            trailing_rest_beats: total,
            is_full_rest: true,
            has_fermata: false,
            has_caesura: false,
        }
    }

    fn full_sound(total: f64) -> MeasureProfile {
        MeasureProfile {
            total_beats: total,
            leading_rest_beats: 0.0,
            trailing_rest_beats: 0.0,
            is_full_rest: false,
            has_fermata: false,
            has_caesura: false,
        }
    }

    #[test]
    fn test_no_rest_is_impossible() {
        let profiles = vec![full_sound(4.0), full_sound(4.0)];
        let tempo = TempoMap::from_spq(vec![1.0, 1.0]);
        let w = compute_turn_windows(&profiles, &tempo, &[false], &[false, false], &cfg());
        assert_eq!(w[0].turn_seconds, 0.0);
        assert_eq!(w[0].quality, TurnQuality::Impossible);
    }

    #[test]
    fn test_trailing_plus_leading_rest_seconds() {
        // measure 0 ends with 2 beats rest, measure 1 starts with 2 beats rest.
        let mut a = full_sound(8.0);
        a.trailing_rest_beats = 3.0;
        let mut b = full_sound(8.0);
        b.leading_rest_beats = 3.0;
        let profiles = vec![a, b];
        let tempo = TempoMap::from_spq(vec![1.0, 1.0]); // 1 s/quarter
        let w = compute_turn_windows(&profiles, &tempo, &[false], &[false, false], &cfg());
        // 3 + 3 = 6 seconds.
        assert!((w[0].turn_seconds - 6.0).abs() < 1e-9);
        assert_eq!(w[0].quality, TurnQuality::Comfortable);
    }

    #[test]
    fn test_full_rest_measures_accumulate() {
        // boundary after measure 0: measure 1 is a full-rest bar, then measure 2 sounds.
        let profiles = vec![full_sound(4.0), full_rest(4.0), full_sound(4.0)];
        let tempo = TempoMap::from_spq(vec![1.0, 1.0, 1.0]);
        let w = compute_turn_windows(
            &profiles,
            &tempo,
            &[false, false],
            &[false, false, false],
            &cfg(),
        );
        // Boundary 0 head walks through the full-rest measure 1 (4 s).
        assert!((w[0].turn_seconds - 4.0).abs() < 1e-9);
    }

    #[test]
    fn test_vs_band_annotation() {
        let mut a = full_sound(8.0);
        a.trailing_rest_beats = 4.0;
        let profiles = vec![a, full_sound(4.0)];
        let tempo = TempoMap::from_spq(vec![1.0, 1.0]); // 1 beat = 1 s
        let w = compute_turn_windows(&profiles, &tempo, &[false], &[false, false], &cfg());
        // 4.0 s sits in the V.S. band (3.0..5.0).
        assert_eq!(w[0].quality, TurnQuality::Vs);
        assert_eq!(w[0].annotation, TurnAnnotation::Vs);
        // The rest is entirely BEFORE the turn (tail) — a normal V.S., not a
        // "time" case.
        assert!((w[0].tail_seconds - 4.0).abs() < 1e-9);
        assert_eq!(w[0].head_seconds, 0.0);
    }

    #[test]
    fn test_time_annotation_when_rest_is_after_turn() {
        // Measure 0 ends with sound (no tail rest); a full-rest bar follows
        // (the rest sits AFTER the turn — e.g. the next page opens with an
        // MMR). The turn is comfortable only because of that head rest.
        let profiles = vec![full_sound(8.0), full_rest(8.0), full_sound(4.0)];
        let tempo = TempoMap::from_spq(vec![1.0, 1.0, 1.0]);
        let w = compute_turn_windows(
            &profiles,
            &tempo,
            &[false, false],
            &[false, false, false],
            &cfg(),
        );
        assert_eq!(w[0].tail_seconds, 0.0);
        assert!(w[0].head_seconds >= 8.0);
        assert_eq!(w[0].quality, TurnQuality::Comfortable);
        assert_eq!(w[0].annotation, TurnAnnotation::Time);
        // One whole-bar rest sits at the top of the next page.
        assert_eq!(w[0].head_rest_measures, 1);
    }

    #[test]
    fn test_head_rest_measures_counts_leading_full_rests() {
        // After the boundary the next page opens with two whole-bar rests
        // before the music resumes — the courtesy "2 bars" hint count.
        let profiles = vec![
            full_sound(4.0),
            full_rest(4.0),
            full_rest(4.0),
            full_sound(4.0),
        ];
        let tempo = TempoMap::from_spq(vec![1.0, 1.0, 1.0, 1.0]);
        let w = compute_turn_windows(
            &profiles,
            &tempo,
            &[false, false, false],
            &[false, false, false, false],
            &cfg(),
        );
        assert_eq!(w[0].head_rest_measures, 2);
        // A boundary whose next measure sounds immediately has no leading rest.
        assert_eq!(w[2].head_rest_measures, 0);
    }

    #[test]
    fn test_head_rest_measures_stops_at_first_group() {
        // Four consecutive whole-bar rests follow the boundary, but measure 3
        // begins a NEW multimeasure rest group (e.g. a rehearsal mark or time
        // change). The courtesy hint should report only the first group (2
        // bars: measures 1 and 2), not sum all four.
        let profiles = vec![
            full_sound(4.0),
            full_rest(4.0),
            full_rest(4.0),
            full_rest(4.0),
            full_rest(4.0),
            full_sound(4.0),
        ];
        let tempo = TempoMap::from_spq(vec![1.0; 6]);
        let mmr_breaks = [false, false, false, true, false, false];
        let w = compute_turn_windows(
            &profiles,
            &tempo,
            &[false, false, false, false, false],
            &mmr_breaks,
            &cfg(),
        );
        assert_eq!(w[0].head_rest_measures, 2);
    }

    #[test]
    fn test_structural_flag_propagates() {
        let profiles = vec![full_rest(4.0), full_rest(4.0)];
        let tempo = TempoMap::from_spq(vec![1.0, 1.0]);
        let w = compute_turn_windows(&profiles, &tempo, &[true], &[false, false], &cfg());
        assert!(w[0].structural);
    }
}
