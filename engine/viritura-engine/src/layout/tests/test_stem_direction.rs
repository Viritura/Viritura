//! Tests for MNX stemDirection property on events.

use crate::layout::*;
use crate::model::*;
use crate::parse::parse_mnx;

fn make_score_json(stem_dir: Option<&str>, step: &str, octave: u8) -> String {
    let stem_part = match stem_dir {
        Some(d) => format!(r#""stemDirection": "{}","#, d),
        None => String::new(),
    };
    format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{
            "measures": [{{"time": {{"count": 4, "unit": 4}}}}]
        }},
        "parts": [{{
            "measures": [{{
                "sequences": [{{
                    "content": [{{
                        "duration": {{"base": "quarter"}},
                        {}
                        "notes": [{{"pitch": {{"step": "{}", "octave": {}}}}}]
                    }}]
                }}]
            }}]
        }}]
    }}"#,
        stem_part, step, octave
    )
}

#[test]
fn test_parse_stem_direction_up() {
    let json = make_score_json(Some("up"), "A", 5);
    let score = parse_mnx(&json).unwrap();
    let event = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();
    assert_eq!(event.stem_direction, Some(StemDirection::Up));
}

#[test]
fn test_parse_stem_direction_down() {
    let json = make_score_json(Some("down"), "C", 4);
    let score = parse_mnx(&json).unwrap();
    let event = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();
    assert_eq!(event.stem_direction, Some(StemDirection::Down));
}

#[test]
fn test_parse_stem_direction_absent() {
    let json = make_score_json(None, "C", 4);
    let score = parse_mnx(&json).unwrap();
    let event = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();
    assert_eq!(event.stem_direction, None);
}

#[test]
fn test_stem_direction_up_overrides_auto_for_high_note() {
    // A5 is above the middle line — auto stem direction would be DOWN.
    // stemDirection: "up" should override to UP.
    let json = make_score_json(Some("up"), "A", 5);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    assert!(
        ml.voice_layouts[0].events_vec()[0].stem_up,
        "stemDirection 'up' should force stem up even for high note A5"
    );
}

#[test]
fn test_stem_direction_down_overrides_auto_for_low_note() {
    // C4 is below the middle line — auto stem direction would be UP.
    // stemDirection: "down" should override to DOWN.
    let json = make_score_json(Some("down"), "C", 4);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    assert!(
        !ml.voice_layouts[0].events_vec()[0].stem_up,
        "stemDirection 'down' should force stem down even for low note C4"
    );
}

#[test]
fn test_stem_direction_per_event_mixed() {
    // Two events: first forced up (high note), second forced down (low note).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [{"time": {"count": 4, "unit": 4}}]
        },
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        {
                            "duration": {"base": "quarter"},
                            "stemDirection": "up",
                            "notes": [{"pitch": {"step": "A", "octave": 5}}]
                        },
                        {
                            "duration": {"base": "quarter"},
                            "stemDirection": "down",
                            "notes": [{"pitch": {"step": "C", "octave": 4}}]
                        }
                    ]
                }]
            }]
        }]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    assert!(
        ml.voice_layouts[0].events_vec()[0].stem_up,
        "First event (A5) with stemDirection 'up' should have stem up"
    );
    assert!(
        !ml.voice_layouts[0].events_vec()[1].stem_up,
        "Second event (C4) with stemDirection 'down' should have stem down"
    );
}

#[test]
fn test_single_voice_stem_uses_concert_or_written_display_position() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "name": "Horn in F",
            "transposition": {"interval": {"halfSteps": 7, "staffDistance": 4}},
            "measures": [{"sequences": [{"voice": "v1", "content": [{
                "duration": {"base": "quarter"},
                "notes": [{"pitch": {"step": "E", "octave": 4}}]
            }]}]}]
        }],
        "scores": [{"name": "Horn", "useWritten": false}]
    }"#;
    let mut score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();

    let concert = resolve_measures(&score, 0);
    let concert_layout = layout_measure(&concert[0], config.sp, 0.0, &config, None, &[], 1.0);
    assert!(
        concert_layout.voice_layouts[0].events_vec()[0].stem_up,
        "concert E4 displays below the middle line and should stem up"
    );

    score.scores[0].use_written = Some(true);
    let written = resolve_measures(&score, 0);
    let written_layout = layout_measure(&written[0], config.sp, 0.0, &config, None, &[], 1.0);
    assert!(
        !written_layout.voice_layouts[0].events_vec()[0].stem_up,
        "Horn in F written B4 displays on the middle line and should stem down"
    );
}

#[test]
fn test_serialize_stem_direction_roundtrip() {
    let json = make_score_json(Some("up"), "C", 4);
    let score = parse_mnx(&json).unwrap();
    let event = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();

    // Serialize back to JSON and verify stemDirection is preserved
    let serialized = serde_json::to_string(event).unwrap();
    assert!(
        serialized.contains("\"stemDirection\":\"up\""),
        "Serialized event should contain stemDirection: {}",
        serialized
    );
}

// ─── sequence.directionHint ──────────────────────────────────────────

/// Build a part measure from raw sequence JSON bodies.
fn score_with_sequences(sequences: &[String]) -> String {
    format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
        "parts": [{{"measures": [{{"sequences": [{}]}}]}}]
    }}"#,
        sequences.join(",")
    )
}

/// A sequence of one whole note, with an optional direction hint.
fn hinted_sequence(hint: Option<&str>, step: &str, octave: u8) -> String {
    let hint_part = match hint {
        Some(h) => format!(r#""directionHint": "{}","#, h),
        None => String::new(),
    };
    format!(
        r#"{{
            {}
            "content": [{{
                "duration": {{"base": "whole"}},
                "notes": [{{"pitch": {{"step": "{}", "octave": {}}}}}]
            }}]
        }}"#,
        hint_part, step, octave
    )
}

fn stem_up_of(json: &str, voice: usize) -> bool {
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], config.sp, 0.0, &config, None, &[], 1.0);
    ml.voice_layouts[voice].events_vec()[0].stem_up
}

#[test]
fn direction_hint_parses_onto_the_sequence() {
    let json = score_with_sequences(&[hinted_sequence(Some("lower"), "C", 4)]);
    let score = parse_mnx(&json).unwrap();
    assert_eq!(
        score.parts[0].measures[0].sequences[0].direction_hint,
        Some(DirectionHint::Lower)
    );
}

#[test]
fn absent_direction_hint_is_auto() {
    let json = score_with_sequences(&[hinted_sequence(None, "C", 4)]);
    let score = parse_mnx(&json).unwrap();
    assert_eq!(
        score.parts[0].measures[0].sequences[0].direction_hint, None,
        "an absent hint stays None and is treated as auto during resolution"
    );
}

#[test]
fn direction_hint_overrides_array_order_when_contested() {
    // Hints are deliberately reversed against array order: the FIRST sequence
    // is the lower voice. Array order alone would stem it up.
    let json = score_with_sequences(&[
        hinted_sequence(Some("lower"), "C", 4),
        hinted_sequence(Some("upper"), "A", 5),
    ]);
    assert!(
        !stem_up_of(&json, 0),
        "sequence hinted 'lower' should stem down despite being first in the array"
    );
    assert!(
        stem_up_of(&json, 1),
        "sequence hinted 'upper' should stem up despite being second in the array"
    );
}

#[test]
fn array_order_still_breaks_ties_between_unhinted_voices() {
    let json =
        score_with_sequences(&[hinted_sequence(None, "A", 5), hinted_sequence(None, "C", 4)]);
    assert!(stem_up_of(&json, 0), "first unhinted voice stems up");
    assert!(!stem_up_of(&json, 1), "second unhinted voice stems down");
}

#[test]
fn array_order_breaks_ties_between_equally_hinted_voices() {
    // MNX explicitly permits several sequences in one part measure to share a
    // hint, so the hint cannot impose a total ordering on three voices.
    let json = score_with_sequences(&[
        hinted_sequence(Some("upper"), "A", 5),
        hinted_sequence(Some("upper"), "G", 5),
        hinted_sequence(Some("lower"), "C", 4),
    ]);
    assert!(stem_up_of(&json, 0), "first 'upper' voice stems up");
    assert!(stem_up_of(&json, 1), "second 'upper' voice also stems up");
    assert!(!stem_up_of(&json, 2), "'lower' voice stems down");
}

#[test]
fn direction_hint_decays_to_pitch_when_uncontested() {
    // A single sequence hinted 'lower' has no other voice to sit beneath, so
    // it engraves as the only voice: C4 sits below the middle line and stems
    // up despite the hint.
    let json = score_with_sequences(&[hinted_sequence(Some("lower"), "C", 4)]);
    assert!(
        stem_up_of(&json, 0),
        "an uncontested 'lower' hint should defer to pitch-based auto"
    );
}

#[test]
fn a_space_only_sequence_does_not_contest() {
    // `space` is MNX's encoding for a voice occupying time without engraving
    // anything — the wire form of a hidden rest. It cannot displace another
    // voice, so the hinted voice falls back to pitch-based auto.
    let json = score_with_sequences(&[
        hinted_sequence(Some("lower"), "C", 4),
        r#"{"content": [{"type": "space", "duration": [1, 1]}]}"#.to_string(),
    ]);
    assert!(
        stem_up_of(&json, 0),
        "a space-only sibling leaves the hinted voice uncontested"
    );
}

#[test]
fn a_visible_rest_contests_and_keeps_the_hint_active() {
    // Unlike `space`, a rest is engraved, so the hinted voice keeps to its
    // own side of the staff. MNX has no way to hide a rest, which is exactly
    // why the two cases are distinguishable here.
    let json = score_with_sequences(&[
        hinted_sequence(Some("lower"), "C", 4),
        r#"{"content": [{"duration": {"base": "whole"}, "rest": {}}]}"#.to_string(),
    ]);
    assert!(
        !stem_up_of(&json, 0),
        "a visible rest in another voice keeps the 'lower' hint authoritative"
    );
}

#[test]
fn event_stem_direction_outranks_the_direction_hint() {
    let json = score_with_sequences(&[
        r#"{
            "directionHint": "lower",
            "content": [{
                "duration": {"base": "whole"},
                "stemDirection": "up",
                "notes": [{"pitch": {"step": "C", "octave": 4}}]
            }]
        }"#
        .to_string(),
        hinted_sequence(Some("upper"), "A", 5),
    ]);
    assert!(
        stem_up_of(&json, 0),
        "an explicit event stemDirection must win over the sequence hint"
    );
}
