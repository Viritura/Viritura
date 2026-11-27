use super::super::types::EventLayout;

/// Compute the effective staff_y for a cross-staff event.
/// If the event has a `staff` override that differs from its parent sequence's
/// staff, anchor it to the target staff's Y.
///
/// `event.staff` (and `sequence_staff`) are **part-relative** staff numbers
/// (1 = the part's top staff). `staff_y_offsets` holds the Y of every visual
/// staff in the *whole system* (across all parts), so we must NOT index it with
/// the part-relative staff number directly. Instead we recover the current
/// staff's visual index from `staff_y` and shift by the part-relative delta,
/// since a part's staves are contiguous in system order.
/// Falls back to the default `staff_y` when no cross-staff override is active.
pub(in crate::layout) fn cross_staff_y(
    el: &EventLayout,
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
) -> f64 {
    cross_staff_y_scalar(el.event.staff, el.sequence_staff, staff_y, staff_y_offsets)
}

/// Arena-friendly variant of [`cross_staff_y`] taking the two scalar fields it
/// reads (`event.staff`, `sequence_staff`) directly, so callers iterating the
/// `EventArena` need not materialize an `EventLayout`.
pub(in crate::layout) fn cross_staff_y_scalar(
    event_staff: Option<u32>,
    sequence_staff: u32,
    staff_y: f64,
    staff_y_offsets: Option<&[f64]>,
) -> f64 {
    if let Some(target_staff) = event_staff {
        if target_staff != sequence_staff {
            if let Some(offsets) = staff_y_offsets {
                // Recover this staff's visual index by matching its Y, then
                // offset by the part-relative staff delta.
                if let Some(cur_idx) = offsets.iter().position(|&y| (y - staff_y).abs() < 0.5) {
                    let delta = target_staff as i64 - sequence_staff as i64;
                    let tgt = cur_idx as i64 + delta;
                    if tgt >= 0 && (tgt as usize) < offsets.len() {
                        return offsets[tgt as usize];
                    }
                }
            }
        }
    }
    staff_y
}
