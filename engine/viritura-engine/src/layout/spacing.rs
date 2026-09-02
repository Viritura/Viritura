//! Proportional note spacing.
//!
//! Implements the engraving-standard duration-spring model as a multiplicative
//! power law anchored at a fixed quarter-note reference:
//!   width = quarter_space × (duration / quarter)^E,  0 < E < 1
//!
//! Anchoring at a fixed quarter (rather than the score's shortest note) keeps
//! spacing stable regardless of whether fast notes appear elsewhere in the
//! piece. The power law also guarantees that a busier measure is never narrower
//! than a sparser one of the same total duration. Each duration spring is then
//! floored by incompressible struts (minimum note spacing, accidental
//! clearance) so the springs may stretch or compress for justification without
//! ever colliding.

use crate::model::*;

mod accidental_ink;
mod accidental_visibility;
mod collectors;
mod duration_profile;
mod geometry_snapshot;
mod onset_spacing;
mod timing;

pub(crate) use accidental_ink::accidental_bbox_gap;
pub(crate) use collectors::*;
pub(crate) use duration_profile::*;
pub(crate) use onset_spacing::*;
pub(crate) use timing::BeatKey;
