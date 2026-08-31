//! Post-freeze vertical stacking resolver for *dependents*.
//!
//! See `docs/plans/horizontal-collision-avoidance.md`. A dependent reads the
//! keep-out field (substrate + connectors + **earlier-placed dependents**),
//! finds a clear spot, then re-inserts its own box so the next dependent clears
//! it. This module owns the "earlier-placed dependents" half of that field: the
//! mutual stacking between dependents on the same side of a staff.
//!
//! It is deliberately a **pure geometry pass** with no knowledge of glyphs,
//! optical centres, or render commands. Callers compute each dependent's
//! *preferred* resting box (the position substrate/connector avoidance already
//! chose) plus its per-kind clearances from the
//! [`crate::layout::placement_metrics::PlacementTable`], hand the set to
//! [`resolve_stacking`], and apply the returned vertical displacements before
//! emitting. This keeps the acyclic `request → freeze → place → rejoin`
//! invariant intact: stacking only ever pushes a dependent *outward* (away from
//! the staff), never reshapes substrate and never loops.
//!
//! Horizontal space is frozen by the time this runs, so the only freedom a
//! dependent has is the vertical (`Δy`) axis. `side_bearing` is therefore used
//! as the *horizontal overlap test* (do two dependents' ink columns come within
//! `side_bearing` of each other?), and `stack_gap` as the *vertical separation*
//! inserted when they do.

/// Which side of the staff a dependent stacks toward. `Below` grows downward
/// (increasing `y`); `Above` grows upward (decreasing `y`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StackSide {
    Above,
    Below,
}

/// One dependent's request to occupy vertical space, in engine pixels.
///
/// `y_top < y_bottom` (the canvas `y` axis grows downward). The box is the
/// dependent's *tight ink extent* at its preferred resting position; the
/// resolver returns the additional displacement needed to clear earlier boxes.
#[derive(Clone, Copy, Debug)]
pub struct StackBox {
    /// Left ink edge (px).
    pub x0: f64,
    /// Right ink edge (px).
    pub x1: f64,
    /// Preferred resting top edge (px), after substrate/connector avoidance.
    pub y_top: f64,
    /// Preferred resting bottom edge (px).
    pub y_bottom: f64,
    /// Vertical gap this dependent keeps above the dependent it stacks against
    /// (px). Sourced from `PlacementMetrics::stack_gap`.
    pub stack_gap: f64,
    /// Horizontal clearance below which two dependents count as sharing a column
    /// and must not vertically overlap (px). Sourced from
    /// `PlacementMetrics::side_bearing`.
    pub side_bearing: f64,
    /// Column order: lower sits closer to the staff and is placed first.
    /// Sourced from `PlacementMetrics::stack_rank`.
    pub stack_rank: i32,
    /// Which side of the staff this dependent grows toward.
    pub side: StackSide,
    /// A **pinned source node** (substrate or connector): it joins the keep-out
    /// field as an immovable obstacle but never receives a displacement. Movable
    /// dependents (`pinned == false`) stack *outward* to clear it. Its
    /// `stack_gap`/`stack_rank` are ignored (it is never the box being placed).
    pub pinned: bool,
}

impl StackBox {
    /// Distance-from-staff ordering scalar: smaller sorts *closer* to the staff
    /// (placed first). For `Below`, proximity rises with `y_top`; for `Above`,
    /// the closer box has the larger `y_bottom`, so we negate it.
    fn proximity(&self) -> f64 {
        match self.side {
            StackSide::Below => self.y_top,
            StackSide::Above => -self.y_bottom,
        }
    }
}

/// A box already committed to the field during the sweep.
#[derive(Clone, Copy)]
struct PlacedBox {
    x0: f64,
    x1: f64,
    y_top: f64,
    y_bottom: f64,
    side_bearing: f64,
    side: StackSide,
}

/// Resolve mutual vertical overlap between same-side dependents over a field of
/// pinned obstacles.
///
/// Returns one `dy` per input box, in **input order**: the signed vertical
/// displacement to add to that box's `y` so it clears every higher-priority box
/// whose ink column it shares. `dy >= 0` for [`StackSide::Below`] (pushed away
/// from the staff, downward) and `dy <= 0` for [`StackSide::Above`] (upward).
/// **Pinned boxes always return `0.0`** — they are immovable source nodes.
///
/// Pinned boxes (substrate + connectors) seed the keep-out field first, so every
/// movable dependent clears them. Movable boxes are then processed by
/// `(stack_rank, proximity-to-staff, input order)`, each one pushed just far
/// enough *outward* to clear all already-placed boxes it overlaps horizontally,
/// then re-inserted into the field. This is O(n²) in the number of boxes on a
/// staff, which is tiny in practice.
pub fn resolve_stacking(boxes: &[StackBox]) -> Vec<f64> {
    // Movable boxes, ordered closest-to-staff first.
    let mut order: Vec<usize> = (0..boxes.len()).filter(|&i| !boxes[i].pinned).collect();
    order.sort_by(|&a, &b| {
        let (ba, bb) = (&boxes[a], &boxes[b]);
        ba.stack_rank
            .cmp(&bb.stack_rank)
            .then(
                ba.proximity()
                    .partial_cmp(&bb.proximity())
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(a.cmp(&b))
    });

    let mut dy = vec![0.0_f64; boxes.len()];
    // Seed the field with every pinned obstacle at its fixed position.
    let mut placed: Vec<PlacedBox> = boxes
        .iter()
        .filter(|b| b.pinned)
        .map(|b| PlacedBox {
            x0: b.x0,
            x1: b.x1,
            y_top: b.y_top,
            y_bottom: b.y_bottom,
            side_bearing: b.side_bearing,
            side: b.side,
        })
        .collect();

    for &idx in &order {
        let b = boxes[idx];
        // Current box at its preferred position; we only ever move it outward.
        let mut shift = 0.0_f64;
        for p in &placed {
            if p.side != b.side || !horizontally_shares_column(&b, p) {
                continue;
            }
            // Total outward shift so the vertical gap to `p` is >= stack_gap.
            // `req` is the absolute displacement this single neighbour demands
            // (independent of `shift` so far); we keep the largest.
            let req = match b.side {
                StackSide::Below => (p.y_bottom + b.stack_gap) - b.y_top,
                StackSide::Above => (p.y_top - b.stack_gap) - b.y_bottom,
            };
            match b.side {
                // Below grows downward: a larger positive `req` means we must
                // push further down.
                StackSide::Below if req > shift => shift = req,
                // Above grows upward (negative dy): a more-negative `req` means
                // we must push further up.
                StackSide::Above if req < shift => shift = req,
                _ => {}
            }
        }
        dy[idx] = shift;
        placed.push(PlacedBox {
            x0: b.x0,
            x1: b.x1,
            y_top: b.y_top + shift,
            y_bottom: b.y_bottom + shift,
            side_bearing: b.side_bearing,
            side: b.side,
        });
    }

    dy
}

/// Two boxes share a column when the horizontal gap between their ink extents is
/// smaller than the larger of their side bearings (i.e. they are not clear of
/// each other horizontally, so they must not overlap vertically).
fn horizontally_shares_column(a: &StackBox, p: &PlacedBox) -> bool {
    let sb = a.side_bearing.max(p.side_bearing);
    // Clear if either box sits entirely to one side with at least `sb` gap.
    let a_left_of_p = a.x1 + sb <= p.x0;
    let p_left_of_a = p.x1 + sb <= a.x0;
    !(a_left_of_p || p_left_of_a)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn below(x0: f64, x1: f64, y: f64, stack_gap: f64, side_bearing: f64) -> StackBox {
        StackBox {
            x0,
            x1,
            y_top: y,
            y_bottom: y + 1.0,
            stack_gap,
            side_bearing,
            stack_rank: 0,
            side: StackSide::Below,
            pinned: false,
        }
    }

    fn above(x0: f64, x1: f64, y: f64, stack_gap: f64, side_bearing: f64) -> StackBox {
        StackBox {
            x0,
            x1,
            y_top: y,
            y_bottom: y + 1.0,
            stack_gap,
            side_bearing,
            stack_rank: 0,
            side: StackSide::Above,
            pinned: false,
        }
    }

    #[test]
    fn single_box_is_unmoved() {
        let dy = resolve_stacking(&[below(0.0, 5.0, 10.0, 1.0, 1.0)]);
        assert_eq!(dy, vec![0.0]);
    }

    #[test]
    fn horizontally_clear_boxes_dont_stack() {
        // Two below boxes at the same y but far apart horizontally: no shift.
        let boxes = [
            below(0.0, 5.0, 10.0, 1.0, 1.0),
            below(20.0, 25.0, 10.0, 1.0, 1.0),
        ];
        let dy = resolve_stacking(&boxes);
        assert_eq!(dy, vec![0.0, 0.0]);
    }

    #[test]
    fn overlapping_below_boxes_push_second_down() {
        // Same x column, same y. First (closer to staff) stays; second pushed
        // down so its top clears the first's bottom (y_bottom=11) by stack_gap=2.
        let boxes = [
            below(0.0, 5.0, 10.0, 2.0, 1.0),
            below(0.0, 5.0, 10.0, 2.0, 1.0),
        ];
        let dy = resolve_stacking(&boxes);
        assert_eq!(dy[0], 0.0);
        // second.y_top must become 11 + 2 = 13, was 10 → dy = 3.
        assert_eq!(dy[1], 3.0);
    }

    #[test]
    fn overlapping_above_boxes_push_second_up() {
        let boxes = [
            above(0.0, 5.0, 10.0, 2.0, 1.0),
            above(0.0, 5.0, 10.0, 2.0, 1.0),
        ];
        let dy = resolve_stacking(&boxes);
        // Closer-to-staff above box has larger y_bottom; both equal here so
        // input order breaks the tie. First placed at y_top=10,y_bottom=11.
        // Second must have y_bottom <= 10 - 2 = 8, was 11 → dy = -3.
        assert_eq!(dy[0], 0.0);
        assert_eq!(dy[1], -3.0);
    }

    #[test]
    fn side_bearing_widens_the_overlap_test() {
        // Boxes 6px apart horizontally (gap 1.0): clear with side_bearing 0.5,
        // shared with side_bearing 2.0.
        let clear = resolve_stacking(&[
            below(0.0, 5.0, 10.0, 2.0, 0.5),
            below(6.0, 11.0, 10.0, 2.0, 0.5),
        ]);
        assert_eq!(clear[1], 0.0);
        let shared = resolve_stacking(&[
            below(0.0, 5.0, 10.0, 2.0, 2.0),
            below(6.0, 11.0, 10.0, 2.0, 2.0),
        ]);
        assert_eq!(shared[1], 3.0);
    }

    #[test]
    fn stack_rank_orders_independently_of_input() {
        // Box 1 has lower rank → placed first even though it's second in input.
        let mut a = below(0.0, 5.0, 10.0, 2.0, 1.0);
        a.stack_rank = 5;
        let mut b = below(0.0, 5.0, 10.0, 2.0, 1.0);
        b.stack_rank = 0;
        let dy = resolve_stacking(&[a, b]);
        // b (rank 0) stays; a (rank 5) pushed down by 3.
        assert_eq!(dy[1], 0.0);
        assert_eq!(dy[0], 3.0);
    }

    #[test]
    fn three_box_cascade_stacks_outward() {
        let boxes = [
            below(0.0, 5.0, 10.0, 1.0, 1.0),
            below(0.0, 5.0, 10.0, 1.0, 1.0),
            below(0.0, 5.0, 10.0, 1.0, 1.0),
        ];
        let dy = resolve_stacking(&boxes);
        // 1st stays at 10. 2nd: top 11+1=12 → dy 2. 3rd: clears 2nd
        // (bottom 13) → top 14 → dy 4.
        assert_eq!(dy[0], 0.0);
        assert_eq!(dy[1], 2.0);
        assert_eq!(dy[2], 4.0);
    }

    #[test]
    fn opposite_sides_never_interact() {
        let boxes = [
            below(0.0, 5.0, 10.0, 2.0, 1.0),
            above(0.0, 5.0, 10.0, 2.0, 1.0),
        ];
        let dy = resolve_stacking(&boxes);
        assert_eq!(dy, vec![0.0, 0.0]);
    }

    #[test]
    fn pinned_box_is_never_moved() {
        // A pinned obstacle in the same column as a movable box: the pinned box
        // returns 0 and the movable one stacks outward past it.
        let mut obstacle = below(0.0, 5.0, 10.0, 2.0, 1.0);
        obstacle.pinned = true;
        let movable = below(0.0, 5.0, 10.0, 2.0, 1.0);
        let dy = resolve_stacking(&[obstacle, movable]);
        assert_eq!(dy[0], 0.0, "pinned obstacle must not move");
        // movable.y_top must clear obstacle.y_bottom (11) by stack_gap 2 → 13,
        // was 10 → dy 3.
        assert_eq!(dy[1], 3.0);
    }

    #[test]
    fn pinned_box_seeds_field_regardless_of_input_order() {
        // Pinned obstacle listed *after* the movable box still seeds the field,
        // so the movable box clears it — order-independent.
        let movable = below(0.0, 5.0, 10.0, 2.0, 1.0);
        let mut obstacle = below(0.0, 5.0, 10.0, 2.0, 1.0);
        obstacle.pinned = true;
        let dy = resolve_stacking(&[movable, obstacle]);
        assert_eq!(dy[0], 3.0, "movable must clear the pinned obstacle");
        assert_eq!(dy[1], 0.0, "pinned obstacle must not move");
    }

    #[test]
    fn movable_clears_pinned_then_stacks_on_movable() {
        // Pinned obstacle closest to staff, then two movable boxes stack
        // outward above it and each other.
        let mut obstacle = above(0.0, 5.0, 10.0, 1.0, 1.0); // y_bottom 11
        obstacle.pinned = true;
        let m1 = above(0.0, 5.0, 10.0, 1.0, 1.0);
        let m2 = above(0.0, 5.0, 10.0, 1.0, 1.0);
        let dy = resolve_stacking(&[obstacle, m1, m2]);
        assert_eq!(dy[0], 0.0);
        // m1 clears obstacle: y_bottom must be <= obstacle.y_top(10) - gap(1) = 9,
        // was 11 → dy -2.
        assert_eq!(dy[1], -2.0);
        // m2 clears m1 (now y_top 10-2=8): y_bottom <= 8 - 1 = 7, was 11 → dy -4.
        assert_eq!(dy[2], -4.0);
    }

    #[test]
    fn horizontally_clear_pinned_box_is_ignored() {
        // A pinned obstacle far to the side does not affect the movable box.
        let mut obstacle = below(20.0, 25.0, 10.0, 2.0, 1.0);
        obstacle.pinned = true;
        let movable = below(0.0, 5.0, 10.0, 2.0, 1.0);
        let dy = resolve_stacking(&[obstacle, movable]);
        assert_eq!(dy, vec![0.0, 0.0]);
    }
}
