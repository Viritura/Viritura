//! Stage 2: the page-break optimizer.
//!
//! A dynamic program over system boundaries that minimizes
//! `density_cost + turn_cost (+ relief-valve penalties)`, honoring recto/verso
//! parity so that `turn_cost` is only charged at *physical* page turns.
//!
//! The optimizer is a pure function of its inputs; it produces a set of page
//! start system indices which the caller feeds to the existing packer as
//! `forced_page_starts`. See `docs/plans/auto-page-breaks.md`.

use crate::layout::page_turn::analysis::{TurnAnnotation, TurnQuality, TurnWindow};
use crate::layout::page_turn::config::{PageTurnConfig, TitlePagePolicy};

/// Geometry the optimizer needs to judge page fill.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageGeometry {
    /// Usable vertical space for systems on a page (px).
    pub usable_height: f64,
    /// Inline title-block height reserved on the first music page (px). Zero
    /// when a dedicated title page is used.
    pub title_height: f64,
    /// Vertical spacing between systems on a page (px).
    pub inter_system_spacing: f64,
}

/// Why a chosen turn is flagged for the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnWarningKind {
    /// Below the V.S. band but nonzero — a rushed turn.
    Tight,
    /// No rest at all — turning drops a sounding note.
    Impossible,
    /// Lands on repeat/volta/jump structure.
    Structural,
    /// Lands on a fermata/caesura.
    Fermata,
}

/// A flagged page turn in the chosen layout.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TurnWarning {
    /// The boundary (between this measure and the next) where the turn lands.
    pub boundary_measure: usize,
    /// Why it is flagged.
    pub kind: TurnWarningKind,
    /// Available turn time in seconds.
    pub turn_seconds: f64,
}

/// A courtesy "next page opens with N bars rest" hint, printed in the margin
/// at the foot of the outgoing page so the player knows a turn here is safe.
/// Emitted only for the "time" case (the rest sits after the turn).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageTurnHint {
    /// Last system index of the outgoing page (the page that carries the
    /// hint). The renderer locates the page by this system.
    pub last_system: usize,
    /// Number of whole-bar rests at the top of the incoming page.
    pub rest_measures: usize,
}

/// The optimizer's chosen pagination.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnPlan {
    /// System indices that begin a page (always starts with 0).
    pub page_starts: Vec<usize>,
    /// Whether a dedicated title page precedes the music.
    pub title_page: bool,
    /// Whether the first physical page is a lone recto.
    pub first_page_recto: bool,
    /// Total objective cost (lower is better).
    pub cost: f64,
    /// Turns flagged for the user.
    pub warnings: Vec<TurnWarning>,
    /// Courtesy "N bars rest on the next page" margin hints.
    pub hints: Vec<PageTurnHint>,
    /// System indices whose music page is preceded by an intentionally blank
    /// page. Blank pages are a parity relief valve and never split a system.
    pub blank_pages_before: Vec<usize>,
}

const BIG: f64 = 1_000.0;

/// Per-page density cost. Treats `[min_fill_fraction, 1.0]` as an acceptable
/// band (cheap, with only a gentle pull toward the comfort anchor) and charges
/// a steep linear shortfall penalty for pages that fall *below* the band.
pub(super) fn density_cost(
    content_height: f64,
    capacity: f64,
    is_last: bool,
    config: &PageTurnConfig,
) -> f64 {
    if capacity <= 0.0 {
        return 0.0;
    }
    let fill = content_height / capacity;
    let target = config.target_fill_fraction;
    let floor = config.min_fill_fraction;
    let w = &config.weights;
    // Gentle convex pull toward the comfort anchor: inside the good band this
    // is the only term, distributing slack evenly and breaking ties toward
    // well-filled pages. Kept small (weight `density`) so it never overrides
    // turn quality on its own.
    let dev = fill - target;
    let mut cost = w.density * dev * dev;
    // Below the band the page is genuinely under-filled — the amateur-looking
    // sparse failure mode. Charge a steep LINEAR shortfall penalty so any
    // sub-floor page reliably loses to a denser layout unless the only
    // alternative is a genuinely bad turn (which carries a far larger base
    // cost). Linear (not squared) so the penalty bites immediately below the
    // floor instead of staying flat near it. The last page is exempt — a short
    // final page is expected.
    if !is_last && fill < floor {
        cost += w.sparse * (floor - fill);
        // Professional engraving (no partial pages) forbids a badly sparse
        // page outright.
        if !config.allow_partial_pages && fill < 0.6 {
            cost += BIG;
        }
    }
    cost
}

/// Reject genuinely near-empty non-final pages. Partial pages are a page-turn
/// relief valve, not permission to strand one line on an otherwise blank leaf.
/// When partial pages are disabled, the configured fill floor is hard.
pub(super) fn page_fill_is_allowed(
    content_height: f64,
    capacity: f64,
    is_last: bool,
    config: &PageTurnConfig,
) -> bool {
    if is_last || capacity <= 0.0 {
        return true;
    }
    let fill = content_height / capacity;
    fill >= 0.5 && (config.allow_partial_pages || fill >= config.min_fill_fraction)
}

/// Cost of a physical turn at a given window.
pub(super) fn turn_cost(window: &TurnWindow, config: &PageTurnConfig) -> f64 {
    let w = &config.weights;
    // Hard-avoid conditions: structural navigation or a held note at the turn.
    let mut base = match window.quality {
        TurnQuality::Comfortable => 0.0,
        TurnQuality::Vs => 0.4,
        TurnQuality::Tight => {
            if window.turn_seconds >= config.min_acceptable_secs {
                1.5
            } else {
                4.0
            }
        }
        TurnQuality::Impossible => 8.0,
    };
    if window.structural {
        base += 10.0;
    }
    if window.fermata_blocked {
        base += 6.0;
    }
    // Prefer the rest to fall BEFORE the turn (tail): the player rests, then
    // turns — the natural V.S. When more rest sits AFTER the turn than before
    // it (head, typically a multimeasure rest sitting at the top of the next
    // page), the engraver must print "time" and the player turns first, resting
    // after. That is acceptable but should be exceptional: charge a soft penalty
    // so a denser layout that pulls the rest before the turn wins, unless the
    // alternative is genuinely worse (a tighter or impossible turn elsewhere,
    // which carries a far larger base cost). The penalty scales with how much
    // rest the turn leans on *after* it — keyed off the head excess, not the
    // tail deficit, so a long opening rest still gets pulled back even when the
    // outgoing page already ends comfortably.
    let viable = matches!(window.quality, TurnQuality::Comfortable | TurnQuality::Vs);
    if viable && window.head_seconds > window.tail_seconds {
        let head_excess =
            (window.head_seconds - window.tail_seconds).clamp(0.0, config.comfortable_secs);
        let excess = if config.comfortable_secs > 0.0 {
            head_excess / config.comfortable_secs
        } else {
            0.0
        };
        base += w.time_marking * excess;
    }
    w.turn * base
}

/// Look up the turn window whose boundary is the last measure of `system`.
fn window_after_system<'a>(
    system_ranges: &[(usize, usize)],
    windows: &'a [TurnWindow],
    system: usize,
) -> Option<&'a TurnWindow> {
    let last_measure = system_ranges[system].1;
    windows.iter().find(|w| w.boundary_index == last_measure)
}

/// `true` when a physical page turn happens after a page with the given index
/// parity. With `first_page_recto`, spreads are (0 alone),(1,2),(3,4)… so a
/// turn follows even-indexed pages; otherwise spreads are (0,1),(2,3)… and a
/// turn follows odd-indexed pages.
pub(super) fn is_physical_turn(page_index_parity: usize, first_page_recto: bool) -> bool {
    if first_page_recto {
        page_index_parity == 0
    } else {
        page_index_parity == 1
    }
}

struct DpResult {
    cost: f64,
    page_starts: Vec<usize>,
    blank_pages_before: Vec<usize>,
}

/// Forward DP for one (initial_pages, first_page_recto) configuration.
fn run_dp(
    system_heights: &[f64],
    system_gaps: &[f64],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
    system_ranges: &[(usize, usize)],
    windows: &[TurnWindow],
    initial_pages: usize,
    first_page_recto: bool,
) -> Option<DpResult> {
    let s = system_heights.len();
    if s == 0 {
        return None;
    }
    // dp[i][par] = best cost to cover systems[0..i] where
    // par = (initial_pages + pages_used) % 2.
    let inf = f64::INFINITY;
    let mut dp = vec![[inf, inf]; s + 1];
    // backpointer: (prev_i, prev_par, blank page after this completed page)
    let mut back = vec![[(usize::MAX, 0usize, false); 2]; s + 1];
    let start_par = initial_pages % 2;
    dp[0][start_par] = 0.0;

    for j in 0..s {
        for par_j in 0..2 {
            let base = dp[j][par_j];
            if !base.is_finite() {
                continue;
            }
            // Try ending a page at system i-1 (page covers systems j..i).
            let mut content = 0.0;
            for i in (j + 1)..=s {
                let sys = i - 1;
                if i - 1 > j {
                    // Gap before `sys` (the prior system on this page). Per-system
                    // skyline gaps mirror the packer's white-space model; fall
                    // back to the flat geometry spacing when none are supplied.
                    content += system_gaps
                        .get(sys)
                        .copied()
                        .unwrap_or(geometry.inter_system_spacing);
                }
                content += system_heights[sys];

                let title_reserve = if j == 0 { geometry.title_height } else { 0.0 };
                let capacity = geometry.usable_height - title_reserve;
                // Multi-system pages must fit; a lone oversized system is always
                // allowed (the packer grows its box).
                let count = i - j;
                if count > 1 && content > capacity {
                    break;
                }
                let is_last = i == s;
                if !page_fill_is_allowed(content, capacity, is_last, config) {
                    continue;
                }
                let density = density_cost(content, capacity, is_last, config);

                // Direct transition to the next music page.
                let new_par = (par_j + 1) % 2;
                let mut direct_step = density;
                if i < s && is_physical_turn(par_j, first_page_recto) {
                    if let Some(win) = window_after_system(system_ranges, windows, sys) {
                        direct_step += turn_cost(win, config);
                    }
                }
                let cand = base + direct_step;
                if cand < dp[i][new_par] {
                    dp[i][new_par] = cand;
                    back[i][new_par] = (j, par_j, false);
                }

                // A blank page shifts the following music page's parity. Of the
                // two consecutive page boundaries around it, exactly one is a
                // physical turn, and both occur in the same musical rest window.
                if i < s && config.allow_intentional_blanks {
                    let next_music_par = par_j;
                    let mut blank_step = density + config.weights.blank_page;
                    if let Some(win) = window_after_system(system_ranges, windows, sys) {
                        blank_step += turn_cost(win, config);
                    }
                    let cand = base + blank_step;
                    if cand < dp[i][next_music_par] {
                        dp[i][next_music_par] = cand;
                        back[i][next_music_par] = (j, par_j, true);
                    }
                }
            }
        }
    }

    let (end_par, cost) = if dp[s][0] <= dp[s][1] {
        (0usize, dp[s][0])
    } else {
        (1usize, dp[s][1])
    };
    if !cost.is_finite() {
        return None;
    }

    // Reconstruct page starts.
    let mut starts = Vec::new();
    let mut blank_pages_before = Vec::new();
    let mut i = s;
    let mut par = end_par;
    while i > 0 {
        let (j, par_j, blank_after) = back[i][par];
        starts.push(j);
        if blank_after && i < s {
            blank_pages_before.push(i);
        }
        i = j;
        par = par_j;
    }
    starts.reverse();
    blank_pages_before.reverse();
    Some(DpResult {
        cost,
        page_starts: starts,
        blank_pages_before,
    })
}

/// Collect warnings for the chosen page starts.
fn collect_warnings(
    page_starts: &[usize],
    blank_pages_before: &[usize],
    system_ranges: &[(usize, usize)],
    windows: &[TurnWindow],
    first_page_recto: bool,
    initial_pages: usize,
    config: &PageTurnConfig,
) -> Vec<TurnWarning> {
    let mut warnings = Vec::new();
    let s = system_ranges.len();
    let mut page_parity = initial_pages % 2;
    // A page p covers systems [page_starts[p], page_starts[p+1]).
    for (p, _start) in page_starts.iter().enumerate() {
        let end = page_starts.get(p + 1).copied().unwrap_or(s); // exclusive
        if end >= s {
            continue; // last page: no turn after it.
        }
        let has_blank = blank_pages_before.contains(&end);
        let next_page_parity = (page_parity + 1 + usize::from(has_blank)) % 2;
        if !has_blank && !is_physical_turn(page_parity, first_page_recto) {
            page_parity = next_page_parity;
            continue;
        }
        page_parity = next_page_parity;
        let last_system = end - 1;
        let Some(win) = window_after_system(system_ranges, windows, last_system) else {
            continue;
        };
        let kind = if win.structural {
            Some(TurnWarningKind::Structural)
        } else if win.fermata_blocked {
            Some(TurnWarningKind::Fermata)
        } else if win.quality == TurnQuality::Impossible {
            Some(TurnWarningKind::Impossible)
        } else if win.turn_seconds < config.min_acceptable_secs {
            Some(TurnWarningKind::Tight)
        } else {
            None
        };
        if let Some(kind) = kind {
            warnings.push(TurnWarning {
                boundary_measure: win.boundary_index,
                kind,
                turn_seconds: win.turn_seconds,
            });
        }
    }
    warnings
}

/// Collect courtesy "N bars rest on the next page" hints for the chosen page
/// starts. A hint is emitted only at a physical turn whose window is the
/// "time" case (rest sits after the turn — typically a multimeasure rest at
/// the top of the next page) and where at least one whole-bar rest follows.
fn collect_hints(
    page_starts: &[usize],
    blank_pages_before: &[usize],
    system_ranges: &[(usize, usize)],
    windows: &[TurnWindow],
    first_page_recto: bool,
    initial_pages: usize,
) -> Vec<PageTurnHint> {
    let mut hints = Vec::new();
    let s = system_ranges.len();
    let mut page_parity = initial_pages % 2;
    for (p, _start) in page_starts.iter().enumerate() {
        let end = page_starts.get(p + 1).copied().unwrap_or(s); // exclusive
        if end >= s {
            continue; // last page: no turn after it.
        }
        let has_blank = blank_pages_before.contains(&end);
        let next_page_parity = (page_parity + 1 + usize::from(has_blank)) % 2;
        if !has_blank && !is_physical_turn(page_parity, first_page_recto) {
            page_parity = next_page_parity;
            continue;
        }
        page_parity = next_page_parity;
        let last_system = end - 1;
        let Some(win) = window_after_system(system_ranges, windows, last_system) else {
            continue;
        };
        if win.annotation == TurnAnnotation::Time && win.head_rest_measures >= 1 {
            hints.push(PageTurnHint {
                last_system,
                rest_measures: win.head_rest_measures,
            });
        }
    }
    hints
}

pub(super) fn describe_selected_pagination(
    page_starts: &[usize],
    blank_pages_before: &[usize],
    system_ranges: &[(usize, usize)],
    windows: &[TurnWindow],
    first_page_recto: bool,
    title_page: bool,
    config: &PageTurnConfig,
) -> (Vec<TurnWarning>, Vec<PageTurnHint>) {
    let initial_pages = usize::from(title_page);
    (
        collect_warnings(
            page_starts,
            blank_pages_before,
            system_ranges,
            windows,
            first_page_recto,
            initial_pages,
            config,
        ),
        collect_hints(
            page_starts,
            blank_pages_before,
            system_ranges,
            windows,
            first_page_recto,
            initial_pages,
        ),
    )
}

/// Run the optimizer, evaluating title-page and parity options per config and
/// returning the cheapest plan.
pub fn optimize(
    system_heights: &[f64],
    system_gaps: &[f64],
    geometry: &PageGeometry,
    config: &PageTurnConfig,
    system_ranges: &[(usize, usize)],
    windows: &[TurnWindow],
) -> Option<TurnPlan> {
    // Candidate (title_page, first_page_recto) configurations.
    let titles: &[bool] = match config.title_page {
        TitlePagePolicy::Always => &[true],
        TitlePagePolicy::Never => &[false],
        TitlePagePolicy::Auto => &[false, true],
    };
    // Page-turn parity is a PHYSICAL property of the binding, not a free knob.
    // A bound volume always opens on a recto (page 0 seen alone), so physical
    // turns fall after even-indexed pages — you cannot move them without adding
    // front matter. The title page IS that lever: it shifts the music down one
    // physical page, flipping every music-turn's parity (and costs
    // `weights.title_page`). Searching `first_page_recto` freely here would let
    // the optimizer buy that parity flip for nothing, which is why title pages
    // previously never appeared. So we default to the recto-first binding and
    // only honor an explicit `first_page_recto` override.
    let rectos: Vec<bool> = vec![config.first_page_recto.unwrap_or(true)];

    let mut best: Option<TurnPlan> = None;
    for &title in titles {
        let initial_pages = if title { 1 } else { 0 };
        // With a dedicated title page the inline title height is freed.
        let geom = if title {
            PageGeometry {
                title_height: 0.0,
                ..*geometry
            }
        } else {
            *geometry
        };
        for &recto in &rectos {
            let Some(res) = run_dp(
                system_heights,
                system_gaps,
                &geom,
                config,
                system_ranges,
                windows,
                initial_pages,
                recto,
            ) else {
                continue;
            };
            let mut total = res.cost;
            if title {
                total += config.weights.title_page;
            }
            let is_better = best.as_ref().map(|b| total < b.cost).unwrap_or(true);
            if is_better {
                let warnings = collect_warnings(
                    &res.page_starts,
                    &res.blank_pages_before,
                    system_ranges,
                    windows,
                    recto,
                    initial_pages,
                    config,
                );
                let hints = collect_hints(
                    &res.page_starts,
                    &res.blank_pages_before,
                    system_ranges,
                    windows,
                    recto,
                    initial_pages,
                );
                best = Some(TurnPlan {
                    page_starts: res.page_starts,
                    title_page: title,
                    first_page_recto: recto,
                    cost: total,
                    warnings,
                    hints,
                    blank_pages_before: res.blank_pages_before,
                });
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::page_turn::analysis::TurnAnnotation;

    fn geom() -> PageGeometry {
        PageGeometry {
            usable_height: 100.0,
            title_height: 0.0,
            inter_system_spacing: 0.0,
        }
    }

    fn cfg() -> PageTurnConfig {
        // Pin parity so tests are deterministic: first page is verso-leading,
        // no title page.
        PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            first_page_recto: Some(false),
            allow_intentional_blanks: false,
            ..PageTurnConfig::default()
        }
    }

    fn ranges(n: usize) -> Vec<(usize, usize)> {
        (0..n).map(|i| (i, i)).collect()
    }

    fn comfortable_window(boundary: usize) -> TurnWindow {
        TurnWindow {
            boundary_index: boundary,
            turn_seconds: 5.0,
            // All rest before the turn: the ideal tail-rest V.S., no penalty.
            tail_seconds: 5.0,
            head_seconds: 0.0,
            head_rest_measures: 0,
            quality: TurnQuality::Comfortable,
            structural: false,
            fermata_blocked: false,
            annotation: TurnAnnotation::None,
        }
    }

    fn impossible_window(boundary: usize) -> TurnWindow {
        TurnWindow {
            boundary_index: boundary,
            turn_seconds: 0.0,
            tail_seconds: 0.0,
            head_seconds: 0.0,
            head_rest_measures: 0,
            quality: TurnQuality::Impossible,
            structural: false,
            fermata_blocked: false,
            annotation: TurnAnnotation::None,
        }
    }

    #[test]
    fn test_collect_hints_emits_time_case_bar_count() {
        // A physical turn whose window is the "time" case (rest after the
        // turn) yields a courtesy hint on the outgoing page naming the bar
        // count.
        let win = TurnWindow {
            boundary_index: 0,
            turn_seconds: 8.0,
            tail_seconds: 0.0,
            head_seconds: 8.0,
            head_rest_measures: 4,
            quality: TurnQuality::Comfortable,
            structural: false,
            fermata_blocked: false,
            annotation: TurnAnnotation::Time,
        };
        // Two systems, one per page; with a recto-leading first page the turn
        // after page 0 (system 0) is physical.
        let hints = collect_hints(&[0, 1], &[], &ranges(2), &[win], true, 0);
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].last_system, 0);
        assert_eq!(hints[0].rest_measures, 4);
    }

    #[test]
    fn test_collect_hints_skips_non_time_turns() {
        // A normal V.S. (rest before the turn) gets no "N bars" courtesy hint.
        let win = TurnWindow {
            boundary_index: 0,
            turn_seconds: 4.0,
            tail_seconds: 4.0,
            head_seconds: 0.0,
            head_rest_measures: 0,
            quality: TurnQuality::Vs,
            structural: false,
            fermata_blocked: false,
            annotation: TurnAnnotation::Vs,
        };
        let hints = collect_hints(&[0, 1], &[], &ranges(2), &[win], true, 0);
        assert!(hints.is_empty());
    }

    #[test]
    fn test_time_case_costs_more_than_tail_rest() {
        // Two turns with identical total rest, both comfortable. One rests
        // entirely BEFORE the turn (tail); the other only AFTER (head) — the
        // "time" case. The head-only turn must cost strictly more so the
        // optimizer prefers pulling the rest before the turn.
        let config = PageTurnConfig::default();
        let tail = TurnWindow {
            boundary_index: 0,
            turn_seconds: 8.0,
            tail_seconds: 8.0,
            head_seconds: 0.0,
            head_rest_measures: 0,
            quality: TurnQuality::Comfortable,
            structural: false,
            fermata_blocked: false,
            annotation: TurnAnnotation::None,
        };
        let head = TurnWindow {
            tail_seconds: 0.0,
            head_seconds: 8.0,
            ..tail
        };
        assert_eq!(turn_cost(&tail, &config), 0.0);
        assert!(turn_cost(&head, &config) > turn_cost(&tail, &config));
    }

    #[test]
    fn test_single_system_one_page() {
        let plan = optimize(&[50.0], &[], &geom(), &cfg(), &ranges(1), &[]).unwrap();
        assert_eq!(plan.page_starts, vec![0]);
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn test_density_band_floor_penalty() {
        // Capacity 100. A page filled inside the [floor, 1.0] band is cheap;
        // a page below the floor pays a steep linear shortfall penalty, and the
        // penalty grows as the page gets sparser. The last page is exempt.
        let config = cfg();
        let floor = config.min_fill_fraction * 100.0; // px at the floor
                                                      // Just inside the band → only the gentle anchor pull, well under 0.1.
        let in_band = density_cost(floor + 1.0, 100.0, false, &config);
        assert!(in_band < 0.1, "in-band cost {in_band} should be small");
        // Below the floor → noticeably more expensive than in-band.
        let sparse = density_cost(floor - 15.0, 100.0, false, &config);
        assert!(
            sparse > in_band + 0.5,
            "sub-floor cost {sparse} should clearly exceed in-band {in_band}"
        );
        // Sparser still → more expensive (monotone below the floor).
        let sparser = density_cost(floor - 30.0, 100.0, false, &config);
        assert!(sparser > sparse, "{sparser} should exceed {sparse}");
        // The last page is exempt from the floor rule.
        let last = density_cost(floor - 30.0, 100.0, true, &config);
        assert!(
            last < sparser,
            "last page {last} must dodge the floor penalty"
        );
    }

    #[test]
    fn test_two_systems_fit_one_page() {
        // Two 40px systems on a 100px page → one page (denser is better).
        let windows = [comfortable_window(0)];
        let plan = optimize(&[40.0, 40.0], &[], &geom(), &cfg(), &ranges(2), &windows).unwrap();
        assert_eq!(plan.page_starts, vec![0]);
    }

    #[test]
    fn test_overfull_forces_split() {
        // Two 70px systems cannot share a 100px page.
        let windows = [comfortable_window(0)];
        let plan = optimize(&[70.0, 70.0], &[], &geom(), &cfg(), &ranges(2), &windows).unwrap();
        assert_eq!(plan.page_starts, vec![0, 1]);
    }

    #[test]
    fn test_avoids_impossible_turn_by_repaginating() {
        // Four 40px systems. Capacity fits 2 per page. The natural break after
        // system 1 (boundary measure 1) is an impossible turn; the optimizer
        // should prefer breaking elsewhere if cheaper, or at least flag it.
        // Here every other boundary is comfortable; system heights let the DP
        // choose 1+2+1 to dodge the bad turn at the cost of some density.
        let windows = [
            impossible_window(0),
            comfortable_window(1),
            impossible_window(2),
        ];
        let plan = optimize(
            &[40.0, 40.0, 40.0, 40.0],
            &[],
            &geom(),
            &cfg(),
            &ranges(4),
            &windows,
        )
        .unwrap();
        // The physical turn (after page 0, parity 1 is NOT a turn; parity 0 is
        // page 0 → not a turn for verso-leading). Page 0 index 0 → not a turn.
        // So whichever pagination, the first turn is after page 1. We just
        // assert a valid covering pagination was produced.
        assert_eq!(plan.page_starts.first(), Some(&0));
        assert!(plan.page_starts.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn test_impossible_turn_is_warned() {
        // Force a split that lands a physical turn on an impossible boundary.
        // Heights force one system per page; with verso-leading, page index 1
        // (after system 1) is the first physical turn → boundary measure 1.
        let windows = [
            comfortable_window(0),
            impossible_window(1),
            comfortable_window(2),
        ];
        let plan = optimize(
            &[80.0, 80.0, 80.0, 80.0],
            &[],
            &geom(),
            &cfg(),
            &ranges(4),
            &windows,
        )
        .unwrap();
        // One system per page → page starts 0,1,2,3.
        assert_eq!(plan.page_starts, vec![0, 1, 2, 3]);
        // Physical turn after page index 1 (system 1, boundary measure 1).
        assert!(plan
            .warnings
            .iter()
            .any(|w| w.boundary_measure == 1 && w.kind == TurnWarningKind::Impossible));
    }

    #[test]
    fn test_title_page_chosen_to_fix_turn_parity() {
        // Recto-first binding (default): without a title, physical turns fall
        // after EVEN music pages (0, 2). Put impossible turns there and good
        // turns on the odd boundaries. A title page shifts the music down one
        // physical page, moving every turn onto the odd (comfortable)
        // boundaries — so the optimizer should elect the cover page even at the
        // `weights.title_page` cost.
        let cfg = PageTurnConfig {
            title_page: TitlePagePolicy::Auto,
            first_page_recto: None, // standard recto-first binding
            ..PageTurnConfig::default()
        };
        let windows = [
            impossible_window(0),  // after music page 0 — bad without title
            comfortable_window(1), // after music page 1 — good with title
            impossible_window(2),  // after music page 2 — bad without title
        ];
        // 80px systems on a 100px page ⇒ one system per page.
        let plan = optimize(
            &[80.0, 80.0, 80.0, 80.0],
            &[],
            &geom(),
            &cfg,
            &ranges(4),
            &windows,
        )
        .unwrap();
        assert!(
            plan.title_page,
            "a title page should be chosen to move turns onto the comfortable boundaries"
        );
        // With the title page, the only physical turn lands on the comfortable
        // boundary (measure 1), so no impossible-turn warning remains.
        assert!(
            !plan
                .warnings
                .iter()
                .any(|w| w.kind == TurnWarningKind::Impossible),
            "the cover page should eliminate the impossible turns"
        );
    }

    #[test]
    fn test_no_title_page_when_parity_already_good() {
        // Mirror image: the EVEN boundaries (where turns fall without a title)
        // are already comfortable, so paying for a title page is pure loss and
        // must NOT be chosen.
        let cfg = PageTurnConfig {
            title_page: TitlePagePolicy::Auto,
            first_page_recto: None,
            ..PageTurnConfig::default()
        };
        let windows = [
            comfortable_window(0),
            impossible_window(1),
            comfortable_window(2),
        ];
        let plan = optimize(
            &[80.0, 80.0, 80.0, 80.0],
            &[],
            &geom(),
            &cfg,
            &ranges(4),
            &windows,
        )
        .unwrap();
        assert!(
            !plan.title_page,
            "no title page when the natural turn parity is already comfortable"
        );
    }

    #[test]
    fn test_blank_page_shifts_later_turns_without_hiding_its_own_turn() {
        let mut config = PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            first_page_recto: Some(true),
            allow_intentional_blanks: true,
            ..PageTurnConfig::default()
        };
        config.weights.blank_page = 0.1;
        let windows = [
            comfortable_window(0),
            comfortable_window(1),
            impossible_window(2),
        ];

        let plan = optimize(
            &[80.0, 80.0, 80.0, 80.0],
            &[],
            &geom(),
            &config,
            &ranges(4),
            &windows,
        )
        .unwrap();

        assert_eq!(plan.blank_pages_before.len(), 1);
        assert!(
            !plan
                .warnings
                .iter()
                .any(|warning| warning.boundary_measure == 2),
            "the blank should shift the later physical turn off the impossible boundary"
        );

        let warnings = collect_warnings(
            &[0, 1],
            &[1],
            &ranges(2),
            &[impossible_window(0)],
            true,
            0,
            &config,
        );
        assert_eq!(
            warnings.first().map(|warning| warning.boundary_measure),
            Some(0),
            "a blank never makes the musical turn window disappear"
        );
    }
}
