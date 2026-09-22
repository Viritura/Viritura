//! Shared plumbing for spanners that cross system / page breaks (and
//! stitched-horizon chunk seams).
//!
//! Several spanner kinds (ties, slurs, and — in future — hairpins, pedals,
//! ottavas) face the same post-pass problem: a per-system render pass only sees
//! one system's note/event map, so a spanner whose endpoints land on different
//! systems is dropped and must be re-emitted by a cross-system post-pass. Those
//! post-passes resolve a source endpoint to its target the same way, so that
//! resolution lives here once instead of being copy-pasted per kind.
//!
//! Only the genuinely identical resolution logic is shared. The per-kind
//! collectors (what an endpoint *is*) and emit geometry (curve vs. wedge vs.
//! dashed line) stay in each kind's own module — they are irreducibly
//! different, and forcing them into one generic would be ceremony.

use super::config::LayoutConfig;
use super::element_id;
use crate::model::{Orientation, Score};
use crate::render::smufl::smufl;
use crate::render::{DisplayList, RenderCommand};

/// Resolve a cross-system target among `candidates` (indices into the kind's
/// global event list), preferring — in order — the candidate on the **same
/// part AND staff**, then the **same part**, then **any** candidate. Returns
/// `None` only when `candidates` is empty.
///
/// This mirrors the in-system preference: a tie/slur target normally lives on
/// the source's own staff, but condensed-staff expansion duplicates an id
/// across the condensed staff and its ghost source staves, so the same-staff
/// candidate must win before falling back to a duplicate on another staff.
///
/// `part_of` / `staff_of` read the part / staff index of a candidate by its
/// index, so this stays generic over the kind's event type without borrowing
/// the whole slice.
pub(crate) fn prefer_target(
    candidates: &[usize],
    src_part: usize,
    src_staff: usize,
    part_of: impl Fn(usize) -> usize,
    staff_of: impl Fn(usize) -> usize,
) -> Option<usize> {
    candidates
        .iter()
        .copied()
        .find(|&i| part_of(i) == src_part && staff_of(i) == src_staff)
        .or_else(|| candidates.iter().copied().find(|&i| part_of(i) == src_part))
        .or_else(|| candidates.first().copied())
}

/// Emit ottava and pedal fragments after every system has registered its
/// measure bounds. Unlike ties and slurs these spanners are authored as
/// measure-qualified ranges rather than endpoint ids, so their continuation
/// geometry is resolved from those bounds directly.
#[derive(Clone, Copy)]
pub(crate) struct LayoutStaffRoute {
    pub(crate) system_index: usize,
    pub(crate) part_index: usize,
    pub(crate) staff_number: u32,
    pub(crate) bounds_staff_index: usize,
}

enum StaffRouting<'a> {
    Fixed(usize),
    PerSystem(&'a [LayoutStaffRoute]),
}

impl StaffRouting<'_> {
    fn matches(
        &self,
        system_index: usize,
        part_index: usize,
        staff_number: u32,
        bounds_staff_index: usize,
    ) -> bool {
        match self {
            Self::Fixed(index) => bounds_staff_index == *index,
            Self::PerSystem(routes) => routes.iter().any(|route| {
                route.system_index == system_index
                    && route.part_index == part_index
                    && route.staff_number == staff_number
                    && route.bounds_staff_index == bounds_staff_index
            }),
        }
    }
}

fn render_staff_spanner_continuations_with_routing(
    dl: &mut DisplayList,
    score: &Score,
    part_index: usize,
    staff_number: u32,
    routing: &StaffRouting<'_>,
    sp: f64,
    config: &LayoutConfig,
) {
    let Some(part) = score.parts.get(part_index) else {
        return;
    };
    let measure_index = |id: &str| {
        score
            .global
            .measures
            .iter()
            .position(|measure| measure.id.as_deref() == Some(id))
    };
    for (start_measure, measure) in part.measures.iter().enumerate() {
        for (index, ottava) in measure.ottavas.iter().flatten().enumerate() {
            if ottava.staff.unwrap_or(1) != staff_number {
                continue;
            }
            let Some(end_measure) = measure_index(&ottava.end.measure) else {
                continue;
            };
            if end_measure <= start_measure {
                continue;
            }
            render_ottava_fragments(
                dl,
                part_index,
                staff_number,
                routing,
                start_measure,
                end_measure,
                ottava.position.beats(),
                ottava.end.position.beats(),
                ottava.value,
                ottava.orient.as_ref(),
                index,
                sp,
            );
        }
        for (index, pedal) in measure.pedals.iter().flatten().enumerate() {
            if pedal.staff.unwrap_or(1) != staff_number {
                continue;
            }
            let Some(end_measure) = measure_index(&pedal.end.measure) else {
                continue;
            };
            if end_measure <= start_measure {
                continue;
            }
            render_pedal_fragments(
                dl,
                part_index,
                staff_number,
                routing,
                start_measure,
                end_measure,
                pedal.position.beats(),
                pedal.end.position.beats(),
                &pedal.pedal_type,
                pedal.style.as_ref(),
                index,
                sp,
                config,
            );
        }
    }
}

pub(crate) fn render_staff_spanner_continuations(
    dl: &mut DisplayList,
    score: &Score,
    part_index: usize,
    staff_number: u32,
    bounds_staff_index: usize,
    sp: f64,
    config: &LayoutConfig,
) {
    render_staff_spanner_continuations_with_routing(
        dl,
        score,
        part_index,
        staff_number,
        &StaffRouting::Fixed(bounds_staff_index),
        sp,
        config,
    );
}

pub(crate) fn render_routed_staff_spanner_continuations(
    dl: &mut DisplayList,
    score: &Score,
    routes: &[LayoutStaffRoute],
    sp: f64,
    config: &LayoutConfig,
) {
    let mut sources = std::collections::HashSet::new();
    for route in routes {
        if sources.insert((route.part_index, route.staff_number)) {
            render_staff_spanner_continuations_with_routing(
                dl,
                score,
                route.part_index,
                route.staff_number,
                &StaffRouting::PerSystem(routes),
                sp,
                config,
            );
        }
    }
}

pub(crate) fn render_layout_staff_spanner_continuations(
    dl: &mut DisplayList,
    score: &Score,
    flat_staves: &[super::full_score::FlatStaff],
    sp: f64,
    config: &LayoutConfig,
) {
    for (bounds_staff_index, staff) in flat_staves.iter().enumerate() {
        for source in &staff.sources {
            render_staff_spanner_continuations(
                dl,
                score,
                source.part_index,
                source.staff_number.unwrap_or(1),
                bounds_staff_index,
                sp,
                config,
            );
        }
    }
}

fn staff_bounds(
    dl: &DisplayList,
    part_index: usize,
    staff_number: u32,
    routing: &StaffRouting<'_>,
    measure_index: usize,
) -> Vec<crate::render::MeasureBounds> {
    dl.measure_bounds
        .iter()
        .filter(|bound| {
            bound.part_index == part_index
                && bound.index == measure_index
                && routing.matches(
                    bound.system_index,
                    part_index,
                    staff_number,
                    bound.staff_index,
                )
        })
        .cloned()
        .collect()
}

fn beat_x(bound: &crate::render::MeasureBounds, beat: f64) -> f64 {
    let content_start = bound.x + bound.prefix_width;
    let content_end = bound.x + bound.width;
    let mut before = (0.0, content_start);
    for &(at, x) in &bound.beat_anchors {
        if at >= beat {
            let span = (at - before.0).max(f64::EPSILON);
            return before.1 + (beat - before.0).max(0.0) / span * (x - before.1);
        }
        before = (at, x);
    }
    let span = (bound.total_beats - before.0).max(f64::EPSILON);
    before.1 + (beat - before.0).max(0.0) / span * (content_end - before.1)
}

fn system_staff_bounds(
    dl: &DisplayList,
    part_index: usize,
    staff_number: u32,
    routing: &StaffRouting<'_>,
    first_system: usize,
    last_system: usize,
) -> Vec<(usize, f64, f64, f64)> {
    let mut systems: Vec<(usize, f64, f64, f64)> = Vec::new();
    for bound in dl.measure_bounds.iter().filter(|bound| {
        bound.part_index == part_index
            && bound.system_index >= first_system
            && bound.system_index <= last_system
            && routing.matches(
                bound.system_index,
                part_index,
                staff_number,
                bound.staff_index,
            )
    }) {
        if let Some((_, left, right, _)) = systems
            .iter_mut()
            .find(|(system, _, _, _)| *system == bound.system_index)
        {
            *left = left.min(bound.x);
            *right = right.max(bound.x + bound.width);
        } else {
            systems.push((bound.system_index, bound.x, bound.x + bound.width, bound.y));
        }
    }
    systems
}

#[allow(clippy::too_many_arguments)]
fn render_ottava_fragments(
    dl: &mut DisplayList,
    part_index: usize,
    staff_number: u32,
    routing: &StaffRouting<'_>,
    start_measure: usize,
    end_measure: usize,
    start_beat: f64,
    end_beat: f64,
    value: i32,
    orient: Option<&Orientation>,
    source_index: usize,
    sp: f64,
) {
    let starts = staff_bounds(dl, part_index, staff_number, routing, start_measure);
    let ends = staff_bounds(dl, part_index, staff_number, routing, end_measure);
    let (Some(start), Some(end)) = (starts.first(), ends.first()) else {
        return;
    };
    if start.system_index == end.system_index {
        return;
    }
    let above = !matches!(orient, Some(Orientation::Below)) && value > 0
        || matches!(orient, Some(Orientation::Above));
    let y = if above {
        start.y - 3.0 * sp
    } else {
        start.y + 6.0 * sp
    };
    let (glyph, _) = smufl::ottava_glyph(value);
    let id = element_id::ottava(part_index, start_measure, source_index);
    let start_x = beat_x(start, start_beat);
    let end_x = beat_x(end, end_beat);
    let cmd_start = dl.commands.len();
    dl.push(RenderCommand::DrawGlyph {
        x: start_x,
        y,
        codepoint: glyph,
        font: "Bravura".into(),
        size: 3.0 * sp,
        color: "#000000".into(),
        rotation: 0.0,
    });
    let fragments: Vec<_> = system_staff_bounds(
        dl,
        part_index,
        staff_number,
        routing,
        start.system_index,
        end.system_index,
    )
    .into_iter()
    .map(|(system, system_left, system_right, staff_y)| {
        let left = if system == start.system_index {
            start_x + 3.0 * sp
        } else {
            system_left
        };
        let right = if system == end.system_index {
            end_x
        } else {
            system_right
        };
        let fragment_y = if above {
            staff_y - 4.4 * sp
        } else {
            staff_y + 6.0 * sp
        };
        (left, right, fragment_y)
    })
    .collect();
    for (left, right, fragment_y) in fragments {
        if right > left {
            dl.push(RenderCommand::DrawLine {
                x1: left,
                y1: fragment_y,
                x2: right,
                y2: fragment_y,
                width: 0.16 * sp,
                color: "#000000".into(),
            });
        }
    }
    let end_line_y = if above {
        end.y - 4.4 * sp
    } else {
        end.y + 6.0 * sp
    };
    dl.push(RenderCommand::DrawLine {
        x1: end_x,
        y1: end_line_y,
        x2: end_x,
        y2: end_line_y + if above { sp } else { -sp },
        width: 0.16 * sp,
        color: "#000000".into(),
    });
    for command in cmd_start..dl.commands.len() {
        dl.tag_command(command, id.clone());
    }
}

#[allow(clippy::too_many_arguments)]
fn render_pedal_fragments(
    dl: &mut DisplayList,
    part_index: usize,
    staff_number: u32,
    routing: &StaffRouting<'_>,
    start_measure: usize,
    end_measure: usize,
    start_beat: f64,
    end_beat: f64,
    pedal_type: &crate::model::PedalType,
    style: Option<&crate::model::PedalLineStyle>,
    source_index: usize,
    sp: f64,
    config: &LayoutConfig,
) {
    let starts = staff_bounds(dl, part_index, staff_number, routing, start_measure);
    let ends = staff_bounds(dl, part_index, staff_number, routing, end_measure);
    let (Some(start), Some(end)) = (starts.first(), ends.first()) else {
        return;
    };
    if start.system_index == end.system_index {
        return;
    }
    let id = element_id::pedal(part_index, start_measure, source_index);
    let cmd_start = dl.commands.len();
    let start_x = beat_x(start, start_beat);
    let end_x = beat_x(end, end_beat);
    if !matches!(style, Some(crate::model::PedalLineStyle::Bracket)) {
        let start_y = start.y + 4.0 * sp + config.pedal_min_distance * sp;
        let end_y = end.y + 4.0 * sp + config.pedal_min_distance * sp;
        if matches!(pedal_type, crate::model::PedalType::UnaCorda) {
            for (x, y, text) in [(start_x, start_y, "una corda"), (end_x, end_y, "tre corde")] {
                dl.push(RenderCommand::DrawText {
                    x,
                    y,
                    text: text.into(),
                    font: "italic serif".into(),
                    size: 1.5 * sp,
                    color: "#000000".into(),
                    align: crate::render::TextAlign::Left,
                    baseline: crate::render::TextBaseline::Alphabetic,
                });
            }
            for command in cmd_start..dl.commands.len() {
                dl.tag_command(command, id.clone());
            }
            return;
        }
        let (start_glyph, _) = smufl::pedal_start_glyph(pedal_type);
        dl.push(RenderCommand::DrawGlyph {
            x: start_x,
            y: start_y,
            codepoint: start_glyph,
            size: 4.0 * sp,
            color: "#000000".into(),
            font: "Bravura".into(),
            rotation: 0.0,
        });
        dl.push(RenderCommand::DrawGlyph {
            x: end_x,
            y: end_y,
            codepoint: smufl::KEYBOARD_PEDAL_UP,
            size: 4.0 * sp,
            color: "#000000".into(),
            font: "Bravura".into(),
            rotation: 0.0,
        });
        for command in cmd_start..dl.commands.len() {
            dl.tag_command(command, id.clone());
        }
        return;
    }
    let fragments: Vec<_> = system_staff_bounds(
        dl,
        part_index,
        staff_number,
        routing,
        start.system_index,
        end.system_index,
    )
    .into_iter()
    .map(|(system, system_left, system_right, staff_y)| {
        let left = if system == start.system_index {
            start_x
        } else {
            system_left
        };
        let right = if system == end.system_index {
            end_x
        } else {
            system_right
        };
        (
            left,
            right,
            staff_y + 4.0 * sp + config.pedal_min_distance * sp,
        )
    })
    .collect();
    for (left, right, y) in fragments {
        if right > left {
            dl.push(RenderCommand::DrawLine {
                x1: left,
                y1: y,
                x2: right,
                y2: y,
                width: config.pedal_line_width * sp,
                color: "#000000".into(),
            });
        }
    }
    let start_y = start.y + 4.0 * sp + config.pedal_min_distance * sp;
    let end_y = end.y + 4.0 * sp + config.pedal_min_distance * sp;
    dl.push(RenderCommand::DrawLine {
        x1: start_x,
        y1: start_y - config.pedal_hook_height * sp,
        x2: start_x,
        y2: start_y,
        width: config.pedal_line_width * sp,
        color: "#000000".into(),
    });
    dl.push(RenderCommand::DrawLine {
        x1: end_x,
        y1: end_y,
        x2: end_x,
        y2: end_y - config.pedal_hook_height * sp,
        width: config.pedal_line_width * sp,
        color: "#000000".into(),
    });
    for command in cmd_start..dl.commands.len() {
        dl.tag_command(command, id.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // (part, staff) for each candidate index.
    fn fixture() -> Vec<(usize, usize)> {
        vec![
            (0, 0), // 0: other part
            (1, 1), // 1: same part, other staff
            (1, 0), // 2: same part, same staff
            (1, 1), // 3: same part, other staff (duplicate of 1)
        ]
    }

    #[test]
    fn prefers_same_part_and_staff() {
        let locs = fixture();
        let got = prefer_target(&[0, 1, 2, 3], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, Some(2), "same (part,staff) candidate must win");
    }

    #[test]
    fn falls_back_to_same_part() {
        let locs = fixture();
        // No same-staff candidate present (drop index 2).
        let got = prefer_target(&[0, 1, 3], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, Some(1), "first same-part candidate when no same-staff");
    }

    #[test]
    fn falls_back_to_any() {
        let locs = fixture();
        // No same-part candidate at all (only the other-part index 0).
        let got = prefer_target(&[0], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, Some(0), "any candidate when no part match");
    }

    #[test]
    fn none_when_empty() {
        let locs = fixture();
        let got = prefer_target(&[], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, None);
    }
}
