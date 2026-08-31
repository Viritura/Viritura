use std::cell::{Cell, RefCell};
use std::rc::Rc;

use mlua::{Function, HookTriggers, Lua, LuaOptions, StdLib, Table, Value, VmState};

use super::protocol::{
    validate_channel, validate_data, Articulations, MidiMessage, MidiValidationError, NotationNote,
    PlaybackEvent, PlaybackEventValidationError, PlayingState, ScheduledMidi,
};

/// Resource limits and defaults for a single Lua mapper instance.
#[derive(Clone, Debug, PartialEq)]
pub struct LuaMapperConfig {
    /// Maximum UTF-8 Lua source size accepted by the mapper.
    pub max_script_bytes: usize,
    /// Maximum allocator-owned Lua memory. The Lua VM returns an error when it is exhausted.
    pub max_memory_bytes: usize,
    /// Approximate maximum Lua VM instructions allowed for script loading or one dispatch call.
    pub max_instructions: usize,
    /// Instruction hook interval. A lower number enforces the limit more tightly at more cost.
    pub instruction_quantum: u32,
    /// MIDI channel used by `midi.keyswitch` when the script omits its optional channel argument.
    pub default_channel: u8,
    /// How long a `midi.keyswitch` note is held before its note-off, in seconds.
    pub keyswitch_hold_seconds: f64,
}

impl Default for LuaMapperConfig {
    fn default() -> Self {
        Self {
            max_script_bytes: 64 * 1024,
            max_memory_bytes: 2 * 1024 * 1024,
            max_instructions: 100_000,
            instruction_quantum: 100,
            default_channel: 0,
            keyswitch_hold_seconds: 0.01,
        }
    }
}

impl LuaMapperConfig {
    fn validate(&self) -> Result<(), LuaMapperError> {
        if self.max_script_bytes == 0 {
            return Err(invalid_config("max_script_bytes must be positive"));
        }
        if self.max_memory_bytes == 0 {
            return Err(invalid_config("max_memory_bytes must be positive"));
        }
        if self.max_instructions == 0 || self.instruction_quantum == 0 {
            return Err(invalid_config("instruction limits must be positive"));
        }
        if self.default_channel > 15 {
            return Err(invalid_config("default_channel must be in 0..=15"));
        }
        if !(self.keyswitch_hold_seconds.is_finite() && self.keyswitch_hold_seconds > 0.0) {
            return Err(invalid_config(
                "keyswitch_hold_seconds must be finite and positive",
            ));
        }
        Ok(())
    }
}

fn invalid_config(message: &str) -> LuaMapperError {
    LuaMapperError::InvalidConfiguration(message.to_owned())
}

/// Errors from construction or execution of a mapper.
#[derive(Debug, thiserror::Error)]
pub enum LuaMapperError {
    #[error("invalid Lua mapper configuration: {0}")]
    InvalidConfiguration(String),
    #[error("Lua script is {actual} bytes; the configured maximum is {maximum}")]
    ScriptTooLarge { actual: usize, maximum: usize },
    #[error("Lua mapper rejected playback event data: {0}")]
    InvalidPlaybackEvent(#[from] PlaybackEventValidationError),
    #[error("Lua mapper rejected MIDI data: {0}")]
    InvalidMidi(#[from] MidiValidationError),
    #[error("Lua mapper contract violation: {0}")]
    Contract(String),
    #[error("Lua mapper error: {0}")]
    Lua(#[from] mlua::Error),
}

/// Shared state the sandboxed `midi.*` builders read and write during one dispatch.
struct MidiApiState {
    actions: Rc<RefCell<Vec<ScheduledMidi>>>,
    generated_ids: Rc<Cell<u64>>,
    default_channel: u8,
    keyswitch_hold_seconds: f64,
}

#[derive(Debug)]
struct MapperCallbacks {
    note_on: Option<Function>,
    note_off: Option<Function>,
    dynamics: Option<Function>,
    technique_change: Option<Function>,
    reset: Option<Function>,
}

/// A reusable Lua 5.4 mapper turning notation callbacks into scheduled MIDI.
///
/// The VM loads only `table`, `string`, `math`, and `utf8`. It removes base-library loading and
/// file functions as defense in depth, so no filesystem, network, process, package, or debug
/// access is exposed. The sandbox is in-process language isolation, not native-code isolation;
/// mapper scripts must remain untrusted only within those documented limits.
///
/// Scripts implement any of the callbacks `note_on`, `note_off`, `dynamics`, `technique_change`,
/// and `reset`, and emit MIDI through `midi.keyswitch`, `midi.note`, and `midi.cc`. Every callback
/// receives the timeline second at which its event occurs as its first argument, and keeps
/// per-timeline data in the global `state` table. Every callback runs ahead of playback, so a
/// script may schedule MIDI at a negative time to compensate for plugin latency; such events are
/// clamped to the timeline origin.
pub struct LuaMapper {
    lua: Lua,
    callbacks: MapperCallbacks,
    actions: Rc<RefCell<Vec<ScheduledMidi>>>,
    instruction_count: Rc<Cell<usize>>,
}

impl LuaMapper {
    /// Compile a mapper script under the configured sandbox limits.
    pub fn new(source: &str, config: LuaMapperConfig) -> Result<Self, LuaMapperError> {
        config.validate()?;
        if source.len() > config.max_script_bytes {
            return Err(LuaMapperError::ScriptTooLarge {
                actual: source.len(),
                maximum: config.max_script_bytes,
            });
        }

        let lua = Lua::new_with(
            StdLib::TABLE | StdLib::STRING | StdLib::MATH | StdLib::UTF8,
            LuaOptions::default(),
        )?;
        lua.set_memory_limit(config.max_memory_bytes)?;

        let instruction_count = Rc::new(Cell::new(0_usize));
        install_instruction_limit(
            &lua,
            instruction_count.clone(),
            config.max_instructions,
            config.instruction_quantum,
        )?;
        remove_unsafe_globals(&lua)?;

        let actions = Rc::new(RefCell::new(Vec::new()));
        install_midi_api(
            &lua,
            MidiApiState {
                actions: actions.clone(),
                generated_ids: Rc::new(Cell::new(0)),
                default_channel: config.default_channel,
                keyswitch_hold_seconds: config.keyswitch_hold_seconds,
            },
        )?;
        lua.globals().set("state", lua.create_table()?)?;

        instruction_count.set(0);
        lua.load(source).set_name("callback_mapper").exec()?;
        let callbacks = MapperCallbacks {
            note_on: optional_callback(&lua, "note_on")?,
            note_off: optional_callback(&lua, "note_off")?,
            dynamics: optional_callback(&lua, "dynamics")?,
            technique_change: optional_callback(&lua, "technique_change")?,
            reset: optional_callback(&lua, "reset")?,
        };

        Ok(Self {
            lua,
            callbacks,
            actions,
            instruction_count,
        })
    }

    /// Dispatch one structured playback event and return its scheduled MIDI, sorted by time.
    ///
    /// The headless compile path uses [`dispatch_all`](Self::dispatch_all); this
    /// single-event form is the seam for live note-editing re-dispatch (Phase 5)
    /// and is exercised directly by the mapper tests.
    #[allow(dead_code)]
    pub fn dispatch(
        &mut self,
        event: &PlaybackEvent,
    ) -> Result<Vec<ScheduledMidi>, LuaMapperError> {
        let mut actions = Vec::new();
        self.dispatch_into(event, &mut actions)?;
        Ok(actions)
    }

    /// Dispatch a whole part's event sequence and return the merged, time-sorted MIDI.
    ///
    /// This is the headless-compile entry point (§3.3 step 2): the frontend hands the runtime a
    /// part's full `PlaybackEvent[]`, and the runtime replays it in order — preserving the mapper's
    /// per-timeline `state` across callbacks — into one deterministic MIDI list. The merge is a
    /// **stable** sort by time, so same-instant messages keep their per-event emission order; the
    /// host applies the §2.6 same-instant priority when it schedules them.
    pub fn dispatch_all(
        &mut self,
        events: &[PlaybackEvent],
    ) -> Result<Vec<ScheduledMidi>, LuaMapperError> {
        let mut output = Vec::new();
        for event in events {
            self.dispatch_into(event, &mut output)?;
        }
        output.sort_by(|a, b| a.at_seconds.total_cmp(&b.at_seconds));
        Ok(output)
    }

    /// Dispatch one structured playback event into a caller-owned buffer.
    ///
    /// Reusing `output` lets an adapter preallocate capacity and avoid allocation storms when it
    /// batches frequent dynamics or articulation changes ahead of the audio callback.
    pub fn dispatch_into(
        &mut self,
        event: &PlaybackEvent,
        output: &mut Vec<ScheduledMidi>,
    ) -> Result<(), LuaMapperError> {
        event.validate()?;

        self.actions.borrow_mut().clear();
        self.instruction_count.set(0);

        let result = self.invoke(event);
        match result {
            Ok(()) => {
                let mut actions = std::mem::take(&mut *self.actions.borrow_mut());
                actions.sort_by(|a, b| a.at_seconds.total_cmp(&b.at_seconds));
                output.extend(actions);
                Ok(())
            }
            Err(error) => {
                self.actions.borrow_mut().clear();
                Err(error.into())
            }
        }
    }

    fn invoke(&self, event: &PlaybackEvent) -> Result<(), mlua::Error> {
        let time = event.time();
        match event {
            PlaybackEvent::NoteOn { note, .. } => self.call_table(
                self.callbacks.note_on.as_ref(),
                time,
                notation_note_table(&self.lua, note)?,
            ),
            PlaybackEvent::NoteOff { note, .. } => self.call_table(
                self.callbacks.note_off.as_ref(),
                time,
                notation_note_table(&self.lua, note)?,
            ),
            PlaybackEvent::Dynamics { value, .. } => {
                self.call_scalar(self.callbacks.dynamics.as_ref(), time, *value)
            }
            PlaybackEvent::Technique { state, .. } => self.call_table(
                self.callbacks.technique_change.as_ref(),
                time,
                playing_state_table(&self.lua, state)?,
            ),
            PlaybackEvent::Reset { .. } => self.call_time(self.callbacks.reset.as_ref(), time),
        }
    }

    fn call_table(
        &self,
        callback: Option<&Function>,
        time: f64,
        argument: Table,
    ) -> Result<(), mlua::Error> {
        match callback {
            Some(callback) => callback.call::<()>((time, argument)),
            None => Ok(()),
        }
    }

    fn call_scalar(
        &self,
        callback: Option<&Function>,
        time: f64,
        value: f64,
    ) -> Result<(), mlua::Error> {
        match callback {
            Some(callback) => callback.call::<()>((time, value)),
            None => Ok(()),
        }
    }

    fn call_time(&self, callback: Option<&Function>, time: f64) -> Result<(), mlua::Error> {
        match callback {
            Some(callback) => callback.call::<()>(time),
            None => Ok(()),
        }
    }
}

fn install_instruction_limit(
    lua: &Lua,
    instruction_count: Rc<Cell<usize>>,
    max_instructions: usize,
    instruction_quantum: u32,
) -> Result<(), mlua::Error> {
    let quantum = usize::try_from(instruction_quantum).expect("u32 fits usize");
    lua.set_hook(
        HookTriggers::new().every_nth_instruction(instruction_quantum),
        move |_, _| {
            let count = instruction_count.get().saturating_add(quantum);
            instruction_count.set(count);
            if count > max_instructions {
                Err(mlua::Error::RuntimeError(format!(
                    "instruction limit exceeded ({max_instructions})"
                )))
            } else {
                Ok(VmState::Continue)
            }
        },
    )
}

fn remove_unsafe_globals(lua: &Lua) -> Result<(), mlua::Error> {
    let globals = lua.globals();
    for name in [
        "collectgarbage",
        "debug",
        "dofile",
        "io",
        "load",
        "loadfile",
        "os",
        "package",
        "print",
        "require",
    ] {
        globals.set(name, Value::Nil)?;
    }
    Ok(())
}

fn install_midi_api(lua: &Lua, state: MidiApiState) -> Result<(), mlua::Error> {
    let midi = lua.create_table()?;
    let MidiApiState {
        actions,
        generated_ids,
        default_channel,
        keyswitch_hold_seconds,
    } = state;

    let keyswitch_actions = actions.clone();
    let keyswitch_ids = generated_ids.clone();
    midi.set(
        "keyswitch",
        lua.create_function(move |_, (time, value, channel): (f64, u8, Option<u8>)| {
            let channel = channel.unwrap_or(default_channel);
            validate_channel(channel).map_err(mlua::Error::external)?;
            validate_data("note", value).map_err(mlua::Error::external)?;
            let note_id = next_generated_note_id(&keyswitch_ids)?;
            let mut actions = keyswitch_actions.borrow_mut();
            actions.push(ScheduledMidi::clamped(
                time,
                MidiMessage::NoteOn {
                    note_id: note_id.clone(),
                    channel,
                    note: value,
                    velocity: 1,
                },
            ));
            actions.push(ScheduledMidi::clamped(
                time + keyswitch_hold_seconds,
                MidiMessage::NoteOff { note_id },
            ));
            Ok(())
        })?,
    )?;

    let note_actions = actions.clone();
    let note_ids = generated_ids;
    midi.set(
        "note",
        lua.create_function(move |_, note: Table| {
            let note = parse_midi_note(&note, &note_ids)?;
            let mut actions = note_actions.borrow_mut();
            actions.push(ScheduledMidi::clamped(
                note.start_time,
                MidiMessage::NoteOn {
                    note_id: note.note_id.clone(),
                    channel: note.channel,
                    note: note.pitch,
                    velocity: note.velocity,
                },
            ));
            actions.push(ScheduledMidi::clamped(
                note.end_time,
                MidiMessage::NoteOff {
                    note_id: note.note_id,
                },
            ));
            Ok(())
        })?,
    )?;

    let cc_actions = actions;
    midi.set(
        "cc",
        lua.create_function(
            move |_, (time, controller, value, channel): (f64, u8, u8, u8)| {
                validate_channel(channel).map_err(mlua::Error::external)?;
                validate_data("controller", controller).map_err(mlua::Error::external)?;
                validate_data("value", value).map_err(mlua::Error::external)?;
                cc_actions.borrow_mut().push(ScheduledMidi::clamped(
                    time,
                    MidiMessage::ControlChange {
                        channel,
                        controller,
                        value,
                    },
                ));
                Ok(())
            },
        )?,
    )?;

    lua.globals().set("midi", midi)?;
    Ok(())
}

/// A validated `midi.note` argument.
struct ParsedMidiNote {
    note_id: String,
    start_time: f64,
    end_time: f64,
    pitch: u8,
    velocity: u8,
    channel: u8,
}

fn parse_midi_note(note: &Table, generated_ids: &Cell<u64>) -> Result<ParsedMidiNote, mlua::Error> {
    let start_time: f64 = note.get("startTime")?;
    let end_time: f64 = note.get("endTime")?;
    let pitch: u8 = note.get("pitch")?;
    let velocity: u8 = note.get("velocity")?;
    let channel: u8 = note.get("channel")?;
    let note_id = match note.get::<Option<String>>("id")? {
        Some(id) if !id.is_empty() => id,
        _ => next_generated_note_id(generated_ids)?,
    };
    if !start_time.is_finite() || !end_time.is_finite() {
        return Err(mlua::Error::external(LuaMapperError::Contract(
            "midi.note startTime and endTime must be finite".to_owned(),
        )));
    }
    validate_channel(channel).map_err(mlua::Error::external)?;
    validate_data("pitch", pitch).map_err(mlua::Error::external)?;
    validate_data("velocity", velocity).map_err(mlua::Error::external)?;
    Ok(ParsedMidiNote {
        note_id,
        start_time,
        end_time,
        pitch,
        velocity,
        channel,
    })
}

fn optional_callback(lua: &Lua, name: &str) -> Result<Option<Function>, LuaMapperError> {
    match lua.globals().get::<Value>(name)? {
        Value::Nil => Ok(None),
        Value::Function(function) => Ok(Some(function)),
        _ => Err(LuaMapperError::Contract(format!(
            "global `{name}` must be a function or nil"
        ))),
    }
}

fn next_generated_note_id(generated_ids: &Cell<u64>) -> Result<String, mlua::Error> {
    let next = generated_ids.get();
    let updated = next.checked_add(1).ok_or_else(|| {
        mlua::Error::external(LuaMapperError::Contract(
            "generated note id counter overflowed".to_owned(),
        ))
    })?;
    generated_ids.set(updated);
    Ok(format!("generated-note-{next}"))
}

fn notation_note_table(lua: &Lua, note: &NotationNote) -> Result<Table, mlua::Error> {
    let table = lua.create_table()?;
    table.set("id", note.id.clone())?;
    table.set("startTime", note.start_time)?;
    table.set("duration", note.duration)?;
    table.set("pitch", note.pitch)?;
    table.set("dynamics", note.dynamics)?;
    table.set(
        "articulations",
        articulations_table(lua, &note.articulations)?,
    )?;
    table.set("state", playing_state_table(lua, &note.state)?)?;
    Ok(table)
}

fn articulations_table(lua: &Lua, marks: &Articulations) -> Result<Table, mlua::Error> {
    bool_table(
        lua,
        &[
            ("staccato", marks.staccato),
            ("staccatissimo", marks.staccatissimo),
            ("tenuto", marks.tenuto),
            ("accent", marks.accent),
            ("marcato", marks.marcato),
            ("legato", marks.legato),
            ("portato", marks.portato),
        ],
    )
}

fn playing_state_table(lua: &Lua, state: &PlayingState) -> Result<Table, mlua::Error> {
    bool_table(
        lua,
        &[
            ("pizzicato", state.pizzicato),
            ("conSordino", state.con_sordino),
            ("sulPonticello", state.sul_ponticello),
            ("sulTasto", state.sul_tasto),
            ("tremolo", state.tremolo),
            ("trill", state.trill),
            ("harmonic", state.harmonic),
        ],
    )
}

fn bool_table(lua: &Lua, fields: &[(&str, bool)]) -> Result<Table, mlua::Error> {
    let table = lua.create_table()?;
    for (name, value) in fields {
        table.set(*name, *value)?;
    }
    Ok(table)
}

#[cfg(test)]
mod tests {
    use super::{LuaMapper, LuaMapperConfig};
    use crate::mapper::protocol::{
        Articulations, MidiMessage, NotationNote, PlaybackEvent, PlayingState, ScheduledMidi,
    };

    fn note(id: &str, start_time: f64, pitch: u8) -> NotationNote {
        NotationNote {
            id: id.to_owned(),
            start_time,
            duration: 1.0,
            pitch,
            dynamics: 0.8,
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

    fn mapper(source: &str) -> LuaMapper {
        LuaMapper::new(source, LuaMapperConfig::default()).expect("mapper compiles")
    }

    #[test]
    fn absent_callbacks_emit_nothing() {
        let mut mapper = mapper("state = {}");
        assert!(mapper
            .dispatch(&PlaybackEvent::NoteOn {
                time: 0.0,
                note: note("voice-1-note-1", 0.0, 60),
            })
            .unwrap()
            .is_empty());
        assert!(mapper
            .dispatch(&PlaybackEvent::Reset { time: 0.0 })
            .unwrap()
            .is_empty());
    }

    #[test]
    fn note_on_emits_paired_note() {
        let mut mapper = mapper(
            r#"
            function note_on(time, n)
              midi.note({ startTime = time, endTime = time + n.duration,
                          pitch = n.pitch, velocity = 96, channel = 2, id = n.id })
            end
            "#,
        );
        let actions = mapper
            .dispatch(&PlaybackEvent::NoteOn {
                time: 0.5,
                note: note("voice-1-note-1", 0.5, 67),
            })
            .unwrap();
        assert_eq!(actions.len(), 2);
        assert_eq!(
            actions[0],
            ScheduledMidi::clamped(
                0.5,
                MidiMessage::NoteOn {
                    note_id: "voice-1-note-1".to_owned(),
                    channel: 2,
                    note: 67,
                    velocity: 96,
                }
            )
        );
        assert_eq!(
            actions[1],
            ScheduledMidi::clamped(
                1.5,
                MidiMessage::NoteOff {
                    note_id: "voice-1-note-1".to_owned(),
                }
            )
        );
    }

    #[test]
    fn state_persists_across_dispatches() {
        let mut mapper = mapper(
            r#"
            function reset(time) state.count = 0 end
            function dynamics(time, value)
              state.count = (state.count or 0) + 1
              midi.cc(time, 11, state.count, 0)
            end
            "#,
        );
        mapper
            .dispatch(&PlaybackEvent::Reset { time: 0.0 })
            .unwrap();
        let first = mapper
            .dispatch(&PlaybackEvent::Dynamics {
                time: 0.0,
                value: 0.5,
            })
            .unwrap();
        let second = mapper
            .dispatch(&PlaybackEvent::Dynamics {
                time: 1.0,
                value: 0.5,
            })
            .unwrap();
        assert_eq!(
            first[0].message,
            MidiMessage::ControlChange {
                channel: 0,
                controller: 11,
                value: 1,
            }
        );
        assert_eq!(
            second[0].message,
            MidiMessage::ControlChange {
                channel: 0,
                controller: 11,
                value: 2,
            }
        );
    }

    #[test]
    fn dispatch_all_merges_time_sorted() {
        let mut mapper = mapper(
            r#"
            function note_on(time, n)
              midi.cc(time - 0.03, 11, 100, 0)
              midi.note({ startTime = time, endTime = time + n.duration,
                          pitch = n.pitch, velocity = 96, channel = 0, id = n.id })
            end
            "#,
        );
        let events = [
            PlaybackEvent::NoteOn {
                time: 1.0,
                note: note("n2", 1.0, 62),
            },
            PlaybackEvent::NoteOn {
                time: 0.0,
                note: note("n1", 0.0, 60),
            },
        ];
        let actions = mapper.dispatch_all(&events).unwrap();
        // Times: 0.0 (cc for n1 clamped from -0.03), 0.0 (n1 on), 0.97 (cc for n2),
        // 1.0 (n2 on), 1.0 (n1 off), 2.0 (n2 off) — globally non-decreasing.
        let times: Vec<f64> = actions.iter().map(|a| a.at_seconds).collect();
        let mut sorted = times.clone();
        sorted.sort_by(f64::total_cmp);
        assert_eq!(times, sorted);
    }

    #[test]
    fn cc_requires_channel_and_validates_range() {
        let mut mapper = mapper("function dynamics(t, v) midi.cc(t, 200, 0, 0) end");
        assert!(mapper
            .dispatch(&PlaybackEvent::Dynamics {
                time: 0.0,
                value: 0.5,
            })
            .is_err());
    }

    #[test]
    fn instruction_budget_aborts_runaway_script() {
        let mut mapper = mapper("function reset(t) while true do end end");
        assert!(mapper
            .dispatch(&PlaybackEvent::Reset { time: 0.0 })
            .is_err());
    }

    #[test]
    fn sandbox_removes_os_and_io() {
        assert!(LuaMapper::new("return os.time()", LuaMapperConfig::default()).is_err());
        assert!(LuaMapper::new("io.open('x')", LuaMapperConfig::default()).is_err());
    }
}
