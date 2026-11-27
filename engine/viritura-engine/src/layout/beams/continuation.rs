//! Fragments of barline-crossing beams broken by a system break.
//!
//! Standard engraving practice: when a system break interrupts a beam, each
//! system draws its own fragment. The fragment before the break runs past its
//! last stem toward the end of the system; the fragment after the break
//! starts ahead of its first stem, after the system's clef and key signature.
//! Only beams that logically continue across the break are extended: a
//! secondary beam that ends before the break stays closed, and stems keep the
//! direction resolved for the whole group.

use super::super::config::LayoutConfig;
use super::super::element_id;
use super::super::types::{EventLayout, MeasureLayout};
use super::cross_barline::{
    collect_explicit_beam_groups, collect_explicit_hooks, explicit_hook_direction,
};
use super::render::compute_quantized_beam;
use crate::model::measure::SpanningBeam;
use crate::render::smufl::smufl;
use crate::render::{DisplayList, ElementKind, RenderCommand};
use std::collections::{HashMap, HashSet};

/// Logical beam run at one level, in member indices of the whole group.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct LogicalRun {
    pub(crate) start: usize,
    pub(crate) end: usize,
}

/// Runs of members carrying at least `min_level` beams, split where explicit
/// sub-beam groups separate adjacent members.
pub(crate) fn logical_runs(
    spanning: &SpanningBeam,
    min_level: u32,
    groups: Option<&[HashSet<String>]>,
) -> Vec<LogicalRun> {
    let ids = &spanning.beam.events;
    let mut runs = Vec::new();
    let mut start: Option<usize> = None;
    for (index, &level) in spanning.member_levels.iter().enumerate() {
        let breaks_before = index > 0
            && groups.is_some_and(|groups| {
                !groups.is_empty()
                    && !groups
                        .iter()
                        .any(|g| g.contains(&ids[index - 1]) && g.contains(&ids[index]))
            });
        if let Some(s) = start {
            if level < min_level || breaks_before {
                runs.push(LogicalRun {
                    start: s,
                    end: index - 1,
                });
                start = None;
            }
        }
        if level >= min_level && start.is_none() {
            start = Some(index);
        }
    }
    if let Some(s) = start {
        runs.push(LogicalRun {
            start: s,
            end: spanning.member_levels.len() - 1,
        });
    }
    runs
}

struct Present<'a> {
    member: usize,
    measure: usize,
    event: &'a EventLayout,
}

/// Draw the part of each broken barline-crossing beam that falls on this
/// system. Complete groups whose declaring measure is on the system are left
/// to `render_cross_barline_beams`.
pub(crate) fn render_spanning_beam_fragments(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    all_events: &[EventLayout],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    let declaring_present: HashSet<usize> =
        measure_layouts.iter().map(|ml| ml.resolved.index).collect();
    let mut event_measure: HashMap<&str, (usize, &EventLayout)> = HashMap::new();
    let mut offset = 0;
    for (measure_index, ml) in measure_layouts.iter().enumerate() {
        let count: usize = ml.voice_layouts.iter().map(|vl| vl.events.len()).sum();
        for el in &all_events[offset..offset + count] {
            if let Some(id) = el.id.as_deref() {
                event_measure.insert(id, (measure_index, el));
            }
        }
        offset += count;
    }
    for ml in measure_layouts {
        for spanning in &ml.resolved.spanning_beams {
            if !seen.insert((spanning.declaring_measure, spanning.beam_index)) {
                continue;
            }
            let present: Vec<Present<'_>> = spanning
                .beam
                .events
                .iter()
                .enumerate()
                .filter_map(|(member, id)| {
                    event_measure
                        .get(id.as_str())
                        .map(|&(measure, event)| Present {
                            member,
                            measure,
                            event,
                        })
                })
                .collect();
            let complete = present.len() == spanning.beam.events.len();
            if present.is_empty()
                || (complete && declaring_present.contains(&spanning.declaring_measure))
            {
                continue;
            }
            render_fragment(dl, measure_layouts, spanning, &present, staff_y, sp, config);
        }
    }
}

#[allow(clippy::too_many_lines)] // one fragment: stems, per-level segments, and tagging share geometry
fn render_fragment(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    spanning: &SpanningBeam,
    present: &[Present<'_>],
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    let beam_thickness = 0.5 * sp;
    let beam_gap = 0.25 * sp;
    let hook_len = 0.875 * sp;
    let stem_w = config.stem_width * sp;
    let stem_half_w = stem_w * 0.5;
    let stem_up = spanning.stem_up.unwrap_or(present[0].event.stem_up);
    let first_member = present[0].member;
    let last_member = present[present.len() - 1].member;
    let continues_before = first_member > 0;
    let continues_after = last_member + 1 < spanning.beam.events.len();

    let extent = |el: &EventLayout| {
        let top = el
            .note_positions
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        let bottom = el
            .note_positions
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        (top, bottom)
    };
    let note_info: Vec<(f64, f64)> = present
        .iter()
        .map(|p| {
            let (top, bottom) = extent(p.event);
            if stem_up {
                (
                    p.event.x + smufl::STEM_UP_SE.0 * sp - stem_half_w,
                    staff_y + top * sp * 0.5,
                )
            } else {
                (
                    p.event.x + smufl::STEM_DOWN_NW.0 * sp + stem_half_w,
                    staff_y + bottom * sp * 0.5,
                )
            }
        })
        .collect();
    let max_level = spanning.member_levels.iter().copied().max().unwrap_or(1);
    let (_, slope, stem_tips) =
        compute_quantized_beam(&note_info, stem_up, sp, config, staff_y, max_level);
    let anchor = stem_tips[0];
    let beam_y = |x: f64| anchor.1 + slope * (x - anchor.0);

    let cmd_start = dl.commands.len();
    for (i, p) in present.iter().enumerate() {
        let (stem_x, _) = stem_tips[i];
        let (top, bottom) = extent(p.event);
        if stem_up {
            let tip = beam_y(stem_x) + beam_thickness / 2.0;
            dl.stem(stem_x, tip, staff_y + bottom * sp * 0.5, stem_w);
        } else {
            let tip = beam_y(stem_x) - beam_thickness / 2.0;
            dl.stem(stem_x, staff_y + top * sp * 0.5, tip, stem_w);
        }
    }

    let first_stem_x = stem_tips[0].0;
    let last_stem_x = stem_tips[stem_tips.len() - 1].0;
    let left_edge = {
        let ml = &measure_layouts[present[0].measure];
        (ml.x + ml.prefix_width)
            .min(first_stem_x - 2.0 * hook_len)
            .max(ml.x)
    };
    let right_edge = {
        let ml = &measure_layouts[present[present.len() - 1].measure];
        (ml.x + ml.width - 0.5 * sp).max(last_stem_x + 2.0 * hook_len)
    };
    let tip_at = |member: usize| stem_tips[member - first_member].0;

    let explicit_hooks = collect_explicit_hooks(&spanning.beam);
    let explicit_groups = collect_explicit_beam_groups(&spanning.beam);
    let draw = |dl: &mut DisplayList, x1: f64, x2: f64, level: u32| {
        let level_offset = f64::from(level) * (beam_thickness + beam_gap);
        let (y1, y2) = if stem_up {
            (beam_y(x1) + level_offset, beam_y(x2) + level_offset)
        } else {
            (
                beam_y(x1) - level_offset - beam_thickness,
                beam_y(x2) - level_offset - beam_thickness,
            )
        };
        dl.beam_angled(x1, y1, x2, y2, beam_thickness);
    };
    for level in 0..max_level {
        let groups = (level > 0)
            .then(|| explicit_groups.get((level - 1) as usize))
            .flatten()
            .map(Vec::as_slice);
        for run in logical_runs(spanning, level + 1, groups) {
            if run.end < first_member || run.start > last_member {
                continue;
            }
            let extends_left = run.start < first_member;
            let extends_right = run.end > last_member;
            let start = run.start.max(first_member);
            let end = run.end.min(last_member);
            if run.start == run.end {
                let id = &spanning.beam.events[start];
                let right = explicit_hook_direction(&explicit_hooks, id, level + 1)
                    .unwrap_or(run.start == 0);
                let x = tip_at(start);
                let (x1, x2) = if right {
                    (x - stem_half_w, x + hook_len)
                } else {
                    (x - hook_len, x + stem_half_w)
                };
                draw(dl, x1, x2, level);
                continue;
            }
            let x1 = if extends_left && continues_before {
                left_edge
            } else {
                tip_at(start) - stem_half_w
            };
            let x2 = if extends_right && continues_after {
                right_edge
            } else {
                tip_at(end) + stem_half_w
            };
            draw(dl, x1, x2, level);
        }
    }

    let cmd_end = dl.commands.len();
    if cmd_end == cmd_start {
        return;
    }
    let part_index = measure_layouts[present[0].measure].part_index;
    let eid = element_id::beam(part_index, spanning.declaring_measure, spanning.beam_index);
    for ci in cmd_start..cmd_end {
        dl.tag_command(ci, eid.clone());
        if matches!(dl.commands[ci], RenderCommand::DrawPolygon { .. }) {
            dl.push_shape_cmd(ci, eid.clone(), ElementKind::Beam, None, None);
        }
    }
    let members = super::beam_member_element_ids(measure_layouts, &spanning.beam.events);
    if let Some(group) = dl
        .selection_groups
        .iter_mut()
        .find(|group| group.element_id == eid)
    {
        for member in members {
            if !group.member_ids.contains(&member) {
                group.member_ids.push(member);
            }
        }
    } else {
        dl.push_selection_group(eid, members);
    }
}
