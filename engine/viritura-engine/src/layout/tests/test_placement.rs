// Tests for the MNX `placement` property on Tuplet (bracket/number side).
//
// MNX's `orient` key was renamed to `placement` upstream, and at the same
// time the event/sequence-level stem-forcing cascade (`event.orient`,
// `sequence.orient`) was removed entirely in favor of a new, non-authoritative
// `sequence.directionHint` (see `model::event::Sequence::direction_hint`).
// Only `tuplet.placement` remains as a real, scoped override — it controls
// the tuplet bracket/number side, not stem direction.

use crate::layout::config::LayoutConfig;
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::model::*;
use crate::parse::parse_mnx;

#[test]
fn test_tuplet_below_preserves_automatic_up_stems() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet", "placement": "below",
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

    for i in 0..3 {
        assert!(
            voice.events_vec()[i].stem_up,
            "Tuplet event {} should keep its automatic up stem",
            i
        );
    }
}

#[test]
fn test_tuplet_above_preserves_automatic_down_stems() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet", "placement": "above",
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

    for i in 0..3 {
        assert!(
            !voice.events_vec()[i].stem_up,
            "Tuplet event {} should keep its automatic down stem",
            i
        );
    }
}

#[test]
fn tuplet_placement_moves_bracket_without_moving_stems() {
    let make_score = |placement: &str| {
        parse_mnx(
            &serde_json::json!({
                "mnx": {"version": 1},
                "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
                "parts": [{"measures": [{"sequences": [{"content": [{
                    "type": "tuplet", "placement": placement, "bracket": "yes",
                    "inner": {"multiple": 3, "duration": {"base": "eighth"}},
                    "outer": {"multiple": 2, "duration": {"base": "eighth"}},
                    "content": [
                        {"id": "a", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                        {"id": "b", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                        {"id": "c", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}
                    ]
                }]}]}]}]
            })
            .to_string(),
        )
        .unwrap()
    };
    let config = LayoutConfig::default();
    let above = make_score("above");
    let below = make_score("below");
    let get_stems = |score: &Score| {
        let resolved = resolve_measures(score, 0);
        layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0).voice_layouts[0]
            .events_vec()
            .iter()
            .map(|event| event.stem_up)
            .collect::<Vec<_>>()
    };
    assert_eq!(get_stems(&above), get_stems(&below));
    let distance = |score: &Score| {
        let dl = crate::layout::layout_score(score, 0, &config);
        let bracket_y = dl
            .commands
            .iter()
            .zip(&dl.element_ids)
            .find_map(|(command, id)| match command {
                crate::render::RenderCommand::DrawLine { y1, y2, .. }
                    if id.as_deref() == Some("p0/m0/s0/tuplet0") && (y1 - y2).abs() < 1e-6 =>
                {
                    Some(*y1)
                }
                _ => None,
            })
            .expect("tuplet bracket line");
        let note_y = dl
            .commands
            .iter()
            .find_map(|command| match command {
                crate::render::RenderCommand::DrawGlyph { y, codepoint, .. }
                    if *codepoint == crate::render::smufl::smufl::NOTEHEAD_BLACK =>
                {
                    Some(*y)
                }
                _ => None,
            })
            .expect("notehead");
        bracket_y - note_y
    };
    assert!(distance(&above) < 0.0);
    assert!(distance(&below) > 0.0);
}

#[test]
fn tuplet_placement_preserves_explicit_and_staff_source_stem_direction() {
    let score = parse_mnx(r#"{
        "mnx":{"version":1},
        "global":{"measures":[{"time":{"count":4,"unit":4}}]},
        "parts":[{"measures":[{"sequences":[{"content":[
            {"type":"tuplet","placement":"above",
             "inner":{"multiple":3,"duration":{"base":"eighth"}},
             "outer":{"multiple":2,"duration":{"base":"eighth"}},
             "content":[
                {"duration":{"base":"eighth"},"stemDirection":"up","notes":[{"pitch":{"step":"C","octave":4}}]},
                {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4}}]},
                {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"E","octave":4}}]}
             ]}
        ]}]}]}]
    }"#).unwrap();
    let mut resolved = resolve_measures(&score, 0);
    resolved[0].part.sequences[0].forced_stem_up = Some(false);
    resolved[0].part.beams = Some(vec![]);
    let config = LayoutConfig::default();
    let measure = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);
    let stems: Vec<_> = measure.voice_layouts[0]
        .events_vec()
        .iter()
        .map(|event| event.stem_up)
        .collect();
    assert_eq!(stems, [true, false, false]);
}

#[test]
fn test_tuplet_placement_deserialization_roundtrip() {
    // Verify placement parses correctly from JSON for Tuplet and survives a
    // serialize/parse roundtrip.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet", "placement": "below",
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
    let seq1 = &score1.parts[0].measures[0].sequences[0];
    if let SequenceContent::Tuplet(t) = &seq1.content[0] {
        assert_eq!(
            t.placement,
            Some(Placement::Below),
            "Tuplet placement should be Below"
        );
    } else {
        panic!("Expected Tuplet");
    }

    let serialized = serde_json::to_string(&score1).unwrap();
    let score2 = crate::parse::parse_mnx(&serialized).unwrap();
    let seq2 = &score2.parts[0].measures[0].sequences[0];
    if let SequenceContent::Tuplet(t) = &seq2.content[0] {
        assert_eq!(
            t.placement,
            Some(Placement::Below),
            "Tuplet placement should survive a roundtrip"
        );
    } else {
        panic!("Expected Tuplet after roundtrip");
    }
}
