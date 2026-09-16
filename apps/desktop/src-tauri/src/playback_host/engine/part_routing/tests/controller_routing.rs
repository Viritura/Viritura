use super::*;

fn control(channel: u8, controller: u8, value: u8) -> ResolvedMidi {
    ResolvedMidi::ControlChange {
        channel,
        controller,
        value,
    }
}

fn note_messages(messages: &[(MidiEvent, i32)]) -> Vec<(MidiEvent, i32)> {
    messages
        .iter()
        .filter(|(midi, _)| matches!(midi, MidiEvent::NoteOn { .. } | MidiEvent::NoteOff { .. }))
        .cloned()
        .collect()
}

fn assert_no_channel_mode(messages: &[(MidiEvent, i32)]) {
    assert!(
        messages.iter().all(|(midi, _)| !matches!(
            midi,
            MidiEvent::ControlChange {
                controller: 120..=127,
                ..
            }
        )),
        "source-local mode changes must not reach the physical channel: {messages:?}"
    );
}

#[test]
fn excluded_zero_controls_never_reach_or_silence_the_shared_channel() {
    let clear = HashSet::new();
    let excluded = HashSet::from([1]);
    let mut seq = sequence();
    let mut strip = routing_strip();
    let mut reference_seq = sequence();
    let mut reference = routing_strip();
    for (state, output) in [(&mut seq, &mut strip), (&mut reference_seq, &mut reference)] {
        dispatch_event(state, output, event(0, 0.0, cc(0, 100)), 0, &clear);
        dispatch_event(state, output, event(0, 0.0, on(0, 60)), 0, &clear);
        assert_eq!(take(output), vec![sent(cc(0, 100), 0), sent(on(0, 60), 0)]);
    }
    for controller in [0, 1, 7, 10, 11] {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(1, 0.1, control(0, controller, 0)),
            19,
            &excluded,
        );
        assert!(
            take(&mut strip).is_empty(),
            "excluded CC{controller}=0 must remain private"
        );
    }
    let mut audible = false;
    for _ in 0..8 {
        let actual = routing_peak(&mut strip);
        let expected = routing_peak(&mut reference);
        audible |= expected > 1e-4;
        assert!(
            (actual - expected).abs() < 1e-6,
            "excluded controls changed eligible SF2 audio: {actual} vs {expected}"
        );
    }
    assert!(audible, "the eligible reference note must actually sound");
}

#[test]
fn clear_replays_latest_private_expression_before_held_notes_without_seeking() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let excluded = HashSet::from([1]);
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, cc(0, 90)), 0, &excluded);
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, on(0, 60)), 0, &excluded);
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 90), 0), sent(on(0, 60), 0)]
    );
    for midi in [cc(0, 0), on(0, 67), cc(0, 42)] {
        dispatch_event(&mut seq, &mut strip, event(1, 1.0, midi), 23, &excluded);
    }
    assert!(take(&mut strip).is_empty());
    seq.cursor = 17;
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert_eq!(seq.cursor, 17, "clearing must not restart the schedule");
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 42), 0), sent(on(0, 67), 0)],
        "shared-channel expression changes before the newly eligible attack"
    );
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert!(take(&mut strip).is_empty(), "replay must be idempotent");
}

#[test]
fn shared_expression_uses_last_eligible_write_for_live_reconcile_and_seek() {
    // Reverse part IDs too: source-map iteration order is not scheduling order.
    for (older, newer) in [(0, 1), (1, 0)] {
        for muted in [
            HashSet::new(),
            HashSet::from([older]),
            HashSet::from([newer]),
        ] {
            let mut seq = sequence();
            let mut strip = routing_strip();
            seq.schedule = vec![
                event(older, 0.0, cc(0, 31)),
                event(newer, 0.0, cc(0, 79)),
                event(older, 0.1, on(0, 60)),
                event(newer, 0.1, on(0, 67)),
            ];
            for scheduled in seq.schedule.clone() {
                dispatch_event(&mut seq, &mut strip, scheduled, 0, &muted);
            }
            let expected = if muted.contains(&newer) { 31 } else { 79 };
            let live = take(&mut strip);
            assert_eq!(
                live.iter().rev().find(|(midi, _)| matches!(
                    midi,
                    MidiEvent::ControlChange { controller: 11, .. }
                )),
                Some(&sent(cc(0, expected), 0))
            );
            strip.panic();
            seek_slot(&mut seq, &mut strip, 0.5, &muted);
            let seek = take(&mut strip);
            assert_eq!(seek.first(), Some(&sent(cc(0, expected), 0)));
            assert_eq!(
                note_messages(&seek),
                note_messages(&live),
                "seek must rebuild the same eligible attacks"
            );
            assert_eq!(
                seek.iter()
                    .filter(|(midi, _)| matches!(midi, MidiEvent::ControlChange { .. }))
                    .count(),
                1,
                "seek must not replay an older or excluded expression"
            );
            reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
            let clear = take(&mut strip);
            if muted.contains(&newer) {
                assert_eq!(clear.first(), Some(&sent(cc(0, 79), 0)));
            } else {
                assert!(
                    clear.iter().all(|(midi, _)| !matches!(
                        midi,
                        MidiEvent::ControlChange { controller: 11, .. }
                    )),
                    "unmuting an older writer cannot promote it over the newer writer"
                );
            }
            dispatch_event(
                &mut seq,
                &mut strip,
                event(older, 1.0, cc(0, 55)),
                13,
                &HashSet::new(),
            );
            assert_eq!(take(&mut strip), vec![sent(cc(0, 55), 13)]);
            reconcile_notes(&mut seq, &mut strip, &HashSet::from([older]), true);
            let removed = take(&mut strip);
            assert_eq!(removed.first(), Some(&sent(cc(0, 79), 0)));
            reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
            let restored = take(&mut strip);
            assert_eq!(restored.first(), Some(&sent(cc(0, 55), 0)));
        }
    }
}

#[test]
fn removing_the_only_eligible_expression_restores_default_not_excluded_intent() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let excluded = HashSet::from([1]);
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, cc(0, 45)), 0, &excluded);
    dispatch_event(&mut seq, &mut strip, event(1, 0.1, cc(0, 0)), 0, &excluded);
    assert_eq!(take(&mut strip), vec![sent(cc(0, 45), 0)]);
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([0, 1]), true);
    assert_eq!(take(&mut strip), vec![sent(cc(0, 127), 0)]);
    reconcile_notes(&mut seq, &mut strip, &excluded, true);
    assert_eq!(take(&mut strip), vec![sent(cc(0, 45), 0)]);
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 0), 0)],
        "once eligible, the latest shared-channel zero really does win"
    );
}

#[test]
fn seek_rebuilds_private_expression_without_leaking_stale_or_future_writes() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let excluded = HashSet::from([1]);
    seq.schedule = vec![
        event(0, 0.0, cc(0, 93)),
        event(1, 0.1, cc(0, 0)),
        event(0, 0.2, on(0, 60)),
        event(1, 0.2, on(0, 67)),
        event(1, 1.0, cc(0, 48)),
        event(1, 3.0, cc(0, 12)),
    ];
    seek_slot(&mut seq, &mut strip, 2.0, &excluded);
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 93), 0), sent(on(0, 60), 0)]
    );
    assert_eq!(seq.cursor, 5);
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 48), 0), sent(on(0, 67), 0)]
    );
    assert_eq!(seq.cursor, 5);
    strip.panic();
    seek_slot(&mut seq, &mut strip, 0.5, &excluded);
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 93), 0), sent(on(0, 60), 0)]
    );
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 0), 0), sent(on(0, 67), 0)],
        "backward seek must discard private writes after its destination"
    );
}

#[test]
fn reset_controllers_releases_sustained_sf2_note_and_audio_decays() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    for midi in [pedal(0, 127), on(0, 60), off(0, 60)] {
        dispatch_event(&mut seq, &mut strip, event(0, 0.0, midi), 0, &clear);
    }
    assert_eq!(
        take(&mut strip),
        vec![sent(pedal(0, 0), 0), sent(on(0, 60), 0)]
    );
    assert!((0..8).any(|_| routing_peak(&mut strip) > 1e-4));
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 1.0, control(0, 121, 0)),
        7,
        &clear,
    );
    let reset = take(&mut strip);
    assert_no_channel_mode(&reset);
    assert_eq!(note_messages(&reset), vec![sent(off(0, 60), 7)]);
    assert!(!seq.sustain.contains(&(0, 0)));
    assert!(seq.active.is_empty());
    for _ in 0..400 {
        routing_peak(&mut strip);
    }
    assert_eq!(
        routing_peak(&mut strip),
        0.0,
        "reset must release SF2 audio"
    );
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([0]), true);
    take(&mut strip);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    assert!(
        note_messages(&take(&mut strip)).is_empty(),
        "the ended sustain note cannot reappear on clear"
    );
}

#[test]
fn reset_preserves_held_keys_and_other_source_and_channel_sustain() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    for (part, channel, note) in [(0, 0, 60), (1, 0, 64), (0, 1, 67)] {
        for midi in [pedal(channel, 127), on(channel, note), off(channel, note)] {
            dispatch_event(&mut seq, &mut strip, event(part, 0.0, midi), 0, &clear);
        }
    }
    dispatch_event(&mut seq, &mut strip, event(0, 0.5, on(0, 72)), 0, &clear);
    let initial = take(&mut strip);
    assert_eq!(
        note_messages(&initial),
        vec![
            sent(on(0, 60), 0),
            sent(on(0, 64), 0),
            sent(on(1, 67), 0),
            sent(on(0, 72), 0),
        ]
    );
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 1.0, control(0, 121, 0)),
        11,
        &clear,
    );
    let reset = take(&mut strip);
    assert_no_channel_mode(&reset);
    assert_eq!(note_messages(&reset), vec![sent(off(0, 60), 11)]);
    assert_eq!(seq.sustain, HashSet::from([(1, 0), (0, 1)]));
    dispatch_event(&mut seq, &mut strip, event(0, 2.0, off(0, 72)), 0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![sent(off(0, 72), 0)],
        "reset keeps the physical key down but clears its source's sustain"
    );
    for (part, channel, note) in [(1, 0, 64), (0, 1, 67)] {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(part, 3.0, pedal(channel, 0)),
            0,
            &clear,
        );
        let release = take(&mut strip);
        assert_no_channel_mode(&release);
        assert_eq!(note_messages(&release), vec![sent(off(channel, note), 0)]);
    }
    assert!(seq.active.is_empty());
}

#[test]
fn reset_reconciles_resettable_controls_but_preserves_volume_and_pan() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    for (controller, value) in [(7, 83), (10, 29), (11, 18), (1, 65), (66, 127), (101, 0)] {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(0, 0.0, control(0, controller, value)),
            0,
            &clear,
        );
    }
    take(&mut strip);
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 1.0, control(0, 121, 0)),
        0,
        &clear,
    );
    let reset = take(&mut strip);
    assert_no_channel_mode(&reset);
    for (controller, value) in [(11, 127), (1, 0), (66, 0), (101, 127)] {
        assert!(
            reset.contains(&sent(control(0, controller, value), 0)),
            "reset must restore CC{controller}={value}"
        );
    }
    assert!(reset.iter().all(|(midi, _)| !matches!(
        midi,
        MidiEvent::ControlChange {
            controller: 7 | 10,
            ..
        }
    )));
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([0]), true);
    take(&mut strip);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    let restored = take(&mut strip);
    assert!(restored.contains(&sent(control(0, 7, 83), 0)));
    assert!(restored.contains(&sent(control(0, 10, 29), 0)));
    assert!(!restored.contains(&sent(cc(0, 18), 0)));
}

#[test]
fn excluded_reset_is_private_and_cannot_resurrect_ended_notes_after_clear_or_seek() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let excluded = HashSet::from([1]);
    seq.schedule = vec![
        event(0, 0.0, cc(0, 88)),
        event(0, 0.0, on(0, 60)),
        event(1, 0.1, pedal(0, 127)),
        event(1, 0.1, cc(0, 0)),
        event(1, 0.2, on(0, 60)),
        event(1, 0.3, off(0, 60)),
        event(1, 0.4, control(0, 121, 0)),
    ];
    for scheduled in seq.schedule.clone() {
        dispatch_event(&mut seq, &mut strip, scheduled, 0, &excluded);
        let submitted = take(&mut strip);
        assert_no_channel_mode(&submitted);
        if scheduled.part == 1 && scheduled.at_seconds >= 0.2 {
            assert!(
                submitted.is_empty(),
                "excluded note lifetime and reset must remain private"
            );
        }
    }
    for seek in [false, true] {
        if seek {
            strip.panic();
            seek_slot(&mut seq, &mut strip, 0.5, &excluded);
            let replay = take(&mut strip);
            assert_no_channel_mode(&replay);
            assert_eq!(note_messages(&replay), vec![sent(on(0, 60), 0)]);
            assert!(replay.contains(&sent(cc(0, 88), 0)));
            assert!(!replay.contains(&sent(cc(0, 0), 0)));
        }
        reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
        let clear = take(&mut strip);
        assert_no_channel_mode(&clear);
        assert!(note_messages(&clear).is_empty());
        assert!(clear.contains(&sent(cc(0, 127), 0)));
        dispatch_event(
            &mut seq,
            &mut strip,
            event(0, 1.0, off(0, 60)),
            0,
            &HashSet::new(),
        );
        assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
        assert!(seq.active.is_empty());
    }
}

#[test]
fn channel_modes_balance_shared_attacks_only_after_the_final_sustained_owner() {
    for controller in [120, 123, 124, 125, 126, 127] {
        let mut seq = sequence();
        let mut strip = routing_strip();
        let clear = HashSet::new();
        for part in [0, 1] {
            dispatch_event(
                &mut seq,
                &mut strip,
                event(part, 0.0, pedal(0, 127)),
                0,
                &clear,
            );
            dispatch_event(&mut seq, &mut strip, event(part, 0.0, on(0, 60)), 0, &clear);
        }
        assert_eq!(
            note_messages(&take(&mut strip)),
            vec![sent(on(0, 60), 0), sent(on(0, 60), 0)]
        );
        dispatch_event(
            &mut seq,
            &mut strip,
            event(0, 1.0, control(0, controller, 0)),
            0,
            &clear,
        );
        assert!(
            take(&mut strip).is_empty(),
            "CC{controller} must not cut another owner's shared key"
        );
        assert!(
            seq.sustain.contains(&(0, 0)),
            "CC{controller} retains pedal"
        );
        if controller == 120 {
            assert!(seq.active.iter().all(|note| note.part != 0));
        } else {
            assert!(seq
                .active
                .iter()
                .any(|note| note.part == 0 && !note.key_down));
        }
        dispatch_event(&mut seq, &mut strip, event(1, 2.0, off(0, 60)), 0, &clear);
        assert!(take(&mut strip).is_empty());
        dispatch_event(&mut seq, &mut strip, event(1, 3.0, pedal(0, 0)), 0, &clear);
        let other_release = take(&mut strip);
        assert_no_channel_mode(&other_release);
        let balanced = vec![sent(off(0, 60), 0), sent(off(0, 60), 0)];
        assert_eq!(
            note_messages(&other_release),
            if controller == 120 {
                balanced.clone()
            } else {
                vec![]
            },
            "CC120 discards sustained ownership; CC123..127 retain it"
        );
        dispatch_event(&mut seq, &mut strip, event(0, 4.0, pedal(0, 0)), 0, &clear);
        let final_release = take(&mut strip);
        assert_no_channel_mode(&final_release);
        assert_eq!(
            note_messages(&final_release),
            if controller == 120 { vec![] } else { balanced }
        );
        assert!(seq.active.is_empty());
        assert!(seq.attacks.is_empty());
        dispatch_event(&mut seq, &mut strip, event(0, 5.0, off(0, 60)), 0, &clear);
        reconcile_notes(&mut seq, &mut strip, &HashSet::from([0, 1]), true);
        reconcile_notes(&mut seq, &mut strip, &clear, true);
        assert!(
            take(&mut strip).is_empty(),
            "CC{controller} must not resurrect"
        );
    }
}

#[test]
fn all_sound_off_discards_pedal_held_notes_but_pedal_still_holds_future_notes() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    for midi in [pedal(0, 127), on(0, 60), off(0, 60)] {
        dispatch_event(&mut seq, &mut strip, event(0, 0.0, midi), 0, &clear);
    }
    take(&mut strip);
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 1.0, control(0, 120, 0)),
        5,
        &clear,
    );
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 5)]);
    for midi in [on(0, 67), off(0, 67)] {
        dispatch_event(&mut seq, &mut strip, event(0, 2.0, midi), 0, &clear);
    }
    assert_eq!(take(&mut strip), vec![sent(on(0, 67), 0)]);
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([0]), true);
    assert_eq!(take(&mut strip), vec![sent(off(0, 67), 0)]);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    assert_eq!(
        take(&mut strip),
        vec![sent(on(0, 67), 0)],
        "only the new pedal-held note may return"
    );
    dispatch_event(&mut seq, &mut strip, event(0, 3.0, pedal(0, 0)), 0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![sent(pedal(0, 0), 0), sent(off(0, 67), 0)]
    );
    assert!(seq.active.is_empty());
}

#[test]
fn resetting_shared_sustain_balances_all_attacks_only_when_last_owner_ends() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    for part in [0, 1] {
        for midi in [pedal(0, 127), on(0, 60), off(0, 60)] {
            dispatch_event(&mut seq, &mut strip, event(part, 0.0, midi), 0, &clear);
        }
    }
    assert_eq!(
        note_messages(&take(&mut strip)),
        vec![sent(on(0, 60), 0), sent(on(0, 60), 0)]
    );
    for part in [0, 1] {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(part, 1.0, control(0, 121, 0)),
            9,
            &clear,
        );
        let reset = take(&mut strip);
        assert_no_channel_mode(&reset);
        assert_eq!(
            note_messages(&reset),
            if part == 0 {
                vec![]
            } else {
                vec![sent(off(0, 60), 9), sent(off(0, 60), 9)]
            },
            "reset may release stacked physical attacks only for the final owner"
        );
    }
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([0, 1]), true);
    take(&mut strip);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    assert!(note_messages(&take(&mut strip)).is_empty());
}

#[test]
fn excluded_channel_modes_end_private_notes_without_cutting_an_eligible_shared_key() {
    for controller in [120, 123, 124, 125, 126, 127] {
        for sustained in [false, true] {
            let mut seq = sequence();
            let mut strip = routing_strip();
            let excluded = HashSet::from([1]);
            dispatch_event(&mut seq, &mut strip, event(0, 0.0, on(0, 60)), 0, &excluded);
            assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
            if sustained {
                dispatch_event(
                    &mut seq,
                    &mut strip,
                    event(1, 0.0, pedal(0, 127)),
                    0,
                    &excluded,
                );
                take(&mut strip);
            }
            dispatch_event(&mut seq, &mut strip, event(1, 0.1, on(0, 60)), 0, &excluded);
            dispatch_event(
                &mut seq,
                &mut strip,
                event(1, 0.2, control(0, controller, 0)),
                0,
                &excluded,
            );
            assert!(take(&mut strip).is_empty(), "excluded CC{controller}");
            if sustained {
                dispatch_event(
                    &mut seq,
                    &mut strip,
                    event(1, 0.3, pedal(0, 0)),
                    0,
                    &excluded,
                );
                let release = take(&mut strip);
                assert_no_channel_mode(&release);
                assert!(note_messages(&release).is_empty());
            }
            reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
            assert!(take(&mut strip).is_empty());
            dispatch_event(
                &mut seq,
                &mut strip,
                event(0, 1.0, off(0, 60)),
                0,
                &HashSet::new(),
            );
            assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
            assert!(seq.active.is_empty(), "ended CC{controller} ownership");
        }
    }
}
