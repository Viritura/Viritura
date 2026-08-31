// Parse tests (extracted from parse.rs)

use super::*;

#[test]
fn test_parse_hello_world() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"barline": {"type": "regular"}, "time": {"count": 4, "unit": 4}}
            ]
        },
        "parts": [
            {
                "measures": [
                    {
                        "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                        "sequences": [
                            {
                                "content": [
                                    {
                                        "duration": {"base": "whole"},
                                        "notes": [{"pitch": {"step": "C", "octave": 4}}]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse MNX");
    assert_eq!(score.mnx.version, 1);
    assert_eq!(score.global.measures.len(), 1);
    assert_eq!(score.parts.len(), 1);

    let part = &score.parts[0];
    assert_eq!(part.measures.len(), 1);

    let measure = &part.measures[0];
    assert!(measure.clefs.is_some());
    assert_eq!(measure.sequences.len(), 1);

    let seq = &measure.sequences[0];
    assert_eq!(seq.content.len(), 1);

    if let Some(event) = seq.content[0].as_event() {
        assert!(!event.is_rest());
        assert_eq!(event.notes().len(), 1);
        assert_eq!(event.notes()[0].pitch.step, "C");
        assert_eq!(event.notes()[0].pitch.octave, 4);
    } else {
        panic!("Expected an event");
    }
}

#[test]
fn test_parse_c_major_scale() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}},
                {"barline": {"type": "regular"}}
            ]
        },
        "parts": [
            {
                "measures": [
                    {
                        "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                        "sequences": [{"content": [
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
                        ]}]
                    },
                    {
                        "sequences": [{"content": [
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                        ]}]
                    }
                ]
            }
        ]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse");
    assert_eq!(score.parts[0].measures.len(), 2);
    assert_eq!(score.parts[0].measures[0].sequences[0].content.len(), 4);
    assert_eq!(score.parts[0].measures[1].sequences[0].content.len(), 4);
}

#[test]
fn test_parse_rest() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{"content": [
                    {"duration": {"base": "half"}, "notes": [
                        {"pitch": {"step": "C", "octave": 4}},
                        {"pitch": {"step": "E", "octave": 4}},
                        {"pitch": {"step": "G", "octave": 4}}
                    ]},
                    {"duration": {"base": "half"}, "rest": {}}
                ]}]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse");
    let events = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(events.len(), 2);

    let chord = events[0].as_event().unwrap();
    assert!(!chord.is_rest());
    assert_eq!(chord.notes().len(), 3);

    let rest = events[1].as_event().unwrap();
    assert!(rest.is_rest());
}

#[test]
fn test_parse_measure_with_beams() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{"content": [
                    {"duration": {"base": "eighth"}, "id": "ev1", "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "id": "ev2", "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "id": "ev3", "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                    {"duration": {"base": "eighth"}, "id": "ev4", "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]}],
                "beams": [
                    {"events": ["ev1", "ev2"]},
                    {"events": ["ev3", "ev4"]}
                ]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse MNX with beams");
    let measure = &score.parts[0].measures[0];

    // Verify beams parsed correctly
    let beams = measure.beams.as_ref().expect("beams should be present");
    assert_eq!(beams.len(), 2);
    assert_eq!(beams[0].events, vec!["ev1", "ev2"]);
    assert_eq!(beams[1].events, vec!["ev3", "ev4"]);

    // Verify events still parse correctly alongside beams
    assert_eq!(measure.sequences[0].content.len(), 5);
}

#[test]
fn test_parse_tuplet() {
    use crate::model::duration::NoteValueBase;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        {
                            "type": "tuplet",
                            "inner": {"multiple": 3, "duration": {"base": "eighth"}},
                            "outer": {"multiple": 2, "duration": {"base": "eighth"}},
                            "content": [
                                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                            ]
                        },
                        {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                    ]
                }]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse MNX with tuplet");
    let content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(content.len(), 2);

    // First item is a tuplet
    let tuplet = content[0].as_tuplet().expect("Expected tuplet");
    assert_eq!(tuplet.inner.multiple, 3);
    assert_eq!(tuplet.inner.duration.base, NoteValueBase::Eighth);
    assert_eq!(tuplet.outer.multiple, 2);
    assert_eq!(tuplet.outer.duration.base, NoteValueBase::Eighth);
    assert_eq!(tuplet.content.len(), 3);

    // Tuplet content items are events
    let first_ev = tuplet.content[0]
        .as_event()
        .expect("Expected event in tuplet");
    assert_eq!(first_ev.notes()[0].pitch.step, "C");
    assert_eq!(first_ev.notes()[0].pitch.octave, 5);

    // Second item is a regular event
    let event = content[1].as_event().expect("Expected event");
    assert_eq!(event.duration.base, NoteValueBase::Half);
}

#[test]
fn test_parse_tuplets_mnx_file() {
    use crate::model::duration::NoteValueBase;

    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/tuplets.mnx");
    let score = parse_mnx(json).expect("Failed to parse tuplets.mnx");

    // Measure 1: two tuplets + two quarter notes
    let m1_content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(m1_content.len(), 4);

    let t1 = m1_content[0]
        .as_tuplet()
        .expect("First item should be tuplet");
    assert_eq!(t1.inner.multiple, 3);
    assert_eq!(t1.outer.multiple, 2);
    assert_eq!(t1.content.len(), 2);

    let t2 = m1_content[1]
        .as_tuplet()
        .expect("Second item should be tuplet");
    assert_eq!(t2.inner.multiple, 3);
    assert_eq!(t2.content.len(), 3);

    // Last two items are regular events
    assert!(m1_content[2].as_event().is_some());
    assert!(m1_content[3].as_event().is_some());

    // Measure 2: one 6:4 tuplet
    let m2_content = &score.parts[0].measures[1].sequences[0].content;
    assert_eq!(m2_content.len(), 1);
    let t3 = m2_content[0].as_tuplet().expect("Should be a 6:4 tuplet");
    assert_eq!(t3.inner.multiple, 6);
    assert_eq!(t3.outer.multiple, 4);
    assert_eq!(t3.inner.duration.base, NoteValueBase::Quarter);
    assert_eq!(t3.content.len(), 6);
}

#[test]
fn test_parse_repeats_empty() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}, "repeatStart": {}, "repeatEnd": {}}
            ]
        },
        "parts": [{
            "measures": [{
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse repeats");
    let gm = &score.global.measures[0];
    assert!(gm.repeat_start.is_some());
    assert!(gm.repeat_end.is_some());
    // Empty objects → times should be None
    assert_eq!(gm.repeat_start.as_ref().unwrap().times, None);
    assert_eq!(gm.repeat_end.as_ref().unwrap().times, None);
}

#[test]
fn test_parse_repeats_with_times() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}, "repeatStart": {"times": 3}, "repeatEnd": {"times": 4}}
            ]
        },
        "parts": [{
            "measures": [{
                "sequences": [{"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                ]}]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse repeats with times");
    let gm = &score.global.measures[0];
    assert_eq!(gm.repeat_start.as_ref().unwrap().times, Some(3));
    assert_eq!(gm.repeat_end.as_ref().unwrap().times, Some(4));
}

#[test]
fn test_parse_repeats_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/repeats.mnx");
    let score = parse_mnx(json).expect("Failed to parse repeats.mnx");

    let gm = &score.global.measures[0];
    assert!(gm.repeat_start.is_some());
    assert!(gm.repeat_end.is_some());
}

#[test]
fn test_parse_rest_staff_position() {
    let json = include_str!(
        "../../../viritura-wasm/../../packages/format/fixtures/mnx/rest-positions.mnx"
    );
    let score = parse_mnx(json).expect("Failed to parse rest-positions.mnx");

    let seq = &score.parts[0].measures[0].sequences[0];
    // Second event is a rest with staffPosition 2
    let rest_event = seq.content[1].as_event().unwrap();
    assert!(rest_event.is_rest());
    let rest = rest_event.rest.as_ref().unwrap();
    assert_eq!(rest.staff_position, Some(2));

    // Fifth event is also a rest with staffPosition 2
    let rest_event2 = seq.content[4].as_event().unwrap();
    assert!(rest_event2.is_rest());
    let rest2 = rest_event2.rest.as_ref().unwrap();
    assert_eq!(rest2.staff_position, Some(2));
}

#[test]
fn test_parse_rest_without_staff_position() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{"content": [
                    {"duration": {"base": "half"}, "rest": {}}
                ]}]
            }]
        }]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse");
    let event = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();
    assert!(event.is_rest());
    let rest = event.rest.as_ref().unwrap();
    assert_eq!(rest.staff_position, None);
}

#[test]
fn test_parse_time_signature_glyphs() {
    use crate::model::time::TimeSignatureDisplay;

    let json = include_str!(
        "../../../viritura-wasm/../../packages/format/fixtures/mnx/time-signature-glyphs.mnx"
    );
    let score = parse_mnx(json).expect("Failed to parse time-signature-glyphs.mnx");

    // Measure 0: common time (4/4 with display "common")
    let gm0 = &score.global.measures[0];
    let ts0 = gm0.time.as_ref().expect("Measure 0 should have time sig");
    assert_eq!(ts0.count, 4);
    assert_eq!(ts0.unit, 4);
    assert_eq!(ts0.display, Some(TimeSignatureDisplay::Common));

    // Measure 1: cut time (2/2 with display "cut")
    let gm1 = &score.global.measures[1];
    let ts1 = gm1.time.as_ref().expect("Measure 1 should have time sig");
    assert_eq!(ts1.count, 2);
    assert_eq!(ts1.unit, 2);
    assert_eq!(ts1.display, Some(TimeSignatureDisplay::Cut));
}

#[test]
fn test_parse_grace_note() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {
                        "type": "grace",
                        "content": [
                            {
                                "duration": {"base": "eighth"},
                                "notes": [{"pitch": {"step": "D", "octave": 5}}]
                            }
                        ],
                        "slash": true
                    },
                    {
                        "duration": {"base": "whole"},
                        "notes": [{"pitch": {"step": "C", "octave": 5}}]
                    }
                ]}]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse grace note");
    let content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(content.len(), 2);

    // First item is a grace container
    let grace = content[0].as_grace().expect("Expected grace");
    assert_eq!(grace.content.len(), 1);
    assert_eq!(grace.slash, Some(true));
    assert_eq!(grace.grace_type, None);

    // Grace inner event
    let grace_ev = &grace.content[0];
    assert_eq!(grace_ev.notes()[0].pitch.step, "D");
    assert_eq!(grace_ev.notes()[0].pitch.octave, 5);

    // Second item is a regular event
    let event = content[1].as_event().expect("Expected event");
    assert_eq!(event.notes()[0].pitch.step, "C");
}

#[test]
fn test_parse_grace_note_with_grace_type() {
    use crate::model::event::GraceType;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{"content": [
                    {
                        "type": "grace",
                        "content": [
                            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                            {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                        ],
                        "graceType": "stealPrevious",
                        "slash": false
                    },
                    {
                        "duration": {"base": "whole"},
                        "notes": [{"pitch": {"step": "G", "octave": 5}}]
                    }
                ]}]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse grace with graceType");
    let content = &score.parts[0].measures[0].sequences[0].content;
    let grace = content[0].as_grace().expect("Expected grace");
    assert_eq!(grace.content.len(), 2);
    assert_eq!(grace.grace_type, Some(GraceType::StealPrevious));
    assert_eq!(grace.slash, Some(false));

    // Verify inner events
    assert_eq!(grace.content[0].notes()[0].pitch.step, "E");
    assert_eq!(grace.content[1].notes()[0].pitch.step, "F");
}

#[test]
fn test_parse_grace_note_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/grace-note.mnx");
    let score = parse_mnx(json).expect("Failed to parse grace-note.mnx");

    let content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(content.len(), 2);

    // First item should be a grace container
    let grace = content[0].as_grace().expect("Expected grace container");
    assert_eq!(grace.content.len(), 1);
    let grace_note = &grace.content[0];
    assert_eq!(grace_note.notes()[0].pitch.step, "B");
    assert_eq!(grace_note.notes()[0].pitch.octave, 4);

    // Second item should be a regular event
    let event = content[1].as_event().expect("Expected event");
    assert_eq!(event.notes()[0].pitch.step, "C");
    assert_eq!(event.notes()[0].pitch.octave, 5);
}

#[test]
fn test_parse_articulations_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/articulations.mnx");
    let score = parse_mnx(json).expect("Failed to parse articulations.mnx");

    let content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(content.len(), 4);

    // Event 0: staccato
    let e0 = content[0].as_event().expect("Expected event");
    let m0 = e0.markings.as_ref().expect("Expected markings on event 0");
    assert!(m0.staccato.is_some());
    assert!(m0.accent.is_none());

    // Event 1: tenuto
    let e1 = content[1].as_event().expect("Expected event");
    let m1 = e1.markings.as_ref().expect("Expected markings on event 1");
    assert!(m1.tenuto.is_some());

    // Event 2: accent
    let e2 = content[2].as_event().expect("Expected event");
    let m2 = e2.markings.as_ref().expect("Expected markings on event 2");
    assert!(m2.accent.is_some());

    // Event 3: strongAccent (marcato)
    let e3 = content[3].as_event().expect("Expected event");
    let m3 = e3.markings.as_ref().expect("Expected markings on event 3");
    assert!(m3.strong_accent.is_some());
}

#[test]
fn test_parse_staccatissimo_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/staccatissimo.mnx");
    let score = parse_mnx(json).expect("Failed to parse staccatissimo.mnx");

    let content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(content.len(), 4);

    // Event 0: staccatissimo only
    let e0 = content[0].as_event().expect("Expected event");
    let m0 = e0.markings.as_ref().expect("Expected markings on event 0");
    assert!(
        m0.staccatissimo.is_some(),
        "Event 0 should have staccatissimo"
    );
    assert!(m0.accent.is_none());

    // Event 1: staccatissimo only
    let e1 = content[1].as_event().expect("Expected event");
    let m1 = e1.markings.as_ref().expect("Expected markings on event 1");
    assert!(
        m1.staccatissimo.is_some(),
        "Event 1 should have staccatissimo"
    );

    // Event 2: staccatissimo + accent
    let e2 = content[2].as_event().expect("Expected event");
    let m2 = e2.markings.as_ref().expect("Expected markings on event 2");
    assert!(
        m2.staccatissimo.is_some(),
        "Event 2 should have staccatissimo"
    );
    assert!(m2.accent.is_some(), "Event 2 should also have accent");

    // Event 3: no markings
    let e3 = content[3].as_event().expect("Expected event");
    assert!(e3.markings.is_none(), "Event 3 should have no markings");
}

#[test]
fn test_parse_staccatissimo_inline() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {
                        "type": "event",
                        "duration": {"base": "quarter"},
                        "notes": [{"pitch": {"step": "C", "octave": 4}}],
                        "markings": {"staccatissimo": {}}
                    }
                ]}]
            }]
        }]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse staccatissimo");
    let e = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    let m = e.markings.as_ref().expect("Expected markings");
    assert!(m.staccatissimo.is_some(), "Staccatissimo should be present");
    assert!(m.staccato.is_none());
}

#[test]
fn test_parse_spiccato_marking() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {
                        "type": "event",
                        "duration": {"base": "quarter"},
                        "notes": [{"pitch": {"step": "C", "octave": 4}}],
                        "markings": {"spiccato": {}}
                    }
                ]}]
            }]
        }]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse spiccato");
    let e = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    let m = e.markings.as_ref().expect("Expected markings");
    assert!(m.spiccato.is_some(), "Spiccato should be present");
    assert!(m.staccato.is_none());
}

#[test]
fn test_parse_spiccato_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/spiccato.mnx");
    let score = parse_mnx(json).expect("Failed to parse spiccato.mnx");

    let content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(content.len(), 4);

    // Event 0: spiccato only
    let e0 = content[0].as_event().expect("Expected event");
    let m0 = e0.markings.as_ref().expect("Expected markings on event 0");
    assert!(m0.spiccato.is_some(), "Event 0 should have spiccato");
    assert!(m0.accent.is_none());

    // Event 1: spiccato only (low note C4)
    let e1 = content[1].as_event().expect("Expected event");
    let m1 = e1.markings.as_ref().expect("Expected markings on event 1");
    assert!(m1.spiccato.is_some(), "Event 1 should have spiccato");

    // Event 2: spiccato + accent
    let e2 = content[2].as_event().expect("Expected event");
    let m2 = e2.markings.as_ref().expect("Expected markings on event 2");
    assert!(m2.spiccato.is_some(), "Event 2 should have spiccato");
    assert!(m2.accent.is_some(), "Event 2 should also have accent");

    // Event 3: no markings
    let e3 = content[3].as_event().expect("Expected event");
    assert!(e3.markings.is_none(), "Event 3 should have no markings");
}

#[test]
fn test_parse_dynamics_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/dynamics.mnx");
    let score = parse_mnx(json).expect("Failed to parse dynamics.mnx");

    let dynamics = score.parts[0].measures[0]
        .dynamics
        .as_ref()
        .expect("Expected dynamics on first part measure");
    assert_eq!(dynamics.len(), 2);

    // First dynamic: ff at position 0/1
    assert_eq!(dynamics[0].value, Some(crate::raw::DynamicValue::Ff));
    assert_eq!(dynamics[0].position.fraction, (0, 1));

    // Second dynamic: ppp at position 3/4
    assert_eq!(dynamics[1].value, Some(crate::raw::DynamicValue::Ppp));
    assert_eq!(dynamics[1].position.fraction, (3, 4));
}

#[test]
fn test_parse_multi_note_tremolo() {
    use crate::model::duration::NoteValueBase;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {
                        "type": "tremolo",
                        "content": [
                            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                        ],
                        "marks": 2,
                        "outer": {"duration": {"base": "quarter"}, "multiple": 2}
                    }
                ]}]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse multi-note tremolo");
    let content = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(content.len(), 1);

    let trem = content[0]
        .as_multi_note_tremolo()
        .expect("Expected MultiNoteTremolo");
    assert_eq!(trem.marks, 2);
    assert_eq!(trem.content.len(), 2);
    assert_eq!(trem.outer.duration.base, NoteValueBase::Quarter);
    assert_eq!(trem.outer.multiple, 2);

    // Verify inner events
    assert_eq!(trem.content[0].notes()[0].pitch.step, "G");
    assert_eq!(trem.content[0].notes()[0].pitch.octave, 4);
    assert_eq!(trem.content[1].notes()[0].pitch.step, "E");
    assert_eq!(trem.content[1].notes()[0].pitch.octave, 5);
}

#[test]
fn test_parse_multi_note_tremolo_mnx_file() {
    let json = include_str!(
        "../../../viritura-wasm/../../packages/format/fixtures/mnx/tremolos-multi-note.mnx"
    );
    let score = parse_mnx(json).expect("Failed to parse tremolos-multi-note.mnx");

    // Measure 1: two multi-note tremolos with marks=2
    let m1 = &score.parts[0].measures[0].sequences[0].content;
    assert_eq!(m1.len(), 2);
    let t1 = m1[0]
        .as_multi_note_tremolo()
        .expect("Expected MultiNoteTremolo");
    assert_eq!(t1.marks, 2);
    assert_eq!(t1.content.len(), 2);
    let t2 = m1[1]
        .as_multi_note_tremolo()
        .expect("Expected MultiNoteTremolo");
    assert_eq!(t2.marks, 2);

    // Measure 2: one multi-note tremolo with marks=3 (whole notes)
    let m2 = &score.parts[0].measures[1].sequences[0].content;
    assert_eq!(m2.len(), 1);
    let t3 = m2[0]
        .as_multi_note_tremolo()
        .expect("Expected MultiNoteTremolo");
    assert_eq!(t3.marks, 3);
    assert_eq!(
        t3.content[0].duration.base,
        crate::model::duration::NoteValueBase::Whole
    );
}

#[test]
fn test_parse_lyric_line_metadata_mnx_file() {
    let json = include_str!(
        "../../../viritura-wasm/../../packages/format/fixtures/mnx/lyric-line-metadata.mnx"
    );
    let score = parse_mnx(json).expect("Failed to parse lyric-line-metadata.mnx");

    // Global lyrics metadata
    let global_lyrics = score
        .global
        .lyrics
        .as_ref()
        .expect("Global lyrics should be present");
    let metadata = global_lyrics
        .line_metadata
        .as_ref()
        .expect("lineMetadata should be present");
    assert_eq!(metadata.len(), 4);
    assert_eq!(metadata["1"].label.as_deref(), Some("English"));
    assert_eq!(metadata["1"].lang.as_deref(), Some("en"));
    assert_eq!(metadata["2"].label.as_deref(), Some("Nederlands"));
    assert_eq!(metadata["2"].lang.as_deref(), Some("nl"));
    assert_eq!(metadata["4"].lang.as_deref(), Some("es"));

    let line_order = global_lyrics
        .line_order
        .as_ref()
        .expect("lineOrder should be present");
    assert_eq!(line_order, &["1", "2", "3", "4"]);

    // Event lyrics use lines map format
    let event0 = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    let lyrics = event0.lyrics.as_ref().expect("Expected lyrics");
    let lines = lyrics.lines.as_ref().expect("Expected lines map");
    assert_eq!(lines.len(), 4);
    assert_eq!(lines["1"].text, "I");
    assert_eq!(lines["2"].text, "Ik");
}

#[test]
fn test_parse_tempo_markings_mnx_file() {
    use crate::model::duration::NoteValueBase;

    let json = include_str!(
        "../../../viritura-wasm/../../packages/format/fixtures/mnx/tempo-markings.mnx"
    );
    let score = parse_mnx(json).expect("Failed to parse tempo-markings.mnx");

    // First global measure should have tempos
    let tempos = score.global.measures[0]
        .tempos
        .as_ref()
        .expect("Expected tempos on first global measure");
    assert_eq!(tempos.len(), 1);
    assert_eq!(tempos[0].bpm, 200.0);
    assert_eq!(tempos[0].value.base, NoteValueBase::Quarter);
    assert!(tempos[0].value.dots.is_none());

    // Second global measure should have no tempos
    assert!(score.global.measures[1].tempos.is_none());
}

#[test]
fn test_parse_fractional_tempo() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}, "tempos": [{"bpm": 116.5, "value": {"base": "quarter"}}]}
            ]
        },
        "parts": [
            {
                "measures": [
                    {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}
                ]
            }
        ]
    }"#;

    let score = parse_mnx(json).expect("fractional MNX tempo should parse");
    assert_eq!(
        score.global.measures[0].tempos.as_ref().unwrap()[0].bpm,
        116.5
    );
}

#[test]
fn test_parse_hairpins_mnx_file() {
    use crate::model::direction::{DynamicGroupType, WedgeType};

    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/hairpins.mnx");
    let score = parse_mnx(json).expect("Failed to parse hairpins.mnx");

    // First measure: crescendo hairpin
    let hairpins: Vec<_> = score.parts[0].measures[0]
        .dynamics
        .as_ref()
        .expect("Expected dynamic groups on first part measure")
        .iter()
        .filter(|group| group.group_type == DynamicGroupType::Gradual)
        .collect();
    assert_eq!(hairpins.len(), 1);
    assert_eq!(hairpins[0].wedge_type, Some(WedgeType::Increasing));
    assert_eq!(hairpins[0].position.fraction, (0, 1));
    // Measure ids are opaque UUIDs post-migration; the hairpin end references
    // the first global measure by id.
    assert_eq!(
        hairpins[0].end.as_ref().unwrap().measure,
        score.global.measures[0].id.clone().unwrap()
    );
    assert_eq!(hairpins[0].end.as_ref().unwrap().position.fraction, (3, 4));

    // Second measure: decrescendo hairpin
    let hairpins2: Vec<_> = score.parts[0].measures[1]
        .dynamics
        .as_ref()
        .expect("Expected dynamic groups on second part measure")
        .iter()
        .filter(|group| group.group_type == DynamicGroupType::Gradual)
        .collect();
    assert_eq!(hairpins2.len(), 1);
    assert_eq!(hairpins2[0].wedge_type, Some(WedgeType::Decreasing));
    assert_eq!(hairpins2[0].position.fraction, (0, 1));
    assert_eq!(
        hairpins2[0].end.as_ref().unwrap().measure,
        score.global.measures[1].id.clone().unwrap()
    );
}

#[test]
fn test_parse_dashed_tick_short_barlines() {
    use crate::model::barline::BarlineType;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {
            "measures": [
                {"time": {"count": 4, "unit": 4}},
                {"barline": {"type": "dashed"}},
                {"barline": {"type": "tick"}},
                {"barline": {"type": "short"}}
            ]
        },
        "parts": [{
            "measures": [
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]},
                {"sequences": [{"content": [{"type": "event", "duration": {"base": "whole"}, "rest": {}}]}]}
            ]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    assert_eq!(
        score.global.measures[1]
            .barline
            .as_ref()
            .unwrap()
            .barline_type,
        BarlineType::Dashed
    );
    assert_eq!(
        score.global.measures[2]
            .barline
            .as_ref()
            .unwrap()
            .barline_type,
        BarlineType::Tick
    );
    assert_eq!(
        score.global.measures[3]
            .barline
            .as_ref()
            .unwrap()
            .barline_type,
        BarlineType::Short
    );
}

#[test]
fn test_parse_chord_symbols_mnx_file() {
    use crate::model::chord_symbol::ChordQuality;
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/chord-symbols.mnx");
    let score = parse_mnx(json).expect("Failed to parse chord-symbols.mnx");

    // First measure: C, Dm, G7, Cmaj7
    let chords = score.parts[0].measures[0]
        .chord_symbols
        .as_ref()
        .expect("Expected chord symbols on first part measure");
    assert_eq!(chords.len(), 4);

    assert_eq!(chords[0].root.step, "C");
    assert_eq!(chords[0].quality, ChordQuality::Major);
    assert_eq!(chords[0].display_text(), "C");

    assert_eq!(chords[1].root.step, "D");
    assert_eq!(chords[1].quality, ChordQuality::Minor);
    assert_eq!(chords[1].display_text(), "Dm");

    assert_eq!(chords[2].root.step, "G");
    assert_eq!(chords[2].quality, ChordQuality::Dominant);
    assert_eq!(chords[2].extension, Some(7));
    assert_eq!(chords[2].display_text(), "G7");

    assert_eq!(chords[3].root.step, "C");
    assert_eq!(chords[3].quality, ChordQuality::Major);
    assert_eq!(chords[3].extension, Some(7));
    assert_eq!(chords[3].display_text(), "Cmaj7");

    // Second measure: Am7, Bbmaj7, F
    let chords2 = score.parts[0].measures[1]
        .chord_symbols
        .as_ref()
        .expect("Expected chord symbols on second part measure");
    assert_eq!(chords2.len(), 3);
    assert_eq!(chords2[1].root.step, "B");
    assert_eq!(chords2[1].root.alter, Some(-1));
    assert_eq!(chords2[1].display_text(), "Bbmaj7");

    // Third measure: F#dim, Dsus4, C/E
    let chords3 = score.parts[0].measures[2]
        .chord_symbols
        .as_ref()
        .expect("Expected chord symbols on third part measure");
    assert_eq!(chords3.len(), 3);
    assert_eq!(chords3[0].root.alter, Some(1));
    assert_eq!(chords3[0].display_text(), "F#dim");
    assert_eq!(chords3[1].display_text(), "Dsus4");
    assert_eq!(chords3[2].bass.as_ref().unwrap().step, "E");
    assert_eq!(chords3[2].display_text(), "C/E");

    // Fourth measure: Eaug, Cadd9 (text override)
    let chords4 = score.parts[0].measures[3]
        .chord_symbols
        .as_ref()
        .expect("Expected chord symbols on fourth part measure");
    assert_eq!(chords4.len(), 2);
    assert_eq!(chords4[0].display_text(), "Eaug");
    assert_eq!(chords4[1].text_override, Some("Cadd9".to_string()));
    assert_eq!(chords4[1].display_text(), "Cadd9");
}

// ═══════════════════════════════════════
// _x.viritura on GlobalMeasure
// ═══════════════════════════════════════

#[test]
fn test_parse_global_measure_vendor_extensions_rehearsal_mark() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "A", "style": "boxed"}}}
        }]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let gm = &score.global.measures[0];
    let mark = gm
        .rehearsal_mark()
        .expect("Should have rehearsal mark via _x.viritura");
    assert_eq!(mark.text, "A");
    assert_eq!(
        mark.style,
        Some(crate::model::direction::RehearsalMarkStyle::Boxed)
    );
}

#[test]
fn test_parse_global_measure_vendor_extensions_coda() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "_x": {"viritura": {"coda": {"location": {"fraction": [0, 1]}}}}
        }]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let coda = score.global.measures[0]
        .coda()
        .expect("Should have coda via _x.viritura");
    assert_eq!(coda.location.fraction, (0, 1));
}

#[test]
fn test_parse_event_markings_vendor_extensions_caesura() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "whole"},
             "notes": [{"pitch": {"step": "C", "octave": 5}}],
             "markings": {"_x": {"viritura": {"caesura": {"style": "thick"}}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let e = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    let m = e.markings.as_ref().expect("Expected markings");
    let caesura = m
        .caesura
        .as_ref()
        .expect("Expected caesura on event markings");
    assert_eq!(
        caesura.style,
        Some(crate::model::direction::CaesuraStyle::Thick)
    );
}

#[test]
fn test_parse_global_measure_vendor_extensions_empty() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let gm = &score.global.measures[0];
    assert!(gm.rehearsal_mark().is_none());
    assert!(gm.coda().is_none());
}

#[test]
fn test_parse_global_measure_vendor_extensions_from_mnx_file() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/rehearsal-marks.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    assert!(score.global.measures[0].rehearsal_mark().is_some());
    assert_eq!(score.global.measures[0].rehearsal_mark().unwrap().text, "A");
    assert!(score.global.measures[1].rehearsal_mark().is_none());
    assert!(score.global.measures[2].rehearsal_mark().is_some());
    assert_eq!(score.global.measures[2].rehearsal_mark().unwrap().text, "B");
}

// ═══════════════════════════════════════
// _x.viritura on PartMeasure
// ═══════════════════════════════════════

#[test]
fn test_parse_vendor_ext_pedals() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "rest": {}}
            ]}],
            "_x": {
                "viritura": {
                    "pedals": [{
                        "type": "sustain",
                        "position": {"fraction": [0, 1]},
                        "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
                    }]
                }
            }
        }]}]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse _x.viritura pedals");
    let pedals = score.parts[0].measures[0]
        .pedals
        .as_ref()
        .expect("Expected pedals from _x.viritura");
    assert_eq!(pedals.len(), 1);
}

#[test]
fn test_parse_vendor_ext_chord_symbols() {
    use crate::model::chord_symbol::ChordQuality;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "rest": {}}
            ]}],
            "_x": {
                "viritura": {
                    "chordSymbols": [{
                        "position": {"fraction": [0, 1]},
                        "root": {"step": "C"},
                        "quality": "major"
                    }]
                }
            }
        }]}]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse _x.viritura chordSymbols");
    let chords = score.parts[0].measures[0]
        .chord_symbols
        .as_ref()
        .expect("Expected chord symbols from _x.viritura");
    assert_eq!(chords.len(), 1);
    assert_eq!(chords[0].root.step, "C");
    assert_eq!(chords[0].quality, ChordQuality::Major);
}

#[test]
fn test_parse_vendor_ext_expressions() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "rest": {}}
            ]}],
            "_x": {
                "viritura": {
                    "expressions": [{
                        "text": "dolce",
                        "position": {"fraction": [0, 1]}
                    }]
                }
            }
        }]}]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse _x.viritura expressions");
    let exprs = score.parts[0].measures[0]
        .expressions
        .as_ref()
        .expect("Expected expressions from _x.viritura");
    assert_eq!(exprs.len(), 1);
    assert_eq!(exprs[0].text, "dolce");
}

#[test]
fn test_parse_top_level_extensions_backward_compat() {
    // Top-level extension fields still work when no _x.viritura
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "rest": {}}
            ]}],
            "pedals": [{
                "type": "sustain",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
            }]
        }]}]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse top-level pedals");
    let pedals = score.parts[0].measures[0]
        .pedals
        .as_ref()
        .expect("Expected pedals from top-level");
    assert_eq!(pedals.len(), 1);
}

#[test]
fn test_parse_no_extensions_returns_none() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "rest": {}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse");
    assert!(score.parts[0].measures[0].pedals.is_none());
    assert!(score.parts[0].measures[0].chord_symbols.is_none());
    assert!(score.parts[0].measures[0].expressions.is_none());
}

// ═══════════════════════════════════════════
// EventMarkings _x.viritura parsing
// ═══════════════════════════════════════════

#[test]
fn test_parse_fermata_native() {
    use crate::model::event::FermataSymbol;
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "fermata": {"symbol": "square"}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse native fermata");
    let e = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    let f = e.fermata.as_ref().expect("Expected fermata");
    assert_eq!(f.symbol, Some(FermataSymbol::Square));
}

#[test]
fn test_parse_fermata_default_symbol() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "half"},
             "notes": [{"pitch": {"step": "E", "octave": 4}}],
             "fermata": {}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse");
    let e = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();
    let f = e.fermata.as_ref().expect("Expected fermata");
    assert!(
        f.symbol.is_none(),
        "Default symbol should be unset (renders as Normal)"
    );
}

#[test]
fn test_parse_trill_from_vendor_ext() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "D", "octave": 5}}],
             "markings": {"_x": {"viritura": {"trill": {"accidental": -1}}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse trill _x.viritura");
    let m = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap()
        .markings
        .as_ref()
        .unwrap();
    let t = m.trill.as_ref().expect("Expected trill");
    assert_eq!(t.accidental, Some(-1));
}

#[test]
fn test_parse_ornaments_from_vendor_ext() {
    use crate::model::event::OrnamentType;
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"_x": {"viritura": {"ornaments": ["mordent", "turn"]}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse ornaments _x.viritura");
    let m = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap()
        .markings
        .as_ref()
        .unwrap();
    let o = m.ornaments.as_ref().expect("Expected ornaments");
    assert_eq!(o.len(), 2);
    assert_eq!(o[0], OrnamentType::Mordent);
    assert_eq!(o[1], OrnamentType::Turn);
}

#[test]
fn test_parse_arpeggio_from_vendor_ext() {
    use crate::model::event::ArpeggioDirection;
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "half"},
             "notes": [{"pitch": {"step": "C", "octave": 4}}, {"pitch": {"step": "E", "octave": 4}}],
             "markings": {"_x": {"viritura": {"arpeggio": {"direction": "down"}}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse arpeggio _x.viritura");
    let m = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap()
        .markings
        .as_ref()
        .unwrap();
    let a = m.arpeggio.as_ref().expect("Expected arpeggio");
    assert_eq!(a.direction, Some(ArpeggioDirection::Down));
}

#[test]
fn test_parse_standard_arpeggio_and_non_arpeggio() {
    use crate::model::event::ArpeggioDirection;
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "arpeggios": [{
                "position": {"fraction": [0, 1]},
                "span": {"start": "n1", "end": "n3"},
                "direction": "up",
                "arrow": true
            }],
            "nonArpeggios": [{
                "position": {"fraction": [1, 2]},
                "span": {"start": "n4", "end": "n5"}
            }],
            "sequences": [{"content": [
                {"type": "event", "duration": {"base": "half"},
                 "notes": [
                    {"id": "n1", "pitch": {"step": "C", "octave": 4}},
                    {"id": "n2", "pitch": {"step": "E", "octave": 4}},
                    {"id": "n3", "pitch": {"step": "G", "octave": 4}}
                 ]},
                {"type": "event", "duration": {"base": "half"},
                 "notes": [
                    {"id": "n4", "pitch": {"step": "D", "octave": 4}},
                    {"id": "n5", "pitch": {"step": "F", "octave": 4}}
                 ]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse standard arpeggio fields");
    let measure = &score.parts[0].measures[0];
    let arpeggio = measure
        .arpeggios
        .as_ref()
        .expect("Expected arpeggio")
        .first()
        .unwrap();
    assert_eq!(arpeggio.span.start, "n1");
    assert_eq!(arpeggio.span.end, "n3");
    assert_eq!(arpeggio.direction, Some(ArpeggioDirection::Up));
    assert_eq!(arpeggio.arrow, Some(true));
    let non_arpeggio = measure
        .non_arpeggios
        .as_ref()
        .expect("Expected non-arpeggio")
        .first()
        .unwrap();
    assert_eq!(non_arpeggio.span.start, "n4");
    assert_eq!(non_arpeggio.span.end, "n5");
}

#[test]
fn test_parse_fingerings_from_vendor_ext() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"_x": {"viritura": {"fingerings": [{"finger": 3}, {"finger": 1}]}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse fingerings _x.viritura");
    let m = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap()
        .markings
        .as_ref()
        .unwrap();
    let f = m.fingerings.as_ref().expect("Expected fingerings");
    assert_eq!(f.len(), 2);
    assert_eq!(f[0].finger, 3);
    assert_eq!(f[1].finger, 1);
}

#[test]
fn test_parse_mixed_standard_and_extension_markings() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "fermata": {},
             "markings": {"staccato": {}, "accent": {}, "_x": {"viritura": {"trill": {}}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse mixed markings");
    let e = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();
    let m = e.markings.as_ref().unwrap();
    assert!(m.staccato.is_some(), "staccato should be present");
    assert!(m.accent.is_some(), "accent should be present");
    assert!(e.fermata.is_some(), "fermata should be present");
    assert!(m.trill.is_some(), "trill should be present");
    assert!(m.arpeggio.is_none(), "arpeggio should be absent");
}

#[test]
fn test_parse_fermata_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/fermatas.mnx");
    let score = parse_mnx(json).expect("Failed to parse fermatas.mnx");
    // At least one event should have a fermata marking
    let has_fermata = score.parts[0].measures.iter().any(|m| {
        m.sequences.iter().any(|s| {
            s.content
                .iter()
                .any(|c| c.as_event().is_some_and(|e| e.fermata.is_some()))
        })
    });
    assert!(has_fermata, "fermatas.mnx should have at least one fermata");
}

#[test]
fn test_parse_arpeggio_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/arpeggios.mnx");
    let score = parse_mnx(json).expect("Failed to parse arpeggios.mnx");
    let has_arpeggio = score.parts[0]
        .measures
        .iter()
        .any(|m| m.arpeggios.as_ref().is_some_and(|a| !a.is_empty()));
    assert!(
        has_arpeggio,
        "arpeggios.mnx should have at least one arpeggio"
    );
}

#[test]
fn test_parse_trill_mnx_file() {
    let json = include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/trill.mnx");
    let score = parse_mnx(json).expect("Failed to parse trill.mnx");
    let has_trill = score.parts[0].measures.iter().any(|m| {
        m.sequences.iter().any(|s| {
            s.content.iter().any(|c| {
                c.as_event()
                    .is_some_and(|e| e.markings.as_ref().is_some_and(|mk| mk.trill.is_some()))
            })
        })
    });
    assert!(has_trill, "trill.mnx should have at least one trill");
}

#[test]
fn test_parse_ornaments_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/ornaments.mnx");
    let score = parse_mnx(json).expect("Failed to parse ornaments.mnx");
    let has_ornaments = score.parts[0].measures.iter().any(|m| {
        m.sequences.iter().any(|s| {
            s.content.iter().any(|c| {
                c.as_event()
                    .is_some_and(|e| e.markings.as_ref().is_some_and(|mk| mk.ornaments.is_some()))
            })
        })
    });
    assert!(
        has_ornaments,
        "ornaments.mnx should have at least one ornament"
    );
}

#[test]
fn test_parse_fingerings_mnx_file() {
    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/fingerings.mnx");
    let score = parse_mnx(json).expect("Failed to parse fingerings.mnx");
    let has_fingerings = score.parts[0].measures.iter().any(|m| {
        m.sequences.iter().any(|s| {
            s.content.iter().any(|c| {
                c.as_event().is_some_and(|e| {
                    e.markings
                        .as_ref()
                        .is_some_and(|mk| mk.fingerings.is_some())
                })
            })
        })
    });
    assert!(
        has_fingerings,
        "fingerings.mnx should have at least one fingering"
    );
}

#[test]
fn test_markings_serialization_roundtrip() {
    // Standard markings stay flat; trill/ornaments/etc still nest in _x.viritura.
    // Fermata is now a top-level MNX field (no longer under _x.viritura).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "event", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "fermata": {},
             "markings": {"staccato": {}, "_x": {"viritura": {"trill": {}}}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse");
    let serialized = serde_json::to_string(&score).expect("Failed to serialize");
    // Verify _x.viritura nesting is preserved for the still-vendor extensions
    assert!(
        serialized.contains("\"_x\""),
        "Serialized output should contain _x"
    );
    assert!(
        serialized.contains("\"viritura\""),
        "Serialized output should contain viritura"
    );
    assert!(
        serialized.contains("\"trill\""),
        "Serialized output should contain trill (still vendor)"
    );
    assert!(
        serialized.contains("\"fermata\""),
        "Serialized output should contain native fermata"
    );
    assert!(
        serialized.contains("\"staccato\""),
        "Serialized output should contain staccato"
    );
    // Re-parse the serialized output to verify round-trip
    let score2 = parse_mnx(&serialized).expect("Failed to re-parse serialized output");
    let e = score2.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .unwrap();
    let m = e.markings.as_ref().unwrap();
    assert!(m.staccato.is_some());
    assert!(e.fermata.is_some());
    assert!(m.trill.is_some());
}

// ═══════════════════════════════════════════
// Event glissando _x.viritura parsing
// ═══════════════════════════════════════════

#[test]
fn test_parse_glissando_from_vendor_ext() {
    use crate::model::event::GlissandoStyle;

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
                            "id": "ev1",
                            "duration": {"base": "quarter"},
                            "notes": [{"pitch": {"step": "C", "octave": 4}}],
                            "_x": {
                                "viritura": {
                                    "glissandos": [
                                        {"target": "ev2", "style": "straight"}
                                    ]
                                }
                            }
                        },
                        {
                            "id": "ev2",
                            "duration": {"base": "quarter"},
                            "notes": [{"pitch": {"step": "E", "octave": 5}}]
                        }
                    ]
                }]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse MNX with _x.viritura glissandos");
    let seq = &score.parts[0].measures[0].sequences[0];
    let ev1 = seq.content[0].as_event().expect("Expected event");
    let glissandos = ev1
        .glissandos
        .as_ref()
        .expect("Expected glissandos from _x.viritura");
    assert_eq!(glissandos.len(), 1);
    assert_eq!(glissandos[0].target, "ev2");
    assert_eq!(glissandos[0].style, GlissandoStyle::Straight);
    assert!(glissandos[0].text.is_none());
}

#[test]
fn test_parse_glissando_vendor_ext_wavy_with_text() {
    use crate::model::event::GlissandoStyle;

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
                            "id": "ev1",
                            "duration": {"base": "half"},
                            "notes": [{"pitch": {"step": "D", "octave": 4}}],
                            "_x": {
                                "viritura": {
                                    "glissandos": [
                                        {"target": "ev2", "style": "wavy", "text": "gliss."}
                                    ]
                                }
                            }
                        },
                        {
                            "id": "ev2",
                            "duration": {"base": "half"},
                            "notes": [{"pitch": {"step": "B", "octave": 4}}]
                        }
                    ]
                }]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    let ev1 = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    let glissandos = ev1.glissandos.as_ref().expect("Expected glissandos");
    assert_eq!(glissandos[0].style, GlissandoStyle::Wavy);
    assert_eq!(glissandos[0].text.as_deref(), Some("gliss."));
}

#[test]
fn test_parse_glissando_vendor_ext_default_style() {
    use crate::model::event::GlissandoStyle;

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
                            "id": "ev1",
                            "duration": {"base": "quarter"},
                            "notes": [{"pitch": {"step": "C", "octave": 4}}],
                            "_x": {
                                "viritura": {
                                    "glissandos": [{"target": "ev2"}]
                                }
                            }
                        },
                        {
                            "id": "ev2",
                            "duration": {"base": "quarter"},
                            "notes": [{"pitch": {"step": "G", "octave": 4}}]
                        }
                    ]
                }]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    let ev1 = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    let glissandos = ev1.glissandos.as_ref().expect("Expected glissandos");
    // Default style should be Straight when omitted
    assert_eq!(glissandos[0].style, GlissandoStyle::Straight);
}

#[test]
fn test_parse_glissando_mnx_file() {
    use crate::model::event::GlissandoStyle;

    let json =
        include_str!("../../../viritura-wasm/../../packages/format/fixtures/mnx/glissando.mnx");
    let score = parse_mnx(json).expect("Failed to parse glissando.mnx");

    // First measure has 4 events: ev1 (straight gliss to ev2), ev2, ev3 (wavy gliss to ev4), ev4
    let seq = &score.parts[0].measures[0].sequences[0];
    assert_eq!(seq.content.len(), 4);

    // Event ids are opaque UUIDs post-migration; verify each glissando target
    // references the correct sibling event by its (migrated) id.
    let ev1 = seq.content[0].as_event().expect("Expected event");
    let ev2 = seq.content[1].as_event().expect("Expected event");
    assert!(ev1.id.is_some());
    let g1 = ev1.glissandos.as_ref().expect("Expected glissandos on ev1");
    assert_eq!(g1.len(), 1);
    assert_eq!(g1[0].target.as_str(), ev2.id.as_deref().unwrap());
    assert_eq!(g1[0].style, GlissandoStyle::Straight);

    let ev3 = seq.content[2].as_event().expect("Expected event");
    let ev4 = seq.content[3].as_event().expect("Expected event");
    assert!(ev3.id.is_some());
    let g3 = ev3.glissandos.as_ref().expect("Expected glissandos on ev3");
    assert_eq!(g3[0].target.as_str(), ev4.id.as_deref().unwrap());
    assert_eq!(g3[0].style, GlissandoStyle::Wavy);

    // Second measure: ev5 has straight gliss with text "gliss."
    let seq2 = &score.parts[0].measures[1].sequences[0];
    let ev5 = seq2.content[0].as_event().expect("Expected event");
    let g5 = ev5.glissandos.as_ref().expect("Expected glissandos on ev5");
    assert_eq!(g5[0].style, GlissandoStyle::Straight);
    assert_eq!(g5[0].text.as_deref(), Some("gliss."));

    // Third measure: ev7 has wavy gliss with text "gliss."
    let seq3 = &score.parts[0].measures[2].sequences[0];
    let ev7 = seq3.content[0].as_event().expect("Expected event");
    let g7 = ev7.glissandos.as_ref().expect("Expected glissandos on ev7");
    assert_eq!(g7[0].style, GlissandoStyle::Wavy);
    assert_eq!(g7[0].text.as_deref(), Some("gliss."));
}

#[test]
fn test_parse_event_without_vendor_ext_still_works() {
    // Ensure events without _x.viritura still parse correctly
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
                            "duration": {"base": "whole"},
                            "notes": [{"pitch": {"step": "C", "octave": 4}}]
                        }
                    ]
                }]
            }]
        }]
    }"#;

    let score = parse_mnx(json).expect("parse failed");
    let ev = score.parts[0].measures[0].sequences[0].content[0]
        .as_event()
        .expect("Expected event");
    assert!(ev.glissandos.is_none());
    assert!(!ev.is_rest());
}

// ═══════════════════════════════════════════
// strict-mode parse (validate + serde sandwich)
// ═══════════════════════════════════════════

#[test]
fn test_parse_strict_accepts_minimal_valid_mnx() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": []},
        "parts": []
    }"#;
    let score = parse_mnx_strict(json).expect("minimal MNX should parse strict");
    assert_eq!(score.mnx.version, 1);
    assert!(score.global.measures.is_empty());
    assert!(score.parts.is_empty());
}

#[test]
fn test_parse_strict_rejects_empty_object() {
    let err = parse_mnx_strict("{}").expect_err("empty object should fail strict parse");
    match err {
        ParseMnxStrictError::Validation(failure) => {
            assert!(
                !failure.errors.is_empty(),
                "expected schema errors for empty object"
            );
        }
        ParseMnxStrictError::Deserialize(_) => panic!("expected validation error, got deserialise"),
        ParseMnxStrictError::Promote(_) => panic!("expected validation error, got promote"),
    }
}

#[test]
fn test_parse_strict_rejects_non_json() {
    // Junk input fails at the serde_json::from_str step, before validation.
    let err = parse_mnx_strict("not json").expect_err("non-JSON should fail");
    matches!(err, ParseMnxStrictError::Deserialize(_));
}

#[test]
fn test_parse_strict_rejects_partial_document() {
    // Lenient parse_mnx tolerates missing parts because the model defaults
    // them; strict parse must reject (the schema requires `parts`).
    let json = r#"{ "mnx": {"version": 1}, "global": {"measures": []} }"#;
    let err = parse_mnx_strict(json).expect_err("missing parts should fail strict parse");
    matches!(err, ParseMnxStrictError::Validation(_));
}

#[test]
fn test_parse_strict_round_trips_all_fixtures() {
    // Every committed fixture in packages/format/fixtures/mnx/ must round-
    // trip cleanly through the strict pipeline. If this regresses, either
    // the schema and the engine's Score model have drifted, or a fixture is
    // not actually MNX-conformant (which validate_mnx.py would also catch
    // in CI).
    let workspace = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root resolvable")
        .to_path_buf();
    let scores_dir = workspace.join("packages/format/fixtures/mnx");
    let entries = std::fs::read_dir(&scores_dir).expect("scores dir exists");
    let mut checked = 0usize;
    let mut failures: Vec<(String, String)> = Vec::new();
    for entry in entries {
        let entry = entry.expect("dir entry readable");
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("mnx") {
            continue;
        }
        let text = std::fs::read_to_string(&path).expect("fixture readable");
        if let Err(e) = parse_mnx_strict(&text) {
            failures.push((
                path.file_name().unwrap().to_string_lossy().into_owned(),
                e.to_string(),
            ));
        }
        checked += 1;
    }
    assert!(checked >= 50, "expected ~71 fixtures, found {checked}");
    assert!(
        failures.is_empty(),
        "{} fixture(s) failed strict parse:\n{}",
        failures.len(),
        failures
            .iter()
            .map(|(name, msg)| format!("  - {name}: {msg}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}
