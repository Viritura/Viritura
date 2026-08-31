//! Measure resolution.

use super::types::*;
use crate::model::*;

/// Whether `index` lies inside a measure-repeat span in this part. MNX encodes
/// the sign only on the first covered bar, so later covered bars must derive
/// this state by looking backward.
pub(crate) fn measure_is_covered_by_repeat(measures: &[PartMeasure], index: usize) -> bool {
    measures
        .iter()
        .enumerate()
        .take(index + 1)
        .rev()
        .any(|(start, measure)| {
            measure
                .measure_repeat
                .as_ref()
                .is_some_and(|repeat| index < start + repeat.number.max(1) as usize)
        })
}
use std::collections::{HashMap, HashSet};

type AccidentalState = HashMap<(String, i32), i32>;

fn display_pitch_for_accidental(note: &Note, transposition: Option<(i32, i32)>) -> Pitch {
    if note.kit_component.is_some() {
        return note.pitch.clone();
    }
    if let Some((staff_distance, half_steps)) = transposition {
        let delta = note
            .written
            .as_ref()
            .and_then(|written| written.diatonic_delta)
            .unwrap_or(0);
        return note.pitch.transpose(staff_distance, half_steps, delta);
    }
    note.pitch.clone()
}

fn apply_courtesy_to_event(
    event: &mut Event,
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    incoming_ties: &HashSet<String>,
    previous_state: &AccidentalState,
    seen_independent: &mut HashSet<(String, i32)>,
    final_state: &mut AccidentalState,
) {
    for note in event.notes.as_mut().into_iter().flatten() {
        let display_pitch = display_pitch_for_accidental(note, transposition);
        let state_key = (display_pitch.step.clone(), display_pitch.octave);
        let alter = display_pitch.alter.unwrap_or(0);
        let key_alter = active_key.alteration_for_step(&display_pitch.step);
        let tied_continuation = note
            .id
            .as_ref()
            .is_some_and(|id| incoming_ties.contains(id));

        if !tied_continuation && seen_independent.insert(state_key.clone()) {
            let cancels_previous = previous_state
                .get(&state_key)
                .is_some_and(|previous_alter| *previous_alter != key_alter);
            if note.accidental_display.is_none() && alter == key_alter && cancels_previous {
                note.accidental_display = Some(AccidentalDisplay {
                    show: true,
                    force: Some(true),
                    enclosure: Some(AccidentalEnclosure {
                        symbol: AccidentalEnclosureSymbol::Parentheses,
                    }),
                });
            }
        }
        final_state.insert(state_key, alter);
    }
}

fn apply_automatic_courtesy_accidentals(
    measure: &mut PartMeasure,
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    incoming_ties: &[String],
    previous_state: &AccidentalState,
) -> AccidentalState {
    let incoming_ties: HashSet<String> = incoming_ties.iter().cloned().collect();
    let mut seen_independent = HashSet::new();
    let mut final_state = HashMap::new();

    fn process_content(
        content: &mut [SequenceContent],
        active_key: &KeySignature,
        transposition: Option<(i32, i32)>,
        incoming_ties: &HashSet<String>,
        previous_state: &AccidentalState,
        seen_independent: &mut HashSet<(String, i32)>,
        final_state: &mut AccidentalState,
    ) {
        for item in content {
            match item {
                SequenceContent::Event(event) => apply_courtesy_to_event(
                    event,
                    active_key,
                    transposition,
                    incoming_ties,
                    previous_state,
                    seen_independent,
                    final_state,
                ),
                SequenceContent::Tuplet(tuplet) => process_content(
                    &mut tuplet.content,
                    active_key,
                    transposition,
                    incoming_ties,
                    previous_state,
                    seen_independent,
                    final_state,
                ),
                SequenceContent::MultiNoteTremolo(tremolo) => {
                    for event in &mut tremolo.content {
                        apply_courtesy_to_event(
                            event,
                            active_key,
                            transposition,
                            incoming_ties,
                            previous_state,
                            seen_independent,
                            final_state,
                        );
                    }
                }
                SequenceContent::Grace(grace) => {
                    for event in &mut grace.content {
                        apply_courtesy_to_event(
                            event,
                            active_key,
                            transposition,
                            incoming_ties,
                            previous_state,
                            seen_independent,
                            final_state,
                        );
                    }
                }
                SequenceContent::Space(_) | SequenceContent::Other(_) => {}
            }
        }
    }

    for sequence in &mut measure.sequences {
        process_content(
            &mut sequence.content,
            active_key,
            transposition,
            &incoming_ties,
            previous_state,
            &mut seen_independent,
            &mut final_state,
        );
    }
    final_state
}

fn collect_tie_targets(content: &[SequenceContent], targets: &mut Vec<String>) {
    for item in content {
        match item {
            SequenceContent::Event(event) => {
                for note in event.notes() {
                    for tie in note.ties.as_deref().unwrap_or_default() {
                        if tie
                            .target_type
                            .as_deref()
                            .is_none_or(|kind| kind == "nextNote")
                        {
                            if let Some(target) = tie.target.as_deref() {
                                targets.push(target.to_string());
                            }
                        }
                    }
                }
            }
            SequenceContent::Tuplet(tuplet) => collect_tie_targets(&tuplet.content, targets),
            SequenceContent::MultiNoteTremolo(tremolo) => {
                for event in &tremolo.content {
                    for note in event.notes() {
                        for tie in note.ties.as_deref().unwrap_or_default() {
                            if tie
                                .target_type
                                .as_deref()
                                .is_none_or(|kind| kind == "nextNote")
                            {
                                if let Some(target) = tie.target.as_deref() {
                                    targets.push(target.to_string());
                                }
                            }
                        }
                    }
                }
            }
            SequenceContent::Space(_) | SequenceContent::Grace(_) | SequenceContent::Other(_) => {}
        }
    }
}

fn incoming_tie_targets(measures: &[PartMeasure], index: usize) -> Vec<String> {
    let mut targets = Vec::new();
    for measure in measures.iter().take(index) {
        for sequence in &measure.sequences {
            collect_tie_targets(&sequence.content, &mut targets);
        }
    }
    targets
}

// ═══════════════════════════════════════════
// Resolve measures
// ═══════════════════════════════════════════

pub(crate) fn resolve_measures(score: &Score, part_index: usize) -> Vec<ResolvedMeasure> {
    let part = &score.parts[part_index];
    let globals = &score.global.measures;

    // Check if this score uses written (transposed) pitches
    let use_written = score
        .scores
        .first()
        .and_then(|s| s.use_written)
        .unwrap_or(false);
    // Instruments that prefer written pitches (e.g. piccolo, double bass)
    // always transpose regardless of use_written.
    let prefers_written = part
        .transposition
        .as_ref()
        .and_then(|t| t.prefers_written_pitches)
        .unwrap_or(false);
    let should_transpose = use_written || prefers_written;
    let transposition = if should_transpose {
        part.transposition
            .as_ref()
            .map(|t| (t.interval.staff_distance, t.interval.half_steps))
    } else {
        None
    };
    let key_fifths_flip_at = if should_transpose {
        part.transposition
            .as_ref()
            .and_then(|t| t.key_fifths_flip_at)
    } else {
        None
    };

    let mut active_time = TimeSignature::default();
    let mut active_key = KeySignature {
        fifths: 0,
        ..Default::default()
    };
    let mut last_clef: Option<PositionedClef> = None;
    let mut result = Vec::new();
    let count = globals.len().max(part.measures.len());
    let mut prev_display_key = KeySignature::default();
    let mut previous_accidental_state = AccidentalState::new();
    for i in 0..count {
        let global = globals.get(i).cloned().unwrap_or(GlobalMeasure {
            id: None,
            number: None,
            time: None,
            key: None,
            barline: None,
            repeat_start: None,
            repeat_end: None,
            ending: None,
            tempos: None,
            segno: None,
            fine: None,
            jump: None,
            extensions: None,
        });
        let mut part_measure = part.measures.get(i).cloned().unwrap_or(PartMeasure {
            clefs: None,
            sequences: vec![],
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
        });

        if let Some(ref t) = global.time {
            active_time = t.clone();
        }
        if let Some(ref k) = global.key {
            active_key = k.clone();
        }

        // Carry forward clefs across measures: if this measure has no start clef,
        // inject the last active clef with position (0,1) so it participates in
        // pitch-to-position calculation without rendering a visible clef glyph.
        let has_start_clef = part_measure.clefs.as_ref().is_some_and(|clefs| {
            clefs.iter().any(|pc| {
                let (n, _) = pc.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
                n == 0
            })
        });
        if !has_start_clef {
            if let Some(ref inherited) = last_clef {
                let mut start_clef = inherited.clone();
                start_clef.position = Some(RhythmicPosition { fraction: (0, 1) });
                let clefs = part_measure.clefs.get_or_insert_with(Vec::new);
                clefs.insert(0, start_clef);
            }
        }
        // Track the last clef for carry-forward
        if let Some(ref clefs) = part_measure.clefs {
            if let Some(c) = clefs.last() {
                last_clef = Some(c.clone());
            }
        }

        // When useWritten is true, transpose the key signature for this part.
        // Atonal keys should never be transposed — they display no accidentals.
        let display_key = if active_key.atonal == Some(true) {
            active_key.clone()
        } else if let Some((_, half_steps)) = transposition {
            active_key.transpose(half_steps, key_fifths_flip_at)
        } else {
            active_key.clone()
        };

        let incoming_ties = incoming_tie_targets(&part.measures, i);
        if display_key != prev_display_key {
            previous_accidental_state.clear();
        }
        let current_accidental_state = apply_automatic_courtesy_accidentals(
            &mut part_measure,
            &display_key,
            transposition,
            &incoming_ties,
            &previous_accidental_state,
        );

        result.push(ResolvedMeasure {
            index: i,
            global,
            part: part_measure,
            measure_repeat_covered: measure_is_covered_by_repeat(&part.measures, i),
            next_has_repeat_start: globals
                .get(i + 1)
                .is_some_and(|measure| measure.repeat_start.is_some()),
            active_time: active_time.clone(),
            active_key: display_key.clone(),
            prev_key: prev_display_key.clone(),
            tie_continuation_ids: incoming_ties,
            transposition,
            condensing_change: false,
            kit: part.kit.clone(),
        });
        previous_accidental_state = current_accidental_state;
        prev_display_key = display_key;
    }
    result
}

/// Check if a resolved measure is a full-measure rest (all sequences are rests).
pub(crate) fn is_full_measure_rest(rm: &ResolvedMeasure) -> bool {
    if rm.part.sequences.is_empty() {
        return false;
    }
    rm.part.sequences.iter().all(|seq| {
        // Explicit fullMeasure marker
        if seq.full_measure.is_some() {
            return true;
        }
        // Single rest event filling the measure
        seq.content.len() == 1 && seq.content[0].as_event().is_some_and(|e| e.is_rest())
    })
}

/// Detect groups of 2+ consecutive full-measure rests and return
/// (start_index, count) pairs.
pub(crate) fn detect_multimeasure_rest_groups(resolved: &[ResolvedMeasure]) -> Vec<(usize, usize)> {
    let mut groups = Vec::new();
    let mut i = 0;
    while i < resolved.len() {
        if is_full_measure_rest(&resolved[i]) {
            let start = i;
            i += 1;
            // Extend the run over consecutive full-measure rests, but STOP at any
            // bar that starts a NEW multimeasure-rest group. Standard engraving
            // interrupts a multimeasure rest at a tempo change, rehearsal mark,
            // time/key change, structural (double/final/heavy) barline, repeat or
            // jump, or a caesura/breath — the player must see these, so they can
            // never be swallowed inside a collapsed rest. Without this the run
            // greedily merged every consecutive resting bar (e.g. a span of rests
            // carrying a caesura + `rit.`/`rubato` tempos collapsed into one
            // H-bar, hiding all three).
            while i < resolved.len()
                && is_full_measure_rest(&resolved[i])
                && !starts_new_mmr_group(resolved, i)
            {
                i += 1;
            }
            let count = i - start;
            if count >= 2 {
                groups.push((start, count));
            }
        } else {
            i += 1;
        }
    }
    groups
}

/// Split caller-supplied (authored) multimeasure-rest ranges at any interior
/// measure that must begin a new MMR group — a tempo change, fermata, caesura,
/// time/key change, rehearsal mark, or structural barline/repeat/jump. Export
/// tools sometimes author a single long rest range straight across such a
/// marking; standard engraving requires the player to SEE tempo changes and
/// holds, so the range is broken there rather than swallowing them into one
/// H-bar. A segment that collapses to a single measure is dropped from the rest
/// map and rendered as an ordinary measure.
///
/// Mirrors the splitting that `detect_multimeasure_rest_groups` applies on the
/// auto-detected path, so authored and auto ranges obey the same rule. Returns
/// the rebuilt `(start_map, skip_measures)`.
pub(crate) fn split_authored_mmr_ranges(
    authored: &HashMap<usize, u32>,
    resolved: &[ResolvedMeasure],
) -> (HashMap<usize, u32>, std::collections::HashSet<usize>) {
    let mut start_map: HashMap<usize, u32> = HashMap::new();
    let mut skip: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for (&start, &dur) in authored {
        let end = (start + dur as usize).min(resolved.len());
        let mut seg_start = start;
        for i in (start + 1)..end {
            if starts_new_mmr_group(resolved, i) {
                emit_mmr_segment(&mut start_map, &mut skip, seg_start, i);
                seg_start = i;
            }
        }
        emit_mmr_segment(&mut start_map, &mut skip, seg_start, end);
    }
    (start_map, skip)
}

/// Record one resolved MMR segment `[seg_start, seg_end)`. A segment of 2+ bars
/// becomes a collapsed rest (start entry + skipped interior); a single-bar
/// segment is left as an ordinary measure (no entry, nothing skipped).
fn emit_mmr_segment(
    start_map: &mut HashMap<usize, u32>,
    skip: &mut std::collections::HashSet<usize>,
    seg_start: usize,
    seg_end: usize,
) {
    let count = seg_end.saturating_sub(seg_start);
    if count >= 2 {
        start_map.insert(seg_start, count as u32);
        for j in (seg_start + 1)..seg_end {
            skip.insert(j);
        }
    }
}

/// Whether measure `i` cannot be merged into a preceding multimeasure rest —
/// i.e. it *starts a new* multimeasure rest group. Mirrors the page-turn
/// `multimeasure_rest_break_flags` (layout/page_turn/expansion.rs) — keep the
/// two in sync — and additionally honours **part-level caesuras/breaths and
/// fermatas**, which sit on an event marking (not a global measure property)
/// and so aren't visible to the global-only page-turn predicate.
///
/// Triggers split by where they sit relative to the bar:
/// - **Start-of-measure** structure on bar `i` (time/key/tempo change, rehearsal
///   mark, either repeat boundary, volta start, segno/coda, or a caesura/fermata
///   on bar `i`) opens the new group at `i`.
/// - **End-of-measure** structure on bar `i-1` (a *structural* barline —
///   double/final/heavy, repeat end, fine, jump, or a caesura/fermata on bar
///   `i-1`) closes the previous group, so `i` opens the next one. Both repeat
///   boundaries also close their measure, leaving every repeat barline visible.
///   A plain `Regular` barline is the implicit division between every bar and
///   does NOT break.
///
/// A caesura or fermata therefore breaks on **both** sides, isolating its own
/// bar so the grand-pause / hold is always shown rather than absorbed into an
/// H-bar — the player must see where the music pauses and where the tempo
/// changes.
pub(crate) fn starts_new_mmr_group(resolved: &[ResolvedMeasure], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    let cur = &resolved[i];
    let g = &cur.global;
    let starts_here = g.time.is_some()
        || g.key.is_some()
        || g.tempos.as_ref().is_some_and(|t| !t.is_empty())
        || g.rehearsal_mark().is_some()
        || g.repeat_start.is_some()
        || g.repeat_end.is_some()
        || g.ending.is_some()
        || g.segno.is_some()
        || g.coda().is_some()
        || part_interrupts_mmr(&cur.part);

    let prev = &resolved[i - 1];
    let pg = &prev.global;
    let prev_barline_breaks = matches!(
        pg.barline.as_ref().map(|b| &b.barline_type),
        Some(
            BarlineType::Double
                | BarlineType::Final
                | BarlineType::Heavy
                | BarlineType::HeavyLight
                | BarlineType::HeavyHeavy
        )
    );
    let ends_prev = prev_barline_breaks
        || pg.repeat_start.is_some()
        || pg.repeat_end.is_some()
        || pg.fine.is_some()
        || pg.jump.is_some()
        || jump_in_ext(pg)
        || part_interrupts_mmr(&prev.part);

    starts_here || ends_prev
}

/// Vendor-extension jump (`_x.viritura.jump`) on a global measure.
fn jump_in_ext(m: &GlobalMeasure) -> bool {
    m.extensions
        .as_ref()
        .and_then(|e| e.viritura.as_ref())
        .is_some_and(|v| v.jump.is_some())
}

/// Whether any event in the part measure carries a marking that interrupts a
/// multimeasure rest: a caesura or breath (grand pause) or a fermata (hold).
/// All three must isolate the bar that carries them so the performer sees the
/// pause/hold rather than having it absorbed into a collapsed H-bar. The
/// fermata is a top-level `Event.fermata` field (per MNX v15), while
/// caesura/breath live under `Event.markings`.
fn part_interrupts_mmr(pm: &PartMeasure) -> bool {
    pm.sequences.iter().any(|s| {
        s.content.iter().any(|c| match c {
            SequenceContent::Event(e) => {
                e.fermata.is_some()
                    || e.markings
                        .as_ref()
                        .is_some_and(|mk| mk.caesura.is_some() || mk.breath.is_some())
            }
            _ => false,
        })
    })
}

// ═══════════════════════════════════════════
// Tuplet helpers
// ═══════════════════════════════════════════

/// Count leaf events in sequence content, recursing into tuplets.
#[allow(dead_code)]
pub(crate) fn count_leaf_events(content: &[SequenceContent]) -> usize {
    content
        .iter()
        .map(|sc| match sc {
            SequenceContent::Event(_) => 1,
            SequenceContent::Tuplet(t) => count_leaf_events(&t.content),
            SequenceContent::Grace(g) => g.content.len(),
            SequenceContent::MultiNoteTremolo(m) => m.content.len(),
            SequenceContent::Other(_) => 0,
            SequenceContent::Space(_) => 0,
        })
        .sum()
}

/// Find the active clef at a given beat position from a sorted list of clef changes.
pub(crate) fn active_clef_at_beat(clef_changes: &[(f64, Clef)], beat: f64) -> &Clef {
    let mut active = &clef_changes[0].1;
    for (change_beat, clef) in clef_changes {
        if *change_beat <= beat + 0.001 {
            active = clef;
        } else {
            break;
        }
    }
    active
}

/// Resolve all ottava ranges from all measures into absolute ranges.
pub(crate) fn resolve_all_ottavas(
    resolved_measures: &[ResolvedMeasure],
) -> Vec<ResolvedOttavaRange> {
    let mut result = Vec::new();
    // Map measure IDs to global index. Global indices are used in the result
    // (for ottava_diatonic_shift comparisons).
    let mut id_to_global: HashMap<String, usize> = HashMap::new();
    for rm in resolved_measures.iter() {
        if let Some(ref id) = rm.global.id {
            id_to_global.insert(id.clone(), rm.index);
        }
    }
    for rm in resolved_measures {
        if let Some(ref ottavas) = rm.part.ottavas {
            for ott in ottavas {
                let start_beat = ott.position.beats();
                let end_measure_global = id_to_global
                    .get(&ott.end.measure)
                    .copied()
                    .unwrap_or(rm.index);
                let end_beat = ott.end.position.beats();
                result.push(ResolvedOttavaRange {
                    start_measure: rm.index,
                    start_beat,
                    end_measure: end_measure_global,
                    end_beat,
                    value: ott.value,
                });
            }
        }
    }
    result
}

/// Split a PartMeasure's sequences and clefs by staff number.
/// Returns a new PartMeasure containing only sequences and clefs for the given staff.
/// When no clefs match the target staff but the original had clefs, a conventional
/// default is provided: G clef for staff 1, F clef for staff 2+.
#[allow(dead_code)] // Prepared for per-staff incremental resolution; current callers still use the whole-part path.
pub(crate) fn split_part_measure_by_staff(pm: &PartMeasure, staff_num: u32) -> PartMeasure {
    split_part_measure_by_staff_count(pm, staff_num, 1)
}

fn split_part_measure_by_staff_count(
    pm: &PartMeasure,
    staff_num: u32,
    staff_count: u32,
) -> PartMeasure {
    let sequences: Vec<_> = pm
        .sequences
        .iter()
        .filter(|s| s.staff.unwrap_or(1) == staff_num)
        .cloned()
        .collect();
    let clefs = pm.clefs.as_ref().map(|clefs| {
        clefs
            .iter()
            .filter(|c| c.staff.unwrap_or(1) == staff_num)
            .cloned()
            .collect()
    });
    PartMeasure {
        clefs,
        sequences,
        arpeggios: if staff_num == 1 {
            pm.arpeggios.clone()
        } else {
            None
        },
        non_arpeggios: if staff_num == 1 {
            pm.non_arpeggios.clone()
        } else {
            None
        },
        beams: pm.beams.clone(),
        dynamics: pm.dynamics.as_ref().map(|groups| {
            groups
                .iter()
                .filter(|group| match group.staff {
                    Some(target) => target == staff_num,
                    None if staff_count <= 1 => staff_num == 1,
                    None => match group.orient {
                        Some(MultiStaffOrientation::Below) => staff_num == staff_count,
                        _ => staff_num == 1,
                    },
                })
                .cloned()
                .map(|mut group| {
                    group.placement_above = match group.orient {
                        Some(MultiStaffOrientation::Above) => Some(true),
                        Some(MultiStaffOrientation::Below | MultiStaffOrientation::Between) => {
                            Some(false)
                        }
                        Some(MultiStaffOrientation::Auto) | None => group.placement_above,
                    };
                    group
                })
                .collect()
        }),
        ottavas: if staff_num == 1 {
            pm.ottavas.clone()
        } else {
            None
        },
        // A simile sign is engraved on every staff of the part, like a
        // whole-measure rest.
        measure_repeat: pm.measure_repeat.clone(),
        pedals: if staff_num == 1 {
            pm.pedals.clone()
        } else {
            None
        },
        chord_symbols: if staff_num == 1 {
            pm.chord_symbols.clone()
        } else {
            None
        },
        expressions: if staff_num == 1 {
            pm.expressions.clone()
        } else {
            None
        },
        condensing_override: pm.condensing_override.clone(),
    }
}

/// Returns a conventional default clef for a given staff number.
/// Staff 1: G clef (treble). Staff 2+: F clef (bass).
pub(crate) fn default_clef_for_staff(staff_num: u32) -> PositionedClef {
    if staff_num <= 1 {
        PositionedClef {
            clef: Clef {
                sign: ClefSign::G,
                staff_position: -2,
                color: None,
                glyph: None,
                octave: None,
                show_octave: None,
            },
            position: None,
            staff: Some(staff_num),
        }
    } else {
        PositionedClef {
            clef: Clef {
                sign: ClefSign::F,
                staff_position: 2,
                color: None,
                glyph: None,
                octave: None,
                show_octave: None,
            },
            position: None,
            staff: Some(staff_num),
        }
    }
}

/// Resolve measures for a specific staff of a grand staff part.
/// Inherits clefs across measures: if a measure has no clef for this staff,
/// the last active clef from a previous measure is carried forward.
pub(crate) fn resolve_measures_for_staff(
    score: &Score,
    part_index: usize,
    staff_num: u32,
) -> Vec<ResolvedMeasure> {
    let base = resolve_measures(score, part_index);
    let staff_count = score.parts.get(part_index).map_or(1, |part| part.staves);
    let mut last_clef: Option<PositionedClef> = None;

    base.into_iter()
        .map(|rm| {
            let mut split = split_part_measure_by_staff_count(&rm.part, staff_num, staff_count);

            let mut measure_clefs = split.clefs.take().unwrap_or_default();
            measure_clefs.sort_by(|a, b| {
                let (an, ad) = a.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
                let (bn, bd) = b.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
                let left = an as i64 * bd as i64;
                let right = bn as i64 * ad as i64;
                left.cmp(&right)
            });

            // Ensure each measure has a beat-0 clef context for pitch mapping.
            // Carried/default clefs are represented with position (0,1) so they
            // participate in active-clef resolution without rendering a start change.
            let has_start_clef = measure_clefs.iter().any(|c| {
                let (n, _) = c.position.as_ref().map(|p| p.fraction).unwrap_or((0, 1));
                n == 0
            });

            if !has_start_clef {
                let mut start_clef = if let Some(ref inherited) = last_clef {
                    inherited.clone()
                } else {
                    default_clef_for_staff(staff_num)
                };
                start_clef.position = Some(RhythmicPosition { fraction: (0, 1) });
                measure_clefs.insert(0, start_clef);
            }

            if let Some(c) = measure_clefs.last() {
                last_clef = Some(c.clone());
            }

            split.clefs = Some(measure_clefs);

            ResolvedMeasure {
                index: rm.index,
                global: rm.global,
                part: split,
                tie_continuation_ids: rm.tie_continuation_ids.clone(),
                measure_repeat_covered: rm.measure_repeat_covered,
                next_has_repeat_start: rm.next_has_repeat_start,
                active_time: rm.active_time,
                active_key: rm.active_key,
                prev_key: rm.prev_key,
                transposition: None,
                condensing_change: rm.condensing_change,
                kit: rm.kit.clone(),
            }
        })
        .collect()
}

/// Get the ottava diatonic shift at a given measure and beat position.
/// Returns 0 if no ottava is active. For 8va (value=1), returns -7 to
/// shift sounding pitch down one octave for display.
pub(crate) fn ottava_diatonic_shift(
    ottavas: &[ResolvedOttavaRange],
    measure_idx: usize,
    beat: f64,
) -> i32 {
    for ott in ottavas {
        let in_range = if measure_idx > ott.start_measure && measure_idx < ott.end_measure {
            true
        } else if measure_idx == ott.start_measure && measure_idx == ott.end_measure {
            beat >= ott.start_beat - 0.001 && beat < ott.end_beat + 0.001
        } else if measure_idx == ott.start_measure {
            beat >= ott.start_beat - 0.001
        } else if measure_idx == ott.end_measure {
            beat < ott.end_beat + 0.001
        } else {
            false
        };
        if in_range {
            return -ott.value * 7;
        }
    }
    0
}
