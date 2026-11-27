use super::super::full_score::{FlatLabel, FlatStaff, GroupRange};
use crate::layout::text_styles::TextStyle;
use crate::model::{InstrumentNameDisplayPolicy, InstrumentNameDisplaySettings};
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};
mod active_names;
pub(super) use active_names::{
    dependency_salt as label_dependency_salt, groups_at as active_groups_at, resolve_components,
    staves_at as active_staves_at,
};

/// Color used for expansion source staves — blue-tinted gray derived from primary accent #2a7bc8.
pub(super) const EXPANSION_COLOR: &str = "#667890";

/// Split a staff label into two lines when it contains a transposition.
pub(super) fn split_label_transposition(label: &str) -> (&str, Option<&str>) {
    if let Some(idx) = label.find(" in ") {
        let base = &label[..idx];
        let transposition = &label[idx + 1..];
        (base, Some(transposition))
    } else {
        (label, None)
    }
}

/// Build staff-label name lines, putting a transposition on its own line.
///
/// Condensed player numbers are never merged into these lines: standard
/// engraving practice prints one shared instrument name with the player
/// numbers stacked in a separate column, transposing or not.
pub(super) fn build_label_lines(label: &str) -> Vec<String> {
    if label.contains('\n') {
        return label.lines().flat_map(build_label_lines).collect();
    }
    let (line1, line2) = split_label_transposition(label);
    let mut lines = vec![line1.to_string()];
    if let Some(line2) = line2 {
        lines.push(line2.to_string());
    }
    lines
}

/// Pixel extent from the right-hand anchor to the label's leftmost glyph.
///
/// Must measure with the same style [`render_staff_labels`] draws with, or the
/// reserved gutter and the glyphs disagree and long names collide with the
/// system's left margin.
pub(super) fn label_gutter_extent(
    label: &str,
    condensed_numbers: &[u32],
    sp: f64,
    style: &TextStyle,
) -> f64 {
    use crate::layout::text_styles::text_width;

    let label_font_size = style.size_px(sp);
    let max_line_width = build_label_lines(label)
        .iter()
        .map(|line| text_width(line, label_font_size, style.family, style.bold))
        .fold(0.0_f64, f64::max);
    let number_offset = if !condensed_numbers.is_empty() {
        label_font_size * 0.75 + 0.5 * sp
    } else {
        0.0
    };
    number_offset + max_line_width
}

pub(super) fn policy_for_system(
    settings: Option<&InstrumentNameDisplaySettings>,
    system_index: usize,
) -> Option<InstrumentNameDisplayPolicy> {
    settings.map(|settings| {
        if system_index == 0 {
            settings.first_system
        } else {
            settings.subsequent_systems
        }
    })
}

pub(super) fn label_snapshots(
    staves: &[FlatStaff],
    groups: &[GroupRange],
    score: &crate::model::Score,
) -> Vec<(Vec<FlatStaff>, Vec<GroupRange>)> {
    active_names::change_indices(score)
        .into_iter()
        .map(|index| {
            (
                active_staves_at(staves, score, index),
                active_groups_at(groups, score, index),
            )
        })
        .collect()
}

/// Place nested group labels to the left of the staff and inner-group labels.
pub(super) fn label_column_layout(
    staves: &[FlatStaff],
    groups: &[GroupRange],
    is_first_system: bool,
    policy: Option<InstrumentNameDisplayPolicy>,
    sp: f64,
    style: &TextStyle,
) -> (f64, Vec<f64>) {
    let staff_width = staves
        .iter()
        .enumerate()
        .filter_map(|(index, staff)| {
            if staff_uses_group_label(index, staves, groups, is_first_system, policy) {
                return None;
            }
            label_text(staff, is_first_system, policy)
                .map(|label| label_gutter_extent(label, &staff.condensed_numbers, sp, style))
        })
        .fold(0.0_f64, f64::max);
    let gap = 0.5 * sp;
    let mut offsets = vec![0.0; groups.len()];
    let mut ends: Vec<Option<f64>> = vec![None; groups.len()];
    let mut extent = staff_width;
    for (index, group) in groups.iter().enumerate() {
        let Some(label) = group_label_text(group, staves, is_first_system, policy) else {
            continue;
        };
        let mut offset = if staff_width > 0.0 {
            staff_width + gap
        } else {
            0.0
        };
        for (inner_index, inner) in groups[..index].iter().enumerate() {
            if inner.first_staff >= group.first_staff && inner.last_staff <= group.last_staff {
                if let Some(end) = ends[inner_index] {
                    offset = offset.max(end + gap);
                }
            }
        }
        let width = if group.source_parts.len() > 1 {
            build_label_lines(label).len() as f64 * style.size_px(sp) * 1.15
        } else {
            label_gutter_extent(label, &[], sp, style)
        };
        let end = offset + width;
        offsets[index] = offset;
        ends[index] = Some(end);
        extent = extent.max(end);
    }
    (extent, offsets)
}

/// Instrument-label gutters for first and subsequent authored systems.
pub(super) fn explicit_label_margins(
    system_flat_staves: &[(Vec<FlatStaff>, Vec<GroupRange>)],
    settings: Option<&InstrumentNameDisplaySettings>,
    sp: f64,
    label_style: &TextStyle,
    score: &crate::model::Score,
) -> (f64, f64) {
    let variants: Vec<_> = system_flat_staves
        .iter()
        .flat_map(|(staves, groups)| label_snapshots(staves, groups, score))
        .collect();
    let margin = |policy: Option<InstrumentNameDisplayPolicy>, is_first_system: bool| {
        let widest = variants
            .iter()
            .map(|(staves, groups)| {
                label_column_layout(staves, groups, is_first_system, policy, sp, label_style).0
            })
            .fold(0.0_f64, f64::max);
        if widest > 0.0 {
            widest + 2.0 * sp
        } else {
            0.0
        }
    };
    (
        margin(settings.map(|value| value.first_system), true),
        margin(settings.map(|value| value.subsequent_systems), false),
    )
}

/// Render instrument labels in the left margin of a system.
///
/// `style` is the resolved [`TextRole::StaffLabel`](crate::layout::text_styles::TextRole)
/// style. Its `align` is deliberately not applied: these labels are
/// right-anchored against the system's left margin, and the gutter width is
/// measured from that anchor, so honouring a left/centre alignment here would
/// detach the names from the space reserved for them.
#[allow(clippy::too_many_arguments)] // rendering boundary: geometry and system identity are independent inputs
pub(super) fn render_staff_labels(
    dl: &mut DisplayList,
    flat_staves: &[FlatStaff],
    group_ranges: &[GroupRange],
    staff_y_offsets: &[f64],
    label_x: f64,
    staff_height: f64,
    sp: f64,
    sys_idx: usize,
    policy: Option<InstrumentNameDisplayPolicy>,
    style: &TextStyle,
) {
    let is_first_system = sys_idx == 0;
    let label_font_size = style.size_px(sp);
    let cap_offset =
        crate::layout::text_styles::cap_center_offset_from_baseline(style.family, label_font_size);

    for (index, flat_staff) in flat_staves.iter().enumerate() {
        if index >= staff_y_offsets.len() {
            continue;
        }
        if staff_uses_group_label(index, flat_staves, group_ranges, is_first_system, policy) {
            continue;
        }
        let containing_brace = group_ranges.iter().find(|group| {
            index >= group.first_staff && index <= group.last_staff && group.symbol == "brace"
        });
        let shared_part_brace = containing_brace.filter(|group| {
            group_label_text(group, flat_staves, is_first_system, policy).is_none()
                && group.first_staff < group.last_staff
                && staves_share_single_part(flat_staves, group)
                && staves_share_label(flat_staves, group, is_first_system, policy)
        });
        if shared_part_brace.is_some_and(|group| index != group.first_staff) {
            continue;
        }

        let (label_staff, label_y, expansion) = if let Some(group) = shared_part_brace {
            let group_staves = &flat_staves[group.first_staff..=group.last_staff];
            let Some(label_staff) = group_staves
                .iter()
                .find(|staff| label_text(staff, is_first_system, policy).is_some())
            else {
                continue;
            };
            let group_top = staff_y_offsets[group.first_staff];
            let group_bottom = staff_y_offsets[group.last_staff] + staff_height;
            (
                label_staff,
                (group_top + group_bottom) * 0.5,
                group_staves.iter().any(|staff| staff.expansion),
            )
        } else {
            (
                flat_staff,
                staff_y_offsets[index] + staff_height * 0.5,
                flat_staff.expansion,
            )
        };
        let Some(text) = label_text(label_staff, is_first_system, policy) else {
            continue;
        };

        let recolor_start = dl.commands.len();
        let condensed_numbers = &label_staff.condensed_numbers;
        let has_number_column = !condensed_numbers.is_empty();
        let lines = build_label_lines(text);
        let number_column_gap = 0.5 * sp;
        let number_column_width = label_font_size * 0.75;
        let name_x = if has_number_column {
            label_x - number_column_width - number_column_gap
        } else {
            label_x
        };

        if lines.len() == 1 {
            push_label_line(dl, name_x, label_y + cap_offset, &lines[0], sp, style);
        } else {
            let line_height = label_font_size * 1.15;
            let top_y = label_y - line_height * (lines.len() as f64 - 1.0) * 0.5;
            for (line_index, line) in lines.iter().enumerate() {
                push_label_line(
                    dl,
                    name_x,
                    top_y + line_height * line_index as f64 + cap_offset,
                    line,
                    sp,
                    style,
                );
            }
        }

        if has_number_column {
            let line_height = label_font_size * 1.15;
            let top_y = label_y - line_height * (condensed_numbers.len() as f64 - 1.0) * 0.5;
            for (number_index, number) in condensed_numbers.iter().enumerate() {
                push_label_line(
                    dl,
                    label_x,
                    top_y + line_height * number_index as f64 + cap_offset,
                    &number.to_string(),
                    sp,
                    style,
                );
            }
        }

        if expansion {
            dl.recolor_range(recolor_start, EXPANSION_COLOR);
        }
    }
}

fn staves_share_label(
    flat_staves: &[FlatStaff],
    group: &GroupRange,
    is_first_system: bool,
    policy: Option<InstrumentNameDisplayPolicy>,
) -> bool {
    let mut labels = flat_staves[group.first_staff..=group.last_staff]
        .iter()
        .filter_map(|staff| label_text(staff, is_first_system, policy));
    let Some(first) = labels.next() else {
        return true;
    };
    labels.all(|label| label == first)
}

pub(super) fn label_text(
    flat_staff: &FlatStaff,
    is_first_system: bool,
    policy: Option<InstrumentNameDisplayPolicy>,
) -> Option<&str> {
    match policy {
        Some(InstrumentNameDisplayPolicy::Full) => flat_staff.resolved_full_label.as_deref(),
        Some(InstrumentNameDisplayPolicy::Short) => flat_staff
            .resolved_short_label
            .as_deref()
            .or(flat_staff.resolved_full_label.as_deref()),
        Some(InstrumentNameDisplayPolicy::Hidden) => None,
        None if is_first_system => flat_staff.label.as_deref(),
        None => flat_staff
            .short_label
            .as_deref()
            .or(flat_staff.label.as_deref()),
    }
}

fn policy_group_staff_label<'a>(
    group: &GroupRange,
    staves: &'a [FlatStaff],
    is_first_system: bool,
    policy: Option<InstrumentNameDisplayPolicy>,
) -> Option<&'a str> {
    let [part] = group.source_parts.as_slice() else {
        return None;
    };
    if group.label_components.is_empty()
        || !matches!(
            policy,
            Some(InstrumentNameDisplayPolicy::Full | InstrumentNameDisplayPolicy::Short)
        )
    {
        return None;
    }
    let members = staves.get(group.first_staff..=group.last_staff)?;
    if !staves_share_single_part(staves, group)
        || !staves_share_label(staves, group, is_first_system, policy)
        || !members.iter().all(|staff| {
            matches!(
                staff.label_components.as_slice(),
                [FlatLabel::Part { part_index, .. }] if part_index == part
            )
        })
    {
        return None;
    }
    members
        .first()
        .and_then(|staff| label_text(staff, is_first_system, policy))
}

fn staff_uses_group_label(
    index: usize,
    staves: &[FlatStaff],
    groups: &[GroupRange],
    is_first_system: bool,
    policy: Option<InstrumentNameDisplayPolicy>,
) -> bool {
    groups.iter().any(|group| {
        index >= group.first_staff
            && index <= group.last_staff
            && policy_group_staff_label(group, staves, is_first_system, policy).is_some()
    })
}

pub(super) fn group_label_text<'a>(
    group: &'a GroupRange,
    staves: &'a [FlatStaff],
    is_first_system: bool,
    policy: Option<InstrumentNameDisplayPolicy>,
) -> Option<&'a str> {
    if group.source_parts.len() > 1 {
        return if group.show_group_name {
            if is_first_system {
                group.label.as_deref()
            } else {
                group.short_label.as_deref().or(group.label.as_deref())
            }
        } else {
            None
        };
    }
    if let Some(label) = policy_group_staff_label(group, staves, is_first_system, policy) {
        return Some(label);
    }
    match policy {
        Some(InstrumentNameDisplayPolicy::Full) => group.resolved_full_label.as_deref(),
        Some(InstrumentNameDisplayPolicy::Short) => group
            .resolved_short_label
            .as_deref()
            .or(group.resolved_full_label.as_deref()),
        Some(InstrumentNameDisplayPolicy::Hidden) => None,
        None if is_first_system => group.label.as_deref(),
        None => group.short_label.as_deref().or(group.label.as_deref()),
    }
}

fn staves_share_single_part(flat_staves: &[FlatStaff], group: &GroupRange) -> bool {
    let Some(first_source) = flat_staves
        .get(group.first_staff)
        .and_then(|staff| staff.sources.first())
    else {
        return false;
    };
    flat_staves
        .get(group.first_staff..=group.last_staff)
        .is_some_and(|staves| {
            staves.iter().all(|staff| {
                !staff.sources.is_empty()
                    && staff
                        .sources
                        .iter()
                        .all(|source| source.part_index == first_source.part_index)
            })
        })
}

/// Emit one label line. Right-aligned by construction — see
/// [`render_staff_labels`] for why the style's own alignment is not used.
fn push_label_line(dl: &mut DisplayList, x: f64, y: f64, text: &str, sp: f64, style: &TextStyle) {
    dl.push(RenderCommand::DrawText {
        x,
        y,
        text: text.to_string(),
        font: style.font_string(),
        size: style.size_px(sp),
        color: style.color.clone(),
        align: TextAlign::Right,
        baseline: TextBaseline::Alphabetic,
    });
}
