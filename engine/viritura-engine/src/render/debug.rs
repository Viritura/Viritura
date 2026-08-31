#![allow(unused_imports)]

use super::*;
use serde::{Deserialize, Serialize};

/// Describes which systems are assigned to a single page.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLayout {
    /// Page number (0-indexed).
    pub page_number: usize,
    /// Indices of systems placed on this page.
    pub system_indices: Vec<usize>,
    /// Y offset where this page starts (in the global coordinate space).
    pub y_offset: f64,
    /// Height of this page.
    pub height: f64,
}

// ═══════════════════════════════════════════════════════════════════════
// Layout debug sidecar
//
// Populated by the layout pipeline when `LayoutConfig.emit_layout_debug`
// is true. Captures the inputs and outputs of the vertical-spacing logic
// in a structured form so the editor can render a debug overlay.
// ═══════════════════════════════════════════════════════════════════════

/// Top-level vertical-spacing debug info, attached to the `DisplayList`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDebugInfo {
    /// One entry per system in the layout.
    pub systems: Vec<SystemDebug>,
    /// Pixels per spatium used by this layout (so the overlay can label in sp).
    pub sp: f64,
    /// Standard staff height (4 * sp), repeated here for convenience.
    pub staff_height: f64,
    /// Active spacing constants from `LayoutConfig`, in pixels. Surfaced so the
    /// horizontal overlay can compare per-gap widths against the configured
    /// minimum / shortest-duration / per-doubling increment.
    #[serde(default)]
    pub min_note_spacing: f64,
    #[serde(default)]
    pub shortest_duration_space: f64,
    #[serde(default)]
    pub spacing_increment: f64,
    /// Resolved placement metrics per dependent kind, in pixels (the spatium
    /// scale already applied). Keyed by the camelCase kind name (`dynamic`,
    /// `expression`, …). The overlay draws each dependent's collision box and
    /// padding halo around its ink bbox from these numbers, so the §0/§1
    /// keep-out field is visible separately from the selection bbox.
    #[serde(default)]
    pub placement: std::collections::HashMap<String, PlacementDebug>,
}

/// Resolved [`crate::layout::placement_metrics::PlacementMetrics`] for one
/// dependent kind, with all distances pre-multiplied to pixels for the overlay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementDebug {
    /// Minimum clearance from the element's own anchor edge (pixels). Scalar
    /// fallback; per-side overrides below.
    pub attach_gap: f64,
    /// Staff-reserve gap for an ABOVE-staff placement (pixels). Falls back to
    /// `attach_gap` when the kind has no per-side override.
    pub attach_gap_above: f64,
    /// Staff-reserve gap for a BELOW-staff placement (pixels). Falls back to
    /// `attach_gap` when the kind has no per-side override.
    pub attach_gap_below: f64,
    /// Gap kept above the previous stacked dependent (pixels).
    pub stack_gap: f64,
    /// Ordering within a stacked column; lower sits closer to the staff.
    pub stack_rank: i32,
    /// Horizontal clearance kept from neighbouring ink (pixels).
    pub side_bearing: f64,
}

/// Per-system debug info.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDebug {
    pub index: usize,
    /// Page index this system was placed on.
    pub page_index: usize,
    /// Top of the system bounding box (above-extras start here).
    pub bbox_top_y: f64,
    /// Top staff line Y for this system.
    pub staff_top_y: f64,
    /// Bottom staff line Y for the (top) staff in this system.
    pub staff_bottom_y: f64,
    /// Bottom of the system bounding box (after below-extras of the
    /// bottom staff).
    pub bbox_bottom_y: f64,
    /// Left edge X of the system content.
    pub x_start: f64,
    /// Right edge X of the system content.
    pub x_end: f64,

    /// Total above-extras (stem_extra + annotation_extra) in pixels.
    pub above_extra: f64,
    /// Breakdown of above_extra.
    pub above_breakdown: AboveBreakdown,
    /// Total below-extras for the bottom staff in pixels.
    pub below_extra: f64,
    /// Breakdown of below_extra.
    pub below_breakdown: BelowBreakdown,

    /// Per-measure protrusion extremes for the top staff
    /// (positive Y = below staff_y; negative Y = above staff_y).
    pub measure_extremes: Vec<MeasureExtreme>,

    /// Intra-system staff-pair gap reasoning. Empty for single-staff systems.
    pub staff_pairs: Vec<StaffPairDebug>,

    /// Per-measure horizontal spacing breakdown (natural vs. justified width,
    /// event onsets, gap sizes). Populated only on the single-staff path for now.
    #[serde(default)]
    pub measure_spacings: Vec<MeasureSpacing>,

    /// Inter-system gap to the next system (None for the last system on a page).
    pub inter_system_gap_to_next: Option<GapInfo>,
}

/// Breakdown of `compute_above_staff_extra` for a system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AboveBreakdown {
    /// Stem/note protrusion above staff_y minus standard 3.5sp stem allowance.
    pub stem_extra: f64,
    /// Annotation extra (max of tempo, rehearsal, jump contributions).
    pub annotation_extra: f64,
    pub has_tempo: bool,
    pub has_rehearsal: bool,
    pub has_jump: bool,
}

/// Breakdown of `compute_below_staff_extra_from_layouts` for a system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BelowBreakdown {
    /// Note/stem protrusion below staff bottom.
    pub protrusion: f64,
    /// Dynamics fixed-offset contribution (0 if no dynamics in system).
    pub dynamics: f64,
    /// Lyrics fixed-offset contribution.
    pub lyrics: f64,
    /// Pedals fixed-offset contribution.
    pub pedals: f64,
    pub has_dynamics: bool,
    pub has_lyrics: bool,
    pub has_pedals: bool,
}

/// Per-measure protrusion extremes from `lowest_point_in_measure` /
/// `highest_point_in_measure`. Y values are measured at staff_y = 0
/// in the system's coordinate space; the overlay shifts them to the
/// real staff_y when drawing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasureExtreme {
    pub measure_index: usize,
    pub x_start: f64,
    pub x_end: f64,
    /// Highest point in the measure (most negative = furthest above).
    pub highest_point: f64,
    /// Lowest point in the measure (most positive = furthest below).
    pub lowest_point: f64,
}

/// Per-measure horizontal spacing breakdown. Captures the natural
/// (un-justified) width vs. the actual rendered width, the per-event
/// onset X positions, and aggregate gap statistics. The painter uses
/// this to colour-code compression vs. stretch and to highlight gaps
/// that bottomed out at `min_note_spacing`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasureSpacing {
    pub measure_index: usize,
    /// Absolute X of the measure left edge (post-justification).
    pub x_start: f64,
    /// Absolute X of the measure right edge.
    pub x_end: f64,
    /// Width before system-wide justification scaled it.
    pub natural_width: f64,
    /// Width after justification (== x_end - x_start).
    pub justified_width: f64,
    /// justified_width / natural_width — 1.0 = no change, <1 = compressed,
    /// >1 = stretched.
    pub scale: f64,
    /// Sorted, deduplicated event onset Xs *within the measure body*
    /// (i.e. between the end of the prefix and `x_end`). The first
    /// onset is the start of musical content; pairs of adjacent onsets
    /// give per-gap widths.
    pub event_xs: Vec<f64>,
    /// Smallest gap between adjacent event onsets (sp == pixels).
    /// 0 if fewer than two events.
    pub min_gap: f64,
    /// Largest gap between adjacent event onsets.
    pub max_gap: f64,
}

/// Intra-system staff-pair gap reasoning (multi-staff systems only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StaffPairDebug {
    pub upper_staff_index: usize,
    /// Justified gap from `compute_system_y_positions`.
    pub justified_gap: f64,
    /// Content-aware gap = upper_lowest + lower_above_protrusion + min_clearance.
    pub content_gap: f64,
    /// Actual gap used (max of the two).
    pub actual_gap: f64,
    pub min_clearance: f64,
    /// Y of the upper staff's bottom line.
    pub upper_staff_bottom_y: f64,
    /// Y of the lower staff's top line.
    pub lower_staff_top_y: f64,
    /// Lowest content Y of the upper staff (absolute coordinates).
    pub upper_lowest_y: f64,
    /// Above-protrusion magnitude (positive sp) of the lower staff.
    pub lower_above_protrusion: f64,
}

/// Inter-system gap reasoning from `compute_system_y_positions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GapInfo {
    /// Default gap (7sp).
    pub default_gap: f64,
    /// Actual gap applied (may equal default_gap when justification skipped).
    pub actual_gap: f64,
    /// True when the page met the 65% fill threshold and the gap was justified.
    pub justified: bool,
}
