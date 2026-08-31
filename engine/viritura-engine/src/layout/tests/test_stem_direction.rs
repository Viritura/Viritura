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
