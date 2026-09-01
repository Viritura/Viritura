//! Native SoundFont synthesis as a mixer strip source.
//!
//! In the desktop "native" render mode every part plays through the one native
//! mixer so they share a clock and the shared reverb aux bus. Parts that aren't
//! routed to a VST are voiced here by a [`rustysynth`] synthesizer instead of the
//! browser's SF2 engine, driven by the exact same scheduled-MIDI pipeline the VST
//! slots use — a `Sf2Voice` is just another [`super::mixer::StripSource`].
//!
//! One `Sf2Voice` renders one part on a single MIDI channel (0 for pitched parts,
//! 9 for GM percussion). The parsed SoundFont is large (a full GM bank), so it is
//! loaded once and shared behind an `Arc` across every voice.

use std::io::BufReader;
use std::sync::Arc;

use rustysynth::{SoundFont, Synthesizer, SynthesizerSettings};

use super::{BLOCK_SIZE, SAMPLE_RATE};

/// GM percussion channel (0-based): rustysynth voices channel 9 as a drum kit.
const DRUM_CHANNEL: i32 = 9;
/// GM pitched channel (0-based) used for melodic parts.
const PITCHED_CHANNEL: i32 = 0;
/// MIDI status high-nibbles used when driving the synth from raw controllers.
const PROGRAM_CHANGE: i32 = 0xC0;
const CONTROL_CHANGE: i32 = 0xB0;

/// Parse a SoundFont file into a shared, reference-counted bank. Parsing a full
/// GM font is expensive, so the caller caches the returned `Arc` and hands the
/// same one to every voice.
pub(super) fn load_soundfont(path: &str) -> Result<Arc<SoundFont>, String> {
    let file =
        std::fs::File::open(path).map_err(|error| format!("open soundfont {path}: {error}"))?;
    let mut reader = BufReader::new(file);
    SoundFont::new(&mut reader)
        .map(Arc::new)
        .map_err(|error| format!("parse soundfont {path}: {error}"))
}

/// One part's SoundFont voice. Wraps a rustysynth [`Synthesizer`] plus reusable
/// stereo render scratch, so a block render never allocates in steady state.
pub(super) struct Sf2Voice {
    synth: Synthesizer,
    channel: i32,
    left: Vec<f32>,
    right: Vec<f32>,
}

impl Sf2Voice {
    /// Build a voice for `program` on the shared `sound_font`. Drum parts play on
    /// the GM percussion channel; the synth's built-in reverb/chorus is disabled
    /// so the mixer's shared reverb aux bus is the single reverb in native mode.
    pub(super) fn new(
        sound_font: &Arc<SoundFont>,
        program: u8,
        is_drum: bool,
    ) -> Result<Self, String> {
        let mut settings = SynthesizerSettings::new(SAMPLE_RATE as i32);
        settings.block_size = BLOCK_SIZE;
        settings.enable_reverb_and_chorus = false;
        let mut synth =
            Synthesizer::new(sound_font, &settings).map_err(|error| error.to_string())?;
        let channel = if is_drum {
            DRUM_CHANNEL
        } else {
            PITCHED_CHANNEL
        };
        synth.process_midi_message(channel, PROGRAM_CHANGE, program as i32, 0);
        Ok(Self {
            synth,
            channel,
            left: vec![0.0; BLOCK_SIZE],
            right: vec![0.0; BLOCK_SIZE],
        })
    }

    /// Start a note. The incoming channel is ignored — a voice owns one part on
    /// its own channel, so the note is routed there (keeps drums on channel 9).
    pub(super) fn note_on(&mut self, note: u8, velocity: u8) {
        self.synth
            .note_on(self.channel, note as i32, velocity as i32);
    }

    /// Release a note.
    pub(super) fn note_off(&mut self, note: u8) {
        self.synth.note_off(self.channel, note as i32);
    }

    /// Apply a control-change (expression, sustain, etc.) to the voice's channel.
    pub(super) fn control_change(&mut self, controller: u8, value: u8) {
        self.synth.process_midi_message(
            self.channel,
            CONTROL_CHANGE,
            controller as i32,
            value as i32,
        );
    }

    /// All-notes-off + controller reset (transport stop / panic).
    pub(super) fn panic(&mut self) {
        self.synth.note_off_all(true);
        self.synth.reset_all_controllers();
    }

    /// Render `frames` samples into `outputs[0]` (left) and `outputs[1]` (right).
    /// Extra output channels are left untouched (already cleared by the caller).
    pub(super) fn render(&mut self, outputs: &mut [Vec<f32>], frames: usize) {
        if self.left.len() < frames {
            self.left.resize(frames, 0.0);
            self.right.resize(frames, 0.0);
        }
        self.synth
            .render(&mut self.left[..frames], &mut self.right[..frames]);
        if let Some(dst) = outputs.get_mut(0) {
            let n = frames.min(dst.len());
            dst[..n].copy_from_slice(&self.left[..n]);
        }
        if let Some(dst) = outputs.get_mut(1) {
            let n = frames.min(dst.len());
            dst[..n].copy_from_slice(&self.right[..n]);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::*;

    fn bundled_soundfont_path() -> PathBuf {
        let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("parse Tauri config");
        let resources = config["bundle"]["resources"]
            .as_object()
            .expect("Tauri bundle resources must be an object");
        let soundfonts = resources
            .keys()
            .filter(|source| {
                Path::new(source)
                    .extension()
                    .is_some_and(|extension| extension == "sf2")
            })
            .collect::<Vec<_>>();
        assert_eq!(
            soundfonts.len(),
            1,
            "expected exactly one bundled SF2 resource"
        );
        Path::new(env!("CARGO_MANIFEST_DIR")).join(soundfonts[0])
    }

    #[test]
    fn renders_a_note_to_non_silent_audio() {
        let font_path = bundled_soundfont_path();
        let font = load_soundfont(font_path.to_str().expect("soundfont path must be UTF-8"))
            .expect("load soundfont");
        let mut voice = Sf2Voice::new(&font, 0, false).expect("build voice");
        voice.note_on(60, 100);

        let mut outputs = vec![vec![0.0f32; BLOCK_SIZE], vec![0.0f32; BLOCK_SIZE]];
        // Render a few blocks so the note's attack has sounded.
        for _ in 0..8 {
            voice.render(&mut outputs, BLOCK_SIZE);
        }
        let peak = outputs
            .iter()
            .flat_map(|ch| ch.iter())
            .fold(0.0f32, |m, &s| m.max(s.abs()));
        assert!(peak > 0.0, "a struck note should produce non-silent output");
    }

    #[test]
    fn silent_until_a_note_is_struck() {
        let font_path = bundled_soundfont_path();
        let font = load_soundfont(font_path.to_str().expect("soundfont path must be UTF-8"))
            .expect("load soundfont");
        let mut voice = Sf2Voice::new(&font, 0, false).expect("build voice");

        let mut outputs = vec![vec![0.0f32; BLOCK_SIZE], vec![0.0f32; BLOCK_SIZE]];
        voice.render(&mut outputs, BLOCK_SIZE);
        let peak = outputs
            .iter()
            .flat_map(|ch| ch.iter())
            .fold(0.0f32, |m, &s| m.max(s.abs()));
        assert_eq!(peak, 0.0, "no note struck yet → silence");
    }
}
