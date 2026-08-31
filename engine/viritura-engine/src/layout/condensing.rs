//! Condensing merge analysis — determines how multiple source parts should
//! be rendered on a single condensed staff.
//!
//! The analysis runs per-measure (or per beam-break segment in future) and
//! returns a `MergeMode` that drives rendering: unison, amalgamate, or divisi.
//!
//! Reference: docs/plans/condensing-and-doubling.md §8

mod beam_compatibility;
mod conflicts;
mod labels;
mod unison;

pub(crate) use labels::*;
pub(crate) use unison::*;
