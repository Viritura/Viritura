//! Measure-level layout cache for incremental re-layout.
//!
//! The cache keeps its public surface here while implementation modules own
//! content signatures, dirty-region policy, retained render segments, and the
//! cache stores that coordinate them.

use super::{config, slurs, spacing, ties, types};

mod dirty_regions;
mod segment_retention;
mod signatures;
mod storage;

pub use dirty_regions::{DirtyFlags, DirtyRegion, RangeScope, DEFAULT_RANGE_SCOPE_K};
pub(crate) use segment_retention::{
    DisplayListStoreMarker, PatchFrame, RetainedSegment, RetainedSlurData,
    RetainedStaffContentLayer, SystemPlacement,
};
pub(crate) use signatures::{boundary_state_fingerprint, measure_content_hash, BoundaryState};
pub use storage::LayoutCache;
pub(crate) use storage::{
    CachedMmrPlan, CachedResolvedStaff, CachedSystemExtras, CachedSystemLayout,
    CachedSystemSpacing, HorizonStaffExtent, RetainedMeasure,
};
