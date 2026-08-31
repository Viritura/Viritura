/// Per-pass enable toggles for the range-scoped front-half passes
/// (Phases A–D of `docs/plans/incremental-display-list.md`). All default to
/// `false`, which preserves today's full-rescan behavior identically. A scoped
/// pass is engaged only if its toggle is on AND a `pending_dirty_range` is set
/// AND the range survives the `|dirty| > K` guard.
#[derive(Debug, Clone, Copy, Default)]
pub struct RangeScope {
    /// Phase A: range-scoped `resolve_staves_with_condensing_labels`.
    pub scoped_resolve: bool,
    /// Phase B: range-scoped `plan_system_breaks` + MMR/rest-scores.
    pub scoped_breaks: bool,
    /// Phase C: skip `precompute_system_layouts` reuse-hashing outside span.
    pub scoped_precompute: bool,
    /// Phase D: scoped cross-system spanner sweep.
    pub scoped_slurs: bool,
}

/// Default `|dirty| > K` threshold for the range-scoped passes: if the patch's
/// dirty measure span exceeds this many measures, fall back to the full path.
/// Chosen conservatively — typical in-system edits stay well under this, while
/// a large reflow (meter change, structural edit) trips it and bails safely.
/// Tuned in Phase F.
pub const DEFAULT_RANGE_SCOPE_K: usize = 16;

/// Dependency classes carried with a [`DirtyRegion`]. The compact bitset keeps
/// patch plumbing allocation-free beyond the part/staff masks while allowing
/// later phases to distinguish local content edits from structural/global
/// invalidation.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DirtyFlags(u8);

impl DirtyFlags {
    pub const CONTENT: Self = Self(1 << 0);
    pub const HORIZONTAL: Self = Self(1 << 1);
    pub const VERTICAL: Self = Self(1 << 2);
    pub const SPANNER: Self = Self(1 << 3);
    pub const STRUCTURAL: Self = Self(1 << 4);
    pub const GLOBAL: Self = Self(1 << 5);

    pub const LOCAL_CONTENT: Self =
        Self(Self::CONTENT.0 | Self::HORIZONTAL.0 | Self::VERTICAL.0 | Self::SPANNER.0);

    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }
}

/// Two-dimensional invalidation island produced by a score patch.
///
/// `affected_parts` is indexed by model part. `affected_flat_staves` is filled
/// after the active MNX layout has been flattened; an empty part mask is the
/// conservative legacy/full-staff fallback used by range-only test callers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirtyRegion {
    pub measure_start: usize,
    pub measure_end: usize,
    pub affected_parts: Vec<bool>,
    pub affected_flat_staves: Vec<bool>,
    pub flags: DirtyFlags,
}

impl DirtyRegion {
    pub fn local_part_measures(
        measure_start: usize,
        measure_end: usize,
        affected_parts: Vec<bool>,
    ) -> Self {
        Self {
            measure_start,
            measure_end,
            affected_parts,
            affected_flat_staves: Vec::new(),
            flags: DirtyFlags::LOCAL_CONTENT,
        }
    }

    /// Conservative compatibility constructor for callers that only know the
    /// rhythmic range. An empty part mask intentionally expands to all staves.
    pub fn all_staves(measure_start: usize, measure_end: usize) -> Self {
        Self::local_part_measures(measure_start, measure_end, Vec::new())
    }

    pub fn time_signature_settings(measure_start: usize, measure_end: usize) -> Self {
        Self {
            measure_start,
            measure_end,
            affected_parts: Vec::new(),
            affected_flat_staves: Vec::new(),
            flags: DirtyFlags(
                DirtyFlags::HORIZONTAL.0 | DirtyFlags::VERTICAL.0 | DirtyFlags::GLOBAL.0,
            ),
        }
    }

    pub const fn measure_range(&self) -> (usize, usize) {
        (self.measure_start, self.measure_end)
    }

    pub fn affects_part(&self, part_index: usize) -> bool {
        self.affected_parts.is_empty()
            || self
                .affected_parts
                .get(part_index)
                .copied()
                .unwrap_or(false)
    }

    pub fn affects_flat_staff(&self, staff_index: usize) -> bool {
        self.affected_flat_staves.is_empty()
            || self
                .affected_flat_staves
                .get(staff_index)
                .copied()
                .unwrap_or(true)
    }
}
