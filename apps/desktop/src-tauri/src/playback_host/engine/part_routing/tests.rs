use super::*;
use crate::mapper::{MidiMessage, ScheduledMidi};
use crate::playback_host::mixer::tests::{routing_midi, routing_peak, routing_strip};
use crate::playback_host::schedule::{resolve_schedule, PartScheduledMidi};

mod controller_routing;
mod mapper_lifetimes;
mod note_identity;
mod sf2_lifetimes;

fn sequence() -> SlotSeq {
    SlotSeq {
        identity: "shared".to_owned(),
        schedule: Vec::new(),
        cursor: 0,
        active: Vec::new(),
        sustain: HashSet::new(),
        attacks: Default::default(),
        controllers: Default::default(),
    }
}

fn event(part: u32, at: f64, midi: ResolvedMidi) -> ResolvedEvent {
    ResolvedEvent {
        at_seconds: at,
        part,
        midi,
        note_id: match midi {
            ResolvedMidi::NoteOn { channel, note, .. }
            | ResolvedMidi::NoteOff { channel, note } => Some(ResolvedNoteId(
                usize::from(channel) * 128 + usize::from(note),
            )),
            ResolvedMidi::ControlChange { .. } => None,
        },
        note_off_at: None,
    }
}

fn on(channel: u8, note: u8) -> ResolvedMidi {
    ResolvedMidi::NoteOn {
        channel,
        note,
        velocity: 100,
    }
}

fn off(channel: u8, note: u8) -> ResolvedMidi {
    ResolvedMidi::NoteOff { channel, note }
}

fn cc(channel: u8, value: u8) -> ResolvedMidi {
    ResolvedMidi::ControlChange {
        channel,
        controller: 11,
        value,
    }
}

fn take(strip: &mut Strip) -> Vec<(MidiEvent, i32)> {
    routing_midi(strip)
}

fn sent(midi: ResolvedMidi, offset: i32) -> (MidiEvent, i32) {
    (to_midi_event(midi).unwrap(), offset)
}

#[test]
fn shared_multitimbral_slot_routes_per_part_and_restores_held_notes_live() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let raw_mixer = HashSet::from([2]);
    let excluded = HashSet::from([1, 2]);
    for part in 0..3 {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(part, 0.0, on(part as u8, 60)),
            17,
            &raw_mixer,
        );
    }
    assert_eq!(
        take(&mut strip),
        vec![sent(on(0, 60), 17), sent(on(1, 60), 17)]
    );

    reconcile_notes(&mut seq, &mut strip, &excluded, true);
    assert_eq!(take(&mut strip), vec![sent(off(1, 60), 0)]);
    // Excluded parts' expression advances privately until they become eligible.
    dispatch_event(
        &mut seq,
        &mut strip,
        event(1, 0.5, cc(1, 42)),
        23,
        &excluded,
    );
    assert!(take(&mut strip).is_empty());

    seq.cursor = 7;
    reconcile_notes(&mut seq, &mut strip, &raw_mixer, true);
    assert_eq!(
        seq.cursor, 7,
        "clearing exclusion must not seek the schedule"
    );
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(1, 42), 0), sent(on(1, 60), 0)]
    );
    reconcile_notes(&mut seq, &mut strip, &raw_mixer, true);
    assert!(
        take(&mut strip).is_empty(),
        "identical sets must not reattack"
    );
    for part in 0..3 {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(part, 1.0, off(part as u8, 60)),
            29,
            &raw_mixer,
        );
    }
    assert_eq!(
        take(&mut strip),
        vec![sent(off(0, 60), 29), sent(off(1, 60), 29)]
    );
    assert!(seq.active.is_empty());
    routing_peak(&mut strip); // Also verifies mixer controls remained independent.
}

#[test]
fn excluded_note_off_does_not_release_an_allowed_same_key_note() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let muted = HashSet::from([1]);
    for part in [0, 1] {
        dispatch_event(&mut seq, &mut strip, event(part, 0.0, on(0, 60)), 0, &muted);
    }
    assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
    dispatch_event(&mut seq, &mut strip, event(1, 1.0, off(0, 60)), 0, &muted);
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert!(
        take(&mut strip).is_empty(),
        "finished excluded notes must not reattack or cut the other part"
    );
    dispatch_event(&mut seq, &mut strip, event(0, 2.0, off(0, 60)), 0, &muted);
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
}

#[test]
fn notes_started_and_finished_while_excluded_stay_silent_after_clear() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let muted = HashSet::from([0]);
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, on(0, 60)), 0, &muted);
    dispatch_event(&mut seq, &mut strip, event(0, 1.0, off(0, 60)), 0, &muted);
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert!(take(&mut strip).is_empty());
    assert_eq!(routing_peak(&mut strip), 0.0);
}

#[test]
fn stopped_clear_does_not_reattack_and_next_start_rebuilds_excluded_state() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    seq.schedule = vec![
        event(0, 0.0, cc(0, 42)),
        ResolvedEvent {
            note_off_at: Some(4.0),
            ..event(0, 1.0, on(0, 60))
        },
        event(0, 4.0, off(0, 60)),
    ];
    seek_slot(&mut seq, &mut strip, 2.0, &HashSet::from([0]));
    assert!(take(&mut strip).is_empty());
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), false);
    assert!(take(&mut strip).is_empty());
    seek_slot(&mut seq, &mut strip, 2.0, &HashSet::new());
    assert_eq!(
        take(&mut strip),
        vec![sent(cc(0, 42), 0), sent(on(0, 60), 0)]
    );
    assert_eq!(seq.cursor, 2);
}

#[test]
fn sf2_exclusion_and_clear_restore_audio_with_latest_expression_without_seek() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let excluded = HashSet::from([0]);
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, cc(0, 0)), 0, &excluded);
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, on(0, 60)), 0, &excluded);
    assert_eq!(routing_peak(&mut strip), 0.0);
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 1.0, cc(0, 127)),
        0,
        &excluded,
    );
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert!(
        (0..8).any(|_| routing_peak(&mut strip) > 1e-4),
        "clearing must audibly restore the held SF2 note with current CC11"
    );
    reconcile_notes(&mut seq, &mut strip, &excluded, true);
    for _ in 0..400 {
        routing_peak(&mut strip);
    }
    assert_eq!(
        routing_peak(&mut strip),
        0.0,
        "live exclusion releases the sounding SF2 note"
    );
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert!((0..8).any(|_| routing_peak(&mut strip) > 1e-4));
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 2.0, off(0, 60)),
        0,
        &HashSet::new(),
    );
    for _ in 0..400 {
        routing_peak(&mut strip);
    }
    assert_eq!(
        routing_peak(&mut strip),
        0.0,
        "restored notes still receive their scheduled note-off"
    );
}

#[test]
fn shared_slot_resolution_scopes_mapper_note_ids_to_the_source_part() {
    let mut raw = Vec::new();
    for part in 0..2 {
        raw.push(PartScheduledMidi {
            part,
            midi: ScheduledMidi {
                at_seconds: 0.0,
                message: MidiMessage::NoteOn {
                    note_id: "mapper-local-id".to_owned(),
                    channel: part as u8,
                    note: 60 + part as u8,
                    velocity: 100,
                },
            },
        });
        raw.push(PartScheduledMidi {
            part,
            midi: ScheduledMidi {
                at_seconds: 1.0 + f64::from(part),
                message: MidiMessage::NoteOff {
                    note_id: "mapper-local-id".to_owned(),
                },
            },
        });
    }
    let mut seq = sequence();
    seq.schedule = resolve_schedule(&raw);
    assert_eq!(seq.schedule[0].note_off_at, Some(1.0));
    assert_eq!(seq.schedule[1].note_off_at, Some(2.0));
    assert!(seq.schedule[0].note_id.is_some());
    assert!(seq.schedule[1].note_id.is_some());
    assert_ne!(seq.schedule[0].note_id, seq.schedule[1].note_id);
    assert_eq!(seq.schedule[0].note_id, seq.schedule[2].note_id);
    assert_eq!(seq.schedule[1].note_id, seq.schedule[3].note_id);
    let mut strip = routing_strip();
    for event in seq.schedule.clone() {
        dispatch_event(&mut seq, &mut strip, event, 0, &HashSet::new());
    }
    assert_eq!(
        take(&mut strip),
        vec![
            sent(on(0, 60), 0),
            sent(on(1, 61), 0),
            sent(off(0, 60), 0),
            sent(off(1, 61), 0),
        ]
    );
    assert!(seq.active.is_empty());
}

#[test]
fn lookahead_mute_and_clear_keep_vst_submission_in_sample_order() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    let muted = HashSet::from([0]);
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, on(0, 60)), 117, &clear);
    reconcile_notes(&mut seq, &mut strip, &muted, true);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    dispatch_event(&mut seq, &mut strip, event(0, 1.0, off(0, 60)), 37, &clear);
    // No intervening render: offsets from different host ticks must not put a
    // release before its attack when the VST processes its sample-ordered queue.
    let mut submitted = take(&mut strip);
    submitted.sort_by_key(|(_, offset)| *offset);
    assert_eq!(
        submitted,
        vec![
            sent(on(0, 60), 117),
            sent(off(0, 60), 117),
            sent(on(0, 60), 117),
            sent(off(0, 60), 117),
        ]
    );
    assert!(seq.active.is_empty());

    dispatch_event(&mut seq, &mut strip, event(0, 2.0, on(0, 60)), 117, &clear);
    reconcile_notes(&mut seq, &mut strip, &muted, true);
    assert_eq!(
        take(&mut strip),
        vec![sent(on(0, 60), 117), sent(off(0, 60), 117)]
    );
    dispatch_event(&mut seq, &mut strip, event(0, 3.0, off(0, 60)), 0, &muted);
    assert!(
        take(&mut strip).is_empty(),
        "no stuck attack remains after exclusion"
    );
}

#[test]
fn shared_key_remains_audible_until_its_last_allowed_owner_releases() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let muted = HashSet::from([1]);
    for part in [0, 1] {
        dispatch_event(&mut seq, &mut strip, event(part, 0.0, on(0, 60)), 0, &muted);
    }
    assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    reconcile_notes(&mut seq, &mut strip, &muted, true);
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([0]), true);
    assert!(
        take(&mut strip).is_empty(),
        "ownership swaps must not reattack or silence a shared key"
    );
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 1.0, off(0, 60)),
        0,
        &HashSet::from([0]),
    );
    assert!(take(&mut strip).is_empty());
    dispatch_event(
        &mut seq,
        &mut strip,
        event(1, 2.0, off(0, 60)),
        0,
        &HashSet::from([0]),
    );
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
}

fn pedal(channel: u8, value: u8) -> ResolvedMidi {
    ResolvedMidi::ControlChange {
        channel,
        controller: 64,
        value,
    }
}

#[test]
fn pedal_held_sf2_note_is_excluded_and_restored_after_key_up_until_pedal_up() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    let muted = HashSet::from([0]);
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 0.0, pedal(0, 127)),
        0,
        &clear,
    );
    dispatch_event(&mut seq, &mut strip, event(0, 0.0, on(0, 60)), 0, &clear);
    dispatch_event(&mut seq, &mut strip, event(0, 1.0, off(0, 60)), 0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![sent(pedal(0, 0), 0), sent(on(0, 60), 0)]
    );
    assert!((0..8).any(|_| routing_peak(&mut strip) > 1e-4));
    reconcile_notes(&mut seq, &mut strip, &muted, true);
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
    for _ in 0..400 {
        routing_peak(&mut strip);
    }
    assert_eq!(routing_peak(&mut strip), 0.0);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
    assert!((0..8).any(|_| routing_peak(&mut strip) > 1e-4));
    dispatch_event(&mut seq, &mut strip, event(0, 2.0, pedal(0, 0)), 0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![sent(pedal(0, 0), 0), sent(off(0, 60), 0)]
    );
    assert!(seq.active.is_empty());
    reconcile_notes(&mut seq, &mut strip, &muted, true);
    reconcile_notes(&mut seq, &mut strip, &clear, true);
    assert!(take(&mut strip).is_empty());
}

#[test]
fn seek_rebuilds_per_part_pedal_state_even_when_excluded() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    seq.schedule = vec![
        event(0, 0.0, pedal(0, 127)),
        ResolvedEvent {
            note_off_at: Some(1.0),
            ..event(0, 0.0, on(0, 60))
        },
        event(0, 1.0, off(0, 60)),
        event(0, 3.0, pedal(0, 0)),
    ];
    seek_slot(&mut seq, &mut strip, 2.0, &HashSet::from([0]));
    assert_eq!(take(&mut strip), vec![sent(pedal(0, 0), 0)]);
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
    assert_eq!(seq.cursor, 3);
    strip.panic();
    seek_slot(&mut seq, &mut strip, 4.0, &HashSet::new());
    assert_eq!(take(&mut strip), vec![sent(pedal(0, 0), 0)]);
    assert!(seq.active.is_empty());
}

#[test]
fn one_parts_pedal_up_does_not_release_another_parts_sustain_on_the_same_channel() {
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
        dispatch_event(
            &mut seq,
            &mut strip,
            event(part, 1.0, off(0, 60)),
            0,
            &clear,
        );
    }
    take(&mut strip);
    dispatch_event(&mut seq, &mut strip, event(0, 2.0, pedal(0, 0)), 0, &clear);
    assert_eq!(take(&mut strip), vec![sent(pedal(0, 0), 0)]);
    dispatch_event(&mut seq, &mut strip, event(1, 3.0, pedal(0, 0)), 0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![
            sent(pedal(0, 0), 0),
            sent(off(0, 60), 0),
            sent(off(0, 60), 0)
        ]
    );
}

#[test]
fn transport_panic_discards_queued_attacks_and_stopped_clear_leaves_preview_alone() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 0.0, on(0, 60)),
        117,
        &HashSet::new(),
    );
    strip.panic();
    seq.clear_notes();
    assert!(
        take(&mut strip).is_empty(),
        "stop must discard an unrendered attack"
    );
    strip.send_midi(to_midi_event(on(0, 60)).unwrap());
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), false);
    assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
}

#[test]
fn scheduled_repetitions_still_articulate_while_the_pedal_holds_the_previous_strike() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    let clear = HashSet::new();
    dispatch_event(
        &mut seq,
        &mut strip,
        event(0, 0.0, pedal(0, 127)),
        0,
        &clear,
    );
    for at in [0.0, 1.0] {
        dispatch_event(&mut seq, &mut strip, event(0, at, on(0, 60)), 0, &clear);
        dispatch_event(
            &mut seq,
            &mut strip,
            event(0, at + 0.5, off(0, 60)),
            0,
            &clear,
        );
    }
    dispatch_event(&mut seq, &mut strip, event(0, 2.0, pedal(0, 0)), 0, &clear);
    assert_eq!(
        take(&mut strip),
        vec![
            sent(pedal(0, 0), 0),
            sent(on(0, 60), 0),
            sent(on(0, 60), 0),
            sent(pedal(0, 0), 0),
            sent(off(0, 60), 0),
            sent(off(0, 60), 0),
        ]
    );
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
}

#[test]
fn live_exclusion_balances_stacked_attacks_and_clear_reattacks_only_once() {
    let mut seq = sequence();
    let mut strip = routing_strip();
    for _ in 0..2 {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(0, 0.0, on(0, 60)),
            0,
            &HashSet::new(),
        );
    }
    assert_eq!(
        take(&mut strip),
        vec![sent(on(0, 60), 0), sent(on(0, 60), 0)]
    );
    reconcile_notes(&mut seq, &mut strip, &HashSet::from([0]), true);
    assert_eq!(
        take(&mut strip),
        vec![sent(off(0, 60), 0), sent(off(0, 60), 0)]
    );
    assert!(seq.attacks.is_empty());
    reconcile_notes(&mut seq, &mut strip, &HashSet::new(), true);
    assert_eq!(take(&mut strip), vec![sent(on(0, 60), 0)]);
    for _ in 0..2 {
        dispatch_event(
            &mut seq,
            &mut strip,
            event(0, 1.0, off(0, 60)),
            0,
            &HashSet::new(),
        );
    }
    assert_eq!(take(&mut strip), vec![sent(off(0, 60), 0)]);
    assert!(seq.attacks.is_empty());
}
