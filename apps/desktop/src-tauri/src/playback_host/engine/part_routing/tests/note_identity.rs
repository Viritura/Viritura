use super::*;

fn raw(part: u32, at: f64, message: MidiMessage) -> PartScheduledMidi {
    PartScheduledMidi {
        part,
        midi: ScheduledMidi {
            at_seconds: at,
            message,
        },
    }
}

fn attack(part: u32, at: f64, id: &str, velocity: u8) -> PartScheduledMidi {
    raw(
        part,
        at,
        MidiMessage::NoteOn {
            note_id: id.to_owned(),
            channel: 0,
            note: 60,
            velocity,
        },
    )
}

fn release(part: u32, at: f64, id: &str) -> PartScheduledMidi {
    raw(
        part,
        at,
        MidiMessage::NoteOff {
            note_id: id.to_owned(),
        },
    )
}

fn controller(part: u32, at: f64, controller: u8, value: u8) -> PartScheduledMidi {
    raw(
        part,
        at,
        MidiMessage::ControlChange {
            channel: 0,
            controller,
            value,
        },
    )
}

fn strike(velocity: u8) -> ResolvedMidi {
    ResolvedMidi::NoteOn {
        channel: 0,
        note: 60,
        velocity,
    }
}

fn advance(seq: &mut SlotSeq, strip: &mut Strip, t: f64, muted: &HashSet<u32>) {
    while seq.cursor < seq.schedule.len() && seq.schedule[seq.cursor].at_seconds < t {
        dispatch_event(seq, strip, seq.schedule[seq.cursor], 0, muted);
        seq.cursor += 1;
    }
}

#[test]
fn seek_submits_the_long_overlap_not_the_finished_louder_note() {
    for muted in [HashSet::new(), HashSet::from([0])] {
        let mut seq = sequence();
        let mut strip = routing_strip();
        // Deliberately unsorted input: identity must survive schedule sorting.
        seq.schedule = resolve_schedule(&[
            release(0, 10.0, "a"),
            attack(0, 1.0, "b", 100),
            release(0, 2.0, "b"),
            attack(0, 0.0, "a", 30),
        ]);
        seek_slot(&mut seq, &mut strip, 3.0, &muted);
        let expected = if muted.is_empty() {
            vec![sent(strike(30), 0)]
        } else {
            Vec::new()
        };
        assert_eq!(take(&mut strip), expected);
        assert_eq!(seq.cursor, 3);
        assert_eq!(seq.active.len(), 1);
        assert_eq!(seq.active[0].velocity, 30);
        if !muted.is_empty() {
            reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
            assert_eq!(take(&mut strip), vec![sent(strike(30), 0)]);
        }
        advance(&mut seq, &mut strip, 11.0, &HashSet::new());
        assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
        assert!(seq.active.is_empty());
        assert!(seq.attacks.is_empty());
    }
}

#[test]
fn live_overlap_matches_exact_notes_with_part_local_ids_on_a_shared_key() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    let all_muted = HashSet::from([0, 1]);
    seq.schedule = resolve_schedule(&[
        attack(0, 0.0, "a", 30),
        attack(0, 1.0, "b", 100),
        release(0, 2.0, "b"),
        release(0, 10.0, "a"),
        attack(1, 0.5, "a", 70),
        release(1, 4.0, "a"),
    ]);
    advance(&mut seq, &mut strip, 3.0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![
            sent(strike(30), 0),
            sent(strike(70), 0),
            sent(strike(100), 0)
        ]
    );
    assert_eq!(
        seq.active
            .iter()
            .map(|n| (n.part, n.velocity))
            .collect::<Vec<_>>(),
        vec![(0, 30), (1, 70)]
    );
    reconcile_notes(&mut seq, &mut strip, &all_muted, true);
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0); 3]);
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([1]), true);
    assert_eq!(take(&mut strip), vec![sent(strike(30), 0)]);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    assert!(
        take(&mut strip).is_empty(),
        "shared ownership must not reattack"
    );
    advance(&mut seq, &mut strip, 5.0, &clear);
    assert!(
        take(&mut strip).is_empty(),
        "the other part still owns this key"
    );
    assert_eq!(seq.active.len(), 1);
    assert_eq!(seq.active[0].part, 0);
    assert_eq!(seq.active[0].velocity, 30);
    advance(&mut seq, &mut strip, 11.0, &clear);
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
}

#[test]
fn overlap_pedal_release_and_reset_preserve_the_exact_held_key_and_other_part() {
    for reset in [64, 121] {
        for seeking in [false, true] {
            let mut seq = sequence();
            let mut strip = routing_strip();
            let clear = HashSet::new();
            seq.schedule = resolve_schedule(&[
                controller(0, 0.0, 64, 127),
                attack(0, 0.0, "a", 30),
                attack(0, 1.0, "b", 100),
                release(0, 2.0, "b"),
                controller(0, 2.5, reset, 0),
                release(0, 10.0, "a"),
                controller(1, 0.0, 64, 127),
                attack(1, 0.5, "b", 70),
                release(1, 2.0, "b"),
                controller(1, 11.0, reset, 0),
            ]);
            if seeking {
                seek_slot(&mut seq, &mut strip, 3.0, &clear);
                let submitted = take(&mut strip);
                assert_eq!(submitted.first(), Some(&sent(pedal(0, 0), 0)));
                assert_eq!(submitted.last(), Some(&sent(strike(70), 0)));
                assert_eq!(
                    submitted
                        .iter()
                        .filter(|(midi, _)| matches!(
                            midi,
                            MidiEvent::NoteOn { .. } | MidiEvent::NoteOff { .. }
                        ))
                        .cloned()
                        .collect::<Vec<_>>(),
                    vec![sent(strike(70), 0)]
                );
            } else {
                advance(&mut seq, &mut strip, 3.0, &clear);
                take(&mut strip);
            }
            assert_eq!(
                seq.active
                    .iter()
                    .map(|n| (n.part, n.velocity, n.key_down))
                    .collect::<Vec<_>>(),
                vec![(0, 30, true), (1, 70, false)]
            );
            assert_eq!(seq.sustain, HashSet::from([(1, 0)]));
            reconcile_notes(&mut seq, &mut strip, &HashSet::from([0, 1]), true);
            let attacks = if seeking { 1 } else { 3 };
            assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0); attacks]);
            reconcile_notes(&mut seq, &mut strip, &HashSet::from([1]), true);
            assert_eq!(take(&mut strip), vec![sent(strike(30), 0)]);
            reconcile_notes(&mut seq, &mut strip, &clear, true);
            assert!(take(&mut strip).is_empty());
            advance(&mut seq, &mut strip, 10.5, &clear);
            assert!(take(&mut strip).is_empty());
            assert_eq!(seq.active.len(), 1);
            assert_eq!(seq.active[0].part, 1);
            advance(&mut seq, &mut strip, 12.0, &clear);
            let expected = if reset == 64 {
                vec![sent(pedal(0, 0), 0), sent(off(0, 60), 0)]
            } else {
                vec![sent(off(0, 60), 0)]
            };
            assert_eq!(take(&mut strip), expected);
            assert!(seq.active.is_empty());
            assert!(seq.attacks.is_empty());
        }
    }
}

#[test]
fn stale_release_after_channel_mode_reset_cannot_end_a_new_same_key_note() {
    for reset in [120, 123, 124, 125, 126, 127] {
        for seeking in [false, true] {
            let mut seq = sequence();
            let mut strip = routing_strip();
            let clear = HashSet::new();
            seq.schedule = resolve_schedule(&[
                attack(0, 0.0, "a", 30),
                controller(0, 0.5, reset, 0),
                attack(0, 1.0, "b", 100),
                release(0, 2.0, "a"),
                release(0, 10.0, "b"),
            ]);
            if seeking {
                seek_slot(&mut seq, &mut strip, 3.0, &clear);
                assert_eq!(take(&mut strip), vec![sent(strike(100), 0)]);
            } else {
                advance(&mut seq, &mut strip, 3.0, &clear);
                assert_eq!(
                    take(&mut strip),
                    vec![
                        sent(strike(30), 0),
                        sent(off(0, 60), 0),
                        sent(strike(100), 0)
                    ]
                );
            }
            assert_eq!(seq.active.len(), 1);
            assert_eq!(seq.active[0].velocity, 100);
            advance(&mut seq, &mut strip, 11.0, &clear);
            assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
            assert!(seq.active.is_empty());
        }
    }
}
