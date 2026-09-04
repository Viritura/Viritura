use super::measure::layout_total_beats;
use super::types::MeasureLayout;

/// Build beat-to-X anchors from the first voice's actual event positions.
pub(crate) fn build_beat_anchors(ml: &MeasureLayout) -> (f64, Vec<(f64, f64)>) {
    let total_beats = layout_total_beats(&ml.resolved);
    let content_left = ml.x + ml.prefix_width;
    let content_right = ml.x + ml.width;

    if let Some(voice) = ml.voice_layouts.first() {
        let event_count = voice.events.len();
        let all_rests = (0..event_count).all(|index| voice.events.event(index).is_rest());
        if all_rests || event_count == 0 {
            return (
                total_beats,
                vec![(0.0, content_left), (total_beats, content_right)],
            );
        }

        let mut anchors: Vec<(f64, f64)> = (0..event_count)
            .map(|index| (voice.events.beat_position(index), voice.events.x(index)))
            .collect();
        anchors.push((total_beats, content_right));
        (total_beats, anchors)
    } else {
        (
            total_beats,
            vec![(0.0, content_left), (total_beats, content_right)],
        )
    }
}
