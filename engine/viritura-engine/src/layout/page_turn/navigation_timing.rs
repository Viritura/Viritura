//! Constrain written page boundaries by every traversal in repeat playback.

use super::analysis::{compute_turn_windows, MeasureProfile, TurnWindow};
use super::config::PageTurnConfig;
use super::expansion::expand_playback_order;
use super::tempo::TempoMap;
use crate::model::measure::GlobalMeasure;

pub(super) fn constrain_navigation_windows(
    windows: &mut [TurnWindow],
    measures: &[GlobalMeasure],
    profiles: &[MeasureProfile],
    tempo: &TempoMap,
    config: &PageTurnConfig,
) {
    let order = expand_playback_order(&measures[..measures.len().min(profiles.len())]);
    let played_profiles: Vec<_> = order.iter().map(|&index| profiles[index]).collect();
    let played_tempo = TempoMap::from_spq(
        order
            .iter()
            .map(|&index| tempo.seconds(index, 1.0))
            .collect(),
    );
    let played_windows = compute_turn_windows(&played_profiles, &played_tempo, &[], &[], config);
    for (pair, played) in order.windows(2).zip(played_windows) {
        let from = pair[0];
        let to = pair[1];
        let navigation = to != from + 1;
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
}
