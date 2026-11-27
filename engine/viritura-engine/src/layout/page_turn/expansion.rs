//! Structural navigation analysis for page-turn safety.
//!
//! A page turn is only "free" when the player crosses the page boundary in a
//! single, uninterrupted forward reading. Repeats, voltas (alternate endings),
//! and jumps (D.C./D.S./al coda) break that assumption: at such a boundary the
//! music the player encounters next is not simply the next written measure, or
//! the same boundary is traversed on multiple passes with different content.
//!
//! Boundaries beside navigation symbols are conservatively flagged. Repeat
//! playback expansion also feeds `navigation_timing`, which checks rest time
//! at every crossing of an intervening written boundary.

use crate::model::measure::GlobalMeasure;

/// Returns, for each measure boundary `b` (between measure `b` and `b+1`,
/// `0 <= b < n-1`), whether crossing it involves repeat/volta/jump structure
/// and is therefore an unsafe place for a physical page turn.
pub fn structural_boundary_flags(measures: &[GlobalMeasure]) -> Vec<bool> {
    if measures.len() < 2 {
        return Vec::new();
    }
    let mut flags = vec![false; measures.len() - 1];
    for b in 0..flags.len() {
        let left = &measures[b];
        let right = &measures[b + 1];
        let complex = left.repeat_end.is_some()
            || right.repeat_start.is_some()
            || left.ending.is_some()
            || right.ending.is_some()
            || left.jump.is_some()
            || right.jump.is_some()
            || right.segno.is_some()
            || left.fine.is_some();
        flags[b] = complex;
    }
    flags
}

/// Returns, for each measure index `i`, whether that measure cannot be merged
/// into a preceding multimeasure rest — i.e. it *starts a new* multimeasure
/// rest group. Standard engraving interrupts a multimeasure rest at a rehearsal
/// mark, a time- or key-signature change, a tempo change, system text, a
/// non-normal barline (double/final), or any repeat/volta/jump/segno/coda/fine
/// structure. Index 0 is always a break (nothing precedes it).
///
/// Triggers split by where they sit relative to the bar:
/// - **Start-of-measure** properties (time/key/tempo/system text/rehearsal
///   mark/repeat start/segno/coda/volta start) make *this* measure a new group.
/// - **End-of-measure** properties (a trailing `barline`, repeat end, fine, or
///   jump, or system text) belong to the bar that *carries* them but only close
///   the group *after* it — so they make the *following* measure a new group,
///   not the one they sit on. MNX `measure.barline` is the right-hand barline
///   of the measure; attributing it to that same index would drop the bar
///   owning the double/final barline from the preceding rest group and
///   undercount the courtesy "N bars rest" hint by one.
///
/// Used by the page-turn courtesy hint so it reports only the *first* rest
/// group at the top of the incoming page rather than summing every consecutive
/// resting bar across separate multimeasure rests.
pub fn multimeasure_rest_break_flags(measures: &[GlobalMeasure]) -> Vec<bool> {
    measures
        .iter()
        .enumerate()
        .map(|(i, m)| {
            // Start-of-measure structure on this bar opens a new group here.
            let starts_here = i == 0
                || m.caesura.is_some()
                || m.time.is_some()
                || m.key.is_some()
                || m.tempos.as_ref().is_some_and(|t| !t.is_empty())
                || m.system_text().is_some_and(|texts| !texts.is_empty())
                || m.rehearsal_mark().is_some()
                || m.repeat_start.is_some()
                || m.ending.is_some()
                || m.segno.is_some()
                || m.coda().is_some();
            // End-of-measure structure on the PREVIOUS bar closes the group
            // after that bar, so this bar opens the next one.
            let ends_prev = i > 0 && {
                let prev = &measures[i - 1];
                prev.barline.is_some()
                    || prev.caesura.is_some()
                    || prev.system_text().is_some_and(|texts| {
                        texts.iter().any(|text| text.position.beats().abs() > 1e-9)
                    })
                    || prev.repeat_end.is_some()
                    || prev.fine.is_some()
                    || prev.jump.is_some()
            };
            starts_here || ends_prev
        })
        .collect()
}

/// Expand written measures into repeat and volta playback order. Jump routing
/// is applied separately to this initial order.
///
/// Each entry is a written measure index, possibly repeated across passes.
/// Voltas: a measure inside an `ending` whose `numbers` excludes the current
/// pass is skipped on that pass.
pub fn expand_playback_order(measures: &[GlobalMeasure]) -> Result<Vec<usize>, String> {
    let n = measures.len();
    let mut order = Vec::new();
    let mut i = 0usize;
    // Tracks how many times we've started the segment that ends at each
    // repeat-end, so we know which volta pass we're on.
    let mut pass_at: Vec<u32> = vec![0; n];
    // Explicit repeat starts remain active while nested sections are played.
    // End-only repeats use the most recently completed start or the implicit
    // beginning of the score.
    let mut segment_starts = Vec::new();
    let mut last_segment_start = 0usize;
    // Guard against pathological infinite loops on malformed input.
    let mut budget = 100_000usize;

    while i < n {
        if budget == 0 {
            return Err("repeat playback exceeds the traversal limit".into());
        }
        budget -= 1;

        let m = &measures[i];
        if m.repeat_start.is_some() && segment_starts.last() != Some(&i) {
            segment_starts.push(i);
        }
        let segment_start = segment_starts.last().copied().unwrap_or(last_segment_start);

        // Volta handling: if this measure is inside an ending that does not
        // apply to the current pass, skip the whole ending span.
        if let Some(ending) = &m.ending {
            let current_pass = pass_at[segment_start] + 1;
            if !ending.numbers.contains(&current_pass) {
                let skipped_end = (i + ending.duration.max(1) as usize).min(n);
                for skipped_measure in &measures[i..skipped_end] {
                    if skipped_measure.repeat_end.is_some() {
                        if let Some(start) = segment_starts.pop() {
                            last_segment_start = start;
                        }
                    }
                }
                i = skipped_end;
                continue;
            }
        }

        order.push(i);

        if let Some(re) = &m.repeat_end {
            let times = re.times.unwrap_or(2).max(1);
            pass_at[segment_start] += 1;
            if pass_at[segment_start] < times {
                for nested in segment_start + 1..=i {
                    if measures[nested].repeat_start.is_some() {
                        pass_at[nested] = 0;
                    }
                }
                i = segment_start;
                continue;
            }
            if segment_starts.last() == Some(&segment_start) {
                segment_starts.pop();
            }
            last_segment_start = segment_start;
        }
        i += 1;
    }
    Ok(order)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::barline::{Barline, BarlineType};
    use crate::model::repeat::{Ending, RepeatEnd, RepeatStart};

    fn plain(n: usize) -> Vec<GlobalMeasure> {
        (0..n).map(|_| empty_measure()).collect()
    }

    fn empty_measure() -> GlobalMeasure {
        GlobalMeasure {
            caesura: None,
            id: None,
            number: None,
            time: None,
            key: None,
            barline: None,
            repeat_start: None,
            repeat_end: None,
            ending: None,
            tempos: None,
            segno: None,
            fine: None,
            jump: None,
            coda: None,
            extensions: None,
        }
    }

    #[test]
    fn test_no_structure_all_safe() {
        let measures = plain(4);
        let flags = structural_boundary_flags(&measures);
        assert_eq!(flags, vec![false, false, false]);
    }

    #[test]
    fn system_text_isolated_from_page_turn_mmr_groups() {
        let score = crate::parse::parse_mnx(
            r#"{
                "mnx": {"version": 1},
                "global": {"measures": [
                    {"id": "m0"},
                    {"id": "m1"},
                    {"id": "m2", "_x": {"viritura": {"systemText": [{
                        "id": "note",
                        "text": [{"text": "Footnote"}],
                        "position": {"fraction": [1, 2]},
                        "placement": "above"
                    }]}}},
                    {"id": "m3"},
                    {"id": "m4"}
                ]},
                "parts": []
            }"#,
        )
        .unwrap();
        assert_eq!(
            multimeasure_rest_break_flags(&score.global.measures),
            vec![true, false, true, true, false]
        );
    }

    #[test]
    fn test_repeat_end_flags_boundary() {
        let mut measures = plain(4);
        measures[1].repeat_end = Some(RepeatEnd { times: None });
        let flags = structural_boundary_flags(&measures);
        // Boundary between measure 1 and 2 is flagged.
        assert_eq!(flags, vec![false, true, false]);
    }

    #[test]
    fn test_repeat_start_flags_preceding_boundary() {
        let mut measures = plain(4);
        measures[2].repeat_start = Some(RepeatStart { times: None });
        let flags = structural_boundary_flags(&measures);
        // Boundary between measure 1 and 2 (right has repeat_start) is flagged.
        assert_eq!(flags, vec![false, true, false]);
    }

    #[test]
    fn test_expand_plain_is_identity() {
        let measures = plain(3);
        assert_eq!(expand_playback_order(&measures).unwrap(), vec![0, 1, 2]);
    }

    #[test]
    fn test_expand_simple_repeat() {
        // measures 0..3, repeat from 1 to 2 played twice.
        let mut measures = plain(4);
        measures[1].repeat_start = Some(RepeatStart { times: None });
        measures[2].repeat_end = Some(RepeatEnd { times: Some(2) });
        // Pass: 0,1,2, (repeat back) 1,2, then 3.
        assert_eq!(
            expand_playback_order(&measures).unwrap(),
            vec![0, 1, 2, 1, 2, 3]
        );
    }

    #[test]
    fn test_expand_nested_repeats_restarts_inner_pass_for_each_outer_pass() {
        let mut measures = plain(5);
        measures[0].repeat_start = Some(RepeatStart { times: None });
        measures[2].repeat_start = Some(RepeatStart { times: None });
        measures[3].repeat_end = Some(RepeatEnd { times: None });
        measures[4].repeat_end = Some(RepeatEnd { times: None });
        assert_eq!(
            expand_playback_order(&measures).unwrap(),
            vec![0, 1, 2, 3, 2, 3, 4, 0, 1, 2, 3, 2, 3, 4]
        );
    }

    #[test]
    fn test_expand_volta() {
        // 0, [1: ending1, 2: repeat_end], [3: ending2], 4
        let mut measures = plain(5);
        measures[0].repeat_start = Some(RepeatStart { times: None });
        measures[1].ending = Some(Ending {
            duration: 1,
            numbers: vec![1],
            open: None,
            color: None,
        });
        measures[1].repeat_end = Some(RepeatEnd { times: Some(2) });
        measures[2].ending = Some(Ending {
            duration: 1,
            numbers: vec![2],
            open: None,
            color: None,
        });
        // Pass 1: 0,1(end1,repeat back to 0). Pass 2: 0, skip ending1 (m1),
        // play ending2 (m2), then 3,4.
        assert_eq!(
            expand_playback_order(&measures).unwrap(),
            vec![0, 1, 0, 2, 3, 4]
        );
    }

    #[test]
    fn test_trailing_barline_breaks_after_its_own_measure() {
        // Six bars; a double barline ends measure 2 (its right-hand barline).
        // The rendered first multimeasure rest spans bars 0..=2 (3 bars,
        // including the bar that owns the trailing double barline). The hint's
        // break flags must therefore open the new group at measure 3, NOT at
        // measure 2 — attributing the trailing barline to its own index would
        // drop bar 2 and undercount the courtesy hint by one.
        let mut measures = plain(6);
        measures[2].barline = Some(Barline {
            barline_type: BarlineType::Double,
        });
        let flags = multimeasure_rest_break_flags(&measures);
        assert_eq!(
            flags,
            vec![true, false, false, true, false, false],
            "a trailing barline on measure 2 must break BEFORE measure 3, not \
             before measure 2 — flagging its own index undercounts the hint"
        );
    }
}
