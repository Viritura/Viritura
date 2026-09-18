use std::collections::HashSet;

use super::{LuaMapper, LuaMapperConfig};
use crate::mapper::{
    compile_and_dispatch, Articulations, MidiMessage, NotationNote, PlaybackEvent, PlayingState,
    ScheduledMidi,
};

fn note_event(time: f64) -> PlaybackEvent {
    PlaybackEvent::NoteOn {
        time,
        note: NotationNote {
            id: "score-note".to_owned(),
            start_time: time,
            duration: 1.0,
            pitch: 60,
            dynamics: 0.8,
            articulations: Articulations::default(),
            state: PlayingState::default(),
        },
    }
}

fn assert_voices(actions: &[ScheduledMidi], expected: &[(f64, f64, u8, u8)]) {
    assert_eq!(actions.len(), expected.len() * 2);
    let mut ids = HashSet::new();
    for &(start, end, pitch, channel) in expected {
        let on = actions
            .iter()
            .find(|action| {
                action.at_seconds == start
                    && matches!(
                        action.message,
                        MidiMessage::NoteOn { note, channel: ch, .. }
                            if note == pitch && ch == channel
                    )
            })
            .expect("expected mapped note-on");
        let MidiMessage::NoteOn { note_id, .. } = &on.message else {
            unreachable!()
        };
        assert!(ids.insert(note_id), "output voice ID reused: {note_id}");
        let offs: Vec<_> = actions
            .iter()
            .filter(|action| {
                matches!(&action.message, MidiMessage::NoteOff { note_id: id } if id == note_id)
            })
            .map(|action| action.at_seconds)
            .collect();
        assert_eq!(
            offs,
            [end],
            "each emitted voice must retain its own release"
        );
    }
}

#[test]
fn repeated_score_ids_keep_input_identity_but_emit_distinct_paired_voices() {
    let source = r#"
        function note_on(time, note)
            assert(note.id == "score-note")
            midi.note({ startTime = time, endTime = time + note.duration,
                        pitch = note.pitch, velocity = 96, channel = 0, id = note.id })
            assert(note.id == "score-note")
        end
        function note_off(time, note)
            assert(note.id == "score-note")
        end
    "#;
    let first = note_event(0.0);
    let PlaybackEvent::NoteOn { note, .. } = &first else {
        unreachable!()
    };
    let events = [
        first.clone(),
        PlaybackEvent::NoteOff {
            time: 1.0,
            note: note.clone(),
        },
        note_event(2.0),
        note_event(4.0),
    ];
    let actions = compile_and_dispatch(source, &events).unwrap();
    assert_voices(
        &actions,
        &[(0.0, 1.0, 60, 0), (2.0, 3.0, 60, 0), (4.0, 5.0, 60, 0)],
    );
    assert!(matches!(
        &actions[0].message,
        MidiMessage::NoteOn { note_id, .. } if note_id == "score-note"
    ));
    assert_eq!(actions, compile_and_dispatch(source, &events).unwrap());
}

#[test]
fn layered_voices_pair_before_sort_even_when_release_order_and_pitch_differ() {
    let source = r#"
        function note_on(time, note)
            midi.note({ startTime = 3, endTime = 8,
                        pitch = note.pitch, velocity = 96, channel = 0, id = note.id })
            midi.note({ startTime = 1, endTime = 6,
                        pitch = note.pitch, velocity = 96, channel = 0, id = note.id })
            midi.note({ startTime = 2, endTime = 4,
                        pitch = note.pitch + 12, velocity = 96, channel = 1, id = note.id })
        end
    "#;
    let actions = compile_and_dispatch(source, &[note_event(0.0)]).unwrap();
    assert_voices(
        &actions,
        &[(1.0, 6.0, 60, 0), (2.0, 4.0, 72, 1), (3.0, 8.0, 60, 0)],
    );
    assert!(actions
        .windows(2)
        .all(|pair| pair[0].at_seconds <= pair[1].at_seconds));
}

#[test]
fn explicit_ids_and_automatic_keyswitch_ids_never_collide_in_either_order() {
    for keyswitch_first in [true, false] {
        let keyswitch = "midi.keyswitch(0, 24, 0)";
        let explicit = r#"
            midi.note({ startTime = 1, endTime = 2,
                        pitch = 60, velocity = 96, channel = 0, id = "generated-note-0" })
        "#;
        let body = if keyswitch_first {
            format!("{keyswitch}\n{explicit}")
        } else {
            format!("{explicit}\n{keyswitch}")
        };
        let source = format!(
            r#"
            function reset(time)
                {body}
                midi.note({{ startTime = 3, endTime = 4,
                             pitch = 61, velocity = 96, channel = 0, id = "generated-note-1" }})
                midi.note({{ startTime = 5, endTime = 6,
                             pitch = 62, velocity = 96, channel = 0 }})
                midi.note({{ startTime = 7, endTime = 8,
                             pitch = 63, velocity = 96, channel = 0, id = "" }})
            end
            "#
        );
        let events = [PlaybackEvent::Reset { time: 0.0 }];
        let actions = compile_and_dispatch(&source, &events).unwrap();
        assert_voices(
            &actions,
            &[
                (0.0, 0.01, 24, 0),
                (1.0, 2.0, 60, 0),
                (3.0, 4.0, 61, 0),
                (5.0, 6.0, 62, 0),
                (7.0, 8.0, 63, 0),
            ],
        );
        assert_eq!(actions, compile_and_dispatch(&source, &events).unwrap());
    }
}

#[test]
fn output_identity_survives_separate_dispatches_and_script_reset() {
    let mut mapper = LuaMapper::new(
        r#"
        function reset(time) state = {} end
        function note_on(time, note)
            midi.note({ startTime = time, endTime = time + note.duration,
                        pitch = note.pitch, velocity = 96, channel = 0, id = note.id })
        end
        "#,
        LuaMapperConfig::default(),
    )
    .unwrap();
    let mut actions = mapper.dispatch(&note_event(0.0)).unwrap();
    mapper
        .dispatch_into(&PlaybackEvent::Reset { time: 1.0 }, &mut actions)
        .unwrap();
    actions.extend(mapper.dispatch_all(&[note_event(2.0)]).unwrap());
    assert_voices(&actions, &[(0.0, 1.0, 60, 0), (2.0, 3.0, 60, 0)]);
}
