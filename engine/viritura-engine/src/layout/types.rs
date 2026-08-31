//! Internal layout data structures.

use crate::model::*;

// ═══════════════════════════════════════════
// Internal layout structures
// ═══════════════════════════════════════════

#[derive(Clone)]
pub(crate) struct MeasureLayout {
    pub(crate) x: f64,
    pub(crate) width: f64,
    pub(crate) resolved: ResolvedMeasure,
    pub(crate) voice_layouts: Vec<VoiceLayout>,
    pub(crate) prefix_width: f64,
    pub(crate) first_onset_padding: f64,
    /// Exact layout-owned offset of the time-signature slot from `x`.
    pub(crate) time_signature_x_offset: Option<f64>,
    /// Structural width reserved for trailing barline ink beyond a regular stroke.
    pub(crate) trailing_barline_extra: f64,
    pub(crate) mid_clef_changes: Vec<MidClefChange>,
    /// If Some(n), this measure is a collapsed multimeasure rest spanning n measures.
    pub(crate) multimeasure_rest_count: Option<u32>,
    /// Optional display label override for multimeasure rests (from MNX `label` property).
    pub(crate) multimeasure_rest_label: Option<String>,
    /// Part index for element ID generation.
    pub(crate) part_index: usize,
    /// True when this measure is the first on its system (line).
    /// Controls whether the clef is rendered at full size or as a 2/3 change clef.
    pub(crate) is_first_on_system: bool,
    /// True when system objects (tempo, rehearsal marks, jumps) should render on this staff.
    pub(crate) show_system_objects: bool,
    /// True when this is the topmost staff in the score (staff index 0).
    pub(crate) is_first_staff: bool,
}

/// Describes a mid-measure clef change for rendering.
#[derive(Clone)]
pub(crate) struct MidClefChange {
    pub(crate) clef: Clef,
    pub(crate) x: f64,
}

/// An ottava range resolved to absolute measure indices and beat positions.
/// Used to apply display pitch transposition for notes under ottava markings.
pub(crate) struct ResolvedOttavaRange {
    pub(crate) start_measure: usize,
    pub(crate) start_beat: f64,
    pub(crate) end_measure: usize,
    pub(crate) end_beat: f64,
    /// Ottava shift in octaves: 1=8va, 2=15ma, -1=8vb, etc.
    pub(crate) value: i32,
}

#[derive(Clone)]
pub(crate) struct VoiceLayout {
    pub(crate) voice_index: usize,
    /// Lever 2: per-voice events in struct-of-arrays form. Built AoS during
    /// construction (the in-place layout mutations keep operating on a
    /// `Vec<EventLayout>`), then frozen into the arena. Post-construction
    /// mutation passes write through the arena's index-based scalar setters;
    /// the few readers still needing an owned `EventLayout` use
    /// `EventArena::to_event_layout` (transitional, migrated to scalar
    /// accessors incrementally).
    pub(crate) events: super::arena::EventArena,
    pub(crate) tuplet_groups: Vec<TupletGroup>,
    pub(crate) multi_note_tremolo_groups: Vec<MultiNoteTremoloGroup>,
    /// Override part index for element IDs (condensed staves: source part index).
    pub(crate) part_index_override: Option<usize>,
    /// Override sequence index for element IDs (condensed staves: index within source part).
    pub(crate) seq_index_override: Option<usize>,
}

impl VoiceLayout {
    /// Whether this voice is a single bar rest drawn centred in the measure.
    ///
    /// Standard engraving practice centres a whole-bar rest rather than placing
    /// it at its rhythmic onset, so its `x` is a purely visual position. Code
    /// that snaps a rhythmic position onto a nearby event's `x` (spanner
    /// endpoints) must skip such a voice, or every beat in the bar would snap
    /// to the middle of the measure.
    pub(crate) fn is_centered_bar_rest(&self, total_beats: f64) -> bool {
        self.events.len() == 1
            && self.events.event(0).is_rest()
            && self.events.event(0).duration.total_beats() >= total_beats - 1e-9
    }
}

/// Describes a group of events that form a tuplet, for bracket rendering.
#[derive(Clone)]
pub(crate) struct TupletGroup {
    /// Index of the first event in the tuplet within VoiceLayout.events
    pub(crate) first_event_idx: usize,
    /// Index of the last event in the tuplet within VoiceLayout.events
    pub(crate) last_event_idx: usize,
    /// The tuplet display number (inner multiple, e.g. 3 for a 3:2 tuplet)
    pub(crate) display_number: u32,
    /// The outer multiple (e.g. 2 for a 3:2 tuplet), used when show_number=Both
    pub(crate) outer_number: u32,
    /// Whether to show the bracket (resolved from MNX `bracket`)
    pub(crate) show_bracket: bool,
    /// What number(s) to display (resolved from MNX `showNumber`)
    pub(crate) show_number: TupletShowNumber,
    /// Vertical orientation override (MNX `orient`, above/below/auto) —
    /// forces bracket placement.
    pub(crate) orient: Option<crate::model::Orientation>,
}

/// Resolved tuplet number display mode.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum TupletShowNumber {
    /// Show inner multiple only (default), e.g. "3"
    Inner,
    /// Show ratio, e.g. "3:2"
    Both,
    /// Show nothing
    None,
}

/// Describes a pair of events forming a multi-note tremolo.
#[derive(Clone)]
pub(crate) struct MultiNoteTremoloGroup {
    /// Index of the first event in the pair within VoiceLayout.events
    pub(crate) first_event_idx: usize,
    /// Index of the second event in the pair within VoiceLayout.events
    pub(crate) second_event_idx: usize,
    /// Number of tremolo slashes (1, 2, or 3)
    pub(crate) marks: u32,
}

#[derive(Clone)]
pub(crate) struct EventLayout {
    pub(crate) x: f64,
    pub(crate) event: Event,
    pub(crate) note_positions: Vec<f64>, // Staff positions (half-spaces from top line)
    /// Per-note horizontal offsets for seconds displacement within a chord.
    /// Parallel to `note_positions`. Displaced noteheads are shifted right by
    /// one notehead width to avoid overlap (standard mirror algorithm).
    pub(crate) note_x_offsets: Vec<f64>,
    /// Per-note flag: true if this note shares a notehead with another voice
    /// at the exact same staff position (unison). Shared noteheads are not
    /// rendered for this voice — the other voice's notehead serves both.
    /// Ref: standard engraving practice — voices sharing a pitch use a single notehead.
    pub(crate) shared_noteheads: Vec<bool>,
    /// True if this rest is shared with another voice at the same beat position
    /// and duration. The other voice renders the rest; this one is suppressed.
    pub(crate) shared_rest: bool,
    /// Display pitches for each note (transposed written pitch when transposition
    /// is active, or original concert pitch when not). Used for accidental rendering
    /// against the display key signature.
    pub(crate) display_pitches: Vec<Pitch>,
    pub(crate) stem_up: bool,
    pub(crate) id: Option<String>, // Event ID for beam matching
    pub(crate) grace_notes: Vec<GraceNoteLayout>,
    /// Number of voices in the parent measure (1 = single voice).
    pub(crate) num_voices: usize,
    /// Staff number of the parent sequence (1-indexed). Used with event.staff
    /// to compute cross-staff rendering offset.
    pub(crate) sequence_staff: u32,
    /// Beat position within the measure (after tuplet scaling), in quarter-note beats.
    pub(crate) beat_position: f64,
}

/// Layout info for a grace note preceding a main event.
#[derive(Clone)]
pub(crate) struct GraceNoteLayout {
    pub(crate) x: f64,
    pub(crate) event: Event,
    pub(crate) note_positions: Vec<f64>,
    pub(crate) stem_up: bool,
    pub(crate) after_main: bool,
    /// Acciaccatura (slashed flag) vs appoggiatura (normal flag)
    pub(crate) is_slash: bool,
    /// Event ID for beam matching
    pub(crate) id: Option<String>,
    /// Optional rendering color from the parent Grace container (MNX `color`).
    pub(crate) color: Option<String>,
}

impl VoiceLayout {
    /// Materialize this voice's events as an owned `Vec<EventLayout>`.
    ///
    /// Lever 2: all production readers/mutators now go through the columnar
    /// `EventArena` directly (scalar accessors, `to_event_layout`, setters), so
    /// this whole-vector materializer survives only as a convenience for test
    /// assertions that index/iterate events AoS-style. Gated `#[cfg(test)]` so
    /// it is not part of the shipping API surface.
    #[cfg(test)]
    pub(crate) fn events_vec(&self) -> Vec<EventLayout> {
        self.events.to_events()
    }
}

impl MeasureLayout {
    /// Translate all x positions in this layout by `dx`.
    /// Used to reposition a cached layout to a new x offset.
    pub(crate) fn translate_x(&mut self, dx: f64) {
        self.x += dx;
        for vl in &mut self.voice_layouts {
            // Lever 2: single flat pass over the arena's `x` buffer (+ grace x),
            // replacing the nested event→grace walk.
            vl.events.translate_x(dx);
        }
        for mc in &mut self.mid_clef_changes {
            mc.x += dx;
        }
    }
}
