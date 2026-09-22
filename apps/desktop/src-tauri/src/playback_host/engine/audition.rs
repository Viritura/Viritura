//! Click-to-hear ownership is separate from the scheduled transport.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::{Duration, Instant};

use vst3_host::{MidiChannel, MidiEvent};

use super::super::mixer::{MixerCore, Strip};
use super::Engine;

#[cfg(test)]
mod tests;

pub(crate) fn validate_preview(notes: &[u8], velocity: u8, duration_ms: u64) -> Result<(), String> {
    if notes.is_empty() || notes.len() > 16 || notes.iter().any(|&note| note > 127) {
        return Err("preview requires 1..=16 MIDI notes in 0..=127".to_owned());
    }
    if !(1..=127).contains(&velocity) {
        return Err("preview velocity must be in 1..=127".to_owned());
    }
    if !(1..=10_000).contains(&duration_ms) {
        return Err("preview duration must be in 1..=10000 milliseconds".to_owned());
    }
    Ok(())
}

#[derive(Default)]
pub(super) struct PreviewNotes {
    slots: HashMap<String, BTreeMap<u8, PendingPreview>>,
}

#[derive(Clone, Copy)]
struct PendingPreview {
    part_index: u32,
    due: Instant,
}

pub(super) struct PreviewRequest<'a> {
    pub(super) slot_key: &'a str,
    pub(super) part_index: u32,
    pub(super) notes: &'a [u8],
    pub(super) velocity: u8,
    pub(super) duration_ms: u64,
    pub(super) replace: bool,
}

impl PreviewNotes {
    fn preview(
        &mut self,
        core: &mut MixerCore,
        playing: bool,
        request: PreviewRequest<'_>,
        now: Instant,
    ) -> Result<(), String> {
        validate_preview(request.notes, request.velocity, request.duration_ms)?;
        // MIDI 1 cannot distinguish a preview release from a scheduled same-key
        // release. Do not mix these ownership domains on an active transport.
        if playing {
            return Err("preview is unavailable while transport is playing".to_owned());
        }
        let strip = core
            .strip_mut(request.slot_key)
            .ok_or_else(|| "preview slot is not loaded".to_owned())?;
        let due = now + Duration::from_millis(request.duration_ms);
        self.play(strip, request, due);
        Ok(())
    }

    fn play(&mut self, strip: &mut Strip, request: PreviewRequest<'_>, due: Instant) {
        let pending = self.slots.entry(request.slot_key.to_owned()).or_default();
        if request.replace {
            for note in std::mem::take(pending).into_keys() {
                release(strip, note);
            }
        }
        strip.set_playing(true);
        // Duplicate pitches in a voicing own one attack and one release.
        let preview = PendingPreview {
            part_index: request.part_index,
            due,
        };
        let unique: BTreeMap<_, _> = request.notes.iter().map(|&note| (note, preview)).collect();
        for (note, preview) in unique {
            // A retrigger transfers the physical key and its deadline to the
            // latest part; the previous attack is balanced before replacement.
            if pending.insert(note, preview).is_some() {
                release(strip, note);
            }
            strip.send_midi(MidiEvent::NoteOn {
                channel: MidiChannel::from_index(0).unwrap(),
                note,
                velocity: request.velocity,
            });
        }
    }

    fn release_due(&mut self, core: &mut MixerCore, now: Instant) {
        self.slots.retain(|key, notes| {
            let Some(strip) = core.strip_mut(key) else {
                return false;
            };
            notes.retain(|&note, preview| {
                if preview.due > now {
                    return true;
                }
                release(strip, note);
                false
            });
            !notes.is_empty()
        });
    }

    fn cancel(&mut self, core: &mut MixerCore) {
        for (key, notes) in self.slots.drain() {
            if let Some(strip) = core.strip_mut(&key) {
                for note in notes.into_keys() {
                    release(strip, note);
                }
            }
        }
    }

    fn cancel_muted(&mut self, core: &mut MixerCore, muted_parts: &HashSet<u32>) {
        self.slots.retain(|key, notes| {
            let Some(strip) = core.strip_mut(key) else {
                return false;
            };
            notes.retain(|&note, preview| {
                if !muted_parts.contains(&preview.part_index) {
                    return true;
                }
                release(strip, note);
                false
            });
            !notes.is_empty()
        });
    }
}

fn release(strip: &mut Strip, note: u8) {
    strip.send_midi(MidiEvent::NoteOff {
        channel: MidiChannel::from_index(0).unwrap(),
        note,
        velocity: 0,
    });
}

impl Engine {
    pub(super) fn preview(&mut self, request: PreviewRequest<'_>) -> Result<(), String> {
        self.previews.preview(
            &mut self.mixer.lock(),
            self.playing,
            request,
            Instant::now(),
        )
    }

    pub(super) fn cancel_previews(&mut self) {
        self.previews.cancel(&mut self.mixer.lock());
    }

    pub(super) fn cancel_muted_previews(&mut self) {
        if self.previews.slots.is_empty() {
            return;
        }
        self.previews
            .cancel_muted(&mut self.mixer.lock(), &self.muted_parts);
    }

    pub(super) fn tick_previews(&mut self) {
        if !self.previews.slots.is_empty() {
            self.previews
                .release_due(&mut self.mixer.lock(), Instant::now());
        }
    }
}
