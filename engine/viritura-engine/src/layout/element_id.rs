//! Canonical element ID construction for the selection/hit-testing system.
//!
//! All element IDs are **internal-only** — they exist only in the DisplayList
//! and never persist to MNX. The format is an implementation detail.
//!
//! ## Format overview
//!
//! Part-scoped:  `p{part}/m{measure}/...`
//! Global:       `m{measure}/...`
//! Sub-event:    `{event_id}/suffix`
//!
//! ## Rules
//!
//! 1. IDs use `/` as a path separator — MNX IDs are sanitized to prevent confusion.
//! 2. Every element type has exactly one canonical constructor in this module.
//! 3. Both command tags and bboxes MUST use the same ID for a given element.

/// Sanitize an MNX-provided ID for safe use in internal element paths.
/// Replaces `/` to prevent path-segment confusion from vendor IDs.
fn sanitize(mnx_id: &str) -> String {
    mnx_id.replace('/', "_")
}

/// Event ID suffix — uses the MNX `id` if present, otherwise `e{index}`.
pub fn event_suffix(mnx_id: Option<&str>, index: usize) -> String {
    mnx_id
        .map(sanitize)
        .unwrap_or_else(|| format!("e{}", index))
}

// ── Events & sub-events ─────────────────────────────────────────────

/// Full event ID: `p{part}/m{measure}/s{seq}/{suffix}`
pub fn event(part: usize, measure: usize, seq: usize, suffix: &str) -> String {
    format!("p{}/m{}/s{}/{}", part, measure, seq, suffix)
}

/// Grace note: `p{part}/m{measure}/s{seq}/{event_suffix}/grace/{grace_suffix}`
pub fn grace(
    part: usize,
    measure: usize,
    seq: usize,
    event_suffix: &str,
    grace_suffix: &str,
) -> String {
    format!(
        "p{}/m{}/s{}/{}/grace/{}",
        part, measure, seq, event_suffix, grace_suffix
    )
}

/// Individual notehead within a chord: `{event_id}/n{index}`
pub fn notehead(event_id: &str, note_index: usize) -> String {
    format!("{}/n{}", event_id, note_index)
}

/// Individual notehead routed to its source event after condensing.
pub fn source_notehead(
    fallback_event_id: &str,
    note: Option<&crate::model::Note>,
    fallback_note_index: usize,
) -> String {
    let source_event_id = note.and_then(|note| note.source_event_id.as_deref());
    let source_note_index = note.and_then(|note| note.source_note_index);
    notehead(
        source_event_id.unwrap_or(fallback_event_id),
        source_note_index.unwrap_or(fallback_note_index),
    )
}

/// Accidental qualifying one note of a chord: `{event_id}/acc{index}`,
/// where `index` is the note's index within the chord.
///
/// Deliberately a sibling of the notehead rather than a child of it
/// (`{event_id}/n{index}/acc`): selection resolves descendant ids, so the
/// nested spelling would sweep the accidental back into note selection, and
/// an accidental has to be selectable on its own to be deletable on its own.
pub fn accidental(event_id: &str, note_index: usize) -> String {
    format!("{}/acc{}", event_id, note_index)
}

/// Articulation: `{event_id}/art-{name}`, where `name` is the MNX `markings`
/// field the glyph draws (combos name both, joined by `.`).
///
/// Named rather than indexed because the render order is not stable: a glyph's
/// placement pass depends on slur participation, so adding a slur can renumber
/// an event's articulations. An id that changes meaning under an unrelated
/// edit cannot safely carry a selection or address a delete.
pub fn articulation(event_id: &str, name: &str) -> String {
    format!("{}/art-{}", event_id, name)
}

/// Tremolo: `{event_id}/trem`
pub fn tremolo(event_id: &str) -> String {
    format!("{}/trem", event_id)
}

/// Fermata: `{event_id}/ferm`
pub fn fermata(event_id: &str) -> String {
    format!("{}/ferm", event_id)
}

// ── Part-scoped measure elements ────────────────────────────────────

/// Clef: `p{part}/m{measure}/clef`
pub fn clef(part: usize, measure: usize) -> String {
    format!("p{}/m{}/clef", part, measure)
}

/// Key signature: `p{part}/m{measure}/key`
pub fn key_sig(part: usize, measure: usize) -> String {
    format!("p{}/m{}/key", part, measure)
}

/// Dynamic: `p{part}/m{measure}/dyn{group_id}`
pub fn dynamic(part: usize, measure: usize, group_id: &str) -> String {
    format!("p{}/m{}/dyn{}", part, measure, group_id)
}

/// Hairpin: `p{part}/m{measure}/hairpin{group_id}`
pub fn hairpin(part: usize, measure: usize, group_id: &str) -> String {
    format!("p{}/m{}/hairpin{}", part, measure, group_id)
}

/// Pedal: `p{part}/m{measure}/pedal{index}`
pub fn pedal(part: usize, measure: usize, index: usize) -> String {
    format!("p{}/m{}/pedal{}", part, measure, index)
}

/// Ottava: `p{part}/m{measure}/ottava{index}`
pub fn ottava(part: usize, measure: usize, index: usize) -> String {
    format!("p{}/m{}/ottava{}", part, measure, index)
}

/// Expression: `p{part}/m{measure}/expr{index}`
pub fn expression(part: usize, measure: usize, index: usize) -> String {
    format!("p{}/m{}/expr{}", part, measure, index)
}

/// Chord symbol: `p{part}/m{measure}/chord{index}`
pub fn chord_symbol(part: usize, measure: usize, index: usize) -> String {
    format!("p{}/m{}/chord{}", part, measure, index)
}

// ── Global measure elements ────────────────────────────────────────

/// Time signature: `m{measure}/time`
pub fn time_sig(measure: usize) -> String {
    format!("m{}/time", measure)
}

/// Barline: `m{measure}/barline`
pub fn barline(measure: usize) -> String {
    format!("m{}/barline", measure)
}

/// Tempo marking: `m{measure}/tempo{index}`
pub fn tempo(measure: usize, index: usize) -> String {
    format!("m{}/tempo{}", measure, index)
}

/// Segno: `m{measure}/segno`
pub fn segno(measure: usize) -> String {
    format!("m{}/segno", measure)
}

/// Coda: `m{measure}/coda`
pub fn coda(measure: usize) -> String {
    format!("m{}/coda", measure)
}

/// Fine: `m{measure}/fine`
pub fn fine(measure: usize) -> String {
    format!("m{}/fine", measure)
}

/// Jump (D.S., D.C., etc.): `m{measure}/jump`
pub fn jump(measure: usize) -> String {
    format!("m{}/jump", measure)
}

/// Rehearsal mark: `m{measure}/rehearsal`
pub fn rehearsal(measure: usize) -> String {
    format!("m{}/rehearsal", measure)
}

/// Volta bracket: `m{measure}/volta`
pub fn volta(measure: usize) -> String {
    format!("m{}/volta", measure)
}

/// Measure number: `m{measure}/mnum`
pub fn measure_number(measure: usize) -> String {
    format!("m{}/mnum", measure)
}

/// Multimeasure-rest count number (the large digits above the staff):
/// `m{measure}/mmrcount`
pub fn multimeasure_count(measure: usize) -> String {
    format!("m{}/mmrcount", measure)
}

/// Measure-repeat (simile) sign: `p{part}/m{measure}/measurerepeat`
pub fn measure_repeat(part: usize, measure: usize) -> String {
    format!("p{}/m{}/measurerepeat", part, measure)
}

// ── Spanners (rootless — not anchored to part/measure hierarchy) ────

/// Beam group: `p{part}/m{measure}/beam{index}`
pub fn beam(part: usize, measure: usize, index: usize) -> String {
    format!("p{}/m{}/beam{}", part, measure, index)
}

/// Grace note beam: `p{part}/m{measure}/gracebeam{index}`
pub fn grace_beam(part: usize, measure: usize, index: usize) -> String {
    format!("p{}/m{}/gracebeam{}", part, measure, index)
}

/// Tuplet: `p{part}/m{measure}/s{seq}/tuplet{index}`
pub fn tuplet(part: usize, measure: usize, seq: usize, index: usize) -> String {
    format!("p{}/m{}/s{}/tuplet{}", part, measure, seq, index)
}

/// Slur: `slur/{source}/{target}`
pub fn slur(source: &str, target: &str) -> String {
    format!("slur/{}/{}", sanitize(source), sanitize(target))
}

/// Tie: `tie/{source}/{target}`
pub fn tie(source: &str, target: &str) -> String {
    format!("tie/{}/{}", sanitize(source), sanitize(target))
}

/// Laissez vibrer tie: `tie/{source}/lv`
pub fn tie_lv(source: &str) -> String {
    format!("tie/{}/lv", sanitize(source))
}

/// Glissando: `gliss/{source}/{target}`
pub fn glissando(source: &str, target: &str) -> String {
    format!("gliss/{}/{}", sanitize(source), sanitize(target))
}

// ── Bbox helpers ────────────────────────────────────────────────────

/// Articulation bbox (combined): `{base_id}/artic`
pub fn artic_bbox(base_id: &str) -> String {
    format!("{}/artic", base_id)
}

/// Fermata bbox: `{base_id}/fermata`  
/// Note: command tag uses `/ferm`, bbox uses `/fermata` for historical reasons.
/// Both are recognized by the TS parser.
pub fn fermata_bbox(base_id: &str) -> String {
    format!("{}/fermata", base_id)
}

/// Ornament bbox: `{base_id}/ornament`
pub fn ornament_bbox(base_id: &str) -> String {
    format!("{}/ornament", base_id)
}

/// Trill bbox: `{base_id}/trill`
pub fn trill_bbox(base_id: &str) -> String {
    format!("{}/trill", base_id)
}
