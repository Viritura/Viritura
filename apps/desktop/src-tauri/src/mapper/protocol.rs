//! Notation-level playback events and the raw MIDI a Lua mapper emits.
//!
//! These types are the wire contract between the TypeScript performance-event
//! stream (§3.3 of the instrument-profiles spec) and the sandboxed Lua mapper
//! (Part 2): the frontend sends a part's `PlaybackEvent[]`, the mapper turns them
//! into `ScheduledMidi`, and the host renders that MIDI to the plugin. The
//! runtime is ported from the `viritura-vst-host` lab (validated against Opus);
//! the on-the-wire shape matches the TypeScript `PerformanceEvent` discriminated
//! union (`kind`-tagged, camelCase) so no adapter layer is needed.

use serde::{Deserialize, Serialize};

/// A notation-level playback event delivered to a Lua mapper callback.
///
/// Every timestamp is in **timeline seconds** and may be negative: a mapper is
/// invoked ahead of playback so scripts can shift emitted MIDI earlier to
/// compensate for a plugin's attack latency. Any MIDI a script then schedules
/// for a negative time is clamped to `0` when it is emitted (see
/// [`ScheduledMidi`]).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlaybackEvent {
    /// A boundary that asks the script to drop any accumulated per-timeline state.
    Reset { time: f64 },
    /// One individual note beginning. Divisi produce one `NoteOn` per sounding note.
    NoteOn { time: f64, note: NotationNote },
    /// One individual note ending, paired to its `NoteOn` by [`NotationNote::id`].
    /// `time` is the note's end (`start_time + duration`).
    NoteOff { time: f64, note: NotationNote },
    /// A normalized dynamic level sampled at `time`; fires densely along ramps.
    Dynamics { time: f64, value: f64 },
    /// A change to the active persistent playing state; carries the complete new state.
    Technique { time: f64, state: PlayingState },
}

impl PlaybackEvent {
    /// Validate event payloads before they are dispatched into Lua.
    pub fn validate(&self) -> Result<(), PlaybackEventValidationError> {
        validate_finite_time("time", self.time())?;
        match self {
            Self::NoteOn { note, .. } | Self::NoteOff { note, .. } => note.validate(),
            Self::Dynamics { value, .. } => validate_unit("dynamics", *value),
            Self::Technique { .. } | Self::Reset { .. } => Ok(()),
        }
    }

    /// The timeline second at which this event occurs; passed as the first argument to its callback.
    pub fn time(&self) -> f64 {
        match self {
            Self::Reset { time }
            | Self::NoteOn { time, .. }
            | Self::NoteOff { time, .. }
            | Self::Dynamics { time, .. }
            | Self::Technique { time, .. } => *time,
        }
    }
}

/// A single sounding note as seen at the notation level, independent of any MIDI channel or key
/// mapping the script chooses to apply.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotationNote {
    /// Stable per-occurrence identifier so `note_off` pairs with its own `note_on` even when
    /// unisons or divisi overlap on the same pitch.
    pub id: String,
    /// Timeline start in seconds; negative while a script compensates for plugin latency.
    pub start_time: f64,
    /// Sounding length in seconds; must be finite and non-negative.
    pub duration: f64,
    /// Concert pitch as a MIDI key number (0 through 127), pre-resolved for the mapper.
    pub pitch: u8,
    /// Normalized dynamic scalar in `0.0..=1.0` for this note.
    pub dynamics: f64,
    /// Articulation marks attached to this note.
    #[serde(default)]
    pub articulations: Articulations,
    /// Active persistent playing state for this note.
    #[serde(default)]
    pub state: PlayingState,
}

impl NotationNote {
    fn validate(&self) -> Result<(), PlaybackEventValidationError> {
        validate_note_id(&self.id)?;
        validate_data("pitch", self.pitch)?;
        validate_finite_time("startTime", self.start_time)?;
        validate_duration(self.duration)?;
        validate_unit("dynamics", self.dynamics)?;
        Ok(())
    }
}

/// Articulation marks that may appear on a single note. Absent marks are `false`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Articulations {
    pub staccato: bool,
    pub staccatissimo: bool,
    pub tenuto: bool,
    pub accent: bool,
    pub marcato: bool,
    pub legato: bool,
    pub portato: bool,
}

/// Persistent playing state carried by a note. Absent states are `false` (for example
/// `pizzicato == false` means the note is played arco).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlayingState {
    pub pizzicato: bool,
    pub con_sordino: bool,
    pub sul_ponticello: bool,
    pub sul_tasto: bool,
    pub tremolo: bool,
    pub trill: bool,
    pub harmonic: bool,
}

/// One VST-independent MIDI message a mapper can schedule.
///
/// The Lua `midi` API can only produce these three message kinds (`midi.note`
/// and `midi.keyswitch` emit note-on/off pairs, `midi.cc` emits control change),
/// so the wire protocol carries exactly what a mapper can express — no program
/// change or pitch bend.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MidiMessage {
    NoteOn {
        note_id: String,
        channel: u8,
        note: u8,
        velocity: u8,
    },
    NoteOff {
        note_id: String,
    },
    ControlChange {
        channel: u8,
        controller: u8,
        value: u8,
    },
}

impl MidiMessage {
    /// Validate that the message fits the expected MIDI channel-voice range.
    ///
    /// The host validates each scheduled message before routing it to a plugin
    /// (Phase 5 playback wiring); the mapper tests exercise it today.
    #[allow(dead_code)]
    pub fn validate(&self) -> Result<(), MidiValidationError> {
        match self {
            Self::NoteOn {
                note_id,
                channel,
                note,
                velocity,
            } => {
                validate_note_id(note_id)?;
                validate_channel(*channel)?;
                validate_data("note", *note)?;
                validate_data("velocity", *velocity)
            }
            Self::NoteOff { note_id } => validate_note_id(note_id),
            Self::ControlChange {
                channel,
                controller,
                value,
            } => {
                validate_channel(*channel)?;
                validate_data("controller", *controller)?;
                validate_data("value", *value)
            }
        }
    }
}

/// A MIDI message a mapper scheduled at an absolute timeline second.
///
/// `at_seconds` is always non-negative: a script may pass a negative time to nudge an event before
/// the timeline origin, and the mapper clamps it to `0.0` here so nothing is scheduled in the past.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledMidi {
    pub at_seconds: f64,
    #[serde(flatten)]
    pub message: MidiMessage,
}

impl ScheduledMidi {
    /// Build a scheduled message, clamping any negative or non-finite request to the origin.
    pub fn clamped(time: f64, message: MidiMessage) -> Self {
        Self {
            at_seconds: if time.is_finite() && time > 0.0 {
                time
            } else {
                0.0
            },
            message,
        }
    }

    /// Validate the scheduled payload before it is routed to a plugin.
    ///
    /// Exercised by the mapper tests today; the host calls it per message in
    /// Phase 5 playback wiring before delivery.
    #[allow(dead_code)]
    pub fn validate(&self) -> Result<(), MidiValidationError> {
        self.message.validate()
    }
}

/// A malformed playback event payload.
#[derive(Clone, Debug, PartialEq, thiserror::Error)]
pub enum PlaybackEventValidationError {
    #[error("{field} must be a finite number of seconds, got {value}")]
    NonFiniteTime { field: &'static str, value: f64 },
    #[error("duration must be a finite, non-negative number of seconds, got {value}")]
    InvalidDuration { value: f64 },
    #[error("{field} must be a finite normalized scalar in 0.0..=1.0, got {value}")]
    UnitOutOfRange { field: &'static str, value: f64 },
    #[error(transparent)]
    InvalidMidi(#[from] MidiValidationError),
}

/// A malformed MIDI or note-event value.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum MidiValidationError {
    #[error("MIDI channel must be in 0..=15, got {value}")]
    Channel { value: u8 },
    #[error("MIDI {field} must be in 0..=127, got {value}")]
    Data { field: &'static str, value: u8 },
    #[error("note id must not be empty")]
    EmptyNoteId,
}

pub(crate) fn validate_channel(value: u8) -> Result<(), MidiValidationError> {
    if value <= 15 {
        Ok(())
    } else {
        Err(MidiValidationError::Channel { value })
    }
}

pub(crate) fn validate_data(field: &'static str, value: u8) -> Result<(), MidiValidationError> {
    if value <= 127 {
        Ok(())
    } else {
        Err(MidiValidationError::Data { field, value })
    }
}

pub(crate) fn validate_note_id(value: &str) -> Result<(), MidiValidationError> {
    if value.is_empty() {
        Err(MidiValidationError::EmptyNoteId)
    } else {
        Ok(())
    }
}

fn validate_finite_time(
    field: &'static str,
    value: f64,
) -> Result<(), PlaybackEventValidationError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(PlaybackEventValidationError::NonFiniteTime { field, value })
    }
}

fn validate_duration(value: f64) -> Result<(), PlaybackEventValidationError> {
    if value.is_finite() && value >= 0.0 {
        Ok(())
    } else {
        Err(PlaybackEventValidationError::InvalidDuration { value })
    }
}

fn validate_unit(field: &'static str, value: f64) -> Result<(), PlaybackEventValidationError> {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(())
    } else {
        Err(PlaybackEventValidationError::UnitOutOfRange { field, value })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Articulations, MidiMessage, NotationNote, PlaybackEvent, PlayingState, ScheduledMidi,
    };

    fn sample_note(id: &str) -> NotationNote {
        NotationNote {
            id: id.to_owned(),
            start_time: 0.5,
            duration: 1.0,
            pitch: 60,
            dynamics: 0.7,
            articulations: Articulations {
                staccato: true,
                ..Articulations::default()
            },
            state: PlayingState {
                pizzicato: true,
                ..PlayingState::default()
            },
        }
    }

    #[test]
    fn clamps_negative_scheduled_time_to_origin() {
        let scheduled = ScheduledMidi::clamped(
            -0.25,
            MidiMessage::ControlChange {
                channel: 0,
                controller: 1,
                value: 64,
            },
        );

        assert_eq!(scheduled.at_seconds, 0.0);
        assert!(scheduled.validate().is_ok());
    }

    #[test]
    fn rejects_invalid_channel_data() {
        let message = MidiMessage::ControlChange {
            channel: 16,
            controller: 1,
            value: 128,
        };

        assert!(message.validate().is_err());
    }

    #[test]
    fn rejects_out_of_range_dynamics() {
        let event = PlaybackEvent::Dynamics {
            time: 0.0,
            value: 1.1,
        };

        assert!(event.validate().is_err());
    }

    #[test]
    fn rejects_negative_duration() {
        let mut note = sample_note("voice-1-note-1");
        note.duration = -1.0;

        assert!(PlaybackEvent::NoteOn { time: 0.5, note }
            .validate()
            .is_err());
    }

    #[test]
    fn deserializes_kind_tagged_wire_shape() {
        let json = r#"{"kind":"noteOn","time":0.5,"note":{"id":"v1-n1","startTime":0.5,"duration":1.0,"pitch":60,"dynamics":0.7,"articulations":{"staccato":true},"state":{"pizzicato":true}}}"#;
        let event: PlaybackEvent = serde_json::from_str(json).expect("parses");
        match event {
            PlaybackEvent::NoteOn { time, note } => {
                assert_eq!(time, 0.5);
                assert_eq!(note.pitch, 60);
                assert!(note.articulations.staccato);
                assert!(note.state.pizzicato);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn rejects_non_finite_technique_time() {
        let event = PlaybackEvent::Technique {
            time: f64::NAN,
            state: PlayingState::default(),
        };

        assert!(event.validate().is_err());
    }
}
