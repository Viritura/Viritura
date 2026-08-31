#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::resolve::*;
use super::super::skyline::{Skyline, SkylineDirection};
use super::super::spacing::*;
use super::super::types::*;
use super::cross_staff::*;
use super::orchestrate::*;
use super::tremolo_pair::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Compute the display diatonic position of a note, applying transposition if active.
/// When transposition is Some((staff_distance, half_steps)), uses the note's `written`
/// diatonic delta and the interval to compute the written pitch position.
pub(super) fn display_diatonic(note: &Note, transposition: Option<(i32, i32)>) -> i32 {
    if let Some((staff_distance, half_steps)) = transposition {
        let delta = note
            .written
            .as_ref()
            .and_then(|w| w.diatonic_delta)
            .unwrap_or(0);
        let written = note.pitch.transpose(staff_distance, half_steps, delta);
        written.diatonic_position()
    } else {
        note.pitch.diatonic_position()
    }
}

pub(super) fn event_layout_id(
    event: &Event,
    measure_index: usize,
    voice_index: usize,
    event_index: usize,
) -> Option<String> {
    event.id.clone().or_else(|| {
        Some(format!(
            "__auto_m{}_v{}_e{}",
            measure_index, voice_index, event_index
        ))
    })
}

/// Compute per-notehead horizontal offsets for chords containing seconds (adjacent notes).
/// mirror algorithm: iterate notes from the stem-end outward, toggling
/// displacement on each pair of adjacent notes (staff position difference < 2).
/// Returns offsets in notehead-width units (0.0 = normal, 1.0 = displaced right,
/// -1.0 = displaced left). Caller scales by notehead width in pixels.
/// Reference: standard engraving practice layoutChords2()
pub(crate) fn compute_seconds_displacement(note_positions: &[f64], stem_up: bool) -> Vec<f64> {
    let n = note_positions.len();
    if n <= 1 {
        return vec![0.0; n];
    }

    // Build sorted indices: bottom-to-top for stem-up, top-to-bottom for stem-down
    let mut sorted_indices: Vec<usize> = (0..n).collect();
    if stem_up {
        // Bottom-to-top (highest position value = lowest pitch = bottom)
        sorted_indices.sort_by(|&a, &b| {
            note_positions[b]
                .partial_cmp(&note_positions[a])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    } else {
        // Top-to-bottom (lowest position value = highest pitch = top)
        sorted_indices.sort_by(|&a, &b| {
            note_positions[a]
                .partial_cmp(&note_positions[b])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    let mut offsets = vec![0.0_f64; n];

    // Start: stem-side notes are not displaced.
    // For stem-up, the stem is on the right — default notes go to the left (offset 0),
    // displaced notes go right (+1.0 notehead width).
    // For stem-down, the stem is on the left — default notes go to the right (offset 0),
    // displaced notes go left (-1.0 notehead width).
    let mut displaced = false;

    for window_i in 1..sorted_indices.len() {
        let prev_idx = sorted_indices[window_i - 1];
        let curr_idx = sorted_indices[window_i];
        let diff = (note_positions[prev_idx] - note_positions[curr_idx]).abs();

        if diff < 2.0 {
            // Adjacent (a second) — toggle displacement
            displaced = !displaced;
        } else {
            // Not adjacent — reset
            displaced = false;
        }

        if displaced {
            offsets[curr_idx] = if stem_up { 1.0 } else { -1.0 };
        }
    }

    offsets
}

/// Compute the staff position (in half-spaces from top line) for each note
/// in an event using the active clef + ottava transposition. Kit components
/// use their declared staff position instead of pitch-derived placement.
pub(crate) fn compute_note_staff_positions(
    notes: &[Note],
    clef: &Clef,
    ott_shift: i32,
    transposition: Option<(i32, i32)>,
    kit: Option<&HashMap<String, KitComponent>>,
) -> Vec<f64> {
    notes
        .iter()
        .map(|note| {
            if let Some(kc_id) = &note.kit_component {
                let kit_pos = kit
                    .and_then(|k| k.get(kc_id.as_str()))
                    .map(|c| c.staff_position)
                    .unwrap_or(0);
                4.0 - kit_pos as f64
            } else {
                let diatonic = display_diatonic(note, transposition) + ott_shift;
                let clef_ref = clef.reference_diatonic();
                let clef_line = clef.line_from_bottom();
                let pos_from_clef_line = diatonic - clef_ref;
                (4 - clef_line) as f64 * 2.0 - pos_from_clef_line as f64
            }
        })
        .collect()
}

/// Compute the displayed pitch for each note. Applies the part's transposition
/// (using `Note.written.diatonic_delta` when set) so a transposing instrument
/// is rendered at written pitch. Kit-notes carry a placeholder C4 and are
/// passed through unchanged.
pub(super) fn compute_display_pitches(
    notes: &[Note],
    transposition: Option<(i32, i32)>,
) -> Vec<Pitch> {
    notes
        .iter()
        .map(|note| {
            if note.kit_component.is_some() {
                note.pitch.clone()
            } else if let Some((staff_distance, half_steps)) = transposition {
                let delta = note
                    .written
                    .as_ref()
                    .and_then(|w| w.diatonic_delta)
                    .unwrap_or(0);
                note.pitch.transpose(staff_distance, half_steps, delta)
            } else {
                note.pitch.clone()
            }
        })
        .collect()
}

/// Resolve stem direction. Precedence order: `event.orient`,
/// `event.stem_direction`, sequence-level `forced_stem_up`, multi-voice
/// convention, auto from average pitch position (stems-down for notes above
/// middle line).
pub(super) fn resolve_stem_up(
    orient: Option<Orientation>,
    stem_direction: Option<&StemDirection>,
    forced_stem_up: Option<bool>,
    num_voices: usize,
    voice_index: usize,
    note_positions: &[f64],
) -> bool {
    if let Some(forced) = orient.and_then(|o| o.force_stem_up()) {
        return forced;
    }
    if let Some(dir) = stem_direction {
        return matches!(dir, StemDirection::Up);
    }
    if let Some(forced) = forced_stem_up {
        return forced;
    }
    if num_voices > 1 {
        return voice_index == 0;
    }
    let avg_pos = if note_positions.is_empty() {
        4.0
    } else {
        note_positions.iter().sum::<f64>() / note_positions.len() as f64
    };
    avg_pos > 4.0
}

/// Recursively lay out events from sequence content, applying duration scaling for tuplets.
///
/// `duration_scale` is the cumulative tuplet scaling factor. For top-level events it's 1.0.
/// For events inside a tuplet with outer=2×eighth, inner=3×eighth, each inner event's
/// beat advancement is multiplied by outer_beats/inner_beats = (2×0.5)/(3×0.5) = 2/3.
pub(crate) fn layout_sequence_content(
    content: &[SequenceContent],
    events: &mut Vec<EventLayout>,
    tuplet_groups: &mut Vec<TupletGroup>,
    multi_note_tremolo_groups: &mut Vec<MultiNoteTremoloGroup>,
    beat_cursor: &mut f64,
    pending_grace: &mut Vec<GraceNoteLayout>,
    duration_scale: f64,
    total_beats: f64,
    content_width: f64,
    x_origin: f64,
    clef_changes: &[(f64, Clef)],
    num_voices: usize,
    voice_index: usize,
    measure_index: usize,
    resolved_ottavas: &[ResolvedOttavaRange],
    log_spacing: &LogSpacing,
    forced_stem_up: Option<bool>,
    sequence_staff: u32,
    transposition: Option<(i32, i32)>,
    kit: Option<&std::collections::HashMap<String, KitComponent>>,
) {
    let _ = total_beats; // currently only forwarded into recursive calls
    for sc in content {
        match sc {
            SequenceContent::Event(event) => {
                let ev_x = log_spacing.lookup_x(*beat_cursor, content_width, x_origin);

                // Find the active clef at this beat position
                let clef = active_clef_at_beat(clef_changes, *beat_cursor);

                // Compute staff positions and display pitches for notes
                let ott_shift =
                    ottava_diatonic_shift(resolved_ottavas, measure_index, *beat_cursor);
                let notes = event.notes();
                let note_positions =
                    compute_note_staff_positions(notes, clef, ott_shift, transposition, kit);
                let display_pitches = compute_display_pitches(notes, transposition);

                let stem_up = resolve_stem_up(
                    event.orient,
                    event.stem_direction.as_ref(),
                    forced_stem_up,
                    num_voices,
                    voice_index,
                    &note_positions,
                );

                // Transfer any pending grace notes to this event. Grace-note
                // stem direction is resolved when the grace is collected
                // (stem-up by default, per standard engraving practice), so we
                // simply attach them here without flipping.
                let grace_notes = std::mem::take(pending_grace);

                let note_x_offsets = compute_seconds_displacement(&note_positions, stem_up);
                let shared_noteheads = vec![false; note_positions.len()];
                events.push(EventLayout {
                    x: ev_x,
                    event: event.clone(),
                    note_positions,
                    note_x_offsets,
                    shared_noteheads,
                    shared_rest: false,
                    display_pitches,
                    stem_up,
                    id: event_layout_id(event, measure_index, voice_index, events.len()),
                    grace_notes,
                    num_voices,
                    sequence_staff,
                    beat_position: *beat_cursor,
                });

                // Advance beat cursor by the scaled duration
                *beat_cursor += event.duration.total_beats() * duration_scale;
            }
            SequenceContent::Tuplet(tuplet) => {
                // Scale = outer_beats / inner_beats
                let inner_beats =
                    tuplet.inner.duration.total_beats() * tuplet.inner.multiple as f64;
                let outer_beats =
                    tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                let scale = if inner_beats > 0.0 {
                    outer_beats / inner_beats
                } else {
                    1.0
                };

                // Record first event index before recursing
                let first_idx = events.len();

                // Tuplet orient overrides forced_stem_up for events within the tuplet
                let tuplet_forced = tuplet
                    .orient
                    .and_then(|o| o.force_stem_up())
                    .or(forced_stem_up);

                // Recurse into tuplet content with compounded scale
                layout_sequence_content(
                    &tuplet.content,
                    events,
                    tuplet_groups,
                    multi_note_tremolo_groups,
                    beat_cursor,
                    pending_grace,
                    duration_scale * scale,
                    total_beats,
                    content_width,
                    x_origin,
                    clef_changes,
                    num_voices,
                    voice_index,
                    measure_index,
                    resolved_ottavas,
                    log_spacing,
                    tuplet_forced,
                    sequence_staff,
                    transposition,
                    kit,
                );

                // Record tuplet group if any events were added
                let last_idx = events.len();
                if last_idx > first_idx {
                    // Resolve bracket: default is auto (show bracket always for now;
                    // a full "auto" implementation would hide when all notes are beamed).
                    // Ref: standard engraving practice — bracket suppressed when
                    // all notes share a beam group. standard engraving practice.
                    let show_bracket = match &tuplet.bracket {
                        Some(TupletBracket::No) => false,
                        Some(TupletBracket::Yes) => true,
                        _ => true, // auto or absent: default to showing bracket
                    };

                    // Resolve showNumber: default is inner
                    let show_number = match &tuplet.show_number {
                        Some(TupletDisplaySetting::NoNumber) => TupletShowNumber::None,
                        Some(TupletDisplaySetting::Both) => TupletShowNumber::Both,
                        _ => TupletShowNumber::Inner, // inner or absent: show inner
                    };

                    tuplet_groups.push(TupletGroup {
                        first_event_idx: first_idx,
                        last_event_idx: last_idx - 1,
                        display_number: tuplet.inner.multiple,
                        outer_number: tuplet.outer.multiple,
                        show_bracket,
                        show_number,
                        orient: tuplet.orient,
                    });
                }
            }
            SequenceContent::MultiNoteTremolo(trem) => {
                // Multi-note tremolo: lay out two events, advance by outer duration
                let outer_beats = trem.outer.duration.total_beats() * trem.outer.multiple as f64;
                let per_event_beats = if !trem.content.is_empty() {
                    outer_beats / trem.content.len() as f64
                } else {
                    outer_beats
                };

                let first_idx = events.len();
                let pair = prepare_tremolo_pair(
                    trem,
                    TremoloPairContext {
                        start_beat: *beat_cursor,
                        per_event_beats,
                        duration_scale,
                        clef_changes,
                        resolved_ottavas,
                        measure_index,
                        forced_stem_up,
                        num_voices,
                        voice_index,
                        transposition,
                        kit,
                    },
                );

                for (event_index, event) in trem.content.iter().enumerate() {
                    let ev_x = log_spacing.lookup_x(*beat_cursor, content_width, x_origin);

                    let note_positions = pair.note_positions[event_index].clone();
                    let display_pitches = compute_display_pitches(event.notes(), transposition);

                    let grace_notes = std::mem::take(pending_grace);
                    let note_x_offsets =
                        compute_seconds_displacement(&note_positions, pair.stem_up);
                    let shared_noteheads = vec![false; note_positions.len()];
                    events.push(EventLayout {
                        x: ev_x,
                        event: event.clone(),
                        note_positions,
                        note_x_offsets,
                        shared_noteheads,
                        shared_rest: false,
                        display_pitches,
                        stem_up: pair.stem_up,
                        id: event_layout_id(event, measure_index, voice_index, events.len()),
                        grace_notes,
                        num_voices,
                        sequence_staff,
                        beat_position: *beat_cursor,
                    });

                    *beat_cursor += per_event_beats * duration_scale;
                }

                // Record multi-note tremolo group
                let last_idx = events.len();
                if last_idx >= first_idx + 2 {
                    multi_note_tremolo_groups.push(MultiNoteTremoloGroup {
                        first_event_idx: first_idx,
                        second_event_idx: first_idx + 1,
                        marks: trem.marks,
                    });
                }
            }
            SequenceContent::Other(_) => {
                // Unknown content type — skip
            }
            SequenceContent::Space(space) => {
                // MNX "space" — advance beat cursor without producing visible output
                *beat_cursor += space.total_beats() * duration_scale;
            }
            SequenceContent::Grace(g) => {
                // Collect grace notes; they'll be attached to the next regular event
                let clef = active_clef_at_beat(clef_changes, *beat_cursor);
                let ott_shift =
                    ottava_diatonic_shift(resolved_ottavas, measure_index, *beat_cursor);
                let is_slash = g.slash.unwrap_or(true); // default acciaccatura
                for ev in &g.content {
                    let notes = ev.notes();
                    let note_positions =
                        compute_note_staff_positions(notes, clef, ott_shift, transposition, kit);
                    // Standard engraving practice: grace notes are stem-up by
                    // default regardless of the main note's stem direction or
                    // staff position. Only an explicit orient/stem-direction
                    // override flips them.
                    let stem_up = if let Some(forced) = ev.orient.and_then(|o| o.force_stem_up()) {
                        forced
                    } else if let Some(dir) = ev.stem_direction.as_ref() {
                        matches!(dir, StemDirection::Up)
                    } else {
                        true
                    };
                    pending_grace.push(GraceNoteLayout {
                        x: 0.0, // positioned later
                        event: ev.clone(),
                        note_positions,
                        stem_up,
                        after_main: false,
                        is_slash,
                        id: ev.id.clone(),
                        color: g.color.clone(),
                    });
                }
            }
        }
    }
}

/// Compute the minimum content width for a measure using skyline-based column distance.
/// Builds right/left extent skylines for adjacent event columns and ensures no overlap.
pub(crate) fn skyline_min_content_width(
    sequences: &[Sequence],
    // Retained for the call-site signature; the per-gap floor model no longer
    // needs the measure's total beats (the trailing onset→barline gap carries
    // no collision pair and is covered by the proportional natural width).
    _total_beats: f64,
    active_key: &KeySignature,
    config: &LayoutConfig,
    sp: f64,
    common_shortest_beats: f64,
) -> f64 {
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let min_gap = 0.3 * sp;
    let lyric_gap = 0.4 * sp; // minimum gap between adjacent lyric syllables

    // Collect all beat positions from all voices
    let mut beat_positions: Vec<f64> = Vec::new();
    for seq in sequences {
        collect_beat_positions(&seq.content, &mut beat_positions, 0.0, 1.0);
    }
    beat_positions.sort_by(|a, b| a.total_cmp(b));
    beat_positions.dedup_by(|a, b| (*a - *b).abs() < 1e-6);

    if beat_positions.len() < 2 {
        return 0.0;
    }

    // For each adjacent pair of beat positions, compute minimum distance needed
    let mut min_width = 0.0_f64;
    for i in 0..beat_positions.len() - 1 {
        let beat_i = beat_positions[i];
        let beat_next = beat_positions[i + 1];
        let gap_beats = beat_next - beat_i;
        // This gap's natural log-spacing width (in px). The collision
        // requirement is applied as a LOCAL FLOOR on this gap — exactly how the
        // merged log builder treats accidental/min-spacing floors — and the
        // measure minimum is the SUM of those floored gaps. The earlier model
        // (`needed / frac_diff`) instead scaled the ENTIRE measure up so one
        // tight pair would receive `needed` as its proportional share; for a
        // short gap with a wide accidental cluster at its right onset, that tiny
        // fraction exploded the whole measure (e.g. a single eighth's cluster
        // forced a 4/4 bar to ~46sp), and the surplus then stretched every
        // elastic gap ~6x, ballooning empty space between notes.
        let log_gap_w = log_duration_width(gap_beats, common_shortest_beats, config);
        if log_gap_w < 1e-9 {
            continue;
        }
        let log_gap_px = log_gap_w * sp;

        // Compute right extent of events at beat_i
        let mut right_sky = Skyline::new(SkylineDirection::Up);
        // Compute left extent of events at beat_next
        let mut left_sky = Skyline::new(SkylineDirection::Up);

        // Collect pitched events at beat_i across sequences so we can detect
        // multi-voice unison/second collisions that will trigger horizontal
        // notehead displacement during layout (see the multi-voice shift pass
        // in `layout_measure_inner`). When such a collision is present, the
        // down-stem voice's chord shifts right by one notehead width, so we
        // must reserve that extra rightward extent in the skyline minimum;
        // otherwise the displaced notehead crowds beat_next.
        //
        // We also detect voice CROSSING: when stem-up voice's lowest note is
        // at or below stem-down voice's highest note, stems visually overlap
        // and one chord is displaced even at wider pitch intervals.
        let mut beat_i_voices: Vec<(usize, bool, Vec<i32>, u32)> = Vec::new();

        for (seq_idx, seq) in sequences.iter().enumerate() {
            // Collect all events (including inside tuplets/tremolos) with beat positions
            let flat_events = collect_flat_events(&seq.content, 0.0, 1.0);
            for (beat_cursor, ev) in &flat_events {
                if (*beat_cursor - beat_i).abs() < 1e-6 {
                    let notehead = smufl::notehead_glyph(&ev.duration.base);
                    let notehead_right = smufl::notehead_right_extent(notehead) * sp;
                    let mut right = notehead_right;
                    if let Some(dots) = ev.duration.dots.filter(|dots| *dots > 0) {
                        let dot_right = smufl::glyph_bbox(smufl::AUGMENTATION_DOT).2 * sp;
                        right += (0.4 + f64::from(dots - 1) * 0.5) * sp + dot_right;
                    }
                    if ev
                        .markings
                        .as_ref()
                        .and_then(|m| m.tremolo.as_ref())
                        .is_some()
                        && ev.duration.base.has_stem()
                    {
                        let trem_overhang = 0.6 * sp;
                        right = right.max(notehead_w + trem_overhang);
                    }
                    if let Some(lyric_hw) = max_lyric_half_width(ev, sp) {
                        let lyric_right = notehead_w * 0.5 + lyric_hw + lyric_gap;
                        right = right.max(lyric_right);
                    }
                    right_sky.add_building(0.0, 8.0, right);

                    if let Some(notes) = &ev.notes {
                        let positions: Vec<i32> =
                            notes.iter().map(|n| n.pitch.diatonic_position()).collect();
                        if !positions.is_empty() {
                            // Approximate stem direction per sequence: use the
                            // explicit forced_stem_up if set (covers divisi);
                            // otherwise fall back to the auto multi-voice rule
                            // (voice 0 = up, others = down).
                            let stem_up = seq.forced_stem_up.unwrap_or(seq_idx == 0);
                            // Visual staff (event override, else sequence staff)
                            // so cross-staff voices of a grand staff are not
                            // compared (their pitches never displace each other).
                            let visual_staff = ev.staff.unwrap_or(seq.staff.unwrap_or(1));
                            beat_i_voices.push((seq_idx, stem_up, positions, visual_staff));
                        }
                    }
                }
                if (*beat_cursor - beat_next).abs() < 1e-6 {
                    let mut left = 0.0_f64;
                    if let Some(notes) = &ev.notes {
                        // Reserve the FULL stacked accidental column, not just a
                        // single accidental's width. A chord with several
                        // accidentals whose vertical extents overlap cascades
                        // them into multiple columns that protrude farther left
                        // than any one glyph. Using a single accidental's width
                        // here under-reserves, so when the measure is compressed
                        // toward this skyline minimum the leftmost accidental
                        // overflows into the previous notehead. Standard
                        // engraving practice keeps the whole column clear.
                        // Must match the placement gap in render_events.rs and
                        // the spacing reservation in accidental_padding_sp.
                        let acc_note_gap = 0.20 * sp;
                        let extent = event_accidental_extent_sp(
                            notes,
                            active_key,
                            &mut HashMap::new(),
                            None,
                            0.0,
                            None,
                        ) * sp;
                        if extent > 0.0 {
                            left = left.max(extent + acc_note_gap);
                        }
                    }
                    if ev
                        .markings
                        .as_ref()
                        .and_then(|m| m.tremolo.as_ref())
                        .is_some()
                        && ev.duration.base.has_stem()
                    {
                        let trem_overhang = 0.6 * sp;
                        left = left.max(trem_overhang);
                    }
                    if let Some(lyric_hw) = max_lyric_half_width(ev, sp) {
                        let lyric_left = lyric_hw - notehead_w * 0.5 + lyric_gap;
                        left = left.max(lyric_left.max(0.0));
                    }
                    left_sky.add_building(0.0, 8.0, left);
                }
            }
        }

        // Cross-voice unison/second/crossing detection at beat_i. Either
        // (a) notes within a diatonic second OR (b) crossed voices (stem-up
        // voice's lowest pitch ≤ stem-down voice's highest pitch) triggers
        // a notehead-width horizontal displacement in the layout pass; we
        // must reserve that extra rightward extent here.
        let mut max_displacement: f64 = 0.0;
        for i in 0..beat_i_voices.len() {
            for j in (i + 1)..beat_i_voices.len() {
                let (seq_i, stem_i, ref pos_i, staff_i) = beat_i_voices[i];
                let (seq_j, stem_j, ref pos_j, staff_j) = beat_i_voices[j];
                if seq_i == seq_j {
                    continue;
                }
                // Different visual staves never displace each other — their
                // pitches are not on a shared staff, so the unison/second/
                // crossing tests below would be meaningless across them.
                if staff_i != staff_j {
                    continue;
                }
                let mut min_diff = i32::MAX;
                for &pa in pos_i {
                    for &pb in pos_j {
                        let d = (pa - pb).abs();
                        if d < min_diff {
                            min_diff = d;
                        }
                    }
                }
                let mut collides = min_diff <= 1;
                if !collides && stem_i != stem_j {
                    // Voice crossing: stem-up's lowest pitch ≤ stem-down's
                    // highest pitch (higher diatonic_position = higher pitch),
                    // and the gap is within one stem-length (~7 diatonic steps)
                    // so the stems actually overlap.
                    let (up_pos, down_pos) = if stem_i {
                        (pos_i, pos_j)
                    } else {
                        (pos_j, pos_i)
                    };
                    let up_lowest = up_pos.iter().cloned().min().unwrap_or(i32::MAX);
                    let down_highest = down_pos.iter().cloned().max().unwrap_or(i32::MIN);
                    if up_lowest <= down_highest && down_highest - up_lowest <= 7 {
                        collides = true;
                    }
                }
                if collides {
                    max_displacement = max_displacement.max(notehead_w);
                }
            }
        }
        if max_displacement > 0.0 {
            right_sky.add_building(0.0, 8.0, notehead_w + max_displacement);
        }

        // The minimum distance between these columns
        let right_max = right_sky
            .max_height_in_range(-1.0, 9.0)
            .unwrap_or(notehead_w);
        let left_max = left_sky.max_height_in_range(-1.0, 9.0).unwrap_or(0.0);
        let needed = right_max + left_max + min_gap;

        // Local floor: this gap gets at least its natural log width, or the
        // collision requirement, whichever is larger. Summing these per-gap
        // floors yields a measure minimum that grows only by the LOCAL deficit
        // at each tight pair, never by a global proportional blow-up.
        min_width += log_gap_px.max(needed);
    }

    min_width
}

/// Compute the maximum half-width of lyric text across all lyric lines on an event.
/// Returns None if the event has no lyrics.
/// Uses the same font size as render_lyrics (1.6 * sp) and a per-character
/// average width of 0.5 * font_size for serif proportional text.
pub(super) fn max_lyric_half_width(ev: &Event, sp: f64) -> Option<f64> {
    let lyrics = ev.lyrics.as_ref()?;
    let lines = lyrics.lines.as_ref()?;
    if lines.is_empty() {
        return None;
    }
    let font_size = 1.6 * sp;
    let char_width = 0.5 * font_size; // average serif character width
    let max_w = lines
        .values()
        .map(|line| line.text.len() as f64 * char_width)
        .fold(0.0_f64, f64::max);
    if max_w > 0.0 {
        Some(max_w * 0.5) // half-width for centering
    } else {
        None
    }
}

/// Flatten sequence content into (beat_position, &Event) pairs.
/// Recurses into tuplets and multi-note tremolos with proper duration scaling.
pub(super) fn collect_flat_events(
    content: &[SequenceContent],
    cursor: f64,
    scale: f64,
) -> Vec<(f64, &Event)> {
    let mut result = Vec::new();
    let mut c = cursor;
    for sc in content {
        match sc {
            SequenceContent::Event(ev) => {
                result.push((c, ev));
                c += ev.duration.total_beats() * scale;
            }
            SequenceContent::Tuplet(tuplet) => {
                let inner_beats =
                    tuplet.inner.duration.total_beats() * tuplet.inner.multiple as f64;
                let outer_beats =
                    tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                let tuplet_scale = if inner_beats > 0.0 {
                    outer_beats / inner_beats
                } else {
                    1.0
                };
                result.extend(collect_flat_events(
                    &tuplet.content,
                    c,
                    scale * tuplet_scale,
                ));
                c += outer_beats * scale;
            }
            SequenceContent::MultiNoteTremolo(trem) => {
                let outer_beats = trem.outer.duration.total_beats() * trem.outer.multiple as f64;
                let per_event = if !trem.content.is_empty() {
                    outer_beats / trem.content.len() as f64
                } else {
                    outer_beats
                };
                for ev in &trem.content {
                    result.push((c, ev));
                    c += per_event * scale;
                }
            }
            SequenceContent::Space(space) => {
                c += space.total_beats() * scale;
            }
            _ => {}
        }
    }
    result
}

/// Collect beat positions from sequence content.
pub(super) fn collect_beat_positions(
    content: &[SequenceContent],
    beats: &mut Vec<f64>,
    cursor: f64,
    scale: f64,
) {
    let mut c = cursor;
    for sc in content {
        match sc {
            SequenceContent::Event(ev) => {
                beats.push(c);
                c += ev.duration.total_beats() * scale;
            }
            SequenceContent::Tuplet(tuplet) => {
                let inner_beats =
                    tuplet.inner.duration.total_beats() * tuplet.inner.multiple as f64;
                let outer_beats =
                    tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                let tuplet_scale = if inner_beats > 0.0 {
                    outer_beats / inner_beats
                } else {
                    1.0
                };
                collect_beat_positions(&tuplet.content, beats, c, scale * tuplet_scale);
                c += outer_beats * scale;
            }
            SequenceContent::MultiNoteTremolo(trem) => {
                let outer_beats = trem.outer.duration.total_beats() * trem.outer.multiple as f64;
                let per_event = if !trem.content.is_empty() {
                    outer_beats / trem.content.len() as f64
                } else {
                    outer_beats
                };
                for _ in &trem.content {
                    beats.push(c);
                    c += per_event * scale;
                }
            }
            SequenceContent::Space(space) => {
                c += space.total_beats() * scale;
            }
            _ => {}
        }
    }
}

pub(super) fn sequence_content_total_beats(content: &[SequenceContent], scale: f64) -> f64 {
    let mut total = 0.0;
    for sc in content {
        match sc {
            SequenceContent::Event(event) => {
                total += event.duration.total_beats() * scale;
            }
            SequenceContent::Tuplet(tuplet) => {
                let inner_beats =
                    tuplet.inner.duration.total_beats() * tuplet.inner.multiple as f64;
                let outer_beats =
                    tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                let tuplet_scale = if inner_beats > 0.0 {
                    outer_beats / inner_beats
                } else {
                    1.0
                };
                total += sequence_content_total_beats(&tuplet.content, scale * tuplet_scale);
            }
            SequenceContent::MultiNoteTremolo(trem) => {
                total += trem.outer.duration.total_beats() * trem.outer.multiple as f64 * scale;
            }
            SequenceContent::Space(space) => {
                total += space.total_beats() * scale;
            }
            _ => {}
        }
    }
    total
}
