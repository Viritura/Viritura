//! Notehead geometry snapshots shared by tie rendering passes.

use std::rc::Rc;

pub(crate) struct NoteRenderInfo {
    pub(super) x: f64,
    pub(super) stem_x: f64,
    pub(super) y_pos: f64,       // staff position (half-spaces from top line)
    pub(super) eff_staff_y: f64, // effective staff_y (cross-staff aware)
    pub(super) stem_up: bool,
    pub(super) inner_chord_note: bool,
    pub(super) continues_tie: bool,
    pub(super) notehead_center_offset: f64,
    pub(super) measure_idx: usize,
}

/// Snapshot of one tied note captured per (system, part, staff) and
/// accumulated globally so a post-pass can resolve tie targets that the
/// per-staff `render_ties` call would miss when they land on another system.
///
/// Mirrors `slurs::GlobalSlurEvent`: `render_ties` only builds a note map for
/// the single staff it is handed, so a tie whose target note lives on the next
/// system (or page) is silently dropped. We accumulate every note here and run
/// `render_cross_system_ties` after all systems are laid out, emitting endpoint
/// fragments for system breaks and navigation ties.
#[derive(Clone)]
pub(crate) struct GlobalTieNote {
    // Lever 2: `Rc<str>` (not `String`) so the per-edit retention path
    // (`splice_retained_slur_data` clones every retained note on reuse) is a
    // refcount bump instead of a heap alloc + copy. Byte-identity-transparent
    // (derefs to `&str`, so id equality / hashing / element-id construction is
    // unchanged).
    pub note_id: Rc<str>,
    /// Absolute X of the parent event (left edge of notehead).
    pub x: f64,
    pub stem_x: f64,
    pub measure_left_x: f64,
    pub measure_right_x: f64,
    /// This note's staff position (half-spaces from top line).
    pub y_pos: f64,
    /// Effective staff Y in absolute pixels (cross-staff aware).
    pub eff_staff_y: f64,
    pub stem_up: bool,
    pub num_voices: usize,
    pub notehead_center_offset: f64,
    /// All note staff-positions in the parent event (for `chord_tie_dir`).
    pub chord_positions: Vec<f64>,
    pub system_idx: usize,
    pub part_index: usize,
    pub staff_idx: usize,
    /// Ties originating on this note (empty for plain or target notes).
    pub ties: Vec<crate::model::event::Tie>,
}
