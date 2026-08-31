//! Page breaking and multi-part helpers.

use super::config::{LayoutConfig, PageInset};
use super::text_styles::TextRole;
use crate::model::score::ScoreMetadata;
use crate::render::{DisplayList, RenderCommand, TextAlign, TextBaseline};
use std::collections::HashMap;

mod packing;
mod turn_sequence;

pub use packing::{
    compute_page_breaks, compute_page_breaks_with_extras, compute_page_breaks_with_forced,
};
pub(crate) use packing::{compute_page_breaks_preserving_membership, effective_system_gap};
pub use turn_sequence::{insert_blank_pages_before_systems, prepend_title_page};

// ═══════════════════════════════════════════
// Page breaking
// ═══════════════════════════════════════════

use crate::model::Part;
use crate::render::PageLayout;

// ─── Part display name utilities ─────────────────────────────────

/// Pitch names by pitch class (conventional enharmonic spelling).
const PITCH_NAMES: [&str; 12] = [
    "C",
    "D\u{266d}",
    "D",
    "E\u{266d}",
    "E",
    "F",
    "F\u{266f}",
    "G",
    "A\u{266d}",
    "A",
    "B\u{266d}",
    "B",
];

/// Convert transposition halfSteps to a key name (e.g., 2 → "B♭", 7 → "F").
/// Returns None for non-transposing or pure-octave transpositions.
pub(crate) fn transposition_key_name(half_steps: i32) -> Option<&'static str> {
    if half_steps.rem_euclid(12) == 0 {
        return None;
    }
    let pitch_class = ((-half_steps).rem_euclid(12)) as usize;
    Some(PITCH_NAMES[pitch_class])
}

/// Build the full display name for a part given auto-numbering context.
/// E.g., "Clarinet" + halfSteps=2 + number=1 → "Clarinet in B♭ 1"
/// If `base` already contains the transposition suffix as a separate word
/// (e.g. "Clarinet 1 in B♭"), the suffix is not appended again.
pub(crate) fn build_display_name(
    base: &str,
    half_steps: Option<i32>,
    number: Option<usize>,
) -> String {
    let mut parts = vec![base.to_string()];
    if let Some(hs) = half_steps {
        if let Some(key) = transposition_key_name(hs) {
            let suffix = format!("in {}", key);
            // Require a space before "in" (or it must start the string) so we don't
            // accidentally match "in" inside a word (e.g. "violin" would not match "in F").
            let spaced = format!(" {}", suffix);
            let already_present = base == suffix.as_str() || base.contains(spaced.as_str());
            if !already_present {
                parts.push(suffix);
            }
        }
    }
    if let Some(n) = number {
        parts.push(n.to_string());
    }
    parts.join(" ")
}

/// Augment a part-score header name with its transposition suffix.
///
/// The part-score header uses the authored score-definition name (e.g.
/// "Trumpet 1"), which omits the transposition that the full-score labels
/// carry. Given the parts shown in this part-score, append " in <key>"
/// (placed before any trailing number to match the "Trumpet in B♭ 1"
/// convention) when those parts share a single transposing interval and the
/// suffix isn't already present. The name is returned unchanged when the
/// shown parts don't transpose, disagree on transposition, or already spell
/// out the suffix.
pub(crate) fn augment_part_score_name(name: &str, parts: &[Part], shown: &[usize]) -> String {
    // Collect the distinct transposition keys among the shown parts.
    let mut key: Option<&'static str> = None;
    for &idx in shown {
        let Some(part) = parts.get(idx) else { continue };
        let hs = part.transposition.as_ref().map(|t| t.interval.half_steps);
        match hs.and_then(transposition_key_name) {
            // A non-transposing (or pure-octave) part among the shown set means
            // we can't attach a single unambiguous suffix.
            None => return name.to_string(),
            Some(k) => match key {
                None => key = Some(k),
                Some(existing) if existing == k => {}
                // Mixed transpositions — leave the authored name alone.
                Some(_) => return name.to_string(),
            },
        }
    }

    let Some(key) = key else {
        return name.to_string();
    };
    let suffix = format!("in {}", key);

    // Don't double-append if the suffix is already spelled out.
    let spaced = format!(" {}", suffix);
    if name == suffix || name.contains(spaced.as_str()) {
        return name.to_string();
    }

    // Insert before a trailing pure-number token ("Trumpet 1" → "Trumpet in B♭ 1");
    // otherwise append to the end.
    let tokens: Vec<&str> = name.split_whitespace().collect();
    if let Some((last, head)) = tokens.split_last() {
        if !head.is_empty() && last.chars().all(|c| c.is_ascii_digit()) {
            return format!("{} {} {}", head.join(" "), suffix, last);
        }
    }
    format!("{} {}", name, suffix)
}

/// Resolved display info for a part.
pub(crate) struct PartDisplayInfo {
    pub display_name: String,
    pub display_short_name: String,
    /// Name without the auto-number suffix (e.g. "Flute" instead of "Flute 1").
    pub base_name: String,
    /// Short name without the auto-number suffix.
    pub base_short_name: String,
    /// Auto-assigned number within the instrument group (None if only one of its kind).
    pub number: Option<usize>,
}

/// Resolve display names for all parts with auto-transposition and auto-numbering.
/// Groups parts by (name, transposition_key) and numbers duplicates within each group.
pub(crate) fn resolve_part_display_names(parts: &[Part]) -> Vec<PartDisplayInfo> {
    // Group key = (name, transposition key or "")
    let group_key = |p: &Part| -> (String, String) {
        let hs = p.transposition.as_ref().map(|t| t.interval.half_steps);
        let key = hs.and_then(transposition_key_name).unwrap_or("");
        (p.name.clone(), key.to_string())
    };

    // Count occurrences per group
    let mut counts: HashMap<(String, String), usize> = HashMap::new();
    for p in parts {
        *counts.entry(group_key(p)).or_insert(0) += 1;
    }

    // Assign numbers
    let mut indices: HashMap<(String, String), usize> = HashMap::new();
    parts
        .iter()
        .map(|p| {
            let key = group_key(p);
            let hs = p.transposition.as_ref().map(|t| t.interval.half_steps);
            let total = counts.get(&key).copied().unwrap_or(1);
            let number = if total > 1 {
                let idx = indices.entry(key).or_insert(0);
                *idx += 1;
                Some(*idx)
            } else {
                None
            };
            let base_name_str = build_display_name(&p.name, hs, None);
            let short_base = p
                .short_name
                .clone()
                .unwrap_or_else(|| abbreviate_part_name(&p.name));
            let base_short_name_str = build_display_name(&short_base, hs, None);
            let display_name = build_display_name(&p.name, hs, number);
            let display_short_name = build_display_name(&short_base, hs, number);
            PartDisplayInfo {
                display_name,
                display_short_name,
                base_name: base_name_str,
                base_short_name: base_short_name_str,
                number,
            }
        })
        .collect()
}

/// Generate an abbreviated part name from a full name.
pub(crate) fn abbreviate_part_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let first_word = trimmed.split_whitespace().next().unwrap_or("");
    let abbrev = match first_word {
        "Violin" => "Vln.",
        "Viola" => "Vla.",
        "Cello" | "Violoncello" => "Vc.",
        "Bass" | "Contrabass" => "Cb.",
        "Flute" => "Fl.",
        "Oboe" => "Ob.",
        "Clarinet" => "Cl.",
        "Bassoon" => "Bsn.",
        "Horn" => "Hn.",
        "Trumpet" => "Tpt.",
        "Trombone" => "Tbn.",
        "Tuba" => "Tba.",
        "Piano" => "Pno.",
        "Timpani" => "Timp.",
        "Percussion" => "Perc.",
        "Harp" => "Hp.",
        "Guitar" => "Gtr.",
        word => {
            let end = word.char_indices().nth(3).map_or(word.len(), |(i, _)| i);
            return format!("{}.", &word[..end]);
        }
    };
    let rest: Vec<&str> = trimmed.split_whitespace().skip(1).collect();
    if rest.is_empty() {
        abbrev.to_string()
    } else {
        format!("{} {}", abbrev, rest.join(" "))
    }
}

/// Compute absolute Y positions for each system, accounting for page breaks.
///
/// Three behaviors based on per-page fill:
///
/// 1. **Spread** (page < usable, ≥ 65% full): leftover space is distributed
///    across both inter-system and intra-staff gaps (1.5x : 1.0x weight).
///    When a single system fills the page (n_inter == 0) all leftover flows
///    into intra-staff gaps — the orchestral case.
/// 2. **Squish** (page > usable): intra-staff gaps are reduced (content-aware
///    clearance proportionally toward `min_intra_staff_clearance`) so an
///    over-full system fits on one page. The configured page height is a hard
///    boundary: gaps are squished as far as needed — past the legibility floor
///    when required — to keep the bottom staff within the bottom margin. Only
///    when even zero gaps overflow (staff bodies alone exceed the page) is
///    residual overflow accepted, since staves are never rescaled.
/// 3. **No-op** (page < 65% full): default gaps everywhere; no spread to
///    avoid comically large holes on sparse pages.
///
/// Returns `(positions, intra_staff_gap_per_system, intra_clearance_per_system)`.
/// The gap is the floor for the caller's content-aware Phase-2 placement;
/// the clearance is the value that should replace the previously-hardcoded
/// `2.0 * sp` content-aware floor between adjacent staves' content.
///
/// standard engraving practice (default 0.7). We use 0.65 for a slightly
/// looser threshold that still prevents comically large gaps.
///
/// `staves_per_system[i]` = number of staves in system `i`.
/// `staff_height` = height of one staff (4 * sp).
/// `system_content_heights[i]` = actual content height of system `i` (staff + protrusions).
///   When `None`, falls back to computing from `staves_per_system` and `staff_height`.
/// `protrusion_extras[i]` = (above_extra, below_extra) for system `i`. When `Some`, the
///   inter-system gap is sized so the **white space between staff lines** (i.e. bottom
///   staff of system i to top staff of system i+1) is uniform across the page. Per-system
///   above/below extras are allowed to absorb into the default inter-system gap rather
///   than adding to it; only when extras exceed the default does the gap stretch (and
///   even then, only enough to keep `min_skyline_clearance` between adjacent skylines).
///   This prevents systems with hanging dynamics or tall rehearsal marks from creating
///   uneven inter-system whitespace. The page's first-system above-extra and last-system
///   below-extra still drive a small `pad_top` adjustment for top/bottom balance.
/// `spread_partners[page_pos]` = the page position of this page's facing page in
///   its 2-page spread (or `None` when it stands alone, or `None` for the whole
///   slice to disable per-spread frame insets — the legacy behaviour). See
///   [`spread_partners`] and `docs/plans/page-margin-bands.md`.
pub fn compute_system_y_positions(
    staves_per_system: &[usize],
    staff_height: f64,
    pages: &[PageLayout],
    config: &LayoutConfig,
    title_height_px: f64,
    system_content_heights: Option<&[f64]>,
    protrusion_extras: Option<&[(f64, f64)]>,
    spread_partners: Option<&[Option<usize>]>,
) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    compute_system_y_positions_with_ragged_pages(
        staves_per_system,
        staff_height,
        pages,
        config,
        title_height_px,
        system_content_heights,
        protrusion_extras,
        spread_partners,
        None,
    )
}

/// Automatic-part variant of [`compute_system_y_positions`].
///
/// `ragged_pages` contains page positions intentionally left at natural
/// vertical spacing for a materially better physical turn. Authored and
/// full-score pagination use the wrapper above and preserve their behavior.
#[allow(clippy::too_many_arguments)] // mirrors the established positioner plus one page policy
pub fn compute_system_y_positions_with_ragged_pages(
    staves_per_system: &[usize],
    staff_height: f64,
    pages: &[PageLayout],
    config: &LayoutConfig,
    title_height_px: f64,
    system_content_heights: Option<&[f64]>,
    protrusion_extras: Option<&[(f64, f64)]>,
    spread_partners: Option<&[Option<usize>]>,
    ragged_pages: Option<&[usize]>,
) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let sp = config.sp;
    let margin_top = config.page_margin_top * sp;
    let margin_bottom = config.page_margin_bottom * sp;
    let default_inter_staff = 7.0 * sp;
    let default_clearance = config.default_intra_staff_clearance * sp;
    let min_squish_clearance = config.min_intra_staff_clearance * sp;
    // Minimum visible whitespace required between a system's lower skyline
    // (bbox bottom) and the next system's upper skyline (bbox top). Above/
    // below extras may absorb into the inter-system gap, but never close
    // enough to touch — this floor keeps `ff` dynamics, `sf` rehearsal marks,
    // etc. from kissing the neighbour's bracket.
    let min_skyline_clearance = 1.0 * sp;

    let n_systems = staves_per_system.len();
    let mut positions = vec![0.0; n_systems];
    let mut gaps = vec![default_inter_staff; n_systems];
    let mut clearances = vec![default_clearance; n_systems];

    // Weights for distributing leftover page space between inter-system gaps
    // and intra-staff gaps. Inter-system gaps grow faster so systems remain
    // visually distinct from one another. When a page contains a single
    // system (n_gaps == 0) all leftover space flows into intra-staff gaps,
    // which fixes large orchestral scores wasting half the page.
    const INTER_WEIGHT: f64 = 1.5;
    const INTRA_WEIGHT: f64 = 1.0;

    // The last (or only) page is left ragged when its natural content fills
    // less than this fraction of the usable height — stretching a nearly-empty
    // final page into the bottom margin looks worse than a ragged tail. A
    // last page that is already this full still justifies so its bottom aligns
    // with the margin. Non-last pages always justify regardless of fill.
    const LAST_PAGE_JUSTIFY_THRESHOLD: f64 = 0.65;

    // Per-system (above_extra, below_extra). Used to make the *white space*
    // between adjacent systems' staff lines visually uniform (rather than the
    // skyline-to-skyline distance). When one system has e.g. an `ff` dynamic
    // hanging 4.5sp below its staff, that extra is allowed to absorb into the
    // default inter-system gap as long as `min_skyline_clearance` is preserved
    // — it does NOT add 4.5sp on top of the default gap.
    let extras_for = |sys_idx: usize| -> (f64, f64) {
        protrusion_extras
            .and_then(|e| e.get(sys_idx).copied())
            .unwrap_or((0.0, 0.0))
    };

    // Above-extent of a page's FIRST system / below-extent of its LAST system —
    // the protrusions that, under the `margin / inset / frame` band model
    // (`docs/plans/page-margin-bands.md`), determine where that page's first and
    // last staff *lines* sit relative to the page edge. `Auto` insets fit the
    // frame to these per spread; `Manual` overrides them with a fixed reserve.
    let page_above_first = |pg: &PageLayout| -> f64 {
        pg.system_indices
            .first()
            .map(|&s| extras_for(s).0)
            .unwrap_or(0.0)
    };
    let page_below_last = |pg: &PageLayout| -> f64 {
        pg.system_indices
            .last()
            .map(|&s| extras_for(s).1)
            .unwrap_or(0.0)
    };

    for (page_idx, page) in pages.iter().enumerate() {
        // Standard engraving convention: every page is vertically justified to
        // fill the page EXCEPT the last page of the document, which is left
        // top-aligned (ragged bottom). A single-page document is therefore
        // ragged. `is_last_page` gates the SPREAD branch below.
        let is_last_page = page_idx + 1 == pages.len();
        let intentionally_ragged = ragged_pages.is_some_and(|indices| indices.contains(&page_idx));
        let extra = if page.page_number == 0 {
            title_height_px
        } else {
            0.0
        };
        let systems = &page.system_indices;
        // The page box height is always the configured page height (a hard
        // boundary — the packer never grows it). The usable band is what
        // remains after the top/bottom margins and any title block; content
        // is force-squished to fit within it.
        let usable_full = page.height - margin_top - margin_bottom - extra;

        // Frame model (`docs/plans/page-margin-bands.md`): resolve the top/bottom
        // `inset` for this page, then derive the frame pads that pull the first
        // staff line down to `frame_top` and reserve space so the last staff
        // line lands at `frame_bottom`.
        //
        // * `Auto` + a spread partner → inset = max protrusion across the two
        //   facing pages, so their first/last staff lines align. `Auto` with no
        //   partner → inset = the page's own extent, i.e. `pad == 0` and the
        //   layout is byte-identical to the pre-band behaviour (legacy ragged
        //   self-balance below still applies).
        // * `Manual(v)` → a fixed reserve `v` on every page (no spread needed;
        //   a uniform reserve aligns spreads inherently).
        let own_above = page_above_first(page);
        let own_below = page_below_last(page);
        let partner_pos = spread_partners
            .and_then(|sp| sp.get(page_idx).copied().flatten())
            .filter(|&p| p < pages.len());
        let inset_top = match config.page_inset_top {
            PageInset::Manual(v) => v * sp,
            PageInset::Auto => match partner_pos {
                Some(p) => own_above.max(page_above_first(&pages[p])),
                None => own_above,
            },
        };
        let inset_bottom = match config.page_inset_bottom {
            PageInset::Manual(v) => v * sp,
            PageInset::Auto => match partner_pos {
                Some(p) => own_below.max(page_below_last(&pages[p])),
                None => own_below,
            },
        };
        let frame_pad_top = (inset_top - own_above).max(0.0);
        let frame_pad_bottom = (inset_bottom - own_below).max(0.0);
        // The frame model OWNS the top/bottom anchoring only when it actually
        // adjusts something: a manual inset (global) or a spread partner. Pure
        // auto-standalone keeps the legacy path so single-page-per-spread output
        // is unchanged.
        let frame_active = matches!(config.page_inset_top, PageInset::Manual(_))
            || matches!(config.page_inset_bottom, PageInset::Manual(_))
            || partner_pos.is_some();
        let usable = usable_full - frame_pad_top - frame_pad_bottom;

        let n_inter = systems.len().saturating_sub(1);
        let total_intra_gap_count: usize = systems
            .iter()
            .map(|&i| staves_per_system[i].saturating_sub(1))
            .sum();

        // Base bbox height per system (using actual content heights when
        // available). This INCLUDES above/below extras and intra-staff space
        // at default gap; squish/spread later add an `intra_extra` delta.
        let base_bboxes: Vec<f64> = systems
            .iter()
            .map(|&i| {
                system_content_heights
                    .and_then(|h| h.get(i).copied())
                    .unwrap_or_else(|| {
                        let n = staves_per_system[i] as f64;
                        n * staff_height + (n - 1.0).max(0.0) * default_inter_staff
                    })
            })
            .collect();
        let sum_bbox_base: f64 = base_bboxes.iter().sum();

        // Per-gap absorbed extras: between system i and i+1, the lower extra
        // of i and the upper extra of i+1 sit in the gap region. If
        // (below_i + above_{i+1}) ≤ default_inter_staff - min_skyline_clearance,
        // the extras fit inside the default gap and no inflation is needed.
        // Otherwise the gap stretches just enough to satisfy clearance.
        let per_gap_w_min_max: f64 = (0..n_inter)
            .map(|j| {
                let (_, below_i) = extras_for(systems[j]);
                let (above_next, _) = extras_for(systems[j + 1]);
                (below_i + above_next + min_skyline_clearance).max(default_inter_staff)
            })
            .fold(0.0f64, f64::max);

        // Uniform per-gap white space `W` (staff_bottom_i → staff_top_{i+1}).
        // Floor = max(default, binding per-gap requirement).
        let w_floor = default_inter_staff.max(per_gap_w_min_max);

        // Page height required at a given uniform white space `w`, honoring
        // Page height required at a given uniform white space `w`, honoring
        // the per-gap `min_skyline_clearance` floor (so the analytic form
        // stays correct even when some gaps would otherwise clamp).
        let natural_at = |w: f64| -> f64 {
            sum_bbox_base
                + (0..n_inter)
                    .map(|j| {
                        let (_, below_i) = extras_for(systems[j]);
                        let (above_next, _) = extras_for(systems[j + 1]);
                        (w - below_i - above_next).max(min_skyline_clearance)
                    })
                    .sum::<f64>()
        };

        // Preferred basis is `w_floor`, which keeps inter-staff white space
        // visually uniform. But `w_floor` is driven by the single tightest
        // pair's protrusions; honoring it can overflow the page. When it does
        // AND there are no intra-staff gaps to squish (e.g. single-staff
        // parts), fall back to `default_inter_staff` — the basis the page
        // packer used to decide how many systems fit, so it is guaranteed to
        // fit. The leftover is then redistributed by the SPREAD branch below.
        let natural_floor = natural_at(w_floor);
        let (w_basis, natural_height) = if natural_floor > usable && total_intra_gap_count == 0 {
            (default_inter_staff, natural_at(default_inter_staff))
        } else {
            (w_floor, natural_floor)
        };

        // Determine per-page intra-staff gap delta (positive = spread, negative = squish)
        // and inter-system gap delta (added on top of w_basis), plus whether the
        // page is vertically justified (fills the page) or left ragged.
        let (intra_extra, inter_extra, justified) =
            if natural_height > usable && total_intra_gap_count > 0 {
                // SQUISH: the page would overflow even at default gaps. The
                // configured page height is a HARD boundary, so we reduce the
                // intra-staff gaps as far as needed to pull the bottom staff
                // back to the bottom margin — past the `min_squish_gap`
                // legibility floor when we must. Each gap is floored at 0
                // (staves may touch but never cross); if even zero-gap spacing
                // still overflows (the staff bodies alone exceed the page) the
                // residual overflow is accepted, since we never rescale staves.
                let needed = natural_height - usable;
                let intra_squish_per =
                    (-needed / total_intra_gap_count as f64).max(-default_inter_staff);
                (intra_squish_per, 0.0, true)
            } else if (!is_last_page && !intentionally_ragged)
                || (is_last_page && natural_height >= LAST_PAGE_JUSTIFY_THRESHOLD * usable)
            {
                // JUSTIFY (spread): distribute all leftover between inter- and
                // intra-staff gaps so the page bottom is flush with the bottom
                // margin. Always applies to non-last pages; applies to the last/
                // only page only when it is already reasonably full. No growth
                // cap — a justified page is filled completely (standard vertical
                // justification).
                let leftover = (usable - natural_height).max(0.0);
                let total_weight =
                    n_inter as f64 * INTER_WEIGHT + total_intra_gap_count as f64 * INTRA_WEIGHT;
                if total_weight > 0.0 {
                    let extra_per_unit = leftover / total_weight;
                    (
                        extra_per_unit * INTRA_WEIGHT,
                        extra_per_unit * INTER_WEIGHT,
                        true,
                    )
                } else {
                    // Single system, nothing to spread into — leave ragged so
                    // `pad_top` can balance protrusion asymmetry below.
                    (0.0, 0.0, false)
                }
            } else {
                // Under-full last/only page: ragged bottom (top-aligned, default
                // gaps). Leftover pools below the final system.
                (0.0, 0.0, false)
            };

        // The per-staff gap follows the squish exactly so downstream
        // content-aware (Phase-2) placement doesn't re-expand past the bottom
        // margin. Floored at 0 — staves may touch but never cross.
        let intra_staff_gap = (default_inter_staff + intra_extra).max(0.0);

        // Squish content-aware clearance proportionally with the intra-staff
        // gap when squishing. When spreading or at default, keep the full
        // default clearance — there's no reason to relax clearance just
        // because the page has room to grow.
        let intra_clearance = if intra_extra < 0.0 && default_inter_staff > 0.0 {
            let ratio = (intra_staff_gap / default_inter_staff).clamp(0.0, 1.0);
            (default_clearance * ratio).max(min_squish_clearance)
        } else {
            default_clearance
        };

        // Position systems top-to-bottom using their actual content heights,
        // adjusted by the per-page intra-staff delta so each system shrinks
        // or grows to absorb its share of the squish/spread.
        //
        // Each inter-system gap is built ADDITIVELY: a per-gap natural skyline
        // (`w_basis` of staff-to-staff white space minus the two adjacent
        // protrusions, floored at `min_skyline_clearance`) plus a uniform
        // `inter_extra` justification delta. Building additively — rather than
        // clamping `(w_basis + inter_extra - below - above)` as a whole — is
        // essential: when two adjacent systems protrude far enough that their
        // natural skyline is already at the `min_skyline_clearance` floor, a
        // combined clamp would SWALLOW that gap's share of `inter_extra`,
        // leaving the page under-filled (a visible band of wasted space at the
        // bottom). Adding `inter_extra` on top of the floored natural skyline
        // guarantees every gap grows by its full share, so a justified page
        // fills exactly to the bottom margin even when protrusions are large.
        //
        // For ragged (un-justified) pages we keep the music top-aligned: any
        // leftover page space pools at the bottom, matching the traditional
        // engraving convention. On those pages only we apply a small `pad_top`
        // to correct *protrusion asymmetry* (above-staff extras like tempo
        // marks and ledger lines vs below-staff extras like dynamics and
        // lyrics) so the visible whitespace above the first staff line and
        // below the last staff line look balanced when extras differ. On a
        // justified page the spread already fills the page, so `pad_top` is
        // suppressed (otherwise it would push content past the bottom margin).
        //
        // Vertical centering of under-filled content is handled separately
        // by `fit_unpaged_bounds` in the unpaged (horizon/galley) path.
        // pad_top is clamped to >= 0 — we never compress the configured
        // top margin.
        let sys_heights_px: Vec<f64> = systems
            .iter()
            .zip(base_bboxes.iter())
            .map(|(&sys_idx, &base_h)| {
                let intra_count = staves_per_system[sys_idx].saturating_sub(1) as f64;
                base_h + intra_count * intra_extra
            })
            .collect();
        let protrusion_diff = if let (Some(extras), Some(&first), Some(&last)) =
            (protrusion_extras, systems.first(), systems.last())
        {
            let above_first = extras.get(first).map_or(0.0, |e| e.0);
            let below_last = extras.get(last).map_or(0.0, |e| e.1);
            below_last - above_first
        } else {
            0.0
        };
        // When the frame model is active (manual inset or a spread partner) it
        // owns the top anchor: push the first bbox top down by `frame_pad_top`
        // so the first staff line lands at `frame_top`. `frame_pad_bottom` was
        // already removed from `usable`, so the last staff line lands at
        // `frame_bottom`. Otherwise (pure auto-standalone) fall back to the
        // legacy ragged self-balance so single-page output is unchanged.
        let pad_top = if frame_active {
            frame_pad_top
        } else if justified {
            0.0
        } else {
            (protrusion_diff * 0.5).max(0.0)
        };

        let mut y = page.y_offset + margin_top + extra + pad_top;
        for (page_local_idx, (&sys_idx, &sys_h)) in
            systems.iter().zip(sys_heights_px.iter()).enumerate()
        {
            positions[sys_idx] = y;
            gaps[sys_idx] = intra_staff_gap;
            clearances[sys_idx] = intra_clearance;
            y += sys_h;
            if page_local_idx < systems.len() - 1 {
                // Natural skyline at `w_basis` (floored), plus the justification
                // delta `inter_extra` added on top so the share is never lost
                // to the floor. See the block comment above.
                let (_, below_i) = extras_for(sys_idx);
                let next_sys = systems[page_local_idx + 1];
                let (above_next, _) = extras_for(next_sys);
                let skyline_gap =
                    (w_basis - below_i - above_next).max(min_skyline_clearance) + inter_extra;
                y += skyline_gap;
            }
        }
    }

    (positions, gaps, clearances)
}

/// Build per-page spread-partner indices for the `margin / inset / frame` band
/// model (`docs/plans/page-margin-bands.md`). Page positions pair into facing
/// spreads: with `first_page_recto`, spreads are `(0 alone), (1,2), (3,4)…`;
/// otherwise `(0,1), (2,3)…`. Returns, per page position, the position of its
/// facing page, or `None` when the page stands alone in its spread (a lone
/// recto, or a trailing odd page).
pub fn spread_partners(n_pages: usize, first_page_recto: bool) -> Vec<Option<usize>> {
    let mut out = vec![None; n_pages];
    let mut i = if first_page_recto { 1 } else { 0 };
    while i + 1 < n_pages {
        out[i] = Some(i + 1);
        out[i + 1] = Some(i);
        i += 2;
    }
    out
}

// ═══════════════════════════════════════════
// Title block rendering
// ═══════════════════════════════════════════

/// Spacing between title elements (in spatium).
const TITLE_GAP_SP: f64 = 0.5;

/// Compute the height (in pixels) of the title block for the given metadata.
/// Returns 0.0 if no metadata is present.
pub fn title_block_height(metadata: Option<&ScoreMetadata>, config: &LayoutConfig) -> f64 {
    let meta = match metadata {
        Some(m)
            if m.title.is_some()
                || m.composer.is_some()
                || m.subtitle.is_some()
                || m.lyricist.is_some()
                || m.arranger.is_some() =>
        {
            m
        }
        _ => return 0.0,
    };
    let sp = config.sp;
    let styles = &config.text_styles;
    let mut h: f64 = 0.0;

    if meta.title.is_some() {
        h += styles.resolve(TextRole::Title).size_px(sp); // title text height
        h += TITLE_GAP_SP * sp; // gap below title
    }
    if meta.subtitle.is_some() {
        h += styles.resolve(TextRole::Subtitle).size_px(sp);
        h += TITLE_GAP_SP * sp;
    }
    // Composer/arranger occupy a right-hand column stacked from the top margin
    // (composer first, arranger beneath). The lyricist occupies a single line
    // in the mirror-image left-hand column. Reserve the tallest of the centered
    // title/subtitle stack, the right-hand credit column, and the left-hand
    // lyricist line.
    let mut right_h: f64 = 0.0;
    if meta.composer.is_some() {
        right_h += styles.resolve(TextRole::Composer).size_px(sp);
        right_h += TITLE_GAP_SP * sp;
    }
    if meta.arranger.is_some() {
        right_h += styles.resolve(TextRole::Arranger).size_px(sp);
        right_h += TITLE_GAP_SP * sp;
    }
    h = h.max(right_h);
    let mut left_h: f64 = 0.0;
    if meta.lyricist.is_some() {
        left_h += styles.resolve(TextRole::Lyricist).size_px(sp);
        left_h += TITLE_GAP_SP * sp;
    }
    h = h.max(left_h);
    // Final gap before first system
    h += 2.0 * sp;
    h
}

/// Emit a page number at the top of each page (except page 1).
///
/// Convention (standard practice: page numbers alternate between
/// top-left (even pages) and top-right (odd pages). Page 1 is omitted.
pub fn render_page_numbers(
    dl: &mut DisplayList,
    pages: &[PageLayout],
    config: &LayoutConfig,
    page_width: f64,
) {
    render_page_numbers_excluding(dl, pages, config, page_width, &[]);
}

/// Render folios while preserving the physical numbering of omitted leaves.
///
/// Automatic part pagination uses this to keep inserted parity leaves visually
/// blank. Authored pagination continues through [`render_page_numbers`].
pub(crate) fn render_page_numbers_excluding(
    dl: &mut DisplayList,
    pages: &[PageLayout],
    config: &LayoutConfig,
    page_width: f64,
    excluded_page_numbers: &[usize],
) {
    let sp = config.sp;
    let style = config.text_styles.resolve(TextRole::PageNumber);
    let font_size = style.size_px(sp);
    let font = style.font_string();
    let color = style.color.clone();
    let margin_left_px = config.page_margin_left * sp;
    let margin_right_px = config.page_margin_right * sp;

    for page in pages {
        if excluded_page_numbers.contains(&page.page_number) {
            continue;
        }
        let page_num = page.page_number + 1; // 0-indexed → 1-indexed
        if page_num <= 1 {
            continue;
        } // Skip page 1

        // Seat the folio just inside the top margin, a 1sp gap above the margin
        // border (the inner edge of the top margin, where the content frame
        // begins). With a Bottom baseline, the number's baseline sits that 1sp
        // clear of the border so it never touches music ink that runs right up
        // to the frame edge inside the inset band.
        let y = page.y_offset + config.page_margin_top * sp - 1.0 * sp;
        let (x, align) = if page_num % 2 == 0 {
            // Even pages: top-left
            (margin_left_px, TextAlign::Left)
        } else {
            // Odd pages: top-right
            (page_width - margin_right_px, TextAlign::Right)
        };

        dl.push(RenderCommand::DrawText {
            x,
            y,
            text: page_num.to_string(),
            font: font.clone(),
            size: font_size,
            color: color.clone(),
            align,
            baseline: TextBaseline::Bottom,
        });
    }
}

/// Emit the score definition name (instrument/part name) in the top-left
/// of page 1 for part scores.
///
/// Standard engraving practice: a part's first page shows the instrument name
/// as a small, left-aligned label just below the top margin, framed in a thin
/// box so the player can identify the part at a glance.
pub fn render_part_score_name(
    dl: &mut DisplayList,
    title: &str,
    config: &LayoutConfig,
    _page_width: f64,
) {
    let sp = config.sp;
    let style = config.text_styles.resolve(TextRole::StaffLabel);
    let font_size = style.size_px(sp);
    let margin_left_px = config.page_margin_left * sp;
    // Sit the label just below the top-margin line (not up in the margin).
    let top_margin_px = config.page_margin_top * sp;

    // Estimate the text box from the glyph metrics: use the per-character AFM
    // advance widths (same metric the canvas font uses) so the frame hugs the
    // text instead of running well past its right edge. Pad horizontally and
    // vertically so the frame clears the glyphs.
    let pad_x = 0.6 * sp;
    let pad_y = 0.4 * sp;
    let text_w = crate::layout::text_styles::text_width(title, font_size, style.family, style.bold);
    let box_left = margin_left_px;
    let box_top = top_margin_px;
    let box_h = font_size + 2.0 * pad_y;
    let box_w = text_w + 2.0 * pad_x;
    let baseline_y = box_top + pad_y + font_size * 0.78; // cap-height baseline

    dl.push(RenderCommand::DrawText {
        x: box_left + pad_x,
        y: baseline_y,
        text: title.to_string(),
        font: style.font_string(),
        size: font_size,
        color: style.color.clone(),
        align: TextAlign::Left,
        baseline: TextBaseline::Alphabetic,
    });

    // Thin frame (four strokes) around the label.
    let stroke = 0.1 * sp;
    let color = style.color.clone();
    let (l, t, r, b) = (box_left, box_top, box_left + box_w, box_top + box_h);
    for (x1, y1, x2, y2) in [
        (l, t, r, t), // top
        (l, b, r, b), // bottom
        (l, t, l, b), // left
        (r, t, r, b), // right
    ] {
        dl.push(RenderCommand::DrawLine {
            x1,
            y1,
            x2,
            y2,
            width: stroke,
            color: color.clone(),
        });
    }
}

/// Emit DrawText render commands for the title block.
/// `y_start` is the top of the title area (page top margin).
/// `page_width` is the full page width in pixels.
/// Returns the list of commands.
pub fn render_title_block(
    metadata: Option<&ScoreMetadata>,
    config: &LayoutConfig,
    y_start: f64,
    page_width: f64,
) -> Vec<RenderCommand> {
    let meta = match metadata {
        Some(m)
            if m.title.is_some()
                || m.composer.is_some()
                || m.subtitle.is_some()
                || m.lyricist.is_some()
                || m.arranger.is_some() =>
        {
            m
        }
        _ => return Vec::new(),
    };
    let sp = config.sp;
    let center_x = page_width / 2.0;
    let margin_left_px = config.page_margin_left * sp;
    let margin_right_px = config.page_margin_right * sp;
    let mut commands = Vec::new();
    let mut y = y_start;

    // Title (centered, large font)
    if let Some(title) = &meta.title {
        let style = config.text_styles.resolve(TextRole::Title);
        let size = style.size_px(sp);
        y += size;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y,
            text: title.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: style.align.into(),
            baseline: TextBaseline::Alphabetic,
        });
        y += TITLE_GAP_SP * sp;
    }

    // Subtitle (centered, medium font)
    if let Some(subtitle) = &meta.subtitle {
        let style = config.text_styles.resolve(TextRole::Subtitle);
        let size = style.size_px(sp);
        y += size;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y,
            text: subtitle.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: style.align.into(),
            baseline: TextBaseline::Alphabetic,
        });
    }

    // Composer (top of the right-hand column, aligned to the top margin) with
    // the arranger stacked directly beneath it. Both are right-aligned to the
    // right margin. Standard engraving practice: the composer credit sits at
    // the top-right corner level with the top margin, and any
    // arranger/orchestrator credit follows on the next line, also right-aligned.
    let right_x = page_width - margin_right_px;
    let mut y_right = y_start;
    if let Some(composer) = &meta.composer {
        let style = config.text_styles.resolve(TextRole::Composer);
        let size = style.size_px(sp);
        y_right += size;
        commands.push(RenderCommand::DrawText {
            x: right_x,
            y: y_right,
            text: composer.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Right,
            baseline: TextBaseline::Alphabetic,
        });
        y_right += TITLE_GAP_SP * sp;
    }
    if let Some(arranger) = &meta.arranger {
        let style = config.text_styles.resolve(TextRole::Arranger);
        let size = style.size_px(sp);
        y_right += size;
        commands.push(RenderCommand::DrawText {
            x: right_x,
            y: y_right,
            text: arranger.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Right,
            baseline: TextBaseline::Alphabetic,
        });
    }

    // Lyricist (top-left corner, left-aligned to the left margin), mirroring
    // the composer on the right. Standard engraving practice for songs: the
    // lyricist/librettist credit sits opposite the composer credit.
    let left_x = margin_left_px;
    let mut y_left = y_start;
    if let Some(lyricist) = &meta.lyricist {
        let style = config.text_styles.resolve(TextRole::Lyricist);
        let size = style.size_px(sp);
        y_left += size;
        commands.push(RenderCommand::DrawText {
            x: left_x,
            y: y_left,
            text: lyricist.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
        });
    }

    commands
}

/// `true` when the metadata carries at least one printable credit.
fn metadata_has_credits(metadata: Option<&ScoreMetadata>) -> bool {
    matches!(
        metadata,
        Some(m)
            if m.title.is_some()
                || m.composer.is_some()
                || m.subtitle.is_some()
                || m.lyricist.is_some()
                || m.arranger.is_some()
    )
}

/// Render a full-page, vertically-spread title layout for a DEDICATED title
/// page (a cover page that precedes the first music page).
///
/// Unlike [`render_title_block`] — which packs the credits into a compact band
/// at the top of the first music page — this centers the title/subtitle in the
/// upper third of an otherwise blank page and stacks the composer/arranger
/// credits beneath, following the traditional cover-page convention.
///
/// `page_top` is the y-coordinate of the title page's top edge (its
/// `PageLayout::y_offset`); `page_height` is that page's box height.
pub fn render_title_page(
    metadata: Option<&ScoreMetadata>,
    config: &LayoutConfig,
    page_top: f64,
    page_height: f64,
    page_width: f64,
) -> Vec<RenderCommand> {
    if !metadata_has_credits(metadata) {
        return Vec::new();
    }
    let meta = metadata.expect("metadata_has_credits guarantees Some");
    let sp = config.sp;
    let center_x = page_width / 2.0;
    let styles = &config.text_styles;
    let mut commands = Vec::new();

    // Title baseline begins about one-third down the page — the classic cover
    // proportion that leaves generous head-space above the title.
    let mut y = page_top + page_height * 0.30;

    if let Some(title) = &meta.title {
        let style = styles.resolve(TextRole::Title);
        let size = style.size_px(sp);
        y += size;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y,
            text: title.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Center,
            baseline: TextBaseline::Alphabetic,
        });
        y += 1.2 * sp; // roomier gap than the inline block
    }

    if let Some(subtitle) = &meta.subtitle {
        let style = styles.resolve(TextRole::Subtitle);
        let size = style.size_px(sp);
        y += size;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y,
            text: subtitle.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Center,
            baseline: TextBaseline::Alphabetic,
        });
    }

    // Composer/arranger credits sit a clear gap below the title stack, also
    // centered, mirroring the upper block.
    y += 4.0 * sp;
    if let Some(composer) = &meta.composer {
        let style = styles.resolve(TextRole::Composer);
        let size = style.size_px(sp);
        y += size;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y,
            text: composer.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Center,
            baseline: TextBaseline::Alphabetic,
        });
        y += 0.8 * sp;
    }
    if let Some(lyricist) = &meta.lyricist {
        let style = styles.resolve(TextRole::Lyricist);
        let size = style.size_px(sp);
        y += size;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y,
            text: lyricist.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Center,
            baseline: TextBaseline::Alphabetic,
        });
        y += 0.8 * sp;
    }
    if let Some(arranger) = &meta.arranger {
        let style = styles.resolve(TextRole::Arranger);
        let size = style.size_px(sp);
        y += size;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y,
            text: arranger.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Center,
            baseline: TextBaseline::Alphabetic,
        });
    }

    // Copyright notice: small, centered, seated just above the bottom margin in
    // the foot of the cover page — the conventional place for a copyright line.
    if let Some(copyright) = &meta.copyright {
        let style = styles.resolve(TextRole::Copyright);
        let size = style.size_px(sp);
        let foot_y = page_top + page_height - config.page_margin_bottom * sp;
        commands.push(RenderCommand::DrawText {
            x: center_x,
            y: foot_y,
            text: copyright.clone(),
            font: style.font_string(),
            size,
            color: style.color.clone(),
            align: TextAlign::Center,
            baseline: TextBaseline::Alphabetic,
        });
    }

    commands
}
