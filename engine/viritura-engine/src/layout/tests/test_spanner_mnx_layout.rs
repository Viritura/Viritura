// Regression tests for hairpin/pedal/ottava rendering through the MNX score layout pipeline.
//
// These test the fix for build_virtual_part_measure() which previously dropped
// hairpins, pedals, ottavas, and chord_symbols (hardcoded to None).

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::mnx_layout::layout_with_mnx_scores;
use crate::parse::parse_mnx;

/// Helper: build a minimal 2-part score with MNX layouts/scores definitions.
/// Extensions are added to the specified part's first measure via `_x.viritura`.
fn build_mnx_score_with_extension(ext_part: usize, ext_json: &str) -> String {
    let mut parts = Vec::new();
    for i in 0..2 {
        let ext = if i == ext_part {
            format!(
                r#",
                "_x": {{
                    "viritura": {{
                        {}
                    }}
                }}"#,
                ext_json
            )
        } else {
            String::new()
        };
        parts.push(format!(r#"{{
            "id": "P{}",
            "name": "Part {}",
            "measures": [
                {{
                    "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                    "sequences": [{{"content": [
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"octave": 4, "step": "C"}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"octave": 4, "step": "D"}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"octave": 4, "step": "E"}}}}]}},
                        {{"duration": {{"base": "quarter"}}, "notes": [{{"pitch": {{"octave": 4, "step": "F"}}}}]}}
                    ]}}]{}
                }},
                {{"sequences": [{{"content": [{{"duration": {{"base": "whole"}}, "rest": {{}}}}]}}]}},
                {{"sequences": [{{"content": [{{"duration": {{"base": "whole"}}, "rest": {{}}}}]}}]}}
            ]
        }}"#, i, i, ext));
    }

    format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{"measures": [
            {{"id": "m1", "time": {{"count": 4, "unit": 4}}}},
            {{"id": "m2"}},
            {{"id": "m3"}}
        ]}},
        "parts": [{}],
        "layouts": [
            {{
                "id": "FullScore",
                "content": [
                    {{"type": "staff", "sources": [{{"part": "P0"}}], "label": "Part 0"}},
                    {{"type": "staff", "sources": [{{"part": "P1"}}], "label": "Part 1"}}
                ]
            }}
        ],
        "scores": [
            {{
                "name": "Full Score",
                "layout": "FullScore",
                "pages": []
            }}
        ]
    }}"#,
        parts.join(",")
    )
}

fn build_mnx_score_with_dynamics(part_index: usize, dynamics_json: &str) -> String {
    let base = build_mnx_score_with_extension(part_index, "");
    let mut value: serde_json::Value = serde_json::from_str(&base).unwrap();
    value["parts"][part_index]["measures"][0]["dynamics"] =
        serde_json::from_str(dynamics_json).unwrap();
    serde_json::to_string(&value).unwrap()
}

// ═══════════════════════════════════════════
// Regression: hairpins in MNX score layout
// ═══════════════════════════════════════════

#[test]
fn test_hairpin_renders_in_mnx_score_layout() {
    let json = build_mnx_score_with_dynamics(
        0,
        r#"[{
            "id": "dyn-hairpin-1",
            "type": "gradual",
            "position": {"fraction": [1, 4]},
            "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
            "wedgeType": "increasing"
        }]"#,
    );
    let score = parse_mnx(&json).expect("Failed to parse");
    assert!(
        score.parts[0].measures[0].dynamics.is_some(),
        "Hairpins should parse"
    );

    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let hairpin_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("hairpin"))
        .collect();
    assert!(!hairpin_ids.is_empty(),
        "Hairpins should render in layout_with_mnx_scores (was a regression: build_virtual_part_measure dropped them)");
    assert_eq!(
        hairpin_ids.len(),
        2,
        "Crescendo hairpin = 2 DrawLine commands"
    );
}

#[test]
fn test_hairpin_on_second_part_renders_in_mnx_score_layout() {
    let json = build_mnx_score_with_dynamics(
        1,
        r#"[{
            "id": "dyn-hairpin-2",
            "type": "gradual",
            "position": {"fraction": [0, 1]},
            "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
            "wedgeType": "decreasing"
        }]"#,
    );
    let score = parse_mnx(&json).expect("Failed to parse");
    assert!(score.parts[1].measures[0].dynamics.is_some());

    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let hairpin_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("hairpin"))
        .collect();
    assert!(
        !hairpin_ids.is_empty(),
        "Hairpins on part 1 should render in MNX score layout"
    );
}

// ═══════════════════════════════════════════
// Regression: pedals in MNX score layout
// ═══════════════════════════════════════════

#[test]
fn test_pedal_renders_in_mnx_score_layout() {
    let json = build_mnx_score_with_extension(
        0,
        r#"
        "pedals": [{
            "type": "sustain",
            "position": {"fraction": [0, 1]},
            "end": {"measure": "m1", "position": {"fraction": [3, 4]}}
        }]
    "#,
    );
    let score = parse_mnx(&json).expect("Failed to parse");
    assert!(
        score.parts[0].measures[0].pedals.is_some(),
        "Pedals should parse"
    );

    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let pedal_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("pedal"))
        .collect();
    assert!(!pedal_ids.is_empty(),
        "Pedals should render in layout_with_mnx_scores (was a regression: build_virtual_part_measure dropped them)");
}

// ═══════════════════════════════════════════
// Regression: chord symbols in MNX score layout
// ═══════════════════════════════════════════

#[test]
fn test_chord_symbols_render_in_mnx_score_layout() {
    let json = build_mnx_score_with_extension(
        0,
        r#"
        "chordSymbols": [{
            "position": {"fraction": [0, 1]},
            "root": {"step": "C"},
            "quality": "major"
        }]
    "#,
    );
    let score = parse_mnx(&json).expect("Failed to parse");
    assert!(
        score.parts[0].measures[0].chord_symbols.is_some(),
        "Chord symbols should parse"
    );

    let config = LayoutConfig::default();
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let chord_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("chord"))
        .collect();
    assert!(!chord_ids.is_empty(),
        "Chord symbols should render in layout_with_mnx_scores (was a regression: build_virtual_part_measure dropped them)");
}

// ═══════════════════════════════════════════
// Cross-barline hairpin rendering
// ═══════════════════════════════════════════

#[test]
fn test_cross_barline_hairpin_renders() {
    // Hairpin starts in m1, ends in m2
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "time": {"count": 4, "unit": 4}},
            {"id": "m2"}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "C"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "D"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "E"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "F"}}]}
                ]}],
                "dynamics": [{
                    "id": "cross-barline-hairpin",
                    "type": "gradual",
                    "position": {"fraction": [2, 4]},
                    "end": {"measure": "m2", "position": {"fraction": [2, 4]}},
                    "wedgeType": "increasing"
                }]
            },
            {
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "G"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "A"}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"octave": 4, "step": "B"}}]}
                ]}]
            }
        ]}]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let hairpin_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("hairpin"))
        .collect();
    assert_eq!(
        hairpin_ids.len(),
        2,
        "Cross-barline hairpin should produce 2 DrawLine commands"
    );

    // Verify the hairpin spans across the barline
    let hairpin_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|b| b.element_id.contains("hairpin"))
        .collect();
    assert_eq!(hairpin_bboxes.len(), 1, "Should have one hairpin bbox");
    let bbox = &hairpin_bboxes[0].bbox;

    let m1_end_x = dl
        .measure_bounds
        .iter()
        .find(|mb| mb.index == 0)
        .map(|mb| mb.x + mb.width)
        .expect("Should have measure 0 bounds");
    assert!(
        bbox.x + bbox.width > m1_end_x,
        "Cross-barline hairpin should extend past first measure (bbox end={}, m1 end={})",
        bbox.x + bbox.width,
        m1_end_x
    );
}

// ═══════════════════════════════════════════
// Single-part layout still works
// ═══════════════════════════════════════════

#[test]
fn test_hairpin_from_palette_single_part() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "time": {"count": 4, "unit": 4}},
            {"id": "m2"}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "C"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "D"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "E"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "F"}}]}
                ]}],
                "dynamics": [{
                    "id": "palette-hairpin",
                    "type": "gradual",
                    "position": {"fraction": [1, 4]},
                    "end": {"measure": "m1", "position": {"fraction": [4, 4]}},
                    "wedgeType": "increasing"
                }]
            },
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}
        ]}]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let hairpin_tagged: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("hairpin"))
        .collect();
    assert_eq!(
        hairpin_tagged.len(),
        2,
        "Single-part hairpin should produce 2 tagged commands"
    );

    let hairpin_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|b| b.element_id.contains("hairpin"))
        .collect();
    assert_eq!(hairpin_bboxes.len(), 1, "Should have one hairpin bbox");
}

// ═══════════════════════════════════════════
// Regression: ottava display transposition in MNX score layout
// ═══════════════════════════════════════════

#[test]
fn test_ottava_shifts_notes_in_mnx_score_layout() {
    // Two identical parts, part 0 has an 8va ottava over a C7 note.
    // In layout_with_mnx_scores, the ottava should shift C7 display to C6.
    // This was a regression: empty_ottavas was passed to layout_measure.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "time": {"count": 4, "unit": 4}}
        ]},
        "parts": [
            {
                "id": "P0",
                "name": "Part 0",
                "measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "C"}}]},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 7, "step": "C"}}]},
                        {"duration": {"base": "half"}, "notes": [{"pitch": {"octave": 4, "step": "E"}}]}
                    ]}],
                    "ottavas": [{
                        "value": 1,
                        "position": {"fraction": [1, 4]},
                        "end": {"measure": "m1", "position": {"fraction": [2, 4]}}
                    }]
                }]
            },
            {
                "id": "P1",
                "name": "Part 1",
                "measures": [{
                    "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                    "sequences": [{"content": [
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 4, "step": "C"}}]},
                        {"duration": {"base": "quarter"}, "notes": [{"pitch": {"octave": 7, "step": "C"}}]},
                        {"duration": {"base": "half"}, "notes": [{"pitch": {"octave": 4, "step": "E"}}]}
                    ]}]
                }]
            }
        ],
        "layouts": [{
            "id": "FullScore",
            "content": [
                {"type": "staff", "sources": [{"part": "P0"}], "label": "Part 0"},
                {"type": "staff", "sources": [{"part": "P1"}], "label": "Part 1"}
            ]
        }],
        "scores": [{
            "name": "Full Score",
            "layout": "FullScore",
            "pages": []
        }]
    }"#;

    let score = parse_mnx(json).expect("Failed to parse");
    let config = LayoutConfig::default();

    // Layout with MNX scores (the path used for orchestral template)
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Collect all noteheads: (x, y) pairs
    let noteheads: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let crate::render::RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = cmd
            {
                // Filled notehead = U+E0A2, half = U+E0A3, whole = U+E0A4
                if *codepoint == 0xE0A2 || *codepoint == 0xE0A3 || *codepoint == 0xE0A4 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Part 0 and Part 1 both have C7 at beat 2.
    // Part 0 has 8va → C7 should display as C6 (shifted down ~7 staff positions)
    // Part 1 has no ottava → C7 at its sounding position (very high up)
    //
    // If ottavas work, the C7 in Part 0 should be at a LOWER Y (higher on screen = smaller Y)
    // than without ottava, but significantly HIGHER Y (lower on staff) than Part 1's C7.
    //
    // Actually, 8va shifts display DOWN by 7 diatonic steps, so C7 displays as C6.
    // C6 Y > C7 Y (C6 is lower on the page = larger Y value).
    //
    // Strategy: find the two C7 noteheads (smallest Y values per staff group).
    // The Part 0 C7 (under 8va) should have a LARGER Y than Part 1's C7.

    // There should be 6 noteheads total (3 per part)
    assert!(
        noteheads.len() >= 6,
        "Expected at least 6 noteheads, got {}",
        noteheads.len()
    );

    // Sort by X to identify note order, then by Y to compare positions
    let mut sorted = noteheads.clone();
    sorted.sort_by(|a, b| {
        a.0.partial_cmp(&b.0)
            .unwrap()
            .then(a.1.partial_cmp(&b.1).unwrap())
    });

    // The two highest notes (smallest Y) should be the C7s.
    // Find the two noteheads with the smallest Y values.
    let mut by_y = noteheads.clone();
    by_y.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    let highest_two = &by_y[0..2];

    // The two C7 notes should have DIFFERENT Y positions because one is under 8va
    let y_diff = (highest_two[0].1 - highest_two[1].1).abs();
    let sp = config.sp;
    assert!(
        y_diff > 2.0 * sp,
        "C7 under 8va and C7 without ottava should display at different staff positions \
         (y_diff={:.1}, expected > {:.1}sp). Ottava display transposition may not be applied \
         in layout_with_mnx_scores.",
        y_diff,
        2.0
    );
}
