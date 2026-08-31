#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::*;
use super::cross_barline::*;
use super::render::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

// ═══════════════════════════════════════════
// Beam layout
// ═══════════════════════════════════════════

/// Compute the beam group break duration for a given time signature and note flag level.
/// Returns the duration in quarter-note beats at which beam groups should break.
///
/// Standard engraving approach.
/// Key rules:
/// - 4/4: eighths beam by half-measure (groups of 4), 16ths+ beam by beat
/// - 6/4: eighths beam by half-measure (groups of 6), 16ths+ beam by beat
/// - Compound meters (6/8, 9/8, 12/8): all beam by dotted quarter
/// - Simple meters (2/4, 3/4): all beam by beat
pub(crate) fn beam_group_duration(time_sig: &TimeSignature, flag_count: u32) -> f64 {
    let is_compound = time_sig.unit == 8 && time_sig.count.is_multiple_of(3);

    if is_compound {
        // Compound meters (3/8, 6/8, 9/8, 12/8): group by dotted quarter
        3.0 * 4.0 / time_sig.unit as f64 // 1.5 for x/8
    } else if time_sig.unit == 8 {
        // Non-compound x/8 (5/8, 7/8): group by quarter note as fallback
        1.0
    } else {
        let beat_dur = 4.0 / time_sig.unit as f64;

        if flag_count == 1 {
            // Eighth notes: wider grouping for quadruple/sextuple meters
            match (time_sig.count, time_sig.unit) {
                (4, 4) => 2.0, // half-measure
                (6, 4) => 3.0, // half-measure (3+3)
                _ => beat_dur,
            }
        } else {
            // 16ths and shorter: always beat-level
            beat_dur
        }
    }
}

/// Check if a beat position falls on a beam group boundary for the given group duration.
pub(super) fn is_at_group_boundary(beat_position: f64, group_dur: f64) -> bool {
    if group_dur <= 0.0 {
        return false;
    }
    let frac = beat_position / group_dur;
    (frac - frac.round()).abs() < 0.01
}

/// Whether an event carries a caesura marking. A caesura forces a beam break
/// after the event (a beam never spans a grand pause).
fn event_has_caesura(event: &crate::model::Event) -> bool {
    event.markings.as_ref().is_some_and(|m| m.caesura.is_some())
}

/// Generate synthetic beam groups for auto-beaming when no explicit beams[] are present.
/// Groups consecutive 8th/16th/32nd notes using duration-aware break positions
/// based on standard grouping tables.
/// Events whose IDs are in `exclude_ids` are skipped (they belong to cross-barline beams).
pub(crate) fn auto_beam_groups(
    voice_layouts: &[VoiceLayout],
    time_sig: &TimeSignature,
    exclude_ids: &HashSet<String>,
) -> Vec<Beam> {
    let mut beams = Vec::new();

    for vl in voice_layouts {
        let event_count = vl.events.len();
        let mut current_group: Vec<String> = Vec::new();
        // Map each event index to the tuplet group it belongs to (if any).
        // Standard engraving practice: separate tuplet groups are beamed
        // independently — two adjacent triplets each carry their own beam (and
        // bracket) rather than sharing a single beam. A beam therefore breaks at
        // every tuplet boundary, on top of the usual meter-implied breaks.
        let mut event_tuplet: Vec<Option<usize>> = vec![None; event_count];
        for (ti, tg) in vl.tuplet_groups.iter().enumerate() {
            for e in tg.first_event_idx..=tg.last_event_idx {
                if e < event_tuplet.len() {
                    event_tuplet[e] = Some(ti);
                }
            }
        }
        // Tuplet membership of the last note added to the current beam group.
        let mut current_tuplet: Option<usize> = None;
        // Pre-scan the voice for the global maximum flag count among beamable events.
        // Standard engraving rule (standard engraving practice): in 4/4, if ANY event in the
        // voice has 16th notes (or shorter), ALL beam groups break at beat boundaries
        // rather than at the wider half-measure boundary used for pure 8th-note groups.
        let voice_max_flags: u32 = (0..event_count)
            .filter(|&i| {
                let event = vl.events.event(i);
                let fc = event.duration.base.flag_count();
                fc > 0
                    && !event.is_rest()
                    && vl.events.id(i).is_some_and(|id| !exclude_ids.contains(id))
            })
            .map(|i| vl.events.event(i).duration.base.flag_count())
            .max()
            .unwrap_or(0);

        // group_max_flags tracks flags within the current group, but is floored
        // by voice_max_flags so that mixed-duration voices use the correct boundaries.
        let mut group_max_flags: u32 = 0;
        // Track whether a rest was skipped since the last beamed note.
        // When true, the next note enforces beat-level boundary checking to
        // ensure beam-over-rest only applies within the same beat.
        let mut has_pending_rest = false;

        // `event_idx` drives several SoA accessors (`event`, `beat_position`,
        // `id`) alongside `event_tuplet[event_idx]`; a plain iterator can't
        // span them.
        #[allow(clippy::needless_range_loop)]
        for event_idx in 0..event_count {
            let event = vl.events.event(event_idx);
            let flag_count = event.duration.base.flag_count();
            let has_flags = flag_count > 0;
            let is_rest = event.is_rest();
            let beat_cursor = vl.events.beat_position(event_idx);

            if has_flags && !is_rest {
                if let Some(id) = vl.events.id(event_idx) {
                    // Skip events that belong to cross-barline beams
                    if exclude_ids.contains(id) {
                        if current_group.len() >= 2 {
                            beams.push(Beam {
                                events: current_group.clone(),
                                beams: Vec::new(),
                                direction: None,
                            });
                        }
                        current_group.clear();
                        group_max_flags = 0;
                        has_pending_rest = false;
                    } else {
                        // Check if this note falls on a beam group boundary.
                        // Use the finest granularity: the max of the voice-level
                        // flags, the current group flags, and this note's flags.
                        let effective_flags = voice_max_flags.max(group_max_flags).max(flag_count);
                        let group_dur = beam_group_duration(time_sig, effective_flags);
                        // If a rest was skipped, also check beat-level boundary.
                        // Beam-over-rest only applies within the same beat.
                        let beat_dur = 4.0 / time_sig.unit as f64;
                        let at_group_boundary = is_at_group_boundary(beat_cursor, group_dur);
                        let at_beat_after_rest =
                            has_pending_rest && is_at_group_boundary(beat_cursor, beat_dur);
                        // Break when crossing into a different tuplet group (or
                        // between a tuplet and a non-tuplet run): each tuplet is
                        // beamed independently.
                        let at_tuplet_boundary =
                            !current_group.is_empty() && event_tuplet[event_idx] != current_tuplet;
                        if !current_group.is_empty()
                            && (at_group_boundary || at_beat_after_rest || at_tuplet_boundary)
                        {
                            if current_group.len() >= 2 {
                                beams.push(Beam {
                                    events: current_group.clone(),
                                    beams: Vec::new(),
                                    direction: None,
                                });
                            }
                            current_group.clear();
                            group_max_flags = 0;
                        }
                        current_group.push(id.to_string());
                        group_max_flags = group_max_flags.max(flag_count);
                        current_tuplet = event_tuplet[event_idx];
                        has_pending_rest = false;
                        // A caesura marks a complete break in the music (grand
                        // pause). Standard engraving practice: a beam never
                        // continues across a caesura, so close the group after
                        // the event that carries it.
                        if event_has_caesura(vl.events.event(event_idx)) {
                            if current_group.len() >= 2 {
                                beams.push(Beam {
                                    events: current_group.clone(),
                                    beams: Vec::new(),
                                    direction: None,
                                });
                            }
                            current_group.clear();
                            group_max_flags = 0;
                        }
                    }
                }
            } else if has_flags && is_rest {
                // Short rest (8th/16th/32nd): beam over it ONLY within the same beat.
                // Rests always break at beat boundaries — unlike notes which may use
                // wider grouping (e.g. half-measure for 8ths in 4/4).
                // Ref: standard engraving practice — beam over rest applies within a single beat.
                let beat_dur = 4.0 / time_sig.unit as f64;
                if !current_group.is_empty() && is_at_group_boundary(beat_cursor, beat_dur) {
                    if current_group.len() >= 2 {
                        beams.push(Beam {
                            events: current_group.clone(),
                            beams: Vec::new(),
                            direction: None,
                        });
                    }
                    current_group.clear();
                    group_max_flags = 0;
                }
                // Update max flags even for rests so subsequent boundary checks are accurate
                group_max_flags = group_max_flags.max(flag_count);
                has_pending_rest = true;
                // Otherwise: skip the rest, keeping the current group open
            } else {
                // Non-beamable note (quarter, half, whole) or long rest: break the group
                if current_group.len() >= 2 {
                    beams.push(Beam {
                        events: current_group.clone(),
                        beams: Vec::new(),
                        direction: None,
                    });
                }
                current_group.clear();
                group_max_flags = 0;
                has_pending_rest = false;
            }
        }

        // Flush final group
        if current_group.len() >= 2 {
            beams.push(Beam {
                events: current_group,
                beams: Vec::new(),
                direction: None,
            });
        }
    }

    beams
}

/// Synthesize beam groups for grace notes that are not covered by an explicit
/// beam. Consecutive beamable (eighth-value or shorter) grace notes within a
/// single event's grace group are beamed together as a run of two or more.
/// Standard engraving practice: a group of two or more grace notes of eighth
/// value or shorter is beamed, mirroring the beaming of regular notes.
pub(crate) fn auto_grace_beam_groups(
    ml: &MeasureLayout,
    explicit_ids: &HashSet<String>,
) -> Vec<Beam> {
    fn flush(group: &mut Vec<String>, out: &mut Vec<Beam>) {
        if group.len() >= 2 {
            out.push(Beam {
                events: std::mem::take(group),
                beams: Vec::new(),
                direction: None,
            });
        } else {
            group.clear();
        }
    }

    let mut beams = Vec::new();
    for vl in &ml.voice_layouts {
        for ei in 0..vl.events.len() {
            let mut current: Vec<String> = Vec::new();
            for gn in vl.events.grace_notes(ei) {
                let beamable = gn.event.duration.base.flag_count() > 0 && !gn.event.is_rest();
                let id_excluded = gn.id.as_ref().is_some_and(|id| explicit_ids.contains(id));
                match (&gn.id, beamable && !id_excluded) {
                    (Some(id), true) => current.push(id.clone()),
                    _ => flush(&mut current, &mut beams),
                }
            }
            flush(&mut current, &mut beams);
        }
    }
    beams
}

/// Collect all event IDs that belong to any beam group (explicit or auto-generated).
pub(crate) fn collect_beamed_event_ids(part_measure: &PartMeasure) -> HashSet<String> {
    let mut ids = HashSet::new();
    if let Some(beams) = &part_measure.beams {
        for beam in beams {
            for id in &beam.events {
                ids.insert(id.clone());
            }
        }
    }
    ids
}

/// Collect event IDs from explicit beam declarations across all measures.
/// Does NOT include auto-beamed events. Used to prevent auto-beaming of events
/// that belong to cross-barline beams declared in other measures.
pub(crate) fn collect_explicit_beamed_event_ids(
    measure_layouts: &[MeasureLayout],
) -> HashSet<String> {
    let available_ids: HashSet<&str> = measure_layouts
        .iter()
        .flat_map(|ml| {
            ml.voice_layouts.iter().flat_map(|voice| {
                (0..voice.events.len()).flat_map(|index| {
                    voice.events.id(index).into_iter().chain(
                        voice
                            .events
                            .grace_notes(index)
                            .iter()
                            .filter_map(|grace| grace.id.as_deref()),
                    )
                })
            })
        })
        .collect();
    let mut ids = HashSet::new();
    for ml in measure_layouts {
        for beam in ml.resolved.part.beams.as_deref().unwrap_or_default() {
            // A malformed beam must not suppress an event's ordinary stem and
            // flag. Cross-barline beams remain valid because every declared ID
            // resolves somewhere in the complete laid-out score.
            if beam.events.len() >= 2
                && beam
                    .events
                    .iter()
                    .all(|event_id| available_ids.contains(event_id.as_str()))
            {
                ids.extend(beam.events.iter().cloned());
            }
        }
    }
    ids
}

/// Collect beamed event IDs across ALL measures (including cross-barline beams and auto-beams).
/// When `use_beams` is true, only explicit beams are used (no auto-beaming).
pub(crate) fn collect_all_beamed_event_ids(
    measure_layouts: &[MeasureLayout],
    use_beams: bool,
) -> HashSet<String> {
    let explicit_ids = collect_explicit_beamed_event_ids(measure_layouts);
    let mut ids = explicit_ids.clone();
    if !use_beams {
        for ml in measure_layouts {
            // Explicit groups claim only their own events. Auto-beam every
            // remaining eligible run so newly entered notes still receive
            // default beaming in a measure that already has manual beams.
            let auto_beams =
                auto_beam_groups(&ml.voice_layouts, &ml.resolved.active_time, &explicit_ids);
            for beam in &auto_beams {
                for id in &beam.events {
                    ids.insert(id.clone());
                }
            }
            // Grace notes auto-beam independently of main-note beams: a measure
            // may carry explicit beams for its main notes while its grace groups
            // have none. Suppress individual grace flags for any auto-beamed run.
            for beam in &auto_grace_beam_groups(ml, &explicit_ids) {
                for id in &beam.events {
                    ids.insert(id.clone());
                }
            }
        }
    }
    ids
}
