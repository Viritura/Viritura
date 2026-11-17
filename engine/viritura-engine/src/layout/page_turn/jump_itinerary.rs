//! Location-aware jump routing over the initial repeat itinerary.

use super::analysis::MeasureProfile;
use crate::model::clef::RhythmicPosition;
use crate::model::direction::JumpType;
use crate::model::measure::GlobalMeasure;

const EPS: f64 = 1e-9;
const MAX_SPANS: usize = 100_000;

#[derive(Clone, Copy, Debug, PartialEq)]
struct Location {
    measure: usize,
    beat: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct PlayedSpan {
    pub measure: usize,
    pub start: f64,
    pub end: f64,
}

fn location(
    index: usize,
    position: &RhythmicPosition,
    profiles: &[MeasureProfile],
) -> Result<Location, String> {
    let beat = position.beats();
    let length = profiles[index].total_beats;
    if position.fraction.1 == 0 || !beat.is_finite() || beat > length + EPS {
        return Err(format!("navigation location outside measure {}", index + 1));
    }
    Ok(Location {
        measure: index,
        beat: beat.min(length),
    })
}

fn markers(
    measures: &[GlobalMeasure],
    profiles: &[MeasureProfile],
    marker: impl Fn(&GlobalMeasure) -> Option<&RhythmicPosition>,
) -> Result<Vec<Location>, String> {
    let mut found = Vec::new();
    for (index, measure) in measures.iter().enumerate() {
        if let Some(position) = marker(measure) {
            found.push(location(index, position, profiles)?);
        }
    }
    Ok(found)
}

fn required(markers: &[Location], name: &str) -> Result<Location, String> {
    if let [marker] = markers {
        Ok(*marker)
    } else {
        Err(format!(
            "navigation requires exactly one {name} destination"
        ))
    }
}

/// Follow jumps after their last normal repeat pass; replay does not repeat
/// barline repeats, while a coda resumes the initial repeat itinerary.
pub(super) fn compile(
    measures: &[GlobalMeasure],
    profiles: &[MeasureProfile],
    initial_order: Vec<usize>,
) -> Result<Vec<PlayedSpan>, String> {
    if !measures.iter().any(|measure| measure.jump.is_some()) {
        return Ok(initial_order
            .into_iter()
            .map(|measure| PlayedSpan {
                measure,
                start: 0.0,
                end: profiles[measure].total_beats,
            })
            .collect());
    }
    let segno = markers(measures, profiles, |m| {
        m.segno.as_ref().map(|marker| &marker.location)
    })?;
    let coda = markers(measures, profiles, |m| {
        m.coda.as_ref().map(|marker| &marker.location)
    })?;
    let fine = markers(measures, profiles, |m| {
        m.fine.as_ref().map(|marker| &marker.location)
    })?;
    for (index, measure) in measures.iter().enumerate() {
        if let Some(jump) = &measure.jump {
            location(index, &jump.location, profiles)?;
            match jump.jump_type {
                JumpType::Segno | JumpType::DsAlFine | JumpType::DsAlCoda => {
                    required(&segno, "segno")?;
                }
                _ => {}
            }
            match jump.jump_type {
                JumpType::DcAlFine | JumpType::DsAlFine => {
                    required(&fine, "fine")?;
                }
                JumpType::DcAlCoda | JumpType::DsAlCoda | JumpType::ToCoda => {
                    required(&coda, "coda")?;
                }
                _ => {}
            }
            if matches!(jump.jump_type, JumpType::DcAlCoda | JumpType::DsAlCoda)
                && !measures.iter().any(|m| {
                    m.jump
                        .as_ref()
                        .is_some_and(|j| j.jump_type == JumpType::ToCoda)
                })
            {
                return Err("al Coda requires a To Coda instruction".into());
            }
        }
    }

    let mut order = initial_order;
    let mut result = Vec::new();
    let mut taken = vec![false; measures.len()];
    let mut order_index = 0;
    let mut cursor = Location {
        measure: order.first().copied().unwrap_or(measures.len()),
        beat: 0.0,
    };
    let mut replay = false;
    let mut fine_armed = false;
    let mut coda_armed = false;
    while cursor.measure < measures.len() && (replay || order_index < order.len()) {
        if result.len() >= MAX_SPANS {
            return Err("navigation exceeds the traversal limit".into());
        }
        let index = cursor.measure;
        let measure = &measures[index];
        let length = profiles[index].total_beats;
        let jump = measure.jump.as_ref();
        let jump_beat = jump.map_or(f64::INFINITY, |j| j.location.beats());
        let jump_active = jump.is_some_and(|j| {
            !taken[index]
                && jump_beat >= cursor.beat - EPS
                && (j.jump_type != JumpType::ToCoda || coda_armed)
                && (replay || order.iter().rposition(|&i| i == index) == Some(order_index))
        });
        let fine_beat = fine
            .first()
            .copied()
            .filter(|f| fine_armed && f.measure == index && f.beat >= cursor.beat - EPS)
            .map_or(f64::INFINITY, |f| f.beat);
        let end = length
            .min(fine_beat)
            .min(if jump_active { jump_beat } else { length });
        // Retain zero-length spans: a jump at a barline still crosses pages.
        result.push(PlayedSpan {
            measure: index,
            start: cursor.beat,
            end,
        });
        if fine_armed && fine_beat <= end + EPS {
            fine_armed = false;
            break;
        }
        if jump_active && jump_beat <= end + EPS {
            let jump_type = &jump.expect("active jump").jump_type;
            taken[index] = true;
            if *jump_type == JumpType::ToCoda {
                coda_armed = false;
                cursor = required(&coda, "coda")?;
                if let Some(pos) = order.iter().position(|&i| i == cursor.measure) {
                    order_index = pos;
                } else {
                    let next_repeat = (cursor.measure + 1..measures.len())
                        .find(|&i| measures[i].repeat_start.is_some() && order.contains(&i));
                    let end = next_repeat.unwrap_or(measures.len());
                    let mut prefix: Vec<_> = (cursor.measure..end).collect();
                    if let Some(next) = next_repeat {
                        let pos = order.iter().position(|&i| i == next).expect("present");
                        prefix.extend_from_slice(&order[pos..]);
                    }
                    order = prefix;
                    order_index = 0;
                }
                replay = false;
            } else {
                replay = true;
                fine_armed = matches!(jump_type, JumpType::DcAlFine | JumpType::DsAlFine);
                coda_armed = matches!(jump_type, JumpType::DcAlCoda | JumpType::DsAlCoda);
                cursor = if matches!(
                    jump_type,
                    JumpType::Segno | JumpType::DsAlFine | JumpType::DsAlCoda
                ) {
                    required(&segno, "segno")?
                } else {
                    Location {
                        measure: 0,
                        beat: 0.0,
                    }
                };
            }
            continue;
        }
        order_index += 1;
        cursor = Location {
            measure: if replay {
                index + 1
            } else {
                order.get(order_index).copied().unwrap_or(measures.len())
            },
            beat: 0.0,
        };
    }
    if fine_armed || coda_armed {
        return Err("armed Fine or To Coda is unreachable".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::page_turn::expansion::expand_playback_order;
    use serde_json::{json, Value};

    fn route(global: Vec<Value>) -> Result<Vec<PlayedSpan>, String> {
        let score = crate::parse::parse_mnx(
            &json!({"mnx": {"version": 1}, "global": {"measures": global}, "parts": []})
                .to_string(),
        )
        .unwrap();
        let measures = &score.global.measures;
        let profile = MeasureProfile {
            total_beats: 4.0,
            leading_rest_beats: 0.0,
            trailing_rest_beats: 0.0,
            is_full_rest: false,
            has_fermata: false,
            has_caesura: false,
        };
        compile(
            measures,
            &vec![profile; measures.len()],
            expand_playback_order(measures)?,
        )
    }

    fn indices(spans: &[PlayedSpan]) -> Vec<usize> {
        spans.iter().map(|span| span.measure).collect()
    }

    #[test]
    fn plain_jumps_do_not_arm_fine() {
        for jump in ["dc", "segno"] {
            let spans = route(vec![
                json!({"segno": {"location": {"fraction": [0, 1]}}}),
                json!({"fine": {"location": {"fraction": [1, 1]}}}),
                json!({"jump": {"type": jump, "location": {"fraction": [1, 1]}}}),
            ])
            .unwrap();
            assert_eq!(indices(&spans), vec![0, 1, 2, 0, 1, 2]);
        }
    }

    #[test]
    fn fine_jumps_use_marker_locations_and_stop_on_replay() {
        for jump in ["dcAlFine", "dsAlFine"] {
            let spans = route(vec![
                json!({}),
                json!({"segno": {"location": {"fraction": [1, 4]}}}),
                json!({"fine": {"location": {"fraction": [1, 2]}}}),
                json!({"jump": {"type": jump, "location": {"fraction": [3, 4]}}}),
            ])
            .unwrap();
            assert_eq!(spans[3].end, 3.0);
            assert_eq!(spans.last().unwrap().end, 2.0);
            if jump == "dsAlFine" {
                assert_eq!(indices(&spans), vec![0, 1, 2, 3, 1, 2]);
                assert_eq!(spans[4].start, 1.0);
            } else {
                assert_eq!(indices(&spans), vec![0, 1, 2, 3, 0, 1, 2]);
            }
        }
    }

    #[test]
    fn coda_jumps_arm_to_coda_and_resume_later_repeats() {
        for jump in ["dcAlCoda", "dsAlCoda"] {
            let spans = route(vec![
                json!({}),
                json!({"segno": {"location": {"fraction": [0, 1]}}}),
                json!({"jump": {"type": "toCoda", "location": {"fraction": [1, 1]}}}),
                json!({}),
                json!({"jump": {"type": jump, "location": {"fraction": [1, 1]}}}),
                json!({}),
                json!({"coda": {"location": {"fraction": [1, 4]}}}),
                json!({"repeatStart": {}}),
                json!({"repeatEnd": {}}),
                json!({}),
            ])
            .unwrap();
            let expected = if jump == "dcAlCoda" {
                vec![0, 1, 2, 3, 4, 0, 1, 2, 6, 7, 8, 7, 8, 9]
            } else {
                vec![0, 1, 2, 3, 4, 1, 2, 6, 7, 8, 7, 8, 9]
            };
            assert_eq!(indices(&spans), expected);
            assert_eq!(
                spans.iter().find(|span| span.measure == 6).unwrap().start,
                1.0
            );
        }
    }

    #[test]
    fn jump_waits_until_last_repeat_pass() {
        let spans = route(vec![
            json!({"repeatStart": {}, "fine": {"location": {"fraction": [1, 1]}}}),
            json!({"repeatEnd": {}, "jump": {"type": "dcAlFine", "location": {"fraction": [1, 1]}}}),
        ])
        .unwrap();
        assert_eq!(indices(&spans), vec![0, 1, 0, 1, 0]);
    }

    #[test]
    fn jump_after_many_repeat_passes_is_not_truncated() {
        let spans = route(vec![
            json!({"repeatStart": {}, "fine": {"location": {"fraction": [1, 1]}}}),
            json!({"repeatEnd": {"times": 12}, "jump": {"type": "dcAlFine", "location": {"fraction": [1, 1]}}}),
        ])
        .unwrap();
        assert_eq!(spans.len(), 25);
        assert_eq!(spans.last().unwrap().measure, 0);
    }

    #[test]
    fn coda_can_land_in_skipped_ending_before_later_repeats() {
        let spans = route(vec![
            json!({}),
            json!({"jump": {"type": "toCoda", "location": {"fraction": [1, 1]}}}),
            json!({}),
            json!({"jump": {"type": "dcAlCoda", "location": {"fraction": [1, 1]}}}),
            json!({"repeatStart": {}}),
            json!({"coda": {"location": {"fraction": [0, 1]}},
                   "ending": {"numbers": [3], "duration": 1}, "repeatEnd": {}}),
            json!({}),
            json!({"repeatStart": {}}),
            json!({"repeatEnd": {}}),
            json!({}),
        ])
        .unwrap();
        assert_eq!(indices(&spans), vec![0, 1, 2, 3, 0, 1, 5, 6, 7, 8, 7, 8, 9]);
    }

    #[test]
    fn invalid_or_unreachable_navigation_is_reported() {
        let missing = route(vec![
            json!({}),
            json!({"jump": {"type": "segno", "location": {"fraction": [1, 1]}}}),
        ]);
        assert!(missing.unwrap_err().contains("exactly one segno"));
        let unreachable = route(vec![
            json!({"fine": {"location": {"fraction": [0, 1]}}}),
            json!({"segno": {"location": {"fraction": [0, 1]}}}),
            json!({"jump": {"type": "dsAlFine", "location": {"fraction": [1, 1]}}}),
        ]);
        assert!(unreachable.unwrap_err().contains("unreachable"));
    }
}
