//! Tempo → seconds conversion for turn-window analysis.
//!
//! This is a deliberately thin, conservative model — NOT a full port of the
//! `@viritura/midi` tempo system. We only need "how many seconds of rest does
//! the player get at this page boundary", and a piecewise-constant tempo map
//! keyed by measure is accurate enough for that decision.
//!
//! Tempo is sampled at each measure's start; a tempo change mid-measure is
//! approximated by the measure-entry tempo (documented simplification — turn
//! windows live at measure boundaries, where this is exact). Accelerandi and
//! ritardandi are not interpolated; we use the slower (more conservative)
//! endpoint so we never over-promise turn time.

use crate::model::measure::GlobalMeasure;

/// Seconds-per-quarter-note effective entering each measure.
#[derive(Debug, Clone, PartialEq)]
pub struct TempoMap {
    /// `spq[i]` = seconds per quarter-note entering measure `i`.
    spq: Vec<f64>,
}

/// Convert a tempo mark (bpm on a given note value) into seconds-per-quarter.
///
/// One tempo-beat is `value_beats` quarter-notes long and lasts `60/bpm`
/// seconds, so each quarter lasts `(60/bpm) / value_beats` seconds.
fn seconds_per_quarter(bpm: f64, value_beats: f64) -> f64 {
    if bpm <= 0.0 || value_beats <= 0.0 {
        return 0.0;
    }
    (60.0 / bpm) / value_beats
}

/// Beats (incl. dots) carried by a tempo note value.
fn tempo_value_beats(base_beats: f64, dots: u32) -> f64 {
    let mut total = base_beats;
    for d in 0..dots {
        total += base_beats / 2.0_f64.powi(d as i32 + 1);
    }
    total
}

impl TempoMap {
    /// Build a per-measure tempo map from the score's global measures.
    ///
    /// A measure with no tempo inherits the previous measure's tempo; the very
    /// first measure falls back to `default_bpm` (interpreted on a quarter).
    pub fn from_global(measures: &[GlobalMeasure], default_bpm: f64) -> Self {
        let mut spq = Vec::with_capacity(measures.len());
        let mut current = seconds_per_quarter(default_bpm, 1.0);
        for m in measures {
            if let Some(tempos) = &m.tempos {
                if let Some(t) = tempos.first() {
                    let dots = t.value.dots.unwrap_or(0);
                    let vb = tempo_value_beats(t.value.base.beats(), dots);
                    current = seconds_per_quarter(t.bpm, vb);
                }
            }
            spq.push(current);
        }
        Self { spq }
    }

    /// Construct directly from per-measure seconds-per-quarter values
    /// (test/seam constructor).
    pub fn from_spq(spq: Vec<f64>) -> Self {
        Self { spq }
    }

    /// Number of measures covered.
    pub fn len(&self) -> usize {
        self.spq.len()
    }

    /// Whether the map is empty.
    pub fn is_empty(&self) -> bool {
        self.spq.is_empty()
    }

    /// Seconds occupied by `beats` quarter-note beats within `measure`.
    ///
    /// Out-of-range indices clamp to the nearest end (defensive; callers walk
    /// measure ranges that should always be in-bounds).
    pub fn seconds(&self, measure: usize, beats: f64) -> f64 {
        if self.spq.is_empty() {
            return 0.0;
        }
        let idx = measure.min(self.spq.len() - 1);
        self.spq[idx] * beats
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_seconds_per_quarter_basic() {
        // 60 bpm on a quarter → 1 second per quarter.
        assert!((seconds_per_quarter(60.0, 1.0) - 1.0).abs() < 1e-9);
        // 120 bpm on a quarter → 0.5 s/quarter.
        assert!((seconds_per_quarter(120.0, 1.0) - 0.5).abs() < 1e-9);
        // 60 bpm on a half (value_beats=2) → each quarter is 0.5 s.
        assert!((seconds_per_quarter(60.0, 2.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_dotted_tempo_value_beats() {
        // Dotted quarter = 1.5 quarters.
        assert!((tempo_value_beats(1.0, 1) - 1.5).abs() < 1e-9);
        // Dotted half = 3.0 quarters.
        assert!((tempo_value_beats(2.0, 1) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn test_from_spq_seconds() {
        let map = TempoMap::from_spq(vec![1.0, 0.5]);
        // 4 quarters at 1.0 s/q = 4 s.
        assert!((map.seconds(0, 4.0) - 4.0).abs() < 1e-9);
        // 4 quarters at 0.5 s/q = 2 s.
        assert!((map.seconds(1, 4.0) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn test_seconds_clamps_out_of_range() {
        let map = TempoMap::from_spq(vec![1.0, 0.5]);
        // Out-of-range measure clamps to the last entry.
        assert!((map.seconds(99, 1.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn test_empty_map_returns_zero() {
        let map = TempoMap::from_spq(vec![]);
        assert_eq!(map.seconds(0, 4.0), 0.0);
        assert!(map.is_empty());
    }
}
