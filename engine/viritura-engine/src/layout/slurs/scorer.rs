use super::participation::{obstacles_in_x_range, SlurObstacle};
use super::tuning;

const SCORE_EPSILON: f64 = 1.0e-9;
const SAMPLE_COUNT: usize = 24;

/// Immutable geometry and obstacle context for deterministic slur candidate
/// generation. All distances are layout units; callers convert from spatia.
pub(super) struct SlurShapeInput<'a> {
    pub(super) x1: f64,
    pub(super) y1: f64,
    pub(super) x2: f64,
    pub(super) y2: f64,
    pub(super) curve_dir: f64,
    pub(super) cp_indent: f64,
    pub(super) heuristic_shoulder: f64,
    pub(super) heuristic_apex_shift: f64,
    pub(super) default_shoulder: f64,
    pub(super) shoulder_cap: f64,
    pub(super) staff_y: f64,
    pub(super) sp: f64,
    pub(super) obstacles: &'a [SlurObstacle],
    pub(super) source_event_id: &'a str,
    pub(super) target_event_id: &'a str,
    /// Manual handles are hard author intent, so automatic alternatives are
    /// not generated when any handle is present.
    pub(super) has_manual_shape: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SlurCandidateKind {
    Heuristic,
    Flatter,
    Taller,
    ApexLeft,
    ApexRight,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SlurCandidate {
    pub(super) kind: SlurCandidateKind,
    pub(super) shoulder: f64,
    pub(super) apex_shift: f64,
}

/// Named, independently inspectable quality terms. Lower is better.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct SlurScore {
    pub(super) obstacle_clearance_deficit: f64,
    pub(super) excess_height: f64,
    pub(super) asymmetry: f64,
    pub(super) endpoint_tangent: f64,
    pub(super) staff_line_interaction: f64,
    pub(super) curvature_smoothness: f64,
    pub(super) total: f64,
    pub(super) rejected: bool,
}

impl SlurScore {
    fn weighted_total(&self) -> f64 {
        self.obstacle_clearance_deficit * 100.0
            + self.excess_height * 2.0
            + self.asymmetry * 1.5
            + self.endpoint_tangent * 0.8
            + self.staff_line_interaction * 0.5
            + self.curvature_smoothness * 0.3
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ScoredSlurCandidate {
    pub(super) candidate: SlurCandidate,
    pub(super) score: SlurScore,
}

fn candidate_spine(input: &SlurShapeInput<'_>, candidate: SlurCandidate) -> [(f64, f64); 4] {
    let dx = input.x2 - input.x1;
    let dy = input.y2 - input.y1;
    let chord_len = dx.hypot(dy).max(0.01);
    let ux = dx / chord_len;
    let uy = dy / chord_len;
    let px = -uy * input.curve_dir;
    let py = ux * input.curve_dir;
    let max_shift = (0.5 - input.cp_indent - 0.02).max(0.0);
    let shift = candidate.apex_shift.clamp(-max_shift, max_shift);
    let f1 = input.cp_indent + shift;
    let f2 = 1.0 - input.cp_indent + shift;
    [
        (input.x1, input.y1),
        (
            input.x1 + ux * chord_len * f1 + px * candidate.shoulder,
            input.y1 + uy * chord_len * f1 + py * candidate.shoulder,
        ),
        (
            input.x1 + ux * chord_len * f2 + px * candidate.shoulder,
            input.y1 + uy * chord_len * f2 + py * candidate.shoulder,
        ),
        (input.x2, input.y2),
    ]
}

fn cubic_point(spine: &[(f64, f64); 4], t: f64) -> (f64, f64) {
    let mt = 1.0 - t;
    let b0 = mt * mt * mt;
    let b1 = 3.0 * mt * mt * t;
    let b2 = 3.0 * mt * t * t;
    let b3 = t * t * t;
    (
        b0 * spine[0].0 + b1 * spine[1].0 + b2 * spine[2].0 + b3 * spine[3].0,
        b0 * spine[0].1 + b1 * spine[1].1 + b2 * spine[2].1 + b3 * spine[3].1,
    )
}

fn y_at_x(spine: &[(f64, f64); 4], x: f64) -> f64 {
    let mut best = spine[0];
    let mut best_dx = (best.0 - x).abs();
    for index in 1..=SAMPLE_COUNT {
        let point = cubic_point(spine, index as f64 / SAMPLE_COUNT as f64);
        let distance = (point.0 - x).abs();
        if distance < best_dx {
            best = point;
            best_dx = distance;
        }
    }
    best.1
}

fn score_candidate(input: &SlurShapeInput<'_>, candidate: SlurCandidate) -> ScoredSlurCandidate {
    let spine = candidate_spine(input, candidate);
    let finite = spine
        .iter()
        .flat_map(|point| [point.0, point.1])
        .all(f64::is_finite)
        && candidate.shoulder.is_finite()
        && candidate.apex_shift.is_finite();
    if !finite
        || candidate.shoulder <= 0.0
        || candidate.shoulder > input.shoulder_cap + SCORE_EPSILON
    {
        return ScoredSlurCandidate {
            candidate,
            score: SlurScore {
                total: f64::INFINITY,
                rejected: true,
                ..SlurScore::default()
            },
        };
    }

    let (lo, hi) = if input.x1 <= input.x2 {
        (input.x1, input.x2)
    } else {
        (input.x2, input.x1)
    };
    let clearance = tuning::ENCOMPASS_CLEARANCE_SP * input.sp;
    let mut obstacle_clearance_deficit = 0.0;
    for obstacle in obstacles_in_x_range(input.obstacles, lo, hi) {
        if (obstacle.event_id.as_deref() == Some(input.source_event_id)
            || obstacle.event_id.as_deref() == Some(input.target_event_id))
            && !obstacle.is_tie
        {
            continue;
        }
        let curve_y = y_at_x(&spine, obstacle.x);
        let deficit = if input.curve_dir < 0.0 {
            (curve_y - (obstacle.y_top - clearance)).max(0.0)
        } else {
            ((obstacle.y_bottom + clearance) - curve_y).max(0.0)
        };
        obstacle_clearance_deficit += (deficit / input.sp).powi(2);
    }

    let excess_height = ((candidate.shoulder - input.default_shoulder).max(0.0) / input.sp).powi(2);
    let asymmetry = candidate.apex_shift.abs().powi(2);
    let left_tangent = (spine[1].1 - spine[0].1).abs();
    let right_tangent = (spine[3].1 - spine[2].1).abs();
    let endpoint_tangent = ((left_tangent - right_tangent).abs() / input.sp).powi(2);
    let apex = cubic_point(&spine, 0.5);
    let apex_half_spaces = (apex.1 - input.staff_y) / (input.sp * 0.5);
    let nearest_line = (apex_half_spaces / 2.0).round() * 2.0;
    let line_distance = (apex_half_spaces - nearest_line).abs() * 0.5;
    let staff_line_interaction = ((0.2 - line_distance).max(0.0) / 0.2).powi(2);
    let left_len = (spine[1].0 - spine[0].0).hypot(spine[1].1 - spine[0].1);
    let right_len = (spine[3].0 - spine[2].0).hypot(spine[3].1 - spine[2].1);
    let curvature_smoothness =
        ((left_len - right_len).abs() / left_len.max(right_len).max(0.01)).powi(2);

    let mut score = SlurScore {
        obstacle_clearance_deficit,
        excess_height,
        asymmetry,
        endpoint_tangent,
        staff_line_interaction,
        curvature_smoothness,
        total: 0.0,
        rejected: false,
    };
    score.total = score.weighted_total();
    ScoredSlurCandidate { candidate, score }
}

pub(super) fn generate_slur_candidates(input: &SlurShapeInput<'_>) -> Vec<SlurCandidate> {
    let heuristic = SlurCandidate {
        kind: SlurCandidateKind::Heuristic,
        shoulder: input.heuristic_shoulder.clamp(0.001, input.shoulder_cap),
        apex_shift: input.heuristic_apex_shift,
    };
    if input.has_manual_shape {
        return vec![heuristic];
    }

    let base = input.heuristic_shoulder;
    let shift_delta = 0.08;
    vec![
        heuristic,
        SlurCandidate {
            kind: SlurCandidateKind::Flatter,
            shoulder: (base * 0.9).clamp(0.001, input.shoulder_cap),
            apex_shift: input.heuristic_apex_shift,
        },
        SlurCandidate {
            kind: SlurCandidateKind::Taller,
            shoulder: (base * 1.1).clamp(0.001, input.shoulder_cap),
            apex_shift: input.heuristic_apex_shift,
        },
        SlurCandidate {
            kind: SlurCandidateKind::ApexLeft,
            shoulder: base.clamp(0.001, input.shoulder_cap),
            apex_shift: input.heuristic_apex_shift - shift_delta,
        },
        SlurCandidate {
            kind: SlurCandidateKind::ApexRight,
            shoulder: base.clamp(0.001, input.shoulder_cap),
            apex_shift: input.heuristic_apex_shift + shift_delta,
        },
    ]
}

/// Generate, score, and deterministically select a bounded candidate family.
/// Vector order is the final tie-break, so the current heuristic wins exact
/// ties and preserves established output when alternatives add no value.
pub(super) fn select_slur_candidate(input: &SlurShapeInput<'_>) -> ScoredSlurCandidate {
    generate_slur_candidates(input)
        .into_iter()
        .map(|candidate| score_candidate(input, candidate))
        .min_by(|left, right| {
            let rejected_order = left.score.rejected.cmp(&right.score.rejected);
            if rejected_order != std::cmp::Ordering::Equal {
                return rejected_order;
            }
            let score_order = left.score.total.total_cmp(&right.score.total);
            if score_order == std::cmp::Ordering::Equal
                || (left.score.total - right.score.total).abs() <= SCORE_EPSILON
            {
                candidate_rank(left.candidate.kind).cmp(&candidate_rank(right.candidate.kind))
            } else {
                score_order
            }
        })
        .expect("candidate generator always returns the heuristic")
}

fn candidate_rank(kind: SlurCandidateKind) -> u8 {
    match kind {
        SlurCandidateKind::Heuristic => 0,
        SlurCandidateKind::Flatter => 1,
        SlurCandidateKind::Taller => 2,
        SlurCandidateKind::ApexLeft => 3,
        SlurCandidateKind::ApexRight => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input<'a>(obstacles: &'a [SlurObstacle], manual: bool) -> SlurShapeInput<'a> {
        SlurShapeInput {
            x1: 0.0,
            y1: 100.0,
            x2: 120.0,
            y2: 100.0,
            curve_dir: -1.0,
            cp_indent: 0.25,
            heuristic_shoulder: 20.0,
            heuristic_apex_shift: 0.0,
            default_shoulder: 20.0,
            shoulder_cap: 40.0,
            staff_y: 100.0,
            sp: 10.0,
            obstacles,
            source_event_id: "source",
            target_event_id: "target",
            has_manual_shape: manual,
        }
    }

    #[test]
    fn candidate_family_is_bounded_and_deterministic() {
        let candidates = generate_slur_candidates(&input(&[], false));
        assert_eq!(candidates.len(), 5);
        assert_eq!(candidates[0].kind, SlurCandidateKind::Heuristic);
        assert_eq!(candidates[4].kind, SlurCandidateKind::ApexRight);
    }

    #[test]
    fn manual_shape_is_a_hard_constraint() {
        let candidates = generate_slur_candidates(&input(&[], true));
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].kind, SlurCandidateKind::Heuristic);
    }

    #[test]
    fn obstacle_deficit_dominates_shape_economy() {
        let obstacles = [SlurObstacle {
            event_id: Some("interior".to_string()),
            voice_idx: 1,
            x: 60.0,
            y_top: 90.0,
            y_bottom: 94.0,
            notehead_y_top: Some(90.0),
            notehead_y_bottom: Some(94.0),
            is_tie: false,
            is_articulation: false,
        }];
        let selected = select_slur_candidate(&input(&obstacles, false));
        assert_ne!(selected.candidate.kind, SlurCandidateKind::Flatter);
        assert!(selected.score.obstacle_clearance_deficit <= 1.0e-9);
    }

    #[test]
    fn score_terms_are_finite_and_named() {
        let scored = select_slur_candidate(&input(&[], false));
        assert!(scored.score.total.is_finite());
        assert!(scored.score.obstacle_clearance_deficit.is_finite());
        assert!(scored.score.excess_height.is_finite());
        assert!(scored.score.asymmetry.is_finite());
        assert!(scored.score.endpoint_tangent.is_finite());
        assert!(scored.score.staff_line_interaction.is_finite());
        assert!(scored.score.curvature_smoothness.is_finite());
        assert!(!scored.score.rejected);
    }

    #[test]
    #[ignore = "diagnostic benchmark for slur-heavy fixtures"]
    fn scorer_slur_heavy_benchmark() {
        let obstacles: Vec<SlurObstacle> = (0..500)
            .map(|index| SlurObstacle {
                event_id: Some(format!("event-{index}")),
                voice_idx: 1,
                x: index as f64 * 0.2,
                y_top: 86.0 + (index % 5) as f64,
                y_bottom: 92.0 + (index % 5) as f64,
                notehead_y_top: Some(86.0),
                notehead_y_bottom: Some(92.0),
                is_tie: false,
                is_articulation: false,
            })
            .collect();
        let start = std::time::Instant::now();
        for _ in 0..500 {
            let selected = select_slur_candidate(&input(&obstacles, false));
            std::hint::black_box(selected);
        }
        eprintln!("500 slur candidate selections: {:?}", start.elapsed());
    }
}
