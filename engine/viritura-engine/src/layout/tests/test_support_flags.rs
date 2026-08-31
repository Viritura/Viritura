// Tests for MNX support flags (useBeams, useAccidentalDisplay)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;

// ═══════════════════════════════════════════
// useBeams flag tests
// ═══════════════════════════════════════════

#[test]
fn test_use_beams_true_no_explicit_beams_produces_flags() {
    // useBeams=true but no beams[] declared → notes should have flags, no beam polygons
    let json = r#"{
        "mnx": {"version": 1, "support": {"useBeams": true}},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "ev2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ev3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ev4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"id": "ev5", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"id": "ev6", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                {"id": "ev7", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"id": "ev8", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have flag glyphs (notes are unbeamed)
    let flags = dl.commands.iter().filter(|c| is_flag_glyph(c)).count();
    assert!(
        flags > 0,
        "useBeams=true with no beams[] should produce flags, got {}",
        flags
    );

    // Should NOT have beam polygons
    let beams = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        beams, 0,
        "useBeams=true with no beams[] should produce no beam polygons, got {}",
        beams
    );
}

#[test]
fn test_use_beams_false_no_explicit_beams_produces_auto_beams() {
    // useBeams=false (or absent) without beams[] → auto-beam should occur
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "ev2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ev3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ev4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have beam polygons (auto-beamed)
    let beams = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        beams > 0,
        "Without useBeams, eighth notes should be auto-beamed, got {} beam polygons",
        beams
    );

    // Should NOT have flag glyphs (beamed notes don't get flags)
    let flags = dl.commands.iter().filter(|c| is_flag_glyph(c)).count();
    assert_eq!(
        flags, 0,
        "Auto-beamed notes should not have flags, got {}",
        flags
    );
}

#[test]
fn test_auto_beams_work_without_event_ids_with_articulations() {
    // Default beaming should still work when events omit IDs (as in Storybook helpers).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "eighth"}, "markings": {"accent": {}}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"strongAccent": {}}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"staccato": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"staccatissimo": {}}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"tenuto": {}}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"spiccato": {}}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"stress": {}}, "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"unstress": {}}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beams = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        beams > 0,
        "ID-less eighth notes should still auto-beam, got {} beam polygons",
        beams
    );

    let flags = dl.commands.iter().filter(|c| is_flag_glyph(c)).count();
    assert_eq!(
        flags, 0,
        "Auto-beamed eighth notes should not render flags, got {}",
        flags
    );
}

#[test]
fn test_use_beams_true_with_explicit_beams_still_works() {
    // useBeams=true with explicit beams[] → should render those beams
    let json = r#"{
        "mnx": {"version": 1, "support": {"useBeams": true}},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{"events": ["ev1", "ev2", "ev3", "ev4"]}],
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "ev2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ev3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ev4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have beam polygons
    let beams = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        beams > 0,
        "useBeams=true with explicit beams should produce beam polygons, got {}",
        beams
    );
}

// ═══════════════════════════════════════════
// useAccidentalDisplay flag tests
// ═══════════════════════════════════════════

#[test]
fn test_use_accidental_display_true_only_shows_explicit() {
    // useAccidentalDisplay=true: only notes with accidentalDisplay.show=true get accidentals
    // F#4 without accidentalDisplay should NOT show accidental
    // G#4 with accidentalDisplay.show=true should show accidental
    let json = r#"{
        "mnx": {"version": 1, "support": {"useAccidentalDisplay": true}},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have exactly 1 accidental (only the explicit one)
    let accs = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    assert_eq!(
        accs, 1,
        "useAccidentalDisplay=true should show only explicit accidentals, got {}",
        accs
    );
}

#[test]
fn test_use_accidental_display_false_auto_computes() {
    // Without useAccidentalDisplay (default): F#4 should auto-show accidental since
    // it differs from C major key signature (no sharps)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4, "alter": 1}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Both sharps should auto-display (they differ from C major)
    let accs = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    assert_eq!(
        accs, 2,
        "Without useAccidentalDisplay, both sharps should auto-display, got {}",
        accs
    );
}

#[test]
fn test_use_accidental_display_true_natural_explicit() {
    // useAccidentalDisplay=true in D major (2 sharps): C natural needs explicit accidentalDisplay.
    // Key signature draws 2 sharps, plus 1 explicit natural = 3 accidental glyphs total.
    let json = r#"{
        "mnx": {"version": 1, "support": {"useAccidentalDisplay": true}},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}, "accidentalDisplay": {"show": true}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // 2 key-signature sharps + 1 explicit natural = 3 total accidental glyphs.
    // Without useAccidentalDisplay the second C would also auto-show a natural (4 total).
    let accs = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    assert_eq!(
        accs, 3,
        "useAccidentalDisplay=true: 2 key sig sharps + 1 explicit natural, got {}",
        accs
    );
}

#[test]
fn test_use_accidental_display_false_natural_auto() {
    // Without useAccidentalDisplay in D major: both C naturals should auto-show a natural sign
    // because they deviate from the key (D major has C#).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // 2 key-signature sharps + naturals for C notes (auto-computed).
    // In auto mode, the first C5 shows a natural. The second C5 same pitch/octave/alter
    // is suppressed (already shown). So: 2 key sig + 1 auto natural = 3.
    let accs = dl
        .commands
        .iter()
        .filter(|c| is_accidental_glyph(c))
        .count();
    assert_eq!(
        accs, 3,
        "Without useAccidentalDisplay in D major: 2 key sig + 1 auto natural, got {}",
        accs
    );
}

// ═══════════════════════════════════════════
// Model parsing tests
// ═══════════════════════════════════════════

#[test]
fn test_support_flags_parse() {
    let json = r#"{
        "mnx": {"version": 1, "support": {"useAccidentalDisplay": true, "useBeams": true}},
        "global": {"measures": [{}]},
        "parts": [{"measures": [{"sequences": []}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let support = score.mnx.support.as_ref().unwrap();
    assert_eq!(support.use_accidental_display, Some(true));
    assert_eq!(support.use_beams, Some(true));
}

#[test]
fn test_support_flags_absent() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{}]},
        "parts": [{"measures": [{"sequences": []}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    assert!(score.mnx.support.is_none());
}

#[test]
fn test_support_partial_flags() {
    let json = r#"{
        "mnx": {"version": 1, "support": {"useBeams": true}},
        "global": {"measures": [{}]},
        "parts": [{"measures": [{"sequences": []}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let support = score.mnx.support.as_ref().unwrap();
    assert_eq!(support.use_beams, Some(true));
    assert_eq!(support.use_accidental_display, None);
}
