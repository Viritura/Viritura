// Auto-generated from tests.rs — test_articulations
// 33 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_articulations_render_glyphs() {
    // Load the articulations.mnx sample: 4 quarter notes on E5 with
    // staccato, tenuto, accent, marcato respectively.
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/articulations.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all articulation glyph codepoints emitted
    let artic_codepoints: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. } if (0xE4A0..=0xE4AF).contains(codepoint) => {
                Some(*codepoint)
            }

            _ => None,
        })
        .collect();

    // Should have exactly 4 articulation glyphs (one per note)
    assert_eq!(
        artic_codepoints.len(),
        4,
        "Expected 4 articulation glyphs, got {}: {:?}",
        artic_codepoints.len(),
        artic_codepoints
    );

    // E5 on treble clef = staff position 1 → above middle line → stems down →
    // articulations above → use "above" variants
    assert!(
        artic_codepoints.contains(&smufl::ARTIC_STACCATO_ABOVE),
        "Missing staccato"
    );
    assert!(
        artic_codepoints.contains(&smufl::ARTIC_TENUTO_ABOVE),
        "Missing tenuto"
    );
    assert!(
        artic_codepoints.contains(&smufl::ARTIC_ACCENT_ABOVE),
        "Missing accent"
    );
    assert!(
        artic_codepoints.contains(&smufl::ARTIC_MARCATO_ABOVE),
        "Missing marcato"
    );
}

#[test]
fn test_articulation_explicit_orient_below() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{
                "type": "event",
                "duration": {"base": "quarter"},
                "notes": [{"pitch": {"step": "E", "octave": 5}}],
                "markings": {"staccato": {"orient": "below"}}
            }]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let staff_bottom = (config.margin_top + 4.0) * config.sp;
    let dl = layout_score(&score, 0, &config);

    let y = dl.commands.iter().find_map(|command| match command {
        RenderCommand::DrawGlyph {
            y,
            codepoint: smufl::ARTIC_STACCATO_BELOW,
            ..
        } => Some(*y),
        _ => None,
    });
    assert!(
        y.is_some_and(|value| value > staff_bottom),
        "explicit below articulation should render below the staff"
    );
}

#[test]
fn test_accent_moves_outward_from_same_side_tie() {
    let tied = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "markings": {"accent": {}},
                 "notes": [{"id": "source", "pitch": {"step": "C", "octave": 4},
                            "ties": [{"target": "target"}]}]},
                {"duration": {"base": "half"},
                 "notes": [{"id": "target", "pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let plain = tied.replace(r#""ties": [{"target": "target"}]"#, r#""ties": []"#);
    assert_ne!(plain, tied, "plain fixture must remove the tie");
    let config = LayoutConfig::default();
    let accent_y = |json: &str| {
        layout_score(&parse_mnx(json).unwrap(), 0, &config)
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph { y, codepoint, .. }
                    if *codepoint == smufl::ARTIC_ACCENT_BELOW =>
                {
                    Some(*y)
                }
                _ => None,
            })
            .expect("accent below")
    };
    let plain_y = accent_y(&plain);
    let tied_y = accent_y(tied);

    assert!(
        tied_y - plain_y >= 0.45 * config.sp,
        "same-side tie should move the accent outward by about 0.5sp: \
         plain={plain_y:.2}, tied={tied_y:.2}"
    );
}

#[test]
fn test_articulations_horizontally_centered_on_noteheads() {
    // Each articulation glyph should be centered on the notehead.
    // artic_x = notehead_center - glyph_width/2
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/articulations.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let dl = layout_score(&score, 0, &config);

    // Collect (codepoint, x) for articulation glyphs and noteheads
    let mut notehead_xs: Vec<f64> = Vec::new();
    let mut artic_entries: Vec<(u32, f64)> = Vec::new();
    for cmd in &dl.commands {
        match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. }
                if (0xE4A0..=0xE4AF).contains(codepoint) =>
            {
                artic_entries.push((*codepoint, *x));
            }
            RenderCommand::DrawGlyph { codepoint, x, .. }
                if *codepoint == smufl::NOTEHEAD_BLACK =>
            {
                notehead_xs.push(*x);
            }
            _ => {}
        }
    }

    assert!(!artic_entries.is_empty(), "No articulation glyphs found");
    assert!(!notehead_xs.is_empty(), "No notehead glyphs found");

    for (cp, ax) in &artic_entries {
        let artic_w = smufl::articulation_width(*cp) * sp;
        let artic_center = ax + artic_w * 0.5;
        // Find the closest notehead x and compute its center
        let closest_nh = notehead_xs
            .iter()
            .map(|nx| nx + notehead_w * 0.5)
            .min_by(|a, b| {
                (a - artic_center)
                    .abs()
                    .partial_cmp(&(b - artic_center).abs())
                    .unwrap()
            })
            .unwrap();
        let offset = (artic_center - closest_nh).abs();
        assert!(offset < 0.01 * sp,
            "Articulation 0x{:04X} center ({:.2}) not aligned with notehead center ({:.2}), offset={:.4}",
            cp, artic_center, closest_nh, offset);
    }
}

#[test]
fn test_articulations_stem_up_places_below() {
    // A note below middle line (C4) → stems up → articulations below
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"staccato": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_staccato_below = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_STACCATO_BELOW)
    });
    assert!(
        has_staccato_below,
        "Staccato should be below for stem-up note (C4)"
    );
}

#[test]
fn test_articulations_stacked() {
    // A note with both staccato and accent → two articulation glyphs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"},
                 "markings": {"staccato": {}, "accent": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let artic_glyphs: Vec<&RenderCommand> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if (0xE4A0..=0xE4BF).contains(codepoint))
        })
        .collect();
    // Staccato + accent produces a single combo glyph (accent-staccato ligature)
    assert_eq!(
        artic_glyphs.len(),
        1,
        "Expected 1 combo articulation glyph (accent-staccato), got {}",
        artic_glyphs.len()
    );
}

#[test]
fn test_articulations_staccato_accent_kerning() {
    // A note with staccato+accent: should produce a single accent-staccato
    // combo glyph (ligature) instead of two separate glyphs.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"},
                 "markings": {"staccato": {}, "accent": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should produce exactly one accent-staccato combo glyph
    let combo_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, .. } = cmd {
                if *codepoint == smufl::ARTIC_ACCENT_STACCATO_ABOVE
                    || *codepoint == smufl::ARTIC_ACCENT_STACCATO_BELOW
                {
                    return Some(*codepoint);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        combo_glyphs.len(),
        1,
        "Expected 1 accent-staccato combo glyph, got {}",
        combo_glyphs.len()
    );
}

#[test]
fn test_articulations_multivoice_stem_side() {
    // Two voices: voice 0 stems up, voice 1 stems down.
    // In multi-voice, articulations go on stem side (not opposite).
    // Voice 0 (stems up): articulations above (stem side = up).
    // Voice 1 (stems down): articulations below (stem side = down).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "quarter"},
                     "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "quarter"},
                     "markings": {"accent": {}},
                     "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Voice 0 (E5, stems forced up in multi-voice): staccato should be ABOVE
    let has_staccato_above = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_STACCATO_ABOVE)
    });
    assert!(
        has_staccato_above,
        "Multi-voice voice 0 (stem up): staccato should be ABOVE (stem side)"
    );

    // Voice 1 (C4, stems forced down in multi-voice): accent should be BELOW
    let has_accent_below = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_ACCENT_BELOW)
    });
    assert!(
        has_accent_below,
        "Multi-voice voice 1 (stem down): accent should be BELOW (stem side)"
    );
}

#[test]
fn test_articulations_multivoice_parity_overrides_forced_stem() {
    // Multi-voice articulations are forced to the voice's OUTER side by voice
    // PARITY (voice 1 above, voice 2 below), not by stem direction — so they
    // co-locate with that voice's slurs even when a voice's stem is forced
    // opposite its parity. Here BOTH voices' stems are forced the "wrong" way:
    // voice 0 (parity → above) forced stem DOWN, voice 1 (parity → below)
    // forced stem UP. The articulations must still land above / below by parity.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"duration": {"base": "quarter"}, "stemDirection": "down",
                     "markings": {"staccato": {}},
                     "notes": [{"pitch": {"step": "B", "octave": 4}}]}
                ]},
                {"content": [
                    {"duration": {"base": "quarter"}, "stemDirection": "up",
                     "markings": {"accent": {}},
                     "notes": [{"pitch": {"step": "G", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Voice 0 (parity → above) despite forced stem-down.
    let has_staccato_above = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_STACCATO_ABOVE)
    });
    assert!(
        has_staccato_above,
        "Voice 0 staccato must be ABOVE by parity even with forced stem-down"
    );

    // Voice 1 (parity → below) despite forced stem-up.
    let has_accent_below = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_ACCENT_BELOW)
    });
    assert!(
        has_accent_below,
        "Voice 1 accent must be BELOW by parity even with forced stem-up"
    );
}

#[test]
fn test_articulations_marcato_stacks_outside() {
    // A note with staccato + marcato: should produce a single marcato-staccato
    // combo glyph (ligature) instead of two separate stacked glyphs.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"},
                 "markings": {"staccato": {}, "strongAccent": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Should produce exactly one marcato-staccato combo glyph
    let combo_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { codepoint, .. } = cmd {
                if *codepoint == smufl::ARTIC_MARCATO_STACCATO_ABOVE
                    || *codepoint == smufl::ARTIC_MARCATO_STACCATO_BELOW
                {
                    return Some(*codepoint);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        combo_glyphs.len(),
        1,
        "Expected 1 marcato-staccato combo glyph, got {}",
        combo_glyphs.len()
    );

    // No individual staccato or marcato glyphs should be present
    let individual = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_STACCATO_ABOVE
            || *codepoint == smufl::ARTIC_STACCATO_BELOW
            || *codepoint == smufl::ARTIC_MARCATO_ABOVE
            || *codepoint == smufl::ARTIC_MARCATO_BELOW)
    });
    assert!(
        !individual,
        "Individual staccato/marcato glyphs should not be present when combo is used"
    );
}

#[test]
fn test_mixed_articulations_have_consistent_near_edge_distance() {
    // Same pitch for all events so articulation near-edge (closest side to note)
    // should be consistently aligned across glyph shapes.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "eighth"}, "markings": {"accent": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"strongAccent": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"staccato": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"staccatissimo": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"tenuto": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"spiccato": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"stress": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "markings": {"unstress": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Above-articulation codepoint range — includes all standalone and combo glyphs.
    let mut near_edges: Vec<f64> = Vec::new();
    for cmd in &dl.commands {
        if let RenderCommand::DrawGlyph { codepoint, y, .. } = cmd {
            if (0xE4A0..=0xE4BF).contains(codepoint) {
                let (_, by, _, bh) = smufl::glyph_bbox(*codepoint);
                // All events are single-voice E5 -> stem down -> articulations above.
                // Near edge for above glyphs is bottom edge.
                let bottom_edge = *y + (by + bh) * sp;
                near_edges.push(bottom_edge);
            }
        }
    }

    assert_eq!(
        near_edges.len(),
        8,
        "Expected 8 articulation glyphs, got {}",
        near_edges.len()
    );

    let min_edge = near_edges.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_edge = near_edges.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let spread = max_edge - min_edge;

    // Keep near-edge alignment within a tight band for mixed glyph shapes.
    assert!(
        spread <= 0.6 * sp,
        "Mixed articulation near-edge spread too large: {:.2}px (sp={:.2})",
        spread,
        sp
    );
}

#[test]
fn test_stress_marking_renders_glyph() {
    // Load the stress-unstress.mnx sample: 4 quarter notes with alternating
    // stress and unstress markings.
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/stress-unstress.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect stress/unstress glyph codepoints (U+E4B6–E4B9)
    let stress_codepoints: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::ARTIC_STRESS_ABOVE
                    || *codepoint == smufl::ARTIC_STRESS_BELOW
                    || *codepoint == smufl::ARTIC_UNSTRESS_ABOVE
                    || *codepoint == smufl::ARTIC_UNSTRESS_BELOW =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    // Should have 4 stress/unstress glyphs (one per note)
    assert_eq!(
        stress_codepoints.len(),
        4,
        "Expected 4 stress/unstress glyphs, got {}: {:?}",
        stress_codepoints.len(),
        stress_codepoints
    );

    // E5 on treble clef → stems down → articulations above → use "above" variants
    // C4 → stems up → articulations above (single voice, opposite stem)
    let stress_count = stress_codepoints
        .iter()
        .filter(|&&cp| cp == smufl::ARTIC_STRESS_ABOVE || cp == smufl::ARTIC_STRESS_BELOW)
        .count();
    let unstress_count = stress_codepoints
        .iter()
        .filter(|&&cp| cp == smufl::ARTIC_UNSTRESS_ABOVE || cp == smufl::ARTIC_UNSTRESS_BELOW)
        .count();
    assert_eq!(stress_count, 2, "Expected 2 stress glyphs");
    assert_eq!(unstress_count, 2, "Expected 2 unstress glyphs");
}

#[test]
fn test_stress_unstress_horizontally_centered() {
    // Stress/unstress glyphs should be centered on the notehead
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/stress-unstress.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;

    // Gather notehead X positions (filled noteheads for quarter notes)
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

    // Gather stress/unstress glyph X positions (now at correct codepoints 0xE4B6-0xE4B9)
    let artic_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if (0xE4B6..=0xE4B9).contains(codepoint) =>
            {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(notehead_xs.len(), 4);
    assert_eq!(artic_xs.len(), 4);

    // Each articulation x should be approximately centered on its notehead
    for i in 0..4 {
        let notehead_center = notehead_xs[i] + notehead_w * 0.5;
        let artic_codepoint = dl
            .commands
            .iter()
            .filter_map(|cmd| match cmd {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if (0xE4B6..=0xE4B9).contains(codepoint) && (*x - artic_xs[i]).abs() < 0.01 =>
                {
                    Some(*codepoint)
                }
                _ => None,
            })
            .next()
            .unwrap();
        let glyph_w = smufl::articulation_width(artic_codepoint) * sp;
        let expected_x = notehead_center - glyph_w * 0.5;
        assert!(
            (artic_xs[i] - expected_x).abs() < 0.5,
            "Stress/unstress glyph {} not centered: x={}, expected~{}",
            i,
            artic_xs[i],
            expected_x
        );
    }
}

#[test]
fn test_stress_unstress_model_parsing() {
    // Verify that stress/unstress markings parse correctly from MNX JSON
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "markings": {"stress": {}}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
            {"duration": {"base": "quarter"}, "markings": {"unstress": {}}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let events = &score.parts[0].measures[0].sequences[0].content;

    // First event has stress
    match &events[0] {
        SequenceContent::Event(e) => {
            assert!(
                e.markings.as_ref().unwrap().stress.is_some(),
                "First event should have stress"
            );
            assert!(e.markings.as_ref().unwrap().unstress.is_none());
        }
        _ => panic!("Expected Event"),
    }
    // Second event has unstress
    match &events[1] {
        SequenceContent::Event(e) => {
            assert!(
                e.markings.as_ref().unwrap().unstress.is_some(),
                "Second event should have unstress"
            );
            assert!(e.markings.as_ref().unwrap().stress.is_none());
        }
        _ => panic!("Expected Event"),
    }
    // Third event has no markings
    match &events[2] {
        SequenceContent::Event(e) => {
            assert!(e.markings.is_none(), "Third event should have no markings");
        }
        _ => panic!("Expected Event"),
    }
}

#[test]
fn test_soft_accent_renders_glyph() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/soft-accent.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Soft accent codepoints: above 0xE4B4, below 0xE4B5
    let soft_accent_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::ARTIC_SOFT_ACCENT_ABOVE
                    || *codepoint == smufl::ARTIC_SOFT_ACCENT_BELOW =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    // The soft-accent.mnx has 4 notes, each with softAccent marking
    assert_eq!(
        soft_accent_glyphs.len(),
        4,
        "Expected 4 soft accent glyphs, got {}: {:?}",
        soft_accent_glyphs.len(),
        soft_accent_glyphs
    );
}

#[test]
fn test_soft_accent_glyph_codepoints() {
    assert_eq!(smufl::ARTIC_SOFT_ACCENT_ABOVE, 0xE4B4);
    assert_eq!(smufl::ARTIC_SOFT_ACCENT_BELOW, 0xE4B5);
}

#[test]
fn test_soft_accent_articulation_width() {
    let width = smufl::articulation_width(smufl::ARTIC_SOFT_ACCENT_ABOVE);
    assert!(
        width > 1.0,
        "Soft accent should be wider than 1.0sp, got {}",
        width
    );
    let width_below = smufl::articulation_width(smufl::ARTIC_SOFT_ACCENT_BELOW);
    assert!(
        (width - width_below).abs() < 0.001,
        "Above/below widths should match: {} vs {}",
        width,
        width_below
    );
}

#[test]
fn test_soft_accent_model_deserialization() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"softAccent": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let event = &score.parts[0].measures[0].sequences[0].content[0];
    if let SequenceContent::Event(e) = event {
        assert!(e.markings.is_some(), "Event should have markings");
        assert!(
            e.markings.as_ref().unwrap().soft_accent.is_some(),
            "Markings should have soft_accent"
        );
    } else {
        panic!("Expected Event, got other SequenceContent variant");
    }
}

#[test]
fn test_soft_accent_with_staccato_stacking() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"softAccent": {}, "staccato": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_staccato = dl.commands.iter().any(|cmd| matches!(
        cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::ARTIC_STACCATO_ABOVE || *codepoint == smufl::ARTIC_STACCATO_BELOW
    ));
    let has_soft_accent = dl.commands.iter().any(|cmd| matches!(
        cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::ARTIC_SOFT_ACCENT_ABOVE || *codepoint == smufl::ARTIC_SOFT_ACCENT_BELOW
    ));

    assert!(has_staccato, "Should render staccato glyph");
    assert!(has_soft_accent, "Should render soft accent glyph");
}

#[test]
fn test_soft_accent_horizontally_centered() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "markings": {"softAccent": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let dl = layout_score(&score, 0, &config);

    let notehead_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_WHOLE =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have a notehead");

    let accent_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ARTIC_SOFT_ACCENT_ABOVE
                    || *codepoint == smufl::ARTIC_SOFT_ACCENT_BELOW =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have a soft accent glyph");

    let notehead_center = notehead_x + notehead_w * 0.5;
    let accent_w = smufl::articulation_width(smufl::ARTIC_SOFT_ACCENT_ABOVE) * sp;
    let accent_center = accent_x + accent_w * 0.5;

    assert!(
        (notehead_center - accent_center).abs() < 1.0,
        "Soft accent should be centered on notehead: notehead_center={}, accent_center={}",
        notehead_center,
        accent_center
    );
}

#[test]
fn test_breath_marks_render_from_mnx() {
    // Load the breath-marks.mnx sample which has 3 measures:
    // M1: default breath, M2: tick + salzedo, M3: comma
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/breath-marks.mnx"
    );
    let json = std::fs::read_to_string(path).unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect breath mark glyph codepoints
    let breath_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if [
                    smufl::BREATH_MARK_COMMA,
                    smufl::BREATH_MARK_TICK,
                    smufl::BREATH_MARK_SALZEDO,
                ]
                .contains(codepoint) =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    // Should have 3 breath mark glyphs total (1 in M1, 2 in M2, 1 in M3 = 4 total but
    // M1 default = comma, M2 = tick + salzedo, M3 = comma → 4 events with breath marks)
    // Actually: M1 has 1 default breath, M2 has tick + salzedo, M3 has comma = 4 total
    assert_eq!(
        breath_glyphs.len(),
        4,
        "Expected 4 breath mark glyphs, got {}: {:?}",
        breath_glyphs.len(),
        breath_glyphs
    );

    // Verify all three symbol types are present
    assert!(
        breath_glyphs.contains(&smufl::BREATH_MARK_COMMA),
        "Missing comma breath mark"
    );
    assert!(
        breath_glyphs.contains(&smufl::BREATH_MARK_TICK),
        "Missing tick breath mark"
    );
    assert!(
        breath_glyphs.contains(&smufl::BREATH_MARK_SALZEDO),
        "Missing salzedo breath mark"
    );
}

#[test]
fn test_breath_marks_above_staff() {
    // Breath marks should be placed above the top staff line
    // and just before the subsequent note.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"breath": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Find the breath mark glyph position.
    let breath_pos = dl.commands.iter().find_map(|cmd| match cmd {
        RenderCommand::DrawGlyph {
            codepoint, x, y, ..
        } if *codepoint == smufl::BREATH_MARK_COMMA => Some((*x, *y)),
        _ => None,
    });

    assert!(breath_pos.is_some(), "Should render a breath mark glyph");
    let (breath_x, breath_y) = breath_pos.unwrap();

    // Find noteheads and identify the second note's x (the subsequent note).
    let mut notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. }
                if [
                    smufl::NOTEHEAD_BLACK,
                    smufl::NOTEHEAD_HALF,
                    smufl::NOTEHEAD_WHOLE,
                    smufl::NOTEHEAD_DOUBLE_WHOLE,
                ]
                .contains(codepoint) =>
            {
                Some(*x)
            }
            _ => None,
        })
        .collect();
    notehead_xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert!(
        notehead_xs.len() >= 2,
        "Expected at least 2 noteheads in test score"
    );
    let second_note_x = notehead_xs[1];

    let staff_y = config.margin_top * sp;

    // Breath mark should be above the top staff line
    assert!(
        breath_y < staff_y,
        "Breath mark (y={:.1}) should be above top staff line (y={:.1})",
        breath_y,
        staff_y
    );

    // Breath mark should be just before the subsequent note.
    assert!(
        breath_x < second_note_x,
        "Breath mark x={:.1} should be before subsequent note x={:.1}",
        breath_x,
        second_note_x
    );
}

#[test]
fn test_breath_mark_symbol_parsing() {
    // Test that all three symbol types parse correctly from JSON
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"breath": {"symbol": "tick"}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "markings": {"breath": {"symbol": "salzedo"}},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "half"}, "markings": {"breath": {"symbol": "comma"}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let breath_codepoints: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if [
                    smufl::BREATH_MARK_COMMA,
                    smufl::BREATH_MARK_TICK,
                    smufl::BREATH_MARK_SALZEDO,
                ]
                .contains(codepoint) =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    assert_eq!(breath_codepoints.len(), 3, "Expected 3 breath marks");
    assert_eq!(
        breath_codepoints[0],
        smufl::BREATH_MARK_TICK,
        "First should be tick"
    );
    assert_eq!(
        breath_codepoints[1],
        smufl::BREATH_MARK_SALZEDO,
        "Second should be salzedo"
    );
    assert_eq!(
        breath_codepoints[2],
        smufl::BREATH_MARK_COMMA,
        "Third should be comma"
    );
}

#[test]
fn test_breath_mark_default_is_comma() {
    // A breath mark with no symbol should default to comma glyph
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"breath": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "dotted-half"},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_comma = dl.commands.iter().any(|cmd| matches!(
        cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::BREATH_MARK_COMMA
    ));

    assert!(
        has_comma,
        "Default breath mark should render as comma glyph (U+E4CE)"
    );
}

#[test]
fn test_spiccato_renders_glyph() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/spiccato.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Staccatissimo stroke codepoints (MNX "spiccato"): above 0xE4AA, below 0xE4AB
    let spiccato_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE
                    || *codepoint == smufl::ARTIC_STACCATISSIMO_STROKE_BELOW =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    // The spiccato.mnx has 3 notes with spiccato marking (events 0, 1, 2)
    assert_eq!(
        spiccato_glyphs.len(),
        3,
        "Expected 3 spiccato glyphs, got {}: {:?}",
        spiccato_glyphs.len(),
        spiccato_glyphs
    );
}

#[test]
fn test_spiccato_glyph_codepoints() {
    assert_eq!(smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE, 0xE4AA);
    assert_eq!(smufl::ARTIC_STACCATISSIMO_STROKE_BELOW, 0xE4AB);
}

#[test]
fn test_spiccato_articulation_width() {
    let width = smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE);
    assert!(
        width > 0.0,
        "Spiccato width should be positive, got {}",
        width
    );
    let width_below = smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_STROKE_BELOW);
    assert!(
        (width - width_below).abs() < 0.001,
        "Above/below widths should match: {} vs {}",
        width,
        width_below
    );
}

#[test]
fn test_spiccato_stem_up_places_below() {
    // C4 is below the middle line → stems up → spiccato should be below
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "markings": {"spiccato": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_spiccato_below = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_STACCATISSIMO_STROKE_BELOW)
    });
    assert!(
        has_spiccato_below,
        "Spiccato should be below for stem-up note (C4)"
    );
}

#[test]
fn test_spiccato_with_accent_stacking() {
    // A note with spiccato + accent should produce two articulation glyphs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "markings": {"spiccato": {}, "accent": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_spiccato = dl.commands.iter().any(|cmd| matches!(
        cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE || *codepoint == smufl::ARTIC_STACCATISSIMO_STROKE_BELOW
    ));
    let has_accent = dl.commands.iter().any(|cmd| {
        matches!(
            cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_ACCENT_ABOVE || *codepoint == smufl::ARTIC_ACCENT_BELOW
        )
    });

    assert!(has_spiccato, "Should render spiccato glyph");
    assert!(has_accent, "Should render accent glyph");
}

#[test]
fn test_spiccato_horizontally_centered() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "markings": {"spiccato": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let dl = layout_score(&score, 0, &config);

    let notehead_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_WHOLE =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have a whole notehead");

    let spiccato_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE
                    || *codepoint == smufl::ARTIC_STACCATISSIMO_STROKE_BELOW =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have a spiccato glyph");

    let artic_w = smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_STROKE_ABOVE) * sp;
    let artic_center = spiccato_x + artic_w * 0.5;
    let notehead_center = notehead_x + notehead_w * 0.5;
    let offset = (artic_center - notehead_center).abs();
    assert!(
        offset < 1.0,
        "Spiccato center ({:.2}) should align with notehead center ({:.2}), offset={:.4}",
        artic_center,
        notehead_center,
        offset
    );
}

#[test]
fn test_staccatissimo_renders_glyph() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/staccatissimo.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let staccatissimo_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if *codepoint == smufl::ARTIC_STACCATISSIMO_ABOVE
                    || *codepoint == smufl::ARTIC_STACCATISSIMO_BELOW =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    // The staccatissimo.mnx has 3 notes with staccatissimo marking
    assert_eq!(
        staccatissimo_glyphs.len(),
        3,
        "Expected 3 staccatissimo glyphs, got {}: {:?}",
        staccatissimo_glyphs.len(),
        staccatissimo_glyphs
    );
}

#[test]
fn test_staccatissimo_glyph_codepoints() {
    assert_eq!(smufl::ARTIC_STACCATISSIMO_ABOVE, 0xE4A6);
    assert_eq!(smufl::ARTIC_STACCATISSIMO_BELOW, 0xE4A7);
}

#[test]
fn test_staccatissimo_articulation_width() {
    let width = smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_ABOVE);
    assert!(
        width > 0.0,
        "Staccatissimo width should be positive, got {}",
        width
    );
    let width_below = smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_BELOW);
    assert!(
        (width - width_below).abs() < 0.001,
        "Above/below widths should match: {} vs {}",
        width,
        width_below
    );
}

#[test]
fn test_staccatissimo_model_deserialization() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "markings": {"staccatissimo": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let event = &score.parts[0].measures[0].sequences[0].content[0];
    if let SequenceContent::Event(e) = event {
        assert!(e.markings.is_some(), "Event should have markings");
        assert!(
            e.markings.as_ref().unwrap().staccatissimo.is_some(),
            "Markings should have staccatissimo"
        );
    } else {
        panic!("Expected Event, got other SequenceContent variant");
    }
}

#[test]
fn test_staccatissimo_stem_up_places_below() {
    // C4 is below the middle line → stems up → staccatissimo should be below
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "markings": {"staccatissimo": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_staccatissimo_below = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_STACCATISSIMO_BELOW)
    });
    assert!(
        has_staccatissimo_below,
        "Staccatissimo should be below for stem-up note (C4)"
    );
}

#[test]
fn test_staccatissimo_ink_never_enters_staff() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "stemDirection": "down",
                 "markings": {"staccatissimo": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "stemDirection": "up",
                 "markings": {"staccatissimo": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "stemDirection": "down",
                 "markings": {"_x": {"viritura": {"staccatissimoWedge": {}}}},
                 "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "stemDirection": "up",
                 "markings": {"_x": {"viritura": {"staccatissimoWedge": {}}}},
                 "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_top = config.margin_top * sp;
    let staff_bottom = staff_top + 4.0 * sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let glyphs: Vec<(u32, f64)> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::ARTIC_STACCATISSIMO_ABOVE
                    || *codepoint == smufl::ARTIC_STACCATISSIMO_BELOW
                    || *codepoint == smufl::ARTIC_STACCATISSIMO_WEDGE_ABOVE
                    || *codepoint == smufl::ARTIC_STACCATISSIMO_WEDGE_BELOW =>
            {
                Some((*codepoint, *y))
            }
            _ => None,
        })
        .collect();

    assert_eq!(glyphs.len(), 4);
    for (codepoint, y) in glyphs {
        let (_, bbox_y, _, bbox_h) = smufl::glyph_bbox(codepoint);
        let ink_top = y + bbox_y * sp;
        let ink_bottom = ink_top + bbox_h * sp;
        let is_above = codepoint == smufl::ARTIC_STACCATISSIMO_ABOVE
            || codepoint == smufl::ARTIC_STACCATISSIMO_WEDGE_ABOVE;
        if is_above {
            assert!(
                ink_bottom <= staff_top + 1.0e-6,
                "above staccatissimo 0x{codepoint:04X} ink bottom {ink_bottom:.3} must stay above staff top {staff_top:.3}"
            );
        } else {
            assert!(
                ink_top >= staff_bottom - 1.0e-6,
                "below staccatissimo 0x{codepoint:04X} ink top {ink_top:.3} must stay below staff bottom {staff_bottom:.3}"
            );
        }
    }
}

#[test]
fn test_staccatissimo_with_accent_stacking() {
    // A note with staccatissimo + accent should produce two articulation glyphs
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "markings": {"staccatissimo": {}, "accent": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_staccatissimo = dl.commands.iter().any(|cmd| matches!(
        cmd, RenderCommand::DrawGlyph { codepoint, .. }
        if *codepoint == smufl::ARTIC_STACCATISSIMO_ABOVE || *codepoint == smufl::ARTIC_STACCATISSIMO_BELOW
    ));
    let has_accent = dl.commands.iter().any(|cmd| {
        matches!(
            cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::ARTIC_ACCENT_ABOVE || *codepoint == smufl::ARTIC_ACCENT_BELOW
        )
    });

    assert!(has_staccatissimo, "Should render staccatissimo glyph");
    assert!(has_accent, "Should render accent glyph");
}

#[test]
fn test_staccatissimo_horizontally_centered() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "markings": {"staccatissimo": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let dl = layout_score(&score, 0, &config);

    let notehead_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::NOTEHEAD_WHOLE =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have a whole notehead");

    let staccatissimo_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::ARTIC_STACCATISSIMO_ABOVE
                    || *codepoint == smufl::ARTIC_STACCATISSIMO_BELOW =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should have a staccatissimo glyph");

    let artic_w = smufl::articulation_width(smufl::ARTIC_STACCATISSIMO_ABOVE) * sp;
    let artic_center = staccatissimo_x + artic_w * 0.5;
    let notehead_center = notehead_x + notehead_w * 0.5;
    let offset = (artic_center - notehead_center).abs();
    assert!(
        offset < 1.0,
        "Staccatissimo center ({:.2}) should align with notehead center ({:.2}), offset={:.4}",
        artic_center,
        notehead_center,
        offset
    );
}

#[test]
fn test_articulations_tagged_with_element_ids() {
    // Articulation glyphs should be tagged with sub-element IDs like
    // "p0/m0/s0/{event_id}/art-staccato" for hit-testing / selection.
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/articulations.mnx"
    ))
    .unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect element IDs for articulation glyph commands
    let artic_ids: Vec<&str> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(i, cmd)| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. } if (0xE4A0..=0xE4AF).contains(codepoint) => {
                dl.element_ids.get(i).and_then(|opt| opt.as_deref())
            }
            _ => None,
        })
        .collect();

    // Should have 4 articulation tags (one per note)
    assert_eq!(
        artic_ids.len(),
        4,
        "Expected 4 tagged articulation IDs, got {}: {:?}",
        artic_ids.len(),
        artic_ids
    );

    // Each should carry the "/art-" prefix naming an articulation sub-element
    for id in &artic_ids {
        assert!(
            id.contains("/art-"),
            "Articulation element ID '{}' should contain '/art-'",
            id
        );
    }

    // The name identifies the marking, not a position in the render order.
    assert!(
        artic_ids
            .iter()
            .all(|id| id.rsplit("/art-").next().is_some_and(|n| !n.is_empty())),
        "every articulation id should name its marking, got {:?}",
        artic_ids
    );
}

#[test]
fn test_accent_does_not_straddle_staff_line() {
    // C5 with a stem-down accent places the accent above the notehead, inside
    // the staff. The accent wedge spans roughly a whole space, so snapping its
    // lower edge to a space would still leave its body centred on a staff line.
    // The glyph must be recentred so no staff line crosses its vertical extent.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "stemDirection": "down",
                 "markings": {"accent": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let dl = layout_score(&score, 0, &config);

    let accent_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { y, codepoint, .. }
                if *codepoint == smufl::ARTIC_ACCENT_ABOVE =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("Should render an accent-above glyph");

    // Glyph origin position in half-spaces (0 = top line, even = on a line).
    let origin_pos = (accent_y - staff_y) / (sp * 0.5);
    let (_, yoff, _, h) = smufl::glyph_bbox(smufl::ARTIC_ACCENT_ABOVE);
    let body_top = origin_pos + yoff * 2.0;
    let body_bottom = origin_pos + (yoff + h) * 2.0;

    // No staff line (even integer half-space position) may fall strictly inside
    // the accent's vertical extent.
    let first = body_top.floor() as i32;
    let last = body_bottom.ceil() as i32;
    let straddles =
        (first..=last).any(|p| p % 2 == 0 && (p as f64) > body_top && (p as f64) < body_bottom);
    assert!(
        !straddles,
        "Accent body ({:.3}..{:.3} half-spaces) must not straddle a staff line",
        body_top, body_bottom
    );
}

#[test]
fn test_staccato_ink_is_centered_in_staff_space() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "stemDirection": "down",
                 "markings": {"staccato": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "half"}, "stemDirection": "up",
                 "markings": {"staccato": {}},
                 "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let staccatos: Vec<(u32, f64)> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::ARTIC_STACCATO_ABOVE
                    || *codepoint == smufl::ARTIC_STACCATO_BELOW =>
            {
                Some((*codepoint, *y))
            }
            _ => None,
        })
        .collect();

    assert_eq!(staccatos.len(), 2);
    for (codepoint, y) in staccatos {
        let (_, bbox_y, _, bbox_h) = smufl::glyph_bbox(codepoint);
        let origin_half_spaces = (y - staff_y) / (sp * 0.5);
        let ink_center = origin_half_spaces + (bbox_y + bbox_h * 0.5) * 2.0;
        let nearest_space = ink_center.round();
        assert!(
            (nearest_space as i32).rem_euclid(2) == 1
                && (ink_center - nearest_space).abs() < 1.0e-6,
            "staccato 0x{codepoint:04X} ink center {ink_center:.3} must sit at a staff-space center"
        );
    }
}

#[test]
fn test_accent_bbox_tracks_recentred_glyph() {
    // Same scenario as `test_accent_does_not_straddle_staff_line`: the accent
    // wedge is recentred off a staff line by `snap_glyph_to_space`. The
    // selection bbox is computed on a separate path and must apply the *same*
    // recentring, otherwise the hitbox floats away from the drawn glyph.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "stemDirection": "down",
                 "markings": {"accent": {}},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Drawn accent glyph position.
    let (accent_x, accent_y) = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if *codepoint == smufl::ARTIC_ACCENT_ABOVE => Some((*x, *y)),
            _ => None,
        })
        .expect("Should render an accent-above glyph");

    // Expected selection box = pixel bbox of the glyph at its drawn origin.
    let (bx, by, bw, bh) = smufl::glyph_bbox(smufl::ARTIC_ACCENT_ABOVE);
    let scale = (4.0 * config.sp) / 4.0;
    let expected_x = accent_x + bx * scale;
    let expected_y = accent_y + by * scale;

    let bb = &dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.ends_with("/art-accent"))
        .expect("Should have a per-glyph articulation bbox")
        .bbox;

    assert!(
        (bb.x - expected_x).abs() < 1e-6,
        "Accent bbox x {:.4} must match drawn glyph x {:.4}",
        bb.x,
        expected_x
    );
    assert!(
        (bb.y - expected_y).abs() < 1e-6,
        "Accent bbox y {:.4} must match drawn glyph y {:.4} (recentred off the staff line)",
        bb.y,
        expected_y
    );
    assert!(
        (bb.width - bw * scale).abs() < 1e-6 && (bb.height - bh * scale).abs() < 1e-6,
        "Accent bbox size must match the glyph extent"
    );
}
