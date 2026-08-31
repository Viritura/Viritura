// Auto-generated from tests.rs — test_text_directions
// 5 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::placement_metrics::PlacementTable;
use crate::render::*;

// ═══════════════════════════════════════
// Text Expression Tests
// ═══════════════════════════════════════
#[test]
fn test_text_expressions_render_italic_text() {
    // Load text-expressions.mnx: "dolce" at beat 0 in measure 1
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/text-expressions.mnx"
    ))
    .expect("Failed to read text-expressions.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse text-expressions.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all italic text commands (expressions use "serif italic" font)
    let expr_texts: Vec<(f64, f64, String)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText {
                x, y, text, font, ..
            } = cmd
            {
                if font == "serif italic" {
                    return Some((*x, *y, text.clone()));
                }
            }
            None
        })
        .collect();

    // Should have at least 3 below-staff expression texts (italic):
    // m1: "dolce", m2: "espressivo", m3: "rit."
    // "a tempo" is above-staff so uses regular serif font
    assert!(
        expr_texts.len() >= 3,
        "Expected at least 3 italic expression texts, got {}: {:?}",
        expr_texts.len(),
        expr_texts
    );

    // Verify "dolce" is present
    assert!(
        expr_texts.iter().any(|(_, _, t)| t == "dolce"),
        "Should contain 'dolce' expression: {:?}",
        expr_texts
    );

    // Verify "espressivo" is present
    assert!(
        expr_texts.iter().any(|(_, _, t)| t == "espressivo"),
        "Should contain 'espressivo' expression: {:?}",
        expr_texts
    );

    // Verify "rit." is present
    assert!(
        expr_texts.iter().any(|(_, _, t)| t == "rit."),
        "Should contain 'rit.' expression: {:?}",
        expr_texts
    );
}

#[test]
fn test_text_expressions_below_staff_position() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/text-expressions.mnx"
    ))
    .expect("Failed to read text-expressions.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse text-expressions.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    // "dolce" should be below the staff
    let dolce = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawText { y, text, font, .. } = cmd {
                if font == "serif italic" && text == "dolce" {
                    return Some(*y);
                }
            }
            None
        })
        .expect("Should have 'dolce' text");

    assert!(
        dolce > staff_bottom,
        "'dolce' y={:.1} should be below staff bottom={:.1}",
        dolce,
        staff_bottom
    );
}

#[test]
fn test_chord_symbols_render_text() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/chord-symbols.mnx"
    ))
    .expect("Failed to read chord-symbols.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse chord-symbols.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect all DrawText commands that look like chord symbols
    // (positioned above staff, bold serif font)
    let chord_texts: Vec<(f64, f64, String)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText {
                x, y, text, font, ..
            } = cmd
            {
                if font == "serif" {
                    // Filter out rehearsal marks and tempo text by checking y position
                    // Chord symbols are at ~staff_y - 2.0*sp
                    let sp = config.sp;
                    let staff_y = config.margin_top * sp;
                    let chord_y_approx = staff_y - 2.0 * sp;
                    if (*y - chord_y_approx).abs() < 1.0 * sp {
                        return Some((*x, *y, text.clone()));
                    }
                }
            }
            None
        })
        .collect();

    // We should have chord symbol texts from all 4 measures
    assert!(
        chord_texts.len() >= 4,
        "Expected at least 4 chord symbol texts, got {}: {:?}",
        chord_texts.len(),
        chord_texts
    );

    // Verify expected chord symbol text strings are present
    let texts: Vec<&str> = chord_texts.iter().map(|(_, _, t)| t.as_str()).collect();
    assert!(
        texts.contains(&"C"),
        "Should contain 'C' chord, got: {:?}",
        texts
    );
    assert!(
        texts.contains(&"Dm"),
        "Should contain 'Dm' chord, got: {:?}",
        texts
    );
    assert!(
        texts.contains(&"G7"),
        "Should contain 'G7' chord, got: {:?}",
        texts
    );
    assert!(
        texts.contains(&"Cmaj7"),
        "Should contain 'Cmaj7' chord, got: {:?}",
        texts
    );

    // Chord symbols should be above the staff (y < staff_y)
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    for (_, y, text) in &chord_texts {
        assert!(
            *y < staff_y,
            "Chord symbol '{}' at y={:.1} should be above staff_y={:.1}",
            text,
            y,
            staff_y
        );
    }
}

#[test]
fn test_text_expressions_above_placement() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/text-expressions.mnx"
    ))
    .expect("Failed to read text-expressions.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse text-expressions.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // "a tempo" has placement: "above", should be above the staff
    // Above-staff expressions use regular serif font (not italic)
    let a_tempo = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawText { y, text, font, .. } = cmd {
                if font == "serif" && text == "a tempo" {
                    return Some(*y);
                }
            }
            None
        })
        .expect("Should have 'a tempo' text");

    assert!(
        a_tempo < staff_y,
        "'a tempo' y={:.1} should be above staff top={:.1}",
        a_tempo,
        staff_y
    );
}

#[test]
fn test_above_expression_clears_stem_tip() {
    // A stem-up note inside the staff (G4 on treble) has a stem that protrudes
    // above the top staff line. An above-staff direction ("pizz.") must clear
    // the stem tip, not just the noteheads, so it isn't crowded against the
    // stem. The clearance is the expression's `padding.vertical` from the
    // placement table (no baked-in literal), so the assertion reads the same
    // descriptor the renderer does and stays in lock-step with it.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "expressions": [{"text": "pizz.", "position": {"fraction": [0, 4]}, "placement": "above"}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "stemDirection": "up",
                 "notes": [{"pitch": {"step": "G", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse");
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let pizz_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "pizz." => Some(*y),
            _ => None,
        })
        .expect("Should render 'pizz.' text");

    // The stem is drawn as a vertical line; its top edge is the stem tip.
    let stem_top = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { x1, y1, x2, y2, .. } if (x1 - x2).abs() < 0.01 => {
                Some(y1.min(*y2))
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(stem_top.is_finite(), "Should render a stem line");

    // Text baseline sits the expression's `padding.vertical` gap above the stem
    // tip (above = smaller y), sourced from the placement table.
    let anchor_gap = config
        .placement
        .resolve(crate::render::ElementKind::Expression)
        .padding
        .vertical
        * sp;
    assert!(
        (pizz_y - (stem_top - anchor_gap)).abs() < 0.25 * sp,
        "'pizz.' baseline y={:.1} should be {:.1} ({:.2}sp) above stem tip y={:.1}",
        pizz_y,
        anchor_gap,
        anchor_gap / sp,
        stem_top
    );
}

#[test]
fn test_barline_anchored_expression_right_aligns_to_measure_end() {
    // A repeat/jump instruction (D.C. al Coda, D.S. al Fine, ...) written at a
    // rhythmic position at or beyond the measure's own duration (e.g. `[1,1]`
    // in a 2/4 bar) is the standard idiom for "anchor to the barline". It must
    // right-align and hug that barline, not left-anchor into empty space past
    // the measure like a normal note-anchored expression.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}, "barline": {"type": "double"}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"expressions": [
                {"text": "D.C. al Coda", "position": {"fraction": [1, 1]}, "placement": "above"}
            ]}},
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let (text_x, align) = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { x, text, align, .. } if text == "D.C. al Coda" => {
                Some((*x, align.clone()))
            }
            _ => None,
        })
        .expect("Should render 'D.C. al Coda' text");

    assert!(
        matches!(align, TextAlign::Right),
        "Barline-anchored instruction should be right-aligned, got {:?}",
        align
    );

    let bounds = dl
        .measure_bounds
        .iter()
        .find(|mb| mb.index == 0)
        .expect("Measure 0 bounds should exist");
    let measure_start = bounds.x;
    let measure_end = bounds.x + bounds.width;
    assert!(
        (text_x - measure_end).abs() < (text_x - measure_start).abs(),
        "Text anchor x={:.2} should be closer to the measure's trailing barline ({:.2}) than its start ({:.2})",
        text_x,
        measure_end,
        measure_start
    );
}

#[test]
fn test_text_expressions_below_dynamics() {
    // "dolce" appears in measure 1 which also has dynamics "p"
    // Expression should be placed below dynamics
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/text-expressions.mnx"
    ))
    .expect("Failed to read text-expressions.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse text-expressions.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the dynamics glyph Y (piano "p")
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

    // Find "dolce" Y
    let dolce_y = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawText { y, text, font, .. } = cmd {
                if font == "serif italic" && text == "dolce" {
                    return Some(*y);
                }
            }
            None
        })
        .expect("Should have 'dolce' text");

    // "dolce" should be at the same vertical level as dynamics (same baseline band)
    assert!(
        dolce_y >= dyn_y,
        "'dolce' y={:.1} should be at or below dynamics y={:.1}",
        dolce_y,
        dyn_y
    );
}

#[test]
fn test_text_expression_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/text-expressions.mnx"
    ))
    .expect("Failed to read text-expressions.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse text-expressions.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated"
    );

    let expr_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/expr"))
        .collect();
    assert!(
        expr_ids.len() >= 4,
        "Expected at least 4 expression element IDs, got {}: {:?}",
        expr_ids.len(),
        expr_ids
    );

    // Format: p{part}/m{measure}/expr{index}
    assert!(
        expr_ids[0].starts_with("p0/"),
        "Expression ID should start with p0/, got {}",
        expr_ids[0]
    );
}

#[test]
fn test_chord_symbol_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/chord-symbols.mnx"
    ))
    .expect("Failed to read chord-symbols.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse chord-symbols.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated"
    );

    let chord_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/chord"))
        .collect();
    assert!(
        chord_ids.len() >= 4,
        "Expected at least 4 chord element IDs, got {}: {:?}",
        chord_ids.len(),
        chord_ids
    );

    // Format: p{part}/m{measure}/chord{index}
    assert!(
        chord_ids[0].starts_with("p0/m0/chord"),
        "First chord ID should start with p0/m0/chord, got {}",
        chord_ids[0]
    );
}

// ═══════════════════════════════════════
// Text expression left-alignment tests
// ═══════════════════════════════════════

#[test]
fn test_text_expressions_left_aligned() {
    // Verify expression text uses Left alignment instead of Center
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/text-expressions.mnx"
    ))
    .expect("Failed to read text-expressions.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse text-expressions.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find "dolce" DrawText command and check alignment
    let dolce_cmd = dl
        .commands
        .iter()
        .find(|cmd| {
            if let RenderCommand::DrawText { text, font, .. } = cmd {
                font == "serif italic" && text == "dolce"
            } else {
                false
            }
        })
        .expect("Should have 'dolce' DrawText command");

    if let RenderCommand::DrawText { align, .. } = dolce_cmd {
        assert!(
            matches!(align, TextAlign::Left),
            "Expression text should use Left alignment, got {:?}",
            align
        );
    }
}

#[test]
fn test_text_expression_x_aligns_with_notehead_left_edge() {
    // Single note with expression — verify expression X ≈ note X (left edge, not center)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}],
            "_x": {"viritura": {"expressions": [{"text": "cantabile", "position": {"fraction": [0, 1]}}]}}
        }]}]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Find the notehead glyph X (whole note)
    let notehead_x = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, codepoint, font, ..
            } = cmd
            {
                if font == "Bravura"
                    && (*codepoint == 0xE0A2 || *codepoint == 0xE0A3 || *codepoint == 0xE0A4)
                {
                    return Some(*x);
                }
            }
            None
        })
        .expect("Should have a notehead glyph");

    // Find "cantabile" text X
    let expr_x = dl
        .commands
        .iter()
        .find_map(|cmd| {
            if let RenderCommand::DrawText { x, text, .. } = cmd {
                if text == "cantabile" {
                    return Some(*x);
                }
            }
            None
        })
        .expect("Should have 'cantabile' text");

    // Expression X should be very close to notehead X (left-aligned),
    // not offset by half the text width (which would be center-aligned)
    assert!(
        (expr_x - notehead_x).abs() < 1.0 * sp,
        "Expression x={:.1} should be near notehead left edge x={:.1} (within 1 sp)",
        expr_x,
        notehead_x
    );
}

#[test]
fn test_above_expression_stays_aligned_under_rehearsal_mark() {
    // An above-staff performance direction stays aligned with its note even
    // when a rehearsal mark sits at the same measure start. Standard engraving
    // practice gives the rehearsal mark the topmost slot: it rises above the
    // direction rather than shoving the direction sideways. Build two identical
    // scores — one with a boxed rehearsal mark, one without — and verify the
    // direction's X is unchanged, and that the mark's box clears it vertically.
    let with_mark = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "2", "style": "boxed"}}}
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}],
            "_x": {"viritura": {"expressions": [{"text": "a tempo", "position": {"fraction": [0, 1]}, "placement": "above"}]}}
        }]}]
    }"#;
    let without_mark = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}],
            "_x": {"viritura": {"expressions": [{"text": "a tempo", "position": {"fraction": [0, 1]}, "placement": "above"}]}}
        }]}]
    }"#;

    let config = LayoutConfig::default();
    let sp = config.sp;

    let find_a_tempo = |json: &str| -> (f64, f64, f64) {
        // Returns (text_x, text_top_y, text_baseline_y) for the "a tempo" label.
        let score = crate::parse::parse_mnx(json).unwrap();
        let dl = layout_score(&score, 0, &config);
        dl.commands
            .iter()
            .find_map(|cmd| {
                if let RenderCommand::DrawText {
                    x,
                    y,
                    text,
                    font,
                    size,
                    ..
                } = cmd
                {
                    if font == "serif" && text == "a tempo" {
                        return Some((*x, *y - *size, *y));
                    }
                }
                None
            })
            .expect("Should have 'a tempo' text")
    };

    let (x_with, _top_with, _) = find_a_tempo(with_mark);
    let (x_without, _, _) = find_a_tempo(without_mark);

    // The direction stays aligned with its note — the rehearsal mark does not
    // push it horizontally.
    assert!(
        (x_with - x_without).abs() < 1e-6,
        "'a tempo' x_with={:.1} should equal x_without={:.1} (rehearsal mark must not shift it)",
        x_with,
        x_without
    );

    // The rehearsal mark is anchored at the measure's left barline, while the
    // direction stays aligned with its note. The mark's box therefore sits to
    // the LEFT of the direction rather than stacking on top of it, so the two
    // never collide. The box has a transparent background (no fill), so derive
    // its right edge from the rehearsal-mark border lines.
    let score = crate::parse::parse_mnx(with_mark).unwrap();
    let dl = layout_score(&score, 0, &config);
    let box_right = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(cmd, id)| match (cmd, id.as_deref()) {
            (RenderCommand::DrawLine { x1, x2, .. }, Some("m0/rehearsal")) => Some((*x1).max(*x2)),
            _ => None,
        })
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        box_right.is_finite(),
        "Should have rehearsal-mark border lines"
    );
    assert!(
        box_right <= x_with + 0.01 * sp,
        "rehearsal box right={:.1} should be left of 'a tempo' x={:.1} (mark sits at the barline, direction at the note)",
        box_right,
        x_with
    );
}

// ═══════════════════════════════════════
// Slur-collision lift for above-staff directions
// ═══════════════════════════════════════

#[test]
fn test_above_text_lifts_over_slur() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let staff_y = 100.0;

    let mut dl = DisplayList::new(400.0, 400.0);

    // Above-staff expression ("arco") with an alphabetic baseline (matching the
    // production convention) sitting just above the top staff line — directly in
    // the path of a slur arching above.
    let text_baseline_y = staff_y - 1.0 * sp; // 88.0
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 20.0,
            y: text_baseline_y,
            text: "arco".to_string(),
            size: 24.0,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
            color: "#000000".to_string(),
        },
        "p0/m0/expr0".to_string(),
    );

    // A slur arching above the chord (curve_dir < 0). Its apex (smallest y) sits
    // at y≈80, well inside the text's vertical band.
    dl.slur_geometries.push(SlurGeometry {
        element_id: "slur/p0/m0/s0/ev0->p0/m0/s0/ev2".to_string(),
        p0_x: 0.0,
        p0_y: 98.0,
        p1_x: 20.0,
        p1_y: 74.0,
        p2_x: 40.0,
        p2_y: 74.0,
        p3_x: 60.0,
        p3_y: 98.0,
        thickness: 2.0,
        curve_dir: -1.0,
        sp,
    });

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), staff_y, sp);

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "arco" => Some(*y),
            _ => None,
        })
        .expect("arco text command should exist");

    // The text must have moved up (smaller y) so its bottom clears the slur's
    // upper edge. The cubic apex sits at y≈80.5; the upper edge is ~79.5; with
    // 0.4*sp clearance the new bottom should land near 74.7.
    assert!(
        new_y < text_baseline_y,
        "arco should lift above the slur: new_y={:.1} should be < {:.1}",
        new_y,
        text_baseline_y
    );
    assert!(
        new_y < 76.0,
        "arco bottom new_y={:.1} should clear the slur apex band",
        new_y
    );
}

#[test]
fn test_above_text_not_lifted_when_slur_clears_it() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let staff_y = 100.0;
    let mut dl = DisplayList::new(400.0, 400.0);

    let text_baseline_y = staff_y - 1.0 * sp; // 88.0
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 20.0,
            y: text_baseline_y,
            text: "arco".to_string(),
            size: 24.0,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Bottom,
            color: "#000000".to_string(),
        },
        "p0/m0/expr0".to_string(),
    );

    // Slur that does NOT overlap the text horizontally — far to the right.
    dl.slur_geometries.push(SlurGeometry {
        element_id: "slur".to_string(),
        p0_x: 200.0,
        p0_y: 98.0,
        p1_x: 220.0,
        p1_y: 74.0,
        p2_x: 240.0,
        p2_y: 74.0,
        p3_x: 260.0,
        p3_y: 98.0,
        thickness: 2.0,
        curve_dir: -1.0,
        sp,
    });

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), staff_y, sp);

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "arco" => Some(*y),
            _ => None,
        })
        .unwrap();
    assert!(
        (new_y - text_baseline_y).abs() < 1e-9,
        "arco should not move when the slur doesn't overlap it"
    );
}

#[test]
fn test_tempo_lifts_over_tie() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let mut dl = DisplayList::new(400.0, 400.0);

    // Tempo label ("rit.") with the default Middle baseline, sitting above the
    // staff directly in the path of a tie arching above. Bottom edge = y + size/2.
    let tempo_y = 88.0;
    let tempo_size = 24.0;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 20.0,
            y: tempo_y,
            text: "rit.".to_string(),
            size: tempo_size,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "p0/m0/tempo0".to_string(),
    );

    // A tie arching above the chord — rendered as a DrawFilledBezier crescent
    // (NOT a SlurGeometry), tagged `tie/…`. Outer control points sit above the
    // endpoints (apex ≈ y 80), inside the tempo text's vertical band.
    dl.push_tagged(
        RenderCommand::DrawFilledBezier {
            x1: 0.0,
            y1: 98.0,
            x2: 60.0,
            y2: 98.0,
            ocx1: 20.0,
            ocy1: 74.0,
            ocx2: 40.0,
            ocy2: 74.0,
            icx1: 20.0,
            icy1: 78.0,
            icx2: 40.0,
            icy2: 78.0,
            ix1: 0.0,
            iy1: 98.0,
            ix2: 60.0,
            iy2: 98.0,
            color: "#000000".to_string(),
            line_style: 0,
        },
        "tie/p0/m0/n0/p0/m1/n0".to_string(),
    );

    let slur_start = dl.slur_geometries.len();
    flow_above_staff_dependents(
        &mut dl,
        0,
        slur_start,
        &[],
        &PlacementTable::default(),
        100.0,
        sp,
    );

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "rit." => Some(*y),
            _ => None,
        })
        .expect("rit. tempo command should exist");

    // The tempo must have moved up so its bottom (y + size/2) clears the tie's
    // upper edge (apex ≈ 80) with 0.4*sp clearance.
    assert!(
        new_y < tempo_y,
        "rit. should lift above the tie: new_y={new_y:.1} should be < {tempo_y:.1}"
    );
    let new_bottom = new_y + tempo_size * 0.5;
    assert!(
        new_bottom <= 80.0 - 0.4 * sp + 0.5,
        "rit. bottom new_bottom={new_bottom:.1} should clear the tie apex band"
    );
}

#[test]
fn test_tempo_not_lifted_when_tie_clears_it() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let mut dl = DisplayList::new(400.0, 400.0);

    let tempo_y = 88.0;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 20.0,
            y: tempo_y,
            text: "rit.".to_string(),
            size: 24.0,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "p0/m0/tempo0".to_string(),
    );

    // Tie far to the right — no horizontal overlap with the tempo span.
    dl.push_tagged(
        RenderCommand::DrawFilledBezier {
            x1: 200.0,
            y1: 98.0,
            x2: 260.0,
            y2: 98.0,
            ocx1: 220.0,
            ocy1: 74.0,
            ocx2: 240.0,
            ocy2: 74.0,
            icx1: 220.0,
            icy1: 78.0,
            icx2: 240.0,
            icy2: 78.0,
            ix1: 200.0,
            iy1: 98.0,
            ix2: 260.0,
            iy2: 98.0,
            color: "#000000".to_string(),
            line_style: 0,
        },
        "tie/p0/m0/n9/p0/m1/n9".to_string(),
    );

    let slur_start = dl.slur_geometries.len();
    flow_above_staff_dependents(
        &mut dl,
        0,
        slur_start,
        &[],
        &PlacementTable::default(),
        100.0,
        sp,
    );

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "rit." => Some(*y),
            _ => None,
        })
        .unwrap();
    assert!(
        (new_y - tempo_y).abs() < 1e-9,
        "rit. should not move when the tie doesn't overlap it"
    );
}

#[test]
fn test_tempo_lifts_over_pizz_direction() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let staff_y = 100.0;
    let mut dl = DisplayList::new(400.0, 400.0);

    // A playing direction ("pizz.") above the staff — alphabetic baseline at
    // 1sp above the top staff line (the box bottom IS the baseline). Its ink top
    // sits `0.82 em` higher (the ascender band).
    let pizz_y = staff_y - 1.0 * sp; // 88.0, baseline = box bottom
    let pizz_size = 24.0;
    let pizz_top = pizz_y - 0.82 * pizz_size; // ascender band top
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 20.0,
            y: pizz_y,
            text: "pizz.".to_string(),
            size: pizz_size,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Alphabetic,
            color: "#000000".to_string(),
        },
        "p0/m0/expr0".to_string(),
    );

    // A tempo word at its default height (2.5sp above the staff, Middle
    // baseline) overlapping the direction horizontally — they collide.
    let tempo_y = staff_y - 2.5 * sp; // 70.0, optical centre
    let tempo_size = 24.0;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 20.0,
            y: tempo_y,
            text: "Molto moderato".to_string(),
            size: tempo_size,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "m0/tempo0".to_string(),
    );

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), staff_y, sp);

    let new_tempo_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "Molto moderato" => Some(*y),
            _ => None,
        })
        .expect("tempo text command should exist");
    let new_pizz_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "pizz." => Some(*y),
            _ => None,
        })
        .expect("pizz text command should exist");

    // The direction holds its place; the tempo yields and moves up.
    assert!(
        (new_pizz_y - pizz_y).abs() < 1e-9,
        "pizz. must keep its position (it takes precedence)"
    );
    assert!(
        new_tempo_y < tempo_y,
        "tempo should move up: new {:.1} should be < {:.1}",
        new_tempo_y,
        tempo_y
    );
    // Its lowest edge (Middle baseline ⇒ +size/2) must clear the direction top.
    let new_tempo_bottom = new_tempo_y + tempo_size * 0.5;
    assert!(
        new_tempo_bottom <= pizz_top - 0.4 * sp + 1e-6,
        "tempo bottom {:.1} must clear pizz top {:.1}",
        new_tempo_bottom,
        pizz_top
    );
}

#[test]
fn test_above_direction_not_lifted_over_stemless_whole_notes() {
    // An above-staff direction ("arco") over a bar of WHOLE notes must NOT lift
    // to clear a stem that is never drawn. Whole notes carry a notional
    // `stem_up` (for tie/slur orientation) but no stem; the base obstacle scan
    // must gate the stem-tip on `has_stem()`, else the direction floats up over
    // phantom ink (Rhapsody rehearsal 28: an octave dyad of whole notes pushed
    // "arco" ~1.5sp above its 1sp default for nothing). With stem-up QUARTER
    // notes at the same pitch the lift IS legitimate — assert the contrast.
    let mk = |base: &str| {
        format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{
                    "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                    "_x": {{"viritura": {{"expressions": [{{"text": "arco", "position": {{"fraction": [0, 1]}}, "placement": "above"}}]}}}},
                    "sequences": [{{"content": [
                        {{"duration": {{"base": "{base}"}}, "notes": [
                            {{"pitch": {{"step": "E", "octave": 4}}}},
                            {{"pitch": {{"step": "E", "octave": 5}}}}
                        ]}}
                    ]}}]
                }}]}}]
            }}"#
        )
    };
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    let arco_y = |json: &str| -> f64 {
        let score = crate::parse::parse_mnx(json).unwrap();
        let dl = layout_score(&score, 0, &config);
        dl.commands
            .iter()
            .find_map(|cmd| match cmd {
                RenderCommand::DrawText { y, text, .. } if text == "arco" => Some(*y),
                _ => None,
            })
            .expect("arco text should render")
    };

    // Whole notes: no stem → arco sits at its 1sp default baseline.
    let whole_y = arco_y(&mk("whole"));
    let default_baseline = staff_y - 1.0 * sp;
    assert!(
        (whole_y - default_baseline).abs() < 0.6 * sp,
        "arco over whole notes should sit ~1sp above the staff (no phantom stem): \
         got y={whole_y:.1}, default={default_baseline:.1}"
    );

    // Quarter notes at the same high pitch: the up-stem is real and tall, so
    // arco legitimately lifts well above the default.
    let quarter_y = arco_y(&mk("quarter"));
    assert!(
        quarter_y < whole_y - 0.5 * sp,
        "arco over stem-up quarter notes should lift above the whole-note case: \
         quarter y={quarter_y:.1} vs whole y={whole_y:.1}"
    );
}

#[test]
fn test_tempo_not_lifted_when_direction_elsewhere() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let staff_y = 100.0;
    let mut dl = DisplayList::new(400.0, 400.0);

    // A direction far to the right — no horizontal overlap with the tempo.
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 300.0,
            y: staff_y - 1.0 * sp,
            text: "pizz.".to_string(),
            size: 24.0,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Bottom,
            color: "#000000".to_string(),
        },
        "p0/m0/expr0".to_string(),
    );

    let tempo_y = staff_y - 2.5 * sp;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 20.0,
            y: tempo_y,
            text: "Allegro".to_string(),
            size: 24.0,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "m0/tempo0".to_string(),
    );

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), staff_y, sp);

    let new_tempo_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "Allegro" => Some(*y),
            _ => None,
        })
        .unwrap();
    assert!(
        (new_tempo_y - tempo_y).abs() < 1e-9,
        "tempo should not move when no direction overlaps it"
    );
}

#[test]
fn test_tempo_lifts_over_rehearsal_box() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let mut dl = DisplayList::new(400.0, 400.0);

    // Tempo label ("poco rit.") at Middle baseline; bottom edge = y + size/2.
    let tempo_y = 60.0;
    let tempo_size = 24.0;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 40.0,
            y: tempo_y,
            text: "poco rit.".to_string(),
            size: tempo_size,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "p0/m0/tempo0".to_string(),
    );

    // A downstream rehearsal box ("2") whose frame overhangs back to the left,
    // overlapping the tempo's right portion. Box spans x[80..120], y[56..96] —
    // its top (56) sits inside the tempo's vertical band (48..72).
    for (x1, y1, x2, y2) in [
        (80.0, 56.0, 120.0, 56.0),
        (80.0, 96.0, 120.0, 96.0),
        (80.0, 56.0, 80.0, 96.0),
        (120.0, 56.0, 120.0, 96.0),
    ] {
        dl.push_tagged(
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width: 1.0,
                color: "#000000".to_string(),
            },
            "p0/m1/rehearsal/m1".to_string(),
        );
    }

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), 100.0, sp);

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "poco rit." => Some(*y),
            _ => None,
        })
        .expect("poco rit. tempo command should exist");

    assert!(
        new_y < tempo_y,
        "tempo should lift above the rehearsal box: new_y={new_y:.1} < {tempo_y:.1}"
    );
    let new_bottom = new_y + tempo_size * 0.5;
    assert!(
        new_bottom <= 56.0 - 0.4 * sp + 0.5,
        "tempo bottom new_bottom={new_bottom:.1} should clear the box top (56)"
    );
}

#[test]
fn test_tempo_not_lifted_when_rehearsal_box_flows_right() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let mut dl = DisplayList::new(400.0, 400.0);

    // Same-measure layout: the tempo flows to the RIGHT of its box, so there is
    // no horizontal overlap and the tempo must stay put.
    let tempo_y = 60.0;
    let tempo_size = 24.0;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 140.0,
            y: tempo_y,
            text: "a tempo".to_string(),
            size: tempo_size,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "p0/m0/tempo0".to_string(),
    );

    // Box sits entirely to the LEFT of the tempo (x[80..120]).
    for (x1, y1, x2, y2) in [
        (80.0, 56.0, 120.0, 56.0),
        (80.0, 96.0, 120.0, 96.0),
        (80.0, 56.0, 80.0, 96.0),
        (120.0, 56.0, 120.0, 96.0),
    ] {
        dl.push_tagged(
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width: 1.0,
                color: "#000000".to_string(),
            },
            "p0/m0/rehearsal/m0".to_string(),
        );
    }

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), 100.0, sp);

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "a tempo" => Some(*y),
            _ => None,
        })
        .unwrap();
    assert!(
        (new_y - tempo_y).abs() < 1e-9,
        "tempo should not move when the box flows to its left (no overlap)"
    );
}

#[test]
fn test_above_text_clears_articulation() {
    // An above-staff direction ("arco") sharing a note with an accent must sit
    // above the accent glyph, not collide with it. The accent protrudes above
    // the high notehead; standard engraving practice stacks the direction above
    // any articulation on the note.
    use crate::render::smufl::smufl;

    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 5}}], "markings": {"accent": {}}}
            ]}],
            "_x": {"viritura": {"expressions": [{"text": "arco", "position": {"fraction": [0, 1]}, "placement": "above"}]}}
        }]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse arco+accent");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Topmost accent glyph edge (articulation supplement block).
    let accent_top = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph {
                y, codepoint, size, ..
            } if (0xE4A0..=0xE4BF).contains(codepoint) => {
                let glyph_sp = size / 4.0;
                let (_bx, by, _bw, _bh) = smufl::glyph_bbox(*codepoint);
                Some(y + by * glyph_sp)
            }
            _ => None,
        })
        .fold(f64::INFINITY, f64::min);
    assert!(accent_top.is_finite(), "expected an accent glyph");

    // "arco" uses a Bottom baseline, so its y is the glyph bottom edge. It must
    // sit at or above the accent's top edge.
    let arco_bottom = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawText { y, text, .. } if text == "arco" => Some(*y),
            _ => None,
        })
        .expect("expected 'arco' text");
    assert!(
        arco_bottom <= accent_top + 0.01,
        "arco bottom {arco_bottom:.2} should clear accent top {accent_top:.2}"
    );
}

#[test]
fn test_tempo_lifts_over_tuplet_number() {
    use crate::layout::render_annotations::flow_above_staff_dependents;
    use crate::render::smufl::smufl;

    let sp = 12.0;
    let clearance = 0.4 * sp;
    let mut dl = DisplayList::new(600.0, 400.0);

    // Tempo label ("Molto allargando") at Middle baseline; bottom = y + size/2.
    let tempo_y = 60.0;
    let tempo_size = 24.0;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 40.0,
            y: tempo_y,
            text: "Molto allargando".to_string(),
            size: tempo_size,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "p0/m0/tempo0".to_string(),
    );

    // A triplet "3" glyph (SMuFL tupletNumber3) sitting high above the staff so
    // its accurate top lands inside the tempo's vertical band [48, 72].
    let cp = smufl::TUPLET_3;
    let glyph_size = 48.0;
    let scale = glyph_size / 4.0;
    let (_bx, by, _bw, _bh) = smufl::glyph_bbox(cp);
    // Choose the origin so the glyph's accurate top edge = 60 (mid-band).
    let glyph_y = 60.0 - by * scale;
    let glyph_top = glyph_y + by * scale; // == 60.0
    dl.push_tagged(
        RenderCommand::DrawGlyph {
            x: 100.0,
            y: glyph_y,
            codepoint: cp,
            font: "Bravura".to_string(),
            size: glyph_size,
            color: "#000000".to_string(),
            rotation: 0.0,
        },
        "p0/m0/s0/tuplet0".to_string(),
    );

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), 100.0, sp);

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "Molto allargando" => Some(*y),
            _ => None,
        })
        .expect("Molto allargando tempo command should exist");

    assert!(
        new_y < tempo_y,
        "tempo should lift above the tuplet number: new_y={new_y:.1} < {tempo_y:.1}"
    );
    let new_bottom = new_y + tempo_size * 0.5;
    assert!(
        new_bottom <= glyph_top - clearance + 0.5,
        "tempo bottom new_bottom={new_bottom:.1} should clear the tuplet top ({glyph_top:.1}) by the clearance"
    );
}

#[test]
fn test_tempo_not_lifted_when_tuplet_flows_right() {
    use crate::layout::render_annotations::flow_above_staff_dependents;
    use crate::render::smufl::smufl;

    let sp = 12.0;
    let mut dl = DisplayList::new(600.0, 400.0);

    // Tempo near the left; tuplet number well to the RIGHT (no horizontal
    // overlap), so the tempo must stay put.
    let tempo_y = 60.0;
    let tempo_size = 24.0;
    dl.push_tagged(
        RenderCommand::DrawText {
            x: 40.0,
            y: tempo_y,
            text: "rit.".to_string(),
            size: tempo_size,
            font: "serif".to_string(),
            align: TextAlign::Left,
            baseline: TextBaseline::Middle,
            color: "#000000".to_string(),
        },
        "p0/m0/tempo0".to_string(),
    );
    let cp = smufl::TUPLET_3;
    let glyph_size = 48.0;
    let scale = glyph_size / 4.0;
    let (_bx, by, _bw, _bh) = smufl::glyph_bbox(cp);
    dl.push_tagged(
        RenderCommand::DrawGlyph {
            x: 400.0,
            y: 60.0 - by * scale,
            codepoint: cp,
            font: "Bravura".to_string(),
            size: glyph_size,
            color: "#000000".to_string(),
            rotation: 0.0,
        },
        "p0/m0/s0/tuplet0".to_string(),
    );

    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), 100.0, sp);

    let new_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { y, text, .. } if text == "rit." => Some(*y),
            _ => None,
        })
        .expect("rit. tempo command should exist");
    assert!(
        (new_y - tempo_y).abs() < 1e-9,
        "tempo should not move when no tuplet overlaps it: new_y={new_y:.1}"
    );
}

// ═══════════════════════════════════════
// Horizontal neutral-whitespace envelope (§5 dodge)
// ═══════════════════════════════════════

/// A slur arching above `[0, 60]` with its apex around `y = 75.5`. An above-staff
/// expression whose ink sits under the apex must clear it; with rightward neutral
/// whitespace (a rest) it should slide *past the slur's right end* instead of
/// stacking upward.
fn arch_slur(x0: f64, x1: f64) -> SlurGeometry {
    let span = x1 - x0;
    SlurGeometry {
        element_id: "slur/test".to_string(),
        p0_x: x0,
        p0_y: 98.0,
        p1_x: x0 + span * 0.25,
        p1_y: 68.0,
        p2_x: x0 + span * 0.75,
        p2_y: 68.0,
        p3_x: x1,
        p3_y: 98.0,
        thickness: 3.0,
        curve_dir: -1.0,
        sp: 12.0,
    }
}

#[test]
fn test_horizontal_dodge_slides_over_rest_past_slur() {
    use crate::layout::render_annotations::horizontal_dodge_clear;

    let sp = 12.0;
    let clearance = 0.4 * sp;
    let slurs = vec![arch_slur(0.0, 60.0)];
    // Expression ink [40, 80], bottom y = 88 (top = 72). It overlaps the slur's
    // right half near the apex, so a vertical lift is forced.
    let (left, right, bottom) = (40.0, 80.0, 88.0);
    // Envelope: no leftward room (min_left = left), but rightward room out to
    // left-edge 65 — enough to clear the slur (right end at x = 60).
    let dx = horizontal_dodge_clear(&slurs, left, right, bottom, clearance, left, 65.0, sp)
        .expect("a rightward slide past the slur should clear it");
    assert!(
        dx > sp,
        "must slide meaningfully right toward the slur's low end: dx={dx:.1}"
    );
    assert!(
        left + dx <= 65.0 + 1e-6,
        "slide must stay within the neutral envelope (max left-edge 65): dx={dx:.1}"
    );
}

#[test]
fn test_horizontal_dodge_none_when_envelope_collapsed() {
    use crate::layout::render_annotations::horizontal_dodge_clear;

    let sp = 12.0;
    let clearance = 0.4 * sp;
    let slurs = vec![arch_slur(0.0, 60.0)];
    let (left, right, bottom) = (40.0, 80.0, 88.0);
    // Collapsed envelope (a dense run on both sides): no neutral whitespace to
    // consume, so the dodge declines and the caller stacks vertically instead.
    let dx = horizontal_dodge_clear(&slurs, left, right, bottom, clearance, left, left, sp);
    assert!(
        dx.is_none(),
        "with no neutral whitespace the dodge must decline (got {dx:?})"
    );
}

/// The grounded ranks place expressions nearer the staff than tempo markings,
/// which is what drives the single outward order of the unified sweep. Assert it
/// in data so a future edit to `placementDefaults.json` can't silently flip it.
#[test]
fn test_expression_rank_below_tempo() {
    let table = PlacementTable::default();
    let expr = table.resolve(ElementKind::Expression).stack_rank;
    let tempo = table.resolve(ElementKind::Tempo).stack_rank;
    assert!(
        expr < tempo,
        "expression rank ({expr}) must sit below tempo rank ({tempo}) so tempo rises above it"
    );
}

/// The unified sweep is ordered by grounded `stack_rank`, not by the order the
/// markings are emitted. Build the same overlapping expression + tempo two ways
/// — expression-first and tempo-first — and assert both settle identically.
#[test]
fn test_unified_sweep_order_independent() {
    use crate::layout::render_annotations::flow_above_staff_dependents;

    let sp = 12.0;
    let staff_y = 100.0;

    // An above-staff expression (Bottom baseline) and a tempo (Middle baseline)
    // sharing the same beat, so the tempo must rise above the expression.
    let expr_cmd = || RenderCommand::DrawText {
        x: 20.0,
        y: staff_y - 1.0 * sp, // 88.0
        text: "dolce".to_string(),
        size: 24.0,
        font: "serif".to_string(),
        align: TextAlign::Left,
        baseline: TextBaseline::Bottom,
        color: "#000000".to_string(),
    };
    let tempo_cmd = || RenderCommand::DrawText {
        x: 20.0,
        y: staff_y - 2.5 * sp, // 70.0
        text: "Allegro".to_string(),
        size: 24.0,
        font: "serif".to_string(),
        align: TextAlign::Left,
        baseline: TextBaseline::Middle,
        color: "#000000".to_string(),
    };

    let settle = |expr_first: bool| -> (f64, f64) {
        let mut dl = DisplayList::new(400.0, 400.0);
        if expr_first {
            dl.push_tagged(expr_cmd(), "p0/m0/expr0".to_string());
            dl.push_tagged(tempo_cmd(), "m0/tempo0".to_string());
        } else {
            dl.push_tagged(tempo_cmd(), "m0/tempo0".to_string());
            dl.push_tagged(expr_cmd(), "p0/m0/expr0".to_string());
        }
        flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), staff_y, sp);
        let y_of = |needle: &str| {
            dl.commands
                .iter()
                .find_map(|cmd| match cmd {
                    RenderCommand::DrawText { y, text, .. } if text == needle => Some(*y),
                    _ => None,
                })
                .expect("text command should exist")
        };
        (y_of("dolce"), y_of("Allegro"))
    };

    let (expr_a, tempo_a) = settle(true);
    let (expr_b, tempo_b) = settle(false);

    assert!(
        (expr_a - expr_b).abs() < 1e-9 && (tempo_a - tempo_b).abs() < 1e-9,
        "final positions must be emission-order independent: expr {expr_a:.3} vs {expr_b:.3}, tempo {tempo_a:.3} vs {tempo_b:.3}"
    );
    // Sanity: the tempo did rise above the expression (it cleared the expr top).
    assert!(
        tempo_a < expr_a,
        "tempo (y={tempo_a:.1}) should sit above the expression (y={expr_a:.1})"
    );
}

#[test]
fn test_metronome_dodges_left_of_rehearsal_frame_instead_of_lifting() {
    // Rhapsody Viola, bar 114: a "♩=140" metronome mark sits at the downbeat of
    // a whole-rest bar, immediately before rehearsal mark "12" (bar 115), whose
    // boxed frame is centred on the shared barline and reaches back over the
    // tempo's trailing digits. The tempo must NOT lift ~5sp to clear the whole
    // frame; over a rest bar it should slide LEFT into the gutter (down to the
    // opening barline) and clear the frame horizontally, staying at its default
    // baseline. Regression for the "too much red box" over-lift.
    use crate::layout::layout_with_mnx_scores;

    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx"
    ))
    .expect("read Rhapsody");
    let mut score = crate::parse::parse_mnx(&json).expect("parse Rhapsody");
    crate::reconcile::reconcile_score(&mut score);

    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..Default::default()
    };
    // Score index 32 = Viola.
    let dl = layout_with_mnx_scores(&score, &config, 32);
    let sp = config.sp;

    // The "= 140" metronome text in measure index 113 (bar 114).
    let (tempo_y, tempo_x) = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(i, cmd)| match cmd {
            RenderCommand::DrawText { x, y, text, .. } if text.contains("140") => {
                let id = dl.element_ids.get(i).and_then(|o| o.as_ref());
                id.is_some_and(|s| s.contains("m113/tempo"))
                    .then_some((*y, *x))
            }
            _ => None,
        })
        .expect("the ♩=140 metronome text should render in m113");

    // The rehearsal "12" frame (m114/rehearsal) — the obstacle.
    let reh = dl
        .element_bboxes
        .iter()
        .find(|b| b.element_id == "m114/rehearsal")
        .map(|b| b.bbox.clone())
        .expect("rehearsal 12 frame bbox should exist");

    // The tempo's own bbox (the whole metronome block).
    let tempo_bbox = dl
        .element_bboxes
        .iter()
        .find(|b| b.element_id == "m113/tempo0")
        .map(|b| b.bbox.clone())
        .expect("metronome tempo bbox should exist");

    // Infer the staff top from the nearest 5 staff lines under the tempo.
    let mut staff_lines: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } if (y1 - y2).abs() < 0.01
                && *width < 0.5 * sp
                && x1.min(*x2) <= tempo_x + 20.0 * sp
                && x1.max(*x2) >= tempo_x - 20.0 * sp =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .collect();
    staff_lines.sort_by(|a, b| a.partial_cmp(b).unwrap());
    staff_lines.dedup_by(|a, b| (*a - *b).abs() < 0.5);
    let staff_top = staff_lines
        .first()
        .copied()
        .expect("staff lines near tempo");

    // (1) NOT over-lifted: the metronome baseline stays near the 2sp default
    // (the bug lifted it to ~5.4sp). Allow a little slack for justification.
    let lift_sp = (staff_top - tempo_y) / sp;
    assert!(
        lift_sp < 3.0,
        "metronome baseline should stay near the 2sp default, not lift to clear \
         the whole rehearsal frame: lift={lift_sp:.2}sp"
    );

    // (2) It dodged: the tempo's right edge now clears the rehearsal frame's
    // left edge horizontally (the collision is resolved sideways, not vertically).
    assert!(
        tempo_bbox.x + tempo_bbox.width <= reh.x + 1.0,
        "metronome right edge ({:.1}) should clear the rehearsal frame left ({:.1})",
        tempo_bbox.x + tempo_bbox.width,
        reh.x
    );
}
