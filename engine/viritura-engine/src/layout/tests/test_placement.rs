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
fn test_tuplet_placement_forces_stems() {
    // A tuplet with placement="below" on low notes (C3, D3, E3) that would
    // normally auto-compute to stem up — placement overrides.
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

    // Tuplet events (indices 0-2) should all have stem down
    for i in 0..3 {
        assert!(
            !voice.events_vec()[i].stem_up,
            "Tuplet event {} should have stem down due to tuplet placement=below",
            i
        );
    }
}

#[test]
fn test_tuplet_placement_up() {
    // A tuplet with placement="above" on high notes that would auto-compute to stem down.
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

    // Tuplet events (indices 0-2) should all have stem up
    for i in 0..3 {
        assert!(
            voice.events_vec()[i].stem_up,
            "Tuplet event {} should have stem up due to tuplet placement=above",
            i
        );
    }
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
