use std::collections::{BTreeMap, HashSet};

use super::ResolvedMidi;

#[derive(Default)]
pub(in crate::playback_host::engine) struct Controllers {
    intent: BTreeMap<(u32, u8, u8), (usize, u8)>,
    applied: BTreeMap<(u8, u8), u8>,
    order: usize,
}

impl Controllers {
    pub(super) fn record(&mut self, part: u32, channel: u8, controller: u8, value: u8) {
        self.order += 1;
        self.intent
            .insert((part, channel, controller), (self.order, value));
    }

    pub(super) fn apply(
        &mut self,
        channel: u8,
        controller: u8,
        value: u8,
        mut emit: impl FnMut(ResolvedMidi),
    ) {
        self.applied.insert((channel, controller), value);
        emit(ResolvedMidi::ControlChange {
            channel,
            controller,
            value,
        });
    }

    pub(super) fn reset(&mut self, part: u32, channel: u8) {
        // CC121 resets expression, modulation, pedals and parameter selection,
        // not volume, pan, bank selection, effects or sound-shaping controls.
        for controller in [
            1, 2, 4, 11, 33, 34, 36, 43, 64, 65, 66, 67, 68, 69, 98, 99, 100, 101,
        ] {
            if controller != 64 {
                self.record(part, channel, controller, default_value(controller));
            }
        }
    }

    pub(super) fn replay(&mut self, muted: &HashSet<u32>, emit: impl FnMut(ResolvedMidi)) {
        self.applied.clear();
        self.reconcile(muted, emit);
    }

    pub(super) fn reconcile(&mut self, muted: &HashSet<u32>, mut emit: impl FnMut(ResolvedMidi)) {
        // MIDI 1 cannot express distinct controls for sources sharing a channel.
        // Last scheduled write among eligible sources wins, both live and on seek;
        // eligibility changes never promote an older source merely by replaying it.
        let mut effective = BTreeMap::new();
        for (&(part, channel, controller), &(order, value)) in &self.intent {
            if muted.contains(&part) {
                continue;
            }
            let current = effective.entry((channel, controller)).or_insert((0, value));
            if order > current.0 {
                *current = (order, value);
            }
        }
        for &key in self.applied.keys() {
            effective.entry(key).or_insert((0, default_value(key.1)));
        }
        let mut ordered: Vec<_> = effective.into_iter().collect();
        ordered.sort_by_key(|(_, (order, _))| *order);
        for ((channel, controller), (_, value)) in ordered {
            if self.applied.get(&(channel, controller)) != Some(&value) {
                self.apply(channel, controller, value, &mut emit);
            }
        }
    }
}

fn default_value(controller: u8) -> u8 {
    match controller {
        7 => 100,
        8 | 10 => 64,
        11 | 98..=101 => 127,
        _ => 0,
    }
}
