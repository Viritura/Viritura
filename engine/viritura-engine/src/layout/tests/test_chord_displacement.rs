//! Tests for chord notehead seconds displacement.
//! When a chord contains adjacent notes (a second apart), noteheads must be
//! displaced to opposite sides of the stem to avoid overlap.
//! Reference: standard engraving practice layoutChords2()

use super::test_helpers::*;
use crate::layout::measure::compute_seconds_displacement;
use crate::layout::*;
use crate::model::KeySignature;
use crate::parse::parse_mnx;

// --- Unit tests for compute_seconds_displacement ---

#[test]
fn single_note_no_displacement() {
    let offsets = compute_seconds_displacement(&[4.0], true);
    assert_eq!(offsets, vec![0.0]);
}

#[test]
fn two_notes_third_apart_no_displacement() {
    // C4 and E4 (a third apart) — no displacement needed
    let offsets = compute_seconds_displacement(&[4.0, 2.0], true);
    assert_eq!(offsets, vec![0.0, 0.0]);
}

#[test]
fn two_notes_second_apart_stem_up() {
    // C4 (pos=4) and D4 (pos=3) — adjacent, stem up
    // Bottom note (C4, pos=4) is stem-end, stays normal.
    // Top note (D4, pos=3) is displaced right (+1.0).
    let offsets = compute_seconds_displacement(&[4.0, 3.0], true);
    assert_eq!(offsets[0], 0.0, "bottom note (stem-end) stays normal");
    assert_eq!(offsets[1], 1.0, "top note displaced right");
}

#[test]
fn two_notes_second_apart_stem_down() {
    // C4 (pos=4) and D4 (pos=3) — adjacent, stem down
    // Top note (D4, pos=3) is stem-end, stays normal.
    // Bottom note (C4, pos=4) is displaced left (-1.0).
    let offsets = compute_seconds_displacement(&[4.0, 3.0], false);
    assert_eq!(offsets[0], -1.0, "bottom note displaced left");
    assert_eq!(offsets[1], 0.0, "top note (stem-end) stays normal");
}

#[test]
fn three_notes_cluster_stem_up() {
    // C4 (pos=4), D4 (pos=3), E4 (pos=2) — adjacent cluster, stem up
    // Bottom-to-top: C4 normal, D4 displaced, E4 back to normal
    let offsets = compute_seconds_displacement(&[4.0, 3.0, 2.0], true);
    assert_eq!(offsets[0], 0.0, "C4 (bottom, stem-end) normal");
    assert_eq!(offsets[1], 1.0, "D4 displaced right");
    assert_eq!(offsets[2], 0.0, "E4 back to normal");
}

#[test]
fn three_notes_cluster_stem_down() {
    // C4 (pos=4), D4 (pos=3), E4 (pos=2) — adjacent cluster, stem down
    // Top-to-bottom: E4 normal, D4 displaced, C4 back to normal
    let offsets = compute_seconds_displacement(&[4.0, 3.0, 2.0], false);
    assert_eq!(offsets[0], 0.0, "C4 back to normal");
    assert_eq!(offsets[1], -1.0, "D4 displaced left");
    assert_eq!(offsets[2], 0.0, "E4 (top, stem-end) normal");
}

#[test]
fn four_notes_alternating_cluster() {
    // C4 (pos=6), D4 (pos=5), E4 (pos=4), F4 (pos=3) — all adjacent, stem up
    // Bottom-to-top: C4 normal, D4 displaced, E4 normal, F4 displaced
    let offsets = compute_seconds_displacement(&[6.0, 5.0, 4.0, 3.0], true);
    assert_eq!(offsets[0], 0.0, "C4 normal");
    assert_eq!(offsets[1], 1.0, "D4 displaced");
    assert_eq!(offsets[2], 0.0, "E4 normal");
    assert_eq!(offsets[3], 1.0, "F4 displaced");
}

#[test]
fn mixed_seconds_and_thirds() {
    // C4 (pos=6), D4 (pos=5), F4 (pos=3) — C-D is a second, D-F is a third
    // stem up: bottom-to-top: C4 normal, D4 displaced (adj to C), F4 reset (gap)
    let offsets = compute_seconds_displacement(&[6.0, 5.0, 3.0], true);
    assert_eq!(offsets[0], 0.0, "C4 normal");
    assert_eq!(offsets[1], 1.0, "D4 displaced (second from C)");
    assert_eq!(offsets[2], 0.0, "F4 normal (third from D, reset)");
}

#[test]
fn notes_out_of_order_in_input() {
    // Input order doesn't match pitch order — algorithm should sort internally
    // D4 (pos=3) first, C4 (pos=4) second — same as two_notes_second_apart_stem_up
    let offsets = compute_seconds_displacement(&[3.0, 4.0], true);
    // Bottom note (C4 at index 1) is stem-end, top note (D4 at index 0) displaced
    assert_eq!(offsets[0], 1.0, "D4 (top) displaced right");
    assert_eq!(offsets[1], 0.0, "C4 (bottom, stem-end) normal");
}

#[test]
fn empty_positions() {
    let offsets = compute_seconds_displacement(&[], true);
    assert!(offsets.is_empty());
}

#[test]
fn unison_same_position() {
    // Two notes at the same position (unison)
    let offsets = compute_seconds_displacement(&[4.0, 4.0], true);
    // diff = 0 < 2, so second note gets displaced
    assert_eq!(offsets[0], 0.0);
    // One of them should be displaced
    assert!(offsets[1].abs() > 0.0, "unison should displace one note");
}

// --- Integration tests: verify rendered noteheads have different x positions ---

fn make_chord_json(notes: &[(&str, u8)]) -> String {
    let notes_json: Vec<String> = notes
        .iter()
        .map(|(step, octave)| {
            format!(
                r#"{{"pitch": {{"step": "{}", "octave": {}}}}}"#,
                step, octave
            )
        })
        .collect();
    format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{
            "measures": [{{"time": {{"count": 4, "unit": 4}}}}]
        }},
        "parts": [{{
            "measures": [{{
                "sequences": [{{
                    "content": [{{
                        "duration": {{"base": "quarter"}},
                        "notes": [{}]
                    }}]
                }}]
            }}]
        }}]
    }}"#,
        notes_json.join(", ")
    )
}

#[test]
fn render_chord_with_second_has_displaced_noteheads() {
    let json = make_chord_json(&[("C", 4), ("D", 4)]);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);

    // Find the event and check displacement offsets
    let event = &ml.voice_layouts[0].events_vec()[0];
    assert_eq!(event.note_positions.len(), 2, "chord should have 2 notes");
    assert_eq!(event.note_x_offsets.len(), 2, "should have 2 x offsets");

    // One note should be displaced, the other not
    let has_displaced = event.note_x_offsets.iter().any(|&o| o != 0.0);
    assert!(
        has_displaced,
        "chord with second should have displaced noteheads"
    );
}

#[test]
fn beamed_stem_flip_recomputes_second_displacement() {
    // A beam group whose first event is naturally stem-up (low note) followed by
    // a high chord-with-a-second that is naturally stem-DOWN. Beam-group stem
    // normalization flips the high chord to stem-up to match the group. The
    // chord's second-interval displacement must be RECOMPUTED for the new stem
    // direction (stem-up displaces the upper note RIGHT, +1) — otherwise it
    // keeps the stem-down value (lower note LEFT, -1) and the displaced notehead
    // floats a notehead-width off the stem. Regression guard for that bug.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
            {"duration": {"base": "eighth"}, "notes": [
                {"pitch": {"step": "B", "octave": 5}},
                {"pitch": {"step": "C", "octave": 6}}
            ]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);

    let events = ml.voice_layouts[0].events_vec();
    assert_eq!(events.len(), 2, "expected two beamed eighth events");
    let chord = &events[1];
    assert_eq!(chord.note_positions.len(), 2, "second event is a chord");

    // The chord was normalized to the group's (first event's) stem-up direction.
    assert!(
        chord.stem_up,
        "high chord should be normalized to the beam group's stem-up direction"
    );

    // With stem-up, the displaced notehead must go RIGHT (+1), not left (-1).
    // The offsets must match a fresh stem-up computation, not the stale
    // stem-down one.
    let expected = compute_seconds_displacement(&chord.note_positions, true);
    assert_eq!(
        chord.note_x_offsets, expected,
        "displacement must be recomputed for the flipped (stem-up) direction"
    );
    assert!(
        chord.note_x_offsets.iter().any(|&o| o > 0.0),
        "stem-up second must displace a notehead to the RIGHT (+1), got {:?}",
        chord.note_x_offsets
    );
    assert!(
        chord.note_x_offsets.iter().all(|&o| o >= 0.0),
        "stem-up chord must not displace any notehead LEFT, got {:?}",
        chord.note_x_offsets
    );
}

#[test]
fn render_chord_with_third_no_displacement() {
    let json = make_chord_json(&[("C", 4), ("E", 4)]);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], sp, 0.0, &config, None, &[], 1.0);

    let event = &ml.voice_layouts[0].events_vec()[0];
    assert_eq!(event.note_x_offsets.len(), 2);
    assert!(
        event.note_x_offsets.iter().all(|&o| o == 0.0),
        "chord with third should have no displacement"
    );
}

#[test]
fn rendered_noteheads_different_x_for_second() {
    let json = make_chord_json(&[("C", 4), ("D", 4)]);
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find all notehead glyphs
    let noteheads: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { x, y, .. } = cmd {
                if is_notehead_glyph(cmd) {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    assert!(noteheads.len() >= 2, "should render at least 2 noteheads");

    // Check that the noteheads have different x positions (displacement applied)
    let first_x = noteheads[0].0;
    let has_different_x = noteheads.iter().any(|(x, _)| (*x - first_x).abs() > 0.1);
    assert!(
        has_different_x,
        "chord with second should render noteheads at different x positions, got {:?}",
        noteheads
    );
}

#[test]
fn displaced_cluster_reserves_space_before_next_onset() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "16th"}, "stemDirection": "up", "notes": [
                {"pitch": {"step": "C", "octave": 5}},
                {"pitch": {"step": "D", "octave": 5}}
            ]},
            {"duration": {"base": "16th"}, "notes": [
                {"pitch": {"step": "E", "octave": 5}}
            ]},
            {"duration": {"base": "half", "dots": 1}, "rest": {}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let measures = resolve_measures(&score, 0);
    let ml = layout_measure(&measures[0], config.sp, 0.0, &config, None, &[], 1.0);
    let events = ml.voice_layouts[0].events_vec();
    let onset_gap_sp = (events[1].x - events[0].x) / config.sp;
    let required_sp = config.min_note_spacing + 2.0 * config.notehead_rx;
    assert!(
        onset_gap_sp + 1.0e-6 >= required_sp,
        "next onset gap={onset_gap_sp:.3}sp must clear displaced cluster extent; required={required_sp:.3}sp"
    );

    let spacing = build_log_spacing_for_part_measure(
        &score.parts[0].measures[0],
        4.0,
        0.25,
        &config,
        &KeySignature::default(),
    );
    let compressed_width = spacing.rigid_total * config.sp;
    let compressed_gap_sp = (spacing.lookup_x(0.25, compressed_width, 0.0)
        - spacing.lookup_x(0.0, compressed_width, 0.0))
        / config.sp;
    assert!(
        compressed_gap_sp + 1.0e-6 >= required_sp,
        "compressed next-onset gap={compressed_gap_sp:.3}sp must preserve rigid cluster clearance={required_sp:.3}sp"
    );
}
