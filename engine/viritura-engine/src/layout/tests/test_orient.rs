// Tests for MNX orient property on Event, Sequence, and Tuplet.

use crate::layout::config::LayoutConfig;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::model::*;
use crate::parse::parse_mnx;

// ═══════════════════════════════════════════
// Event orient tests
// ═══════════════════════════════════════════

#[test]
fn test_event_orient_up_forces_stem_up() {
    // A low note (C3) would normally get stem up, but with orient="down"
    // we force stem down. A high note (A5) normally gets stem down
    // but orient="up" forces stem up.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "orient": "below",
             "notes": [{"pitch": {"step": "C", "octave": 3}}]},
            {"duration": {"base": "quarter"}, "orient": "above",
             "notes": [{"pitch": {"step": "A", "octave": 5}}]},
            {"duration": {"base": "half"},
             "notes": [{"pitch": {"step": "B", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    let voice = &ml.voice_layouts[0];

    assert_eq!(voice.events_vec().len(), 3, "Should have 3 events");

    // Event 0: C3 with orient="down" → stem down
    assert!(
        !voice.events_vec()[0].stem_up,
        "C3 with orient=down should have stem down"
    );
    // Event 1: A5 with orient="up" → stem up
    assert!(
        voice.events_vec()[1].stem_up,
        "A5 with orient=up should have stem up"
    );
    // Event 2: B4 no orient → auto (B4 is above middle, so stem down)
    assert!(
        !voice.events_vec()[2].stem_up,
        "B4 without orient should auto-compute to stem down"
    );
}

#[test]
fn test_event_orient_overrides_forced_stem_up() {
    // Even when sequence has orient="up", event orient="down" wins.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"orient": "above", "content": [
            {"duration": {"base": "quarter"}, "orient": "below",
             "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    let voice = &ml.voice_layouts[0];

    // Event 0: orient="down" should override sequence orient="up"
    assert!(
        !voice.events_vec()[0].stem_up,
        "Event orient=down should override sequence orient=up"
    );
    // Event 1: no event orient → should follow sequence orient="up"
    assert!(
        voice.events_vec()[1].stem_up,
        "Without event orient, sequence orient=up should apply"
    );
}

// ═══════════════════════════════════════════
// Sequence orient tests
// ═══════════════════════════════════════════

#[test]
fn test_sequence_orient_forces_all_stems() {
    // High notes (A5, B5, C6) would normally get stem down.
    // With sequence orient="up", all stems should be forced up.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"orient": "above", "content": [
            {"duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "A", "octave": 5}}]},
            {"duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "B", "octave": 5}}]},
            {"duration": {"base": "half"},
             "notes": [{"pitch": {"step": "C", "octave": 6}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    let voice = &ml.voice_layouts[0];

    for (i, ev) in voice.events_vec().iter().enumerate() {
        assert!(
            ev.stem_up,
            "Event {} should have stem up due to sequence orient=up",
            i
        );
    }
}

#[test]
fn test_sequence_orient_down() {
    // Low notes (C3, D3, E3) would normally get stem up.
    // With sequence orient="down", all stems should be forced down.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"orient": "below", "content": [
            {"duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "C", "octave": 3}}]},
            {"duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "D", "octave": 3}}]},
            {"duration": {"base": "half"},
             "notes": [{"pitch": {"step": "E", "octave": 3}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    let voice = &ml.voice_layouts[0];

    for (i, ev) in voice.events_vec().iter().enumerate() {
        assert!(
            !ev.stem_up,
            "Event {} should have stem down due to sequence orient=down",
            i
        );
    }
}

// ═══════════════════════════════════════════
// Tuplet orient tests
// ═══════════════════════════════════════════

#[test]
fn test_tuplet_orient_forces_stems() {
    // A tuplet with orient="down" on low notes (C3, D3, E3) that would
    // normally auto-compute to stem up — orient overrides.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet", "orient": "below",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    let voice = &ml.voice_layouts[0];

    assert_eq!(voice.events_vec().len(), 4, "3 tuplet events + 1 regular");

    // Tuplet events (indices 0-2) should all have stem down
    for i in 0..3 {
        assert!(
            !voice.events_vec()[i].stem_up,
            "Tuplet event {} should have stem down due to tuplet orient=down",
            i
        );
    }
}

#[test]
fn test_tuplet_orient_up() {
    // A tuplet with orient="up" on high notes that would auto-compute to stem down.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet", "orient": "above",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);
    let voice = &ml.voice_layouts[0];

    // Tuplet events (indices 0-2) should all have stem up
    for i in 0..3 {
        assert!(
            voice.events_vec()[i].stem_up,
            "Tuplet event {} should have stem up due to tuplet orient=up",
            i
        );
    }
}

// ═══════════════════════════════════════════
// Deserialization tests
// ═══════════════════════════════════════════

#[test]
fn test_orient_deserialization() {
    // Verify orient parses correctly from JSON for Event, Sequence, and Tuplet.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"orient": "above", "content": [
            {"duration": {"base": "quarter"}, "orient": "below",
             "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"type": "tuplet", "orient": "below",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
             ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let seq = &score.parts[0].measures[0].sequences[0];

    // Sequence orient
    assert_eq!(
        seq.orient,
        Some(Orientation::Above),
        "Sequence orient should be Above"
    );

    // Event orient
    if let SequenceContent::Event(ev) = &seq.content[0] {
        assert_eq!(
            ev.orient,
            Some(Orientation::Below),
            "Event orient should be Below"
        );
    } else {
        panic!("Expected Event");
    }

    // Tuplet orient
    if let SequenceContent::Tuplet(t) = &seq.content[1] {
        assert_eq!(
            t.orient,
            Some(Orientation::Below),
            "Tuplet orient should be Below"
        );
    } else {
        panic!("Expected Tuplet");
    }
}

#[test]
fn test_orient_serialization_roundtrip() {
    // Parse → serialize → parse should preserve orient values.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"orient": "below", "content": [
            {"duration": {"base": "quarter"}, "orient": "above",
             "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"type": "tuplet", "orient": "above",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
             ]}
        ]}]}]}]
    }"#;

    let score1 = parse_mnx(json).unwrap();
    let serialized = serde_json::to_string(&score1).unwrap();
    let score2 = crate::parse::parse_mnx(&serialized).unwrap();

    let seq2 = &score2.parts[0].measures[0].sequences[0];
    assert_eq!(seq2.orient, Some(Orientation::Below));

    if let SequenceContent::Event(ev) = &seq2.content[0] {
        assert_eq!(ev.orient, Some(Orientation::Above));
    } else {
        panic!("Expected Event after roundtrip");
    }

    if let SequenceContent::Tuplet(t) = &seq2.content[1] {
        assert_eq!(t.orient, Some(Orientation::Above));
    } else {
        panic!("Expected Tuplet after roundtrip");
    }
}
