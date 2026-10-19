// Auto-generated from tests.rs — test_caesura
// 4 test(s)

use super::test_helpers::is_beam_polygon;
use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores};
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn global_caesura_system_final_barline_anchor() {
    let mut value = serde_json::to_value(global_caesura_score()).unwrap();
    value["scores"][0]["pages"] = serde_json::json!([{"systems": [
        {"measure": "first", "layout": "full"},
        {"measure": "second", "layout": "full"}
    ]}]);
    let score = parse_mnx(&value.to_string()).unwrap();
    let dl = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    for measure in 0..2 {
        let id = format!("m{measure}/caesura");
        let copies: Vec<_> = dl
            .element_bboxes
            .iter()
            .filter(|b| b.element_id == id)
            .collect();
        assert_eq!(copies.len(), 3);
        for copy in copies {
            let center = copy.bbox.x + copy.bbox.width * 0.5;
            assert!(
                dl.measure_bounds.iter().any(|bound| {
                    bound.index == measure && (bound.x + bound.width - center).abs() < 1e-6
                }),
                "global caesura must stay centered over the ending barline"
            );
        }
    }
}

#[test]
fn global_caesura_uses_shared_collision_flow_without_horizontal_dodge() {
    use crate::layout::placement_metrics::PlacementTable;
    use crate::layout::render_annotations::flow_above_staff_dependents;
    let mut dl = DisplayList::new(300.0, 200.0);
    let sp = 10.0;
    let staff_y = 100.0;
    for (id, codepoint) in [
        ("p0/m0/s0/high", smufl::NOTEHEAD_BLACK),
        ("m0/caesura", smufl::CAESURA),
    ] {
        dl.push_selectable_command(
            RenderCommand::DrawGlyph {
                x: 200.0,
                y: 80.0,
                codepoint,
                font: "Bravura".into(),
                size: 4.0 * sp,
                color: "#000000".into(),
                rotation: 0.0,
            },
            id.into(),
            ElementKind::Caesura,
            HitPolicy::Ink,
        );
    }
    let before_x = dl
        .element_bboxes
        .iter()
        .find(|b| b.element_id == "m0/caesura")
        .unwrap()
        .bbox
        .x;
    flow_above_staff_dependents(&mut dl, 0, 0, &[], &PlacementTable::default(), staff_y, sp);
    let note = &dl
        .element_bboxes
        .iter()
        .find(|b| b.element_id == "p0/m0/s0/high")
        .unwrap()
        .bbox;
    let pause = &dl
        .element_bboxes
        .iter()
        .find(|b| b.element_id == "m0/caesura")
        .unwrap()
        .bbox;
    assert!((pause.x - before_x).abs() < 1e-6);
    assert!(pause.y + pause.height < note.y);
}

fn global_caesura_score() -> crate::model::Score {
    let mut value = serde_json::json!({
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "first", "time": {"count": 4, "unit": 4}, "caesura": {"id": "pause", "_c": "retained", "_x": {"test": {"retained": true}}}},
            {"id": "second", "caesura": {"shape": "curved", "marks": 1}, "repeatEnd": {}}
        ]},
        "layouts": [
            {"id": "full", "content": [
                {"type": "staff", "sources": [{"part": "piano", "staff": 1}]},
                {"type": "staff", "sources": [{"part": "piano", "staff": 2}]},
                {"type": "staff", "sources": [{"part": "flute"}]}
            ]},
            {"id": "extract", "content": [
                {"type": "staff", "sources": [{"part": "piano", "staff": 1}]},
                {"type": "staff", "sources": [{"part": "piano", "staff": 2}]}
            ]}
        ],
        "scores": [{"name": "Full", "layout": "full"}, {"name": "Piano", "layout": "extract"}],
        "parts": [{"id": "piano", "staves": 2}, {"id": "flute"}]
    });
    for part in value["parts"].as_array_mut().unwrap() {
        let staves = part["staves"].as_u64().unwrap_or(1);
        part["measures"] = serde_json::Value::Array((0..2).map(|_| {
            serde_json::json!({"sequences": (1..=staves).map(|staff| serde_json::json!({
                "staff": staff,
                "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}]
            })).collect::<Vec<_>>()})
        }).collect());
    }
    parse_mnx(&value.to_string()).unwrap()
}

#[test]
fn global_caesura_native_attributes_and_every_displayed_staff() {
    let score = global_caesura_score();
    let native = serde_json::to_value(&score.global.measures[0]).unwrap();
    assert_eq!(native["caesura"]["id"], "pause");
    assert_eq!(native["caesura"]["_c"], "retained");
    assert_eq!(native["caesura"]["_x"]["test"]["retained"], true);
    let config = LayoutConfig::default();
    for (view, staff_count) in [(0, 3), (1, 2)] {
        let dl = layout_with_mnx_scores(&score, &config, view);
        for measure in 0..2 {
            let id = format!("m{measure}/caesura");
            let boxes: Vec<_> = dl
                .element_bboxes
                .iter()
                .filter(|b| b.element_id == id)
                .collect();
            assert_eq!(boxes.len(), staff_count, "{id}, view {view}");
            let xs: Vec<_> = dl
                .commands
                .iter()
                .enumerate()
                .filter_map(|(i, cmd)| {
                    if dl.element_ids[i].as_deref() != Some(&id) {
                        return None;
                    }
                    cmd.bbox().map(|b| b.x + b.width * 0.5)
                })
                .collect();
            assert_eq!(xs.len(), staff_count);
            assert!(xs.iter().all(|x| (x - xs[0]).abs() < 1e-6));
            for bbox in boxes {
                assert!(bbox.bbox.width > 0.0 && bbox.bbox.height > 0.0);
            }
        }
    }
}

#[test]
fn global_caesura_cached_edit_and_delete_match_cold_layout() {
    use crate::layout::{cache::LayoutCache, layout_with_mnx_scores_cached};
    let mut score = global_caesura_score();
    let config = LayoutConfig::default();
    let mut cache = LayoutCache::new();
    layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    score.global.measures[0]
        .caesura
        .as_mut()
        .unwrap()
        .marking
        .style = Some(crate::raw::CaesuraShape::Thick);
    for remove in [false, true] {
        if remove {
            score.global.measures[0].caesura = None;
        }

        let warm = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
        let cold = layout_with_mnx_scores(&score, &config, 0);
        assert_eq!(
            serde_json::to_value(&warm.commands).unwrap(),
            serde_json::to_value(&cold.commands).unwrap()
        );
        let warm_boxes: Vec<_> = warm
            .element_bboxes
            .iter()
            .filter(|b| b.element_id.ends_with("/caesura"))
            .collect();
        let cold_boxes: Vec<_> = cold
            .element_bboxes
            .iter()
            .filter(|b| b.element_id.ends_with("/caesura"))
            .collect();
        assert_eq!(
            serde_json::to_value(warm_boxes).unwrap(),
            serde_json::to_value(cold_boxes).unwrap()
        );
    }
}

// ═══════════════════════════════════════════
// Caesura tests
// ═══════════════════════════════════════════
#[test]
fn test_caesura_renders_from_mnx() {
    // Load the caesura.mnx sample which has 4 measures with different caesura styles
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/caesura.mnx"
    );
    let json = std::fs::read_to_string(path).unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect caesura glyph codepoints
    let caesura_glyphs: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if [
                    smufl::CAESURA,
                    smufl::CAESURA_THICK,
                    smufl::CAESURA_SHORT,
                    smufl::CAESURA_CURVED,
                ]
                .contains(codepoint) =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    // Should have 4 caesura glyphs (one per measure)
    assert_eq!(
        caesura_glyphs.len(),
        4,
        "Expected 4 caesura glyphs, got {}: {:?}",
        caesura_glyphs.len(),
        caesura_glyphs
    );

    // Verify all four style types are present
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA),
        "Missing normal caesura"
    );
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA_THICK),
        "Missing thick caesura"
    );
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA_SHORT),
        "Missing short caesura"
    );
    assert!(
        caesura_glyphs.contains(&smufl::CAESURA_CURVED),
        "Missing curved caesura"
    );
}

#[test]
fn test_caesura_is_selectable_with_exact_glyph_bounds() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"id": "pause", "duration": {"base": "whole"},
             "notes": [{"pitch": {"step": "C", "octave": 5}}],
             "markings": {"caesura": {}}}
        ]}]}]}]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let caesura_id = "p0/m0/s0/pause/caesura";
    let (command_index, command) = dl
        .commands
        .iter()
        .enumerate()
        .find(|(index, _)| dl.element_ids[*index].as_deref() == Some(caesura_id))
        .expect("tagged caesura glyph");
    let command_bbox = command.bbox().expect("caesura glyph has exact bounds");
    let hitbox = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == caesura_id)
        .expect("caesura hitbox");

    assert_eq!(hitbox.bbox, command_bbox);
    assert!(matches!(
        dl.element_shapes
            .iter()
            .find(|shape| shape.element_id == caesura_id)
            .map(|shape| &shape.geom),
        Some(ShapeGeom::Cmd { cmd_idx }) if *cmd_idx == command_index as u32
    ));
}

#[test]
fn test_caesura_above_staff() {
    // Caesura glyph strokes should span from second staff line to first ledger line above.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"caesura": {}}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Find one caesura glyph.
    let caesura_glyph = dl.commands.iter().find_map(|cmd| match cmd {
        RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::CAESURA => {
            Some((*codepoint, *y))
        }
        _ => None,
    });

    assert!(caesura_glyph.is_some(), "Should render a caesura glyph");
    let (codepoint, glyph_y) = caesura_glyph.unwrap();
    let (_, yoff, _, h) = smufl::glyph_bbox(codepoint);

    let staff_y = config.margin_top * sp;
    let glyph_top = glyph_y + yoff * sp;
    let glyph_bottom = glyph_top + h * sp;

    assert!(
        (glyph_bottom - (staff_y + sp)).abs() < 0.2 * sp,
        "Caesura bottom should be near second staff line: got y={:.3}, expected y={:.3}",
        glyph_bottom,
        staff_y + sp
    );
    assert!(
        (glyph_top - (staff_y - sp)).abs() < 0.2 * sp,
        "Caesura top should be near first ledger line above: got y={:.3}, expected y={:.3}",
        glyph_top,
        staff_y - sp
    );
}

#[test]
fn test_caesura_default_style_is_normal() {
    // When no style is specified, caesura should use normal (U+E4D1).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"caesura": {}}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_normal = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::CAESURA)
    });

    assert!(
        has_normal,
        "Default caesura should use normal style (U+E4D1)"
    );
}

#[test]
fn test_caesura_near_measure_end() {
    // Caesura should be positioned near the right end of the measure (before barline)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"caesura": {}}}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find the caesura glyph X position.
    let caesura_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render a caesura glyph");

    // The caesura should be in the right half of the display
    assert!(
        caesura_x > dl.width * 0.3,
        "Caesura x={:.1} should be in the right portion of the measure (width={:.1})",
        caesura_x,
        dl.width
    );
}

#[test]
fn test_caesura_breaks_beam_group() {
    // Four eighth notes in 4/4 normally beam as one half-measure group (1 beam
    // polygon). A caesura on the second eighth forces a beam break after it, so
    // the run splits into two beamed pairs (2 beam polygons).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "e1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "e2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}],
                 "markings": {"caesura": {}}},
                {"id": "e3", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "e4", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let poly_count = dl.commands.iter().filter(|c| is_beam_polygon(c)).count();
    assert_eq!(
        poly_count, 2,
        "A caesura mid-run should split the beam into two groups (2 polygons), got {}",
        poly_count
    );
}

#[test]
fn test_caesura_reserves_horizontal_space() {
    // 8 quarter notes each carrying a caesura (8/4 time). A caesura reserves its
    // own horizontal footprint (like an accidental), so adjacent caesura glyphs
    // must not overlap and each must clear its preceding notehead.
    let note = r#"{"duration": {"base": "quarter"}, "markings": {"caesura": {}}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}"#;
    let eight_notes = std::iter::repeat_n(note, 8).collect::<Vec<_>>().join(", ");
    let json = format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{"measures": [{{"time": {{"count": 8, "unit": 4}}}}]}},
        "parts": [{{"measures": [{{
            "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
            "sequences": [{{"content": [{eight_notes}]}}]
        }}]}}]
    }}"#
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let caesura_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(caesura_xs.len(), 8, "Should render 8 caesura glyphs");

    let (_, _, cw, _) = smufl::glyph_bbox(smufl::CAESURA);
    for i in 0..caesura_xs.len() - 1 {
        let right_edge = caesura_xs[i] + cw * sp;
        let next_left = caesura_xs[i + 1];
        assert!(
            right_edge <= next_left + 0.01 * sp,
            "Caesura {} right edge ({:.1}px) overlaps caesura {} left ({:.1}px)",
            i,
            right_edge,
            i + 1,
            next_left,
        );
    }
}

#[test]
fn test_caesura_clears_next_note_accidental() {
    // A caesura on a note followed by a note that carries an accidental must be
    // engraved to the LEFT of that accidental's column, not on top of it. The
    // spacing engine reserves room for both; the glyph just has to land in it.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "markings": {"caesura": {}}},
                {"duration": {"base": "half"},
                 "notes": [{"pitch": {"step": "B", "octave": 4, "alter": -1}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let caesura_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render a caesura glyph");

    // The flat glyph drawn for the second note.
    let flat_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. }
                if *codepoint == smufl::ACCIDENTAL_FLAT =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render the flat accidental");

    let (_, _, cw, _) = smufl::glyph_bbox(smufl::CAESURA);
    let caesura_right = caesura_x + cw * sp;
    assert!(
        caesura_right <= flat_x + 0.01 * sp,
        "Caesura right edge ({:.1}px) overlaps the next note's flat (x={:.1}px)",
        caesura_right,
        flat_x,
    );
}

#[test]
fn test_caesura_ignores_centered_full_bar_rest_in_other_voice() {
    // Regression (Rhapsody, Percussion m485 before reh. 39): a caesura carried
    // by an inner-beat note in one voice must anchor to the NEXT ONSET, not to a
    // full-bar rest sitting in another voice. A half/whole rest filling the bar
    // is drawn CENTERED near the measure middle even though its onset is beat 0;
    // an x-based "next event" search mistook that centered glyph for the next
    // event and placed the caesura LEFT of its own carrier. The caesura must
    // land in the gap AFTER the carrier note and BEFORE the following rest.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"voice": "v1", "content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "eighth"},
                     "notes": [{"pitch": {"step": "D", "octave": 5}}],
                     "markings": {"caesura": {}}},
                    {"duration": {"base": "eighth"}, "rest": {}}
                ]},
                {"voice": "v2", "content": [
                    {"duration": {"base": "half"}, "rest": {}}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let caesura_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::CAESURA => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render a caesura glyph");

    // Carrier = the rightmost (latest-onset) notehead in the bar (the D5 eighth).
    let carrier_x = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if smufl::is_notehead(*codepoint) => {
                Some(*x)
            }
            _ => None,
        })
        .fold(f64::MIN, f64::max);

    // The eighth rest (beat 1.5) in voice 1 — the genuine next onset.
    let eighth_rest_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::REST_8TH => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Should render the eighth rest");

    assert!(
        caesura_x > carrier_x,
        "Caesura (x={caesura_x:.1}) must sit AFTER its carrier note (x={carrier_x:.1}), \
         not be pulled left by the centered full-bar rest in the other voice",
    );
    assert!(
        caesura_x < eighth_rest_x,
        "Caesura (x={caesura_x:.1}) must sit BEFORE the following eighth rest (x={eighth_rest_x:.1})",
    );
}

// ═══════════════════════════════════════════
// Caesura `marks` tests — SMuFL only defines a single-stroke glyph
// (caesuraSingleStroke, U+E4D7) with no shape-specific thick/curved
// counterpart, so `marks: 1` only renders distinctly for normal/short.
// ═══════════════════════════════════════════
#[test]
fn test_caesura_glyph_all_six_combinations() {
    use crate::model::CaesuraStyle;

    // 4 shapes at the default marks (2) use their standard double-stroke glyph.
    assert_eq!(smufl::caesura_glyph(&None, None), smufl::CAESURA);
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Normal), Some(2)),
        smufl::CAESURA
    );
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Thick), None),
        smufl::CAESURA_THICK
    );
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Short), None),
        smufl::CAESURA_SHORT
    );
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Curved), None),
        smufl::CAESURA_CURVED
    );

    // normal/short at marks: 1 use the single-stroke glyph.
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Normal), Some(1)),
        smufl::CAESURA_SINGLE_STROKE
    );
    assert_eq!(
        smufl::caesura_glyph(&None, Some(1)),
        smufl::CAESURA_SINGLE_STROKE
    );
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Short), Some(1)),
        smufl::CAESURA_SINGLE_STROKE
    );

    // thick/curved have no single-stroke counterpart; marks: 1 falls back to
    // the shape's standard double-stroke glyph.
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Thick), Some(1)),
        smufl::CAESURA_THICK
    );
    assert_eq!(
        smufl::caesura_glyph(&Some(CaesuraStyle::Curved), Some(1)),
        smufl::CAESURA_CURVED
    );
}

#[test]
fn test_caesura_native_marks_renders_single_stroke() {
    // Native MNX caesura with shape: "normal" (implied) and marks: 1 should
    // render the single-stroke glyph (U+E4D7), not the double-stroke default.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "whole"},
             "notes": [{"pitch": {"step": "C", "octave": 5}}],
             "markings": {"caesura": {"marks": 1}}}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());

    let has_single_stroke = dl.commands.iter().any(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::CAESURA_SINGLE_STROKE)
    });

    assert!(
        has_single_stroke,
        "marks: 1 on a normal-shape caesura should render the single-stroke glyph (U+E4D7)"
    );
}
