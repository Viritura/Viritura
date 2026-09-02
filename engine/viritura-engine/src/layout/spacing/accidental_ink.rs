use super::super::config::LayoutConfig;
use super::super::measure::{compute_note_staff_positions, compute_seconds_displacement};
use super::super::resolve::active_clef_at_beat;
use super::accidental_visibility::is_suppressed_tied_accidental;
use super::collectors::spacing_display_pitch;
use super::timing::{BeatKey, SpacingEvent};
use crate::model::*;
use crate::render::smufl::smufl;
use std::collections::{HashMap, HashSet};

const ACCIDENTAL_NOTE_GAP_SP: f64 = 0.20;
const ACCIDENTAL_APPROACH_GAP_SP: f64 = 0.50;
const ACCIDENTAL_STACK_GAP_SP: f64 = 0.20;
const RHYTHMIC_INK_GAP_SP: f64 = 0.20;
const BEAM_HOOK_LENGTH_SP: f64 = 0.875;

#[derive(Clone, Copy)]
struct InkRect {
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

#[derive(Clone, Copy)]
struct AccidentalInkRect {
    rect: InkRect,
    alter: Option<i32>,
}

impl InkRect {
    fn overlaps_vertically(self, other: Self) -> bool {
        self.top < other.bottom && other.top < self.bottom
    }
}

pub(crate) fn accidental_bbox_gap(
    left_alter: i32,
    left: (f64, f64),
    right_alter: i32,
    right: (f64, f64),
    min_ink_gap: f64,
    scale: f64,
) -> f64 {
    let overlap_top = left.0.max(right.0);
    let overlap_bottom = left.1.min(right.1);
    if overlap_top >= overlap_bottom {
        return min_ink_gap;
    }

    let left_cuts = smufl::accidental_cut_outs(left_alter);
    let right_cuts = smufl::accidental_cut_outs(right_alter);
    let cavities = if left.0 >= right.0 {
        left_cuts
            .ne
            .zip(right_cuts.sw)
            .filter(|((_, left_h), (_, right_h))| {
                overlap_bottom <= left.0 + left_h * scale
                    && overlap_top >= right.1 - right_h * scale
            })
    } else {
        left_cuts
            .se
            .zip(right_cuts.nw)
            .filter(|((_, left_h), (_, right_h))| {
                overlap_top >= left.1 - left_h * scale
                    && overlap_bottom <= right.0 + right_h * scale
            })
    };
    cavities.map_or(min_ink_gap, |((left_w, _), (right_w, _))| {
        min_ink_gap - (left_w + right_w) * scale
    })
}

struct TimedEvent<'a> {
    beat_key: BeatKey,
    event: &'a Event,
    positions: Vec<f64>,
    offsets: Vec<f64>,
    stem_up: bool,
    is_beamed: bool,
}

struct VisibleAccidental {
    position: f64,
    alter: i32,
    codepoint: u32,
    enclosure: Option<AccidentalEnclosureSymbol>,
}

fn timed_event<'a>(
    source: SpacingEvent<'a>,
    clef_changes: Option<&[(f64, Clef)]>,
    beamed_ids: Option<&HashSet<String>>,
    transposition: Option<(i32, i32)>,
) -> Option<TimedEvent<'a>> {
    let event = source.event;
    if event.is_rest() {
        return None;
    }
    let notes = event.notes();
    if notes.is_empty() {
        return None;
    }
    let positions = if let Some(changes) = clef_changes.filter(|changes| !changes.is_empty()) {
        compute_note_staff_positions(
            notes,
            active_clef_at_beat(changes, source.key.beats()),
            0,
            transposition,
            None,
        )
    } else {
        notes
            .iter()
            .map(|note| -(note.pitch.diatonic_position() as f64))
            .collect()
    };
    let stem_up = resolve_stem_up(
        event,
        source.forced_stem_up,
        source.sequence_index,
        source.sequence_count,
        &positions,
    );
    let offsets = compute_seconds_displacement(&positions, stem_up);
    let is_beamed = event
        .id
        .as_deref()
        .is_some_and(|id| beamed_ids.is_some_and(|ids| ids.contains(id)));
    Some(TimedEvent {
        beat_key: source.key,
        event,
        positions,
        offsets,
        stem_up,
        is_beamed,
    })
}

fn resolve_stem_up(
    event: &Event,
    forced_stem_up: Option<bool>,
    sequence_index: usize,
    sequence_count: usize,
    positions: &[f64],
) -> bool {
    if let Some(forced) = event.orient.and_then(Orientation::force_stem_up) {
        return forced;
    }
    if let Some(direction) = &event.stem_direction {
        return matches!(direction, StemDirection::Up);
    }
    if let Some(forced) = forced_stem_up {
        return forced;
    }
    if sequence_count > 1 {
        return sequence_index == 0;
    }
    let average = if positions.is_empty() {
        4.0
    } else {
        positions.iter().sum::<f64>() / positions.len() as f64
    };
    average > 4.0
}

fn rhythmic_ink(event: &TimedEvent<'_>, config: &LayoutConfig) -> Vec<InkRect> {
    let mut ink = Vec::new();
    let notehead = smufl::notehead_glyph(&event.event.duration.base);
    let (head_x, head_y, head_width, head_height) = smufl::glyph_bbox(notehead);
    for (index, &position) in event.positions.iter().enumerate() {
        let note_x = event.offsets.get(index).copied().unwrap_or(0.0) * head_width;
        ink.push(InkRect {
            left: note_x + head_x,
            right: note_x + head_x + head_width,
            top: position * 0.5 + head_y,
            bottom: position * 0.5 + head_y + head_height,
        });
        add_ledger_ink(&mut ink, position, note_x, head_width, config);
    }

    if !event.event.duration.base.has_stem() || event.positions.is_empty() {
        return ink;
    }

    let top_position = event
        .positions
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let bottom_position = event
        .positions
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let stem_width = config.stem_width;
    let anchors = smufl::stem_anchors(notehead);
    let flag_count = event.event.duration.base.flag_count();
    let stem_length = if !event.is_beamed && flag_count > 0 {
        config
            .stem_length
            .max(smufl::flag_inward_extent(flag_count, event.stem_up) + config.notehead_ry + 0.25)
    } else {
        config.stem_length
    };
    if event.stem_up {
        let stem_x = anchors.up_se.0 - stem_width * 0.5;
        let stem_bottom = bottom_position * 0.5 + anchors.up_se.1;
        let flag_y = (top_position * 0.5 - stem_length).min(2.0);
        let stem_top = if !event.is_beamed && flag_count > 0 {
            flag_y - smufl::flag_stem_extension(flag_count, true)
        } else {
            flag_y
        };
        ink.push(line_rect(stem_x, stem_top, stem_bottom, stem_width));
        add_flag_or_beam_ink(&mut ink, event, stem_x, flag_y, flag_count, stem_width);
    } else {
        let stem_x = anchors.down_nw.0 + stem_width * 0.5;
        let stem_top = top_position * 0.5 + anchors.down_nw.1;
        let flag_y = (bottom_position * 0.5 + stem_length).max(2.0);
        let stem_bottom = if !event.is_beamed && flag_count > 0 {
            flag_y + smufl::flag_stem_extension(flag_count, false)
        } else {
            flag_y
        };
        ink.push(line_rect(stem_x, stem_top, stem_bottom, stem_width));
        add_flag_or_beam_ink(&mut ink, event, stem_x, flag_y, flag_count, stem_width);
    }
    ink
}

fn rest_ink(event: &Event) -> Vec<InkRect> {
    let codepoint = smufl::rest_glyph(&event.duration.base);
    let (bbox_x, bbox_y, bbox_width, bbox_height) = smufl::glyph_bbox(codepoint);
    let rest_y = event
        .rest
        .as_ref()
        .and_then(|rest| rest.staff_position)
        .map_or(2.0, |position| (4.0 - f64::from(position)) * 0.5);
    let glyph_x = 0.2;
    let mut ink = vec![InkRect {
        left: glyph_x + bbox_x,
        right: glyph_x + bbox_x + bbox_width,
        top: rest_y + bbox_y,
        bottom: rest_y + bbox_y + bbox_height,
    }];
    if let Some(dots) = event.duration.dots.filter(|dots| *dots > 0) {
        let (dot_x, dot_y, dot_width, dot_height) = smufl::glyph_bbox(smufl::AUGMENTATION_DOT);
        for index in 0..dots {
            let x = glyph_x + bbox_x + bbox_width + 0.3 + f64::from(index) * 0.35;
            ink.push(InkRect {
                left: x + dot_x,
                right: x + dot_x + dot_width,
                top: rest_y - 0.5 + dot_y,
                bottom: rest_y - 0.5 + dot_y + dot_height,
            });
        }
    }
    ink
}

fn add_ledger_ink(
    ink: &mut Vec<InkRect>,
    position: f64,
    note_x: f64,
    notehead_width: f64,
    config: &LayoutConfig,
) {
    let half_line = config.ledger_line_width * 0.5;
    let mut add = |ledger_position: f64| {
        let y = ledger_position * 0.5;
        ink.push(InkRect {
            left: note_x - config.ledger_extension,
            right: note_x + notehead_width + config.ledger_extension,
            top: y - half_line,
            bottom: y + half_line,
        });
    };
    if position < 0.0 {
        let mut ledger = -2.0;
        while ledger >= position {
            add(ledger);
            ledger -= 2.0;
        }
    } else if position > 8.0 {
        let mut ledger = 10.0;
        while ledger <= position {
            add(ledger);
            ledger += 2.0;
        }
    }
}

fn line_rect(x: f64, y1: f64, y2: f64, width: f64) -> InkRect {
    let half = width * 0.5;
    InkRect {
        left: x - half,
        right: x + half,
        top: y1.min(y2) - half,
        bottom: y1.max(y2) + half,
    }
}

fn add_flag_or_beam_ink(
    ink: &mut Vec<InkRect>,
    event: &TimedEvent<'_>,
    stem_x: f64,
    stem_tip: f64,
    flag_count: u32,
    stem_width: f64,
) {
    if event.is_beamed {
        let levels = flag_count.max(1);
        let depth = 0.5 + f64::from(levels.saturating_sub(1)) * 0.75;
        let (top, bottom) = if event.stem_up {
            (stem_tip - depth, stem_tip + 0.5)
        } else {
            (stem_tip - 0.5, stem_tip + depth)
        };
        ink.push(InkRect {
            left: stem_x - BEAM_HOOK_LENGTH_SP,
            right: stem_x + BEAM_HOOK_LENGTH_SP + stem_width * 0.5,
            top,
            bottom,
        });
    } else if let Some(flag) = smufl::flag_glyph(flag_count, event.stem_up) {
        let (x, y, width, height) = smufl::glyph_bbox(flag);
        ink.push(InkRect {
            left: stem_x + x,
            right: stem_x + x + width,
            top: stem_tip + y,
            bottom: stem_tip + y + height,
        });
    }
}

fn visible_accidentals(
    event: &TimedEvent<'_>,
    active_key: &KeySignature,
    transposition: Option<(i32, i32)>,
    measure_accidentals: &mut HashMap<(String, i32), i32>,
    suppressed_note_ids: Option<&HashSet<String>>,
) -> Vec<VisibleAccidental> {
    let mut accidentals = Vec::new();
    for (index, note) in event.event.notes().iter().enumerate() {
        if note.kit_component.is_some() {
            continue;
        }
        let display_pitch = spacing_display_pitch(note, transposition);
        let alter = display_pitch.alter.unwrap_or(0);
        let key_alter = active_key.alteration_for_step(&display_pitch.step);
        let state_key = (display_pitch.step.clone(), display_pitch.octave);
        let in_effect = measure_accidentals
            .get(&state_key)
            .copied()
            .unwrap_or(key_alter);
        let display = note.accidental_display.as_ref();
        let hidden = display.is_some_and(|accidental| !accidental.show);
        let shown = display.is_some_and(|accidental| accidental.show);
        let forced = display.is_some_and(|accidental| accidental.force.unwrap_or(false));
        let tied_continuation = is_suppressed_tied_accidental(note, suppressed_note_ids);
        if !tied_continuation {
            measure_accidentals.insert(state_key, alter);
        }
        if hidden || tied_continuation || !(shown || forced || alter != in_effect) {
            continue;
        }
        let Some(codepoint) = smufl::accidental_glyph(alter) else {
            continue;
        };
        accidentals.push(VisibleAccidental {
            position: event.positions.get(index).copied().unwrap_or(0.0),
            alter,
            codepoint,
            enclosure: display
                .and_then(|accidental| accidental.enclosure.as_ref())
                .map(|enclosure| enclosure.symbol),
        });
    }
    accidentals
}

fn accidental_ink(
    visible: &[VisibleAccidental],
    event: &TimedEvent<'_>,
    config: &LayoutConfig,
) -> Vec<AccidentalInkRect> {
    let mut order: Vec<usize> = (0..visible.len()).collect();
    order.sort_by(|&left, &right| visible[left].position.total_cmp(&visible[right].position));
    let mut outside_in = Vec::with_capacity(order.len());
    let (mut low, mut high) = (0isize, order.len() as isize - 1);
    let mut take_top = true;
    while low <= high {
        if take_top {
            outside_in.push(order[low as usize]);
            low += 1;
        } else {
            outside_in.push(order[high as usize]);
            high -= 1;
        }
        take_top = !take_top;
    }

    let notehead = smufl::notehead_glyph(&event.event.duration.base);
    let notehead_width = smufl::glyph_bbox(notehead).2;
    let mut placed: Vec<AccidentalInkRect> = Vec::with_capacity(visible.len());
    for index in outside_in {
        let accidental = &visible[index];
        let (_, glyph_y, glyph_width, glyph_height) = smufl::glyph_bbox(accidental.codepoint);
        let (enclosure_codepoint, enclosure_width) = match accidental.enclosure {
            Some(AccidentalEnclosureSymbol::Parentheses) => (
                Some(smufl::ACCIDENTAL_PARENS_LEFT),
                smufl::accidental_enclosure_width(true),
            ),
            Some(AccidentalEnclosureSymbol::Brackets) => (
                Some(smufl::ACCIDENTAL_BRACKET_LEFT),
                smufl::accidental_enclosure_width(false),
            ),
            None => (None, 0.0),
        };
        let enclosure_gap = if enclosure_codepoint.is_some() {
            0.12
        } else {
            0.0
        };
        let total_width = glyph_width + 2.0 * enclosure_width + enclosure_gap;
        let mut right = -ACCIDENTAL_NOTE_GAP_SP;
        let top = accidental.position * 0.5 + glyph_y;
        let bottom = top + glyph_height;

        for (note_index, &position) in event.positions.iter().enumerate() {
            if event.offsets.get(note_index).copied().unwrap_or(0.0) < 0.0
                && top < position * 0.5 + 0.5
                && position * 0.5 - 0.5 < bottom
            {
                right = right.min(-notehead_width - ACCIDENTAL_NOTE_GAP_SP);
            }
        }
        if event
            .positions
            .iter()
            .any(|&position| ledger_crosses(position, top, bottom))
        {
            let ledger_barrier = -config.ledger_extension - ACCIDENTAL_NOTE_GAP_SP + 0.10;
            right = right.min(ledger_barrier);
        }
        for prior in &placed {
            if top < prior.rect.bottom && prior.rect.top < bottom {
                let gap = accidental
                    .enclosure
                    .is_none()
                    .then_some(accidental.alter)
                    .zip(prior.alter)
                    .map_or(ACCIDENTAL_STACK_GAP_SP, |(alter, prior_alter)| {
                        accidental_bbox_gap(
                            alter,
                            (top, bottom),
                            prior_alter,
                            (prior.rect.top, prior.rect.bottom),
                            ACCIDENTAL_STACK_GAP_SP,
                            1.0,
                        )
                    });
                right = right.min(prior.rect.left - gap);
            }
        }

        let group_left = right - total_width;
        let mut ink_top = top;
        let mut ink_bottom = bottom;
        if let Some(enclosure_cp) = enclosure_codepoint {
            let (_, enclosure_y, _, enclosure_height) = smufl::glyph_bbox(enclosure_cp);
            ink_top = ink_top.min(accidental.position * 0.5 + enclosure_y);
            ink_bottom = ink_bottom.max(accidental.position * 0.5 + enclosure_y + enclosure_height);
        }
        placed.push(AccidentalInkRect {
            rect: InkRect {
                left: group_left,
                right,
                top: ink_top,
                bottom: ink_bottom,
            },
            alter: accidental.enclosure.is_none().then_some(accidental.alter),
        });
    }
    placed
}

fn ledger_crosses(position: f64, top: f64, bottom: f64) -> bool {
    if position < 0.0 {
        let mut ledger = -2.0;
        while ledger >= position {
            let y = ledger * 0.5;
            if top < y && y < bottom {
                return true;
            }
            ledger -= 2.0;
        }
    } else if position > 8.0 {
        let mut ledger = 10.0;
        while ledger <= position {
            let y = ledger * 0.5;
            if top < y && y < bottom {
                return true;
            }
            ledger += 2.0;
        }
    }
    false
}

/// Minimum onset-to-onset distances required for an accidental's actual SMuFL
/// ink to clear rhythmic ink at the immediately preceding shared onset.
///
/// Each outer sequence slice is one aligned staff contribution. The max fold
/// across those slices is therefore a shared-column reservation: one staff's
/// flag or beam can widen the gap, but every staff keeps the same onset x.
pub(super) struct InkSnapshot {
    pub(super) accidental_gap_floors: HashMap<BeatKey, f64>,
    pub(super) accidental_extents: HashMap<BeatKey, f64>,
    pub(super) right_extents: HashMap<BeatKey, f64>,
}

fn place_against_prior_accidentals(
    mut accidental: AccidentalInkRect,
    prior: &[AccidentalInkRect],
) -> AccidentalInkRect {
    loop {
        let barrier = prior
            .iter()
            .filter(|placed| accidental.rect.overlaps_vertically(placed.rect))
            .map(|placed| {
                let gap = accidental.alter.zip(placed.alter).map_or(
                    ACCIDENTAL_STACK_GAP_SP,
                    |(alter, placed_alter)| {
                        accidental_bbox_gap(
                            alter,
                            (accidental.rect.top, accidental.rect.bottom),
                            placed_alter,
                            (placed.rect.top, placed.rect.bottom),
                            ACCIDENTAL_STACK_GAP_SP,
                            1.0,
                        )
                    },
                );
                placed.rect.left - gap
            })
            .filter(|barrier| *barrier < accidental.rect.right)
            .min_by(f64::total_cmp);
        let Some(barrier) = barrier else {
            return accidental;
        };
        let shift = accidental.rect.right - barrier;
        accidental.rect.left -= shift;
        accidental.rect.right -= shift;
    }
}

pub(super) fn ink_snapshot(
    staff_events: &[Vec<SpacingEvent<'_>>],
    active_keys: &[&KeySignature],
    transpositions: &[Option<(i32, i32)>],
    clef_changes: &[Option<&[(f64, Clef)]>],
    beamed_event_ids: &[HashSet<String>],
    suppressed_note_ids: &[HashSet<String>],
    all_onsets: &[BeatKey],
    config: &LayoutConfig,
) -> InkSnapshot {
    let mut floors = HashMap::new();
    let mut accidental_extents = HashMap::new();
    let mut right_extents = HashMap::new();
    for (staff_index, sources) in staff_events.iter().enumerate() {
        let events: Vec<_> = sources
            .iter()
            .filter_map(|source| {
                timed_event(
                    *source,
                    clef_changes.get(staff_index).copied().flatten(),
                    beamed_event_ids.get(staff_index),
                    transpositions.get(staff_index).copied().flatten(),
                )
            })
            .collect();

        let mut obstacles: HashMap<BeatKey, Vec<InkRect>> = HashMap::new();
        let mut accidentals: HashMap<BeatKey, Vec<AccidentalInkRect>> = HashMap::new();
        let mut rest_onsets = HashSet::new();
        for source in sources {
            if source.event.is_rest() {
                rest_onsets.insert(source.key);
                obstacles
                    .entry(source.key)
                    .or_default()
                    .extend(rest_ink(source.event));
            }
        }
        let mut measure_accidentals = HashMap::new();
        let default_key = KeySignature::default();
        let active_key = active_keys
            .get(staff_index)
            .copied()
            .unwrap_or(&default_key);
        for event in &events {
            obstacles
                .entry(event.beat_key)
                .or_default()
                .extend(rhythmic_ink(event, config));
            let visible = visible_accidentals(
                event,
                active_key,
                transpositions.get(staff_index).copied().flatten(),
                &mut measure_accidentals,
                suppressed_note_ids.get(staff_index),
            );
            if !visible.is_empty() {
                let placed = accidentals.entry(event.beat_key).or_default();
                for rect in accidental_ink(&visible, event, config) {
                    placed.push(place_against_prior_accidentals(rect, placed));
                }
            }
        }
        for key in all_onsets {
            if let Some(left) = accidentals
                .get(key)
                .into_iter()
                .flatten()
                .map(|accidental| accidental.rect.left)
                .min_by(f64::total_cmp)
            {
                let extent = (-left - ACCIDENTAL_NOTE_GAP_SP).max(0.0);
                accidental_extents
                    .entry(*key)
                    .and_modify(|current: &mut f64| *current = current.max(extent))
                    .or_insert(extent);
            }
            let right = obstacles
                .get(key)
                .into_iter()
                .flatten()
                .map(|rect| rect.right)
                .chain(
                    accidentals
                        .get(key)
                        .into_iter()
                        .flatten()
                        .map(|accidental| accidental.rect.right),
                )
                .fold(f64::NEG_INFINITY, f64::max);
            if right.is_finite() {
                right_extents
                    .entry(*key)
                    .and_modify(|current: &mut f64| *current = current.max(right))
                    .or_insert(right);
            }
        }

        for pair in all_onsets.windows(2) {
            let previous_key = pair[0];
            let next_key = pair[1];
            if rest_onsets.contains(&previous_key) || rest_onsets.contains(&next_key) {
                if let (Some(previous_ink), Some(next_ink)) =
                    (obstacles.get(&previous_key), obstacles.get(&next_key))
                {
                    let mut required = 0.0_f64;
                    for &previous in previous_ink {
                        for &next in next_ink {
                            if previous.overlaps_vertically(next) {
                                required =
                                    required.max(previous.right - next.left + RHYTHMIC_INK_GAP_SP);
                            }
                        }
                    }
                    if required > 0.0 {
                        floors
                            .entry(next_key)
                            .and_modify(|floor: &mut f64| *floor = floor.max(required))
                            .or_insert(required);
                    }
                }
            }
            let (Some(previous_ink), Some(next_accidentals)) =
                (obstacles.get(&previous_key), accidentals.get(&next_key))
            else {
                continue;
            };
            let mut required = 0.0_f64;
            for &obstacle in previous_ink {
                for accidental in next_accidentals {
                    if obstacle.overlaps_vertically(accidental.rect) {
                        required = required.max(
                            obstacle.right - accidental.rect.left + ACCIDENTAL_APPROACH_GAP_SP,
                        );
                    }
                }
            }
            if required > 0.0 {
                floors
                    .entry(next_key)
                    .and_modify(|floor: &mut f64| *floor = floor.max(required))
                    .or_insert(required);
            }
        }
    }
    InkSnapshot {
        accidental_gap_floors: floors,
        accidental_extents,
        right_extents,
    }
}
