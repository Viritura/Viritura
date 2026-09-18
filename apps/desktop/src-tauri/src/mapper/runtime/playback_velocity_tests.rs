use super::{LuaMapper, LuaMapperConfig, LuaMapperError};
use crate::mapper::{
    compile_and_dispatch, Articulations, MidiMessage, NotationNote, PlaybackEvent,
    PlaybackVelocityEndpoint, PlaybackVelocityInterpolation, PlayingState, ScheduledMidi,
};

#[derive(Clone, Copy)]
enum Family {
    Piano,
    Strings,
    Brass,
    BrassOpen,
    Winds,
}

const MAPPERS: [(&str, &str, Family); 6] = [
    (
        "piano",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../editor/public/articulations/piano_basic.lua"
        )),
        Family::Piano,
    ),
    (
        "strings",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../editor/public/articulations/hollywood_strings_basic.lua"
        )),
        Family::Strings,
    ),
    (
        "brass",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../editor/public/articulations/hollywood_brass_basic.lua"
        )),
        Family::Brass,
    ),
    (
        "brass open",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../editor/public/articulations/hollywood_brass_open_basic.lua"
        )),
        Family::BrassOpen,
    ),
    (
        "winds",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../editor/public/articulations/hollywood_winds_basic.lua"
        )),
        Family::Winds,
    ),
    (
        "opus fixture",
        include_str!("../fixtures/opus_violin.lua"),
        Family::Strings,
    ),
];

fn note(playback_velocity: Option<u8>) -> NotationNote {
    NotationNote {
        id: "score-note".to_owned(),
        start_time: 1.0,
        duration: 1.0,
        pitch: 60,
        dynamics: 100.0 / 127.0,
        playback_velocity,
        playback_velocity_interpolation: None,
        articulations: Articulations::default(),
        state: PlayingState::default(),
    }
}

fn note_events(note: &NotationNote) -> [PlaybackEvent; 2] {
    [
        PlaybackEvent::NoteOn {
            time: note.start_time,
            note: note.clone(),
        },
        PlaybackEvent::NoteOff {
            time: note.start_time + note.duration,
            note: note.clone(),
        },
    ]
}

fn performance(note: &NotationNote) -> [PlaybackEvent; 9] {
    let [on, off] = note_events(note);
    [
        PlaybackEvent::Reset { time: 0.0 },
        PlaybackEvent::Dynamics {
            time: 0.0,
            value: 0.25,
        },
        PlaybackEvent::Technique {
            time: 0.0,
            state: note.state,
        },
        on,
        PlaybackEvent::Dynamics {
            time: note.start_time + 0.125,
            value: 0.5,
        },
        PlaybackEvent::Technique {
            time: note.start_time + 0.25,
            state: PlayingState {
                con_sordino: !note.state.con_sordino,
                ..note.state
            },
        },
        off,
        PlaybackEvent::Dynamics {
            time: note.start_time + note.duration + 0.125,
            value: 0.25,
        },
        PlaybackEvent::Technique {
            time: note.start_time + note.duration + 0.25,
            state: PlayingState::default(),
        },
    ]
}

fn cc(time: f64, channel: u8, controller: u8, value: u8) -> ScheduledMidi {
    ScheduledMidi::clamped(
        time,
        MidiMessage::ControlChange {
            channel,
            controller,
            value,
        },
    )
}

fn on(time: f64, id: &str, channel: u8, pitch: u8, velocity: u8) -> ScheduledMidi {
    ScheduledMidi::clamped(
        time,
        MidiMessage::NoteOn {
            note_id: id.to_owned(),
            channel,
            note: pitch,
            velocity,
        },
    )
}

fn off(time: f64, id: &str) -> ScheduledMidi {
    ScheduledMidi::clamped(
        time,
        MidiMessage::NoteOff {
            note_id: id.to_owned(),
        },
    )
}

fn legacy_actions(family: Family, note: &NotationNote) -> Vec<ScheduledMidi> {
    let piano = matches!(family, Family::Piano);
    let strings = matches!(family, Family::Strings);
    let pizzicato = strings && note.state.pizzicato;
    let staccato = note.articulations.staccato || note.articulations.staccatissimo;
    let patch = if pizzicato {
        3
    } else if staccato {
        2
    } else if note.duration > 0.75 {
        1
    } else {
        0
    };
    let channel = if piano {
        1
    } else {
        patch
            + u8::from(matches!(family, Family::Brass | Family::BrassOpen))
            + if matches!(family, Family::Brass) && note.state.con_sordino {
                3
            } else {
                0
            }
    };
    let expression = (note.dynamics * 127.0 + 0.5).floor() as u8;
    let velocity = if piano || staccato || pizzicato {
        expression.max(1)
    } else {
        96
    };
    let mut actions = Vec::new();
    if strings {
        actions.push(cc(
            note.start_time - 0.03,
            channel,
            15,
            if note.state.con_sordino { 127 } else { 0 },
        ));
    }
    if !piano {
        actions.push(cc(note.start_time - 0.03, channel, 11, expression));
    }
    actions.push(on(note.start_time, &note.id, channel, note.pitch, velocity));
    if !piano {
        actions.push(cc(note.start_time + 0.125, channel, 11, 64));
    }
    if strings {
        actions.push(cc(
            note.start_time + 0.25,
            channel,
            15,
            if note.state.con_sordino { 0 } else { 127 },
        ));
    }
    actions.push(off(note.start_time + note.duration, &note.id));
    actions
}

fn assert_shipped_mapping(name: &str, source: &str, family: Family, note: &NotationNote) {
    let baseline = compile_and_dispatch(source, &performance(note)).unwrap();
    assert_eq!(baseline, legacy_actions(family, note), "{name}: {note:?}");
    for velocity in [1, 96, 127] {
        let mut explicit = note.clone();
        explicit.playback_velocity = Some(velocity);
        let mut expected = baseline.clone();
        let mut changed = 0;
        for action in &mut expected {
            if let MidiMessage::NoteOn {
                note_id,
                velocity: mapped,
                ..
            } = &mut action.message
            {
                assert_eq!(note_id, &note.id);
                *mapped = velocity;
                changed += 1;
            }
        }
        assert_eq!(changed, 1);
        assert_eq!(
            compile_and_dispatch(source, &performance(&explicit)).unwrap(),
            expected,
            "{name}: {explicit:?}"
        );
    }
}

#[test]
fn shipped_mappers_use_explicit_velocity_without_changing_other_midi() {
    for (name, source, family) in MAPPERS {
        for (duration, staccato, staccatissimo, pizzicato) in [
            (0.5, false, false, false),
            (0.75, false, false, false),
            (0.750001, false, false, false),
            (1.25, true, false, false),
            (1.25, false, true, false),
            (1.25, false, false, true),
            (1.25, true, true, true),
        ] {
            for (start_time, con_sordino, dynamics) in [
                (0.0, false, 100.0 / 127.0),
                (1.0, true, 100.0 / 127.0),
                (1.0, false, 0.0),
                (1.0, false, 0.5),
                (1.0, true, 1.0),
            ] {
                let note = NotationNote {
                    start_time,
                    duration,
                    dynamics,
                    articulations: Articulations {
                        staccato,
                        staccatissimo,
                        accent: true,
                        tenuto: true,
                        ..Articulations::default()
                    },
                    state: PlayingState {
                        pizzicato,
                        con_sordino,
                        ..PlayingState::default()
                    },
                    ..note(None)
                };
                assert_shipped_mapping(name, source, family, &note);
            }
        }
    }
}

#[test]
fn both_note_callbacks_receive_optional_velocity_and_detached_mutable_tables() {
    for playback_velocity in [None, Some(1), Some(96), Some(127)] {
        let expected = playback_velocity.map_or("nil".to_owned(), |value| value.to_string());
        let source = format!(
            r#"
            local function check(n)
                assert(rawget(n, "playbackVelocity") == {expected})
                assert(rawget(n, "playbackVelocityInterpolation") == nil)
                assert(n.playback_velocity == nil)
                if n.playbackVelocity ~= nil then
                    assert(math.type(n.playbackVelocity) == "integer")
                end
                assert(n.dynamics == 100 / 127)
                assert(n.id == "score-note" and n.pitch == 60)
                assert(n.startTime == 1 and n.duration == 1)
                assert(n.articulations.accent and n.state.conSordino)
            end
            local function mutate(n)
                n.playbackVelocity = 17
                n.dynamics = 0.125
                n.id = "changed"
                n.pitch = 10
                n.startTime = 9
                n.duration = 9
                n.articulations.accent = false
                n.state.conSordino = false
            end
            function note_on(time, n)
                assert(time == 1)
                check(n)
                state.on = n
                mutate(n)
            end
            function note_off(time, n)
                assert(time == 2)
                check(n)
                assert(n ~= state.on)
                assert(n.articulations ~= state.on.articulations)
                assert(n.state ~= state.on.state)
                assert(state.on.playbackVelocity == 17 and state.on.dynamics == 0.125)
                mutate(n)
            end
            "#
        );
        let mut note = note(playback_velocity);
        note.articulations.accent = true;
        note.state.con_sordino = true;
        let original_note = note.clone();
        let events = note_events(&note);
        let original_events = events.clone();
        let mut mapper = LuaMapper::new(&source, LuaMapperConfig::default()).unwrap();
        for _ in 0..2 {
            assert!(mapper.dispatch_all(&events).unwrap().is_empty());
            assert_eq!(events, original_events);
            assert_eq!(note, original_note);
        }
    }
}

fn custom_mapper(base_velocity: &str) -> String {
    r#"
    function note_on(time, n)
        local velocity = BASE_VELOCITY
        if n.articulations.accent then
            velocity = math.min(127, velocity + 11)
        end
        midi.keyswitch(time - 0.125, 24, 9)
        midi.cc(time - 0.0625, 11, math.floor(n.dynamics * 127 + 0.5), 2)
        midi.note({ startTime = time, endTime = time + n.duration,
                    pitch = n.pitch, velocity = velocity, channel = 2, id = n.id })
        midi.note({ startTime = time + 0.0625, endTime = time + n.duration + 0.125,
                    pitch = n.pitch + 12, velocity = 37, channel = 7, id = "aux" })
    end
    "#
    .replace("BASE_VELOCITY", base_velocity)
}

fn custom_actions(note: &NotationNote, velocity: u8) -> Vec<ScheduledMidi> {
    vec![
        on(note.start_time - 0.125, "generated-note-0", 9, 24, 1),
        off(note.start_time - 0.125 + 0.01, "generated-note-0"),
        cc(note.start_time - 0.0625, 2, 11, 100),
        on(note.start_time, &note.id, 2, note.pitch, velocity),
        on(note.start_time + 0.0625, "aux", 7, note.pitch + 12, 37),
        off(note.start_time + note.duration, &note.id),
        off(note.start_time + note.duration + 0.125, "aux"),
    ]
}

#[test]
fn legacy_custom_mapper_ignores_velocity_override_and_keeps_its_modulation() {
    let source = custom_mapper("math.max(1, math.floor(n.dynamics * 127 + 0.5))");
    for playback_velocity in [None, Some(1), Some(96), Some(127)] {
        for accent in [false, true] {
            let mut note = note(playback_velocity);
            note.articulations.accent = accent;
            let expected = custom_actions(&note, if accent { 111 } else { 100 });
            assert_eq!(
                compile_and_dispatch(&source, &note_events(&note)).unwrap(),
                expected,
                "{note:?}"
            );
            note.playback_velocity_interpolation = Some(interpolation(
                endpoint(100, Some(15)),
                endpoint(112, None),
                0.5,
            ));
            assert_eq!(
                compile_and_dispatch(&source, &note_events(&note)).unwrap(),
                expected,
                "legacy mapper must also ignore interpolation: {note:?}"
            );
        }
    }
}

#[test]
fn opted_in_custom_mapper_modulates_base_velocity_without_rewriting_other_voices() {
    let source =
        custom_mapper("n.playbackVelocity or math.max(1, math.floor(n.dynamics * 127 + 0.5))");
    for (playback_velocity, base, accented) in [
        (None, 100, 111),
        (Some(1), 1, 12),
        (Some(96), 96, 107),
        (Some(127), 127, 127),
    ] {
        for accent in [false, true] {
            let mut note = note(playback_velocity);
            note.articulations.accent = accent;
            let expected = custom_actions(&note, if accent { accented } else { base });
            assert_eq!(
                compile_and_dispatch(&source, &note_events(&note)).unwrap(),
                expected,
                "{note:?}"
            );
        }
    }
}

#[test]
fn dispatch_rejects_inaudible_or_out_of_range_velocity_before_either_callback() {
    let source = r#"
        function note_on(time, n)
            state.called = true
            midi.cc(time, 11, 42, 0)
        end
        note_off = note_on
        function reset(time) assert(state.called == nil) end
    "#;
    for velocity in [0, 128] {
        let mut mapper = LuaMapper::new(source, LuaMapperConfig::default()).unwrap();
        for event in note_events(&note(Some(velocity))) {
            let original = vec![cc(0.0, 0, 11, 64)];
            let mut output = original.clone();
            assert!(matches!(
                mapper.dispatch_into(&event, &mut output),
                Err(LuaMapperError::InvalidPlaybackEvent(_))
            ));
            assert_eq!(output, original);
        }
        assert!(mapper
            .dispatch(&PlaybackEvent::Reset { time: 0.0 })
            .unwrap()
            .is_empty());
        assert_eq!(
            mapper.dispatch_all(&note_events(&note(Some(96)))).unwrap(),
            vec![cc(1.0, 0, 11, 42), cc(2.0, 0, 11, 42)]
        );
    }
}

fn endpoint(dynamics: u8, playback_velocity: Option<u8>) -> PlaybackVelocityEndpoint {
    PlaybackVelocityEndpoint {
        dynamics: f64::from(dynamics) / 127.0,
        playback_velocity,
    }
}

fn interpolation(
    from: PlaybackVelocityEndpoint,
    to: PlaybackVelocityEndpoint,
    progress: f64,
) -> PlaybackVelocityInterpolation {
    PlaybackVelocityInterpolation { from, to, progress }
}

#[test]
fn shipped_mappers_interpolate_native_endpoints_without_changing_other_midi() {
    for (name, source, family) in MAPPERS {
        for (duration, staccato, staccatissimo, pizzicato) in [
            (0.5, false, false, false),
            (1.0, false, false, false),
            (1.0, true, false, false),
            (1.0, false, true, false),
            (1.0, false, false, true),
        ] {
            let velocity_sensitive = matches!(family, Family::Piano)
                || staccato
                || staccatissimo
                || (matches!(family, Family::Strings) && pizzicato);
            let forward = if velocity_sensitive {
                [100, 103, 106, 109, 112]
            } else {
                [100, 99, 98, 97, 96]
            };
            let reverse = if velocity_sensitive {
                [112, 109, 106, 103, 100]
            } else {
                [96, 97, 98, 99, 100]
            };
            for (from, to, velocities) in [
                (endpoint(100, Some(100)), endpoint(112, None), forward),
                (endpoint(112, None), endpoint(100, Some(100)), reverse),
                (
                    endpoint(100, Some(100)),
                    endpoint(112, Some(120)),
                    [100, 105, 110, 115, 120],
                ),
            ] {
                for (index, velocity) in velocities.into_iter().enumerate() {
                    let progress = index as f64 / 4.0;
                    let mut note = note(None);
                    // Eighth-note attacks across a two-beat ramp at 120 BPM.
                    note.start_time = 1.0 + index as f64 * 0.25;
                    note.duration = duration;
                    note.dynamics = from.dynamics + (to.dynamics - from.dynamics) * progress;
                    note.articulations.staccato = staccato;
                    note.articulations.staccatissimo = staccatissimo;
                    note.state.pizzicato = pizzicato;
                    note.state.con_sordino = true;
                    let mut expected = compile_and_dispatch(source, &performance(&note)).unwrap();
                    for action in &mut expected {
                        if let MidiMessage::NoteOn { velocity: v, .. } = &mut action.message {
                            *v = velocity;
                        }
                    }
                    if from.playback_velocity.is_some() && to.playback_velocity.is_some() {
                        note.playback_velocity = Some(velocity);
                    } else {
                        note.playback_velocity_interpolation =
                            Some(interpolation(from, to, progress));
                    }
                    assert_eq!(
                        compile_and_dispatch(source, &performance(&note)).unwrap(),
                        expected,
                        "{name}: {note:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn custom_attack_mapping_resolves_missing_endpoints_before_interpolating() {
    for (mapping, velocities) in [
        (
            "function(d) return math.floor(1 + 126 * d * d + 0.5) end",
            [101, 94, 87, 79, 72],
        ),
        ("37", [101, 85, 69, 53, 37]),
    ] {
        let source = custom_mapper(&format!("midi.attack_velocity(n, {mapping})"));
        for reverse in [false, true] {
            for (index, velocity) in velocities.into_iter().enumerate() {
                let from = PlaybackVelocityEndpoint {
                    dynamics: 0.25,
                    playback_velocity: Some(101),
                };
                let to = PlaybackVelocityEndpoint {
                    dynamics: 0.75,
                    playback_velocity: None,
                };
                let progress = index as f64 / 4.0;
                let ramp = if reverse {
                    interpolation(to, from, 1.0 - progress)
                } else {
                    interpolation(from, to, progress)
                };
                for accent in [false, true] {
                    let mut note = note(None);
                    note.articulations.accent = accent;
                    note.playback_velocity_interpolation = Some(ramp);
                    assert_eq!(
                        compile_and_dispatch(&source, &note_events(&note)).unwrap(),
                        custom_actions(&note, velocity + if accent { 11 } else { 0 }),
                        "{mapping}: {note:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn interpolation_callback_tables_are_fresh_at_every_nested_level() {
    let source = r#"
                local function check(n)
                    assert(n.playbackVelocity == nil)
                    assert(n.playback_velocity_interpolation == nil)
                    local ramp = n.playbackVelocityInterpolation
                    assert(ramp.progress == 0.25)
                    assert(ramp.from.dynamics == 100 / 127)
                    assert(ramp.from.playbackVelocity == 100)
                    assert(math.type(ramp.from.playbackVelocity) == "integer")
                    assert(ramp.to.dynamics == 112 / 127)
                    assert(rawget(ramp.to, "playbackVelocity") == nil)
                    assert(ramp.from ~= ramp.to)
                    if state.previous then
                        assert(ramp ~= state.previous)
                        assert(ramp.from ~= state.previous.from)
                        assert(ramp.to ~= state.previous.to)
                        assert(state.previous.progress == 0.875)
                        assert(state.previous.from.playbackVelocity == 10)
                        assert(state.previous.to.dynamics == 0)
                    end
                    assert(midi.attack_velocity(n, function(d)
                        assert(d == 112 / 127)
                        return 112
                    end) == 103)
                    state.previous = ramp
                    ramp.progress = 0.875
                    ramp.from.dynamics = 1
                    ramp.from.playbackVelocity = 10
                    ramp.to.dynamics = 0
                    ramp.to.playbackVelocity = 20
                end
                function note_on(time, n)
                    assert(time == 1)
                    check(n)
                end
                function note_off(time, n)
                    assert(time == 2)
                    check(n)
                end
            "#;
    let mut note = note(None);
    note.playback_velocity_interpolation = Some(interpolation(
        endpoint(100, Some(100)),
        endpoint(112, None),
        0.25,
    ));
    let events = note_events(&note);
    let original_events = events.clone();
    let mut mapper = LuaMapper::new(source, LuaMapperConfig::default()).unwrap();
    for _ in 0..2 {
        assert!(mapper.dispatch_all(&events).unwrap().is_empty());
        assert_eq!(events, original_events);
    }
}

#[test]
fn invalid_interpolation_is_rejected_before_either_callback_even_with_explicit_velocity() {
    let source = r#"
                function note_on(time, n)
                    state.called = true
                    midi.cc(time, 11, 42, 0)
                end
                note_off = note_on
                function reset(time) assert(state.called == nil) end
            "#;
    let base = interpolation(endpoint(100, Some(100)), endpoint(112, None), 0.5);
    let mut invalid = Vec::new();
    for value in [-0.001, 1.001, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in 0..3 {
            let mut ramp = base;
            match field {
                0 => ramp.progress = value,
                1 => ramp.from.dynamics = value,
                _ => ramp.to.dynamics = value,
            }
            invalid.push(ramp);
        }
    }
    for velocity in [0, 128, 255] {
        for from in [false, true] {
            let mut ramp = base;
            if from {
                ramp.from.playback_velocity = Some(velocity);
            } else {
                ramp.to.playback_velocity = Some(velocity);
            }
            invalid.push(ramp);
        }
    }
    for ramp in invalid {
        for playback_velocity in [None, Some(100)] {
            let mut note = note(playback_velocity);
            note.playback_velocity_interpolation = Some(ramp);
            let mut mapper = LuaMapper::new(source, LuaMapperConfig::default()).unwrap();
            for event in note_events(&note) {
                let original = vec![cc(0.0, 0, 11, 64)];
                let mut output = original.clone();
                assert!(matches!(
                    mapper.dispatch_into(&event, &mut output),
                    Err(LuaMapperError::InvalidPlaybackEvent(_))
                ));
                assert_eq!(output, original);
            }
            assert!(mapper
                .dispatch(&PlaybackEvent::Reset { time: 0.0 })
                .unwrap()
                .is_empty());
        }
    }
}
