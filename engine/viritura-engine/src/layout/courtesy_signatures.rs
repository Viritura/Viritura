//! Courtesy signatures at a system break.
//!
//! Standard engraving practice: when a system opens with a new clef, key, or
//! meter, the end of the preceding system announces it. The courtesy clef
//! precedes the system-end barline; courtesy key and time signatures follow
//! the barline on staff lines that extend past it, with no closing barline.
//! The furniture is derived layout state, never an extra score declaration.

use super::config::LayoutConfig;
use super::render_barlines::{barline_left_extent, barline_right_extent, system_end_barline_kind};
use super::render_signatures::{
    change_clef_width, change_clef_width_sp, key_signature_layout, render_change_clef,
    render_key_signature, staff_has_key_signature,
};
use super::time_signatures::{
    render_time_signature_layout, staff_grouping_override, time_signature_layout,
};
use super::types::MeasureLayout;
use crate::model::time::TimeSignatureDistribution;
use crate::model::*;
use crate::render::DisplayList;

/// Ink clearance after the barline, matching a measure prefix's signatures.
const BARLINE_CLEARANCE_SP: f64 = 0.5;
/// Key-to-meter ink gap, matching a measure prefix's key and time signatures.
const KEY_TO_TIME_SP: f64 = 0.8;
/// Staff-line run beyond the last courtesy glyph.
const STAFF_TAIL_SP: f64 = 0.5;
/// Courtesy-clef ink clearance before the barline's left stroke.
const CLEF_CLEARANCE_SP: f64 = 0.3;

/// Courtesy key and meter announcing `next`, the first measure of the
/// following system. Slot widths are filled in by [`share_system_end`].
pub(crate) fn courtesy_for_boundary(
    current: &ResolvedMeasure,
    next: &ResolvedMeasure,
    config: &LayoutConfig,
) -> SystemEndCourtesy {
    let key = courtesy_key(current, next).filter(|key| key_width_sp(current, key) > 0.0);
    let time = next
        .displayed_time_signature()
        .filter(|time| *time != current.effective_beat_meter())
        .filter(|time| time_width_sp(current, time, config) > 0.0)
        .cloned();
    SystemEndCourtesy {
        clef: courtesy_clef(next),
        key,
        time,
        ..SystemEndCourtesy::default()
    }
}

/// The explicit clef change opening `next`. Carried and default clef contexts
/// carry a rhythmic position, so they never announce a change.
fn courtesy_clef(next: &ResolvedMeasure) -> Option<Clef> {
    next.part
        .clefs
        .as_ref()?
        .iter()
        .find(|pc| pc.position.is_none())
        .map(|pc| pc.clef.clone())
        .filter(|clef| change_clef_width_sp(clef) > 0.0)
}

fn courtesy_key(current: &ResolvedMeasure, next: &ResolvedMeasure) -> Option<CourtesyKeySignature> {
    if !staff_has_key_signature(current)
        || !staff_has_key_signature(next)
        || current.active_key == next.active_key
    {
        return None;
    }
    let clef_sign = next
        .part
        .clefs
        .as_ref()
        .and_then(|clefs| clefs.first())
        .map_or(ClefSign::G, |pc| pc.clef.sign);
    Some(CourtesyKeySignature {
        key: next.active_key.clone(),
        clef_sign,
    })
}

fn key_width_sp(rm: &ResolvedMeasure, key: &CourtesyKeySignature) -> f64 {
    key_signature_layout(
        0.0,
        0.0,
        1.0,
        &key.key,
        &key.clef_sign,
        Some(&rm.active_key),
    )
    .advance
}

fn time_width_sp(rm: &ResolvedMeasure, time: &TimeSignature, config: &LayoutConfig) -> f64 {
    time_signature_layout(
        config.time_signature_settings,
        time,
        0.0,
        0.0,
        4.0,
        1.0,
        staff_grouping_override(&rm.part),
    )
    .width
}

fn barline_clearance_sp(rm: &ResolvedMeasure, config: &LayoutConfig) -> f64 {
    barline_right_extent(&system_end_barline_kind(rm, false), config, 1.0) + BARLINE_CLEARANCE_SP
}

/// Share one clef slot, one key slot, and one staff-line extension across
/// every staff of a system so barlines, beat columns, and courtesy meters
/// align. Returns the total fixed width in staff spaces — the clef slot inside
/// the outgoing measure plus the extension after its barline; it is zero when
/// no staff announces anything.
pub(crate) fn share_system_end<'a>(
    ends: impl IntoIterator<Item = &'a mut ResolvedMeasure>,
    config: &LayoutConfig,
) -> f64 {
    let mut ends: Vec<_> = ends.into_iter().collect();
    // The barline's own trailing buffer already separates the slot from the
    // rhythmic content, so the slot holds only the clef and its clearance.
    let clef_slot = ends
        .iter()
        .filter_map(|rm| rm.system_end.clef.as_ref())
        .map(|clef| change_clef_width_sp(clef) + CLEF_CLEARANCE_SP)
        .fold(0.0_f64, f64::max);
    let key_slot = ends
        .iter()
        .filter_map(|rm| rm.system_end.key.as_ref().map(|key| key_width_sp(rm, key)))
        .fold(0.0_f64, f64::max);
    let time_slot = ends
        .iter()
        .filter_map(|rm| {
            rm.system_end
                .time
                .as_ref()
                .map(|time| time_width_sp(rm, time, config))
        })
        .fold(0.0_f64, f64::max);
    let suffix = if key_slot > 0.0 || time_slot > 0.0 {
        let clearance = ends
            .iter()
            .map(|rm| barline_clearance_sp(rm, config))
            .fold(0.0_f64, f64::max);
        let key_to_time = if key_slot > 0.0 && time_slot > 0.0 {
            KEY_TO_TIME_SP
        } else {
            0.0
        };
        clearance + key_slot + key_to_time + time_slot + STAFF_TAIL_SP
    } else {
        0.0
    };
    for rm in &mut ends {
        rm.system_end.clef_slot_sp = clef_slot;
        rm.system_end.key_slot_sp = key_slot;
        rm.system_end.suffix_sp = suffix;
    }
    clef_slot + suffix
}

/// Clone each staff's outgoing measure with its shared courtesy furniture.
pub(crate) fn system_end_measures<'a>(
    staves: impl Iterator<Item = &'a [ResolvedMeasure]>,
    last_index: Option<usize>,
    next_index: Option<usize>,
    config: &LayoutConfig,
) -> Vec<Option<ResolvedMeasure>> {
    let mut ends: Vec<Option<ResolvedMeasure>> = staves
        .map(|staff| {
            let mut last = staff.get(last_index?)?.clone();
            if let Some(next) = next_index.and_then(|next| staff.get(next)) {
                last.system_end = courtesy_for_boundary(&last, next, config);
            }
            Some(last)
        })
        .collect();
    share_system_end(ends.iter_mut().flatten(), config);
    ends
}

/// Shrinks a system's justification scale so its measures plus the shared
/// courtesy furniture still fill the line.
pub(crate) fn scale_with_suffix(
    scale: f64,
    natural_width: f64,
    ends: &[Option<ResolvedMeasure>],
    sp: f64,
) -> f64 {
    let suffix = ends
        .iter()
        .flatten()
        .map(|rm| (rm.system_end.clef_slot_sp + rm.system_end.suffix_sp) * sp)
        .fold(0.0_f64, f64::max);
    if natural_width > 0.0 {
        (scale - suffix / natural_width).max(0.0)
    } else {
        scale
    }
}

/// Fixed courtesy-clef slot added to the outgoing measure's justified width.
pub(crate) fn clef_slot_width(rm: &ResolvedMeasure, sp: f64) -> f64 {
    rm.system_end.clef_slot_sp * sp
}

/// Right end of the staff lines: past the system-end barline when courtesy
/// signatures follow it.
pub(crate) fn staff_end_x(last: &MeasureLayout, sp: f64) -> f64 {
    last.x + last.width + last.resolved.system_end.suffix_sp * sp
}

/// Origin of the courtesy meter's ink after a barline drawn at `barline_x`.
pub(crate) fn courtesy_time_x<'a>(
    rm: &'a ResolvedMeasure,
    barline_x: f64,
    config: &LayoutConfig,
    sp: f64,
) -> Option<(f64, &'a TimeSignature)> {
    let time = rm.system_end.time.as_ref()?;
    let key_slot = rm.system_end.key_slot_sp;
    let key_to_time = if key_slot > 0.0 { KEY_TO_TIME_SP } else { 0.0 };
    let x = barline_x + (barline_clearance_sp(rm, config) + key_slot + key_to_time) * sp;
    Some((x, time))
}

/// Engrave this staff's courtesy clef before the barline, then its courtesy
/// key and (per-staff) meter after it. Group-distributed meters are engraved
/// by the spanning meter pass.
pub(crate) fn render_system_end_courtesy(
    dl: &mut DisplayList,
    rm: &ResolvedMeasure,
    barline_x: f64,
    staff_y: f64,
    sp: f64,
    config: &LayoutConfig,
) {
    if let Some(clef) = rm.system_end.clef.as_ref() {
        // A courtesy clef implies a following system, so the barline is never final.
        let kind = system_end_barline_kind(rm, false);
        let clef_right =
            barline_x - barline_left_extent(&kind, config, sp) - CLEF_CLEARANCE_SP * sp;
        render_change_clef(
            dl,
            clef_right - change_clef_width(clef, sp),
            staff_y,
            sp,
            clef,
        );
    }
    if let Some(key) = rm.system_end.key.as_ref() {
        render_key_signature(
            dl,
            barline_x + barline_clearance_sp(rm, config) * sp,
            staff_y,
            sp,
            &key.key,
            &key.clef_sign,
            Some(&rm.active_key),
        );
    }
    if config.time_signature_settings.distribution == TimeSignatureDistribution::PerGroup {
        return;
    }
    if let Some((x, time)) = courtesy_time_x(rm, barline_x, config, sp) {
        let layout = time_signature_layout(
            config.time_signature_settings,
            time,
            x,
            staff_y,
            staff_y + 4.0 * sp,
            sp,
            staff_grouping_override(&rm.part),
        );
        render_time_signature_layout(dl, &layout);
    }
}
