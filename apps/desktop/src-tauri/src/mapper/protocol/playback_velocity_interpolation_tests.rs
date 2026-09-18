use super::{MidiValidationError, PlaybackEventValidationError};
use crate::mapper::{
    Articulations, NotationNote, PlaybackEvent, PlaybackVelocityEndpoint,
    PlaybackVelocityInterpolation, PlayingState,
};
use serde_json::{json, Value};

const INTERPOLATION: &str = "playbackVelocityInterpolation";
const UNIT_FIELDS: [&str; 3] = [
    "playbackVelocityInterpolation.from.dynamics",
    "playbackVelocityInterpolation.to.dynamics",
    "playbackVelocityInterpolation.progress",
];
const VELOCITY_FIELDS: [&str; 3] = [
    "playbackVelocity",
    "playbackVelocityInterpolation.from.playbackVelocity",
    "playbackVelocityInterpolation.to.playbackVelocity",
];

fn wire_event(kind: &str) -> Value {
    json!({
        "kind": kind, "time": 0.5,
        "note": {
            "id": "ramp-note", "startTime": 0.5, "duration": 1.0,
            "pitch": 60, "dynamics": 0.5
        }
    })
}

fn wire_interpolation() -> Value {
    json!({
        "from": { "dynamics": 0.0 },
        "to": { "dynamics": 1.0 },
        "progress": 0.5
    })
}

fn note(event: &PlaybackEvent) -> &NotationNote {
    match event {
        PlaybackEvent::NoteOn { note, .. } | PlaybackEvent::NoteOff { note, .. } => note,
        _ => panic!("expected note event"),
    }
}

fn assert_valid_roundtrip(event: &PlaybackEvent) -> Value {
    assert_eq!(event.validate(), Ok(()));
    let serialized = serde_json::to_value(event).unwrap();
    assert_eq!(
        serde_json::from_value::<PlaybackEvent>(serialized.clone()).unwrap(),
        *event
    );
    serialized
}

#[test]
fn legacy_and_null_interpolation_default_to_none_and_are_omitted() {
    for kind in ["noteOn", "noteOff"] {
        for playback_velocity in [None, Some(96)] {
            for explicit_null in [false, true] {
                let mut wire = wire_event(kind);
                if let Some(velocity) = playback_velocity {
                    wire["note"]["playbackVelocity"] = velocity.into();
                }
                if explicit_null {
                    wire["note"][INTERPOLATION] = Value::Null;
                }
                let event: PlaybackEvent = serde_json::from_value(wire).unwrap();
                assert_eq!(note(&event).playback_velocity, playback_velocity);
                assert_eq!(note(&event).playback_velocity_interpolation, None);
                assert_eq!(note(&event).articulations, Articulations::default());
                assert_eq!(note(&event).state, PlayingState::default());
                let serialized = assert_valid_roundtrip(&event);
                assert!(serialized["note"].get(INTERPOLATION).is_none());
                assert_eq!(
                    serialized["note"].get("playbackVelocity"),
                    playback_velocity.map(Value::from).as_ref()
                );
            }
        }
    }
}

#[test]
fn camel_case_roundtrip_allows_independent_optional_endpoint_velocities() {
    for kind in ["noteOn", "noteOff"] {
        for playback_velocity in [None, Some(96)] {
            for from_velocity in [None, Some(1), Some(127)] {
                for to_velocity in [None, Some(1), Some(127)] {
                    let mut wire = wire_event(kind);
                    wire["note"][INTERPOLATION] = wire_interpolation();
                    if let Some(velocity) = playback_velocity {
                        wire["note"]["playbackVelocity"] = velocity.into();
                    }
                    for (endpoint, velocity) in [("from", from_velocity), ("to", to_velocity)] {
                        if let Some(velocity) = velocity {
                            wire["note"][INTERPOLATION][endpoint]["playbackVelocity"] =
                                velocity.into();
                        }
                    }
                    let event: PlaybackEvent = serde_json::from_value(wire).unwrap();
                    assert_eq!(note(&event).playback_velocity, playback_velocity);
                    assert_eq!(
                        note(&event).playback_velocity_interpolation,
                        Some(PlaybackVelocityInterpolation {
                            from: PlaybackVelocityEndpoint {
                                dynamics: 0.0,
                                playback_velocity: from_velocity,
                            },
                            to: PlaybackVelocityEndpoint {
                                dynamics: 1.0,
                                playback_velocity: to_velocity,
                            },
                            progress: 0.5,
                        })
                    );
                    let serialized = assert_valid_roundtrip(&event);
                    let interpolation = &serialized["note"][INTERPOLATION];
                    assert_eq!(serialized["kind"], kind);
                    assert_eq!(interpolation["from"]["dynamics"], 0.0);
                    assert_eq!(interpolation["to"]["dynamics"], 1.0);
                    assert_eq!(interpolation["progress"], 0.5);
                    assert!(serialized["note"]
                        .get("playback_velocity_interpolation")
                        .is_none());
                    for (endpoint, velocity) in [("from", from_velocity), ("to", to_velocity)] {
                        assert_eq!(
                            interpolation[endpoint].get("playbackVelocity"),
                            velocity.map(Value::from).as_ref()
                        );
                        assert!(interpolation[endpoint].get("playback_velocity").is_none());
                    }
                }
            }
        }
    }
}

#[test]
fn null_endpoint_velocities_default_to_none_and_are_omitted() {
    for kind in ["noteOn", "noteOff"] {
        let mut wire = wire_event(kind);
        wire["note"][INTERPOLATION] = wire_interpolation();
        for endpoint in ["from", "to"] {
            wire["note"][INTERPOLATION][endpoint]["playbackVelocity"] = Value::Null;
        }
        let event: PlaybackEvent = serde_json::from_value(wire).unwrap();
        let interpolation = note(&event).playback_velocity_interpolation.unwrap();
        assert_eq!(interpolation.from.playback_velocity, None);
        assert_eq!(interpolation.to.playback_velocity, None);
        let serialized = assert_valid_roundtrip(&event);
        for endpoint in ["from", "to"] {
            assert!(serialized["note"][INTERPOLATION][endpoint]
                .get("playbackVelocity")
                .is_none());
        }
    }
}

#[test]
fn unit_values_are_bounded_even_with_explicit_note_velocity() {
    for kind in ["noteOn", "noteOff"] {
        for playback_velocity in [None, Some(96)] {
            for field in UNIT_FIELDS {
                for value in [-1.0, -0.001, 0.0, 0.5, 1.0, 1.001, 2.0] {
                    let mut wire = wire_event(kind);
                    wire["note"][INTERPOLATION] = wire_interpolation();
                    if let Some(velocity) = playback_velocity {
                        wire["note"]["playbackVelocity"] = velocity.into();
                    }
                    *note_wire_field(&mut wire, field) = json!(value);
                    let event: PlaybackEvent = serde_json::from_value(wire).unwrap();
                    if (0.0..=1.0).contains(&value) {
                        assert_valid_roundtrip(&event);
                    } else {
                        assert_eq!(
                            event.validate(),
                            Err(PlaybackEventValidationError::UnitOutOfRange { field, value }),
                            "{kind}: {field} = {value}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn non_finite_unit_values_are_rejected_programmatically() {
    for kind in ["noteOn", "noteOff"] {
        for playback_velocity in [None, Some(96)] {
            for field in UNIT_FIELDS {
                for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
                    let mut interpolation = PlaybackVelocityInterpolation {
                        from: PlaybackVelocityEndpoint {
                            dynamics: 0.0,
                            playback_velocity: None,
                        },
                        to: PlaybackVelocityEndpoint {
                            dynamics: 1.0,
                            playback_velocity: Some(127),
                        },
                        progress: 0.5,
                    };
                    match field {
                        "playbackVelocityInterpolation.from.dynamics" => {
                            interpolation.from.dynamics = value;
                        }
                        "playbackVelocityInterpolation.to.dynamics" => {
                            interpolation.to.dynamics = value;
                        }
                        _ => interpolation.progress = value,
                    }
                    let mut event: PlaybackEvent =
                        serde_json::from_value(wire_event(kind)).unwrap();
                    match &mut event {
                        PlaybackEvent::NoteOn { note, .. }
                        | PlaybackEvent::NoteOff { note, .. } => {
                            note.playback_velocity = playback_velocity;
                            note.playback_velocity_interpolation = Some(interpolation);
                        }
                        _ => unreachable!(),
                    }
                    let Err(PlaybackEventValidationError::UnitOutOfRange {
                        field: actual_field,
                        value: actual_value,
                    }) = event.validate()
                    else {
                        panic!("accepted {kind}: {field} = {value}");
                    };
                    assert_eq!(actual_field, field);
                    assert!(actual_value == value || (actual_value.is_nan() && value.is_nan()));
                }
            }
        }
    }
}

fn note_wire_field<'a>(wire: &'a mut Value, field: &str) -> &'a mut Value {
    let mut value = &mut wire["note"];
    for key in field.split('.') {
        value = &mut value[key];
    }
    value
}

#[test]
fn velocity_validation_preserves_existing_errors_and_checks_both_endpoints() {
    for kind in ["noteOn", "noteOff"] {
        for playback_velocity in [None, Some(96)] {
            for field in VELOCITY_FIELDS {
                for value in [0, 128, 255] {
                    let mut wire = wire_event(kind);
                    wire["note"][INTERPOLATION] = wire_interpolation();
                    if let Some(velocity) = playback_velocity {
                        wire["note"]["playbackVelocity"] = velocity.into();
                    }
                    *note_wire_field(&mut wire, field) = json!(value);
                    let event: PlaybackEvent = serde_json::from_value(wire).unwrap();
                    let expected = if value != 0 {
                        PlaybackEventValidationError::InvalidMidi(MidiValidationError::Data {
                            field,
                            value,
                        })
                    } else if field == "playbackVelocity" {
                        PlaybackEventValidationError::ZeroPlaybackVelocity
                    } else {
                        PlaybackEventValidationError::ZeroEndpointPlaybackVelocity { field }
                    };
                    assert_eq!(event.validate(), Err(expected), "{kind}: {field} = {value}");
                }
            }
        }
    }
}

#[test]
fn velocity_deserialization_rejects_non_u8_shapes() {
    for kind in ["noteOn", "noteOff"] {
        for field in VELOCITY_FIELDS {
            for value in [
                json!(-1),
                json!(256),
                json!(96.5),
                json!("96"),
                json!(true),
                json!([]),
                json!({}),
            ] {
                let mut wire = wire_event(kind);
                wire["note"]["playbackVelocity"] = json!(96);
                wire["note"][INTERPOLATION] = wire_interpolation();
                *note_wire_field(&mut wire, field) = value.clone();
                assert!(
                    serde_json::from_value::<PlaybackEvent>(wire).is_err(),
                    "{kind}: {field} = {value}"
                );
            }
        }
    }
}

#[test]
fn interpolation_requires_both_endpoints_their_dynamics_and_progress() {
    for kind in ["noteOn", "noteOff"] {
        for field in ["from", "to", "progress", "from.dynamics", "to.dynamics"] {
            let mut interpolation = wire_interpolation();
            if let Some((endpoint, key)) = field.split_once('.') {
                interpolation[endpoint].as_object_mut().unwrap().remove(key);
            } else {
                interpolation.as_object_mut().unwrap().remove(field);
            }
            let mut wire = wire_event(kind);
            wire["note"][INTERPOLATION] = interpolation;
            assert!(
                serde_json::from_value::<PlaybackEvent>(wire).is_err(),
                "{kind}: missing {field}"
            );
        }
        for field in UNIT_FIELDS {
            for value in [Value::Null, json!("0.5"), json!(true), json!([]), json!({})] {
                let mut wire = wire_event(kind);
                wire["note"][INTERPOLATION] = wire_interpolation();
                *note_wire_field(&mut wire, field) = value.clone();
                assert!(
                    serde_json::from_value::<PlaybackEvent>(wire).is_err(),
                    "{kind}: {field} = {value}"
                );
            }
        }
    }
}
