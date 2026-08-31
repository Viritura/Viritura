//! Greedy page packing and adjacent-page fill balancing.

use super::super::config::LayoutConfig;
use crate::render::PageLayout;

/// Compute page breaks using a greedy algorithm.
///
/// Given a list of system heights (in pixels), assigns systems to pages
/// based on the usable page height derived from `LayoutConfig`.
/// `title_height_px` reserves space at the top of page 1 for a title block.
/// Each page accumulates systems top-to-bottom, breaking to a new page
/// when the next system (plus inter-system spacing) would exceed the
/// usable height.
pub fn compute_page_breaks(
    system_heights: &[f64],
    config: &LayoutConfig,
    title_height_px: f64,
) -> Vec<PageLayout> {
    compute_page_breaks_with_forced(system_heights, config, title_height_px, &[])
}

/// Like [`compute_page_breaks`] but also honors a list of system indices that
/// MUST start a new page. Indices in `forced_page_starts` are points where a
/// page break is forced regardless of available height (system index 0 is
/// implicit and ignored). Useful for engrave-mode user-authored page breaks
/// and for honoring MNX `score.pages[]` boundaries.
pub fn compute_page_breaks_with_forced(
    system_heights: &[f64],
    config: &LayoutConfig,
    title_height_px: f64,
    forced_page_starts: &[usize],
) -> Vec<PageLayout> {
    compute_page_breaks_full(
        system_heights,
        None,
        config,
        title_height_px,
        forced_page_starts,
        true,
    )
}

/// Like [`compute_page_breaks_with_forced`] but additionally takes per-system
/// `(above_extra, below_extra)` protrusions so the page packer can match the
/// positioner's "uniform white-space" model: when adjacent systems' extras
/// are small enough to absorb into the default inter-system gap, the per-gap
/// cost shrinks accordingly and more systems fit per page.
///
/// Without extras, each gap costs `config.inter_system_spacing`. With extras
/// the cost is `max(min_skyline_clearance, default_inter_staff - below_i - above_{i+1})`,
/// matching the skyline gap that `compute_system_y_positions` produces at
/// uniform W = `default_inter_staff`.
pub fn compute_page_breaks_with_extras(
    system_heights: &[f64],
    protrusion_extras: Option<&[(f64, f64)]>,
    config: &LayoutConfig,
    title_height_px: f64,
    forced_page_starts: &[usize],
) -> Vec<PageLayout> {
    compute_page_breaks_full(
        system_heights,
        protrusion_extras,
        config,
        title_height_px,
        forced_page_starts,
        true,
    )
}

/// Pack systems using page membership already selected by the system-layout
/// planner. Forced starts are honored, and overflow may add a safety break, but
/// the page packer does not rebalance either kind of boundary afterward.
pub(crate) fn compute_page_breaks_preserving_membership(
    system_heights: &[f64],
    protrusion_extras: Option<&[(f64, f64)]>,
    config: &LayoutConfig,
    title_height_px: f64,
    selected_page_starts: &[usize],
) -> Vec<PageLayout> {
    compute_page_breaks_full(
        system_heights,
        protrusion_extras,
        config,
        title_height_px,
        selected_page_starts,
        false,
    )
}

/// The skyline gap (px) the packer places between two vertically adjacent
/// systems, given the bottom protrusion of the upper system and the top
/// protrusion of the lower one. Matches the "uniform white-space" model: the
/// default 7sp inter-staff distance is absorbed by the systems' protrusions,
/// never collapsing below a 1sp minimum clearance. Shared so the page-turn
/// optimizer can estimate page fill with the same gaps the packer will use.
pub(crate) fn effective_system_gap(below_prev: f64, above_cur: f64, sp: f64) -> f64 {
    let default_inter_staff = 7.0 * sp;
    let min_skyline_clearance = 1.0 * sp;
    (default_inter_staff - below_prev - above_cur).max(min_skyline_clearance)
}

fn compute_page_breaks_full(
    system_heights: &[f64],
    protrusion_extras: Option<&[(f64, f64)]>,
    config: &LayoutConfig,
    title_height_px: f64,
    forced_page_starts: &[usize],
    balance_unforced: bool,
) -> Vec<PageLayout> {
    if system_heights.is_empty() {
        return Vec::new();
    }

    let forced: std::collections::HashSet<usize> = forced_page_starts
        .iter()
        .copied()
        .filter(|&i| i > 0 && i < system_heights.len())
        .collect();

    let sp = config.sp;
    let page_height = config.page_height * sp;
    let margin_top = config.page_margin_top * sp;
    let margin_bottom = config.page_margin_bottom * sp;
    // When no per-system extras are supplied, fall back to the configured
    // inter-system spacing (a generous default). With extras we can pack
    // tighter — the gap cost is the actual skyline gap at uniform W.
    let default_gap = config.inter_system_spacing * sp;
    let base_usable_height = page_height - margin_top - margin_bottom;

    // Cost of the gap between previously placed system `prev` and incoming `cur`.
    let gap_cost = |prev: usize, cur: usize| -> f64 {
        match protrusion_extras {
            Some(extras) => {
                let (_, below_prev) = extras.get(prev).copied().unwrap_or((0.0, 0.0));
                let (above_cur, _) = extras.get(cur).copied().unwrap_or((0.0, 0.0));
                effective_system_gap(below_prev, above_cur, sp)
            }
            None => default_gap,
        }
    };

    // The page box is ALWAYS the configured page height — it is a hard
    // boundary. When a system's content is taller than the usable page area
    // (e.g. a 30-stave orchestral score on A4) the box does NOT grow; instead
    // the positioner (`compute_system_y_positions`) force-squishes the
    // intra-staff gaps so the bottom staff stays within the bottom margin.
    // We never rescale staves (rastral) or resize the page to fit.

    let mut pages: Vec<PageLayout> = Vec::new();
    let mut current_systems: Vec<usize> = Vec::new();
    let mut current_height: f64 = 0.0;
    let mut page_y_offset: f64 = 0.0;

    for (i, &h) in system_heights.iter().enumerate() {
        let gap = if let Some(&prev) = current_systems.last() {
            gap_cost(prev, i)
        } else {
            0.0
        };
        let needed = if current_systems.is_empty() {
            h
        } else {
            gap + h
        };

        // Page 1 has less usable space due to title block
        let usable_height = if pages.is_empty() {
            base_usable_height - title_height_px
        } else {
            base_usable_height
        };

        let force_break = forced.contains(&i) && !current_systems.is_empty();

        // Start a new page if this system doesn't fit OR if it's a forced page start
        if (force_break || current_height + needed > usable_height) && !current_systems.is_empty() {
            let page_num = pages.len();
            let box_height = page_height;
            pages.push(PageLayout {
                page_number: page_num,
                system_indices: std::mem::take(&mut current_systems),
                y_offset: page_y_offset,
                height: box_height,
            });
            page_y_offset += box_height;
            current_height = 0.0;
        }

        let added = if current_systems.is_empty() {
            h
        } else {
            gap + h
        };
        current_systems.push(i);
        current_height += added;
    }

    // Finalize last page
    if !current_systems.is_empty() {
        let page_num = pages.len();
        let box_height = page_height;
        pages.push(PageLayout {
            page_number: page_num,
            system_indices: current_systems,
            y_offset: page_y_offset,
            height: box_height,
        });
    }

    // ── Self-balancing spread pass ──────────────────────────────────────
    // The greedy packer fills each page to capacity before breaking, which
    // can leave a trailing page sparse (e.g. 10 systems crammed on one page,
    // 7 on the next). Even out adjacent pages by pushing the last system of a
    // fuller page down onto the next page, provided the donor page stays
    // reasonably full (≥ `BALANCE_MIN_FILL`) and the receiving page still
    // fits. The page *boxes* are untouched — only which systems land on each
    // page changes. Skipped when any breaks are forced (explicit MNX pages or
    // the page-turn optimizer already dictate the split, and their balance
    // criteria must win).
    if balance_unforced && forced.is_empty() && pages.len() >= 2 {
        balance_page_fill(
            &mut pages,
            system_heights,
            &gap_cost,
            base_usable_height,
            title_height_px,
        );
    }

    pages
}

/// Minimum fill fraction a page may drop to when shedding a system to its
/// neighbour during the self-balancing pass. Keeps a balanced spread from
/// making the earlier page too sparse (the user-facing rule: "the first page
/// of a spread shouldn't go under 75%").
const BALANCE_MIN_FILL: f64 = 0.75;

/// Even out system distribution across adjacent pages produced by the greedy
/// packer. Repeatedly pushes the last system of a fuller page onto the next
/// page while doing so strictly reduces the pair's fill imbalance, the donor
/// page stays ≥ [`BALANCE_MIN_FILL`], and the receiving page still fits. The
/// page boxes and ordering are preserved; only `system_indices` are moved.
fn balance_page_fill<F: Fn(usize, usize) -> f64>(
    pages: &mut [PageLayout],
    system_heights: &[f64],
    gap_cost: &F,
    base_usable_height: f64,
    title_height_px: f64,
) {
    let usable_of = |page_idx: usize| -> f64 {
        if page_idx == 0 {
            base_usable_height - title_height_px
        } else {
            base_usable_height
        }
    };
    let content_height = |indices: &[usize]| -> f64 {
        let mut sum = 0.0;
        for (k, &si) in indices.iter().enumerate() {
            sum += system_heights[si];
            if k > 0 {
                sum += gap_cost(indices[k - 1], si);
            }
        }
        sum
    };

    // Bounded relaxation: each accepted move strictly reduces a pair's fill
    // imbalance, so the loop converges well within `len` passes.
    for _ in 0..system_heights.len().max(1) {
        let mut changed = false;
        for i in 0..pages.len() - 1 {
            if pages[i].system_indices.len() <= 1 {
                continue; // never empty a page
            }
            let moved = *pages[i].system_indices.last().unwrap();

            let mut new_left = pages[i].system_indices.clone();
            new_left.pop();
            let mut new_right = Vec::with_capacity(pages[i + 1].system_indices.len() + 1);
            new_right.push(moved);
            new_right.extend_from_slice(&pages[i + 1].system_indices);

            let usable_l = usable_of(i);
            let usable_r = usable_of(i + 1);

            let h_r_new = content_height(&new_right);
            if h_r_new > usable_r {
                continue; // receiver would overflow its box
            }
            let fill_l_new = content_height(&new_left) / usable_l;
            if fill_l_new < BALANCE_MIN_FILL {
                continue; // donor would become too sparse
            }
            let diff_old = (content_height(&pages[i].system_indices) / usable_l
                - content_height(&pages[i + 1].system_indices) / usable_r)
                .abs();
            let diff_new = (fill_l_new - h_r_new / usable_r).abs();
            if diff_new + 1e-9 < diff_old {
                pages[i].system_indices = new_left;
                pages[i + 1].system_indices = new_right;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
}
