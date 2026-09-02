// File-private to the `mnx_layout` folder module.
// Imports mirror the original `mnx_layout.rs` top block, adjusted for the
// extra folder hop (super::super::… to reach the `layout` module).

#![allow(unused_imports)]

use super::super::cache::{self, measure_content_hash};
use super::super::condensing::{
    analyze_merge_mode, find_partial_unison_onset_beat, find_unison_onset_beat,
    label_for_mode_styled, LabelStyle, MergeMode,
};
use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::full_score::{
    compute_system_object_staves, layout_full_score, FlatSource, FlatStaff, GroupRange,
};
use super::super::measure::*;
use super::super::page::*;
use super::super::page::{render_page_numbers, render_title_block, title_block_height};
use super::super::render_barlines::{render_tagged_barline_connector, BarlineGap, BarlineKind};
use super::super::resolve::*;
use super::super::spacing::LogSpacing;
use super::super::spacing::*;
use super::super::system::*;
use super::super::types::*;
use super::super::{
    compute_above_staff_extra, compute_below_staff_extra_from_layouts, render_system_contents,
};
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

pub(super) use super::cache_hashing::{compound_layout_hash, time_signature_aware_hash};
pub(super) use super::instrument_labels::{
    build_label_lines, label_gutter_extent, split_label_transposition, EXPANSION_COLOR,
};
pub(super) use super::slur_tie_collection::collect_system_slur_data;
pub(super) use super::staff_grouping::staves_share_group;
pub(super) use super::staff_placement::{compute_staff_y_offsets_for_system, StaffYPlacement};
pub(super) use super::structure_flattening::{
    build_measure_id_map, build_part_id_map, compute_flat_staff_transposition, flatten_layout,
};

/// Apply the constant galley headroom (Lever 0): shift every coordinate store
/// down by a FIXED reserve so above-staff protrusion sits inside the workspace.
///
/// The offset is a constant (`pad_y`), not content-derived, so it is stable
/// across edits — a high ledger note no longer re-shifts the whole galley.
/// This lets chunked-horizon retained segments stay at a stable absolute y and
/// horizon patch frames engage. Continuous-layout views reserve constant
/// vertical space rather than re-fitting after every edit.
///
/// Width/height are left at their structural values (set at `DisplayList`
/// construction: `page_w` × `total_height`) — NOT trimmed to a content scan —
/// so the full-frame and patch-frame galley dimensions agree (the patch frame
/// carries the same structural dims and applies this same constant offset via
/// its `galley_offset_y` scalar).
pub(super) fn fit_unpaged_bounds(dl: &mut DisplayList, pad_y: f64, _pad_x: f64) {
    dl.translate(0.0, pad_y);
}

/// Split a staff label into two lines when it contains a transposition
/// (e.g. "Clarinet in BΓÖ¡ 1" ΓåÆ ("Clarinet", "in BΓÖ¡ 1")).
/// Returns (line1, Option<line2>). When there's no transposition, line2 is None.
/// Build the final label lines for a staff, merging condensed numbers into the text.
///
/// For condensed staves (e.g. "Fl." + [1, 2]):
///   - With transposition ("Cl. in BΓÖ¡" + [1, 2]): ["Cl. 1", "in BΓÖ¡ 2"]
///     (numbers appended to each text line)
///   - Without transposition ("Trumpet" + [1, 2]): ["Trumpet"]
///     (just the name; numbers are rendered as a separate column by the caller)
///
/// For non-condensed staves, returns the label split by transposition as before.
/// Accurate pixel extent of a staff label, measured from its right-hand anchor
/// (`label_x` in `render_staff_labels`) to its leftmost glyph. Mirrors the
/// rendering geometry exactly: serif name lines at 2 sp, plus an optional
/// number column for condensed staves. Used to size the instrument-name gutter
/// so the longest label hugs the left margin instead of relying on a crude
/// character-count estimate that over- or under-reserves space.
/// Filter sequences in a part measure based on layout source constraints.
pub(super) fn filter_sequences_for_source(
    part_measure: &PartMeasure,
    source: &FlatSource,
    voice_index_offset: usize,
) -> Vec<Sequence> {
    let forced_stem = match source.stem_direction.as_deref() {
        Some("up") => Some(true),
        Some("down") => Some(false),
        _ => None,
    };

    let mut result = Vec::new();
    for (seq_idx, seq) in part_measure.sequences.iter().enumerate() {
        // Filter by staff number if specified
        if let Some(staff_num) = source.staff_number {
            if let Some(seq_staff) = seq.staff {
                if seq_staff != staff_num {
                    continue;
                }
            }
        }
        // Filter by voice name if specified
        if let Some(ref voice_filter) = source.voice_filter {
            if let Some(ref seq_voice) = seq.voice {
                if seq_voice != voice_filter {
                    continue;
                }
            } else {
                continue; // No voice on sequence but filter requires one
            }
        }
        let mut s = seq.clone();
        if forced_stem.is_some() {
            s.forced_stem_up = forced_stem;
        }
        s.source_seq_index = Some(seq_idx);
        result.push(s);
    }
    // If no sequences matched and source has no filters, include all
    if result.is_empty() && source.staff_number.is_none() && source.voice_filter.is_none() {
        result = part_measure
            .sequences
            .iter()
            .enumerate()
            .map(|(seq_idx, seq)| {
                let mut s = seq.clone();
                if forced_stem.is_some() {
                    s.forced_stem_up = forced_stem;
                }
                s.source_seq_index = Some(seq_idx);
                s
            })
            .collect();
    }
    let _ = voice_index_offset;
    result
}

/// Merge events from multiple sequences into a single sequence by combining notes
/// at the same rhythmic position into chords. Events are aligned by cumulative beat
/// position. When multiple sources have events at the same beat, their notes are merged.
/// Rests are dropped when a note event exists at the same position from another source.
pub(super) fn merge_sequences_as_chords(
    sequences: &[Sequence],
    measure_index: usize,
) -> Vec<Sequence> {
    if sequences.is_empty() {
        return Vec::new();
    }
    if sequences.len() == 1 {
        return sequences.to_vec();
    }

    // Use the first sequence as a structural template (preserving Grace, Space, Tuplet nodes).
    // Merge notes from other sequences at each Event beat position.
    // This ensures grace notes, tuplets, etc. survive the merge.

    struct BeatEvent {
        beat: f64,
        event_index: usize,
        event: Event,
    }

    let template = &sequences[0];
    let any_full_measure = sequences.iter().find_map(|s| s.full_measure.clone());

    // Extract beat-positioned events from non-template sequences for merging
    let mut other_beat_events: Vec<Vec<BeatEvent>> = Vec::new();
    for seq in &sequences[1..] {
        let mut beat_cursor = 0.0;
        let mut beat_events = Vec::new();
        let mut event_index = 0;
        for item in &seq.content {
            match item {
                SequenceContent::Event(ev) => {
                    beat_events.push(BeatEvent {
                        beat: beat_cursor,
                        event_index,
                        event: ev.clone(),
                    });
                    event_index += 1;
                    beat_cursor += ev.duration.total_beats();
                }
                SequenceContent::Space(sp) => {
                    beat_cursor += sp.total_beats();
                }
                SequenceContent::Tuplet(tuplet) => {
                    let outer_beats =
                        tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                    beat_cursor += outer_beats;
                }
                _ => {} // Grace doesn't advance beat
            }
        }
        other_beat_events.push(beat_events);
    }

    // Walk the template, merging notes from other sources at each Event
    let mut merged_content: Vec<SequenceContent> = Vec::new();
    let mut beat_cursor = 0.0;
    let mut template_event_index = 0;

    for item in &template.content {
        match item {
            SequenceContent::Event(ev) => {
                let beat_pos = beat_cursor;
                beat_cursor += ev.duration.total_beats();
                let event_suffix = element_id::event_suffix(ev.id.as_deref(), template_event_index);
                template_event_index += 1;

                let mut merged_notes: Vec<Note> = Vec::new();
                let mut base_event = ev.clone();
                let mut merged_slurs: Vec<Slur> = Vec::new();

                // Collect notes from template event
                if !ev.is_rest() {
                    if let Some(notes) = &ev.notes {
                        let src_part = template.source_part_index;
                        for (ni, note) in notes.iter().enumerate() {
                            let mut n = note.clone();
                            n.source_part_index = src_part;
                            n.source_event_id =
                                src_part
                                    .zip(template.source_seq_index)
                                    .map(|(part, sequence)| {
                                        element_id::event(
                                            part,
                                            measure_index,
                                            sequence,
                                            &event_suffix,
                                        )
                                    });
                            n.source_note_index = Some(ni);
                            merged_notes.push(n);
                        }
                    }
                }
                if let Some(ref slurs) = ev.slurs {
                    merged_slurs.extend(slurs.iter().cloned());
                }

                // Merge from other sources
                for (src_idx, source_events) in other_beat_events.iter().enumerate() {
                    let src_part = sequences[src_idx + 1].source_part_index;
                    for be in source_events {
                        if (be.beat - beat_pos).abs() < 1e-9 {
                            if !be.event.is_rest() {
                                if let Some(notes) = &be.event.notes {
                                    for (ni, note) in notes.iter().enumerate() {
                                        let mut n = note.clone();
                                        n.source_part_index = src_part;
                                        n.source_event_id = src_part
                                            .zip(sequences[src_idx + 1].source_seq_index)
                                            .map(|(part, sequence)| {
                                                element_id::event(
                                                    part,
                                                    measure_index,
                                                    sequence,
                                                    &element_id::event_suffix(
                                                        be.event.id.as_deref(),
                                                        be.event_index,
                                                    ),
                                                )
                                            });
                                        n.source_note_index = Some(ni);
                                        merged_notes.push(n);
                                    }
                                }
                            }
                            if let Some(ref slurs) = be.event.slurs {
                                merged_slurs.extend(slurs.iter().cloned());
                            }
                            break;
                        }
                    }
                }

                if !merged_notes.is_empty() {
                    // Deduplicate notes by pitch ΓÇö in unison mode, all sources play the same
                    // pitches, so we only need one notehead per pitch.
                    merged_notes.sort_by_key(|n| n.pitch.diatonic_position());
                    merged_notes.dedup_by(|a, b| a.pitch == b.pitch);
                    base_event.notes = Some(merged_notes);
                    base_event.rest = None;
                }
                if !merged_slurs.is_empty() {
                    base_event.slurs = Some(merged_slurs);
                } else {
                    base_event.slurs = None;
                }
                merged_content.push(SequenceContent::Event(base_event));
            }
            SequenceContent::Space(sp) => {
                beat_cursor += sp.total_beats();
                merged_content.push(item.clone());
            }
            SequenceContent::Tuplet(tuplet) => {
                let outer_beats =
                    tuplet.outer.duration.total_beats() * tuplet.outer.multiple as f64;
                beat_cursor += outer_beats;
                merged_content.push(item.clone());
            }
            // Grace, MultiNoteTremolo, Other ΓÇö pass through from template
            _ => {
                merged_content.push(item.clone());
            }
        }
    }

    vec![Sequence {
        content: merged_content,
        full_measure: any_full_measure,
        staff: None,
        voice: None,
        orient: None,
        forced_stem_up: None,
        source_part_index: None,
        source_seq_index: None,
    }]
}

/// Build a virtual PartMeasure by merging sequences from multiple sources onto one staff.
/// Returns the PartMeasure and the condensing merge mode (if applicable).
/// The caller is responsible for adding player labels (only at mode transitions).
#[allow(clippy::too_many_lines)] // single virtual-measure merge pass; cohesive, splitting would obscure flow
pub(super) fn build_virtual_part_measure(
    flat_staff: &FlatStaff,
    measure_index: usize,
    score: &Score,
) -> (PartMeasure, Option<MergeMode>) {
    let mut all_sequences = Vec::new();
    let mut clefs: Option<Vec<PositionedClef>> = None;
    let mut dynamics: Option<Vec<DynamicGroup>> = None;
    let mut expressions: Option<Vec<TextExpression>> = None;
    let mut pedals: Option<Vec<Pedal>> = None;
    let mut ottavas: Option<Vec<Ottava>> = None;
    let mut measure_repeat: Option<MeasureRepeat> = None;
    let mut chord_symbols: Option<Vec<ChordSymbol>> = None;
    let mut beams = Vec::new();

    // --- Condensing merge mode analysis ---
    // When condensing with multiple sources, analyze parts to determine rendering mode.
    let condensing_mode = if flat_staff.is_condensing() {
        // Transposition constraint: sources with different transpositions cannot condense
        // (they produce different key signatures in written pitch mode).
        // Ref: docs/plans/condensing-and-doubling.md ┬º8.5
        let transpositions_compatible = {
            let first_trans = score.parts[flat_staff.sources[0].part_index]
                .transposition
                .as_ref()
                .map(|t| (t.interval.staff_distance, t.interval.half_steps));
            flat_staff.sources.iter().skip(1).all(|src| {
                let trans = score.parts[src.part_index]
                    .transposition
                    .as_ref()
                    .map(|t| (t.interval.staff_distance, t.interval.half_steps));
                trans == first_trans
            })
        };

        if !transpositions_compatible {
            // Different transpositions ΓåÆ force divisi (each source keeps its own voice)
            Some(MergeMode::Divisi)
        } else {
            // Collect part measures for each source
            let source_pms: Vec<Option<&PartMeasure>> = flat_staff
                .sources
                .iter()
                .map(|src| {
                    let part = &score.parts[src.part_index];
                    if measure_index < part.measures.len() {
                        Some(&part.measures[measure_index])
                    } else {
                        None
                    }
                })
                .collect();

            let available: Vec<&PartMeasure> = source_pms.iter().filter_map(|pm| *pm).collect();
            if available.len() > 1 {
                // Check for user-specified condensing override on the first source's part measure
                let user_override =
                    available[0]
                        .condensing_override
                        .as_deref()
                        .and_then(|s| match s {
                            "unison" => Some(MergeMode::Unison),
                            "amalgamate" => Some(MergeMode::Amalgamate),
                            "divisi" => Some(MergeMode::Divisi),
                            "solo1" => Some(MergeMode::Solo(0)),
                            "solo2" => Some(MergeMode::Solo(1)),
                            _ => None,
                        });

                let mode = user_override.unwrap_or_else(|| analyze_merge_mode(&available));

                // Clef handling: if sources use different clefs at this measure, force divisi.
                // One staff can only display one active clef, so conflicting clefs require
                // separate voices. Ref: docs/plans/condensing-and-doubling.md ┬º8.6
                let mode = match mode {
                    MergeMode::Unison | MergeMode::Amalgamate => {
                        let first_clef = available[0]
                            .clefs
                            .as_ref()
                            .and_then(|c| c.first().map(|pc| &pc.clef));
                        let clefs_match = available.iter().skip(1).all(|pm| {
                            let clef = pm.clefs.as_ref().and_then(|c| c.first().map(|pc| &pc.clef));
                            clef == first_clef
                        });
                        if clefs_match {
                            mode
                        } else {
                            MergeMode::Divisi
                        }
                    }
                    other => other,
                };

                Some(mode)
            } else {
                None
            }
        }
    } else {
        None
    };

    // Determine which sources to include and whether to chord-merge or use stem overrides
    let use_chord_merge = matches!(
        &condensing_mode,
        Some(MergeMode::Unison) | Some(MergeMode::Amalgamate)
    );

    // For condensing divisi: auto-assign stem directions (first up, second down)
    let condensing_stem_overrides: Vec<Option<bool>> = match &condensing_mode {
        Some(MergeMode::Divisi) => {
            flat_staff
                .sources
                .iter()
                .enumerate()
                .map(|(i, _)| {
                    Some(i == 0) // first source stems up, rest stems down
                })
                .collect()
        }
        _ if flat_staff.is_condensing()
            && flat_staff
                .sources
                .iter()
                .all(|s| s.stem_direction.is_none())
            && condensing_mode.is_none() =>
        {
            // Fallback: no merge analysis result (shouldn't happen normally)
            flat_staff
                .sources
                .iter()
                .enumerate()
                .map(|(i, _)| Some(i == 0))
                .collect()
        }
        _ => flat_staff.sources.iter().map(|_| None).collect(),
    };

    // For Solo mode, only include the active source
    let active_sources: Vec<usize> = match &condensing_mode {
        Some(MergeMode::Solo(idx)) => vec![*idx],
        _ => (0..flat_staff.sources.len()).collect(),
    };

    for (src_idx, source) in flat_staff.sources.iter().enumerate() {
        // Skip inactive sources in solo mode
        if !active_sources.contains(&src_idx) {
            continue;
        }

        let part = &score.parts[source.part_index];
        if measure_index >= part.measures.len() {
            continue;
        }
        let pm = &part.measures[measure_index];

        // Take clefs from the first source that has them,
        // filtering by staff number when specified (e.g. grand staff parts)
        if clefs.is_none() {
            if let Some(ref c) = pm.clefs {
                if let Some(staff_num) = source.staff_number {
                    // Filter clefs to only those matching this staff
                    let filtered: Vec<_> = c
                        .iter()
                        .filter(|pc| pc.staff.is_none_or(|s| s == staff_num))
                        .cloned()
                        .collect();
                    if !filtered.is_empty() {
                        clefs = Some(filtered);
                    }
                } else {
                    clefs = Some(c.clone());
                }
            }
        }

        // For Unison/Amalgamate/Solo: only take directions from the first active source
        // (they're identical or we only show one). For Divisi: merge from all.
        let include_directions = match &condensing_mode {
            Some(MergeMode::Unison) | Some(MergeMode::Amalgamate) => src_idx == active_sources[0],
            Some(MergeMode::Solo(_)) => true, // only one source is active
            _ => true,                        // Divisi / AllRest / non-condensing: merge all
        };

        if include_directions {
            // Filter directions to this source's staff. For a grand-staff part
            // (e.g. piano), a `<direction>` authored on staff 2 carries
            // `staff: Some(2)`. MNX dynamic groups with no staff apply to every
            // staff in the part. A `between` group is emitted once on its upper
            // anchor staff (explicit `staff`, or staff 1 for a two-staff part).
            // Other direction kinds retain their established staff-1 default.
            let legacy_staff_matches = |dir_staff: Option<u32>| match source.staff_number {
                None => true,
                Some(n) => dir_staff.unwrap_or(1) == n,
            };
            if let Some(ref d) = pm.dynamics {
                dynamics.get_or_insert_with(Vec::new).extend(
                    d.iter()
                        .filter(|group| match source.staff_number {
                            None => true,
                            Some(n) => match group.staff {
                                Some(staff) => staff == n,
                                None if group.orient == Some(MultiStaffOrientation::Between) => {
                                    n == 1
                                }
                                None => true,
                            },
                        })
                        .cloned()
                        .map(|mut group| {
                            group.source_part_index = Some(source.part_index);
                            group
                        }),
                );
            }
            if let Some(ref e) = pm.expressions {
                expressions.get_or_insert_with(Vec::new).extend(
                    e.iter()
                        .enumerate()
                        .filter(|(_, expression)| legacy_staff_matches(expression.staff))
                        .map(|(expression_index, expression)| {
                            let mut expression = expression.clone();
                            expression.source_part_index = Some(source.part_index);
                            expression.source_expression_index = Some(expression_index);
                            expression
                        }),
                );
            }
            if let Some(ref p) = pm.pedals {
                pedals
                    .get_or_insert_with(Vec::new)
                    .extend(p.iter().filter(|x| legacy_staff_matches(x.staff)).cloned());
            }
            if let Some(ref o) = pm.ottavas {
                ottavas
                    .get_or_insert_with(Vec::new)
                    .extend(o.iter().filter(|x| legacy_staff_matches(x.staff)).cloned());
            }
        }

        // Condensed staves share one simile sign; the first source that carries
        // one wins.
        if measure_repeat.is_none() {
            measure_repeat.clone_from(&pm.measure_repeat);
        }
        if let Some(ref cs) = pm.chord_symbols {
            chord_symbols
                .get_or_insert_with(Vec::new)
                .extend(cs.iter().cloned());
        }
        if let Some(ref source_beams) = pm.beams {
            beams.extend(source_beams.clone());
        }

        let seqs = filter_sequences_for_source(pm, source, src_idx);
        // Apply condensing stem overrides if no explicit stem direction
        let seqs: Vec<Sequence> = if let Some(forced) = condensing_stem_overrides[src_idx] {
            seqs.into_iter()
                .map(|mut s| {
                    if s.forced_stem_up.is_none() {
                        s.forced_stem_up = Some(forced);
                    }
                    s.source_part_index = Some(source.part_index);
                    s
                })
                .collect()
        } else {
            seqs.into_iter()
                .map(|mut s| {
                    s.source_part_index = Some(source.part_index);
                    s
                })
                .collect()
        };
        all_sequences.extend(seqs);
    }

    // Rest hiding for condensing: in divisi mode, suppress sequences that contain
    // only rests (no pitched notes). This avoids cluttering the condensed staff with
    // explicit rests for the inactive voice ΓÇö a player label is shown instead.
    // Ref: docs/plans/condensing-and-doubling.md ┬º8.4
    let all_sequences = if matches!(condensing_mode, Some(MergeMode::Divisi)) {
        all_sequences
            .into_iter()
            .filter(|seq| {
                seq.content
                    .iter()
                    .any(|c| matches!(c, SequenceContent::Event(ev) if !ev.is_rest()))
            })
            .collect()
    } else {
        all_sequences
    };

    // In chord merge mode (or Unison/Amalgamate condensing), combine into single chords
    let sequences = if use_chord_merge {
        merge_sequences_as_chords(&all_sequences, measure_index)
    } else {
        all_sequences
    };

    (
        PartMeasure {
            clefs,
            sequences,
            arpeggios: None,
            non_arpeggios: None,
            beams: (!beams.is_empty()).then_some(beams),
            dynamics,
            ottavas,
            measure_repeat,
            pedals,
            chord_symbols,
            expressions,
            condensing_override: None,
        },
        condensing_mode,
    )
}

/// Layout a score using automatic system breaking with a specified layout and optional MMR.
///
/// Used when an MNX score definition has a `layout` reference but no explicit `pages`/`systems`.
/// For an Amalgamate (mid-measure unison entry/exit) or partial-unison Divisi
/// (one source rests then joins) measure, append an "a N" text expression at
/// the onset beat. Returns true when a label was appended.
pub(super) fn append_partial_unison_label(
    virtual_pm: &mut PartMeasure,
    mode: Option<&MergeMode>,
    flat_staff: &FlatStaff,
    score: &Score,
    measure_index: usize,
    active_time: &TimeSignature,
) -> bool {
    let source_count = flat_staff.sources.len() as u32;
    if source_count < 2 {
        return false;
    }
    let cur_pms: Vec<&PartMeasure> = flat_staff
        .sources
        .iter()
        .filter_map(|src| score.parts.get(src.part_index)?.measures.get(measure_index))
        .collect();
    if cur_pms.len() < 2 {
        return false;
    }
    let onset_beat = match mode {
        Some(MergeMode::Amalgamate) => find_unison_onset_beat(&cur_pms),
        Some(MergeMode::Divisi) => find_partial_unison_onset_beat(&cur_pms),
        _ => return false,
    };
    let Some(onset_beat) = onset_beat else {
        return false;
    };
    let total_beats = active_time.count as f64 * 4.0 / active_time.unit as f64;
    let frac_num = (onset_beat * 1000.0).round() as u32;
    let frac_den = (total_beats * 1000.0).round() as u32;
    virtual_pm
        .expressions
        .get_or_insert_with(Vec::new)
        .push(TextExpression {
            text: format!("a {source_count}"),
            position: RhythmicPosition {
                fraction: (frac_num, frac_den),
            },
            placement: Some(ExpressionPlacement::Above),
            staff: None,
            voice: None,
            source_part_index: None,
            source_expression_index: None,
            manual_offset: None,
            avoid_collisions: None,
        });
    true
}

/// Render group brackets and braces in the left margin of a system, including
/// any group labels (e.g. "Hpsd." on a labelled brace).
///
/// Pure visual writer: appends to `dl`, reads nothing back. Caller has already
/// resolved `staff_y_offsets` (system Y positions for this system).
#[allow(clippy::too_many_arguments)] // pipeline boundary ΓÇö all inputs are required
pub(super) fn render_group_brackets_and_braces(
    dl: &mut DisplayList,
    group_ranges: &[GroupRange],
    staff_y_offsets: &[f64],
    margin_left: f64,
    staff_height: f64,
    sp: f64,
    config: &LayoutConfig,
    render_brace_labels: bool,
) {
    super::staff_grouping::render_group_brackets_and_braces(
        dl,
        group_ranges,
        staff_y_offsets,
        margin_left,
        staff_height,
        sp,
        config,
        render_brace_labels,
    );
}

/// Render the per-staff instrument labels in the left margin of a system.
///
/// Handles long vs. short labels (first system vs. subsequent), labelled-brace
/// group suppression, and the optional condensed-number column ("1 / 2 / 3")
/// drawn to the right of the name column.
#[allow(clippy::too_many_arguments)] // pipeline boundary — all inputs are required
pub(super) fn render_staff_labels(
    dl: &mut DisplayList,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    staff_y_offsets: &[f64],
    label_x: f64,
    staff_height: f64,
    sp: f64,
    sys_idx: usize,
    style: &crate::layout::text_styles::TextStyle,
) {
    super::instrument_labels::render_staff_labels(
        dl,
        flat_staves,
        group_ranges,
        staff_y_offsets,
        label_x,
        staff_height,
        sp,
        sys_idx,
        style,
    );
}

/// Render staff lines + per-staff measure contents for one system, and capture
/// the slur events / system bounds needed for the cross-system slur post-pass.
///
/// Combines the original Phase 3 staff-line emission with the per-staff
/// `render_system_contents` loop. Caller owns `dl`, `slur_bounds`, and
/// `global_slur_events`; this function appends to all three.
#[allow(clippy::too_many_arguments)] // pipeline boundary ΓÇö all inputs are required
pub(super) fn render_system_staves_and_contents(
    dl: &mut DisplayList,
    all_staff_layouts: &[Vec<MeasureLayout>],
    flat_staves: &[FlatStaff],
    staff_y_offsets: &[f64],
    next_sys_clef_per_staff: &[Option<&Clef>],
    score: &Score,
    lyric_line_order: Option<&[String]>,
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
    sys_idx: usize,
    system_count: usize,
    suppress_final_barline: bool,
    // Logical system index recorded in `measure_bounds.system_index`. For
    // stitched-horizon chunks this is forced to 0 so the whole galley reads as
    // one logical system (chunk membership is implicit in measure x-ranges),
    // keeping output byte-identical to the un-chunked single-system layout.
    // `sys_idx` is still used for retention keying and last-system furniture.
    logical_system_index: usize,
    slur_bounds: &mut HashMap<(usize, usize, usize), super::super::slurs::SystemSlurBounds>,
    global_slur_events: &mut Vec<super::super::slurs::GlobalSlurEvent>,
    global_tie_notes: &mut Vec<super::super::ties::GlobalTieNote>,
    // Clef-change measure set scoped to the staves shown in this system (the
    // same set used for the inter-staff connectors), so an individual-part view
    // never reserves a leading-clef gap for another part's clef change.
    clef_change_measures: &std::collections::HashSet<usize>,
    // Optional GLOBAL per-staff tie-accidental maps (indexed by `staff_idx`),
    // built once over the whole galley. Passed by the stitched-horizon caller so
    // a tie crossing a chunk seam keeps its accidental suppressed; `None` falls
    // back to a per-system map (correct for non-chunked single-system renders).
    tie_maps_per_staff: Option<&[HashMap<String, bool>]>,
) {
    render_system_staff_lines(
        dl,
        all_staff_layouts,
        flat_staves,
        staff_y_offsets,
        margin_left,
        sp,
        config,
    );

    // Render contents for each staff. The accumulator remains shared across
    // calls, preserving the established voice/staff accidental ordering.
    let mut acc_obstacles: Vec<AccidentalObstacle> = Vec::new();
    for staff_idx in 0..all_staff_layouts.len() {
        render_system_staff_content(
            dl,
            all_staff_layouts,
            flat_staves,
            staff_y_offsets,
            next_sys_clef_per_staff,
            score,
            lyric_line_order,
            sp,
            config,
            sys_idx,
            system_count,
            suppress_final_barline,
            logical_system_index,
            clef_change_measures,
            tie_maps_per_staff,
            staff_idx,
            &mut acc_obstacles,
        );
    }

    // System-wide pass: a harp/keyboard gliss can join two staves of one part,
    // so both endpoints must be visible to one call.
    let gliss_staves: Vec<super::super::glissando::GlissandoStaff<'_>> = all_staff_layouts
        .iter()
        .enumerate()
        .map(|(staff_idx, layouts)| (layouts.as_slice(), staff_y_offsets[staff_idx]))
        .collect();
    super::super::render_glissandos(dl, &gliss_staves, sp, config, Some(staff_y_offsets));

    // Slur capture is intentionally separate from command emission: it walks
    // the same layouts but pushes no `RenderCommand`s. The retained-segment
    // fast path (auto-flow) can therefore reuse rendering independently.
    collect_system_slur_data(
        all_staff_layouts,
        flat_staves,
        staff_y_offsets,
        margin_left,
        sp,
        config,
        sys_idx,
        slur_bounds,
        global_slur_events,
        global_tie_notes,
    );
}

pub(super) fn render_system_staff_lines(
    dl: &mut DisplayList,
    all_staff_layouts: &[Vec<MeasureLayout>],
    flat_staves: &[FlatStaff],
    staff_y_offsets: &[f64],
    margin_left: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    for (staff_idx, flat_staff) in flat_staves.iter().enumerate() {
        let staff_y = staff_y_offsets[staff_idx];
        let x_end = all_staff_layouts[staff_idx]
            .last()
            .map_or(margin_left, |ml| ml.x + ml.width);
        let is_expansion = flat_staff.expansion;
        let recolor_start = dl.commands.len();
        for line in 0..5 {
            let ly = staff_y + line as f64 * sp;
            dl.staff_line(margin_left, x_end, ly, config.staff_line_width * sp);
        }
        if is_expansion {
            dl.recolor_range(recolor_start, EXPANSION_COLOR);
        }
    }
}

#[allow(clippy::too_many_arguments)] // single-staff pipeline boundary
pub(super) fn render_system_staff_content(
    dl: &mut DisplayList,
    all_staff_layouts: &[Vec<MeasureLayout>],
    flat_staves: &[FlatStaff],
    staff_y_offsets: &[f64],
    next_sys_clef_per_staff: &[Option<&Clef>],
    score: &Score,
    lyric_line_order: Option<&[String]>,
    sp: f64,
    config: &LayoutConfig,
    sys_idx: usize,
    system_count: usize,
    suppress_final_barline: bool,
    logical_system_index: usize,
    clef_change_measures: &std::collections::HashSet<usize>,
    tie_maps_per_staff: Option<&[HashMap<String, bool>]>,
    staff_idx: usize,
    acc_obstacles: &mut Vec<AccidentalObstacle>,
) {
    let Some(measure_layouts) = all_staff_layouts.get(staff_idx) else {
        return;
    };
    let staff_y = staff_y_offsets[staff_idx];
    let staff_part_idx = flat_staves
        .get(staff_idx)
        .and_then(|fs| fs.sources.first())
        .map_or(staff_idx, |s| s.part_index);
    let is_expansion = flat_staves.get(staff_idx).is_some_and(|fs| fs.expansion);
    let recolor_start = dl.commands.len();
    let next_sys_clef = next_sys_clef_per_staff.get(staff_idx).copied().flatten();
    let tie_override = tie_maps_per_staff.and_then(|maps| maps.get(staff_idx));
    render_system_contents(
        dl,
        measure_layouts,
        staff_y,
        sp,
        config,
        score,
        lyric_line_order,
        sys_idx == system_count - 1,
        staff_part_idx,
        Some(staff_y_offsets),
        next_sys_clef,
        Some(staff_idx),
        logical_system_index,
        is_expansion,
        suppress_final_barline,
        clef_change_measures,
        acc_obstacles,
        tie_override,
    );
    if is_expansion {
        dl.recolor_range(recolor_start, EXPANSION_COLOR);
    }
}

/// Capture the cross-system slur events and per-staff system bounds for one
/// system, without emitting any render commands.
///
/// Split out of `render_system_staves_and_contents` so the retained-segment
/// fast path can reuse a cached rendered segment while still producing the
/// identical `global_slur_events` / `slur_bounds` the post-loop
/// `render_cross_system_slurs` pass depends on.
#[allow(clippy::too_many_arguments)] // pipeline boundary ΓÇö all inputs are required
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_label_no_transposition() {
        let (base, trans) = split_label_transposition("Trumpet");
        assert_eq!(base, "Trumpet");
        assert!(trans.is_none());
    }

    #[test]
    fn split_label_with_transposition() {
        let (base, trans) = split_label_transposition("Clarinet in BΓÖ¡");
        assert_eq!(base, "Clarinet");
        assert_eq!(trans.unwrap(), "in BΓÖ¡");
    }

    #[test]
    fn build_lines_no_condensed() {
        assert_eq!(build_label_lines("Flute", &[]), vec!["Flute"]);
    }

    #[test]
    fn build_lines_no_condensed_transposing() {
        assert_eq!(
            build_label_lines("Clarinet in BΓÖ¡", &[]),
            vec!["Clarinet", "in BΓÖ¡"]
        );
    }

    #[test]
    fn build_lines_transposing_condensed() {
        // Transposing: numbers appended to each text line
        assert_eq!(
            build_label_lines("Clarinet in BΓÖ¡", &[1, 2]),
            vec!["Clarinet 1", "in BΓÖ¡ 2"]
        );
    }

    #[test]
    fn build_lines_non_transposing_condensed_returns_name_only() {
        // Non-transposing: just the name, numbers rendered separately
        assert_eq!(build_label_lines("Trumpet", &[1, 2]), vec!["Trumpet"]);
    }

    #[test]
    fn build_lines_non_transposing_three_numbers() {
        assert_eq!(build_label_lines("Violin", &[1, 2, 3]), vec!["Violin"]);
    }

    #[test]
    fn build_lines_transposing_three_numbers() {
        // More numbers than text lines: extras become standalone lines
        assert_eq!(
            build_label_lines("Horn in F", &[1, 2, 3]),
            vec!["Horn 1", "in F 2", "3"]
        );
    }

    #[test]
    fn label_extent_grows_with_name_length() {
        let sp = 12.0;
        let style = crate::layout::text_styles::TextStylesheet::default()
            .resolve(crate::layout::text_styles::TextRole::StaffLabel)
            .clone();
        // A longer name reserves a wider gutter.
        let short = label_gutter_extent("Fl.", &[], sp, &style);
        let long = label_gutter_extent("Baritone Saxophone", &[], sp, &style);
        assert!(
            long > short,
            "longer label should yield a wider gutter: {long} vs {short}"
        );
        assert!(short > 0.0);
    }

    #[test]
    fn label_extent_adds_number_column() {
        let sp = 12.0;
        let style = crate::layout::text_styles::TextStylesheet::default()
            .resolve(crate::layout::text_styles::TextRole::StaffLabel)
            .clone();
        // A condensed non-transposing label draws a separate number column,
        // widening the extent versus the bare name.
        let bare = label_gutter_extent("Trumpet", &[], sp, &style);
        let numbered = label_gutter_extent("Trumpet", &[1, 2], sp, &style);
        assert!(
            numbered > bare,
            "number column should widen the gutter: {numbered} vs {bare}"
        );
    }

    #[test]
    fn label_extent_follows_the_staff_label_style() {
        let sp = 12.0;
        let mut sheet = crate::layout::text_styles::TextStylesheet::default();
        let base = sheet
            .resolve(crate::layout::text_styles::TextRole::StaffLabel)
            .clone();
        let narrow = label_gutter_extent("Clarinet", &[], sp, &base);

        // Doubling the role's size must widen the reserved gutter, otherwise
        // the drawn glyphs would overrun the space measured for them.
        sheet.merge_json(&serde_json::json!({ "staffLabel": { "size": base.size_sp * 2.0 } }));
        let wide_style = sheet
            .resolve(crate::layout::text_styles::TextRole::StaffLabel)
            .clone();
        let wide = label_gutter_extent("Clarinet", &[], sp, &wide_style);

        assert!(
            wide > narrow * 1.5,
            "gutter should scale with the staffLabel size: {wide} vs {narrow}"
        );
    }
}
