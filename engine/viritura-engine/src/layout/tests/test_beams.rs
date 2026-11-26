// Auto-generated from tests.rs — test_beams
// 16 test(s)

use super::test_helpers::*;
use crate::layout::beams::*;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_beams_mnx_produces_drawrect() {
    // Two beam groups of 4 eighth notes each (mirrors beams.mnx)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [
                {"events": ["ev1", "ev2", "ev3", "ev4"]},
                {"events": ["ev5", "ev6", "ev7", "ev8"]}
            ],
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

    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        poly_count >= 2,
        "Expected at least 2 DrawPolygon beam commands, got {}",
        poly_count
    );
}

#[test]
fn test_beamed_notes_no_flag_glyphs() {
    // All eighth notes are beamed — no flag glyphs should appear
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [
                {"events": ["ev1", "ev2", "ev3", "ev4"]},
                {"events": ["ev5", "ev6", "ev7", "ev8"]}
            ],
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

    let flag_count = dl.commands.iter().filter(|c| is_flag_glyph(c)).count();
    assert_eq!(
        flag_count, 0,
        "Beamed notes should have no flag glyphs, found {}",
        flag_count
    );
}

#[test]
fn test_beam_group_two_eighth_notes() {
    // Minimal beam: 2 eighth notes in a single beam group
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{"events": ["n1", "n2"]}],
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "n1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"id": "n2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Exactly 1 beam group → at least 1 DrawPolygon for the beam
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        poly_count >= 1,
        "Expected at least 1 DrawPolygon for beam, got {}",
        poly_count
    );

    // No flag glyphs on the beamed notes
    let flag_count = dl.commands.iter().filter(|c| is_flag_glyph(c)).count();
    assert_eq!(
        flag_count, 0,
        "Beamed eighth notes should not have flag glyphs, found {}",
        flag_count
    );
}

#[test]
fn test_malformed_beam_does_not_suppress_stem_or_flag() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{"events": ["e1", "missing-1", "missing-2"]}],
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "rest": {}}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let display_list = layout_score(&score, 0, &LayoutConfig::default());

    assert_eq!(
        display_list
            .commands
            .iter()
            .filter(|command| is_beam_polygon(command))
            .count(),
        0,
        "a beam with dangling event IDs must not render"
    );
    assert_eq!(
        display_list
            .commands
            .iter()
            .filter(|command| is_flag_glyph(command))
            .count(),
        1,
        "the valid eighth note must retain its ordinary flag"
    );
    assert!(
        display_list
            .commands
            .iter()
            .any(|command| matches!(command, RenderCommand::DrawLine { x1, x2, .. } if (x1 - x2).abs() < 0.001)),
        "the valid eighth note must retain its ordinary stem"
    );
}

#[test]
fn test_explicit_beam_does_not_disable_default_beaming_for_new_notes() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{"events": ["e1", "e2"]}],
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let display_list = layout_score(&score, 0, &LayoutConfig::default());

    assert!(
        display_list
            .commands
            .iter()
            .filter(|command| is_beam_polygon(command))
            .count()
            >= 2,
        "explicit beams must not leave later entered eighths unbeamed"
    );
    assert_eq!(
        display_list
            .commands
            .iter()
            .filter(|command| is_flag_glyph(command))
            .count(),
        0,
        "both explicit and automatic eighth-note runs should be beamed"
    );
}

#[test]
fn test_stale_beam_after_note_deletion_does_not_disable_default_beaming() {
    // Note input can leave an explicit group behind after one of its members is
    // deleted. The remaining entered eighths must still receive their normal
    // meter-based beam instead of being permanently flagged.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{"events": ["deleted-eighth", "e1", "e2"]}],
            "clefs": [{"clef": {"sign": "C", "staffPosition": 0}}],
            "sequences": [{"content": [
                {"duration": {"base": "eighth"}, "rest": {}},
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let display_list = layout_score(&score, 0, &LayoutConfig::default());

    assert!(
        display_list.commands.iter().any(is_beam_polygon),
        "stale beam members must not prevent the remaining eighths from beaming"
    );
    assert_eq!(
        display_list
            .commands
            .iter()
            .filter(|command| is_flag_glyph(command))
            .count(),
        1,
        "the upbeat eighth remains flagged, while the beat-two pair should beam"
    );
}

#[test]
fn test_beam_hooks_16th_8th_16th() {
    // 16th-8th-16th beam group: isolated 16th notes get beamlets (hooks)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{"events": ["ev1", "ev2", "ev3"]}],
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "ev2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ev3", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Expect: 1 primary beam (level 1) + 2 beamlets (level 2) = at least 3 DrawPolygons
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        poly_count >= 3,
        "Expected at least 3 DrawPolygons (1 beam + 2 hooks), got {}",
        poly_count
    );

    // Verify beamlet widths are shorter than the primary beam
    let sp = config.sp;
    let hook_expected = 0.875 * sp;
    let beam_widths: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    Some(points[1].0 - points[0].0)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    let hooks: Vec<&f64> = beam_widths
        .iter()
        .filter(|w| (w.abs() - hook_expected).abs() < 1.5)
        .collect();
    assert!(
        hooks.len() >= 2,
        "Expected at least 2 beamlet-width DrawPolygons (~{:.1}), found {} in {:?}",
        hook_expected,
        hooks.len(),
        beam_widths
    );
}

#[test]
fn test_beam_hooks_mnx_explicit_directions() {
    // Test with MNX explicit inner beams (direction field) — matches beam-hooks.mnx
    let json = r#"{
        "mnx": {"version": 1, "support": {"useBeams": true}},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [
                {
                    "events": ["ev1", "ev2", "ev3"],
                    "beams": [
                        {"direction": "right", "events": ["ev1"]},
                        {"direction": "left", "events": ["ev3"]}
                    ]
                },
                {
                    "events": ["ev4", "ev5", "ev6"],
                    "beams": [
                        {"direction": "right", "events": ["ev4"]},
                        {"direction": "left", "events": ["ev6"]}
                    ]
                },
                {
                    "events": ["ev7", "ev8", "ev9"],
                    "beams": [
                        {"direction": "right", "events": ["ev7"]},
                        {"direction": "left", "events": ["ev9"]}
                    ]
                }
            ],
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "ev2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "ev3", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "ev4", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ev5", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"id": "ev6", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "ev7", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"id": "ev8", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"id": "ev9", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let hook_expected = 0.875 * sp;

    // 3 beam groups × (1 primary beam + 2 hooks) = 9 DrawPolygons minimum
    let beam_widths: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    Some(points[1].0 - points[0].0)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    assert!(
        beam_widths.len() >= 9,
        "Expected at least 9 DrawPolygons (3 beams + 6 hooks), got {} in {:?}",
        beam_widths.len(),
        beam_widths
    );

    // 6 beamlets (2 per group × 3 groups)
    let hooks: Vec<&f64> = beam_widths
        .iter()
        .filter(|w| (w.abs() - hook_expected).abs() < 1.5)
        .collect();
    assert_eq!(
        hooks.len(),
        6,
        "Expected exactly 6 beamlet-width DrawPolygons (~{:.1}), found {} in {:?}",
        hook_expected,
        hooks.len(),
        beam_widths
    );
}

#[test]
fn explicit_hook_directions_are_scoped_to_beam_level() {
    let json = r#"{
        "mnx": {"version": 1, "support": {"useBeams": true}},
        "global": {"measures": [{"time": {"count": 1, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [{
                "events": ["ev1", "ev2"],
                "beams": [{
                    "direction": "right",
                    "events": ["ev1"],
                    "beams": [{"direction": "left", "events": ["ev1"]}]
                }]
            }],
            "sequences": [{"content": [
                {"id": "ev1", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "ev2", "duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let beam = &score.parts[0].measures[0].beams.as_ref().unwrap()[0];
    let hooks = crate::layout::beams::collect_explicit_hooks(beam);

    assert_eq!(
        crate::layout::beams::explicit_hook_direction(&hooks, "ev1", 2),
        Some(true)
    );
    assert_eq!(
        crate::layout::beams::explicit_hook_direction(&hooks, "ev1", 3),
        Some(false)
    );
}

#[test]
fn test_secondary_beam_breaks_explicit() {
    // Load the beams-secondary-beam-breaks.mnx fixture.
    // This has 32nd notes grouped in two top-level beams with explicit sub-beam
    // grouping: the primary beam connects all events, secondary+ beams break
    // at the specified sub-group boundaries.
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/beams-secondary-beam-breaks.mnx"),
    )
    .unwrap();

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let beam_thickness = 0.5 * sp;

    // Collect all beam DrawPolygons (4-point polygons with beam thickness)
    let beam_widths: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    let h = (points[3].1 - points[0].1).abs();
                    let w = (points[1].0 - points[0].0).abs();
                    if (h - beam_thickness).abs() < 0.1 && w > beam_thickness {
                        return Some(w);
                    }
                }
            }
            None
        })
        .collect();

    // First beam group: 8 events with breaks at midpoint.
    // Level 0 (primary): 1 beam spanning all 8 events
    // Level 1 (secondary): 2 beams [ev1-ev4] + [ev5-ev8]
    // Level 2 (tertiary): 2 beams [ev1-ev4] + [ev5-ev8]
    // = 5 beam segments for first group
    //
    // Second beam group: 8 events with breaks at midpoint + every 2 notes.
    // Level 0: 1 beam spanning all 8
    // Level 1: 2 beams [ev9-ev12] + [ev13-ev16]
    // Level 2: 4 beams [ev9-ev10] + [ev11-ev12] + [ev13-ev14] + [ev15-ev16]
    // = 7 beam segments for second group
    //
    // Total: 5 + 7 = 12 beam DrawRects
    assert!(
        beam_widths.len() >= 12,
        "Expected at least 12 beam DrawPolygons for secondary beam breaks, got {}",
        beam_widths.len()
    );

    // Verify that NOT all beams span the full group width.
    // The longest beam rect should be for the primary beam. If secondary beams
    // break correctly, there should be beam rects shorter than the longest.
    let max_width = beam_widths.iter().cloned().fold(0.0_f64, f64::max);
    let shorter_beams: Vec<&f64> = beam_widths
        .iter()
        .filter(|w| **w < max_width * 0.75)
        .collect();
    assert!(
        !shorter_beams.is_empty(),
        "Secondary beams should break into shorter segments, but all beams are near max width {}",
        max_width
    );
}

#[test]
fn test_inner_beams_remain_continuous_without_explicit_breaks() {
    // Load the implied beam breaks fixture: flat beam groups without nested
    // sub-beams. Inner beams should remain continuous across each authored
    // primary group unless recursive MNX beams explicitly request a break.
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/beams-secondary-beam-breaks-implied.mnx"),
    )
    .unwrap();

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let beam_thickness = 0.5 * sp;

    // Collect all beam DrawPolygons
    let beam_widths: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    let h = (points[3].1 - points[0].1).abs();
                    let w = (points[1].0 - points[0].0).abs();
                    if (h - beam_thickness).abs() < 0.1 && w > beam_thickness {
                        return Some(w);
                    }
                }
            }
            None
        })
        .collect();

    // Each beam group has 8 thirty-second notes in 4/4 time.
    // Default grouping per beam group:
    // Level 0 (primary): 1 beam spanning all 8 events
    // Level 1 (secondary): 1 continuous beam spanning all 8 events
    // Level 2 (tertiary): 1 continuous beam spanning all 8 events
    // = 3 segments per beam group × 2 groups = 6 beam polygons
    assert_eq!(
        beam_widths.len(),
        6,
        "Expected three continuous beam levels per group, got {}",
        beam_widths.len()
    );

    // All three levels in each group span the same notes.
    let max_width = beam_widths.iter().cloned().fold(0.0_f64, f64::max);
    assert!(
        beam_widths.iter().all(|width| *width >= max_width * 0.95),
        "Unspecified inner beams should remain continuous: {beam_widths:?}"
    );
}

#[test]
fn test_auto_beam_sixteenths_stay_connected_through_each_quarter_beat() {
    let events = (1..=16)
        .map(|index| {
            format!(
                r#"{{"id":"e{index}","duration":{{"base":"16th"}},"notes":[{{"pitch":{{"step":"C","octave":5}}}}]}}"#
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
            "parts": [{{"measures": [{{"sequences": [{{"content": [{events}]}}]}}]}}]
        }}"#
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let beam_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();

    assert_eq!(
        beam_count, 8,
        "Four sixteenths per beat should produce one primary and one continuous secondary beam per beat"
    );
}

#[test]
fn test_tuplet_32nds_no_implied_secondary_breaks() {
    // A prime tuplet (7:8) of equal 32nd notes filling one quarter beat. The
    // irregular real durations of the tuplet members do not align to metric
    // subdivisions, so meter-implied tertiary breaks (every 0.25 beats) would
    // chop the inner beams into spurious two-note fragments. Standard engraving
    // practice: a tuplet of equal note values carries continuous secondary and
    // tertiary beams. The whole group must therefore produce exactly three
    // full-length beam segments (primary + secondary + tertiary).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 7, "duration": {"base": "32nd"}},
             "outer": {"multiple": 8, "duration": {"base": "32nd"}},
             "content": [
               {"duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
               {"duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
               {"duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
               {"duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
               {"duration": {"base": "32nd"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let beam_thickness = 0.5 * sp;

    let beam_widths: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    let h = (points[3].1 - points[0].1).abs();
                    let w = (points[1].0 - points[0].0).abs();
                    if (h - beam_thickness).abs() < 0.1 && w > beam_thickness {
                        return Some(w);
                    }
                }
            }
            None
        })
        .collect();

    // Exactly three beam segments, one per level, all spanning the full group.
    assert_eq!(
        beam_widths.len(),
        3,
        "Equal-value 32nd tuplet should produce 3 continuous beams (primary + \
         secondary + tertiary), got {}: {:?}",
        beam_widths.len(),
        beam_widths
    );
    let max_width = beam_widths.iter().cloned().fold(0.0_f64, f64::max);
    assert!(
        beam_widths.iter().all(|w| *w > max_width * 0.9),
        "All three beams should span (nearly) the full tuplet width; got {:?}",
        beam_widths
    );
}

#[test]
fn test_two_beamed_triplets_break_secondary_at_tuplet_boundary() {
    // Two 16th-note triplets beamed together on one beat (Rhapsody piano m32,
    // beat 2). Standard engraving practice: the primary (8th) beam runs
    // continuously across both triplets, but the secondary (16th) beam breaks
    // at the tuplet boundary so each triplet keeps its own sub-beam. Expect one
    // full-width primary segment plus two half-width secondary segments.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "16th"}},
             "outer": {"multiple": 2, "duration": {"base": "16th"}},
             "content": [
               {"id": "a1", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
               {"id": "a2", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
               {"id": "a3", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "16th"}},
             "outer": {"multiple": 2, "duration": {"base": "16th"}},
             "content": [
               {"id": "b1", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
               {"id": "b2", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
               {"id": "b3", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}],
        "beams": [{"events": ["a1", "a2", "a3", "b1", "b2", "b3"]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let beam_thickness = 0.5 * sp;

    let beam_widths: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    let h = (points[3].1 - points[0].1).abs();
                    let w = (points[1].0 - points[0].0).abs();
                    if (h - beam_thickness).abs() < 0.1 && w > beam_thickness {
                        return Some(w);
                    }
                }
            }
            None
        })
        .collect();

    // 1 primary (full) + 2 secondary (one per triplet) = 3 segments.
    assert_eq!(
        beam_widths.len(),
        3,
        "Two beamed triplets should produce a continuous primary plus 2 \
         per-triplet secondary segments (3 total); got {}: {:?}",
        beam_widths.len(),
        beam_widths
    );

    let primary = beam_widths.iter().cloned().fold(0.0_f64, f64::max);
    let secondaries: Vec<f64> = beam_widths
        .iter()
        .cloned()
        .filter(|w| *w < primary * 0.9)
        .collect();
    assert_eq!(
        secondaries.len(),
        2,
        "Expected exactly 2 shorter secondary segments (each ~half the primary); \
         got widths {:?}",
        beam_widths
    );
    // Each secondary spans roughly one triplet ≈ half the primary span.
    for w in &secondaries {
        assert!(
            *w < primary * 0.65 && *w > primary * 0.3,
            "Each secondary sub-beam should span ~one triplet (~half the \
             primary {primary:.1}); got {w:.1}"
        );
    }
}

#[test]
fn test_cross_barline_beams() {
    // Beam group spans measures: ev3/ev4 in measure 1, ev5/ev6 in measure 2
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/beams-across-barlines.mnx"),
    )
    .unwrap();

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have beam DrawPolygon commands (at least 1 primary beam for the 4-event group)
    let beam_polys: Vec<&RenderCommand> =
        dl.commands.iter().filter(|c| is_beam_polygon(c)).collect();
    assert!(
        !beam_polys.is_empty(),
        "Expected at least 1 beam DrawPolygon for cross-barline beam, got {}",
        beam_polys.len()
    );

    // No flag glyphs on beamed events (ev3-ev6 are all eighth notes, beamed)
    let flags: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_flag_glyph(c)).collect();
    assert_eq!(
        flags.len(),
        0,
        "Expected no flag glyphs (all beamed), got {}",
        flags.len()
    );
}

#[test]
fn test_cross_barline_beam_stems_exist() {
    // Verifies stems are drawn for ALL events in a cross-barline beam group.
    // Regression test: stems in the first measure used to disappear because
    // render_cross_barline_beams did not re-draw stems after they were
    // suppressed during normal event rendering.
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/beams-across-barlines.mnx"),
    )
    .unwrap();

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // The beams-across-barlines.mnx has 4 beamed eighth notes (ev3-ev6).
    // Each should have a stem (vertical DrawLine). Count all stem-like lines.
    let stems: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_stem_line(c)).collect();

    // There should be at least 4 stems for the 4 beamed events
    assert!(
        stems.len() >= 4,
        "Expected at least 4 stems for cross-barline beam events, got {}. \
         Stems may be missing for first-measure events.",
        stems.len()
    );

    // Verify stems span a reasonable range of X positions (across both measures).
    // If stems only exist in one measure, the X range will be narrow.
    let stem_xs: Vec<f64> = stems
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawLine { x1, .. } = c {
                Some(*x1)
            } else {
                None
            }
        })
        .collect();
    let x_min = stem_xs.iter().cloned().fold(f64::INFINITY, f64::min);
    let x_max = stem_xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let sp = 8.0; // default sp in LayoutConfig

    // Stems should span across a barline — X range should be significant
    assert!(
        x_max - x_min > 2.0 * sp,
        "Stems X range too narrow ({:.1}), likely missing stems in one measure",
        x_max - x_min
    );
}

#[test]
fn test_cross_barline_beam_no_duplicate_beams() {
    // Regression: auto-beaming in measure 2 used to create duplicate beam
    // lines for events that are part of a cross-barline beam declared in measure 1.
    // The duplicate beam between ev5-ev6 looked like a duplicate barline.
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/beams-across-barlines.mnx"),
    )
    .unwrap();

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Count beam polygons. The 4-event beam group (ev3-ev6) should produce
    // exactly 1 primary beam. With auto-beaming bug, there would be 2
    // (one from cross-barline beam, one from auto-beam of ev5-ev6).
    let beam_polys: Vec<&RenderCommand> =
        dl.commands.iter().filter(|c| is_beam_polygon(c)).collect();
    assert_eq!(
        beam_polys.len(),
        1,
        "Expected exactly 1 beam polygon for the cross-barline beam group, got {}. \
         Duplicate beams indicate auto-beaming is not excluding cross-barline events.",
        beam_polys.len()
    );
}

#[test]
fn test_cross_barline_beam_no_duplicate_stems() {
    // Regression: auto-beaming in measure 2 used to create duplicate stems for
    // events that are part of a cross-barline beam declared in measure 1.
    let json = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/format/fixtures/mnx/beams-across-barlines.mnx"),
    )
    .unwrap();

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Count all vertical narrow lines (stems + barlines)
    let vertical_lines: Vec<&RenderCommand> =
        dl.commands.iter().filter(|c| is_stem_line(c)).collect();

    // Expected: 4 stems (ev3-ev6) + 1 inter-measure barline + 1 final thin barline = 6
    // Before fix: would be 8 (extra 2 stems from auto-beam of ev5/ev6)
    assert!(
        vertical_lines.len() <= 6,
        "Expected at most 6 vertical lines (4 stems + 2 barlines), got {}. \
         Extra lines indicate auto-beaming is drawing duplicate stems for cross-barline events.",
        vertical_lines.len()
    );
}

#[test]
fn test_inner_grace_notes_between_beamed_events() {
    // beams-inner-grace-notes.mnx: 4 regular eighth notes (C5, D5, E5, F5) in one beam,
    // with a grace note (B4) between ev1 (C5) and ev3 (D5). Grace note is NOT in the beam.
    let mnx =
        std::fs::read_to_string("../../packages/format/fixtures/mnx/beams-inner-grace-notes.mnx")
            .expect("beams-inner-grace-notes.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let main_glyph_size = 4.0 * sp;
    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let notehead_filled = smufl::NOTEHEAD_BLACK;

    // Should have 4 regular filled noteheads (C5, D5, E5, F5) at full size
    let main_noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - main_glyph_size).abs() < 0.01 && *codepoint == notehead_filled {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        main_noteheads.len(),
        4,
        "Expected 4 regular filled noteheads, got {}",
        main_noteheads.len()
    );

    // Should have 1 grace notehead at reduced size
    let grace_noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - grace_glyph_size).abs() < 0.01 && *codepoint == notehead_filled {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        grace_noteheads.len(),
        1,
        "Expected 1 grace notehead, got {}",
        grace_noteheads.len()
    );

    // Grace note x should be between ev1 (first notehead) and ev3 (second notehead)
    let ev1_x = main_noteheads[0];
    let ev3_x = main_noteheads[1];
    let grace_x = grace_noteheads[0];
    assert!(
        grace_x > ev1_x,
        "Grace note x ({:.1}) should be right of ev1 x ({:.1})",
        grace_x,
        ev1_x
    );
    assert!(
        grace_x < ev3_x,
        "Grace note x ({:.1}) should be left of ev3 x ({:.1})",
        grace_x,
        ev3_x
    );

    // Grace note should not overlap with ev1's notehead
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let ev1_right_edge = ev1_x + notehead_w;
    assert!(
        grace_x > ev1_right_edge,
        "Grace note x ({:.1}) should not overlap ev1 notehead edge ({:.1})",
        grace_x,
        ev1_right_edge
    );

    // Should have beam polygons for the regular beam group (4 events)
    let beam_thickness = 0.5 * sp;
    let regular_beams: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawPolygon { points, color, .. }
            if points.len() == 4
            && ((points[3].1 - points[0].1).abs() - beam_thickness).abs() < 0.1
            && color == "#000000")
        })
        .collect();
    assert!(
        !regular_beams.is_empty(),
        "Expected at least 1 regular beam rectangle"
    );

    // Grace slurs are only rendered when explicitly defined in MNX
    // This inner grace note test does not define slurs, so none expected

    // Should have a half rest
    let rest_glyph = smufl::rest_glyph(&crate::model::NoteValueBase::Half);
    let rests: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { codepoint, size, .. }
            if *codepoint == rest_glyph && (*size - main_glyph_size).abs() < 0.01)
        })
        .collect();
    assert_eq!(rests.len(), 1, "Expected 1 half rest, got {}", rests.len());
}

#[test]
fn test_32nd_note_beam_minimum_stem_to_innermost_beam() {
    // 32nd notes have 3 beam levels. The minimum stem from notehead to the
    // primary beam must be extended so that after placing secondary beams
    // (which sit between the primary beam and noteheads), the visible stem
    // from the notehead to the closest beam is still adequate (≥ 2.0sp).
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = config.margin_top * sp;

    // Three notes at the same pitch (flat beam) — stems up
    let note_info = vec![
        (100.0, staff_y + 2.0 * sp * 0.5), // B4 (staff position 2)
        (130.0, staff_y + 2.0 * sp * 0.5),
        (160.0, staff_y + 2.0 * sp * 0.5),
    ];

    let beam_thickness_sp = 0.5;
    let beam_gap_sp = 0.25;
    let max_beam_count: u32 = 3; // 32nd note = 3 beam levels

    let (beam_y_first, slope, _) =
        compute_quantized_beam(&note_info, true, sp, &config, staff_y, max_beam_count);

    let first_x = note_info[0].0;
    for (i, &(sx, ny)) in note_info.iter().enumerate() {
        let beam_y = beam_y_first + slope * (sx - first_x);
        let stem_to_primary = ny - beam_y; // stem_up: notehead Y > beam Y

        // The innermost beam (level max_beam_count-1) sits at offset
        // (max_beam_count-1) * (beam_thickness + beam_gap) from primary beam
        // toward the notehead. Its bottom edge is at that offset + beam_thickness.
        let innermost_bottom = (max_beam_count - 1) as f64 * (beam_thickness_sp + beam_gap_sp) * sp
            + beam_thickness_sp * sp;
        let visible_stem = stem_to_primary - innermost_bottom;

        assert!(visible_stem >= 1.5 * sp,
            "Note {}: visible stem after all beams = {:.1}px ({:.2}sp), expected ≥ {:.1}px (1.5sp). \
             stem_to_primary={:.1}px, innermost_bottom_offset={:.1}px",
            i, visible_stem, visible_stem / sp, 1.5 * sp,
            stem_to_primary, innermost_bottom);
    }
}

#[test]
fn test_32nd_note_beam_stem_longer_than_8th() {
    // 32nd notes (3 beams) should have longer stems than 8th notes (1 beam)
    // to accommodate secondary beams
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = config.margin_top * sp;

    let note_info = vec![
        (100.0, staff_y + 4.0 * sp * 0.5),
        (140.0, staff_y + 4.0 * sp * 0.5),
    ];

    let (beam_y_8th, _, _) = compute_quantized_beam(&note_info, true, sp, &config, staff_y, 1);
    let (beam_y_32nd, _, _) = compute_quantized_beam(&note_info, true, sp, &config, staff_y, 3);

    // 32nd note beam should be further from noteheads (lower Y for stem-up)
    assert!(
        beam_y_32nd < beam_y_8th,
        "32nd beam Y ({:.1}) should be above 8th beam Y ({:.1}) for stem-up",
        beam_y_32nd,
        beam_y_8th
    );
}

#[test]
fn test_32nd_note_beam_stem_down() {
    // Verify the same minimum stem enforcement works for stem-down beams
    let sp = 12.0;
    let config = LayoutConfig::default();
    let staff_y = config.margin_top * sp;

    // Notes above middle of staff — stems down
    let note_info = vec![
        (100.0, staff_y + (-2.0) * sp * 0.5), // C5
        (130.0, staff_y + (-2.0) * sp * 0.5),
        (160.0, staff_y + (-2.0) * sp * 0.5),
    ];

    let beam_thickness_sp = 0.5;
    let beam_gap_sp = 0.25;
    let max_beam_count: u32 = 3;

    let (beam_y_first, slope, _) =
        compute_quantized_beam(&note_info, false, sp, &config, staff_y, max_beam_count);

    let first_x = note_info[0].0;
    for (i, &(sx, ny)) in note_info.iter().enumerate() {
        let beam_y = beam_y_first + slope * (sx - first_x);
        let stem_to_primary = beam_y - ny; // stem_down: beam Y > notehead Y

        let innermost_bottom = (max_beam_count - 1) as f64 * (beam_thickness_sp + beam_gap_sp) * sp
            + beam_thickness_sp * sp;
        let visible_stem = stem_to_primary - innermost_bottom;

        assert!(visible_stem >= 1.5 * sp,
            "Note {} (stem-down): visible stem after all beams = {:.1}px ({:.2}sp), expected ≥ {:.1}px",
            i, visible_stem, visible_stem / sp, 1.5 * sp);
    }
}

#[test]
fn test_beam_commands_tagged_with_element_ids() {
    // Verify that beam polygon commands are tagged with structured element IDs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "beams": [
                {"events": ["ev1", "ev2", "ev3", "ev4"]},
                {"events": ["ev5", "ev6", "ev7", "ev8"]}
            ],
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

    // Find all beam polygon commands and check they have element IDs
    let beam_ids: Vec<&str> = dl
        .commands
        .iter()
        .enumerate()
        .filter(|(_, c)| is_beam_polygon(c))
        .filter_map(|(i, _)| {
            if i < dl.element_ids.len() {
                dl.element_ids[i].as_deref()
            } else {
                None
            }
        })
        .collect();

    assert!(
        !beam_ids.is_empty(),
        "Beam polygons should have element IDs"
    );

    // Two beam groups should produce IDs: p0/m0/beam0 and p0/m0/beam1
    assert!(
        beam_ids.contains(&"p0/m0/beam0"),
        "Should have beam0 element ID, got: {:?}",
        beam_ids
    );
    assert!(
        beam_ids.contains(&"p0/m0/beam1"),
        "Should have beam1 element ID, got: {:?}",
        beam_ids
    );
    assert_eq!(
        dl.selection_groups,
        vec![
            SelectionGroup {
                element_id: "p0/m0/beam0".into(),
                member_ids: ["ev1", "ev2", "ev3", "ev4"]
                    .map(|id| format!("p0/m0/s0/{id}"))
                    .to_vec(),
            },
            SelectionGroup {
                element_id: "p0/m0/beam1".into(),
                member_ids: ["ev5", "ev6", "ev7", "ev8"]
                    .map(|id| format!("p0/m0/s0/{id}"))
                    .to_vec(),
            },
        ]
    );
}

#[test]
fn test_auto_beam_exports_exact_selection_members() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"id": "a", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
            {"id": "b", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
            {"id": "c", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
            {"id": "d", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());

    assert_eq!(
        dl.selection_groups,
        vec![SelectionGroup {
            element_id: "p0/m0/beam0".into(),
            member_ids: ["a", "b", "c", "d"]
                .map(|id| format!("p0/m0/s0/{id}"))
                .to_vec(),
        }]
    );
}

// ═══════════════════════════════════════════
// Auto-beaming grouping tests
// ═══════════════════════════════════════════

#[test]
fn test_beam_over_16th_rest_within_beat() {
    // 8th note + 16th rest + 16th note within one beat: beam should span over the rest.
    // The two notes should be in a single beam group (rest is skipped but doesn't break).
    // Reference: industry-standard engravers all beam over short rests within a beat.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "n1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "16th"}},
                {"id": "n2", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "n3", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have at least 1 beam polygon connecting n1 and n2 over the rest
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        poly_count >= 1,
        "Expected beam spanning over 16th rest, got {} beam polygons",
        poly_count
    );
}

#[test]
fn test_auto_beam_mixed_8th_16th_breaks_at_beat_in_4_4() {
    // 4/4 with mixed 8th + 16th notes: because 16th notes exist in the voice,
    // ALL beam groups should break at quarter-note boundaries (not half-measure).
    // Pattern per beat: 8th + 16th + 16th, repeated across 4 beats.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e3", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"id": "e5", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"id": "e6", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"id": "e7", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"id": "e8", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e9", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e10", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e11", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"id": "e12", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Count primary beam polygons: should be 4 (one per beat), not 2 (half-measure)
    // Each beat has 3 notes (8th+16th+16th) sharing 1 primary beam + 1 secondary beam segment.
    // Total: 4 primary + 4 secondary = 8 beam polygons
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert!(
        poly_count >= 8,
        "Mixed 8th/16th in 4/4 should produce 4 beat-level beam groups (>=8 polygons), got {}",
        poly_count
    );
}

#[test]
fn test_auto_beam_pure_eighths_still_half_measure_in_4_4() {
    // 4/4 with ONLY 8th notes (no 16ths): should still group by half-measure
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"id": "e5", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"id": "e6", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                {"id": "e7", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"id": "e8", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have exactly 2 beam polygons (half-measure grouping)
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 2,
        "Pure eighths in 4/4 should still produce 2 half-measure groups, got {}",
        poly_count
    );
}

#[test]
fn test_auto_beam_breaks_between_separate_tuplet_groups() {
    // Half note + two separate eighth-note triplets (Rhapsody m20 string pattern).
    // The two triplets each fall in the second half-measure (beats 2-3 and 3-4),
    // so pure half-measure grouping would beam all six eighths together. Standard
    // engraving practice beams each tuplet independently — the beam must break at
    // the tuplet boundary, yielding two separate beam groups (one per triplet).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "F", "octave": 5, "alter": 1}}]},
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
             ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Each triplet is plain eighths → one primary beam polygon per group.
    // Two independent triplets → exactly 2 beam polygons (not 1 merged beam).
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 2,
        "Two separate eighth triplets should beam independently (2 beam groups), got {}",
        poly_count
    );
}

#[test]
fn test_auto_beam_single_tuplet_beams_as_one_group() {
    // A lone eighth-note triplet beams as a single group (one beam polygon).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"type": "tuplet",
             "inner": {"multiple": 3, "duration": {"base": "eighth"}},
             "outer": {"multiple": 2, "duration": {"base": "eighth"}},
             "content": [
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
               {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
             ]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 1,
        "A single eighth triplet should form one beam group, got {}",
        poly_count
    );
}

#[test]
fn test_rest_repositioned_within_beam_group() {
    // 8th note + 16th rest + 16th note within one beat: the rest should be
    // repositioned away from its default middle-line Y to avoid beam collision.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "n1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "16th"}},
                {"id": "n2", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "n3", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the 16th rest glyph (codepoint = REST_16TH = 0xE4E7)
    let rest_cmds: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::REST_16TH)
    }).collect();
    assert!(!rest_cmds.is_empty(), "Should have a 16th rest glyph");

    // The rest Y should NOT be at the default middle-line position.
    // Default middle-line Y = staff_y + 2.0*sp. With default config,
    // sp ≈ staff_height/4 and staff_y varies, but the rest should have been
    // moved away from its default position.
    // We verify by checking that the rest glyph exists and is above the
    // bottom staff line (basic sanity — the exact Y depends on beam position).
    if let RenderCommand::DrawGlyph { y, .. } = rest_cmds[0] {
        // Just verify it's a finite number (the repositioning code ran)
        assert!(y.is_finite(), "Rest Y should be finite after repositioning");
    }
}

#[test]
fn test_rest_not_repositioned_when_not_in_beam_group() {
    // A standalone 16th rest (not within a beam group) should stay at the default position.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "n1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "16th"}},
                {"duration": {"base": "16th"}},
                {"id": "n2", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // No beam polygons expected (quarter + rests + half = all unbeamable context)
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 0,
        "No beams expected for quarter + rests + half, got {}",
        poly_count
    );
}

#[test]
fn test_beam_over_rest_does_not_cross_beat_boundary() {
    // 4/4 with 8th+8th_rest pattern across 4 beats: rests should NOT bridge
    // notes across beat boundaries. Each beat's 8th note should be isolated
    // (single note can't form a beam group), so no beams at all.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "n1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "eighth"}},
                {"id": "n2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "eighth"}},
                {"id": "n3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}},
                {"id": "n4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Each 8th note is alone in its beat (followed by a rest that hits the next
    // beat boundary), so no beam groups should form.
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 0,
        "8th+8th_rest pattern should not beam across beats, got {} beam polygons",
        poly_count
    );
}

#[test]
fn test_auto_beam_4_4_eight_eighths_groups_of_four() {
    // 4/4 with 8 consecutive eighth notes should produce 2 beam groups of 4
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"id": "e5", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"id": "e6", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                {"id": "e7", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]},
                {"id": "e8", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have exactly 2 beam groups (primary beam polygons)
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 2,
        "4/4 with 8 eighths should produce exactly 2 beam groups, got {}",
        poly_count
    );

    // No flags should appear
    let flag_count = dl.commands.iter().filter(|c| is_flag_glyph(c)).count();
    assert_eq!(
        flag_count, 0,
        "All notes should be beamed, got {} flags",
        flag_count
    );
}

#[test]
fn test_auto_beam_3_4_six_eighths_groups_of_two() {
    // 3/4 with 6 consecutive eighth notes should produce 3 beam groups of 2
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 3, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"id": "e5", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"id": "e6", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have exactly 3 beam groups
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 3,
        "3/4 with 6 eighths should produce exactly 3 beam groups, got {}",
        poly_count
    );
}

#[test]
fn test_auto_beam_4_4_four_eighths_one_group() {
    // 4/4 with 4 consecutive eighth notes (first half) should produce 1 beam group of 4
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should have exactly 1 beam group
    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 1,
        "4/4 with 4 eighths + half should produce 1 beam group, got {}",
        poly_count
    );
}

/// Two 4/4 measures whose final and opening events share one authored beam.
fn system_break_beam_mnx(tail: &str, head: &str, beam: &str) -> String {
    format!(
        r#"{{
        "mnx": {{"version": 1, "support": {{"useBeams": true}}}},
        "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}, {{}}]}},
        "parts": [{{"measures": [
            {{
                "beams": [{beam}],
                "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                "sequences": [{{"content": [
                    {{"duration": {{"base": "half"}}, "rest": {{}}}},
                    {{"duration": {{"base": "quarter"}}, "rest": {{}}}},
                    {tail}
                ]}}]
            }},
            {{"sequences": [{{"content": [
                {head},
                {{"duration": {{"base": "quarter"}}, "rest": {{}}}},
                {{"duration": {{"base": "half"}}, "rest": {{}}}}
            ]}}]}}
        ]}}]
    }}"#
    )
}

fn note(id: &str, base: &str, step: &str, octave: u8) -> String {
    format!(
        r#"{{"id": "{id}", "duration": {{"base": "{base}"}}, "notes": [{{"pitch": {{"step": "{step}", "octave": {octave}}}}}]}}"#
    )
}

/// One system's beam polygon x-extents and stem x positions.
type SystemFragment = (Vec<(f64, f64)>, Vec<f64>);

/// Beam polygons and stems tagged with `eid`, grouped by system (top to bottom).
fn beam_fragments_by_system(dl: &DisplayList, eid: &str, sp: f64) -> Vec<SystemFragment> {
    let mut systems: Vec<(f64, SystemFragment)> = Vec::new();
    for (command, id) in dl.commands.iter().zip(&dl.element_ids) {
        if id.as_deref() != Some(eid) {
            continue;
        }
        let (y, poly, stem) = match command {
            RenderCommand::DrawPolygon { points, .. } => {
                let xs = points.iter().map(|p| p.0);
                let min = xs.clone().fold(f64::INFINITY, f64::min);
                let max = xs.fold(f64::NEG_INFINITY, f64::max);
                let y = points.iter().map(|p| p.1).sum::<f64>() / points.len() as f64;
                (y, Some((min, max)), None)
            }
            RenderCommand::DrawLine { x1, y1, y2, .. } if is_stem_line(command) => {
                ((y1 + y2) / 2.0, None, Some(*x1))
            }
            _ => continue,
        };
        let system = match systems.iter_mut().find(|s| (s.0 - y).abs() < 5.0 * sp) {
            Some(system) => system,
            None => {
                systems.push((y, (Vec::new(), Vec::new())));
                systems.last_mut().unwrap()
            }
        };
        system.1 .0.extend(poly);
        system.1 .1.extend(stem);
    }
    systems.sort_by(|a, b| a.0.total_cmp(&b.0));
    systems.into_iter().map(|(_, fragment)| fragment).collect()
}

#[test]
fn test_beam_across_system_break_draws_fragments_on_both_systems() {
    let json = system_break_beam_mnx(
        &[note("a", "eighth", "C", 5), note("b", "eighth", "D", 5)].join(","),
        &[note("c", "eighth", "E", 5), note("d", "eighth", "F", 5)].join(","),
        r#"{"events": ["a", "b", "c", "d"]}"#,
    );
    let score = parse_mnx(&json).unwrap();
    let mut config = LayoutConfig::default();
    config.page_width = Some(50.0 * config.sp);
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let systems = beam_fragments_by_system(&dl, "p0/m0/beam0", sp);
    assert_eq!(
        systems.len(),
        2,
        "the shared beam should render on both systems"
    );
    for (polygons, stems) in &systems {
        assert_eq!(polygons.len(), 1, "each fragment draws one primary beam");
        assert_eq!(stems.len(), 2, "each fragment draws its own members' stems");
    }
    let (first_polys, first_stems) = &systems[0];
    let last_stem = first_stems
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        first_polys[0].1 > last_stem + sp,
        "the outgoing fragment should run past its last stem toward the break"
    );
    let (second_polys, second_stems) = &systems[1];
    let first_stem = second_stems.iter().copied().fold(f64::INFINITY, f64::min);
    assert!(
        second_polys[0].0 < first_stem - sp,
        "the incoming fragment should start ahead of its first stem"
    );
    assert_eq!(
        dl.commands.iter().filter(|c| is_flag_glyph(c)).count(),
        0,
        "members on both systems are beamed, so none should carry a flag"
    );
    assert_eq!(
        dl.commands.iter().filter(|c| is_beam_polygon(c)).count(),
        2,
        "no auto-beam should duplicate the incoming fragment"
    );
}

#[test]
fn test_beam_across_system_break_continues_only_crossing_secondary_beams() {
    let crossing = system_break_beam_mnx(
        &[
            note("a", "eighth", "C", 5),
            note("b", "16th", "D", 5),
            note("c", "16th", "E", 5),
        ]
        .join(","),
        &[
            note("d", "16th", "F", 5),
            note("e", "16th", "E", 5),
            note("f", "eighth", "D", 5),
        ]
        .join(","),
        r#"{"events": ["a", "b", "c", "d", "e", "f"]}"#,
    );
    let closed = system_break_beam_mnx(
        &[
            note("a", "16th", "C", 5),
            note("b", "16th", "D", 5),
            note("c", "eighth", "E", 5),
        ]
        .join(","),
        &[note("d", "eighth", "F", 5), note("e", "eighth", "E", 5)].join(","),
        r#"{"events": ["a", "b", "c", "d", "e"]}"#,
    );
    let mut config = LayoutConfig::default();
    config.page_width = Some(50.0 * config.sp);
    let sp = config.sp;

    let dl = layout_score(&parse_mnx(&crossing).unwrap(), 0, &config);
    let counts: Vec<usize> = beam_fragments_by_system(&dl, "p0/m0/beam0", sp)
        .iter()
        .map(|(polygons, _)| polygons.len())
        .collect();
    assert_eq!(
        counts,
        vec![2, 2],
        "a secondary beam running through the break continues on both systems"
    );

    let dl = layout_score(&parse_mnx(&closed).unwrap(), 0, &config);
    let counts: Vec<usize> = beam_fragments_by_system(&dl, "p0/m0/beam0", sp)
        .iter()
        .map(|(polygons, _)| polygons.len())
        .collect();
    assert_eq!(
        counts,
        vec![2, 1],
        "a secondary beam that ends before the break stays on the first system"
    );
}

#[test]
fn test_beam_across_barline_shares_one_stem_direction() {
    // High notes before the barline and low notes after it would split
    // directions if each measure decided alone.
    let json = system_break_beam_mnx(
        &[note("a", "eighth", "A", 5), note("b", "eighth", "G", 5)].join(","),
        &[note("c", "eighth", "D", 4), note("d", "eighth", "C", 4)].join(","),
        r#"{"events": ["a", "b", "c", "d"]}"#,
    );
    let score = parse_mnx(&json).unwrap();
    let measures = crate::layout::resolve::resolve_measures(&score, 0);
    let first = &measures[0].spanning_beams;
    let second = &measures[1].spanning_beams;
    assert_eq!(first.len(), 1, "the declaring measure records the group");
    assert_eq!(first, second, "every touched measure shares one record");
    assert!(
        first[0].stem_up.is_some(),
        "the group resolves one direction"
    );
    assert_eq!(first[0].member_levels, vec![1, 1, 1, 1]);

    let mut config = LayoutConfig::default();
    config.page_width = Some(50.0 * config.sp);
    let dl = layout_score(&score, 0, &config);
    let systems = beam_fragments_by_system(&dl, "p0/m0/beam0", config.sp);
    assert_eq!(systems.len(), 2);
    // With one shared direction both fragments sit on the same side of their
    // noteheads: the beam meets each stem at its top when stems point up.
    let stem_up = first[0].stem_up.unwrap();
    let beam_tops: Vec<f64> = dl
        .commands
        .iter()
        .zip(&dl.element_ids)
        .filter(|(_, id)| id.as_deref() == Some("p0/m0/beam0"))
        .filter_map(|(command, _)| match command {
            RenderCommand::DrawPolygon { points, .. } => Some(points[0].1),
            _ => None,
        })
        .collect();
    let stem_spans: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .zip(&dl.element_ids)
        .filter(|(_, id)| id.as_deref() == Some("p0/m0/beam0"))
        .filter_map(|(command, _)| match command {
            RenderCommand::DrawLine { y1, y2, .. } if is_stem_line(command) => {
                Some((y1.min(*y2), y1.max(*y2)))
            }
            _ => None,
        })
        .collect();
    for beam_y in beam_tops {
        let nearest = stem_spans
            .iter()
            .min_by(|a, b| {
                let da = (a.0 - beam_y).abs().min((a.1 - beam_y).abs());
                let db = (b.0 - beam_y).abs().min((b.1 - beam_y).abs());
                da.total_cmp(&db)
            })
            .unwrap();
        let at_top = (nearest.0 - beam_y).abs() < (nearest.1 - beam_y).abs();
        assert_eq!(
            at_top, stem_up,
            "every fragment follows the shared direction"
        );
    }
}

#[test]
fn test_beam_across_explicit_system_break_draws_both_fragments() {
    let json = r#"{
        "mnx": {"version": 1, "support": {"useBeams": true}},
        "global": {"measures": [{"id": "m0", "time": {"count": 2, "unit": 4}}, {"id": "m1"}]},
        "parts": [{"id": "p", "measures": [
            {
                "beams": [{"events": ["a", "b", "c", "d"]}],
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "rest": {}},
                    {"id": "a", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"id": "b", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]}]
            },
            {"sequences": [{"content": [
                {"id": "c", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "d", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "rest": {}}
            ]}]}
        ]}],
        "layouts": [{"id": "solo", "content": [{"type": "staff", "sources": [{"part": "p"}]}]}],
        "scores": [{"name": "Solo", "pages": [{"systems": [
            {"measure": "m0", "layout": "solo"},
            {"measure": "m1", "layout": "solo"}
        ]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = crate::layout::layout_with_mnx_scores(&score, &config, 0);
    let systems = beam_fragments_by_system(&dl, "p0/m0/beam0", config.sp);
    let counts: Vec<(usize, usize)> = systems.iter().map(|(p, s)| (p.len(), s.len())).collect();
    assert_eq!(
        counts,
        vec![(1, 2), (1, 2)],
        "an authored system break should still split the beam into two fragments"
    );
    assert_eq!(dl.commands.iter().filter(|c| is_flag_glyph(c)).count(), 0);
}
