//! Precompiled MIDI resolution and seek planning (pure, host-independent).
//!
//! The frontend hands the host a slot's fully precompiled `ScheduledMidi`
//! stream (mapper output, §3.5). Before it can be driven onto a plugin two pure
//! transforms happen here, both unit-tested without any audio device:
//!
//! - [`resolve_schedule`] pairs each `NoteOff{note_id}` back to the channel and
//!   key of its own `NoteOn` (the wire protocol only carries the id on note-off,
//!   §3.3) and records, for every note-on, when its note-off falls so a seek can
//!   tell a still-sounding note from a finished one.
//! - [`plan_seek`] implements the deterministic seek contract (§3.5): to start at
//!   time `T` it replays the collapsed controller state and re-attacks the notes
//!   (and latching keyswitches) that are sounding across `T`, then resumes normal
//!   scheduling at the first event with `at_seconds >= T`.

use std::collections::{HashMap, VecDeque};

use serde::Deserialize;

use crate::mapper::{MidiMessage, ScheduledMidi};

/// A scheduled MIDI message tagged with the score part it came from, so the host
/// can drop (mute) or isolate (solo) a single part's events even when several
/// parts share one plugin slot. Part identity is set by the frontend after the
/// mapper compiles each part; the mapper itself is part-agnostic.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PartScheduledMidi {
    /// Runtime playback lane index, usually the source index within `score.parts`.
    /// Derived lanes may use extra indices such as `score.parts.length`; the same
    /// index identifies the lane in the host's per-part mute set.
    #[serde(default)]
    pub part: u32,
    #[serde(flatten)]
    pub midi: ScheduledMidi,
}

/// A MIDI message with its note id already paired to a concrete channel/key, so
/// the transport thread can route it to a plugin without any lookup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolvedMidi {
    NoteOn {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    NoteOff {
        channel: u8,
        note: u8,
    },
    ControlChange {
        channel: u8,
        controller: u8,
        value: u8,
    },
}

/// Schedule-local note-on identity, independent of part-local mapper IDs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ResolvedNoteId(pub(super) usize);

/// One precompiled event ready to route, tagged with the timeline second it fires
/// and — for note-ons — when the matching note-off falls (used by [`plan_seek`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResolvedEvent {
    pub at_seconds: f64,
    /// The source part index, carried through so the transport can mute/solo it.
    pub part: u32,
    pub midi: ResolvedMidi,
    /// Shared by a paired note-on/off; absent only for controllers.
    pub(super) note_id: Option<ResolvedNoteId>,
    /// For a `NoteOn`, the `at_seconds` of its paired `NoteOff`. `None` when the
    /// note never ends within the schedule (treated as sounding indefinitely).
    pub note_off_at: Option<f64>,
}

/// A note-on sounding across a seek point, tagged with its part so the transport
/// can skip re-attacking it when that part is muted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeldNote {
    pub part: u32,
    /// Always a [`ResolvedMidi::NoteOn`].
    pub midi: ResolvedMidi,
}

/// The immediate catch-up MIDI plus the resume point for a seek to some time `T`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SeekPlan {
    /// Collapsed controller state to replay (last value per `(channel, controller)`,
    /// in write order). Sent regardless of mute — CCs make no sound on their own.
    pub controllers: Vec<ResolvedMidi>,
    /// The note-ons sounding across `T`, tagged with part; the transport re-attacks
    /// only those whose part is not muted.
    pub held_notes: Vec<HeldNote>,
    /// Index of the first event with `at_seconds >= T`; where normal scheduling
    /// resumes.
    pub resume_index: usize,
}

/// Resolve a raw scheduled-MIDI stream into routable events.
///
/// Input need not be sorted; the result is sorted by `at_seconds` with ties kept
/// in original order (a stable sort), matching the mapper's own ordering. A
/// `NoteOff` whose `NoteOn` is missing is dropped rather than erroring, so a
/// malformed script degrades to silence on that note instead of stalling
/// playback. Reused part-local IDs pair in chronological FIFO order; each attack
/// retains its own schedule-local identity and release time.
pub fn resolve_schedule(events: &[PartScheduledMidi]) -> Vec<ResolvedEvent> {
    let mut indexed: Vec<(usize, &PartScheduledMidi)> = events.iter().enumerate().collect();
    indexed.sort_by(|(ai, a), (bi, b)| {
        a.midi
            .at_seconds
            .total_cmp(&b.midi.at_seconds)
            .then_with(|| ai.cmp(bi))
    });

    let mut resolved: Vec<ResolvedEvent> = Vec::with_capacity(indexed.len());
    let mut pending: HashMap<(u32, &str), VecDeque<usize>> = HashMap::new();
    for (index, event) in indexed {
        let part = event.part;
        let at_seconds = event.midi.at_seconds;
        match &event.midi.message {
            MidiMessage::NoteOn {
                note_id,
                channel,
                note,
                velocity,
            } => {
                pending
                    .entry((part, note_id.as_str()))
                    .or_default()
                    .push_back(resolved.len());
                resolved.push(ResolvedEvent {
                    at_seconds,
                    part,
                    midi: ResolvedMidi::NoteOn {
                        channel: *channel,
                        note: *note,
                        velocity: *velocity,
                    },
                    note_id: Some(ResolvedNoteId(index)),
                    note_off_at: None,
                });
            }
            MidiMessage::NoteOff { note_id } => {
                if let Some(on_index) = pending
                    .get_mut(&(part, note_id.as_str()))
                    .and_then(VecDeque::pop_front)
                {
                    let attack = &mut resolved[on_index];
                    attack.note_off_at = Some(at_seconds);
                    let ResolvedMidi::NoteOn { channel, note, .. } = attack.midi else {
                        unreachable!("pending indices refer only to note-ons");
                    };
                    let note_id = attack.note_id;
                    resolved.push(ResolvedEvent {
                        at_seconds,
                        part,
                        midi: ResolvedMidi::NoteOff { channel, note },
                        note_id,
                        note_off_at: None,
                    });
                }
            }
            MidiMessage::ControlChange {
                channel,
                controller,
                value,
            } => resolved.push(ResolvedEvent {
                at_seconds,
                part,
                midi: ResolvedMidi::ControlChange {
                    channel: *channel,
                    controller: *controller,
                    value: *value,
                },
                note_id: None,
                note_off_at: None,
            }),
        }
    }
    resolved
}

/// Plan a seek to timeline second `t` over a resolved schedule (§3.5).
///
/// `resolved` must be time-sorted (as returned by [`resolve_schedule`]). The plan
/// rebuilds the state that would be in effect at `t`:
///
/// - Every controller written before `t` collapses to its last value per
///   `(channel, controller)` and is replayed, in order of last write, so the
///   plugin's CC state is correct without stepping every intermediate value.
/// - Every note-on before `t` whose note-off is at or after `t` (or never)
///   re-attacks, so notes and latching keyswitches sounding across the seek point
///   keep sounding. Notes that already ended are skipped, and note-offs before
///   `t` are dropped.
///
/// Controllers are emitted before the held note-ons so a note lands with its
/// expression already primed.
pub fn plan_seek(resolved: &[ResolvedEvent], t: f64) -> SeekPlan {
    let mut cc_last: HashMap<(u8, u8), (usize, u8)> = HashMap::new();
    let mut held_notes: Vec<HeldNote> = Vec::new();
    let mut order = 0usize;

    let mut resume_index = resolved.len();
    for (index, event) in resolved.iter().enumerate() {
        if event.at_seconds >= t {
            resume_index = index;
            break;
        }
        match event.midi {
            ResolvedMidi::ControlChange {
                channel,
                controller,
                value,
            } => {
                cc_last.insert((channel, controller), (order, value));
                order += 1;
            }
            ResolvedMidi::NoteOn { .. } => {
                let still_sounding = event.note_off_at.map_or(true, |off| off >= t);
                if still_sounding {
                    held_notes.push(HeldNote {
                        part: event.part,
                        midi: event.midi,
                    });
                }
            }
            ResolvedMidi::NoteOff { .. } => {}
        }
    }

    let mut ordered: Vec<((u8, u8), (usize, u8))> = cc_last.into_iter().collect();
    ordered.sort_by_key(|(_, (order, _))| *order);

    let controllers: Vec<ResolvedMidi> = ordered
        .into_iter()
        .map(
            |((channel, controller), (_, value))| ResolvedMidi::ControlChange {
                channel,
                controller,
                value,
            },
        )
        .collect();

    SeekPlan {
        controllers,
        held_notes,
        resume_index,
    }
}

#[cfg(test)]
mod tests {
    use super::{plan_seek, resolve_schedule, HeldNote, PartScheduledMidi, ResolvedMidi, SeekPlan};
    use crate::mapper::{MidiMessage, ScheduledMidi};

    fn part(part: u32, at: f64, message: MidiMessage) -> PartScheduledMidi {
        PartScheduledMidi {
            part,
            midi: ScheduledMidi {
                at_seconds: at,
                message,
            },
        }
    }

    fn note_on(at: f64, note_id: &str, channel: u8, note: u8, velocity: u8) -> PartScheduledMidi {
        part(
            0,
            at,
            MidiMessage::NoteOn {
                note_id: note_id.to_owned(),
                channel,
                note,
                velocity,
            },
        )
    }

    fn note_off(at: f64, note_id: &str) -> PartScheduledMidi {
        part(
            0,
            at,
            MidiMessage::NoteOff {
                note_id: note_id.to_owned(),
            },
        )
    }

    fn cc(at: f64, channel: u8, controller: u8, value: u8) -> PartScheduledMidi {
        part(
            0,
            at,
            MidiMessage::ControlChange {
                channel,
                controller,
                value,
            },
        )
    }

    #[test]
    fn reused_ids_pair_chronologically_with_each_attacks_channel_key_and_seek_lifetime() {
        let resolved = resolve_schedule(&[
            note_off(4.0, "a"),
            note_on(2.0, "a", 9, 46, 100),
            note_off(1.0, "a"),
            note_on(0.0, "a", 3, 60, 90),
            note_off(5.0, "a"),
        ]);
        assert_eq!(resolved.len(), 4, "unmatched duplicate release is ignored");
        assert_eq!(resolved[0].note_id, resolved[1].note_id);
        assert_eq!(resolved[2].note_id, resolved[3].note_id);
        assert_ne!(resolved[0].note_id, resolved[2].note_id);
        assert_eq!(resolved[0].note_off_at, Some(1.0));
        assert_eq!(resolved[2].note_off_at, Some(4.0));
        assert_eq!(
            resolved[1].midi,
            ResolvedMidi::NoteOff {
                channel: 3,
                note: 60
            }
        );
        assert_eq!(
            resolved[3].midi,
            ResolvedMidi::NoteOff {
                channel: 9,
                note: 46
            }
        );
        assert!(plan_seek(&resolved, 1.5).held_notes.is_empty());
        assert_eq!(
            plan_seek(&resolved, 3.0).held_notes,
            vec![HeldNote {
                part: 0,
                midi: resolved[2].midi,
            }]
        );
    }

    #[test]
    fn overlapping_reused_ids_pair_fifo_without_crossing_parts() {
        let resolved = resolve_schedule(&[
            note_on(0.0, "a", 0, 60, 90),
            note_on(0.1, "a", 1, 64, 100),
            part(
                1,
                0.2,
                MidiMessage::NoteOn {
                    note_id: "a".to_owned(),
                    channel: 2,
                    note: 67,
                    velocity: 80,
                },
            ),
            part(
                1,
                0.3,
                MidiMessage::NoteOff {
                    note_id: "a".to_owned(),
                },
            ),
            note_off(0.4, "a"),
            note_off(0.5, "a"),
        ]);
        for (on, off) in [(0, 4), (1, 5), (2, 3)] {
            assert_eq!(resolved[on].note_id, resolved[off].note_id);
            assert_eq!(resolved[on].note_off_at, Some(resolved[off].at_seconds));
        }
    }

    #[test]
    fn derived_chord_lane_reused_ids_pair_fifo_independently_of_authored_parts() {
        // A score with 33 authored parts appends its runtime chord lane at 33.
        let chord_part = 33;
        let mut raw = Vec::new();
        for (part_index, start, end, channel, pitches) in [
            (chord_part, 0.0, 2.0, 1, [60, 64, 67]),
            (32, 0.25, 0.75, 0, [48, 52, 55]),
            (chord_part, 1.0, 3.0, 2, [62, 65, 69]),
            // A repeat visit reuses the original chord's mapper IDs.
            (chord_part, 4.0, 5.0, 1, [60, 64, 67]),
        ] {
            for (voice, pitch) in pitches.into_iter().enumerate() {
                let id = format!("chord-voice-{voice}");
                raw.push(PartScheduledMidi {
                    part: part_index,
                    ..note_on(start, &id, channel, pitch, 100)
                });
                raw.push(PartScheduledMidi {
                    part: part_index,
                    ..note_off(end, &id)
                });
            }
        }
        raw.reverse();
        let resolved = resolve_schedule(&raw);
        assert_eq!(resolved.len(), 24, "every attack and release must survive");
        let mut identities = std::collections::HashSet::new();
        for attack in &resolved {
            let ResolvedMidi::NoteOn { channel, note, .. } = attack.midi else {
                continue;
            };
            let identity = attack.note_id.expect("each attack has an identity");
            assert!(identities.insert(identity.0), "each visit is independent");
            let end = match attack.at_seconds {
                0.0 => 2.0,
                0.25 => 0.75,
                1.0 => 3.0,
                4.0 => 5.0,
                _ => unreachable!(),
            };
            assert_eq!(attack.note_off_at, Some(end));
            let releases: Vec<_> = resolved
                .iter()
                .filter(|event| {
                    event.note_id == Some(identity)
                        && matches!(event.midi, ResolvedMidi::NoteOff { .. })
                })
                .collect();
            assert_eq!(releases.len(), 1);
            assert_eq!(releases[0].part, attack.part);
            assert_eq!(releases[0].at_seconds, end);
            assert_eq!(releases[0].midi, ResolvedMidi::NoteOff { channel, note });
        }
        assert_eq!(identities.len(), 12);
        for (time, channel, pitches) in [
            (2.5, 2, vec![62, 65, 69]),
            (3.5, 1, vec![]),
            (4.5, 1, vec![60, 64, 67]),
            (5.5, 1, vec![]),
        ] {
            let plan = plan_seek(&resolved, time);
            assert!(plan.held_notes.iter().all(|note| note.part == chord_part));
            let mut actual: Vec<_> = plan.held_notes.iter().map(|note| note.midi).collect();
            actual.sort_by_key(|midi| match midi {
                ResolvedMidi::NoteOn { note, .. } => *note,
                _ => unreachable!(),
            });
            assert_eq!(
                actual,
                pitches
                    .into_iter()
                    .map(|note| ResolvedMidi::NoteOn {
                        channel,
                        note,
                        velocity: 100,
                    })
                    .collect::<Vec<_>>()
            );
            assert_eq!(
                plan.resume_index,
                resolved.partition_point(|event| event.at_seconds < time)
            );
        }
    }

    #[test]
    fn resolves_note_off_to_its_note_on_channel_and_key() {
        let events = vec![note_on(1.0, "n1", 3, 60, 90), note_off(2.0, "n1")];
        let resolved = resolve_schedule(&events);

        assert_eq!(resolved.len(), 2);
        assert_eq!(
            resolved[0].midi,
            ResolvedMidi::NoteOn {
                channel: 3,
                note: 60,
                velocity: 90
            }
        );
        assert_eq!(resolved[0].note_off_at, Some(2.0));
        assert_eq!(
            resolved[1].midi,
            ResolvedMidi::NoteOff {
                channel: 3,
                note: 60
            }
        );
    }

    #[test]
    fn carries_part_index_through_resolution() {
        // Two parts' events interleaved; each resolved event keeps its own part.
        let events = vec![
            part(
                2,
                0.0,
                MidiMessage::NoteOn {
                    note_id: "a".to_owned(),
                    channel: 0,
                    note: 60,
                    velocity: 80,
                },
            ),
            part(
                5,
                0.0,
                MidiMessage::NoteOn {
                    note_id: "b".to_owned(),
                    channel: 1,
                    note: 62,
                    velocity: 80,
                },
            ),
        ];
        let resolved = resolve_schedule(&events);
        assert_eq!(resolved[0].part, 2);
        assert_eq!(resolved[1].part, 5);
    }

    #[test]
    fn sorts_by_time_and_drops_orphan_note_off() {
        let events = vec![
            note_off(5.0, "missing"),
            cc(0.5, 0, 11, 64),
            note_on(0.0, "n1", 0, 62, 80),
        ];
        let resolved = resolve_schedule(&events);

        let times: Vec<f64> = resolved.iter().map(|e| e.at_seconds).collect();
        assert_eq!(times, vec![0.0, 0.5]);
        // The orphan note-off is dropped (no matching note-on).
        assert!(resolved
            .iter()
            .all(|e| !matches!(e.midi, ResolvedMidi::NoteOff { .. })));
    }

    #[test]
    fn seek_collapses_controllers_and_resumes_at_t() {
        let events = vec![
            cc(0.0, 0, 11, 20),
            cc(0.5, 0, 11, 100), // last CC11 before t → wins
            cc(0.6, 0, 1, 30),
            note_on(1.5, "future", 0, 64, 80),
            note_off(2.0, "future"),
        ];
        let resolved = resolve_schedule(&events);
        let SeekPlan {
            controllers,
            held_notes,
            resume_index,
        } = plan_seek(&resolved, 1.0);

        assert_eq!(
            controllers,
            vec![
                ResolvedMidi::ControlChange {
                    channel: 0,
                    controller: 11,
                    value: 100
                },
                ResolvedMidi::ControlChange {
                    channel: 0,
                    controller: 1,
                    value: 30
                },
            ]
        );
        assert!(held_notes.is_empty());
        // Resume at the note-on at 1.5 s (index 3 in the resolved stream).
        assert_eq!(resume_index, 3);
    }

    #[test]
    fn seek_reattacks_notes_sounding_across_the_point_but_not_finished_ones() {
        let events = vec![
            note_on(0.0, "held", 1, 40, 70), // a latched keyswitch / long note
            note_on(0.2, "past", 0, 60, 80),
            note_off(0.4, "past"), // finished before t → dropped
            note_off(3.0, "held"), // ends after t → re-attacked
            note_on(2.0, "future", 0, 62, 80),
            note_off(2.5, "future"),
        ];
        let resolved = resolve_schedule(&events);
        let plan = plan_seek(&resolved, 1.0);

        assert_eq!(
            plan.held_notes,
            vec![HeldNote {
                part: 0,
                midi: ResolvedMidi::NoteOn {
                    channel: 1,
                    note: 40,
                    velocity: 70
                }
            }]
        );
    }

    #[test]
    fn seek_before_start_replays_nothing() {
        let events = vec![note_on(1.0, "n1", 0, 60, 80), note_off(2.0, "n1")];
        let resolved = resolve_schedule(&events);
        let plan = plan_seek(&resolved, 0.0);

        assert_eq!(
            plan,
            SeekPlan {
                controllers: Vec::new(),
                held_notes: Vec::new(),
                resume_index: 0,
            }
        );
    }
}
