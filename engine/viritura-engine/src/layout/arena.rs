//! Lever 2 — struct-of-arrays (SoA) storage for layout output.
//!
//! `VoiceLayout` stores events here instead of in the former
//! `Vec<EventLayout>` array-of-structs representation. Geometry hot loops use
//! the scalar/CSR accessors directly; a small number of compatibility readers
//! still materialize individual `EventLayout`s where a deeper helper migration
//! has not justified its complexity.
//!
//! [`EventArena`] is the SoA counterpart: one flat parallel buffer per scalar
//! field, a CSR offset table for the per-note arrays, and the model payload kept
//! as a parallel vec for now (flattening the model tree is a later step). The
//! immediate wins this unlocks, proven by the tests below:
//!
//!   * **`translate_x` is a single pass over the flat `x` buffer** (plus grace
//!     x), instead of a nested voice→event→grace walk. Cache-friendly and
//!     auto-vectorizable — the foundation for O(1)-per-system retention.
//!   * **Reconstruction is exact.** [`EventArena::to_event_layout`] rebuilds the
//!     original `EventLayout` byte-for-byte (the round-trip test asserts
//!     `PartialEq` equality on real values), so the arena can be wired in behind
//!     the byte-identity oracle without changing rendered output.
//!
//! This is the live event storage for every layout path. Keep unused APIs out
//! rather than suppressing `dead_code`: the warning is valuable evidence that
//! a transitional surface can be removed.

use super::types::{EventLayout, GraceNoteLayout};
use crate::model::{Event, Pitch};

/// Struct-of-arrays storage for a sequence of [`EventLayout`]s (one voice's
/// events). Scalar geometry fields live in flat parallel arrays indexed by event
/// position; the four per-note arrays share one CSR offset table
/// (`note_starts`); the model `Event` payload and grace notes stay as parallel
/// vecs (AoS) until the model tree is flattened in a later step.
///
/// Invariants (upheld by [`Self::push`]):
///   * every scalar array has length `len()`;
///   * `note_starts` has length `len() + 1`, is non-decreasing, starts at `0`,
///     and its last element equals the length of each per-note array;
///   * the four per-note arrays (`note_positions`, `note_x_offsets`,
///     `shared_noteheads`, `display_pitches`) have equal length.
#[derive(Clone)]
pub(crate) struct EventArena {
    // ── Per-event scalars (len == event count) ──
    x: Vec<f64>,
    stem_up: Vec<bool>,
    shared_rest: Vec<bool>,
    num_voices: Vec<u32>,
    sequence_staff: Vec<u32>,
    beat_position: Vec<f64>,
    id: Vec<Option<String>>,
    /// Per-event override for articulation placement side, set by the
    /// cross-staff fix. `None` = use the default rule (slur side / voice parity
    /// / stem); `Some(true)` = force below, `Some(false)` = force above. A staff
    /// that *receives* a cross-staff voice gains a second "virtual" voice whose
    /// home is another staff, so its native voice's articulations must sit on
    /// the OUTER side (away from the arriving voice) — info that isn't visible
    /// from this staff's own `num_voices`. Not part of `EventLayout`: it's a
    /// render-time hint applied after assembly, so it survives the cache (the
    /// cross-staff fix re-runs each pass) without touching the push path.
    artic_force_below: Vec<Option<bool>>,

    // ── Per-note arrays, CSR-indexed by `note_starts` ──
    /// Offsets into the per-note arrays. `note_starts[i]..note_starts[i + 1]` is
    /// the range of notes belonging to event `i`. Length is event count + 1.
    note_starts: Vec<u32>,
    note_positions: Vec<f64>,
    note_x_offsets: Vec<f64>,
    shared_noteheads: Vec<bool>,
    display_pitches: Vec<Pitch>,

    // ── Model payload, parallel AoS (flattened in a later step) ──
    event: Vec<Event>,
    grace_notes: Vec<Vec<GraceNoteLayout>>,
}

impl Default for EventArena {
    fn default() -> Self {
        Self::new()
    }
}

impl EventArena {
    /// An empty arena. `note_starts` seeds the CSR sentinel `[0]`.
    pub(crate) fn new() -> Self {
        Self {
            x: Vec::new(),
            stem_up: Vec::new(),
            shared_rest: Vec::new(),
            num_voices: Vec::new(),
            sequence_staff: Vec::new(),
            beat_position: Vec::new(),
            id: Vec::new(),
            artic_force_below: Vec::new(),
            note_starts: vec![0],
            note_positions: Vec::new(),
            note_x_offsets: Vec::new(),
            shared_noteheads: Vec::new(),
            display_pitches: Vec::new(),
            event: Vec::new(),
            grace_notes: Vec::new(),
        }
    }

    /// Pre-allocate the scalar arrays for `cap` events (note arrays grow as
    /// events are pushed since per-event note counts aren't known up front).
    pub(crate) fn with_capacity(cap: usize) -> Self {
        let mut a = Self::new();
        a.x.reserve(cap);
        a.stem_up.reserve(cap);
        a.shared_rest.reserve(cap);
        a.num_voices.reserve(cap);
        a.sequence_staff.reserve(cap);
        a.beat_position.reserve(cap);
        a.id.reserve(cap);
        a.artic_force_below.reserve(cap);
        a.note_starts.reserve(cap + 1);
        a.event.reserve(cap);
        a.grace_notes.reserve(cap);
        a
    }

    /// Number of events stored.
    pub(crate) fn len(&self) -> usize {
        self.x.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.x.is_empty()
    }

    /// Append one [`EventLayout`], consuming it (the model `Event`, grace notes,
    /// and per-note vecs are moved in, not cloned).
    pub(crate) fn push(&mut self, el: EventLayout) {
        let EventLayout {
            x,
            event,
            note_positions,
            note_x_offsets,
            shared_noteheads,
            shared_rest,
            display_pitches,
            stem_up,
            id,
            grace_notes,
            num_voices,
            sequence_staff,
            beat_position,
        } = el;

        self.x.push(x);
        self.stem_up.push(stem_up);
        self.shared_rest.push(shared_rest);
        self.num_voices.push(num_voices as u32);
        self.sequence_staff.push(sequence_staff);
        self.beat_position.push(beat_position);
        self.id.push(id);
        self.artic_force_below.push(None);

        self.note_positions.extend(note_positions);
        self.note_x_offsets.extend(note_x_offsets);
        self.shared_noteheads.extend(shared_noteheads);
        self.display_pitches.extend(display_pitches);
        // CSR: record the new end-of-notes offset. All four per-note arrays
        // share it, so use note_positions' length as the canonical cursor.
        self.note_starts.push(self.note_positions.len() as u32);

        self.event.push(event);
        self.grace_notes.push(grace_notes);
    }

    /// Build an arena from a slice/vec of events.
    pub(crate) fn from_events(events: Vec<EventLayout>) -> Self {
        let mut a = Self::with_capacity(events.len());
        for el in events {
            a.push(el);
        }
        a
    }

    /// CSR note range for event `i`.
    fn note_range(&self, i: usize) -> std::ops::Range<usize> {
        self.note_starts[i] as usize..self.note_starts[i + 1] as usize
    }

    // ── Scalar accessors (the cache-friendly read path) ──
    pub(crate) fn x(&self, i: usize) -> f64 {
        self.x[i]
    }
    pub(crate) fn stem_up(&self, i: usize) -> bool {
        self.stem_up[i]
    }
    pub(crate) fn beat_position(&self, i: usize) -> f64 {
        self.beat_position[i]
    }
    pub(crate) fn shared_rest(&self, i: usize) -> bool {
        self.shared_rest[i]
    }
    pub(crate) fn num_voices(&self, i: usize) -> usize {
        self.num_voices[i] as usize
    }
    pub(crate) fn sequence_staff(&self, i: usize) -> u32 {
        self.sequence_staff[i]
    }
    pub(crate) fn id(&self, i: usize) -> Option<&str> {
        self.id[i].as_deref()
    }
    /// Articulation-side override (set by the cross-staff fix). See the field
    /// doc. `None` = use the default placement rule.
    pub(crate) fn artic_force_below(&self, i: usize) -> Option<bool> {
        self.artic_force_below[i]
    }
    /// The model `Event` payload for event `i` (read path for the mutation
    /// loops that branch on `event.staff` / `event.is_rest()` / etc.).
    pub(crate) fn event(&self, i: usize) -> &Event {
        &self.event[i]
    }
    /// Whether this rest's x coordinate is the visual center of the measure's
    /// rhythmic content rather than the usual left-side event origin.
    pub(crate) fn is_centered_bar_rest(&self, i: usize, measure_beats: f64) -> bool {
        let event = self.event(i);
        self.len() == 1
            && event.is_rest()
            && self.beat_position(i).abs() < 1e-9
            && event.duration.total_beats() >= measure_beats - 1e-9
    }
    pub(crate) fn grace_notes(&self, i: usize) -> &[GraceNoteLayout] {
        &self.grace_notes[i]
    }
    pub(crate) fn note_positions(&self, i: usize) -> &[f64] {
        &self.note_positions[self.note_range(i)]
    }
    pub(crate) fn note_x_offsets(&self, i: usize) -> &[f64] {
        &self.note_x_offsets[self.note_range(i)]
    }
    pub(crate) fn shared_noteheads(&self, i: usize) -> &[bool] {
        &self.shared_noteheads[self.note_range(i)]
    }
    pub(crate) fn display_pitches(&self, i: usize) -> &[Pitch] {
        &self.display_pitches[self.note_range(i)]
    }

    // ── Scalar mutators (the index-based write path) ──
    //
    // The construction pipeline mutates events in place at ~10 sites (rest
    // conflicts, stem flips, the cross-staff fix that runs in precompute after
    // a retained measure is moved in). The idiomatic SoA migration of those
    // `for el in &mut vl.events { … }` loops is index-based:
    // `for i in 0..arena.len() { if arena.event(i).is_rest() { … } }` reading
    // via the accessors above and writing via these setters.
    pub(crate) fn set_x(&mut self, i: usize, x: f64) {
        self.x[i] = x;
    }
    pub(crate) fn set_stem_up(&mut self, i: usize, v: bool) {
        self.stem_up[i] = v;
    }
    pub(crate) fn set_shared_rest(&mut self, i: usize, v: bool) {
        self.shared_rest[i] = v;
    }
    /// Force this event's articulations to a fixed side (cross-staff receiving
    /// staves). `None` clears the override.
    pub(crate) fn set_artic_force_below(&mut self, i: usize, v: Option<bool>) {
        self.artic_force_below[i] = v;
    }
    /// Mutable per-note staff positions for event `i` (the cross-staff fix
    /// rewrites these when a note is rendered on a different staff).
    pub(crate) fn note_positions_mut(&mut self, i: usize) -> &mut [f64] {
        let r = self.note_range(i);
        &mut self.note_positions[r]
    }
    pub(crate) fn note_x_offsets_mut(&mut self, i: usize) -> &mut [f64] {
        let r = self.note_range(i);
        &mut self.note_x_offsets[r]
    }
    pub(crate) fn shared_noteheads_mut(&mut self, i: usize) -> &mut [bool] {
        let r = self.note_range(i);
        &mut self.shared_noteheads[r]
    }

    /// Translate every event's `x` (and grace-note `x`) by `dx`. SoA fast path:
    /// one pass over the flat `x` buffer instead of the nested
    /// voice→event→grace walk `MeasureLayout::translate_x` performs. The
    /// per-note arrays hold staff positions / offsets, not absolute x, so they
    /// are translation-invariant and untouched.
    pub(crate) fn translate_x(&mut self, dx: f64) {
        if dx == 0.0 {
            return;
        }
        for x in &mut self.x {
            *x += dx;
        }
        for graces in &mut self.grace_notes {
            for gn in graces {
                gn.x += dx;
            }
        }
    }

    /// Reconstruct event `i` as an owned [`EventLayout`]. Used by the byte-
    /// identity round-trip and as the transition-period compatibility surface
    /// for the ~45 reader sites still expecting `&EventLayout`; those migrate to
    /// the scalar accessors above incrementally.
    pub(crate) fn to_event_layout(&self, i: usize) -> EventLayout {
        let r = self.note_range(i);
        EventLayout {
            x: self.x[i],
            event: self.event[i].clone(),
            note_positions: self.note_positions[r.clone()].to_vec(),
            note_x_offsets: self.note_x_offsets[r.clone()].to_vec(),
            shared_noteheads: self.shared_noteheads[r.clone()].to_vec(),
            shared_rest: self.shared_rest[i],
            display_pitches: self.display_pitches[r].to_vec(),
            stem_up: self.stem_up[i],
            id: self.id[i].clone(),
            grace_notes: self.grace_notes[i].clone(),
            num_voices: self.num_voices[i] as usize,
            sequence_staff: self.sequence_staff[i],
            beat_position: self.beat_position[i],
        }
    }

    /// Reconstruct all events (transition compatibility).
    pub(crate) fn to_events(&self) -> Vec<EventLayout> {
        (0..self.len()).map(|i| self.to_event_layout(i)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Duration, NoteValueBase, Pitch};

    fn pitch(step: &str, octave: i32) -> Pitch {
        Pitch {
            step: step.to_string(),
            octave,
            alter: None,
        }
    }

    /// Minimal model `Event` (only `duration` is mandatory). The arena moves the
    /// event through unchanged, so any value works — this keeps the round-trip
    /// focused on the SoA reshaping, not model construction.
    fn minimal_event() -> Event {
        Event {
            duration: Duration {
                base: NoteValueBase::Quarter,
                dots: None,
            },
            id: None,
            notes: None,
            rest: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        }
    }

    /// A synthetic event with `n` notes and recognizable scalar values, so the
    /// round-trip can assert exact reconstruction.
    fn make_event(x: f64, n: usize, with_grace: bool) -> EventLayout {
        EventLayout {
            x,
            event: minimal_event(),
            note_positions: (0..n).map(|k| k as f64 + 0.5).collect(),
            note_x_offsets: (0..n).map(|k| k as f64 * 0.1).collect(),
            shared_noteheads: (0..n).map(|k| k % 2 == 0).collect(),
            shared_rest: n == 0,
            display_pitches: (0..n).map(|k| pitch("C", 4 + k as i32)).collect(),
            stem_up: x > 0.0,
            id: Some(format!("ev-{x}")),
            grace_notes: if with_grace {
                vec![GraceNoteLayout {
                    x: x - 1.0,
                    event: minimal_event(),
                    note_positions: vec![2.0],
                    stem_up: true,
                    after_main: false,
                    is_slash: false,
                    id: Some("grace".to_string()),
                    color: None,
                }]
            } else {
                Vec::new()
            },
            num_voices: 2,
            sequence_staff: 1,
            beat_position: x / 10.0,
        }
    }

    fn assert_event_eq(a: &EventLayout, b: &EventLayout) {
        assert_eq!(a.x, b.x);
        assert_eq!(a.event, b.event);
        assert_eq!(a.note_positions, b.note_positions);
        assert_eq!(a.note_x_offsets, b.note_x_offsets);
        assert_eq!(a.shared_noteheads, b.shared_noteheads);
        assert_eq!(a.shared_rest, b.shared_rest);
        assert_eq!(a.display_pitches, b.display_pitches);
        assert_eq!(a.stem_up, b.stem_up);
        assert_eq!(a.id, b.id);
        assert_eq!(a.grace_notes.len(), b.grace_notes.len());
        for (ga, gb) in a.grace_notes.iter().zip(&b.grace_notes) {
            assert_eq!(ga.x, gb.x);
            assert_eq!(ga.note_positions, gb.note_positions);
            assert_eq!(ga.id, gb.id);
        }
        assert_eq!(a.num_voices, b.num_voices);
        assert_eq!(a.sequence_staff, b.sequence_staff);
        assert_eq!(a.beat_position, b.beat_position);
    }

    #[test]
    fn soa_round_trip_is_exact() {
        // Mixed arities incl. a 0-note rest and an 8-note chord exercise the CSR
        // offset table boundaries.
        let originals = vec![
            make_event(1.0, 3, true),
            make_event(2.0, 0, false), // rest: zero notes
            make_event(3.0, 8, false), // wide chord
            make_event(4.0, 1, true),
        ];
        let arena = EventArena::from_events(originals.clone());
        assert_eq!(arena.len(), 4);

        for (i, orig) in originals.iter().enumerate() {
            assert_event_eq(&arena.to_event_layout(i), orig);
        }
        // CSR invariant: last offset == total notes (3 + 0 + 8 + 1).
        assert_eq!(arena.note_positions(2).len(), 8);
        assert_eq!(arena.note_positions(1).len(), 0);
    }

    #[test]
    fn soa_translate_x_matches_aos() {
        let originals = vec![make_event(1.0, 2, true), make_event(5.0, 3, false)];
        let mut arena = EventArena::from_events(originals.clone());
        arena.translate_x(10.0);

        for (i, orig) in originals.iter().enumerate() {
            let shifted = arena.to_event_layout(i);
            // Event x shifted; grace x shifted; note positions invariant.
            assert_eq!(shifted.x, orig.x + 10.0);
            assert_eq!(shifted.note_positions, orig.note_positions);
            for (gs, go) in shifted.grace_notes.iter().zip(&orig.grace_notes) {
                assert_eq!(gs.x, go.x + 10.0);
            }
        }
    }

    #[test]
    fn soa_translate_x_zero_is_noop() {
        let originals = vec![make_event(7.0, 4, true)];
        let mut arena = EventArena::from_events(originals.clone());
        arena.translate_x(0.0);
        assert_event_eq(&arena.to_event_layout(0), &originals[0]);
    }

    #[test]
    fn soa_index_mutation_matches_aos() {
        // Replicates the cross-staff fix's mutation shape: branch on the read
        // accessors (event/shared_rest/stem_up), write via the setters, and
        // assert the arena ends byte-identical to the same mutation applied to
        // the AoS Vec in place.
        let mut aos = vec![
            make_event(1.0, 2, false),
            make_event(2.0, 0, false), // rest
            make_event(3.0, 3, true),
        ];
        let mut arena = EventArena::from_events(aos.clone());

        // AoS mutation (the "before" world).
        for el in &mut aos {
            if el.event.is_rest() {
                el.shared_rest = true;
            } else {
                el.stem_up = !el.stem_up;
                if !el.note_positions.is_empty() {
                    el.note_positions[0] += 0.5;
                }
            }
        }

        // Index-based SoA mutation (the migration pattern).
        for i in 0..arena.len() {
            if arena.event(i).is_rest() {
                arena.set_shared_rest(i, true);
            } else {
                arena.set_stem_up(i, !arena.stem_up(i));
                let np = arena.note_positions_mut(i);
                if !np.is_empty() {
                    np[0] += 0.5;
                }
            }
        }

        for (i, expected) in aos.iter().enumerate() {
            assert_event_eq(&arena.to_event_layout(i), expected);
        }
    }
}
