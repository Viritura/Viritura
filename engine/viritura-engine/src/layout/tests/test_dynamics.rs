// Auto-generated from tests.rs — test_dynamics
// 2 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores};
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_dynamics_render_glyphs() {
    // Load dynamics.mnx: ff at position 0/1, ppp at position 3/4
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/dynamics.mnx"
    ))
    .expect("Failed to read dynamics.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse dynamics.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all dynamics glyph codepoints emitted (range U+E520-U+E54F)
    let dyn_glyphs: Vec<(f64, f64, u32)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = cmd
            {
                if (0xE520..=0xE54F).contains(codepoint) {
                    return Some((*x, *y, *codepoint));
                }
            }
            None
        })
        .collect();

    // Should have exactly 2 dynamics glyphs (ff and ppp)
    assert_eq!(
        dyn_glyphs.len(),
        2,
        "Expected 2 dynamics glyphs, got {}: {:?}",
        dyn_glyphs.len(),
        dyn_glyphs
    );

    // First: ff (U+E52F)
    assert_eq!(
        dyn_glyphs[0].2,
        smufl::DYNAMIC_FF,
        "First dynamic should be ff"
    );
    // Second: ppp (U+E52A)
    assert_eq!(
        dyn_glyphs[1].2,
        smufl::DYNAMIC_PPP,
        "Second dynamic should be ppp"
    );

    // Both should be at least dynamics_min_distance below staff bottom
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    let min_y = staff_bottom + config.dynamics_min_distance * sp;
    for (i, &(_, y, _)) in dyn_glyphs.iter().enumerate() {
        assert!(
            y >= min_y - 0.01,
            "Dynamic {} at y={:.1} should be at least {:.1}sp below staff bottom (min_y={:.1})",
            i,
            y,
            config.dynamics_min_distance,
            min_y
        );
    }

    // ppp (at beat 3/4) should be to the right of ff (at beat 0/1)
    assert!(
        dyn_glyphs[1].0 > dyn_glyphs[0].0,
        "ppp x={} should be right of ff x={}",
        dyn_glyphs[1].0,
        dyn_glyphs[0].0
    );

    // Both dynamics should have the same Y (vertically aligned within a measure)
    assert!(
        (dyn_glyphs[0].1 - dyn_glyphs[1].1).abs() < 0.01,
        "Dynamics should be vertically aligned: ff y={:.1}, ppp y={:.1}",
        dyn_glyphs[0].1,
        dyn_glyphs[1].1
    );
}

#[test]
fn test_voice_linked_dynamics_use_separate_voice_sides() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "dynamics": [
                {"id": "upper", "type": "immediate", "position": {"fraction": [0, 1]},
                 "value": "f", "voice": "v1"},
                {"id": "lower", "type": "immediate", "position": {"fraction": [0, 1]},
                 "value": "p", "voice": "v2"}
            ],
            "sequences": [
                {"voice": "v1", "content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}
                ]},
                {"voice": "v2", "content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                ]}
            ]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let dynamic_y = |id: &str| {
        dl.commands
            .iter()
            .zip(dl.element_ids.iter())
            .find_map(|(command, element_id)| {
                if element_id.as_deref() != Some(id) {
                    return None;
                }
                match command {
                    RenderCommand::DrawGlyph { y, .. } => Some(*y),
                    _ => None,
                }
            })
            .expect("dynamic glyph")
    };
    let staff_y = config.margin_top * config.sp;
    let staff_bottom = staff_y + 4.0 * config.sp;

    assert!(
        dynamic_y("p0/m0/dynupper") < staff_y,
        "voice 1 dynamic should engrave above the staff"
    );
    assert!(
        dynamic_y("p0/m0/dynlower") > staff_bottom,
        "voice 2 dynamic should engrave below the staff"
    );
}

#[test]
fn test_rhapsody_rehearsal_29_violin_dynamics_are_voice_linked() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx");
    let score = parse_mnx(json).expect("parse Rhapsody");
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 29);
    let measure = dl
        .measure_bounds
        .iter()
        .find(|bounds| bounds.index == 320 && bounds.part_index == 28)
        .expect("Violin I rehearsal-29 bounds");
    let dynamic_y = |id: &str| {
        dl.commands
            .iter()
            .zip(dl.element_ids.iter())
            .find_map(|(command, element_id)| {
                if element_id.as_deref() != Some(id) {
                    return None;
                }
                match command {
                    RenderCommand::DrawGlyph { y, .. } => Some(*y),
                    _ => None,
                }
            })
            .expect("dynamic glyph")
    };

    assert!(
        dynamic_y("p28/m320/dyn9240fa02-e49f-79a2-8428-3b7df375c355") > measure.y + measure.height,
        "fp linked to v2 must engrave below the staff"
    );
    assert!(
        dynamic_y("p28/m320/dyn0ca712ff-c63c-7a43-9c5c-04f02e8ff3ea") < measure.y,
        "f linked to v1 must engrave above the staff"
    );
}

#[test]
fn test_custom_dynamic_glyph_override() {
    // Build a minimal score with a dynamic that uses a custom glyph override
    let json = r#"{
        "mnx": { "version": 1 },
        "global": {
            "measures": [
                { "time": { "count": 4, "unit": 4 } }
            ]
        },
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        { "type": "event", "duration": { "base": "whole" },
                          "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }
                    ]
                }],
                "dynamics": [{
                    "position": { "fraction": [0, 1] },
                    "type": "accent",
                    "value": "f",
                    "glyphs": ["dynamicSforzando1"]
                }]
            }]
        }]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse custom dynamic glyph MNX");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should render the sforzando glyph (U+E536) instead of failing
    let sfz_glyphs: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::DYNAMIC_SFORZANDO1)
    }).collect();
    assert_eq!(
        sfz_glyphs.len(),
        1,
        "Expected 1 sforzando1 glyph from custom glyph override"
    );
}

#[test]
fn test_dynamic_affixes_niente_and_stable_group_id() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "id": "m1", "time": { "count": 4, "unit": 4 } }] },
        "parts": [{ "measures": [{
            "sequences": [{ "content": [{ "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }] }],
            "dynamics": [{
                "id": "dynamic-stable-id",
                "position": { "fraction": [0, 1] },
                "type": "immediate",
                "value": "n",
                "prefix": "quasi",
                "suffix": "subito"
            }]
        }] }]
    }"#;
    let score = parse_mnx(json).expect("Failed to parse affixed niente dynamic");
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let expected_id = "p0/m0/dyndynamic-stable-id";

    assert!(dl.commands.iter().any(|command| {
        matches!(command, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::DYNAMIC_NIENTE)
    }));
    for text in ["quasi", "subito"] {
        assert!(dl.commands.iter().any(|command| {
            matches!(command, RenderCommand::DrawText { text: rendered, .. } if rendered == text)
        }), "missing dynamic affix {text}");
    }
    assert!(dl.element_ids.iter().flatten().any(|id| id == expected_id));
    let bbox = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == expected_id)
        .expect("stable dynamic bbox");
    assert!(bbox.bbox.width > 4.0 * LayoutConfig::default().sp);
}

#[test]
fn test_dynamic_orient_above_places_glyph_above_staff() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "id": "m1", "time": { "count": 4, "unit": 4 } }] },
        "parts": [{ "measures": [{
            "sequences": [{ "content": [{ "duration": { "base": "whole" }, "rest": {} }] }],
            "dynamics": [{
                "id": "above-dynamic",
                "type": "immediate",
                "position": { "fraction": [0, 1] },
                "value": "f",
                "orient": "above"
            }]
        }] }]
    }"#;
    let score = parse_mnx(json).expect("parse above dynamic");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let staff_y = config.margin_top * config.sp;
    let y = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph { y, codepoint, .. } if *codepoint == smufl::DYNAMIC_FORTE => {
                Some(*y)
            }
            _ => None,
        })
        .expect("forte glyph");
    assert!(
        y < staff_y,
        "above dynamic baseline {y} must be above staff top {staff_y}"
    );
}

#[test]
fn test_custom_clef_glyph_deserialization() {
    // Test that Clef with a glyph field deserializes correctly
    let json = r#"{ "sign": "G", "staffPosition": -2, "glyph": "gClef8vb" }"#;
    let clef: Clef = serde_json::from_str(json).expect("Failed to parse Clef with glyph");
    assert_eq!(clef.sign, ClefSign::G);
    assert_eq!(clef.staff_position, -2);
    assert_eq!(clef.glyph.as_deref(), Some("gClef8vb"));
}

#[test]
fn test_clef_glyph_none_by_default() {
    let json = r#"{ "sign": "F", "staffPosition": 2 }"#;
    let clef: Clef = serde_json::from_str(json).expect("Failed to parse Clef without glyph");
    assert_eq!(clef.sign, ClefSign::F);
    assert_eq!(clef.staff_position, 2);
    assert!(clef.glyph.is_none());
}

#[test]
fn test_dynamics_no_overlap_with_stems() {
    // Load dynamics.mnx and verify dynamics don't overlap with stem tips
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/dynamics.mnx"
    ))
    .expect("Failed to read dynamics.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse dynamics.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    // Find lowest stem tip below the staff (down-stem lines ending below staff_bottom)
    let mut lowest_stem_below_staff = staff_bottom;
    for cmd in &dl.commands {
        if let RenderCommand::DrawLine { y1, y2, width, .. } = cmd {
            // Stems are thin vertical lines (~0.12sp wide)
            if (*width - config.stem_width * sp).abs() < 0.5 {
                let bottom = y1.max(*y2);
                if bottom > lowest_stem_below_staff {
                    lowest_stem_below_staff = bottom;
                }
            }
        }
    }

    // Get dynamics Y
    let dyn_y: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if (0xE520..=0xE54F).contains(codepoint) {
                    return Some(*y);
                }
            }
            None
        })
        .collect();

    // Dynamics should be at or below lowest_stem + padding
    for (i, &y) in dyn_y.iter().enumerate() {
        assert!(
            y >= lowest_stem_below_staff + config.dynamics_padding * sp - 0.01,
            "Dynamic {} at y={:.1} should be below lowest stem at y={:.1} + {:.1}sp padding",
            i,
            y,
            lowest_stem_below_staff,
            config.dynamics_padding
        );
    }
}

#[test]
fn test_dynamics_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/dynamics.mnx"
    ))
    .expect("Failed to read dynamics.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse dynamics.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // element_ids should be populated (tagging was applied)
    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated"
    );

    // Find element IDs matching "dyn"
    let dynamic_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/dyn"))
        .collect();
    assert_eq!(
        dynamic_ids.len(),
        2,
        "Expected 2 dynamic element IDs (ff and ppp), got {}: {:?}",
        dynamic_ids.len(),
        dynamic_ids
    );

    // Verify format: p{part}/m{measure}/dyn{index}
    assert!(
        dynamic_ids[0].starts_with("p0/m0/dyn"),
        "First dynamic ID should start with p0/m0/dyn, got {}",
        dynamic_ids[0]
    );
}

/// Localized collision avoidance: a dynamic at beat 0 should NOT be pushed
/// far below the staff just because a down-stem note exists at beat 3.
/// This tests the fix for the "Violin 1 dynamics too far away" bug where
/// collision avoidance scanned the entire measure instead of only nearby events.
#[test]
fn test_dynamics_localized_collision_far_downstem() {
    // Beat 0: high note (up-stem, no collision) with ff dynamic
    // Beat 3: very low note (A3 in treble = many ledger lines, down-stem extends far below staff)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}
            ]}],
            "dynamics": [{"type": "immediate", "value": "ff", "position": {"fraction": [0, 1]}}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    // The dynamic at beat 0 should be at (or very near) the minimum distance,
    // NOT pushed far down by the A3 down-stem at beat 3.
    let min_dynamics_y = staff_bottom + config.dynamics_min_distance * sp;

    let dyn_glyphs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if (0xE520..=0xE54F).contains(codepoint) {
                    return Some(*y);
                }
            }
            None
        })
        .collect();

    assert_eq!(dyn_glyphs.len(), 1, "Expected 1 dynamics glyph");
    // Should be close to min_dynamics_y (within 1sp tolerance — NOT pushed far down)
    let tolerance = 1.0 * sp;
    assert!(
        dyn_glyphs[0] < min_dynamics_y + tolerance,
        "Dynamic at beat 0 should be near min distance ({:.1}), not pushed far down by \
         distant down-stem. Got y={:.1}, max expected={:.1}",
        min_dynamics_y,
        dyn_glyphs[0],
        min_dynamics_y + tolerance
    );
}

/// When a dynamic is directly under a down-stem note, it SHOULD be pushed down.
#[test]
fn test_dynamics_collision_with_overlapping_downstem() {
    // A single low note at beat 0 with a dynamic at beat 0: should collide
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}
            ]}],
            "dynamics": [{"type": "immediate", "value": "ff", "position": {"fraction": [0, 1]}}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    let min_dynamics_y = staff_bottom + config.dynamics_min_distance * sp;

    let dyn_y: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if (0xE520..=0xE54F).contains(codepoint) {
                    return Some(*y);
                }
            }
            None
        })
        .collect();

    assert_eq!(dyn_y.len(), 1, "Expected 1 dynamics glyph");
    // A3 in treble clef is well below the staff → down-stem extends further.
    // Dynamic should be pushed below the minimum distance.
    assert!(
        dyn_y[0] > min_dynamics_y + 0.5 * sp,
        "Dynamic under a low A3 down-stem should be pushed below min distance ({:.1}). Got y={:.1}",
        min_dynamics_y,
        dyn_y[0]
    );
}

/// Dynamics bbox Y should match the rendered glyph Y position.
#[test]
fn test_dynamics_bbox_matches_glyph_y() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}
            ]}],
            "dynamics": [{"type": "immediate", "value": "f", "position": {"fraction": [0, 1]}}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Find the rendered glyph Y
    let glyph_y = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if (0xE520..=0xE54F).contains(codepoint) {
                    return Some(*y);
                }
            }
            None
        })
        .expect("Should have a dynamics glyph");

    // Find the bbox
    let dyn_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.starts_with("p0/m0/dyn"))
        .expect("Should have dynamics bbox");

    // The bbox should be computed from glyph_bbox applied at the same Y.
    // For dynamicForte (0xE522), bbox.y_offset = -1.776sp, height = 2.384sp.
    // At glyph_size = 4*sp, scale = sp. So bbox.y = glyph_y + (-1.776 * sp).
    let (_, by, _, bh) = smufl::glyph_bbox(smufl::DYNAMIC_FORTE);
    let expected_top = glyph_y + by * sp;
    let expected_height = bh * sp;

    assert!(
        (dyn_bbox.bbox.y - expected_top).abs() < 1.0,
        "Bbox top ({:.1}) should be near expected ({:.1})",
        dyn_bbox.bbox.y,
        expected_top
    );
    assert!(
        (dyn_bbox.bbox.height - expected_height).abs() < 1.0,
        "Bbox height ({:.1}) should be near expected ({:.1})",
        dyn_bbox.bbox.height,
        expected_height
    );
}

/// For parts with only up-stems (like trombones), dynamics should sit at the
/// minimum distance below the staff, not pushed down excessively.
#[test]
fn test_dynamics_min_distance_with_upstem_notes() {
    // All notes at or above middle line → up-stems, nothing below staff
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}],
            "dynamics": [{"type": "immediate", "value": "ff", "position": {"fraction": [0, 1]}}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    let min_dynamics_y = staff_bottom + config.dynamics_min_distance * sp;

    let dyn_y = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if (0xE520..=0xE54F).contains(codepoint) {
                    return Some(*y);
                }
            }
            None
        })
        .expect("Should have a dynamics glyph");

    // Should be exactly at min distance (no collision avoidance needed)
    assert!(
        (dyn_y - min_dynamics_y).abs() < 0.5 * sp,
        "Dynamic with up-stem notes should be at min distance ({:.1}). Got y={:.1}",
        min_dynamics_y,
        dyn_y
    );
}

/// Render the dynamic so its optical (ink) centre lands on the actual notehead
/// centre, regardless of note value. A whole notehead (1.66sp) is wider than a
/// black/half notehead (1.18sp); using a fixed width would push dynamics under
/// whole/half notes ~0.24sp to the left of centre, making centring look
/// inconsistent next to dynamics on shorter notes.
#[test]
fn test_dynamic_centered_on_whole_notehead() {
    for value in ["p", "mf", "f", "ff", "fp", "sfz"] {
        let dynamic = match value {
            "fp" => r#"{"type":"accent","accentPrefix":"","value":"f","residualValue":"p","accentSuffix":"","position":{"fraction":[0,1]}}"#.to_owned(),
            "sfz" => r#"{"type":"accent","value":"f","position":{"fraction":[0,1]}}"#.to_owned(),
            _ => format!(r#"{{"type":"immediate","value":"{value}","position":{{"fraction":[0,1]}}}}"#),
        };
        let json = format!(
            r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
            "parts": [{{"measures": [{{
                "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                "sequences": [{{"content": [
                    {{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "B", "octave": 4}}}}]}}
                ]}}],
                "dynamics": [{dynamic}]
            }}]}}]
        }}"#
        );
        let score = parse_mnx(&json).unwrap();
        let config = LayoutConfig::default();
        let dl = layout_score(&score, 0, &config);
        let sp = config.sp;

        // Left edge (origin) of the whole notehead glyph.
        let note_x = dl
            .commands
            .iter()
            .find_map(|cmd| {
                if let RenderCommand::DrawGlyph { x, codepoint, .. } = cmd {
                    if *codepoint == smufl::NOTEHEAD_WHOLE {
                        return Some(*x);
                    }
                }
                None
            })
            .expect("Should have a whole notehead");
        // Left edge (origin) of the dynamic glyph.
        let dyn_x = dl
            .commands
            .iter()
            .find_map(|cmd| {
                if let RenderCommand::DrawGlyph { x, codepoint, .. } = cmd {
                    if (0xE520..=0xE54F).contains(codepoint) {
                        return Some(*x);
                    }
                }
                None
            })
            .expect("Should have a dynamics glyph");

        // Actual whole-notehead centre.
        let head_w = smufl::notehead_width(smufl::NOTEHEAD_WHOLE) * sp;
        let note_center = note_x + head_w * 0.5;

        // The dynamic's optical (ink) centre = origin + optical_center.
        let optical_center = smufl::dynamics_optical_center(value) * sp;
        let ink_center = dyn_x + optical_center;

        // Ink centre must align with the whole-notehead centre (within 0.05sp).
        assert!(
            (ink_center - note_center).abs() < 0.05 * sp,
            "{value}: ink centre {:.2} should align with whole-notehead centre {:.2} (diff {:.3}sp)",
            ink_center,
            note_center,
            (ink_center - note_center) / sp
        );

        // Guard against regression to the old fixed 1.18sp notehead width, which
        // would centre the dynamic ~0.24sp to the left of the whole notehead.
        let old_center = note_x + 1.18 * sp * 0.5;
        assert!(
            (note_center - old_center).abs() > 0.2 * sp,
            "test precondition: whole notehead centre should differ from the old fixed-width centre"
        );
    }
}

/// A dynamic below the staff must clear an articulation that occupies the same
/// space. An accent under a stem-up note lands below the notehead, exactly where
/// a below-staff dynamic wants to sit; standard engraving practice keeps the
/// dynamic clear of the articulation, so it is pushed further down. (Models
/// Rhapsody in Blue m40: stem-up chord with an accent and a `p` dynamic.)
#[test]
fn test_dynamic_clears_accent_articulation() {
    let make = |with_accent: bool| {
        let markings = if with_accent {
            r#", "markings": {"accent": {}}"#
        } else {
            ""
        };
        let json = format!(
            r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
            "parts": [{{"measures": [{{
                "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                "sequences": [{{"content": [
                    {{"duration": {{"base": "quarter"}}, "stemDirection": "up",
                      "notes": [
                        {{"pitch": {{"step": "C", "octave": 4, "alter": 1}}}},
                        {{"pitch": {{"step": "A", "octave": 3}}}}
                      ]{markings}}},
                    {{"duration": {{"base": "quarter"}}, "rest": {{}}}},
                    {{"duration": {{"base": "half"}}, "rest": {{}}}}
                ]}}],
                "dynamics": [{{"type": "immediate", "value": "p", "position": {{"fraction": [0, 1]}}}}]
            }}]}}]
        }}"#
        );
        let score = parse_mnx(&json).unwrap();
        let config = LayoutConfig::default();
        let dl = layout_score(&score, 0, &config);
        let sp = config.sp;

        let dyn_y = dl
            .commands
            .iter()
            .find_map(|cmd| {
                if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                    if (0xE520..=0xE54F).contains(codepoint) {
                        return Some(*y);
                    }
                }
                None
            })
            .expect("Should have a dynamics glyph");
        (dl, dyn_y, sp)
    };

    let (_, dyn_y_plain, sp) = make(false);
    let (dl_accent, dyn_y_accent, _) = make(true);

    // The accent (U+E4A1, accentBelow) must have been emitted below the staff.
    let accent_bottom = dl_accent
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                y, codepoint, size, ..
            } = cmd
            {
                if *codepoint == smufl::ARTIC_ACCENT_BELOW {
                    let glyph_sp = size / 4.0;
                    let (_, by, _, bh) = smufl::glyph_bbox(*codepoint);
                    return Some(y + (by + bh) * glyph_sp);
                }
            }
            None
        })
        .expect("Should have an accentBelow articulation glyph");

    // With the accent present, the dynamic is pushed further down than it would
    // be with no articulation in the way.
    assert!(
        dyn_y_accent > dyn_y_plain + 0.25 * sp,
        "accented dynamic (y={dyn_y_accent:.1}) should sit lower than the un-accented one (y={dyn_y_plain:.1})"
    );

    // And the dynamic's baseline must clear the accent's bottom edge.
    assert!(
        dyn_y_accent > accent_bottom,
        "dynamic baseline (y={dyn_y_accent:.1}) should be below the accent bottom edge (y={accent_bottom:.1})"
    );
}

/// A rhythmic position's `fraction` is expressed in whole-note units per the
/// MNX spec (`[1, 4]` = one quarter note from the start), independent of the
/// active time signature. In a 2/4 measure the dynamic and the hairpin end at
/// `[1, 4]` must therefore align with the note one quarter into the bar (its
/// "beat 2"), NOT halfway through where `fraction * measure_beats` would land.
/// (Models Rhapsody in Blue rehearsal 38: a 2/4 bar with `< fz` on beat 2.)
#[test]
fn test_dynamic_and_hairpin_position_independent_of_meter() {
    // 2/4 bar: quarter note (beat 1), eighth note (beat 2), eighth rest.
    // The fz dynamic and the crescendo's end sit at fraction [1, 4] = beat 2,
    // which is the second (eighth) note's onset.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 2, "unit": 4},
            "id": "m1"
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 6}}]},
                {"duration": {"base": "eighth"}, "id": "n2",
                 "notes": [{"pitch": {"step": "D", "octave": 6, "alter": 1}}]},
                {"duration": {"base": "eighth"}, "rest": {}}
            ]}],
                        "dynamics": [
                            {"type": "accent", "value": "f", "glyphs": ["dynamicForzando"], "position": {"fraction": [1, 4]}},
                            {"type": "gradual",
                "position": {"fraction": [0, 1]},
                                "end": {"measure": "m1", "position": {"fraction": [1, 4]}},
                                "wedgeType": "increasing"}
                        ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // X of the second note's notehead (D#6, beat 2). It is the second notehead
    // glyph emitted (the first event is the quarter E6).
    let notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_BLACK =>
            {
                Some(*x)
            }
            _ => None,
        })
        .collect();
    assert_eq!(notehead_xs.len(), 2, "Expected two black noteheads");
    let beat2_x = notehead_xs[1];

    // The fz dynamic's optical centre must align with the beat-2 notehead centre,
    // not with a meter-scaled (halfway) position.
    let dyn_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if (0xE520..=0xE54F).contains(codepoint) =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have a dynamics glyph");
    let head_w = smufl::notehead_width(smufl::NOTEHEAD_BLACK) * sp;
    let note_center = beat2_x + head_w * 0.5;
    let ink_center = dyn_x + smufl::dynamics_optical_center("fz") * sp;
    assert!(
        (ink_center - note_center).abs() < 0.5 * sp,
        "fz ink centre ({ink_center:.1}) should align with beat-2 notehead centre ({note_center:.1}), \
         not a meter-scaled position"
    );

    // The crescendo hairpin must END at the beat-2 note, not halfway. The wedge
    // is drawn as two converging lines; its rightmost x is the open mouth at the
    // end position. Take the max line x.
    let hairpin_right = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { x1, x2, .. } => Some(x1.max(*x2)),
            _ => None,
        })
        .fold(f64::NEG_INFINITY, f64::max);
    // The end should reach at least to the beat-2 note position (within a small
    // tolerance). A meter-scaled end would stop well short (around halfway).
    assert!(
        hairpin_right >= beat2_x - 0.5 * sp,
        "crescendo end ({hairpin_right:.1}) should reach the beat-2 note ({beat2_x:.1})"
    );
}

/// MNX 27 encodes an accent's written spelling structurally: `accentPrefix`
/// defaults to `s`, `accentSuffix` to `z`, `value` is the attack, and
/// `residualValue` is the level that persists after it. Each combination must
/// resolve to the precomposed SMuFL glyph for that spelling.
#[test]
fn test_accent_spellings_resolve_precomposed_glyphs() {
    let cases = [
        (r#""value":"f""#, smufl::DYNAMIC_SFORZATO),
        (r#""value":"ff""#, smufl::DYNAMIC_SFORZATO_FF),
        (
            r#""value":"f","accentSuffix":"""#,
            smufl::DYNAMIC_SFORZANDO1,
        ),
        (r#""accentPrefix":"","value":"f""#, smufl::DYNAMIC_FORZANDO),
        (
            r#""accentPrefix":"r","value":"f","accentSuffix":"""#,
            smufl::DYNAMIC_RINFORZANDO1,
        ),
        (
            r#""accentPrefix":"r","value":"f""#,
            smufl::DYNAMIC_RINFORZANDO2,
        ),
        (
            r#""accentPrefix":"","value":"f","residualValue":"p","accentSuffix":"""#,
            smufl::DYNAMIC_FORTE_PIANO,
        ),
        (
            r#""value":"f","residualValue":"p","accentSuffix":"""#,
            smufl::DYNAMIC_SFORZANDO_PIANO,
        ),
        (
            r#""value":"f","residualValue":"pp","accentSuffix":"""#,
            smufl::DYNAMIC_SFORZANDO_PIANISSIMO,
        ),
    ];

    for (fields, expected) in cases {
        let json = format!(
            r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
            "parts": [{{"measures": [{{
                "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                "sequences": [{{"content": [
                    {{"duration": {{"base": "whole"}}, "notes": [{{"pitch": {{"step": "B", "octave": 4}}}}]}}
                ]}}],
                "dynamics": [{{"type":"accent","position":{{"fraction":[0,1]}},{fields}}}]
            }}]}}]
        }}"#
        );
        let score = parse_mnx(&json).unwrap();
        let dl = layout_score(&score, 0, &LayoutConfig::default());
        let drawn: Vec<u32> = dl
            .commands
            .iter()
            .filter_map(|cmd| match cmd {
                RenderCommand::DrawGlyph { codepoint, .. }
                    if (0xE520..=0xE54F).contains(codepoint) =>
                {
                    Some(*codepoint)
                }

                _ => None,
            })
            .collect();
        assert_eq!(
            drawn,
            vec![expected],
            "accent {fields} should render one precomposed glyph U+{expected:04X}"
        );
    }
}

/// A `staffEnd` hairpin is authored once on its start staff and angles to the
/// destination staff. It must not be duplicated by each staff render pass.
#[test]
fn test_cross_staff_hairpin_renders_once_and_reaches_end_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "id": "P1",
            "name": "Piano",
            "staves": 2,
            "measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                    {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                ],
                "sequences": [
                    {"staff": 1, "content": [
                        {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
                    ]},
                    {"staff": 2, "content": [
                        {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                    ]}
                ],
                "dynamics": [{
                    "id": "cross-staff",
                    "type": "gradual",
                    "staff": 1,
                    "staffEnd": 2,
                    "position": {"fraction": [0, 1]},
                    "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
                    "wedgeType": "increasing"
                }]
            }]
        }]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let lines: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let is_hairpin = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/hairpincross-staff"));
            match command {
                RenderCommand::DrawLine { y1, y2, .. } if is_hairpin => Some((*y1, *y2)),
                _ => None,
            }
        })
        .collect();

    assert_eq!(
        lines.len(),
        2,
        "one cross-staff hairpin should emit exactly its two wedge lines"
    );
    assert!(
        lines
            .iter()
            .all(|(start_y, end_y)| end_y - start_y > 4.0 * config.sp),
        "both wedge lines should descend from staff 1 toward staff 2: {lines:?}"
    );
}

/// Looking up a `visuallyContinues` anchor must skip earlier measures without
/// dynamics rather than aborting before it reaches the referenced group.
#[test]
fn test_hairpin_visually_continues_dynamic_after_empty_measure() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "time": {"count": 4, "unit": 4}},
            {"id": "m2"}
        ]},
        "parts": [{"measures": [
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]},
            {
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
                ]}],
                "dynamics": [
                    {
                        "id": "anchor",
                        "type": "immediate",
                        "value": "mf",
                        "position": {"fraction": [0, 1]},
                        "_x": {"viritura": {"manualOffset": [0, 2]}}
                    },
                    {
                        "id": "linked",
                        "type": "gradual",
                        "position": {"fraction": [1, 4]},
                        "end": {"measure": "m2", "position": {"fraction": [3, 4]}},
                        "wedgeType": "increasing",
                        "visuallyContinues": "anchor"
                    }
                ]
            }
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let dynamic_baseline = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph { y, codepoint, .. } if *codepoint == smufl::DYNAMIC_MF => {
                Some(*y)
            }
            _ => None,
        })
        .expect("anchor dynamic should be drawn");
    let dynamic_midline = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id.ends_with("/dynanchor"))
        .map(|bbox| bbox.bbox.y + bbox.bbox.height * 0.5)
        .expect("anchor dynamic bbox");
    let hairpin_y = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let is_linked = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/hairpinlinked"));
            match command {
                RenderCommand::DrawLine { y1, .. } if is_linked => Some(*y1),
                _ => None,
            }
        })
        .expect("linked hairpin should be drawn");

    assert!(
        (hairpin_y - dynamic_midline).abs() < 0.01,
        "linked hairpin ({hairpin_y:.1}) should share the anchor dynamic midline ({:.1})",
        dynamic_midline
    );
    assert!(
        dynamic_midline < dynamic_baseline,
        "dynamic ink center should remain above its baseline"
    );
}

/// A bar rest is drawn centred in its measure, so its x is a visual position
/// and not a rhythmic anchor. A hairpin ending on beat 1 of a bar whose other
/// staff holds a bar rest must land on beat 1, not in the middle of the bar.
#[test]
fn test_hairpin_end_ignores_centered_bar_rest() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}, {"id": "m2"}]},
        "parts": [{
            "id": "P1",
            "staves": 2,
            "measures": [
                {
                    "clefs": [
                        {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                        {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                    ],
                    "sequences": [
                        {"staff": 1, "content": [{"duration": {"base": "whole"}, "rest": {}}]},
                        {"staff": 2, "content": [
                            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                        ]}
                    ],
                    "dynamics": [{
                        "id": "cresc",
                        "type": "gradual",
                        "staff": 2,
                        "position": {"fraction": [0, 1]},
                        "end": {"measure": "m2", "position": {"fraction": [0, 1]}},
                        "wedgeType": "increasing"
                    }]
                },
                {
                    "sequences": [
                        {"staff": 1, "content": [
                            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                            {"duration": {"base": "quarter"}, "rest": {}},
                            {"duration": {"base": "half"}, "rest": {}}
                        ]},
                        {"staff": 2, "content": [{"duration": {"base": "whole"}, "rest": {}}]}
                    ]
                }
            ]
        }]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let end_x = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| {
            let is_hairpin = dl
                .element_ids
                .get(index)
                .and_then(Option::as_deref)
                .is_some_and(|id| id.ends_with("/hairpincresc"));
            match command {
                RenderCommand::DrawLine { x2, .. } if is_hairpin => Some(*x2),
                _ => None,
            }
        })
        .expect("hairpin wedge should be rendered");

    let m2 = dl
        .measure_bounds
        .iter()
        .find(|b| b.index == 1)
        .expect("second measure bounds");
    let beat1_x = m2
        .beat_anchors
        .iter()
        .find(|(beat, _)| *beat == 0.0)
        .map(|(_, x)| *x)
        .expect("beat 1 anchor");

    assert!(
        (end_x - beat1_x).abs() < 0.5,
        "hairpin should end on beat 1 of m2 (x={beat1_x:.1}), not mid-bar (x={end_x:.1})"
    );
}
