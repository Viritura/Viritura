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

pub(crate) type AccidentalState = HashMap<(String, i32), i32>;

pub(crate) fn resolve_display_key(
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    key_fifths_flip_at: Option<i32>,
) -> (KeySignature, i32) {
    if active_key.atonal == Some(true) {
        (active_key.clone(), 0)
    } else if let Some((_, half_steps)) = transposition {
        active_key.transpose_with_diatonic_adjustment(half_steps, key_fifths_flip_at)
    } else {
        (active_key.clone(), 0)
    }
}

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
        let tied_continuation = note
            .id
            .as_ref()
            .is_some_and(|id| incoming_ties.contains(id));

        if !tied_continuation && seen_independent.insert(state_key.clone()) {
            let changes_previous = previous_state
                .get(&state_key)
                .is_some_and(|previous_alter| *previous_alter != alter);
            if note.accidental_display.is_none() && changes_previous {
                note.accidental_display = Some(AccidentalDisplay {
                    show: true,
                    force: Some(true),
                    enclosure: None,
                });
            }
        }
        final_state.insert(state_key, alter);
    }
}

pub(crate) fn apply_automatic_courtesy_accidentals(
    measure: &mut PartMeasure,
    transposition: Option<(i32, i32)>,
    incoming_ties: &[String],
    previous_state: &AccidentalState,
) -> AccidentalState {
    let incoming_ties: HashSet<String> = incoming_ties.iter().cloned().collect();
    let mut seen_independent = HashSet::new();
    let mut final_state = HashMap::new();

    fn process_content(
        content: &mut [SequenceContent],
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
                    transposition,
                    incoming_ties,
                    previous_state,
                    seen_independent,
                    final_state,
                ),
                SequenceContent::Tuplet(tuplet) => process_content(
                    &mut tuplet.content,
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
            transposition,
            &incoming_ties,
            previous_state,
            &mut seen_independent,
            &mut final_state,
        );
    }
    final_state
}

pub(crate) fn collect_tie_targets(content: &[SequenceContent], targets: &mut Vec<String>) {
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

pub(crate) fn consume_tie_targets(content: &[SequenceContent], targets: &mut HashSet<String>) {
    for item in content {
        match item {
            SequenceContent::Event(event) => {
                for note in event.notes() {
                    if let Some(id) = &note.id {
                        targets.remove(id);
                    }
                }
            }
            SequenceContent::Tuplet(tuplet) => consume_tie_targets(&tuplet.content, targets),
            SequenceContent::MultiNoteTremolo(tremolo) => {
                for event in &tremolo.content {
                    for note in event.notes() {
                        if let Some(id) = &note.id {
                            targets.remove(id);
                        }
                    }
                }
            }
            SequenceContent::Grace(grace) => {
                for event in &grace.content {
                    for note in event.notes() {
                        if let Some(id) = &note.id {
                            targets.remove(id);
                        }
                    }
                }
            }
            SequenceContent::Space(_) | SequenceContent::Other(_) => {}
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

    // Resolve staff 1's effective staff-local meter at every measure index up
    // front (inherits until changed/reset — see `crate::model::staff_meter`).
    // Callers that resolve a specific staff of a multi-staff part use
    // `resolve_measures_for_staff` instead, which recomputes this per staff;
    // this whole-part path only ever feeds single-staff parts in practice, so
    // staff 1 is the correct (and only meaningful) staff to resolve here.
    let global_time_at = crate::model::effective_time_signature_table(globals);
    let (staff_meter_table, _issues) =
        crate::model::staff_meter::resolve_staff_meter_table(&part.measures, &global_time_at);

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
    let mut active_staff_lines = super::staff_lines::DEFAULT_STAFF_LINES;
    let mut result = Vec::new();
    let part_has_lyrics = (1..=part.staves.max(1)).any(|staff| part_staff_has_lyrics(part, staff));
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
            staff_configs: None,
            pedals: None,
            expressions: None,
            condensing_override: None,
            grouping_display_overrides: None,
            staff_meters: None,
        });
        // A direct resolve call displays this selected part. Full-score layout
        // coordinates automatic visibility across its displayed parts separately.
        let chord_symbols = if part.chord_symbol_visibility == Some(ChordSymbolVisibility::Hide) {
            None
        } else {
            global.chord_symbols().map(|global_chords| {
                global_chords
                    .iter()
                    .enumerate()
                    .map(|(index, chord)| {
                        // Written-pitch preference alone (octave instruments) must
                        // not change the concert harmony lane.
                        let chord_transposition = transposition
                            .filter(|(_, half_steps)| use_written && half_steps % 12 != 0);
                        let mut chord = super::render_annotations::chord_symbol_for_display(
                            chord,
                            chord_transposition,
                        );
                        chord.source_index = Some(index);
                        chord.source_part_index = Some(part_index);
                        chord
                    })
                    .collect()
            })
        };

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
        let (display_key, diatonic_adjustment) =
            resolve_display_key(&active_key, transposition, key_fifths_flip_at);
        let display_transposition = transposition
            .map(|(staff_distance, half_steps)| (staff_distance + diatonic_adjustment, half_steps));

        let incoming_ties = incoming_tie_targets(&part.measures, i);
        if display_key != prev_display_key {
            previous_accidental_state.clear();
        }
        let current_accidental_state = apply_automatic_courtesy_accidentals(
            &mut part_measure,
            display_transposition,
            &incoming_ties,
            &previous_accidental_state,
        );
        let measure_staff_lines = super::staff_lines::resolve_measure_staff_lines(
            &mut active_staff_lines,
            part_measure.staff_configs.as_deref(),
        );

        result.push(ResolvedMeasure {
            index: i,
            global,
            part: part_measure,
            chord_symbols,
            measure_repeat_covered: measure_is_covered_by_repeat(&part.measures, i),
            next_has_repeat_start: globals
                .get(i + 1)
                .is_some_and(|measure| measure.repeat_start.is_some()),
            active_time: active_time.clone(),
            active_key: display_key.clone(),
            prev_key: prev_display_key.clone(),
            tie_continuation_ids: incoming_ties,
            active_staff_lines: measure_staff_lines,
            transposition,
            written_diatonic_adjustment: diatonic_adjustment,
            condensing_change: false,
            kit: part.kit.clone(),
            staff_has_lyrics: part_has_lyrics,
            effective_staff_meter: staff_meter_table.get(i).and_then(|s| s.get(&1)).cloned(),
        });
        previous_accidental_state = current_accidental_state;
        prev_display_key = display_key;
    }
    result
}

fn event_has_lyrics_on_staff(event: &Event, sequence_staff: u32, staff_num: u32) -> bool {
    event.staff.unwrap_or(sequence_staff) == staff_num
        && event
            .lyrics
            .as_ref()
            .and_then(|lyrics| lyrics.lines.as_ref())
            .is_some_and(|lines| !lines.is_empty())
}

fn content_has_lyrics_on_staff(
    content: &[SequenceContent],
    sequence_staff: u32,
    staff_num: u32,
) -> bool {
    content.iter().any(|item| match item {
        SequenceContent::Event(event) => {
            event_has_lyrics_on_staff(event, sequence_staff, staff_num)
        }
        SequenceContent::Tuplet(tuplet) => {
            content_has_lyrics_on_staff(&tuplet.content, sequence_staff, staff_num)
        }
        SequenceContent::MultiNoteTremolo(tremolo) => tremolo
            .content
            .iter()
            .any(|event| event_has_lyrics_on_staff(event, sequence_staff, staff_num)),
        SequenceContent::Grace(grace) => grace
            .content
            .iter()
            .any(|event| event_has_lyrics_on_staff(event, sequence_staff, staff_num)),
        SequenceContent::Space(_) | SequenceContent::Other(_) => false,
    })
}

pub(crate) fn part_staff_has_lyrics(part: &Part, staff_num: u32) -> bool {
    part.measures.iter().any(|measure| {
        measure.sequences.iter().any(|sequence| {
            let sequence_staff = sequence.staff.unwrap_or(1);
            content_has_lyrics_on_staff(&sequence.content, sequence_staff, staff_num)
        })
    })
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
/// H-bar. Staff-configuration changes likewise isolate their measure so even a
/// mid-measure line-count transition remains visible.
pub(crate) fn starts_new_mmr_group(resolved: &[ResolvedMeasure], i: usize) -> bool {
    if i == 0 {
        return true;
    }
    let cur = &resolved[i];
    let g = &cur.global;
    let starts_here = g.time.is_some()
        || cur
            .chord_symbols
            .as_ref()
            .is_some_and(|chords| !chords.is_empty())
        || g.key.is_some()
        || g.tempos.as_ref().is_some_and(|t| !t.is_empty())
        || g.rehearsal_mark().is_some()
        || g.repeat_start.is_some()
        || g.repeat_end.is_some()
        || g.ending.is_some()
        || g.segno.is_some()
        || g.coda().is_some()
        || has_staff_configs(&cur.part)
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
        || prev
            .chord_symbols
            .as_ref()
            .is_some_and(|chords| !chords.is_empty())
        || pg.repeat_start.is_some()
        || pg.repeat_end.is_some()
        || pg.fine.is_some()
        || pg.jump.is_some()
        || jump_in_ext(pg)
        || has_staff_configs(&prev.part)
        || part_interrupts_mmr(&prev.part);

    starts_here || ends_prev
}

fn has_staff_configs(measure: &PartMeasure) -> bool {
    measure
        .staff_configs
        .as_ref()
        .is_some_and(|configs| !configs.is_empty())
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

mod staff_split;
// `default_clef_for_staff` and `split_part_measure_by_staff` are exercised
// directly by `layout::tests::test_misc`/`test_grand_staff`/`test_layouts`
// (per-staff incremental resolution is prepared but not yet a production
// caller); a lib-only build sees them as unused without this allow.
#[allow(unused_imports)]
pub(crate) use staff_split::{
    default_clef_for_staff, resolve_measures_for_staff, split_part_measure_by_staff,
};

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
