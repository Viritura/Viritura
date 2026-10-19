use crate::layout::measure::layout_total_beats;
use crate::layout::types::MeasureLayout;
use crate::model::RhythmicPosition;

/// Standard engraving practice: navigation signs align with their musical
/// instant, not the beginning/end of the containing bar.
pub(super) fn marker_x(ml: &MeasureLayout, position: &RhythmicPosition, sp: f64) -> f64 {
    let end = layout_total_beats(&ml.resolved);
    let beat = position.beats().clamp(0.0, end);
    let right =
        ml.x + ml.prefix_width + crate::layout::render_barlines::rhythmic_content_width(ml, sp);
    if beat >= end {
        return right;
    }
    let mut anchors: Vec<(f64, f64)> = ml
        .voice_layouts
        .iter()
        .flat_map(|voice| {
            (0..voice.events.len())
                .map(|index| (voice.events.beat_position(index), voice.events.x(index)))
        })
        .collect();
    anchors.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
    anchors.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-8);
    if anchors.first().is_none_or(|a| a.0 > 0.0) {
        anchors.insert(0, (0.0, ml.x + ml.prefix_width + 0.5 * sp));
    }
    anchors.push((end, right));
    for pair in anchors.windows(2) {
        let [(b0, x0), (b1, x1)] = pair else {
            unreachable!()
        };
        if beat >= *b0 && beat <= *b1 {
            return x0 + (x1 - x0) * (beat - b0) / (b1 - b0).max(1e-8);
        }
    }
    ml.x + ml.prefix_width
}
