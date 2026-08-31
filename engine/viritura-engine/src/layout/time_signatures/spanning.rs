//! Per-group time signatures.
//!
//! Distribution is the only policy owned here. Glyph style, scale, and
//! vertical alignment are delegated back to the shared time-signature layout,
//! so choosing one meter per group never silently changes how that meter looks.

use crate::layout::config::LayoutConfig;
use crate::layout::element_id;
use crate::layout::full_score::GroupRange;
use crate::layout::types::MeasureLayout;
use crate::model::time::{
    TimeSignatureDistribution, TimeSignatureGrandStaff, TimeSignatureSettings,
};
use crate::render::DisplayList;

/// Engrave the group meters for one vertical span at every measure that
/// explicitly states a time signature.
///
/// A no-op unless distribution is `perGroup`, so callers can invoke it
/// unconditionally after their staff geometry has settled.
pub(crate) fn render_span_meters(
    dl: &mut DisplayList,
    measure_layouts: &[MeasureLayout],
    top_y: f64,
    bottom_y: f64,
    config: &LayoutConfig,
) {
    let settings = config.time_signature_settings;
    if settings.distribution != TimeSignatureDistribution::PerGroup {
        return;
    }
    let sp = config.sp;
    for ml in measure_layouts {
        let Some(ts) = ml.resolved.global.time.as_ref() else {
            continue;
        };
        let x = super::meter_origin_x(ml, ts, settings, sp);
        let layout = super::time_signature_layout(settings, ts, x, top_y, bottom_y, sp);
        let cmd_idx = dl.commands.len();
        super::render_time_signature_layout(dl, &layout);
        for ci in cmd_idx..dl.commands.len() {
            dl.tag_command(ci, element_id::time_sig(ml.resolved.index));
        }
    }
}

/// Engrave one meter per top-level bracket group, plus one for every staff
/// outside a group. Brace groups may be included as a single group or split
/// back into their constituent staves by the grand-staff setting.
pub(crate) fn render_system_group_meters(
    dl: &mut DisplayList,
    all_staff_layouts: &[Vec<MeasureLayout>],
    groups: &[GroupRange],
    staff_y_offsets: &[f64],
    config: &LayoutConfig,
) {
    let settings = config.time_signature_settings;
    if settings.distribution != TimeSignatureDistribution::PerGroup {
        return;
    }

    let staff_count = staff_y_offsets.len().min(all_staff_layouts.len());
    if staff_count == 0 {
        return;
    }

    let spans = group_spans(groups, staff_count, settings);
    let staff_height = 4.0 * config.sp;
    for (first_staff, last_staff) in spans {
        render_span_meters(
            dl,
            &all_staff_layouts[first_staff],
            staff_y_offsets[first_staff],
            staff_y_offsets[last_staff] + staff_height,
            config,
        );
    }
}

/// Engrave a braced grand staff according to the include/exclude policy.
pub(crate) fn render_grand_staff_meters(
    dl: &mut DisplayList,
    all_staff_layouts: &[Vec<MeasureLayout>],
    staff_y_offsets: &[f64],
    config: &LayoutConfig,
) {
    let settings = config.time_signature_settings;
    if settings.distribution != TimeSignatureDistribution::PerGroup
        || all_staff_layouts.is_empty()
        || staff_y_offsets.is_empty()
    {
        return;
    }
    let staff_height = 4.0 * config.sp;
    match settings.grand_staff {
        TimeSignatureGrandStaff::Include => {
            render_span_meters(
                dl,
                &all_staff_layouts[0],
                staff_y_offsets[0],
                staff_y_offsets[staff_y_offsets.len() - 1] + staff_height,
                config,
            );
        }
        TimeSignatureGrandStaff::Exclude => {
            for (layouts, &staff_y) in all_staff_layouts.iter().zip(staff_y_offsets) {
                render_span_meters(dl, layouts, staff_y, staff_y + staff_height, config);
            }
        }
    }
}

fn group_spans(
    groups: &[GroupRange],
    staff_count: usize,
    settings: TimeSignatureSettings,
) -> Vec<(usize, usize)> {
    let mut covered = vec![false; staff_count];
    let mut spans = Vec::new();

    for group in groups.iter().filter(|group| group.depth == 0) {
        if group.first_staff >= staff_count || group.last_staff >= staff_count {
            continue;
        }

        let split_grand_staff =
            group.symbol == "brace" && settings.grand_staff == TimeSignatureGrandStaff::Exclude;
        if split_grand_staff {
            spans.extend((group.first_staff..=group.last_staff).map(|staff| (staff, staff)));
        } else {
            spans.push((group.first_staff, group.last_staff));
        }
        for slot in covered
            .iter_mut()
            .take(group.last_staff + 1)
            .skip(group.first_staff)
        {
            *slot = true;
        }
    }

    for (staff, is_covered) in covered.iter().enumerate() {
        if !is_covered {
            spans.push((staff, staff));
        }
    }
    spans.sort_unstable();
    spans.dedup();
    spans
}

/// Whether this staff owns a meter for obstacle/vertical-spacing purposes.
pub(crate) fn staff_receives_meter(
    staff_index: usize,
    groups: &[GroupRange],
    staff_count: usize,
    settings: TimeSignatureSettings,
) -> bool {
    if settings.distribution == TimeSignatureDistribution::PerStaff {
        return true;
    }
    let group = groups.iter().find(|group| {
        group.depth == 0
            && group.first_staff < staff_count
            && group.last_staff < staff_count
            && group.first_staff <= staff_index
            && staff_index <= group.last_staff
    });
    match group {
        Some(group)
            if group.symbol == "brace"
                && settings.grand_staff == TimeSignatureGrandStaff::Exclude =>
        {
            true
        }
        Some(group) => staff_index == group.first_staff,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::time::TimeSignatureGrandStaff;

    fn group(symbol: &str, first: usize, last: usize) -> GroupRange {
        GroupRange {
            first_staff: first,
            last_staff: last,
            symbol: symbol.into(),
            label: None,
            depth: 0,
        }
    }

    #[test]
    fn excluded_grand_staff_splits_a_brace_but_not_a_bracket() {
        let groups = [group("brace", 0, 1), group("bracket", 2, 3)];
        let settings = TimeSignatureSettings {
            grand_staff: TimeSignatureGrandStaff::Exclude,
            ..TimeSignatureSettings::default()
        };
        assert_eq!(
            group_spans(&groups, 4, settings),
            vec![(0, 0), (1, 1), (2, 3)]
        );
    }

    #[test]
    fn included_grand_staff_keeps_the_brace_together() {
        let groups = [group("brace", 0, 1)];
        assert_eq!(
            group_spans(&groups, 3, TimeSignatureSettings::default()),
            vec![(0, 1), (2, 2)]
        );
    }
}
