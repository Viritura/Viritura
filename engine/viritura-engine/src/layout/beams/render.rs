#![allow(unused_imports)]

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::*;
use super::cross_barline::*;
use super::drawing::*;
use super::grouping::*;
use super::quantized_positions::*;
use super::scoring::*;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;
use std::collections::{HashMap, HashSet};

/// Adjust beam position to remove collisions with inner note stems.
/// Walks dictator/pointer until all inner stems meet minimum length.
pub(super) fn offset_beam_to_remove_collisions(
    note_info: &[(f64, f64)],
    _note_lines: &[i32],
    stem_up: bool,
    dictator: &mut i32,
    pointer: &mut i32,
    start_x: f64,
    end_x: f64,
    sp: f64,
    staff_y: f64,
    is_flat: bool,
    is_start_dictator: bool,
    beam_count: u32,
) {
    if (end_x - start_x).abs() < 0.001 {
        return;
    }

    let beam_width_px = 0.5 * sp;
    let tolerance = beam_width_px * 0.25 * if stem_up { -1.0 } else { 1.0 };
    let qs = sp / 4.0; // quarter-space in pixels

    for (i, &(nx, ny)) in note_info.iter().enumerate() {
        // Skip endpoints
        if i == 0 || i == note_info.len() - 1 {
            continue;
        }

        let min_len_qs = min_stem_length_qs(beam_count);
        let proportion = (nx - start_x) / (end_x - start_x);
        let mut iterations = 0;

        loop {
            let start_y = staff_y
                + (if is_start_dictator {
                    *dictator
                } else {
                    *pointer
                }) as f64
                    * qs
                + tolerance;
            let end_y = staff_y
                + (if is_start_dictator {
                    *pointer
                } else {
                    *dictator
                }) as f64
                    * qs
                + tolerance;
            let desired_y = proportion * (end_y - start_y) + start_y;

            let slope_qs = (*dictator - *pointer).abs();
            let reduction = if is_flat {
                0.0
            } else if slope_qs <= 3 {
                0.25 * sp
            } else if slope_qs <= 6 {
                0.5 * sp
            } else {
                0.75 * sp
            };

            let beam_clears = if stem_up {
                desired_y <= ny + reduction
            } else {
                desired_y >= ny - reduction
            };

            let stem_len_qs = ((desired_y - ny).abs() / qs).round() as i32 + 1;
            if beam_clears && stem_len_qs >= min_len_qs {
                break;
            }

            if is_flat || *dictator == *pointer {
                *dictator += if stem_up { -1 } else { 1 };
                *pointer += if stem_up { -1 } else { 1 };
            } else if (*dictator - *pointer).abs() == 1 {
                *dictator += if stem_up { -1 } else { 1 };
            } else {
                *pointer += if stem_up { -1 } else { 1 };
            }

            iterations += 1;
            if iterations > 60 {
                break; // safety limit
            }
        }
    }
}

/// Shorten anchor stems while maintaining valid beam positions.
pub(super) fn offset_beam_with_anchor_shortening(
    stem_up: bool,
    dictator: &mut i32,
    pointer: &mut i32,
    staff_lines: i32,
    is_start_dictator: bool,
    stem_length_dictator_qs: i32,
    target_line: i32,
    start_beam_count: u32,
    end_beam_count: u32,
    is_ascending: bool,
) {
    let is_flat = *dictator == *pointer;
    let dict_beams = if is_start_dictator {
        start_beam_count
    } else {
        end_beam_count
    };
    let ptr_beams = if is_start_dictator {
        end_beam_count
    } else {
        start_beam_count
    };
    let max_dictator_reduce = (stem_length_dictator_qs - min_stem_length_qs(dict_beams))
        .min((*dictator - target_line).abs());
    let toward_beam = if stem_up { -1 } else { 1 };

    let four_beam_exception = |beams: u32, y_pos: i32| -> bool {
        let y = y_pos + 400;
        beams >= 4 && (y % 4 == 2)
    };

    let mut new_dictator = *dictator;
    let mut new_pointer = *pointer;
    let mut reduce = 0;

    while !four_beam_exception(dict_beams, new_dictator)
        && !is_valid_beam_position(
            stem_up,
            new_dictator,
            is_start_dictator,
            is_ascending,
            is_flat,
            staff_lines,
            true,
        )
    {
        reduce += 1;
        if reduce > max_dictator_reduce {
            new_dictator = *dictator;
            new_pointer = *pointer;
            let mut safety = 0;
            while !is_valid_beam_position(
                stem_up,
                new_dictator,
                is_start_dictator,
                is_ascending,
                is_flat,
                staff_lines,
                true,
            ) {
                new_dictator += toward_beam;
                new_pointer += toward_beam;
                safety += 1;
                if safety > 40 {
                    break;
                }
            }
            break;
        }
        new_dictator -= toward_beam;
        new_pointer -= toward_beam;
    }

    // Constrain pointer to target line
    new_pointer = if stem_up {
        new_pointer.min(target_line)
    } else {
        new_pointer.max(target_line)
    };

    // Walk back until both are valid
    let mut safety = 0;
    while !four_beam_exception(dict_beams, new_dictator)
        && !four_beam_exception(ptr_beams, new_pointer)
        && (!is_valid_beam_position(
            stem_up,
            new_dictator,
            is_start_dictator,
            is_ascending,
            is_flat,
            staff_lines,
            true,
        ) || !is_valid_beam_position(
            stem_up,
            new_pointer,
            !is_start_dictator,
            is_ascending,
            is_flat,
            staff_lines,
            true,
        ))
    {
        if is_flat {
            new_dictator += toward_beam;
            new_pointer += toward_beam;
        } else if (new_dictator - new_pointer).abs() == 1 {
            new_dictator += toward_beam;
        } else {
            new_pointer += toward_beam;
        }
        safety += 1;
        if safety > 40 {
            break;
        }
    }

    *dictator = new_dictator;
    *pointer = new_pointer;
    if is_flat {
        *pointer = *dictator;
    }
}

/// Enforce valid beam positions for both endpoints.
pub(super) fn set_valid_beam_positions(
    stem_up: bool,
    dictator: &mut i32,
    pointer: &mut i32,
    beam_count_d: i32,
    beam_count_p: i32,
    staff_lines: i32,
    is_start_dictator: bool,
    is_flat: bool,
    is_ascending: bool,
) {
    let mut are_beams_valid = false;

    // For 3+ beam groups: pre-check inner beam validity
    let has_3_beams_inside = beam_count_d >= 3 || beam_count_p >= 3;
    while !are_beams_valid && has_3_beams_inside {
        let spacing = if stem_up { BEAM_SPACING } else { -BEAM_SPACING };
        let dictator_inner = *dictator + (beam_count_d - 1) * spacing;
        let outer_offset =
            get_outer_beam_pos_offset(stem_up, dictator_inner, beam_count_d, staff_lines);
        if outer_offset.abs() <= BEAM_SPACING {
            break;
        }
        let offset_d = find_valid_beam_offset(
            stem_up,
            *dictator,
            beam_count_d,
            staff_lines,
            is_start_dictator,
            false,
            true,
        );
        let offset_p = find_valid_beam_offset(
            stem_up,
            *pointer,
            beam_count_p,
            staff_lines,
            is_start_dictator,
            false,
            true,
        );
        let offset = if offset_d == 0 { offset_p } else { offset_d };
        if *pointer == *dictator {
            *dictator += offset;
        }
        *pointer = *dictator;
        if offset == 0 {
            are_beams_valid = true;
        }
    }

    if is_flat {
        are_beams_valid = false;
    }

    let mut safety = 0;
    while !are_beams_valid {
        let dictator_offset = find_valid_beam_offset(
            stem_up,
            *dictator,
            beam_count_d,
            staff_lines,
            is_start_dictator,
            is_ascending,
            is_flat,
        );
        *dictator += dictator_offset;
        *pointer += dictator_offset;
        if is_flat {
            *pointer = *dictator;
            // For flat beams, check all inner notes too
            let curr_offset = find_valid_beam_offset(
                stem_up,
                *dictator,
                beam_count_d.max(beam_count_p),
                staff_lines,
                is_start_dictator,
                is_ascending,
                is_flat,
            );
            if curr_offset == 0 {
                are_beams_valid = true;
            } else {
                *dictator += curr_offset;
                *pointer += curr_offset;
            }
        } else {
            *pointer += find_valid_beam_offset(
                stem_up,
                *pointer,
                beam_count_p,
                staff_lines,
                !is_start_dictator,
                is_ascending,
                is_flat,
            );
            if (stem_up && *pointer <= *dictator) || (!stem_up && *pointer >= *dictator) {
                *dictator = *pointer + if stem_up { -1 } else { 1 };
            } else {
                are_beams_valid = true;
            }
        }
        safety += 1;
        if safety > 40 {
            break;
        }
    }
}

/// Compute beam position using standard dictator/pointer algorithm:
/// 1. Convert note positions to quarter-space line numbers
/// 2. Compute initial dictator/pointer from default stem lengths
/// 3. Compute desired slant with slope constraints
/// 4. Offset beam for inner stem collisions
/// 5. Validate beam positions (sitting/hanging rules)
/// 6. Convert back to pixel coordinates
///
/// `max_beam_count` is the maximum number of beam levels in the group
/// (e.g. 1 for 8th notes, 2 for 16th, 3 for 32nd).
///
/// Returns (beam_y_first, slope, stem_tips).
#[allow(clippy::too_many_lines)] // single beam-quantization pass; the slant/stem stages share local state
pub(crate) fn compute_quantized_beam(
    note_info: &[(f64, f64)],
    stem_up: bool,
    sp: f64,
    config: &LayoutConfig,
    staff_y: f64,
    max_beam_count: u32,
) -> (f64, f64, Vec<(f64, f64)>) {
    if note_info.len() < 2 {
        let y = note_info
            .first()
            .map(|&(_, ny)| {
                if stem_up {
                    ny - config.stem_length * sp
                } else {
                    ny + config.stem_length * sp
                }
            })
            .unwrap_or(staff_y);
        let tips = note_info.iter().map(|&(sx, _)| (sx, y)).collect();
        return (y, 0.0, tips);
    }

    let qs = sp / 4.0; // quarter-space in pixels

    // Convert notehead Y positions to staff line numbers (in half-spaces from top line).
    // Then convert to quarter-space integers for the algorithm.
    // note_info.1 = staff_y + pos_hs * sp * 0.5, so pos_hs = (y - staff_y) / (0.5 * sp)
    // quarter-space = pos_hs * 2
    let note_lines: Vec<i32> = note_info
        .iter()
        .map(|&(_, ny)| {
            let pos_hs = (ny - staff_y) / (0.5 * sp);
            pos_hs.round() as i32 * 2
        })
        .collect();

    let start_line = note_lines[0];
    let end_line = *note_lines.last().unwrap();

    // Compute default stem length in quarter-spaces, accounting for beam count
    let default_stem_qs = (config.stem_length * 4.0).round() as i32;
    let stem_qs = default_stem_qs.max(min_stem_length_qs(max_beam_count));

    // Compute initial anchor Y in quarter-spaces (beam center position)
    let start_anchor_qs = if stem_up {
        start_line - stem_qs
    } else {
        start_line + stem_qs
    };
    let end_anchor_qs = if stem_up {
        end_line - stem_qs
    } else {
        end_line + stem_qs
    };

    // Determine dictator (more extreme endpoint) and pointer
    let is_start_dictator = if stem_up {
        start_line <= end_line // lower line number = higher = more extreme for up stems
    } else {
        start_line >= end_line // higher line number = lower = more extreme for down stems
    };

    let mut dictator = if is_start_dictator {
        start_anchor_qs
    } else {
        end_anchor_qs
    };
    let mut pointer = if is_start_dictator {
        end_anchor_qs
    } else {
        start_anchor_qs
    };

    // Compute beam width in staff spaces for max slope lookup
    let first_x = note_info[0].0;
    let last_x = note_info.last().unwrap().0;
    let beam_width_sp = (last_x - first_x) / sp;

    // Target staff line for beam positioning
    let target_line = get_target_staff_line(stem_up, STAFF_LINES, max_beam_count);

    // Compute desired slant
    let slant = compute_desired_slant(
        &note_lines,
        stem_up,
        start_line,
        end_line,
        target_line,
        dictator,
        pointer,
        beam_width_sp,
    );
    let is_flat = slant == 0;
    let special_slant = if is_flat {
        get_slope_constraint(&note_lines, stem_up, start_line, end_line)
    } else {
        SlopeConstraint::NoConstraint
    };
    let force_flat = special_slant == SlopeConstraint::Flat;
    let small_slant = special_slant == SlopeConstraint::SmallSlope;

    if is_flat {
        dictator = if stem_up {
            pointer.min(dictator)
        } else {
            pointer.max(dictator)
        };
        pointer = dictator;
    } else {
        // Apply the slant: check if dictator > pointer matches expected direction
        let start_pos = start_line;
        let end_pos = end_line;
        let expected_dir = if is_start_dictator {
            start_pos > end_pos
        } else {
            end_pos > start_pos
        };
        if (dictator > pointer) != expected_dir {
            dictator = pointer - slant;
        } else {
            pointer = dictator + slant;
        }
    }

    let is_ascending = start_line > end_line;
    let beam_count_d = max_beam_count as i32;
    let beam_count_p = max_beam_count as i32;

    let stem_length_start_qs = (start_anchor_qs - start_line).unsigned_abs() as i32;
    let stem_length_dictator = if is_start_dictator {
        stem_length_start_qs
    } else {
        (end_anchor_qs - end_line).unsigned_abs() as i32
    };

    // Apply collision avoidance and valid position enforcement
    if last_x > first_x {
        // Adjust anchor stems
        offset_beam_with_anchor_shortening(
            stem_up,
            &mut dictator,
            &mut pointer,
            STAFF_LINES,
            is_start_dictator,
            stem_length_dictator,
            target_line,
            max_beam_count,
            max_beam_count,
            is_ascending,
        );

        // Adjust inner stems
        offset_beam_to_remove_collisions(
            note_info,
            &note_lines,
            stem_up,
            &mut dictator,
            &mut pointer,
            first_x,
            last_x,
            sp,
            staff_y,
            is_flat,
            is_start_dictator,
            max_beam_count,
        );
    }

    // Validate beam positions
    set_valid_beam_positions(
        stem_up,
        &mut dictator,
        &mut pointer,
        beam_count_d,
        beam_count_p,
        STAFF_LINES,
        is_start_dictator,
        is_flat,
        is_ascending,
    );

    // Add middle-line slant
    let interval = (start_line - end_line).abs();
    let beam_count_total = beam_count_d.max(beam_count_p);
    if !force_flat {
        add_middle_line_slant(
            stem_up,
            &mut dictator,
            &mut pointer,
            beam_count_total,
            target_line,
            interval,
            if small_slant { 1 } else { slant },
        );
    }

    // Final minimum stem length enforcement — ensure every note in the group
    // meets the minimum after all adjustments (shortening, valid-position moves,
    // middle-line slant). Without this, sloped beams can end up with stems
    // shorter than config.stem_length.
    // Ref: standard engraving practice — minimum stem length is one octave (3.5sp).
    let min_len = min_stem_length_qs(max_beam_count);
    let toward_beam_dir = if stem_up { -1 } else { 1 };
    let start_qs = if is_start_dictator { dictator } else { pointer };
    let end_qs = if is_start_dictator { pointer } else { dictator };
    let mut worst_deficit = 0i32;
    for (i, &nl) in note_lines.iter().enumerate() {
        let t = if note_info.len() <= 1 {
            0.0
        } else {
            i as f64 / (note_info.len() - 1) as f64
        };
        let beam_qs_at_note = start_qs as f64 + (end_qs - start_qs) as f64 * t;
        let stem_len = ((beam_qs_at_note - nl as f64).abs()) as i32;
        if stem_len < min_len {
            worst_deficit = worst_deficit.max(min_len - stem_len);
        }
    }
    if worst_deficit > 0 {
        dictator += toward_beam_dir * worst_deficit;
        pointer += toward_beam_dir * worst_deficit;
    }

    // Reach toward the middle staff line — mirror the single-note rule in
    // `stem_tip_y` (`tip.min(middle_y)` up / `tip.max(middle_y)` down). A beamed
    // group sitting well beyond the middle line (e.g. high triplets above the
    // staff) must extend its stems at least to that line rather than floating a
    // short default-octave stem out by the noteheads.
    // Ref: standard engraving practice — stems of notes far from the staff are
    // lengthened toward the middle line.
    let middle_qs = super::super::render_measure::MIDDLE_LINE_POS * 2.0; // half-spaces → quarter-spaces
    let start_reach = if is_start_dictator { dictator } else { pointer } as f64;
    let end_reach = if is_start_dictator { pointer } else { dictator } as f64;
    let mut middle_deficit = 0.0f64;
    for i in 0..note_lines.len() {
        let t = if note_info.len() <= 1 {
            0.0
        } else {
            i as f64 / (note_info.len() - 1) as f64
        };
        let beam_qs_at_note = start_reach + (end_reach - start_reach) * t;
        // For up-stems the tip must be at or above the middle line
        // (beam_qs <= middle_qs); for down-stems at or below it.
        let deficit = if stem_up {
            beam_qs_at_note - middle_qs
        } else {
            middle_qs - beam_qs_at_note
        };
        if deficit > middle_deficit {
            middle_deficit = deficit;
        }
    }
    if middle_deficit > 0.0 {
        let shift = toward_beam_dir * middle_deficit.round() as i32;
        dictator += shift;
        pointer += shift;
    }

    // Convert back to pixel coordinates
    // Convert quarter-space coordinates back to pixel Y

    // Note: staff_y is already factored into note_info Y values, but our quarter-space
    // coordinates are relative to the top staff line (y=0 at top line).
    // We need: beam_y_pixel = staff_y + qs_value * (sp/4)
    // But the note_lines were computed as (ny - staff_y)/(0.5*sp) * 2, so qs values
    // are relative to staff_y. The anchor qs also includes default stem length offset.
    // So beam_y = staff_y + qs * sp/4.
    let start_beam_y_px =
        staff_y + (if is_start_dictator { dictator } else { pointer }) as f64 * qs;
    let end_beam_y_px = staff_y + (if is_start_dictator { pointer } else { dictator }) as f64 * qs;

    let dx = last_x - first_x;
    let slope = if dx.abs() > 0.001 {
        (end_beam_y_px - start_beam_y_px) / dx
    } else {
        0.0
    };
    let beam_y_first = start_beam_y_px;

    // Build stem tips from the beam line
    let stem_tips: Vec<(f64, f64)> = note_info
        .iter()
        .map(|&(sx, _)| {
            let beam_y = beam_y_first + slope * (sx - first_x);
            (sx, beam_y)
        })
        .collect();

    (beam_y_first, slope, stem_tips)
}

/// Render beam groups for a measure.
///
/// For each beam group, finds matching EventLayout entries, computes beam
/// angle from notehead contour with slope damping, and emits DrawPolygon
/// commands for each beam level. Beam thickness = 0.5*sp, beam gap = 0.25*sp.
/// When `use_beams` is true, no auto-beaming is performed.
#[allow(clippy::too_many_lines)] // single per-measure beam-group render pass; cohesive pipeline stage
pub(crate) fn render_beams(
    dl: &mut DisplayList,
    ml: &MeasureLayout,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
    explicit_beamed_ids: &HashSet<String>,
    use_beams: bool,
    staff_y_offsets: Option<&[f64]>,
) {
    let mut beams_to_use = ml.resolved.part.beams.clone().unwrap_or_default();
    if !use_beams {
        // Explicit groups claim only their own events. Keep them intact, then
        // supply default meter-based beams for newly entered, unclaimed notes.
        beams_to_use.extend(auto_beam_groups(
            &ml.voice_layouts,
            &ml.resolved.active_time,
            explicit_beamed_ids,
        ));
    }
    if beams_to_use.is_empty() {
        return;
    }

    let beam_thickness = 0.5 * sp;
    let beam_gap = 0.25 * sp;

    // Flatten all events from all voices for ID lookup
    let all_events: Vec<EventLayout> = ml
        .voice_layouts
        .iter()
        .flat_map(|vl| (0..vl.events.len()).map(|i| vl.events.to_event_layout(i)))
        .collect();

    // Compute onset times (in quarter-note beats) per voice for implied breaks
    let voice_onset_times: HashMap<String, f64> = {
        let mut map = HashMap::new();
        for vl in &ml.voice_layouts {
            let mut t = 0.0;
            for i in 0..vl.events.len() {
                if let Some(id) = vl.events.id(i) {
                    map.insert(id.to_string(), t);
                }
                t += vl.events.event(i).duration.total_beats();
            }
        }
        map
    };

    // Map each event ID to the tuplet group it belongs to (globally unique
    // index across voices). Used to suppress meter-implied secondary/tertiary
    // beam breaks inside a tuplet: the irregular real durations of tuplet
    // members do not align to metric subdivisions, so a meter-based break
    // would chop the inner beams into spurious fragments (e.g. a 17-tuplet of
    // 32nds re-beamed every two notes). Standard engraving practice: a tuplet
    // of equal note values carries continuous secondary/tertiary beams.
    let event_tuplet: HashMap<String, usize> = {
        let mut map = HashMap::new();
        let mut tuplet_counter = 0usize;
        for vl in &ml.voice_layouts {
            let event_count = vl.events.len();
            for tg in &vl.tuplet_groups {
                for e in tg.first_event_idx..=tg.last_event_idx {
                    if e < event_count {
                        if let Some(id) = vl.events.id(e) {
                            map.insert(id.to_string(), tuplet_counter);
                        }
                    }
                }
                tuplet_counter += 1;
            }
        }
        map
    };

    for (beam_idx, beam) in beams_to_use.iter().enumerate() {
        // Resolve event layouts in this beam group
        let beam_events: Vec<&EventLayout> = beam
            .events
            .iter()
            .filter_map(|id| {
                all_events
                    .iter()
                    .find(|el| el.id.as_deref() == Some(id.as_str()))
            })
            .collect();

        // Skip cross-barline beams (not all events found in this measure);
        // these are handled by render_cross_barline_beams
        if beam_events.len() < beam.events.len() {
            continue;
        }

        if beam_events.len() < 2 {
            continue;
        }

        // Record command index before rendering for element ID tagging
        let cmd_start = dl.commands.len();

        // Determine whether the entire beam group lies within a single tuplet.
        // If so, suppress meter-implied secondary/tertiary breaks (see note at
        // `event_tuplet` construction above).
        let within_single_tuplet = {
            let mut tuplets = beam_events.iter().map(|el| {
                el.id
                    .as_deref()
                    .and_then(|id| event_tuplet.get(id).copied())
            });
            match tuplets.next().flatten() {
                Some(first_tg) => tuplets.all(|t| t == Some(first_tg)),
                None => false,
            }
        };

        // Secondary+ beams break at TUPLET BOUNDARIES. When a beam group spans
        // two adjacent tuplets (e.g. two 16th-note triplets beamed together on
        // one beat), the primary beam runs continuously but each tuplet keeps
        // its own secondary beam, with a break at the seam — standard engraving
        // practice. A break is inserted after event `i` when event `i` and
        // `i+1` belong to different tuplet groups (or one is in a tuplet and
        // its neighbour is not). Within a single tuplet, no break.
        let tuplet_boundary_breaks: HashSet<usize> = {
            let mut breaks = HashSet::new();
            for i in 0..beam_events.len().saturating_sub(1) {
                let t_i = beam_events[i]
                    .id
                    .as_deref()
                    .and_then(|id| event_tuplet.get(id).copied());
                let t_next = beam_events[i + 1]
                    .id
                    .as_deref()
                    .and_then(|id| event_tuplet.get(id).copied());
                // Only a boundary when at least one side is in a tuplet and the
                // two differ (different tuplet, or tuplet↔non-tuplet).
                if t_i != t_next && (t_i.is_some() || t_next.is_some()) {
                    breaks.insert(i);
                }
            }
            breaks
        };

        // Collect explicit hook directions from MNX inner beams
        let explicit_hooks = collect_explicit_hooks(beam);
        // Extract explicit sub-beam groups for secondary break support
        let explicit_beam_groups = collect_explicit_beam_groups(beam);

        // Use stem direction of the first event in the group
        let mut stem_up = beam_events[0].stem_up;

        // Determine the maximum beam level needed in this group (needed for
        // both the cross-staff branch and the regular path)
        let max_beam_level = beam_events
            .iter()
            .map(|el| el.event.duration.base.flag_count())
            .max()
            .unwrap_or(1);

        // ─── Cross-staff BETWEEN beam handling ───────────────────────────
        // Standard engraving practice: when chords in the beam group sit on different staves, place the beam
        // in the gap between the two staves and flip stems per chord so each
        // stem points toward the beam.
        let effective_staves: Vec<u32> = beam_events
            .iter()
            .map(|el| el.event.staff.unwrap_or(el.sequence_staff))
            .collect();
        if render_between_staff_beam(
            dl,
            ml,
            &beam_events,
            &effective_staves,
            staff_y,
            staff_y_offsets,
            sp,
            config,
            beam_thickness,
            beam_gap,
            max_beam_level,
            beam_idx,
            cmd_start,
        ) {
            continue;
        }

        // --- Beam placement with quanting (single-staff or fallback) ---
        let stem_w = config.stem_width * sp;

        // Override: if not handled above, but events have mixed effective staves
        // and we have no offsets (shouldn't happen), keep stem_up consistent.
        let _ = &mut stem_up;

        // Reference staff baseline for quanting. We only reach this path when
        // every event shares one effective staff (mixed-staff beams are handled
        // by `render_between_staff_beam` above). When that common staff is a
        // *cross-staff* target (the whole beam dips onto another staff), the
        // events' note Ys live on the target staff, so the quanting frame — and
        // especially the "reach toward the middle staff line" clamp inside
        // `compute_quantized_beam` — must be anchored to that target staff, not
        // the sequence's home `staff_y`. Otherwise the beam is yanked back to
        // the home staff's middle line, leaving giant stems and a beam stranded
        // on the wrong staff.
        let beam_staff_y =
            super::super::render_measure::cross_staff_y(beam_events[0], staff_y, staff_y_offsets);

        // (max_beam_level is computed above the cross-staff branch.)

        // Compute stem X and notehead reference Y (stem-side) for each event
        // Using SMuFL stemUpSE/stemDownNW anchor points from Bravura metadata.
        let note_info: Vec<(f64, f64)> = beam_events
            .iter()
            .map(|el| {
                let top_pos = el
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::INFINITY, f64::min);
                let bottom_pos = el
                    .note_positions
                    .iter()
                    .cloned()
                    .fold(f64::NEG_INFINITY, f64::max);
                // Use effective staff_y so cross-staff events anchor to the target staff.
                let eff_y =
                    super::super::render_measure::cross_staff_y(el, staff_y, staff_y_offsets);
                if stem_up {
                    let sx = el.x + smufl::STEM_UP_SE.0 * sp - stem_w * 0.5;
                    let ny = eff_y + top_pos * sp * 0.5;
                    (sx, ny)
                } else {
                    let sx = el.x + smufl::STEM_DOWN_NW.0 * sp + stem_w * 0.5;
                    let ny = eff_y + bottom_pos * sp * 0.5;
                    (sx, ny)
                }
            })
            .collect();

        // Use quantized beam positioning (candidate grid + penalty scoring)
        let (_beam_y_first, slope, stem_tips) = compute_quantized_beam(
            &note_info,
            stem_up,
            sp,
            config,
            beam_staff_y,
            max_beam_level,
        );

        let first = stem_tips.first().unwrap();

        // Re-draw stems to connect to the beam CENTER (industry standard per
        // standard engraving practice: "anchor represents the middle of the beam").
        // This prevents stems from poking through the beam due to anti-aliasing.
        let beam_center_offset = beam_thickness / 2.0;
        for (i, el) in beam_events.iter().enumerate() {
            let (stem_x, _) = stem_tips[i];
            let beam_y_at_stem = first.1 + slope * (stem_x - first.0);
            let top_pos = el
                .note_positions
                .iter()
                .cloned()
                .fold(f64::INFINITY, f64::min);
            let bottom_pos = el
                .note_positions
                .iter()
                .cloned()
                .fold(f64::NEG_INFINITY, f64::max);

            let eff_y = super::super::render_measure::cross_staff_y(el, staff_y, staff_y_offsets);
            if stem_up {
                let stem_bottom = eff_y + bottom_pos * sp * 0.5;
                // Stem goes from notehead up to beam center
                let stem_end = beam_y_at_stem + beam_center_offset;
                dl.stem(stem_x, stem_end, stem_bottom, config.stem_width * sp);
            } else {
                let stem_top = eff_y + top_pos * sp * 0.5;
                // Stem goes from notehead down to beam center
                let stem_end = beam_y_at_stem - beam_center_offset;
                dl.stem(stem_x, stem_top, stem_end, config.stem_width * sp);
            }
        }

        // Draw beam rectangles for each level
        draw_beam_levels(
            dl,
            ml,
            &beam_events,
            &stem_tips,
            *first,
            slope,
            stem_up,
            max_beam_level,
            beam_thickness,
            beam_gap,
            &explicit_hooks,
            &explicit_beam_groups,
            &voice_onset_times,
            within_single_tuplet,
            &tuplet_boundary_breaks,
            sp,
            config,
        );

        // ── Reposition rests that fall within this beam group ──
        reposition_rests_under_beam(
            dl,
            ml,
            &beam_events,
            &stem_tips,
            *first,
            slope,
            stem_up,
            max_beam_level,
            beam_thickness,
            beam_gap,
            staff_y,
            sp,
            cmd_start,
        );

        // Tag all commands produced by this beam group with a structured element ID
        let cmd_end = dl.commands.len();
        if cmd_end > cmd_start {
            let eid = element_id::beam(ml.part_index, ml.resolved.index, beam_idx);
            for ci in cmd_start..cmd_end {
                dl.tag_command(ci, eid.clone());
                if matches!(dl.commands[ci], RenderCommand::DrawPolygon { .. }) {
                    dl.push_shape_cmd(ci, eid.clone(), ElementKind::Beam, None, None);
                }
            }
        }
    }
}
