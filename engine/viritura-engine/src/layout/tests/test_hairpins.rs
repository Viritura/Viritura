// Auto-generated from tests.rs — test_hairpins
// 3 test(s)

use crate::layout::cache::LayoutCache;
use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores_cached};
use crate::render::*;
use std::collections::HashSet;

#[test]
fn test_hairpin_crescendo_render() {
    // Load hairpins.mnx: crescendo in m1, decrescendo in m2
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/hairpins.mnx"
    ))
    .expect("Failed to read hairpins.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse hairpins.mnx");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    // Hairpins are drawn as pairs of converging/diverging lines below the staff.
    // Look for lines below the staff that form the wedge shape.
    let below_staff_diag_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, x1, x2, .. } = cmd {
                // Non-horizontal, non-vertical lines below staff
                let below = *y1 > staff_bottom && *y2 > staff_bottom;
                let not_horiz = (*y1 - *y2).abs() > 0.1;
                let not_vert = (*x1 - *x2).abs() > 0.1;
                below && not_horiz && not_vert
            } else {
                false
            }
        })
        .collect();

    // Should have at least 4 diagonal lines (2 per hairpin × 2 hairpins)
    assert!(
        below_staff_diag_lines.len() >= 4,
        "Expected at least 4 hairpin lines below staff, got {}",
        below_staff_diag_lines.len()
    );
}

#[test]
fn test_hairpin_wedge_opening_angle() {
    // Verify that crescendo opens to the right (y values diverge at end)
    // and decrescendo opens to the left (y values diverge at start)
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/hairpins.mnx"
    ))
    .expect("Failed to read hairpins.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse hairpins.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    // Collect all diagonal lines below staff
    let diag_lines: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = cmd {
                let below = *y1 > staff_bottom && *y2 > staff_bottom;
                let not_horiz = (*y1 - *y2).abs() > 0.1;
                let not_vert = (*x1 - *x2).abs() > 0.1;
                if below && not_horiz && not_vert {
                    Some((*x1, *y1, *x2, *y2))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    assert!(
        diag_lines.len() >= 2,
        "Need at least 2 diagonal lines for a hairpin"
    );

    // For crescendo (first pair): lines should converge at x1 (same y1) and diverge at x2
    // Find a pair that shares approximately the same x1 (start of crescendo)
    let mut found_crescendo_pair = false;
    for i in 0..diag_lines.len() {
        for j in (i + 1)..diag_lines.len() {
            let (ax1, _ay1, ax2, ay2) = diag_lines[i];
            let (bx1, _by1, bx2, by2) = diag_lines[j];
            // Same start x (within tolerance)
            if (ax1 - bx1).abs() < 1.0 && (ax2 - bx2).abs() < 1.0 {
                // End y values should diverge (one above center, one below)
                let spread = (ay2 - by2).abs();
                if spread > 0.5 * sp {
                    found_crescendo_pair = true;
                    break;
                }
            }
        }
        if found_crescendo_pair {
            break;
        }
    }
    assert!(
        found_crescendo_pair,
        "Expected a crescendo/decrescendo wedge pair with diverging end points"
    );
}

#[test]
fn test_hairpin_orient_above_places_wedge_above_staff() {
    let json = r#"{
        "mnx": { "version": 1 },
        "global": { "measures": [{ "id": "m1", "time": { "count": 4, "unit": 4 } }] },
        "parts": [{ "measures": [{
            "sequences": [{ "content": [{ "duration": { "base": "whole" }, "rest": {} }] }],
            "dynamics": [{
                "id": "above-hairpin",
                "type": "gradual",
                "position": { "fraction": [0, 1] },
                "end": { "measure": "m1", "position": { "fraction": [1, 1] } },
                "wedgeType": "increasing",
                "orient": "above"
            }]
        }] }]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse above hairpin");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let staff_y = config.margin_top * config.sp;
    let wedge_lines: Vec<_> = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(command, id)| {
            if id.as_deref() == Some("p0/m0/hairpinabove-hairpin") {
                if let RenderCommand::DrawLine { y1, y2, .. } = command {
                    return Some((*y1, *y2));
                }
            }
            None
        })
        .collect();
    assert_eq!(wedge_lines.len(), 2);
    assert!(
        wedge_lines
            .iter()
            .all(|(y1, y2)| *y1 < staff_y && *y2 < staff_y),
        "above hairpin must remain above staff top {staff_y}: {wedge_lines:?}"
    );
}

#[test]
fn test_cross_measure_hairpin_keeps_full_horizontal_span() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m1", "time": {"count": 4, "unit": 4}},
            {"id": "m2"}
        ]},
        "parts": [{"measures": [
            {
                "dynamics": [
                    {"id": "start-p", "type": "immediate", "position": {"fraction": [0, 1]}, "value": "p"},
                    {"id": "cross-bar", "type": "gradual", "position": {"fraction": [0, 1]},
                     "end": {"measure": "m2", "position": {"fraction": [1, 1]}},
                     "wedgeType": "increasing", "visuallyContinues": "start-p"}
                ],
                "sequences": [{"content": [
                    {"id": "source", "duration": {"base": "whole"},
                     "notes": [{"id": "source-note", "pitch": {"step": "C", "octave": 4},
                                "ties": [{"target": "target-note"}]}]}
                ]}]
            },
            {
                "sequences": [{"content": [
                    {"id": "target", "duration": {"base": "whole"},
                     "notes": [{"id": "target-note", "pitch": {"step": "C", "octave": 4}}]}
                ]}]
            }
        ]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse cross-measure hairpin");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let lines: Vec<_> = dl
        .commands
        .iter()
        .zip(&dl.element_ids)
        .filter_map(|(command, id)| {
            if id.as_deref() != Some("p0/m0/hairpincross-bar") {
                return None;
            }
            if let RenderCommand::DrawLine { x1, x2, .. } = command {
                return Some((*x1, *x2));
            }
            None
        })
        .collect();

    assert_eq!(lines.len(), 2);
    assert!(
        lines.iter().all(|(x1, x2)| x2 - x1 > 10.0 * config.sp),
        "cross-measure wedge collapsed: {lines:?}"
    );
}

#[test]
fn test_dynamic_pinned_hairpin_clears_slur_over_full_span() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "_x": {"viritura": {"expressions": [
                {"text": "cresc.", "position": {"fraction": [0, 1]}}
            ]}},
            "dynamics": [
                {"id": "start-p", "type": "immediate", "position": {"fraction": [0, 1]}, "value": "p"},
                {"id": "under-slur", "type": "gradual", "position": {"fraction": [0, 1]},
                 "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
                 "wedgeType": "increasing", "visuallyContinues": "start-p"}
            ],
            "sequences": [{"content": [
                {"id": "slur-source", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "C", "octave": 4}}],
                 "slurs": [{"target": "slur-target", "side": "down"}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"id": "slur-target", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&crate::parse::parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .slur_geometries
        .iter()
        .find(|geometry| geometry.curve_dir > 0.0)
        .expect("below slur");
    let slur_bottom = slur.p0_y.max(slur.p1_y).max(slur.p2_y).max(slur.p3_y) + slur.thickness * 0.5;
    let hairpin_top = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(command, id)| {
            if id.as_deref() != Some("p0/m0/hairpinunder-slur") {
                return None;
            }
            match command {
                RenderCommand::DrawLine { y1, y2, .. } => Some(y1.min(*y2)),
                _ => None,
            }
        })
        .min_by(f64::total_cmp)
        .expect("hairpin lines");
    let dynamic_baseline = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .find_map(|(command, id)| match (command, id.as_deref()) {
            (RenderCommand::DrawGlyph { y, .. }, Some("p0/m0/dynstart-p")) => Some(*y),
            _ => None,
        })
        .expect("p dynamic baseline");
    let expression_baseline = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .find_map(|(command, id)| match (command, id.as_deref()) {
            (RenderCommand::DrawText { y, text, .. }, Some("p0/m0/expr0")) if text == "cresc." => {
                Some(*y)
            }
            _ => None,
        })
        .expect("cresc. expression baseline");

    assert!(
        hairpin_top >= slur_bottom + 0.4 * config.sp,
        "hairpin must clear the slur across its full span: top={hairpin_top:.2}, \
         slur_bottom={slur_bottom:.2}"
    );
    assert!(
        (dynamic_baseline - expression_baseline).abs() < 1.0e-9,
        "co-located p and cresc. must retain one baseline after slur clearance"
    );
}

#[test]
fn test_rhapsody_rehearsal_28_violin_hairpin_clears_slur() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/Rhapsody in Blue.mnx");
    let score = crate::parse::parse_mnx(json).expect("parse Rhapsody");
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };
    let mut cache = LayoutCache::new();
    let dl = layout_with_mnx_scores_cached(&score, &config, 29, Some(&mut cache));
    let hairpin_id = "p28/m302/hairpin9487eb6c-01f9-7cba-8995-37820ee3b3a7";
    let hairpin_lines: Vec<_> = dl
        .commands
        .iter()
        .zip(dl.element_ids.iter())
        .filter_map(|(command, id)| {
            if id.as_deref() != Some(hairpin_id) {
                return None;
            }
            match command {
                RenderCommand::DrawLine { x1, y1, x2, y2, .. } => Some((*x1, *y1, *x2, *y2)),
                _ => None,
            }
        })
        .collect();
    assert_eq!(hairpin_lines.len(), 2, "rehearsal-28 Violin I hairpin");
    let x_lo = hairpin_lines
        .iter()
        .flat_map(|line| [line.0, line.2])
        .fold(f64::INFINITY, f64::min);
    let x_hi = hairpin_lines
        .iter()
        .flat_map(|line| [line.0, line.2])
        .fold(f64::NEG_INFINITY, f64::max);
    let hairpin_top = hairpin_lines
        .iter()
        .flat_map(|line| [line.1, line.3])
        .fold(f64::INFINITY, f64::min);
    let relevant_slurs: Vec<_> = dl
        .slur_geometries
        .iter()
        .filter(|geometry| {
            geometry.curve_dir > 0.0
                && geometry.p3_x.max(geometry.p0_x) >= x_lo
                && geometry.p0_x.min(geometry.p3_x) <= x_hi
                && geometry.p0_y > hairpin_top - 4.0 * config.sp
                && geometry.p0_y < hairpin_top + 2.0 * config.sp
        })
        .cloned()
        .collect();
    let sampled_bottom =
        crate::layout::render_annotations::lowest_slur_edge_below(&relevant_slurs, x_lo, x_hi)
            .expect("sampled slur edge");
    let nearby_tie_bottom = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let is_tie = dl
                .element_ids
                .get(index)
                .and_then(|id| id.as_deref())
                .is_some_and(|id| id.starts_with("tie/"));
            if !is_tie {
                return None;
            }
            let RenderCommand::DrawFilledBezier {
                x1,
                y1,
                x2,
                y2,
                ocx1,
                ocy1,
                ocx2,
                ocy2,
                ..
            } = command
            else {
                return None;
            };
            if *ocy1 <= *y1
                || x1.max(*x2) < x_lo
                || x1.min(*x2) > x_hi
                || *y1 < hairpin_top - 4.0 * config.sp
                || *y1 > hairpin_top + 2.0 * config.sp
            {
                return None;
            }
            crate::layout::render_annotations::tie_lower_edge_over_span(
                (*x1, *y1),
                (*ocx1, *ocy1),
                (*ocx2, *ocy2),
                (*x2, *y2),
                x_lo,
                x_hi,
            )
        })
        .max_by(f64::total_cmp)
        .expect("nearby below tie");
    assert!(
        hairpin_top >= sampled_bottom + 0.9 * config.sp,
        "rehearsal-28 hairpin must clear its slur: top={hairpin_top:.2}, \
         slur_bottom={sampled_bottom:.2}"
    );
    assert!(
        hairpin_top >= nearby_tie_bottom + 0.9 * config.sp,
        "rehearsal-28 hairpin must clear its tie: top={hairpin_top:.2}, \
         tie_bottom={nearby_tie_bottom:.2}"
    );
}

#[test]
fn test_hairpin_position_below_staff() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/hairpins.mnx"
    ))
    .expect("Failed to read hairpins.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse hairpins.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    let min_y = staff_bottom + config.dynamics_min_distance * sp;

    // All hairpin lines should be at or below the minimum dynamics distance
    let diag_lines: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, x1, x2, .. } = cmd {
                let below = *y1 > staff_bottom && *y2 > staff_bottom;
                let not_horiz = (*y1 - *y2).abs() > 0.1;
                let not_vert = (*x1 - *x2).abs() > 0.1;
                if below && not_horiz && not_vert {
                    Some((*y1, *y2))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    assert!(!diag_lines.is_empty(), "Should have hairpin lines");
    for (y1, y2) in &diag_lines {
        let center_y = (y1 + y2) / 2.0;
        // Center should be at or below the minimum distance
        assert!(
            center_y >= min_y - 2.0 * sp,
            "Hairpin center y={} should be near or below min_y={}",
            center_y,
            min_y
        );
    }
}

#[test]
fn test_hairpin_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/hairpins.mnx"
    ))
    .expect("Failed to read hairpins.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse hairpins.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Hairpins should be tagged with element IDs like "p0/m0/hairpin0"
    let hairpin_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/hairpin"))
        .collect();
    assert!(
        !hairpin_ids.is_empty(),
        "Hairpin render commands should have element IDs"
    );

    // Each hairpin produces 2 tagged commands (two lines of the wedge)
    // Verify format: p{N}/m{N}/hairpin{N}
    for id in &hairpin_ids {
        assert!(
            id.starts_with("p"),
            "Hairpin ID should start with 'p': {}",
            id
        );
        assert!(id.contains("/m"), "Hairpin ID should contain '/m': {}", id);
        assert!(
            id.contains("/hairpin"),
            "Hairpin ID should contain '/hairpin': {}",
            id
        );
    }

    // Count unique hairpin IDs — each should have exactly 2 commands
    let unique_ids: HashSet<_> = hairpin_ids.iter().collect();
    for uid in &unique_ids {
        let count = hairpin_ids.iter().filter(|id| id == uid).count();
        assert_eq!(
            count, 2,
            "Hairpin {} should tag exactly 2 commands, got {}",
            uid, count
        );
    }
}

#[test]
fn test_hairpin_mid_measure_placement() {
    // Hairpin starts at beat 2 within a whole-note measure.
    // Should render at proportional position, not snapped to the whole note.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "dynamics": [{
                "type": "gradual",
                "position": {"fraction": [2, 4]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
                "wedgeType": "increasing"
            }],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let hairpin_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/hairpin"))
        .collect();
    assert_eq!(hairpin_bboxes.len(), 1, "Expected 1 hairpin bbox");

    let hb = &hairpin_bboxes[0];
    // The whole note bbox starts near the measure prefix
    let note_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/s0/"))
        .collect();
    assert!(!note_bboxes.is_empty(), "Should have note bboxes");
    let note_x = note_bboxes[0].bbox.x;

    // Hairpin at beat 2/4 should start well to the right of the note at beat 0
    assert!(hb.bbox.x > note_x + 10.0,
        "Hairpin at beat 2 should be positioned to the right of the whole note, got hairpin.x={:.1} vs note.x={:.1}",
        hb.bbox.x, note_x);
}

#[test]
fn test_hairpin_spine_aligns_to_dynamic_midline() {
    // A crescendo that begins at a dynamic should pin its spine to the optical
    // midline of the dynamic letters (~0.5sp above the glyph baseline), not to
    // an independent below-staff collision pass.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "dynamics": [
                {"type": "immediate", "position": {"fraction": [0, 1]}, "value": "p"},
                {"type": "gradual",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [3, 4]}},
                "wedgeType": "increasing"}
            ],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Dynamic glyph baseline Y (dynamics codepoints live in 0xE520..=0xE54F).
    let dyn_baseline = dl
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
        .expect("Expected a dynamics glyph");

    // For a crescendo the wedge is closed at its start: both diagonal lines
    // share the same starting Y, which is the spine. Take the smaller-x end.
    let mut spine_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = cmd {
                let not_horiz = (*y1 - *y2).abs() > 0.1;
                let not_vert = (*x1 - *x2).abs() > 0.1;
                if not_horiz && not_vert {
                    // Closed (convergent) end is at the smaller x.
                    return Some(if *x1 <= *x2 { *y1 } else { *y2 });
                }
            }
            None
        })
        .collect();
    assert!(!spine_ys.is_empty(), "Expected hairpin diagonal lines");
    spine_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let spine_y = spine_ys[0];

    // Spine should sit ~0.5sp above the dynamic baseline (the optical midline).
    let expected = dyn_baseline - 0.5 * sp;
    assert!(
        (spine_y - expected).abs() < 0.5,
        "Hairpin spine y={:.2} should align to dynamic optical midline {:.2} \
         (baseline {:.2} - 0.5sp)",
        spine_y,
        expected,
        dyn_baseline
    );
}

#[test]
fn test_hairpin_clears_colocated_dynamics() {
    // When a dynamic and hairpin share the same rhythmic position,
    // the hairpin must be offset so it doesn't overlap the dynamic glyph.
    // Score: p < f (crescendo from beat 0 to beat 2, with p at beat 0 and f at beat 2)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "dynamics": [
                {"type": "immediate", "position": {"fraction": [0, 1]}, "value": "p"},
                {"type": "immediate", "position": {"fraction": [2, 4]}, "value": "f"},
                {"type": "gradual",
                "position": {"fraction": [0, 1]},
                "end": {"measure": "m1", "position": {"fraction": [2, 4]}},
                "wedgeType": "increasing"}
            ],
            "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find dynamic bboxes and hairpin bbox
    let dyn_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/dyn"))
        .collect();
    let hairpin_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/hairpin"))
        .collect();

    assert_eq!(dyn_bboxes.len(), 2, "Expected 2 dynamic bboxes");
    assert_eq!(hairpin_bboxes.len(), 1, "Expected 1 hairpin bbox");

    let p_dyn = &dyn_bboxes[0]; // "p" at beat 0
    let f_dyn = &dyn_bboxes[1]; // "f" at beat 2
    let hp = &hairpin_bboxes[0];

    // Hairpin should not overlap with either dynamic's advance-width extent.
    // The visual bbox may extend slightly beyond the advance width due to italic glyph
    // overhangs, but the hairpin avoidance uses advance widths for cleaner results.
    // Just verify the hairpin doesn't start before the p dynamic's center
    // and doesn't end after the f dynamic's center.
    let p_center = p_dyn.bbox.x + p_dyn.bbox.width * 0.5;
    assert!(
        hp.bbox.x > p_center,
        "Hairpin start ({:.1}) must be after 'p' dynamic center ({:.1})",
        hp.bbox.x,
        p_center
    );

    let hp_right = hp.bbox.x + hp.bbox.width;
    let f_center = f_dyn.bbox.x + f_dyn.bbox.width * 0.5;
    assert!(
        hp_right < f_center,
        "Hairpin end ({:.1}) must be before 'f' dynamic center ({:.1})",
        hp_right,
        f_center
    );
    assert!(
        f_dyn.bbox.x - hp_right >= 0.3 * config.sp - 0.01,
        "Hairpin end ({hp_right:.1}) must clear actual f ink ({:.1}) by 0.3sp",
        f_dyn.bbox.x
    );
}

#[test]
fn test_hairpin_ending_at_measure_end_extends_to_barline() {
    // Rhapsody Violin I measure 13: dotted-half + 3:2 eighth triplet, p dynamic
    // at [3,4], crescendo hairpin [3,4] -> [1,1] (measure end). The crescendo
    // leads into the next bar's downbeat, so it must extend close to the right
    // barline (standard engraving practice), NOT snap onto the last tuplet note.
    // Regression: the nominal-duration beat cursor overshot inside the tuplet
    // and falsely matched the measure-end target onto the final triplet note,
    // leaving a ~3.4sp gap to the barline.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "m1", "time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                        "dynamics": [
                            {"type": "immediate", "position": {"fraction": [3, 4]}, "value": "p"},
                            {"type": "gradual",
                "position": {"fraction": [3, 4]},
                                "end": {"measure": "m1", "position": {"fraction": [1, 1]}},
                                "wedgeType": "increasing"}
                        ],
            "sequences": [{"content": [
                {"duration": {"base": "half", "dots": 1}, "notes": [{"pitch": {"step": "E", "octave": 4, "alter": -1}}]},
                {"type": "tuplet", "inner": {"multiple": 3, "duration": {"base": "eighth"}},
                 "outer": {"multiple": 2, "duration": {"base": "eighth"}}, "bracket": "no", "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 3, "alter": -1}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 3}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}
            ]}]
        }]}]
    }"#;
    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let mb = &dl.measure_bounds[0];
    let barline_x = mb.x + mb.width;

    // Collect the wedge's two diagonal lines (non-horizontal, non-vertical).
    let diag: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = cmd {
                let not_horiz = (*y1 - *y2).abs() > 0.1;
                let not_vert = (*x1 - *x2).abs() > 0.1;
                if not_horiz && not_vert {
                    return Some((*x1, *y1, *x2, *y2));
                }
            }
            None
        })
        .collect();
    assert_eq!(
        diag.len(),
        2,
        "crescendo wedge should be two diagonal lines"
    );

    // Wide (open) end is at the larger x; gap to the barline must be small
    // (~1sp), not the ~3.4sp gap produced by snapping to the last triplet note.
    let wide_x = diag[0].0.max(diag[0].2);
    let gap = barline_x - wide_x;
    assert!(
        gap < 1.6 * sp,
        "crescendo ending at measure end should reach near the barline; \
         gap={:.2} ({:.2}sp)",
        gap,
        gap / sp
    );

    // Aperture (total opening at the wide end) should be ~1.25sp, not 2sp.
    let open_ys: Vec<f64> = diag
        .iter()
        .map(|(x1, y1, x2, y2)| if x1 > x2 { *y1 } else { *y2 })
        .collect();
    let aperture = (open_ys[0] - open_ys[1]).abs();
    assert!(
        (aperture - 1.25 * sp).abs() < 0.3 * sp,
        "crescendo aperture should be ~1.25sp, got {:.2}sp",
        aperture / sp
    );
}
