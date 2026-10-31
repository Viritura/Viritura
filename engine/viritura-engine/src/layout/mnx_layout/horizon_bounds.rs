use crate::render::DisplayList;

/// Apply the constant galley headroom (Lever 0): shift every coordinate store
/// down by a fixed reserve so above-staff protrusion sits inside the workspace.
///
/// The offset is a constant (`pad_y`), not content-derived, so it is stable
/// across edits. This lets retained Horizon segments stay at stable absolute Y
/// positions and patch frames engage rather than re-fitting after every edit.
///
/// Width and height remain structural so full and patch frame dimensions agree.
/// The client applies this same offset via the patch's `galley_offset_y` scalar.
pub(super) fn fit_unpaged_bounds(dl: &mut DisplayList, pad_y: f64, _pad_x: f64) {
    dl.translate(0.0, pad_y);
}
