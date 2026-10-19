// Tests for MNX color property on notation elements.
//
// The MNX spec defines an optional `color` property on: clef, key, ending, grace, segno, fine.
// These tests verify that the color is parsed from JSON, propagated through layout, and
// appears in the render commands.

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::*;

// ═══════════════════════════════════════════
// Model deserialization tests
// ═══════════════════════════════════════════

#[test]
fn test_clef_color_deserializes() {
    let json = r##"{"sign": "G", "staffPosition": -2, "color": "#ff0000"}"##;
    let clef: clef::Clef = serde_json::from_str(json).unwrap();
    assert_eq!(clef.color.as_deref(), Some("#ff0000"));
}

#[test]
fn test_clef_color_absent() {
    let json = r##"{"sign": "G", "staffPosition": -2}"##;
    let clef: clef::Clef = serde_json::from_str(json).unwrap();
    assert!(clef.color.is_none());
}

#[test]
fn test_key_color_deserializes() {
    let json = r##"{"fifths": 2, "color": "#00ff00"}"##;
    let raw: crate::raw::Key = serde_json::from_str(json).unwrap();
    let key = crate::promote::key::promote_key(raw);
    assert_eq!(key.color.as_deref(), Some("#00ff00"));
}

#[test]
fn test_ending_color_deserializes() {
    let json = r##"{"duration": 1, "numbers": [1], "color": "#0000ff"}"##;
    let ending: repeat::Ending = serde_json::from_str(json).unwrap();
    assert_eq!(ending.color.as_deref(), Some("#0000ff"));
}

#[test]
fn test_grace_color_deserializes() {
    let json = r##"{
        "type": "grace",
        "content": [{"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}],
        "color": "#ff8800"
    }"##;
    let raw: crate::raw::Grace = serde_json::from_str(json).unwrap();
    let grace = crate::promote::event::promote_grace(raw).unwrap();
    assert_eq!(grace.color.as_deref(), Some("#ff8800"));
}

// ═══════════════════════════════════════════
// Layout color propagation tests
// ═══════════════════════════════════════════

#[test]
fn test_clef_color_propagates_to_render() {
    let json = r##"{
        "mnx": {"version": 1},
        "global": {"measures": [{}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2, "color": "#ff0000"}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"##;
    let score = parse_mnx(json).expect("parse failed");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let clef_cmd = dl.commands.iter().find(
        |cmd| matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == 0xE050),
    );
    assert!(clef_cmd.is_some(), "Clef glyph should be present");
    if let RenderCommand::DrawGlyph { color, .. } = clef_cmd.unwrap() {
        assert_eq!(color, "#ff0000", "Clef should render with specified color");
    }
}

#[test]
fn test_key_color_propagates_to_render() {
    let json = r##"{
        "mnx": {"version": 1},
        "global": {"measures": [{"key": {"fifths": 1, "color": "#00ff00"}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"##;
    let score = parse_mnx(json).expect("parse failed");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let key_cmd = dl.commands.iter().find(
        |cmd| matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == 0xE262),
    );
    assert!(key_cmd.is_some(), "Key signature sharp should be present");
    if let RenderCommand::DrawGlyph { color, .. } = key_cmd.unwrap() {
        assert_eq!(
            color, "#00ff00",
            "Key sig should render with specified color"
        );
    }
}

#[test]
fn test_ending_color_propagates_to_render() {
    let json = r##"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"ending": {"duration": 1, "numbers": [1], "color": "#0000ff"},
             "repeatEnd": {}}
        ]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"##;
    let score = parse_mnx(json).expect("parse failed");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let text_cmd = dl
        .commands
        .iter()
        .find(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text.contains("1.")));
    assert!(text_cmd.is_some(), "Volta bracket text should be present");
    if let RenderCommand::DrawText { color, .. } = text_cmd.unwrap() {
        assert_eq!(
            color, "#0000ff",
            "Volta text should render with specified color"
        );
    }
}
