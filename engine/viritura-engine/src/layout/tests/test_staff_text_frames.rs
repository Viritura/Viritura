use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores};
use crate::parse::{parse_mnx, parse_mnx_strict};
use crate::render::*;
use serde_json::{json, Value};

fn document(frame: Value, placement: &str) -> Value {
    json!({
        "mnx": { "version": 1 },
        "global": { "measures": [{ "time": { "count": 4, "unit": 4 } }] },
        "parts": [{ "id": "P1", "measures": [{
            "clefs": [{ "clef": { "sign": "G", "staffPosition": -2 } }],
            "sequences": [{ "content": [{
                "id": "e1", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 5 } }]
            }] }],
            "_x": { "viritura": { "expressions": [{
                "text": [
                    { "text": "Play freely\n", "style": { "weight": "bold" } },
                    { "text": "Then resume the pulse without a break" }
                ],
                "position": { "fraction": [0, 1] },
                "placement": placement,
                "frame": frame
            }] } }
        }] }]
    })
}

fn expression_bbox(dl: &DisplayList) -> &BoundingBox {
    &dl.element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "p0/m0/expr0")
        .unwrap()
        .bbox
}

#[test]
fn staff_frames_wrap_and_keep_full_bounds_in_paged_and_horizon_views() {
    for page_width in [None, Some(800.0)] {
        for placement in ["above", "below"] {
            for border in ["none", "solid"] {
                let score = parse_mnx(
                    &document(
                        json!({
                            "width": { "unit": "staffSpaces", "value": 12 },
                            "padding": 1, "border": border, "paragraphJustification": "center"
                        }),
                        placement,
                    )
                    .to_string(),
                )
                .unwrap();
                let config = LayoutConfig {
                    page_width,
                    ..LayoutConfig::default()
                };
                let dl = layout_with_mnx_scores(&score, &config, 0);
                let bbox = expression_bbox(&dl);
                assert!((bbox.width - 12.0 * config.sp).abs() < 1e-6);
                assert!(
                    bbox.height > 6.0 * config.sp,
                    "wrapped text needs automatic multiline height"
                );
                let lines: Vec<_> = dl
                    .commands
                    .iter()
                    .zip(&dl.element_ids)
                    .filter_map(|(command, id)| {
                        if id.as_deref() != Some("p0/m0/expr0") {
                            return None;
                        }
                        match command {
                            RenderCommand::DrawText {
                                y,
                                text,
                                font,
                                align,
                                ..
                            } => Some((*y, text, font, align)),
                            _ => None,
                        }
                    })
                    .collect();
                assert!(
                    lines.len() >= 3,
                    "authored break and word wrap must both apply"
                );
                assert!(lines
                    .iter()
                    .any(|(_, text, font, _)| *text == "Play freely" && font.contains("bold")));
                assert!(lines.iter().all(|(y, _, _, align)| {
                    *y > bbox.y && *y < bbox.y + bbox.height && matches!(align, TextAlign::Center)
                }));
                let borders = dl
                    .commands
                    .iter()
                    .zip(&dl.element_ids)
                    .filter(|(command, id)| {
                        id.as_deref() == Some("p0/m0/expr0")
                            && matches!(command, RenderCommand::DrawLine { .. })
                    })
                    .count();
                assert_eq!(borders, if border == "solid" { 4 } else { 0 });
                let shape = dl
                    .element_shapes
                    .iter()
                    .find(|shape| shape.element_id == "p0/m0/expr0")
                    .unwrap();
                let shape_box = shape.bbox(&dl.commands).unwrap();
                assert!((shape_box.width - bbox.width).abs() < 1e-6);
                assert!((shape_box.height - bbox.height).abs() < 1e-6);
            }
        }
    }
}

#[test]
fn staff_frame_alignment_and_pinned_offsets_keep_the_musical_anchor() {
    let config = LayoutConfig::default();
    let mut doc = document(
        json!({
            "width": { "unit": "staffSpaces", "value": 12 }, "padding": 0.5,
            "horizontalAlignment": "left"
        }),
        "above",
    );
    let expr = "/parts/0/measures/0/_x/viritura/expressions/0";
    doc.pointer_mut(expr).unwrap()["avoidCollisions"] = json!(false);
    let left = layout_score(&parse_mnx(&doc.to_string()).unwrap(), 0, &config);
    let left_box = expression_bbox(&left);
    for (align, expected) in [("center", -6.0), ("right", -12.0)] {
        doc.pointer_mut(expr).unwrap()["frame"]["horizontalAlignment"] = json!(align);
        let dl = layout_score(&parse_mnx(&doc.to_string()).unwrap(), 0, &config);
        assert!((expression_bbox(&dl).x - left_box.x - expected * config.sp).abs() < 1e-6);
    }
    doc.pointer_mut(expr).unwrap()["frame"]["horizontalAlignment"] = json!("left");
    doc.pointer_mut(expr).unwrap()["manualOffset"] = json!([2, 3]);
    let shifted = layout_score(&parse_mnx(&doc.to_string()).unwrap(), 0, &config);
    assert!((expression_bbox(&shifted).x - left_box.x - 2.0 * config.sp).abs() < 1e-6);
    assert!((expression_bbox(&shifted).y - left_box.y + 3.0 * config.sp).abs() < 1e-6);
}

#[test]
fn natural_width_staff_frame_keeps_authored_newlines() {
    let score = parse_mnx(&document(json!({ "padding": 1 }), "above").to_string()).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let bbox = expression_bbox(&dl);
    assert!(bbox.width > 20.0 * config.sp);
    assert!((bbox.height - (2.0 * 2.0 * 1.2 + 2.0) * config.sp).abs() < 1e-6);
}

#[test]
fn malformed_staff_frames_fail_both_import_paths() {
    for frame in [
        Value::Null,
        json!([]),
        json!({ "width": { "unit": "staffSpaces", "value": 0 } }),
        json!({ "width": { "unit": "staffSpaces", "value": -1 } }),
        json!({ "width": { "unit": "textColumnFraction", "value": 0.5 } }),
        json!({ "padding": -1 }),
        json!({ "height": 10 }),
        json!({ "border": "dashed" }),
    ] {
        let doc = document(frame, "above").to_string();
        assert!(
            parse_mnx(&doc).is_err(),
            "lenient import must reject malformed frame"
        );
        assert!(
            parse_mnx_strict(&doc).is_err(),
            "strict import must reject malformed frame"
        );
    }
}
