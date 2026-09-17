use super::*;
use crate::playback_host::mixer::tests::routing_sf2_strip;
use crate::playback_host::{BLOCK_SIZE, SAMPLE_RATE};

fn attack(at: f64, id: &str, note: u8) -> PartScheduledMidi {
    raw(
        at,
        MidiMessage::NoteOn {
            note_id: id.to_owned(),
            channel: 0,
            note,
            velocity: 100,
        },
    )
}

fn release(at: f64, id: &str) -> PartScheduledMidi {
    raw(
        at,
        MidiMessage::NoteOff {
            note_id: id.to_owned(),
        },
    )
}

fn raw(at: f64, message: MidiMessage) -> PartScheduledMidi {
    PartScheduledMidi {
        part: 0,
        midi: ScheduledMidi {
            at_seconds: at,
            message,
        },
    }
}

fn render_until(seq: &mut SlotSeq, strip: &mut Strip, frame: &mut usize, seconds: f64) -> f32 {
    let mut peak = 0.0f32;
    while (*frame as f64) < seconds * SAMPLE_RATE {
        let horizon = (*frame + BLOCK_SIZE) as f64 / SAMPLE_RATE;
        while seq.cursor < seq.schedule.len() && seq.schedule[seq.cursor].at_seconds < horizon {
            let event = seq.schedule[seq.cursor];
            dispatch_event(seq, strip, event, 0, &HashSet::new());
            seq.cursor += 1;
        }
        peak = peak.max(routing_peak(strip));
        *frame += BLOCK_SIZE;
    }
    peak
}

#[test]
fn sf2_reused_note_ids_release_looped_samples_after_the_final_note_off() {
    for program in [48, 73] {
        for second_key in [60, 64] {
            let mut seq = sequence();
            let mut strip = routing_sf2_strip(program, false);
            seq.schedule = resolve_schedule(&[
                attack(0.0, "repeated", 60),
                release(0.3, "repeated"),
                attack(0.5, "repeated", second_key),
                release(0.8, "repeated"),
            ]);
            let mut frame = 0;
            assert!(render_until(&mut seq, &mut strip, &mut frame, 0.3) > 1e-4);
            render_until(&mut seq, &mut strip, &mut frame, 6.0);
            let tail = render_until(&mut seq, &mut strip, &mut frame, 7.0);
            assert!(
                tail < 1e-6,
                "program {program}, key {second_key}: audio still looping long after release: {tail}"
            );
            assert!(seq.active.is_empty());
            assert!(seq.attacks.is_empty());
        }
    }
}

#[test]
fn sf2_overlapping_reused_ids_match_distinct_ids_for_programs_and_percussion() {
    for (program, is_drum, key) in [
        (0, false, 60),
        (48, false, 60),
        (73, false, 60),
        (0, true, 46),
    ] {
        let mut repeated = sequence();
        let mut distinct = sequence();
        repeated.schedule = resolve_schedule(&[
            attack(0.0, "a", key),
            attack(0.1, "a", key),
            release(0.3, "a"),
            release(0.8, "a"),
        ]);
        distinct.schedule = resolve_schedule(&[
            attack(0.0, "a", key),
            attack(0.1, "b", key),
            release(0.3, "a"),
            release(0.8, "b"),
        ]);
        let mut repeated_strip = routing_sf2_strip(program, is_drum);
        let mut distinct_strip = routing_sf2_strip(program, is_drum);
        let mut repeated_frame = 0;
        let mut distinct_frame = 0;
        for seconds in [0.3, 0.8, 1.0, 6.0, 7.0] {
            let actual = render_until(
                &mut repeated,
                &mut repeated_strip,
                &mut repeated_frame,
                seconds,
            );
            let expected = render_until(
                &mut distinct,
                &mut distinct_strip,
                &mut distinct_frame,
                seconds,
            );
            assert_eq!(
                actual, expected,
                "program {program}, drums {is_drum}, time {seconds}"
            );
            if seconds == 0.3 {
                assert!(actual > 1e-4);
            }
            if seconds == 7.0 {
                assert!(
                    actual < 1e-6,
                    "released samples must eventually become silent"
                );
            }
        }
    }
}

#[test]
fn sf2_note_off_preserves_sample_release_instead_of_truncating_or_looping() {
    let mut released = sequence();
    released.schedule = resolve_schedule(&[attack(0.0, "a", 60), release(0.3, "a")]);
    let mut held = sequence();
    held.schedule = resolve_schedule(&[attack(0.0, "a", 60)]);
    let mut released_strip = routing_sf2_strip(48, false);
    let mut held_strip = routing_sf2_strip(48, false);
    let mut released_frame = 0;
    let mut held_frame = 0;
    render_until(&mut released, &mut released_strip, &mut released_frame, 0.3);
    let release_tail = render_until(&mut released, &mut released_strip, &mut released_frame, 0.4);
    assert!(
        release_tail > 1e-4,
        "the SF2 release envelope must remain audible"
    );
    render_until(&mut released, &mut released_strip, &mut released_frame, 6.0);
    render_until(&mut held, &mut held_strip, &mut held_frame, 6.0);
    assert!(render_until(&mut released, &mut released_strip, &mut released_frame, 7.0) < 1e-6);
    assert!(
        render_until(&mut held, &mut held_strip, &mut held_frame, 7.0) > 1e-4,
        "this fixture must distinguish a held sample loop from its finite release"
    );
}

#[test]
fn sf2_reused_ids_release_after_sustain_filter_and_seek_reconstruction() {
    for seeking in [false, true] {
        let mut seq = sequence();
        seq.schedule = resolve_schedule(&[
            raw(
                0.0,
                MidiMessage::ControlChange {
                    channel: 0,
                    controller: 64,
                    value: 127,
                },
            ),
            attack(0.0, "a", 60),
            release(0.3, "a"),
            attack(0.5, "a", 64),
            release(0.8, "a"),
            raw(
                1.0,
                MidiMessage::ControlChange {
                    channel: 0,
                    controller: 64,
                    value: 0,
                },
            ),
        ]);
        let mut strip = routing_sf2_strip(48, false);
        let mut frame = 0;
        if seeking {
            strip.panic();
            seek_slot(&mut seq, &mut strip, 0.6, &HashSet::new());
            frame = (0.6 * SAMPLE_RATE) as usize;
        }
        assert!(render_until(&mut seq, &mut strip, &mut frame, 0.9) > 1e-4);
        let cursor = seq.cursor;
        reconcile_notes(&mut seq, &mut strip, &HashSet::from([0]), true);
        routing_peak(&mut strip);
        reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
        assert_eq!(cursor, seq.cursor, "live filter must not seek");
        render_until(&mut seq, &mut strip, &mut frame, 6.0);
        assert!(render_until(&mut seq, &mut strip, &mut frame, 7.0) < 1e-6);
        assert!(seq.active.is_empty());
        assert!(seq.attacks.is_empty());
    }
}
