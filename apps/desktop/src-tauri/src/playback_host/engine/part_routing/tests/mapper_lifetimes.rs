use super::*;
use crate::mapper::{
    compile_and_dispatch, Articulations, NotationNote, PlaybackEvent, PlayingState,
};

const STRINGS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../editor/public/articulations/hollywood_strings_basic.lua"
));

fn performance_note(start: f64, duration: f64) -> PlaybackEvent {
    PlaybackEvent::NoteOn {
        time: start,
        note: NotationNote {
            // Expanded repeats retain the original score note ID.
            id: "score-note".to_owned(),
            start_time: start,
            duration,
            pitch: 60,
            dynamics: 0.8,
            articulations: Articulations::default(),
            state: PlayingState::default(),
        },
    }
}

fn compile(source: &str, part: u32, notes: &[PlaybackEvent]) -> Vec<PartScheduledMidi> {
    compile_and_dispatch(source, notes)
        .unwrap()
        .into_iter()
        .map(|midi| PartScheduledMidi { part, midi })
        .collect()
}

fn advance(seq: &mut SlotSeq, strip: &mut Strip, time: f64) {
    while seq.cursor < seq.schedule.len() && seq.schedule[seq.cursor].at_seconds <= time {
        dispatch_event(seq, strip, seq.schedule[seq.cursor], 17, &HashSet::new());
        seq.cursor += 1;
    }
}

fn rendered_notes(strip: &mut Strip) -> Vec<(MidiEvent, i32)> {
    routing_peak(strip);
    take(strip)
        .into_iter()
        .filter(|(event, _)| matches!(event, MidiEvent::NoteOn { .. } | MidiEvent::NoteOff { .. }))
        .collect()
}

fn strings_on(channel: u8) -> ResolvedMidi {
    ResolvedMidi::NoteOn {
        channel,
        note: 60,
        velocity: 96,
    }
}

#[test]
fn shipped_mapper_repeated_notes_deliver_each_release_at_its_own_end() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    seq.schedule = resolve_schedule(&compile(
        STRINGS,
        0,
        &[
            performance_note(0.0, 1.0),
            performance_note(2.0, 1.0),
            // A repeat may change patch/channel with its mapped articulation.
            performance_note(4.0, 0.5),
        ],
    ));
    for (start, end, channel) in [(0.0, 1.0, 1), (2.0, 3.0, 1), (4.0, 4.5, 0)] {
        advance(&mut seq, &mut strip, start);
        assert_eq!(
            rendered_notes(&mut strip),
            vec![sent(strings_on(channel), 17)]
        );
        assert!((0..8).any(|_| routing_peak(&mut strip) > 1e-4));
        advance(&mut seq, &mut strip, end - 0.01);
        assert!(rendered_notes(&mut strip).is_empty());
        advance(&mut seq, &mut strip, end);
        assert_eq!(rendered_notes(&mut strip), vec![sent(off(channel, 60), 17)]);
        assert!(
            seq.active.is_empty(),
            "the scheduled release must remove ownership"
        );
        assert!(seq.attacks.is_empty());
        for _ in 0..400 {
            routing_peak(&mut strip);
        }
        assert_eq!(
            routing_peak(&mut strip),
            0.0,
            "release tail must finish without panic"
        );
    }
}

#[test]
fn repeated_mapper_ids_in_shared_slot_balance_overlapping_same_key_attacks() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let mut raw = compile(
        STRINGS,
        0,
        &[performance_note(0.0, 4.0), performance_note(1.0, 1.0)],
    );
    raw.extend(compile(STRINGS, 1, &[performance_note(0.5, 2.5)]));
    seq.schedule = resolve_schedule(&raw);
    advance(&mut seq, &mut strip, 1.0);
    assert_eq!(rendered_notes(&mut strip), vec![sent(strings_on(1), 17); 3]);
    advance(&mut seq, &mut strip, 2.0);
    assert!(rendered_notes(&mut strip).is_empty());
    assert_eq!(seq.active.len(), 2);
    advance(&mut seq, &mut strip, 3.0);
    assert!(rendered_notes(&mut strip).is_empty());
    assert_eq!(seq.active.len(), 1);
    advance(&mut seq, &mut strip, 4.0);
    assert_eq!(rendered_notes(&mut strip), vec![sent(off(1, 60), 17); 3]);
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
}

#[test]
fn lua_layers_release_their_mapped_pitch_and_channel_not_the_last_voice() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    seq.schedule = resolve_schedule(&compile(
        r#"
        function note_on(time, note)
            midi.note({ id = note.id, startTime = time, endTime = time + 4,
                        pitch = note.pitch + 12, velocity = 100, channel = 3 })
            midi.note({ id = note.id, startTime = time + 1, endTime = time + 2,
                        pitch = note.pitch - 12, velocity = 100, channel = 7 })
        end
        "#,
        0,
        &[performance_note(0.0, 4.0)],
    ));
    for (time, expected) in [
        (0.0, on(3, 72)),
        (1.0, on(7, 48)),
        (2.0, off(7, 48)),
        (4.0, off(3, 72)),
    ] {
        advance(&mut seq, &mut strip, time);
        assert_eq!(rendered_notes(&mut strip), vec![sent(expected, 17)]);
    }
    assert!(seq.active.is_empty());
}

#[test]
fn seeking_repeated_mapper_notes_rebuilds_only_the_current_occurrence() {
    let raw = compile(
        STRINGS,
        0,
        &[performance_note(0.0, 1.0), performance_note(2.0, 1.0)],
    );
    let mut seq = sequence();
    let mut strip = routing_strip();
    seq.schedule = resolve_schedule(&raw);
    for time in [1.5, 2.5, 0.5, 3.5] {
        strip.panic();
        seek_slot(&mut seq, &mut strip, time, &HashSet::new());
        let notes = rendered_notes(&mut strip);
        if time == 1.5 || time == 3.5 {
            assert!(
                notes.is_empty(),
                "finished repeat occurrences must not reattack"
            );
            assert!(seq.active.is_empty());
        } else {
            assert_eq!(notes, vec![sent(strings_on(1), 0)]);
            assert_eq!(seq.active.len(), 1);
            advance(&mut seq, &mut strip, time + 0.5);
            assert_eq!(rendered_notes(&mut strip), vec![sent(off(1, 60), 17)]);
            assert!(seq.active.is_empty());
        }
    }
}
