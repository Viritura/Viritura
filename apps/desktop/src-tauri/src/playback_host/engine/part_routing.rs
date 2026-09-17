//! Per-part audibility without changing the transport or the strip's mixer controls.

use std::collections::{BTreeMap, HashSet};

use vst3_host::{MidiChannel, MidiEvent};

use super::super::mixer::Strip;
use super::super::schedule::{plan_seek, ResolvedEvent, ResolvedMidi, ResolvedNoteId};
use super::Engine;

mod controllers;
use controllers::Controllers;

#[cfg(test)]
mod tests;

/// Logical held notes include excluded parts, so live unmute can reattack them.
#[derive(Clone, Copy)]
pub(super) struct ActiveNote {
    note_id: ResolvedNoteId,
    part: u32,
    channel: u8,
    note: u8,
    velocity: u8,
    sounding: bool,
    key_down: bool,
}

pub(super) struct SlotSeq {
    pub(super) identity: String,
    pub(super) schedule: Vec<ResolvedEvent>,
    pub(super) cursor: usize,
    pub(super) active: Vec<ActiveNote>,
    pub(super) sustain: HashSet<(u32, u8)>,
    pub(super) attacks: BTreeMap<(u8, u8), usize>,
    pub(super) controllers: Controllers,
}

impl SlotSeq {
    pub(super) fn clear_notes(&mut self) {
        self.active.clear();
        self.sustain.clear();
        self.attacks.clear();
        self.controllers = Controllers::default();
    }
}

impl Engine {
    pub(super) fn set_muted(&mut self, parts: Vec<u32>) {
        self.muted_parts = parts.into_iter().collect();
        if !self.playing {
            return;
        }
        let mut core = self.mixer.lock();
        for (key, seq) in &mut self.slots {
            if let Some(strip) = core.strip_mut(key) {
                reconcile_notes(seq, strip, &self.muted_parts, self.playing);
            }
        }
    }
}

fn reconcile_notes(seq: &mut SlotSeq, strip: &mut Strip, muted: &HashSet<u32>, playing: bool) {
    if !playing {
        return;
    }
    let before = sounding_keys(seq);
    for active in &mut seq.active {
        active.sounding = !muted.contains(&active.part);
    }
    seq.controllers.reconcile(muted, |midi| {
        if let Some(event) = to_midi_event(midi) {
            strip.send_midi(event);
        }
    });
    emit_key_changes(before, sounding_keys(seq), &mut seq.attacks, |midi| {
        if let Some(event) = to_midi_event(midi) {
            strip.send_midi(event);
        }
    });
}

pub(super) fn seek_slot(seq: &mut SlotSeq, strip: &mut Strip, t: f64, muted: &HashSet<u32>) {
    let plan = plan_seek(&seq.schedule, t);
    seq.clear_notes();
    for index in 0..plan.resume_index {
        route_event(seq, seq.schedule[index], muted, |_| {});
    }
    for controller in plan.controllers {
        // Sustain is owned per part below, not by a shared physical MIDI channel.
        let controller = match controller {
            ResolvedMidi::ControlChange {
                channel,
                controller: 64,
                ..
            } => ResolvedMidi::ControlChange {
                channel,
                controller: 64,
                value: 0,
            },
            _ => continue,
        };
        if let Some(event) = to_midi_event(controller) {
            strip.send_midi(event);
        }
    }
    seq.controllers.replay(muted, |midi| {
        if let Some(event) = to_midi_event(midi) {
            strip.send_midi(event);
        }
    });
    seq.attacks.clear();
    emit_key_changes(
        BTreeMap::new(),
        sounding_keys(seq),
        &mut seq.attacks,
        |midi| {
            if let Some(event) = to_midi_event(midi) {
                strip.send_midi(event);
            }
        },
    );
    seq.cursor = plan.resume_index;
}

type SoundingKeys = BTreeMap<(u8, u8), u8>;

fn sounding_keys(seq: &SlotSeq) -> SoundingKeys {
    seq.active
        .iter()
        .filter(|note| note.sounding)
        .map(|note| ((note.channel, note.note), note.velocity))
        .collect()
}

/// MIDI 1 note-offs have no part identity. Keep a shared key sounding until its
/// final audible owner releases it; clearing selection must not cut another part.
fn emit_key_changes(
    before: SoundingKeys,
    after: SoundingKeys,
    attacks: &mut BTreeMap<(u8, u8), usize>,
    mut emit: impl FnMut(ResolvedMidi),
) {
    for &(channel, note) in before.keys() {
        if !after.contains_key(&(channel, note)) {
            // VST instruments may stack same-key attacks rather than releasing
            // every matching voice on one note-off. Balance all physical attacks.
            for _ in 0..attacks.remove(&(channel, note)).unwrap_or(0) {
                emit(ResolvedMidi::NoteOff { channel, note });
            }
        }
    }
    for (&(channel, note), &velocity) in &after {
        if !before.contains_key(&(channel, note)) {
            *attacks.entry((channel, note)).or_default() += 1;
            emit(ResolvedMidi::NoteOn {
                channel,
                note,
                velocity,
            });
        }
    }
}

/// Controller intent advances while excluded, but only eligible sources send it.
/// Only release notes actually sent: an excluded part must not release another
/// part's same-channel/key note in a shared slot.
pub(super) fn dispatch_event(
    seq: &mut SlotSeq,
    strip: &mut Strip,
    event: ResolvedEvent,
    offset: i32,
    muted: &HashSet<u32>,
) {
    route_event(seq, event, muted, |midi| {
        if let Some(midi) = to_midi_event(midi) {
            strip.send_midi_at(midi, offset);
        }
    });
}

fn route_event(
    seq: &mut SlotSeq,
    event: ResolvedEvent,
    muted: &HashSet<u32>,
    mut emit: impl FnMut(ResolvedMidi),
) {
    if to_midi_event(event.midi).is_none() {
        return;
    }
    let before = sounding_keys(seq);
    match event.midi {
        ResolvedMidi::NoteOn {
            channel,
            note,
            velocity,
        } if velocity > 0 => {
            let Some(note_id) = event.note_id else {
                return;
            };
            let sounding = !muted.contains(&event.part);
            // Scheduled repetitions still articulate, including repeated keys
            // under pedal. Only live reconciliation coalesces new ownership.
            if sounding && before.contains_key(&(channel, note)) {
                emit(event.midi);
                *seq.attacks.entry((channel, note)).or_default() += 1;
            }
            seq.active.push(ActiveNote {
                note_id,
                part: event.part,
                channel,
                note,
                velocity,
                sounding,
                key_down: true,
            });
        }
        ResolvedMidi::NoteOff { channel, note } | ResolvedMidi::NoteOn { channel, note, .. } => {
            let Some(note_id) = event.note_id else {
                return;
            };
            if let Some(index) = seq.active.iter().position(|active| {
                active.note_id == note_id
                    && active.part == event.part
                    && active.channel == channel
                    && active.note == note
                    && active.key_down
            }) {
                if seq.sustain.contains(&(event.part, channel)) {
                    seq.active[index].key_down = false;
                } else {
                    seq.active.remove(index);
                }
            }
        }
        ResolvedMidi::ControlChange {
            channel,
            controller: 64,
            value,
        } => {
            // Owning pedal lifetime here permits immediate per-part exclusion
            // without a channel-wide pedal reset releasing other parts' notes.
            if value >= 64 {
                seq.sustain.insert((event.part, channel));
            } else {
                seq.sustain.remove(&(event.part, channel));
                seq.active.retain(|active| {
                    active.part != event.part || active.channel != channel || active.key_down
                });
            }
            emit(ResolvedMidi::ControlChange {
                channel,
                controller: 64,
                value: 0,
            });
        }
        ResolvedMidi::ControlChange {
            channel,
            controller,
            value,
        } => route_controller(
            seq, event.part, channel, controller, value, muted, &mut emit,
        ),
    }
    emit_key_changes(before, sounding_keys(seq), &mut seq.attacks, emit);
}

fn route_controller(
    seq: &mut SlotSeq,
    part: u32,
    channel: u8,
    controller: u8,
    value: u8,
    muted: &HashSet<u32>,
    mut emit: impl FnMut(ResolvedMidi),
) {
    match controller {
        121 => {
            seq.sustain.remove(&(part, channel));
            seq.active.retain(|active| {
                active.part != part || active.channel != channel || active.key_down
            });
            seq.controllers.reset(part, channel);
            if !muted.contains(&part) {
                seq.controllers.reconcile(muted, emit);
            }
        }
        120 | 123..=127 => {
            // Channel-wide mode messages must not kill another source's voices.
            // All Sound Off drops even pedal-held ownership; All Notes Off and
            // mode changes release keys but still obey the source's sustain.
            let sustained = controller != 120 && seq.sustain.contains(&(part, channel));
            for active in &mut seq.active {
                if active.part == part && active.channel == channel {
                    active.key_down = false;
                }
            }
            if !sustained {
                seq.active
                    .retain(|active| active.part != part || active.channel != channel);
            }
        }
        _ => {
            seq.controllers.record(part, channel, controller, value);
            if !muted.contains(&part) {
                seq.controllers.apply(channel, controller, value, &mut emit);
            }
        }
    }
}

fn to_midi_event(midi: ResolvedMidi) -> Option<MidiEvent> {
    match midi {
        ResolvedMidi::NoteOn {
            channel,
            note,
            velocity,
        } => MidiChannel::from_index(channel).map(|channel| MidiEvent::NoteOn {
            channel,
            note,
            velocity,
        }),
        ResolvedMidi::NoteOff { channel, note } => {
            MidiChannel::from_index(channel).map(|channel| MidiEvent::NoteOff {
                channel,
                note,
                velocity: 0,
            })
        }
        ResolvedMidi::ControlChange {
            channel,
            controller,
            value,
        } => MidiChannel::from_index(channel).map(|channel| MidiEvent::ControlChange {
            channel,
            controller,
            value,
        }),
    }
}
