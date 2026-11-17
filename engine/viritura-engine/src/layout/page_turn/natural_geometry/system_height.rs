//! System heights for joint system/page planning.
//!
//! Engraved system height depends on the system's content: the tallest ink
//! above and below the staff block among its measures, and an inter-system gap
//! that shrinks as neighbouring protrusions grow. Deriving both from a
//! per-measure profile lets the planner evaluate every candidate system with
//! the same rules the measured packer applies, in a single deterministic pass.

use crate::layout::page::effective_system_gap;

/// Vertical extent of one visible measure.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct MeasureInk {
    /// Staff block height: every staff plus content-aware inter-staff space.
    pub(crate) core: f64,
    /// Ink above the top staff line wherever the measure falls in a system.
    pub(crate) above: f64,
    /// Ink below the bottom staff line wherever the measure falls in a system.
    pub(crate) below: f64,
    /// Ink above the staff when the measure opens a system, including
    /// system-start furniture (clef and key restatement, bar number).
    pub(crate) opening_above: f64,
    /// Ink below the staff when the measure opens a system.
    pub(crate) opening_below: f64,
}

impl MeasureInk {
    pub(crate) fn union(self, other: Self) -> Self {
        Self {
            core: self.core.max(other.core),
            above: self.above.max(other.above),
            below: self.below.max(other.below),
            opening_above: self.opening_above.max(other.opening_above),
            opening_below: self.opening_below.max(other.opening_below),
        }
    }

    /// Extent of this measure as the first of its system.
    fn opening(self) -> Self {
        Self {
            above: self.above.max(self.opening_above),
            below: self.below.max(self.opening_below),
            ..self
        }
    }

    pub(crate) fn height(self) -> f64 {
        self.core + self.above + self.below
    }
}

/// System heights and leading gaps derived from the measures each candidate
/// system contains. `ink` is indexed by visible-measure position.
pub(crate) struct SystemHeights<'a> {
    pub(crate) ink: &'a [MeasureInk],
    pub(crate) sp: f64,
}

impl SystemHeights<'_> {
    /// Fold the measure at `position` into a candidate system's running ink;
    /// `None` means the measure opens the system.
    pub(super) fn extend(&self, running: Option<MeasureInk>, position: usize) -> MeasureInk {
        let measure = self.ink.get(position).copied().unwrap_or_default();
        running.map_or_else(|| measure.opening(), |running| running.union(measure))
    }

    /// Gap above a system that follows `previous` on the same page.
    pub(super) fn gap(&self, previous: MeasureInk, current: MeasureInk) -> f64 {
        effective_system_gap(previous.below, current.above, self.sp)
    }

    /// Per-system heights and leading gaps for a concrete casting.
    pub(super) fn for_systems(&self, systems: &[Vec<usize>]) -> (Vec<f64>, Vec<f64>) {
        let extents: Vec<_> = systems
            .iter()
            .map(|system| {
                system
                    .iter()
                    .fold(None, |acc, &position| Some(self.extend(acc, position)))
                    .unwrap_or_default()
            })
            .collect();
        let heights = extents.iter().map(|extent| extent.height()).collect();
        let gaps = extents
            .iter()
            .enumerate()
            .map(|(index, &extent)| {
                index
                    .checked_sub(1)
                    .map_or(0.0, |previous| self.gap(extents[previous], extent))
            })
            .collect();
        (heights, gaps)
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_heights_follow_each_systems_tallest_measures() {
        let sp = 10.0;
        let measure = |above, below, opening_below| MeasureInk {
            core: 40.0,
            above,
            below,
            opening_above: 0.0,
            opening_below,
        };
        let ink = [
            measure(10.0, 5.0, 0.0),
            measure(30.0, 5.0, 20.0),
            measure(10.0, 50.0, 0.0),
        ];
        let model = SystemHeights { ink: &ink, sp };
        let (heights, gaps) = model.for_systems(&[vec![0, 1], vec![2]]);
        // A bar number opening measure 1 would not count mid-system.
        assert_eq!(heights, vec![75.0, 100.0]);
        // 7 sp default spacing less both protrusions, floored at 1 sp.
        assert_eq!(gaps, vec![0.0, 70.0 - 5.0 - 10.0]);
        let (heights, _) = model.for_systems(&[vec![0], vec![1, 2]]);
        assert_eq!(heights, vec![55.0, 120.0]);
    }
}
