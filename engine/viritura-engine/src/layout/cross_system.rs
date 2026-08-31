//! Shared plumbing for spanners that cross system / page breaks (and
//! stitched-horizon chunk seams).
//!
//! Several spanner kinds (ties, slurs, and — in future — hairpins, pedals,
//! ottavas) face the same post-pass problem: a per-system render pass only sees
//! one system's note/event map, so a spanner whose endpoints land on different
//! systems is dropped and must be re-emitted by a cross-system post-pass. Those
//! post-passes resolve a source endpoint to its target the same way, so that
//! resolution lives here once instead of being copy-pasted per kind.
//!
//! Only the genuinely identical resolution logic is shared. The per-kind
//! collectors (what an endpoint *is*) and emit geometry (curve vs. wedge vs.
//! dashed line) stay in each kind's own module — they are irreducibly
//! different, and forcing them into one generic would be ceremony.

/// Resolve a cross-system target among `candidates` (indices into the kind's
/// global event list), preferring — in order — the candidate on the **same
/// part AND staff**, then the **same part**, then **any** candidate. Returns
/// `None` only when `candidates` is empty.
///
/// This mirrors the in-system preference: a tie/slur target normally lives on
/// the source's own staff, but condensed-staff expansion duplicates an id
/// across the condensed staff and its ghost source staves, so the same-staff
/// candidate must win before falling back to a duplicate on another staff.
///
/// `part_of` / `staff_of` read the part / staff index of a candidate by its
/// index, so this stays generic over the kind's event type without borrowing
/// the whole slice.
pub(crate) fn prefer_target(
    candidates: &[usize],
    src_part: usize,
    src_staff: usize,
    part_of: impl Fn(usize) -> usize,
    staff_of: impl Fn(usize) -> usize,
) -> Option<usize> {
    candidates
        .iter()
        .copied()
        .find(|&i| part_of(i) == src_part && staff_of(i) == src_staff)
        .or_else(|| candidates.iter().copied().find(|&i| part_of(i) == src_part))
        .or_else(|| candidates.first().copied())
}

#[cfg(test)]
mod tests {
    use super::*;

    // (part, staff) for each candidate index.
    fn fixture() -> Vec<(usize, usize)> {
        vec![
            (0, 0), // 0: other part
            (1, 1), // 1: same part, other staff
            (1, 0), // 2: same part, same staff
            (1, 1), // 3: same part, other staff (duplicate of 1)
        ]
    }

    #[test]
    fn prefers_same_part_and_staff() {
        let locs = fixture();
        let got = prefer_target(&[0, 1, 2, 3], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, Some(2), "same (part,staff) candidate must win");
    }

    #[test]
    fn falls_back_to_same_part() {
        let locs = fixture();
        // No same-staff candidate present (drop index 2).
        let got = prefer_target(&[0, 1, 3], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, Some(1), "first same-part candidate when no same-staff");
    }

    #[test]
    fn falls_back_to_any() {
        let locs = fixture();
        // No same-part candidate at all (only the other-part index 0).
        let got = prefer_target(&[0], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, Some(0), "any candidate when no part match");
    }

    #[test]
    fn none_when_empty() {
        let locs = fixture();
        let got = prefer_target(&[], 1, 0, |i| locs[i].0, |i| locs[i].1);
        assert_eq!(got, None);
    }
}
