use super::super::types::MeasureLayout;
use crate::model::ResolvedMeasure;
use std::collections::HashSet;

/// Horizontal footprint (in spaces) of the 2/3-size change clef engraved in the
/// leading gap before a mid-system start-of-measure barline.
pub(crate) const CLEF_CHANGE_LEADING_GAP_SP: f64 = 3.2;

/// Padding (in spaces) between a mid-system change clef's right edge and the
/// left ink edge of the barline it precedes.
pub(crate) const CLEF_TO_BARLINE_PAD_SP: f64 = 0.7;

pub(crate) fn measure_leading_clef_gap(
    ml: &MeasureLayout,
    sp: f64,
    clef_change_measures: &HashSet<usize>,
) -> f64 {
    if ml.resolved.index != 0
        && !ml.is_first_on_system
        && clef_change_measures.contains(&ml.resolved.index)
    {
        CLEF_CHANGE_LEADING_GAP_SP * sp
    } else {
        0.0
    }
}

/// Exported measure geometry starts at the visible left barline, excluding a
/// change clef engraved before that barline.
pub(crate) fn measure_bounds_geometry(
    ml: &MeasureLayout,
    leading_clef_gap: f64,
) -> (f64, f64, f64) {
    (
        ml.x + leading_clef_gap,
        (ml.width - leading_clef_gap).max(0.0),
        (ml.prefix_width - leading_clef_gap).max(0.0),
    )
}

/// Measures carrying a start-of-measure clef change in any resolved shown staff.
pub(crate) fn clef_change_measure_set_resolved<R: AsRef<[ResolvedMeasure]>>(
    all_resolved: &[R],
) -> HashSet<usize> {
    let mut set = HashSet::new();
    for staff in all_resolved {
        for measure in staff.as_ref() {
            if measure.index == 0 {
                continue;
            }
            if measure
                .part
                .clefs
                .as_ref()
                .is_some_and(|clefs| clefs.iter().any(|clef| clef.position.is_none()))
            {
                set.insert(measure.index);
            }
        }
    }
    set
}

/// Measures carrying a start-of-measure clef change in laid-out shown staves.
pub(crate) fn clef_change_measure_set_from_layouts(
    all_staff_layouts: &[Vec<MeasureLayout>],
) -> HashSet<usize> {
    let mut set = HashSet::new();
    for layouts in all_staff_layouts {
        for measure in layouts {
            if measure.resolved.index == 0 {
                continue;
            }
            if measure
                .resolved
                .part
                .clefs
                .as_ref()
                .is_some_and(|clefs| clefs.iter().any(|clef| clef.position.is_none()))
            {
                set.insert(measure.resolved.index);
            }
        }
    }
    set
}
