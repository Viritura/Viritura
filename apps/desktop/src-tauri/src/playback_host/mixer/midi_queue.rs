use vst3_host::MidiEvent;

/// Host commands are ordered, but their offsets are relative to different ticks.
/// Submit together at the render boundary, never putting a live note-off before
/// its queued look-ahead attack (or a rapid reattack before that note-off).
#[derive(Default)]
pub(super) struct MidiQueue {
    events: Vec<(MidiEvent, i32)>,
}

impl MidiQueue {
    pub(super) fn push(&mut self, event: MidiEvent, offset: i32) {
        let offset = offset.max(self.events.last().map_or(0, |(_, offset)| *offset));
        self.events.push((event, offset));
    }

    pub(super) fn drain(&mut self) -> impl Iterator<Item = (MidiEvent, i32)> + '_ {
        self.events.drain(..)
    }

    pub(super) fn clear(&mut self) {
        self.events.clear();
    }
}
