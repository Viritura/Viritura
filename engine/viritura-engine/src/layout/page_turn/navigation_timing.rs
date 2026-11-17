//! Constrain written page boundaries by every playback traversal.

use super::analysis::{
    compute_turn_windows, MeasureProfile, TurnAnnotation, TurnQuality, TurnWindow,
};
use super::config::PageTurnConfig;
use super::expansion::expand_playback_order;
use super::jump_itinerary::{self, PlayedSpan};
use super::tempo::TempoMap;
use crate::model::measure::GlobalMeasure;

pub(super) fn constrain_navigation_windows(
    windows: &mut [TurnWindow],
    measures: &[GlobalMeasure],
    profiles: &[MeasureProfile],
    tempo: &TempoMap,
    config: &PageTurnConfig,
) {
    let measures = &measures[..measures.len().min(profiles.len())];
    let itinerary = match expand_playback_order(measures)
        .and_then(|order| jump_itinerary::compile(measures, profiles, order))
    {
        Ok(itinerary) => itinerary,
        Err(error) => {
            eprintln!("page-turn navigation could not be resolved: {error}");
            for window in windows {
                window.turn_seconds = 0.0;
                window.tail_seconds = 0.0;
                window.head_seconds = 0.0;
                window.head_rest_measures = 0;
                window.quality = TurnQuality::Impossible;
                window.structural = true;
                window.annotation = TurnAnnotation::None;
            }
            return;
        }
    };
    let played_profiles: Vec<_> = itinerary
        .iter()
        .map(|span| clipped_profile(profiles[span.measure], *span))
        .collect();
    let played_tempo = TempoMap::from_spq(
        itinerary
            .iter()
            .map(|span| tempo.seconds(span.measure, 1.0))
            .collect(),
    );
    let played_windows = compute_turn_windows(&played_profiles, &played_tempo, &[], &[], config);
    for (pair, played) in itinerary.windows(2).zip(played_windows) {
        let from = pair[0].measure;
        let to = pair[1].measure;
        let navigation = to != from + 1
            || pair[0].end < profiles[from].total_beats - 1e-9
            || pair[1].start > 1e-9;
        // A backward repeat or skipped ending crosses every intervening cut,
        // not just the barline carrying the navigation symbol.
        for boundary in from.min(to)..from.max(to) {
            let Some(window) = windows.get_mut(boundary) else {
                continue;
            };
            if navigation && played.turn_seconds < config.min_acceptable_secs.max(config.vs_secs) {
                window.structural = true;
            }
            if played.turn_seconds < window.turn_seconds {
                window.turn_seconds = played.turn_seconds;
                window.tail_seconds = played.tail_seconds;
                window.head_seconds = played.head_seconds;
                window.quality = played.quality;
                window.annotation = played.annotation;
                // A navigation destination is not the top of the next
                // written page, so its rests cannot supply a courtesy hint.
                window.head_rest_measures = if navigation {
                    0
                } else {
                    window.head_rest_measures.min(played.head_rest_measures)
                };
            }
        }
    }
}

fn clipped_profile(profile: MeasureProfile, span: PlayedSpan) -> MeasureProfile {
    if span.start == 0.0 && span.end == profile.total_beats {
        return profile;
    }
    let length = (span.end - span.start).max(0.0);
    let last_sound_end = profile.total_beats - profile.trailing_rest_beats;
    let silent = profile.is_full_rest
        || span.end <= profile.leading_rest_beats
        || span.start > last_sound_end;
    MeasureProfile {
        total_beats: length,
        leading_rest_beats: if silent {
            length
        } else {
            (profile.leading_rest_beats - span.start).clamp(0.0, length)
        },
        trailing_rest_beats: if silent {
            length
        } else {
            (span.end - last_sound_end).clamp(0.0, length)
        },
        is_full_rest: silent,
        ..profile
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::page_turn::{analyze_turn_windows, TurnQuality};
    use serde_json::json;

    fn repeated_ending(shared_rest: bool, source_rest: bool) -> crate::model::Score {
        let sound = json!({"duration": {"base": "whole"},
            "notes": [{"pitch": {"step": "C", "octave": 5}}]});
        let rest = json!({"duration": {"base": "whole"}, "rest": {}});
        let bar = |event| json!({"sequences": [{"content": [event]}]});
        crate::parse::parse_mnx(
            &json!({
                "mnx": {"version": 1},
                "global": {"measures": [
                    {"tempos": [{"bpm": 60, "value": {"base": "quarter"}}]},
                    {"repeatStart": {}}, {},
                    {"ending": {"duration": 3, "numbers": [1]}}, {}, {"repeatEnd": {}},
                    {"ending": {"duration": 1, "numbers": [2]}}, {}
                ]},
                "parts": [{"id": "p", "measures": [
                    bar(sound.clone()), bar(sound.clone()),
                    bar(if shared_rest { rest.clone() } else { sound.clone() }),
                    bar(rest.clone()), bar(rest.clone()),
                    bar(if source_rest { rest } else { sound.clone() }),
                    bar(sound.clone()), bar(sound)
                ]}]
            })
            .to_string(),
        )
        .expect("repeat fixture parses")
    }

    #[test]
    fn resting_first_ending_cannot_hide_a_sounding_repeat_return() {
        let score = repeated_ending(false, false);
        let windows = analyze_turn_windows(
            &score.global.measures,
            &score.parts[0].measures,
            &PageTurnConfig::default(),
        );
        // Like the turn after 186: two resting bars precede the cut, but
        // the next bar sounds and repeats immediately to earlier music.
        assert_eq!(windows[4].turn_seconds, 0.0);
        assert_eq!(windows[4].quality, TurnQuality::Impossible);
        assert!(windows[4].structural);
        assert_eq!(windows[4].head_rest_measures, 0);
    }

    #[test]
    fn silent_repeat_return_remains_a_usable_interior_cut() {
        let score = repeated_ending(true, true);
        let windows = analyze_turn_windows(
            &score.global.measures,
            &score.parts[0].measures,
            &PageTurnConfig::default(),
        );
        // On the second pass the shared bar supplies four seconds before
        // skipping the first ending; its twelve seconds are unavailable.
        assert_eq!(windows[4].turn_seconds, 4.0);
        assert_eq!(windows[4].quality, TurnQuality::Vs);
        assert!(!windows[4].structural);
    }

    #[test]
    fn skipped_ending_cannot_supply_turn_time_on_later_pass() {
        let score = repeated_ending(false, true);
        let windows = analyze_turn_windows(
            &score.global.measures,
            &score.parts[0].measures,
            &PageTurnConfig::default(),
        );
        // The repeat return has twelve silent seconds, but the second pass
        // jumps from the sounding shared bar to the sounding second ending.
        assert_eq!(windows[4].turn_seconds, 0.0);
        assert_eq!(windows[4].quality, TurnQuality::Impossible);
        assert!(windows[4].structural);
    }

    #[test]
    fn jump_and_coda_crossings_constrain_intervening_page_cuts() {
        let sound = json!({"duration": {"base": "whole"},
            "notes": [{"pitch": {"step": "C", "octave": 5}}]});
        let rest = json!({"duration": {"base": "whole"}, "rest": {}});
        let bar = |event| json!({"sequences": [{"content": [event]}]});
        let score = crate::parse::parse_mnx(
            &json!({
                "mnx": {"version": 1},
                "global": {"measures": [
                    {"tempos": [{"bpm": 60, "value": {"base": "quarter"}}]},
                    {"jump": {"type": "toCoda", "location": {"fraction": [1, 1]}}},
                    {}, {},
                    {"jump": {"type": "dcAlCoda", "location": {"fraction": [1, 1]}}},
                    {},
                    {"coda": {"location": {"fraction": [0, 1]}}},
                    {}
                ]},
                "parts": [{"id": "p", "measures": [
                    bar(sound.clone()), bar(sound.clone()), bar(rest.clone()), bar(rest),
                    bar(sound.clone()), bar(sound.clone()), bar(sound.clone()), bar(sound)
                ]}]
            })
            .to_string(),
        )
        .unwrap();
        let windows = analyze_turn_windows(
            &score.global.measures,
            &score.parts[0].measures,
            &PageTurnConfig::default(),
        );
        for (index, window) in windows.iter().enumerate().take(6).skip(1) {
            assert_eq!(window.quality, TurnQuality::Impossible, "cut {index}");
            assert!(window.structural);
        }
    }

    #[test]
    fn mid_measure_jump_clips_silence_at_source_and_destination() {
        let sound = json!({"duration": {"base": "quarter"},
            "notes": [{"pitch": {"step": "C", "octave": 5}}]});
        let rest = json!({"duration": {"base": "quarter"}, "rest": {}});
        let bar = |content| json!({"sequences": [{"content": content}]});
        let score = crate::parse::parse_mnx(
            &json!({
                "mnx": {"version": 1},
                "global": {"measures": [
                    {"tempos": [{"bpm": 60, "value": {"base": "quarter"}}],
                     "segno": {"location": {"fraction": [1, 4]}}},
                    {},
                    {"jump": {"type": "segno", "location": {"fraction": [1, 2]}}}
                ]},
                "parts": [{"id": "p", "measures": [
                    bar(vec![rest.clone(), sound.clone(), rest.clone(), rest.clone()]),
                    bar(vec![rest.clone(), rest.clone(), rest.clone(), rest.clone()]),
                    bar(vec![rest.clone(), sound, rest.clone(), rest])
                ]}]
            })
            .to_string(),
        )
        .unwrap();
        let windows = analyze_turn_windows(
            &score.global.measures,
            &score.parts[0].measures,
            &PageTurnConfig::default(),
        );
        assert_eq!(windows[1].turn_seconds, 0.0);
        assert_eq!(windows[1].quality, TurnQuality::Impossible);
        assert!(windows[1].structural);
    }

    #[test]
    fn planner_avoids_rest_inside_a_sounding_jump_return() {
        use crate::layout::page_turn::optimizer::{optimize, PageGeometry};
        use crate::layout::page_turn::TitlePagePolicy;

        let sound = json!({"duration": {"base": "whole"},
            "notes": [{"pitch": {"step": "C", "octave": 5}}]});
        let rest = json!({"duration": {"base": "whole"}, "rest": {}});
        let mut global = vec![json!({}); 16];
        global[0] = json!({"tempos": [{"bpm": 60, "value": {"base": "quarter"}}]});
        global[4] = json!({"segno": {"location": {"fraction": [0, 1]}}});
        global[8] = json!({"jump": {"type": "segno", "location": {"fraction": [1, 1]}}});
        let measures: Vec<_> = (0..16)
            .map(|index| {
                let event = if [2, 3, 5, 6, 7].contains(&index) {
                    rest.clone()
                } else {
                    sound.clone()
                };
                json!({"sequences": [{"content": [event]}]})
            })
            .collect();
        let score = crate::parse::parse_mnx(
            &json!({
                "mnx": {"version": 1},
                "global": {"measures": global},
                "parts": [{"id": "p", "measures": measures}]
            })
            .to_string(),
        )
        .unwrap();
        let config = PageTurnConfig {
            title_page: TitlePagePolicy::Never,
            first_page_recto: Some(true),
            allow_intentional_blanks: false,
            ..PageTurnConfig::default()
        };
        let windows =
            analyze_turn_windows(&score.global.measures, &score.parts[0].measures, &config);
        assert_eq!(windows[3].quality, TurnQuality::Comfortable);
        assert_eq!(windows[5].quality, TurnQuality::Impossible);
        let ranges: Vec<_> = (0..8).map(|i| (i * 2, i * 2 + 1)).collect();
        let plan = optimize(
            &[20.0; 8],
            &[0.0; 8],
            &PageGeometry {
                usable_height: 60.0,
                title_height: 0.0,
                inter_system_spacing: 0.0,
            },
            &config,
            &ranges,
            &windows,
        )
        .unwrap();
        assert_eq!(plan.page_starts[1], 2, "turn after the safe fourth measure");
    }

    #[test]
    fn unresolved_jump_does_not_leave_optimistic_windows() {
        let score = crate::parse::parse_mnx(
            &json!({
                "mnx": {"version": 1},
                "global": {"measures": [
                    {},
                    {"jump": {"type": "segno", "location": {"fraction": [1, 1]}}},
                    {}
                ]},
                "parts": [{"id": "p", "measures": [
                    {"sequences": []}, {"sequences": []}, {"sequences": []}
                ]}]
            })
            .to_string(),
        )
        .unwrap();
        let windows = analyze_turn_windows(
            &score.global.measures,
            &score.parts[0].measures,
            &PageTurnConfig::default(),
        );
        assert!(windows
            .iter()
            .all(|w| w.structural && w.quality == TurnQuality::Impossible));
    }
}
