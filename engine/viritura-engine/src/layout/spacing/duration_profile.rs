use super::timing::sequence_timeline;
use crate::model::ResolvedMeasure;

/// Collect all event durations from all measures in a part.
pub(crate) fn collect_all_event_durations(measures: &[ResolvedMeasure]) -> Vec<f64> {
    let mut durations = Vec::new();
    for resolved_measure in measures {
        let sequence_count = resolved_measure.part.sequences.len();
        for (sequence_index, sequence) in resolved_measure.part.sequences.iter().enumerate() {
            if sequence.full_measure.is_some() {
                continue;
            }
            durations.extend(
                sequence_timeline(sequence, sequence_index, sequence_count)
                    .events
                    .into_iter()
                    .map(|event| event.duration_beats),
            );
        }
    }
    durations
}

const STANDARD_DURATION_VALUES: [f64; 12] = [
    0.015625, 0.03125, 0.0625, 0.125, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0, 16.0, 32.0,
];

pub(crate) type DurationHistogram = [usize; STANDARD_DURATION_VALUES.len()];

/// Quantized duration frequency table for one resolved staff. The global
/// common-duration detector is exactly a sum of these tables, making them safe
/// to retain with an immutable staff snapshot.
pub(crate) fn collect_duration_histogram(measures: &[ResolvedMeasure]) -> DurationHistogram {
    let durations = collect_all_event_durations(measures);
    duration_histogram(&durations)
}

fn duration_histogram(durations: &[f64]) -> DurationHistogram {
    let mut counts = [0; STANDARD_DURATION_VALUES.len()];
    for &duration in durations {
        let index = STANDARD_DURATION_VALUES
            .iter()
            .enumerate()
            .min_by(|(_, left), (_, right)| {
                ((**left) - duration)
                    .abs()
                    .total_cmp(&((**right) - duration).abs())
            })
            .map_or(6, |(index, _)| index);
        counts[index] += 1;
    }
    counts
}

pub(crate) fn detect_common_shortest_from_histogram(counts: &DurationHistogram) -> f64 {
    if counts.iter().all(|count| *count == 0) {
        return 1.0;
    }

    let max_count = counts.iter().max().copied().unwrap_or(1);
    let threshold = (max_count / 4).max(1);
    counts
        .iter()
        .enumerate()
        .find_map(|(index, count)| (*count >= threshold).then_some(STANDARD_DURATION_VALUES[index]))
        .unwrap_or(1.0)
}

pub(crate) fn detect_common_shortest_duration(durations: &[f64]) -> f64 {
    if durations.is_empty() {
        return 1.0;
    }
    detect_common_shortest_from_histogram(&duration_histogram(durations))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_shortest_uses_representative_shortest_value() {
        let mut durations = vec![0.5; 20];
        durations.extend(vec![1.0; 5]);
        assert!((detect_common_shortest_duration(&durations) - 0.5).abs() < 0.01);
    }

    #[test]
    fn common_shortest_ignores_rare_short_outlier() {
        let mut durations = vec![1.0; 20];
        durations.push(0.25);
        assert!((detect_common_shortest_duration(&durations) - 1.0).abs() < 0.01);
    }

    #[test]
    fn empty_profile_defaults_to_quarter_note() {
        assert!((detect_common_shortest_duration(&[]) - 1.0).abs() < f64::EPSILON);
    }
}
