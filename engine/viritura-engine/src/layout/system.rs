//! System breaking — distribute measures across lines.

/// Maximum compression ratio we'll accept when deciding whether to cram one
/// more measure onto a system. 1.20 = "natural total may overflow by up to
/// 20%", which the system justifier will then compress down (gaps shrink
/// from `shortest_duration_space` toward `min_note_spacing`). Beyond this
/// we always break to avoid bottoming out at the floor.
pub(crate) const MAX_COMPRESSION_OVERFLOW: f64 = 1.20;

/// Lower bound on how far the bars preceding a wide left-anchored marking may
/// be compressed to make room for it: `1 / MAX_COMPRESSION_OVERFLOW` ≈ 0.83,
/// i.e. the head may shrink to ~83% of its natural width (the same cap the
/// greedy breaker tolerates for overflow). Beyond this the casting would crush
/// note spacing past the floor, so the planner reflows (pull / break) instead.
pub(crate) const MIN_HEAD_SCALE: f64 = 1.0 / MAX_COMPRESSION_OVERFLOW;

/// Standard engraving practice leaves a sparse final system at natural width.
/// This also applies when the final system is the score's only system, as in a
/// short excerpt; sufficiently dense systems still justify to the full frame.
pub(crate) fn should_preserve_natural_final_width(
    natural_width: f64,
    available_width: f64,
    is_last_system: bool,
) -> bool {
    const JUSTIFY_THRESHOLD: f64 = 0.65;
    is_last_system && natural_width < available_width * JUSTIFY_THRESHOLD
}

/// Greedy system breaking with stretch/compress balancing.
///
/// Returns a Vec of systems, where each system is a Vec of indices into the
/// `measure_widths` slice. At minimum, each system contains one measure
/// (even if it exceeds the width).
///
/// At each candidate break, we compare:
///   • stretch badness if we break now  =  avail/current        − 1
///   • compress badness if we include   =  1 − avail/(current+w)
/// and pick whichever leaves the system closer to natural width (scale=1).
/// Including is capped by `MAX_COMPRESSION_OVERFLOW` so we never crush gaps
/// below the `min_note_spacing` floor.
///
/// Without balancing, the greedy "always break when overflowing" rule means
/// every system gets stretched up to fill the line — the score sees a
/// permanent +20-40% stretch bias. Balancing lets minor overflows ride
/// into compression instead of forcing stretch.
///
/// If the last system has only 1 measure and the previous system has 3+,
/// redistributes to avoid a sparse final line.
pub(crate) fn break_into_systems(measure_widths: &[f64], available_width: f64) -> Vec<Vec<usize>> {
    if measure_widths.is_empty() {
        return vec![];
    }

    let mut systems: Vec<Vec<usize>> = Vec::new();
    let mut current_system: Vec<usize> = Vec::new();
    let mut current_width: f64 = 0.0;

    for (i, &w) in measure_widths.iter().enumerate() {
        if !current_system.is_empty() && current_width + w > available_width {
            // Decide: break here (stretch current) vs. include this measure
            // (compress current+w). Pick whichever is closer to scale=1.
            let stretch_badness = (available_width / current_width - 1.0).abs();
            let include_total = current_width + w;
            let overflow_ratio = include_total / available_width; // > 1
            let compress_badness = 1.0 - 1.0 / overflow_ratio; // = (include_total - avail) / include_total

            if overflow_ratio <= MAX_COMPRESSION_OVERFLOW && compress_badness < stretch_badness {
                // Riding compression is closer to natural than stretching —
                // include this measure and break after.
                current_system.push(i);
                systems.push(std::mem::take(&mut current_system));
                current_width = 0.0;
                continue;
            }

            systems.push(std::mem::take(&mut current_system));
            current_width = 0.0;
        }
        current_system.push(i);
        current_width += w;
    }
    if !current_system.is_empty() {
        systems.push(current_system);
    }

    // Sparse last line redistribution: if last system has only 1 measure and
    // second-to-last has 3+, move one measure from penultimate to last.
    if systems.len() >= 2 {
        let last_idx = systems.len() - 1;
        let prev_idx = last_idx - 1;
        if systems[last_idx].len() == 1 && systems[prev_idx].len() >= 3 {
            let moved = systems[prev_idx].pop().unwrap();
            systems[last_idx].insert(0, moved);
        }
    }

    systems
}

/// Like [`break_into_systems`] but the first system uses `first_width` and
/// all subsequent systems use `rest_width`.  This lets the first system have
/// a wider label indent (full instrument names) while later systems use a
/// narrower margin (abbreviated names).
pub(crate) fn break_into_systems_dual_width(
    measure_widths: &[f64],
    first_width: f64,
    rest_width: f64,
) -> Vec<Vec<usize>> {
    if measure_widths.is_empty() {
        return vec![];
    }

    let mut systems: Vec<Vec<usize>> = Vec::new();
    let mut current_system: Vec<usize> = Vec::new();
    let mut current_width: f64 = 0.0;

    for (i, &w) in measure_widths.iter().enumerate() {
        let avail = if systems.is_empty() {
            first_width
        } else {
            rest_width
        };
        if !current_system.is_empty() && current_width + w > avail {
            let stretch_badness = (avail / current_width - 1.0).abs();
            let include_total = current_width + w;
            let overflow_ratio = include_total / avail;
            let compress_badness = 1.0 - 1.0 / overflow_ratio;
            if overflow_ratio <= MAX_COMPRESSION_OVERFLOW && compress_badness < stretch_badness {
                current_system.push(i);
                systems.push(std::mem::take(&mut current_system));
                current_width = 0.0;
                continue;
            }
            systems.push(std::mem::take(&mut current_system));
            current_width = 0.0;
        }
        current_system.push(i);
        current_width += w;
    }
    if !current_system.is_empty() {
        systems.push(current_system);
    }

    // Sparse last line redistribution
    if systems.len() >= 2 {
        let last_idx = systems.len() - 1;
        let prev_idx = last_idx - 1;
        if systems[last_idx].len() == 1 && systems[prev_idx].len() >= 3 {
            let moved = systems[prev_idx].pop().unwrap();
            systems[last_idx].insert(0, moved);
        }
    }

    systems
}

/// Force a system break before any measure whose tempo marking would extend
/// past the system's right edge if it stayed mid-system.
///
/// A tempo is engraved on one line, anchored at its measure's left edge and
/// flowing rightward. Standard engraving practice keeps the staff line within
/// the page margin and never wraps the tempo text, so when a measure carrying
/// a wide tempo sits too far into a justified system — leaving less room to the
/// right than the tempo needs — that measure is pushed to begin a fresh system
/// where the full system width is available.
///
/// `widths` and `tempo_widths` are indexed identically to the measure indices
/// stored in `systems`. Measures with `tempo_widths == 0` (the overwhelming
/// majority) never trigger a break, so ordinary scores are untouched. A tempo
/// wider than a whole system can't be helped by breaking, so the measure is
/// left in place (its first-on-system position) and the renderer's wrap path
/// handles the unavoidable overflow.
pub(crate) fn enforce_tempo_system_breaks(
    systems: Vec<Vec<usize>>,
    widths: &[f64],
    tempo_widths: &[f64],
    available_width: f64,
) -> Vec<Vec<usize>> {
    if available_width <= 0.0 {
        return systems;
    }
    let mut result: Vec<Vec<usize>> = Vec::new();
    for system in systems {
        let mut start = 0;
        while start < system.len() {
            let slice = &system[start..];
            let total: f64 = slice
                .iter()
                .map(|&mi| widths.get(mi).copied().unwrap_or(0.0))
                .sum::<f64>()
                .max(f64::EPSILON);
            // Find the first measure (after the system's first) whose tempo
            // can't fit in the room remaining to the justified right edge.
            let mut cum = 0.0;
            let mut split_at: Option<usize> = None;
            for (k, &mi) in slice.iter().enumerate() {
                let tw = tempo_widths.get(mi).copied().unwrap_or(0.0);
                if k > 0 && tw > 0.0 {
                    let room = available_width * (1.0 - cum / total);
                    if tw > room {
                        split_at = Some(k);
                        break;
                    }
                }
                cum += widths.get(mi).copied().unwrap_or(0.0);
            }
            match split_at {
                Some(k) => {
                    result.push(slice[..k].to_vec());
                    start += k;
                }
                None => {
                    result.push(slice.to_vec());
                    break;
                }
            }
        }
    }
    result
}

/// Plan how a system's left-anchored text markings (tempo / direction text)
/// fit within the right page margin, balancing three escalating remedies and
/// choosing the least-disruptive feasible one per overflow:
///
///   1. **Extra compression (in place).** The bars *before* the wide-text bar
///      are squeezed (down to [`MIN_HEAD_SCALE`] of natural width) so the bar
///      starts further left and its text clears the margin. This costs no
///      structural change, so it is always preferred when feasible — the
///      partition is left untouched and the justifier
///      (`reserve_text_demand`) performs the squeeze.
///   2. **Pull bars to the previous system.** When compression alone can't free
///      enough room, the minimal prefix of leading bars is moved onto the
///      previous line — provided that line can absorb them without exceeding
///      the compression cap. This shifts the wide-text bar earlier (more room)
///      with only a local reflow.
///   3. **System break before the bar.** When neither helps, the bar starts a
///      fresh system with the full width available.
///
/// The choice between (2) and (3) is by estimated layout shift (px of spacing
/// deviation introduced): pulling into a stretched previous line can even be
/// free, while breaking forces the truncated line to stretch.
///
/// Base case (no infinite reflow): a marking on the *first* bar of a system is
/// already as far left as possible; if its text is wider than a whole system it
/// simply overhangs and the renderer's right-margin clamp handles it — the bar
/// is never pushed onward again.
///
/// `widths` and `text_demands` are indexed by the measure indices stored in
/// `systems` (`text_demands[mi]` = rightward reach of the widest left-anchored
/// marking on measure `mi`, or `0`). Measures with zero demand never move, so
/// ordinary scores are returned untouched.
pub(crate) fn plan_text_overflow(
    systems: Vec<Vec<usize>>,
    widths: &[f64],
    text_demands: &[f64],
    available_width: f64,
) -> Vec<Vec<usize>> {
    if available_width <= 0.0 {
        return systems;
    }
    let width_of = |mi: usize| widths.get(mi).copied().unwrap_or(0.0);
    let demand_of = |mi: usize| text_demands.get(mi).copied().unwrap_or(0.0);

    let mut result: Vec<Vec<usize>> = Vec::new();
    for system in systems {
        // `pending` is the not-yet-finalized tail of the current original
        // system; we peel finished sub-systems off its front into `result`.
        let mut pending: Vec<usize> = system;
        loop {
            // Find the first non-first bar whose demand can't be met even by
            // compressing everything before it down to the floor.
            let mut split: Option<usize> = None;
            let mut head_natural = width_of(pending[0]);
            // `k` escapes the loop (`split = Some(k)`) and slices `pending[..k]`
            // afterwards, so it can't become a plain iterator.
            #[allow(clippy::needless_range_loop)]
            for k in 1..pending.len() {
                let mi = pending[k];
                let d = demand_of(mi);
                if d > 0.0 {
                    let compressible = d <= available_width
                        && available_width - d >= MIN_HEAD_SCALE * head_natural;
                    if !compressible {
                        split = Some(k);
                        break;
                    }
                }
                head_natural += width_of(mi);
            }

            let Some(k) = split else {
                // Everything left fits (via compression) — finalize.
                result.push(pending);
                break;
            };

            // Width facts for the two structural remedies.
            let head_nat: f64 = pending[..k].iter().map(|&mi| width_of(mi)).sum();
            let demand_k = demand_of(pending[k]);

            // Remedy 3 (break): the head becomes its own line and stretches to
            // fill the width; the cost is that introduced stretch.
            let cost_break = (available_width - head_nat).max(0.0);

            // Remedy 2 (pull): move the minimal whole-bar prefix of the head to
            // the previous line so the remaining head is compressible. Feasible
            // only when a previous line exists and can absorb the bars without
            // blowing past the compression cap.
            let cap = available_width * MAX_COMPRESSION_OVERFLOW;
            let mut pull: Option<(usize, f64)> = None; // (#bars moved, cost)
            if let Some(prev) = result.last() {
                let prev_nat: f64 = prev.iter().map(|&mi| width_of(mi)).sum();
                // Need remaining head ≤ this so demand_k fits by compression.
                let max_remaining_head = (available_width - demand_k) / MIN_HEAD_SCALE;
                let mut moved_nat = 0.0;
                let mut remaining = head_nat;
                for j in 1..=k {
                    let bar_nat = width_of(pending[j - 1]);
                    moved_nat += bar_nat;
                    remaining -= bar_nat;
                    if prev_nat + moved_nat > cap {
                        break; // previous line can't take this many — give up
                    }
                    if remaining <= max_remaining_head + 1e-6 {
                        // Cost: extra compression forced onto the previous line.
                        let cost_pull = (prev_nat + moved_nat - available_width).max(0.0);
                        pull = Some((j, cost_pull));
                        break;
                    }
                }
            }

            match pull {
                Some((j, cost_pull)) if cost_pull <= cost_break + 1e-6 => {
                    // Move `j` leading bars to the previous line, then re-run on
                    // the shortened pending system (the wide bar is now earlier
                    // and may fit by compression — or split again, terminating
                    // because `pending` shrank).
                    let moved: Vec<usize> = pending.drain(..j).collect();
                    if let Some(prev) = result.last_mut() {
                        prev.extend(moved);
                    }
                    // Loop continues with the shortened `pending`.
                }
                _ => {
                    // Break before the wide bar.
                    let head: Vec<usize> = pending.drain(..k).collect();
                    result.push(head);
                    // Loop continues with `pending` starting at the wide bar,
                    // which is now first-on-system: its demand is no longer
                    // checked (base case), so the remainder finalizes next pass.
                }
            }
        }
    }
    result
}
