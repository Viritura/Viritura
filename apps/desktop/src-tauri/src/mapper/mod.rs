//! Deterministic Lua 5.4 articulation mapping.
//!
//! A mapper turns one instrument's notation-level [`PlaybackEvent`] stream into
//! the raw [`ScheduledMidi`] its specific VST setup expects (Part 2 of the
//! instrument-profiles spec). Mapping is independent of VST hosting: it only
//! produces scheduled MIDI, so it is unit-testable headless and drives both the
//! authoring-time validation probe and (Phase 5) the precompiled playback stream.

mod protocol;
mod runtime;

pub use protocol::{
    Articulations, MidiMessage, NotationNote, PlaybackEvent, PlayingState, ScheduledMidi,
};
pub use runtime::{LuaMapper, LuaMapperConfig, LuaMapperError};

/// Compile a mapper script and run a whole part's event stream through it.
///
/// This is the headless-compile entry point behind the `vst_compile_mapper` Tauri
/// command: a fresh sandboxed VM per call (so no stale `state` leaks across
/// compilations, §2.2), replaying `events` in order into one deterministic,
/// time-sorted MIDI list.
pub fn compile_and_dispatch(
    source: &str,
    events: &[PlaybackEvent],
) -> Result<Vec<ScheduledMidi>, LuaMapperError> {
    let mut mapper = LuaMapper::new(source, LuaMapperConfig::default())?;
    mapper.dispatch_all(events)
}

/// Dry-run a script against a synthetic event sequence to gate the UI ready state (§2.7).
///
/// Compiles the script, then dispatches a small canonical sequence (reset →
/// dynamics → a plain note → a pizz technique change → a note → note-offs) and
/// confirms it emits well-formed MIDI within the sandbox limits. Any compile
/// error, runtime error, budget overflow, or invalid MIDI value surfaces as the
/// returned error.
pub fn probe(source: &str) -> Result<(), LuaMapperError> {
    let mut mapper = LuaMapper::new(source, LuaMapperConfig::default())?;
    mapper.dispatch_all(&probe_sequence())?;
    Ok(())
}

/// The canonical synthetic sequence exercised by [`probe`].
fn probe_sequence() -> Vec<PlaybackEvent> {
    let plain = NotationNote {
        id: "probe-note-1".to_owned(),
        start_time: 0.5,
        duration: 0.5,
        pitch: 67,
        dynamics: 0.6,
        articulations: Articulations::default(),
        state: PlayingState::default(),
    };
    let pizz = NotationNote {
        id: "probe-note-2".to_owned(),
        start_time: 1.5,
        duration: 0.25,
        pitch: 60,
        dynamics: 0.5,
        articulations: Articulations::default(),
        state: PlayingState {
            pizzicato: true,
            ..PlayingState::default()
        },
    };
    vec![
        PlaybackEvent::Reset { time: 0.0 },
        PlaybackEvent::Dynamics {
            time: 0.0,
            value: 0.6,
        },
        PlaybackEvent::NoteOn {
            time: plain.start_time,
            note: plain.clone(),
        },
        PlaybackEvent::NoteOff {
            time: plain.start_time + plain.duration,
            note: plain,
        },
        PlaybackEvent::Technique {
            time: 1.4,
            state: PlayingState {
                pizzicato: true,
                ..PlayingState::default()
            },
        },
        PlaybackEvent::NoteOn {
            time: pizz.start_time,
            note: pizz.clone(),
        },
        PlaybackEvent::NoteOff {
            time: pizz.start_time + pizz.duration,
            note: pizz,
        },
    ]
}

#[cfg(test)]
mod golden_tests {
    use super::protocol::MidiMessage;
    use super::{
        compile_and_dispatch, probe, Articulations, NotationNote, PlaybackEvent, PlayingState,
    };

    /// Viritura's shipped canonical example, exercised as a golden mapper.
    const OPUS_VIOLIN: &str = include_str!("fixtures/opus_violin.lua");

    fn note(id: &str, start: f64, dur: f64, pitch: u8, pizz: bool, staccato: bool) -> NotationNote {
        NotationNote {
            id: id.to_owned(),
            start_time: start,
            duration: dur,
            pitch,
            dynamics: 0.7,
            articulations: Articulations {
                staccato,
                ..Articulations::default()
            },
            state: PlayingState {
                pizzicato: pizz,
                ..PlayingState::default()
            },
        }
    }

    fn note_on_of(actions: &[super::ScheduledMidi], note_id: &str) -> MidiMessage {
        actions
            .iter()
            .find_map(|a| match &a.message {
                MidiMessage::NoteOn { note_id: id, .. } if id == note_id => Some(a.message.clone()),
                _ => None,
            })
            .unwrap_or_else(|| panic!("no note-on for {note_id}"))
    }

    #[test]
    fn opus_violin_probe_passes() {
        probe(OPUS_VIOLIN).expect("canonical example passes the probe");
    }

    #[test]
    fn opus_violin_routes_articulations_to_channels() {
        // detache (short arco), sustain (long arco), staccato, pizz → channels 0,1,2,3.
        let events = vec![
            PlaybackEvent::Reset { time: 0.0 },
            on(note("detache", 0.0, 0.5, 60, false, false)),
            off(note("detache", 0.0, 0.5, 60, false, false)),
            on(note("sustain", 1.0, 2.0, 62, false, false)),
            off(note("sustain", 1.0, 2.0, 62, false, false)),
            on(note("stacc", 4.0, 0.2, 64, false, true)),
            off(note("stacc", 4.0, 0.2, 64, false, true)),
            on(note("pizz", 5.0, 0.5, 65, true, false)),
            off(note("pizz", 5.0, 0.5, 65, true, false)),
        ];
        let actions = compile_and_dispatch(OPUS_VIOLIN, &events).expect("compiles + dispatches");

        assert!(matches!(
            note_on_of(&actions, "detache"),
            MidiMessage::NoteOn { channel: 0, .. }
        ));
        assert!(matches!(
            note_on_of(&actions, "sustain"),
            MidiMessage::NoteOn { channel: 1, .. }
        ));
        assert!(matches!(
            note_on_of(&actions, "stacc"),
            MidiMessage::NoteOn { channel: 2, .. }
        ));
        assert!(matches!(
            note_on_of(&actions, "pizz"),
            MidiMessage::NoteOn { channel: 3, .. }
        ));
    }

    #[test]
    fn opus_violin_primes_cc_ahead_of_note_and_stays_sorted() {
        let events = vec![
            PlaybackEvent::Reset { time: 0.0 },
            on(note("n1", 1.0, 0.5, 67, false, false)),
            off(note("n1", 1.0, 0.5, 67, false, false)),
        ];
        let actions = compile_and_dispatch(OPUS_VIOLIN, &events).expect("compiles + dispatches");

        // Globally time-sorted.
        let times: Vec<f64> = actions.iter().map(|a| a.at_seconds).collect();
        let mut sorted = times.clone();
        sorted.sort_by(f64::total_cmp);
        assert_eq!(times, sorted);

        // The priming CC11 lands at 0.97 s (1.0 − 0.03 latency), before the 1.0 s note-on.
        let cc_time = actions
            .iter()
            .find_map(|a| match a.message {
                MidiMessage::ControlChange { controller: 11, .. } => Some(a.at_seconds),
                _ => None,
            })
            .expect("emits a priming CC11");
        assert!(
            cc_time < 1.0,
            "priming CC should precede the note: {cc_time}"
        );
    }

    fn on(note: NotationNote) -> PlaybackEvent {
        PlaybackEvent::NoteOn {
            time: note.start_time,
            note,
        }
    }

    fn off(note: NotationNote) -> PlaybackEvent {
        PlaybackEvent::NoteOff {
            time: note.start_time + note.duration,
            note,
        }
    }
}
