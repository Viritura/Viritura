//! Slur side selection from voice, contour, register, and cross-staff context.

use super::participation::{obstacles_in_x_range, EventRenderInfo, SlurObstacle};
use super::tuning;

pub(super) struct SlurDirection {
    pub(super) curve_above: bool,
    pub(super) end_above: bool,
    pub(super) curve_dir: f64,
    pub(super) preserve_endpoint_positions: bool,
    pub(super) staff_gap_sp: f64,
    pub(super) is_cross_staff_geometric: bool,
}

/// Resolved direction for a slur, computed in a single pass.
///
/// The resolution order is:
///   1. **Explicit override**  — `slur.side` ("up" / "down") always wins.
///   2. **Mixed-stem default** — opposite stems → above
///   3. **Stem-opposite default** — single-stem-dir → opposite the stem.
///   4. **Contour-following auto-side** — when inner notes form a clear
///      mountain or valley, flip to the opposite side,
///      subject to *register guard* (don't flip a high mountain through
///      the staff) and *long-phrase suppression* (≥ `LONG_PHRASE_INNER_THRESHOLD`
///      inner notes keep the default).
///   5. **Tall-slur force-above** — span ≥ `TALL_SLUR_HS_THRESHOLD` half-spaces
///      with both endpoints well below the inner peak → force ABOVE (standard
///      engraving practice).
///   6. **Cross-staff default** — auto-side slurs whose endpoints sit on
///      different staves curve BELOW
///
/// `side_end` is taken from `slur.side_end` if explicit, otherwise mirrors
/// `curve_above` (most slurs are not S-curves).
pub(super) fn decide_curve_direction(
    slur: &crate::model::event::Slur,
    src: &EventRenderInfo,
    tgt: &EventRenderInfo,
    obstacles: &[SlurObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
    sp: f64,
) -> SlurDirection {
    let multi_voice = slur.side.is_none() && src.num_voices > 1 && src.voice_idx == tgt.voice_idx;
    let grace_slur = src.mag < 1.0 || tgt.mag < 1.0;
    let grace_collision_above = grace_slur
        && (src.y_pos <= -2.0
            || src.y_pos_bottom >= 10.0
            || tgt.y_pos <= -2.0
            || tgt.y_pos_bottom >= 10.0
            || (src.mag >= 1.0 && src.accidental_right_x.is_some())
            || (tgt.mag >= 1.0 && tgt.accidental_right_x.is_some()));
    let lower_grace_to_higher_target = src.mag < 1.0
        && tgt.mag >= 1.0
        && tgt.eff_staff_y + tgt.y_pos * sp * 0.5
            < src.eff_staff_y + src.y_pos * sp * 0.5 - 0.25 * sp;
    let base_above = match slur.side.as_deref() {
        Some("up") => true,
        Some("down") => false,
        _ if grace_collision_above => true,
        _ if grace_slur && multi_voice => src.voice_idx % 2 == 1,
        _ if lower_grace_to_higher_target => true,
        _ if grace_slur => false,
        _ if multi_voice => src.voice_idx % 2 == 1,
        _ if src.stem_up != tgt.stem_up => true,
        _ => !src.stem_up,
    };
    let contour_above = if slur.side.is_some() || multi_voice || grace_slur {
        base_above
    } else {
        contour_auto_side(
            src,
            tgt,
            obstacles,
            src_event_id,
            tgt_event_id,
            sp,
            base_above,
        )
    };
    let staff_gap_sp = (src.eff_staff_y - tgt.eff_staff_y).abs() / sp;
    let is_cross_staff_geometric = staff_gap_sp > 3.0 || src.staff_move != tgt.staff_move;
    let curve_above = if slur.side.is_none() && is_cross_staff_geometric {
        false
    } else {
        contour_above
    };
    let end_above = match slur.side_end.as_deref() {
        Some("up") => true,
        Some("down") => false,
        _ => curve_above,
    };
    let preserve_endpoint_positions = grace_slur
        || src.stem_up != tgt.stem_up
        || (slur.side.is_none() && !multi_voice && contour_above != base_above);
    SlurDirection {
        curve_above,
        end_above,
        curve_dir: if curve_above { -1.0 } else { 1.0 },
        preserve_endpoint_positions,
        staff_gap_sp,
        is_cross_staff_geometric,
    }
}

#[allow(clippy::too_many_arguments)] // Contour decision consumes endpoint identities, geometry, and fallback side.
/// Compute the contour-following auto-side decision.
///
/// Examines obstacles strictly between the slur endpoints (same voice only)
/// and detects a mountain (peak above outer notes) or valley (dip below).
/// Returns the flipped side when the contour is unambiguous AND the
/// register-guard / long-phrase / tall-slur exceptions don't apply.
pub(super) fn contour_auto_side(
    src: &EventRenderInfo,
    tgt: &EventRenderInfo,
    obstacles: &[SlurObstacle],
    src_event_id: &str,
    tgt_event_id: &str,
    sp: f64,
    base_above: bool,
) -> bool {
    let x_lo = src.x.min(tgt.x);
    let x_hi = src.x.max(tgt.x);
    let src_top = src.eff_staff_y + src.y_pos * sp * 0.5;
    let src_bottom = src.eff_staff_y + src.y_pos_bottom * sp * 0.5;
    let tgt_top = tgt.eff_staff_y + tgt.y_pos * sp * 0.5;
    let tgt_bottom = tgt.eff_staff_y + tgt.y_pos_bottom * sp * 0.5;
    let outer_top = src_top.min(tgt_top);
    let outer_bottom = src_bottom.max(tgt_bottom);
    let mut inner_top = f64::INFINITY;
    let mut inner_bottom = f64::NEG_INFINITY;
    let mut count = 0;
    for obstacle in obstacles_in_x_range(obstacles, x_lo, x_hi) {
        if obstacle.voice_idx == 0 || obstacle.voice_idx != src.voice_idx {
            continue;
        }
        if obstacle
            .event_id
            .as_ref()
            .is_some_and(|id| id == src_event_id || id == tgt_event_id)
        {
            continue;
        }
        let (Some(top), Some(bottom)) = (obstacle.notehead_y_top, obstacle.notehead_y_bottom)
        else {
            continue;
        };
        inner_top = inner_top.min(top);
        inner_bottom = inner_bottom.max(bottom);
        count += 1;
    }
    if count == 0 || count >= tuning::LONG_PHRASE_INNER_THRESHOLD {
        return base_above;
    }
    let threshold = 0.5 * sp;
    let mountain = inner_top < outer_top - threshold;
    let valley = inner_bottom > outer_bottom + threshold;
    let middle_y = src.eff_staff_y + 2.0 * sp;
    let mountain_active = mountain && (src_top + tgt_top) * 0.5 >= middle_y;
    let valley_active = valley && (src_bottom + tgt_bottom) * 0.5 <= middle_y;
    let span_hs = ((outer_bottom - inner_top).max(inner_bottom - outer_top)) / (sp * 0.5);
    let margin = tuning::MOUNTAIN_MARGIN_SP * sp;
    let tall_mountain = (outer_bottom - inner_top) / (sp * 0.5) >= tuning::TALL_SLUR_HS_THRESHOLD
        && outer_top > inner_top + margin;
    let tall_valley = (inner_bottom - outer_top) / (sp * 0.5) >= tuning::TALL_SLUR_HS_THRESHOLD
        && outer_bottom < inner_bottom - margin;
    if (tall_mountain || tall_valley) && span_hs >= tuning::TALL_SLUR_HS_THRESHOLD {
        true
    } else if mountain_active && !valley_active {
        false
    } else if valley_active && !mountain_active {
        true
    } else {
        base_above
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::slurs::participation::{endpoint_snapshot, EventRenderInfo};
    use crate::model::event::Slur;

    fn grace_endpoint(voice_idx: usize) -> EventRenderInfo {
        EventRenderInfo {
            endpoint: endpoint_snapshot(
                10.0, 4.0, 4.0, true, true, 6.0, 1, 60.0, voice_idx, 2, 0, 0.65, false, false, None,
            ),
        }
    }

    fn principal_endpoint(voice_idx: usize) -> EventRenderInfo {
        EventRenderInfo {
            endpoint: endpoint_snapshot(
                30.0, 4.0, 4.0, true, true, 9.0, 1, 60.0, voice_idx, 2, 0, 1.0, false, false, None,
            ),
        }
    }

    #[test]
    fn grace_slurs_curve_away_from_staff_in_multiple_voices() {
        let slur = Slur {
            target: "target".into(),
            side: None,
            side_end: None,
            line_type: None,
            start_note: None,
            end_note: None,
            shape: None,
        };
        let upper = decide_curve_direction(
            &slur,
            &grace_endpoint(1),
            &principal_endpoint(1),
            &[],
            "g1",
            "m1",
            12.0,
        );
        let lower = decide_curve_direction(
            &slur,
            &grace_endpoint(2),
            &principal_endpoint(2),
            &[],
            "g2",
            "m2",
            12.0,
        );

        assert!(
            upper.curve_above,
            "upper voice should curve away above the staff"
        );
        assert!(
            !lower.curve_above,
            "lower voice should curve away below the staff"
        );
    }
}
