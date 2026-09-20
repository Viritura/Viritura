use super::*;
use crate::playback_host::mixer::tests::{audition_core, routing_midi, routing_peak};

const KEY: &str = "sf2:derived-chords";

fn request(notes: &[u8]) -> PreviewRequest<'_> {
    PreviewRequest {
        slot_key: KEY,
        part_index: 2,
        notes,
        velocity: 90,
        duration_ms: 500,
        replace: true,
    }
}

fn midi(core: &mut MixerCore, key: &str) -> Vec<(bool, u8)> {
    routing_midi(core.strip_mut(key).unwrap())
        .into_iter()
        .map(|(event, _)| match event {
            MidiEvent::NoteOn { note, .. } => (true, note),
            MidiEvent::NoteOff { note, .. } => (false, note),
            _ => panic!("audition must not emit channel-wide controllers"),
        })
        .collect()
}

#[test]
fn chord_replacement_releases_every_old_note_before_reattack_and_replaces_deadlines() {
    let mut core = audition_core(&[KEY]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    previews
        .preview(&mut core, false, request(&[60, 64, 67]), now)
        .unwrap();
    previews
        .preview(
            &mut core,
            false,
            request(&[60, 65, 69]),
            now + Duration::from_millis(200),
        )
        .unwrap();
    assert_eq!(
        midi(&mut core, KEY),
        vec![
            (true, 60),
            (true, 64),
            (true, 67),
            (false, 60),
            (false, 64),
            (false, 67),
            (true, 60),
            (true, 65),
            (true, 69),
        ]
    );
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert!(
        midi(&mut core, KEY).is_empty(),
        "old timer must not cut the new chord"
    );
    previews.release_due(&mut core, now + Duration::from_millis(700));
    assert_eq!(
        midi(&mut core, KEY),
        vec![(false, 60), (false, 65), (false, 69)]
    );
    assert!(previews.slots.is_empty());
}

#[test]
fn legacy_single_notes_remain_polyphonic_but_repeated_keys_get_fresh_deadlines() {
    let mut core = audition_core(&[KEY]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    for (note, delay) in [(60, 0), (64, 0), (60, 200)] {
        let notes = [note];
        let mut single = request(&notes);
        single.replace = false;
        previews
            .preview(&mut core, false, single, now + Duration::from_millis(delay))
            .unwrap();
    }
    assert_eq!(
        midi(&mut core, KEY),
        vec![(true, 60), (true, 64), (false, 60), (true, 60),]
    );
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert_eq!(midi(&mut core, KEY), vec![(false, 64)]);
    previews.release_due(&mut core, now + Duration::from_millis(700));
    assert_eq!(midi(&mut core, KEY), vec![(false, 60)]);
}

#[test]
fn cancellation_balances_attacks_and_cannot_release_a_new_mode_or_slot_lifetime() {
    let mut core = audition_core(&[KEY]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    previews
        .preview(&mut core, false, request(&[60, 64, 67]), now)
        .unwrap();
    let peak = (0..8)
        .map(|_| routing_peak(core.strip_mut(KEY).unwrap()))
        .fold(0.0f32, f32::max);
    assert!(peak > 1e-4, "the SF2 chord must sound before cancellation");
    previews.cancel(&mut core);
    assert_eq!(
        midi(&mut core, KEY),
        vec![
            (true, 60),
            (true, 64),
            (true, 67),
            (false, 60),
            (false, 64),
            (false, 67),
        ]
    );
    previews.cancel(&mut core);
    assert!(midi(&mut core, KEY).is_empty());
    previews
        .preview(
            &mut core,
            false,
            request(&[60, 64, 67]),
            now + Duration::from_millis(200),
        )
        .unwrap();
    midi(&mut core, KEY);
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert!(midi(&mut core, KEY).is_empty());
    previews.cancel(&mut core);
    midi(&mut core, KEY);
    assert!(previews.slots.is_empty());
    let strip = core.strip_mut(KEY).unwrap();
    for _ in 0..200 {
        routing_peak(strip);
    }
    assert!(
        routing_peak(strip) < 1e-6,
        "cancelled SF2 chord must become silent"
    );
}

#[test]
fn replacing_one_slot_does_not_cancel_other_slots() {
    let other = "sf2:other";
    let mut core = audition_core(&[KEY, other]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    let mut other_request = request(&[72]);
    other_request.slot_key = other;
    previews
        .preview(&mut core, false, other_request, now)
        .unwrap();
    previews
        .preview(&mut core, false, request(&[60]), now)
        .unwrap();
    previews
        .preview(&mut core, false, request(&[64]), now)
        .unwrap();
    assert_eq!(midi(&mut core, other), vec![(true, 72)]);
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert_eq!(midi(&mut core, other), vec![(false, 72)]);
}

#[test]
fn duplicate_pitches_have_only_one_attack_and_release() {
    let mut core = audition_core(&[KEY]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    previews
        .preview(&mut core, false, request(&[60, 60, 67]), now)
        .unwrap();
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert_eq!(
        midi(&mut core, KEY),
        vec![(true, 60), (true, 67), (false, 60), (false, 67),]
    );
}

#[test]
fn muting_derived_chord_owner_cancels_its_preview_without_a_schedule() {
    let other = "sf2:other";
    let mut core = audition_core(&[KEY, other]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    previews
        .preview(&mut core, false, request(&[36, 60, 64, 67]), now)
        .unwrap();
    let mut other_request = request(&[72]);
    other_request.slot_key = other;
    other_request.part_index = 0;
    previews
        .preview(&mut core, false, other_request, now)
        .unwrap();
    midi(&mut core, KEY);
    midi(&mut core, other);
    previews.cancel_muted(&mut core, &HashSet::from([1]));
    assert!(midi(&mut core, KEY).is_empty());
    assert!(midi(&mut core, other).is_empty());
    assert!(
        routing_peak(core.strip_mut(KEY).unwrap()) > 1e-4,
        "muting an authored part must not cut the derived SF2 chord"
    );
    previews.cancel_muted(&mut core, &HashSet::from([2]));
    assert_eq!(
        midi(&mut core, KEY),
        vec![(false, 36), (false, 60), (false, 64), (false, 67)]
    );
    assert!(midi(&mut core, other).is_empty());
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert!(midi(&mut core, KEY).is_empty());
    assert_eq!(midi(&mut core, other), vec![(false, 72)]);
}

#[test]
fn shared_slot_mute_or_solo_filter_releases_only_the_excluded_preview_owner() {
    let shared = "vst:shared";
    let mut core = audition_core(&[shared]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    for (part_index, notes) in [(0, [60]), (1, [64])] {
        previews
            .preview(
                &mut core,
                false,
                PreviewRequest {
                    slot_key: shared,
                    part_index,
                    replace: false,
                    ..request(&notes)
                },
                now,
            )
            .unwrap();
    }
    assert_eq!(midi(&mut core, shared), vec![(true, 60), (true, 64)]);
    previews.cancel_muted(&mut core, &HashSet::new());
    assert!(midi(&mut core, shared).is_empty());

    // Muting B and soloing A both exclude only part 1.
    for _ in 0..2 {
        previews.cancel_muted(&mut core, &HashSet::from([1]));
    }
    assert_eq!(midi(&mut core, shared), vec![(false, 64)]);
    assert_eq!(previews.slots[shared].len(), 1);
    assert_eq!(previews.slots[shared][&60].part_index, 0);

    previews.cancel_muted(&mut core, &HashSet::new());
    assert!(
        midi(&mut core, shared).is_empty(),
        "unmute must not reattack"
    );
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert_eq!(midi(&mut core, shared), vec![(false, 60)]);
    previews.cancel(&mut core);
    assert!(midi(&mut core, shared).is_empty());
    assert!(previews.slots.is_empty());
}

#[test]
fn same_key_retrigger_transfers_owner_and_deadline_with_balanced_midi() {
    for (old_owner, new_owner) in [(0, 1), (1, 0)] {
        let mut core = audition_core(&[KEY]);
        let mut previews = PreviewNotes::default();
        let now = Instant::now();
        for (part_index, delay) in [(old_owner, 0), (new_owner, 200)] {
            previews
                .preview(
                    &mut core,
                    false,
                    PreviewRequest {
                        part_index,
                        replace: false,
                        ..request(&[60])
                    },
                    now + Duration::from_millis(delay),
                )
                .unwrap();
        }
        assert_eq!(
            midi(&mut core, KEY),
            vec![(true, 60), (false, 60), (true, 60)]
        );
        assert_eq!(previews.slots[KEY][&60].part_index, new_owner);
        previews.cancel_muted(&mut core, &HashSet::from([old_owner]));
        previews.release_due(&mut core, now + Duration::from_millis(500));
        assert!(midi(&mut core, KEY).is_empty());
        previews.cancel_muted(&mut core, &HashSet::from([new_owner]));
        assert_eq!(midi(&mut core, KEY), vec![(false, 60)]);
        previews.release_due(&mut core, now + Duration::from_millis(700));
        assert!(midi(&mut core, KEY).is_empty());
        assert!(previews.slots.is_empty());
    }
}

#[test]
fn chord_replacement_transfers_every_pitch_to_the_new_owner() {
    let mut core = audition_core(&[KEY]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    previews
        .preview(&mut core, false, request(&[60, 64]), now)
        .unwrap();
    previews
        .preview(
            &mut core,
            false,
            PreviewRequest {
                part_index: 3,
                ..request(&[60, 60, 67])
            },
            now + Duration::from_millis(200),
        )
        .unwrap();
    assert_eq!(
        midi(&mut core, KEY),
        vec![
            (true, 60),
            (true, 64),
            (false, 60),
            (false, 64),
            (true, 60),
            (true, 67),
        ]
    );
    previews.cancel_muted(&mut core, &HashSet::from([2]));
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert!(midi(&mut core, KEY).is_empty());
    previews.cancel_muted(&mut core, &HashSet::from([3]));
    assert_eq!(midi(&mut core, KEY), vec![(false, 60), (false, 67)]);
    previews.release_due(&mut core, now + Duration::from_millis(700));
    assert!(midi(&mut core, KEY).is_empty());
    assert!(previews.slots.is_empty());
}

#[test]
fn active_transport_rejects_audition_without_emitting_or_tracking_midi() {
    let mut core = audition_core(&[KEY]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    core.strip_mut(KEY).unwrap().send_midi(MidiEvent::NoteOn {
        channel: MidiChannel::from_index(0).unwrap(),
        note: 60,
        velocity: 100,
    });
    assert!(previews
        .preview(&mut core, true, request(&[60]), now)
        .is_err());
    previews.cancel(&mut core);
    previews.release_due(&mut core, now + Duration::from_secs(20));
    assert_eq!(
        midi(&mut core, KEY),
        vec![(true, 60)],
        "scheduled attack is untouched"
    );
    assert!(previews.slots.is_empty());
}

#[test]
fn exhausted_schedule_requires_explicit_stop_before_preview_can_sound_again() {
    use crate::playback_host::engine::{HostCommand, SlotSeq};
    use crate::playback_host::schedule::{resolve_schedule, PartScheduledMidi};

    // No stream or plugin is loaded: render the existing SF2 test voice offline.
    let mut engine = Engine::new(None).unwrap();
    *engine.mixer.lock() = audition_core(&[KEY]);
    let events: Vec<PartScheduledMidi> = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/derived-chords-midi.json"
    )))
    .unwrap();
    let schedule = resolve_schedule(&events);
    let end = schedule.last().unwrap().at_seconds;
    engine.slots.insert(
        KEY.to_owned(),
        SlotSeq {
            identity: KEY.to_owned(),
            schedule,
            cursor: 0,
            active: Vec::new(),
            sustain: HashSet::new(),
            attacks: Default::default(),
            controllers: Default::default(),
        },
    );
    let generation = engine.start(0.0);
    assert_eq!(engine.slots[KEY].cursor, 0);

    // Advance the actual engine clock past the last release without sleeping.
    engine.start_instant = Some(Instant::now() - Duration::from_secs_f64(end + 1.0));
    engine.pump();
    let seq = &engine.slots[KEY];
    assert_eq!(seq.cursor, seq.schedule.len());
    assert!(seq.active.is_empty());
    assert!(seq.attacks.is_empty());
    let scheduled = midi(&mut engine.mixer.lock(), KEY);
    assert_eq!(scheduled.iter().filter(|(on, _)| *on).count(), 8);
    assert_eq!(scheduled.iter().filter(|(on, _)| !*on).count(), 8);

    // Exhaustion is not a transport stop: the browser owns loops and tail timing.
    engine.pump();
    assert!(engine.playing);
    assert!(engine.start_instant.is_some());
    assert_eq!(engine.generation, generation);
    assert_eq!(
        engine.preview(request(&[60, 64, 67])).unwrap_err(),
        "preview is unavailable while transport is playing"
    );
    assert!(engine.previews.slots.is_empty());
    assert!(midi(&mut engine.mixer.lock(), KEY).is_empty());

    let (reply, stopped) = std::sync::mpsc::channel();
    engine.handle(HostCommand::Stop { reply });
    stopped.try_recv().unwrap().unwrap();
    assert!(!engine.playing);
    assert!(engine.start_instant.is_none());
    assert_eq!(engine.generation, generation + 1);
    engine.preview(request(&[60, 64, 67])).unwrap();
    assert_eq!(
        midi(&mut engine.mixer.lock(), KEY),
        vec![(true, 60), (true, 64), (true, 67)]
    );
    assert!(routing_peak(engine.mixer.lock().strip_mut(KEY).unwrap()) > 1e-4);

    engine.previews.release_due(
        &mut engine.mixer.lock(),
        Instant::now() + Duration::from_secs(1),
    );
    assert_eq!(
        midi(&mut engine.mixer.lock(), KEY),
        vec![(false, 60), (false, 64), (false, 67)]
    );
    assert!(engine.previews.slots.is_empty());
}

#[test]
fn invalid_chords_leave_the_existing_audition_untouched() {
    let mut core = audition_core(&[KEY]);
    let mut previews = PreviewNotes::default();
    let now = Instant::now();
    previews
        .preview(&mut core, false, request(&[60]), now)
        .unwrap();
    midi(&mut core, KEY);
    for notes in [vec![], vec![60; 17], vec![60, 128], vec![255]] {
        assert!(previews
            .preview(&mut core, false, request(&notes), now)
            .is_err());
    }
    for velocity in [0, 128, 255] {
        let mut invalid = request(&[60]);
        invalid.velocity = velocity;
        assert!(previews.preview(&mut core, false, invalid, now).is_err());
    }
    for duration_ms in [0, 10_001, u64::MAX] {
        let mut invalid = request(&[60]);
        invalid.duration_ms = duration_ms;
        assert!(previews.preview(&mut core, false, invalid, now).is_err());
    }
    assert!(midi(&mut core, KEY).is_empty());
    previews.release_due(&mut core, now + Duration::from_millis(500));
    assert_eq!(midi(&mut core, KEY), vec![(false, 60)]);
    assert!(validate_preview(&[0; 16], 1, 1).is_ok());
    assert!(validate_preview(&[127; 16], 127, 10_000).is_ok());
}

#[test]
fn unknown_slot_does_not_create_ownership_or_load_any_asset() {
    let mut core = audition_core(&[]);
    let mut previews = PreviewNotes::default();
    assert!(previews
        .preview(&mut core, false, request(&[60]), Instant::now())
        .is_err());
    assert!(previews.slots.is_empty());
}
