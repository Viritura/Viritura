use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rustysynth::SoundFont;
use vst3_host::{MidiChannel, MidiEvent};

use super::*;
use crate::playback_host::sf2::load_soundfont;

const KEY: &str = "sf2:part:0";

fn bundled_soundfont_path() -> PathBuf {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    let fonts: Vec<_> = config["bundle"]["resources"]
        .as_object()
        .unwrap()
        .keys()
        .filter(|source| {
            Path::new(source)
                .extension()
                .is_some_and(|extension| extension == "sf2")
        })
        .collect();
    assert_eq!(fonts.len(), 1, "expected one bundled SF2 resource");
    Path::new(env!("CARGO_MANIFEST_DIR")).join(fonts[0])
}

fn source(program: u8) -> StripSource {
    static FONT: OnceLock<Arc<SoundFont>> = OnceLock::new();
    let font = FONT.get_or_init(|| {
        load_soundfont(bundled_soundfont_path().to_str().unwrap()).expect("load bundled SoundFont")
    });
    StripSource::Sf2(Box::new(Sf2Voice::new(font, program, false).unwrap()))
}

pub(in crate::playback_host) fn routing_strip() -> Strip {
    let mut core = MixerCore::new();
    core.insert(KEY.to_owned(), source(0), 0.4, -0.5, 0.25);
    core.strips.remove(KEY).unwrap()
}

pub(in crate::playback_host) fn routing_peak(strip: &mut Strip) -> f32 {
    assert_eq!(
        (strip.gain, strip.pan, strip.reverb_send),
        (0.4, -0.5, 0.25)
    );
    strip.render_block(BLOCK_SIZE);
    strip
        .scratch
        .outputs
        .iter()
        .flatten()
        .fold(0.0f32, |peak, sample| peak.max(sample.abs()))
}

pub(in crate::playback_host) fn routing_midi(strip: &mut Strip) -> Vec<(MidiEvent, i32)> {
    strip.flush_midi();
    std::mem::take(&mut strip.midi_events)
}

fn strike(mixer: &mut MixerCore) {
    let strip = mixer.strip_mut(KEY).unwrap();
    // An asymmetric source distinguishes stereo folding from mono panning or
    // balance-only attenuation, even when the font's piano sample is mono.
    strip.send_midi(MidiEvent::ControlChange {
        channel: MidiChannel::from_index(0).unwrap(),
        controller: 10,
        value: 32,
    });
    strip.send_midi(MidiEvent::NoteOn {
        channel: MidiChannel::from_index(0).unwrap(),
        note: 60,
        velocity: 100,
    });
}

fn assert_render(core: &mut MixerCore, gain: f32, pan: f32, send: f32) {
    let mut output = vec![0.0; BLOCK_SIZE * OUTPUT_CHANNELS];
    for _ in 0..4 {
        core.render(&mut output, OUTPUT_CHANNELS);
    }
    let raw = &core.strips[KEY].scratch.outputs;
    assert!(
        raw.iter().flatten().any(|sample| sample.abs() > 1e-4),
        "the real SF2 source must be audible, even with the fader down"
    );
    assert!(
        raw[0]
            .iter()
            .zip(&raw[1])
            .any(|(left, right)| (left - right).abs() > 1e-4),
        "the test must exercise distinct stereo channels"
    );
    // Independent, exact reference points for the stereo equal-power law.
    let half = std::f32::consts::FRAC_1_SQRT_2;
    for frame in 0..BLOCK_SIZE {
        let left = raw[0][frame];
        let right = raw[1][frame];
        let expected = match pan {
            -1.0 => [left + right, 0.0],
            -0.5 => [left + right * half, right * half],
            0.0 => [left, right],
            0.5 => [left * half, right + left * half],
            1.0 => [0.0, right + left],
            _ => panic!("unsupported reference pan {pan}"),
        };
        for ch in 0..OUTPUT_CHANNELS {
            let dry = expected[ch] * gain;
            assert!(
                (output[frame * OUTPUT_CHANNELS + ch] - dry).abs() < 1e-6,
                "dry mismatch: pan={pan}, gain={gain}, ch={ch}, frame={frame}"
            );
            assert!(
                (core.send_bus[ch][frame] - dry * send).abs() < 1e-6,
                "send must follow both pan and gain: ch={ch}, frame={frame}"
            );
            if dry == 0.0 {
                assert_eq!(output[frame * OUTPUT_CHANNELS + ch], 0.0);
                assert_eq!(core.send_bus[ch][frame], 0.0);
            }
        }
    }
}

#[test]
fn rendered_stereo_pan_preserves_center_and_folds_both_extremes() {
    let mut mixer = MixerCore::new();
    for pan in [0.0, -0.5, 0.5, -1.0, 1.0] {
        mixer.insert(KEY.to_owned(), source(0), 0.4, pan, 0.25);
        strike(&mut mixer);
        assert_render(&mut mixer, 0.4, pan, 0.25);
    }
}

#[test]
fn live_controls_and_panic_preserve_rendered_mix() {
    let mut mixer = MixerCore::new();
    mixer.insert(KEY.to_owned(), source(0), 1.0, 0.0, 0.0);
    strike(&mut mixer);
    assert_render(&mut mixer, 1.0, 0.0, 0.0);

    mixer.set_pan(KEY, -0.5);
    assert_render(&mut mixer, 1.0, -0.5, 0.0);
    mixer.set_gain(KEY, 0.3);
    mixer.set_reverb_levels(0.6, 1.0);
    assert_render(&mut mixer, 0.3, -0.5, 0.6);

    mixer.for_each_strip(Strip::panic);
    strike(&mut mixer);
    assert_render(&mut mixer, 0.3, -0.5, 0.6);
    mixer.set_pan(KEY, 1.0);
    assert_render(&mut mixer, 0.3, 1.0, 0.6);
}

#[test]
fn reapplying_and_replacing_strips_uses_all_load_controls() {
    let mut mixer = MixerCore::new();
    mixer.insert(KEY.to_owned(), source(0), 0.4, -1.0, 0.2);
    strike(&mut mixer);
    assert_render(&mut mixer, 0.4, -1.0, 0.2);

    mixer.strip_mut(KEY).unwrap().set_mix(0.6, 0.5, 0.7);
    assert_render(&mut mixer, 0.6, 0.5, 0.7);

    mixer.strips.remove(KEY);
    mixer.insert(KEY.to_owned(), source(1), 0.2, -0.5, 0.9);
    strike(&mut mixer);
    assert_render(&mut mixer, 0.2, -0.5, 0.9);
}

#[test]
fn zero_gain_silences_dry_and_send_without_losing_pan_or_send() {
    let mut mixer = MixerCore::new();
    mixer.insert(KEY.to_owned(), source(0), 0.0, -1.0, 0.8);
    strike(&mut mixer);
    assert_render(&mut mixer, 0.0, -1.0, 0.8);
    mixer.set_gain(KEY, 0.5);
    assert_render(&mut mixer, 0.5, -1.0, 0.8);
    mixer.set_reverb_levels(0.0, 1.0);
    assert_render(&mut mixer, 0.5, -1.0, 0.0);
}

#[test]
fn pan_is_bounded_on_insert_reapply_and_live_update() {
    let mut mixer = MixerCore::new();
    mixer.insert(KEY.to_owned(), source(0), 0.5, -2.0, 0.4);
    strike(&mut mixer);
    assert_render(&mut mixer, 0.5, -1.0, 0.4);
    mixer.strip_mut(KEY).unwrap().set_mix(0.5, 2.0, 0.4);
    assert_render(&mut mixer, 0.5, 1.0, 0.4);
    for (pan, expected) in [
        (-2.0, -1.0),
        (2.0, 1.0),
        (f32::NAN, 0.0),
        (f32::INFINITY, 0.0),
        (f32::NEG_INFINITY, 0.0),
    ] {
        mixer.set_pan(KEY, pan);
        assert_render(&mut mixer, 0.5, expected, 0.4);
    }
    mixer.set_pan("unloaded", 0.5);
    assert_render(&mut mixer, 0.5, 0.0, 0.4);
}
