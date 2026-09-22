use super::*;
use crate::playback_host::mixer::tests::routing_sf2_strip;
use crate::playback_host::{BLOCK_SIZE, SAMPLE_RATE};

// Runtime chord playback is appended after 33 authored score parts.
const CHORD_PART: u32 = 33;
const AUTHORED_PART: u32 = CHORD_PART - 1;
const CHORD: [u8; 3] = [60, 64, 67];

#[test]
fn editor_global_chord_timeline_wire_renders_repeated_gm_piano_and_releases() {
    // The editor bridge test compares its real generated global-chord schedule
    // against this shared wire payload; no mapper or native IPC mock runs here.
    let events: Vec<PartScheduledMidi> = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/derived-chords-midi.json"
    )))
    .unwrap();
    assert!(events.iter().all(|event| event.part == 1));
    let mut seq = sequence();
    seq.schedule = resolve_schedule(&events);
    assert_eq!(seq.schedule.len(), 16);
    let mut strip = routing_sf2_strip(0, false);
    let mut peaks = [0.0f32; 2];
    let mut tail = 0.0f32;
    let mut frame = 0;
    while (frame as f64) < 12.0 * SAMPLE_RATE {
        let time = frame as f64 / SAMPLE_RATE;
        advance(
            &mut seq,
            &mut strip,
            (frame + BLOCK_SIZE) as f64 / SAMPLE_RATE,
            &HashSet::new(),
        );
        let peak = routing_peak(&mut strip);
        if time < 4.0 {
            let visit = (time / 2.0) as usize;
            peaks[visit] = peaks[visit].max(peak);
        }
        if time > 11.0 {
            tail = tail.max(peak);
        }
        frame += BLOCK_SIZE;
    }
    assert!(peaks.iter().all(|peak| *peak > 1e-4));
    assert!(tail < 1e-6);
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
}

fn note(part: u32, start: f64, end: f64, voice: usize, pitch: u8) -> [PartScheduledMidi; 2] {
    let id = format!("chord-voice-{voice}");
    [
        PartScheduledMidi {
            part,
            midi: ScheduledMidi {
                at_seconds: start,
                message: MidiMessage::NoteOn {
                    note_id: id.clone(),
                    channel: 0,
                    note: pitch,
                    velocity: 100,
                },
            },
        },
        PartScheduledMidi {
            part,
            midi: ScheduledMidi {
                at_seconds: end,
                message: MidiMessage::NoteOff { note_id: id },
            },
        },
    ]
}

fn chord_sequence() -> SlotSeq {
    let mut raw = Vec::from(note(AUTHORED_PART, 0.0, 2.5, 0, 60));
    // Successive chords and a repeat visit retain the same mapper-local IDs.
    for start in [0.0, 2.0, 4.0] {
        for (voice, pitch) in CHORD.into_iter().enumerate() {
            raw.extend(note(CHORD_PART, start, start + 1.0, voice, pitch));
        }
    }
    let mut seq = sequence();
    seq.schedule = resolve_schedule(&raw);
    seq
}

fn advance(seq: &mut SlotSeq, strip: &mut Strip, time: f64, muted: &HashSet<u32>) {
    while seq.cursor < seq.schedule.len() && seq.schedule[seq.cursor].at_seconds <= time {
        dispatch_event(seq, strip, seq.schedule[seq.cursor], 0, muted);
        seq.cursor += 1;
    }
}

fn chord_midi(attack: bool) -> Vec<(MidiEvent, i32)> {
    CHORD
        .into_iter()
        .map(|pitch| sent(if attack { on(0, pitch) } else { off(0, pitch) }, 0))
        .collect()
}

#[test]
fn derived_chord_lane_repeats_release_without_cutting_authored_same_id_notes() {
    let mut seq = chord_sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    advance(&mut seq, &mut strip, 0.0, &clear);
    let mut expected = vec![sent(on(0, 60), 0)];
    expected.extend(chord_midi(true));
    assert_eq!(take(&mut strip), expected);
    assert!((0..8).any(|_| routing_peak(&mut strip) > 1e-4));

    advance(&mut seq, &mut strip, 1.0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![sent(off(0, 64), 0), sent(off(0, 67), 0)]
    );
    assert_eq!(seq.active.len(), 1);
    assert_eq!(seq.active[0].part, AUTHORED_PART);

    advance(&mut seq, &mut strip, 2.0, &clear);
    assert_eq!(take(&mut strip), chord_midi(true));
    advance(&mut seq, &mut strip, 2.5, &clear);
    assert!(take(&mut strip).is_empty(), "the chord still owns the root");
    assert_eq!(seq.active.len(), 3);
    assert!(seq.active.iter().all(|note| note.part == CHORD_PART));

    advance(&mut seq, &mut strip, 3.0, &clear);
    let mut expected = vec![sent(off(0, 60), 0); 3];
    expected.extend([sent(off(0, 64), 0), sent(off(0, 67), 0)]);
    assert_eq!(take(&mut strip), expected);
    assert!(seq.active.is_empty());
    assert!(
        seq.attacks.is_empty(),
        "all stacked root attacks are balanced"
    );

    advance(&mut seq, &mut strip, 4.0, &clear);
    assert_eq!(take(&mut strip), chord_midi(true));
    assert!((0..8).any(|_| routing_peak(&mut strip) > 1e-4));
    advance(&mut seq, &mut strip, 5.0, &clear);
    assert_eq!(take(&mut strip), chord_midi(false));
    assert_eq!(seq.cursor, seq.schedule.len());
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
    for _ in 0..400 {
        routing_peak(&mut strip);
    }
    assert_eq!(
        routing_peak(&mut strip),
        0.0,
        "no panic is needed to release"
    );
}

#[test]
fn derived_chord_lane_seek_and_unmute_restore_only_the_current_repeat_visit() {
    for muted in [
        HashSet::new(),
        HashSet::from([CHORD_PART]),
        HashSet::from([AUTHORED_PART]),
    ] {
        let mut seq = chord_sequence();
        let mut strip = routing_strip();
        seek_slot(&mut seq, &mut strip, 2.25, &muted);
        let chord_muted = muted.contains(&CHORD_PART);
        assert_eq!(
            take(&mut strip),
            if chord_muted {
                vec![sent(on(0, 60), 0)]
            } else {
                chord_midi(true)
            }
        );
        assert_eq!(seq.active.len(), 4, "no finished first-visit notes survive");
        assert_eq!(seq.schedule[seq.cursor].at_seconds, 2.5);
        for active in &seq.active {
            assert_eq!(active.sounding, !muted.contains(&active.part));
            let attack = seq
                .schedule
                .iter()
                .find(|event| {
                    event.note_id == Some(active.note_id)
                        && matches!(event.midi, ResolvedMidi::NoteOn { .. })
                })
                .unwrap();
            assert_eq!(
                attack.at_seconds,
                if active.part == CHORD_PART { 2.0 } else { 0.0 }
            );
        }
        advance(&mut seq, &mut strip, 2.5, &muted);
        assert_eq!(
            take(&mut strip),
            if chord_muted {
                vec![sent(off(0, 60), 0)]
            } else {
                vec![]
            }
        );
        assert_eq!(seq.active.len(), 3);
        assert!(seq.active.iter().all(|note| note.part == CHORD_PART));
        let cursor = seq.cursor;
        reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
        assert_eq!(seq.cursor, cursor, "unmuting must not seek");
        assert_eq!(
            take(&mut strip),
            if chord_muted {
                chord_midi(true)
            } else {
                vec![]
            }
        );
        reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
        assert!(take(&mut strip).is_empty(), "unmute must be idempotent");
        advance(&mut seq, &mut strip, 3.0, &HashSet::new());
        assert_eq!(take(&mut strip), chord_midi(false));
        assert!(seq.active.is_empty());
        assert!(seq.attacks.is_empty());
    }
}

#[test]
fn derived_chord_lane_muted_repeat_visits_never_release_or_resurrect_authored_notes() {
    let mut seq = chord_sequence();
    let mut strip = routing_strip();
    let muted = HashSet::from([CHORD_PART]);
    advance(&mut seq, &mut strip, 0.0, &muted);
    assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
    advance(&mut seq, &mut strip, 2.0, &muted);
    assert!(
        take(&mut strip).is_empty(),
        "muted chords cannot cut the root"
    );
    advance(&mut seq, &mut strip, 2.5, &muted);
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
    advance(&mut seq, &mut strip, 5.0, &muted);
    assert!(take(&mut strip).is_empty());
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert!(
        take(&mut strip).is_empty(),
        "finished repeats cannot reattack"
    );
    for _ in 0..400 {
        routing_peak(&mut strip);
    }
    assert_eq!(routing_peak(&mut strip), 0.0);

    seek_slot(&mut seq, &mut strip, 5.5, &HashSet::new());
    assert_eq!(seq.cursor, seq.schedule.len());
    assert!(seq.active.is_empty());
    assert!(
        take(&mut strip).is_empty(),
        "seeking past repeats stays silent"
    );
}

#[test]
fn derived_chord_lane_repeated_sf2_loops_are_silent_after_final_release() {
    for program in [48, 73] {
        let mut seq = chord_sequence();
        let mut strip = routing_sf2_strip(program, false);
        let clear = HashSet::new();
        let mut visit_peaks = [0.0f32; 3];
        let mut tail_peak = 0.0f32;
        let mut frame = 0;
        while (frame as f64) < 12.0 * SAMPLE_RATE {
            let time = frame as f64 / SAMPLE_RATE;
            let horizon = (frame + BLOCK_SIZE) as f64 / SAMPLE_RATE;
            advance(&mut seq, &mut strip, horizon, &clear);
            let peak = routing_peak(&mut strip);
            for (visit, start) in [0.0, 2.0, 4.0].into_iter().enumerate() {
                if time >= start && time < start + 1.0 {
                    visit_peaks[visit] = visit_peaks[visit].max(peak);
                }
            }
            if time >= 11.0 {
                tail_peak = tail_peak.max(peak);
            }
            frame += BLOCK_SIZE;
        }
        assert!(
            visit_peaks.iter().all(|peak| *peak > 1e-4),
            "program {program}: every chord visit must sound: {visit_peaks:?}"
        );
        assert!(
            tail_peak < 1e-6,
            "program {program}: chord samples must not loop after release: {tail_peak}"
        );
        assert_eq!(seq.cursor, seq.schedule.len());
        assert!(seq.active.is_empty());
        assert!(seq.attacks.is_empty());
    }
}
