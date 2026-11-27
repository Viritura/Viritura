use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::RenderCommand;

#[test]
fn pitched_notehead_override_renders_requested_shape() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
            "parts": [{"measures": [{"sequences": [{"content": [{
                "duration": {"base": "quarter"},
                "notes": [{
                    "pitch": {"step": "C", "octave": 4},
                    "notehead": {"shape": "diamond"}
                }]
            }]}]}]}]
        }"#,
    )
    .unwrap();

    let display_list = layout_score(&score, 0, &LayoutConfig::default());
    assert!(display_list.commands.iter().any(|command| matches!(
        command,
        RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_DIAMOND_BLACK
    )));
    assert!(!display_list.commands.iter().any(|command| matches!(
        command,
        RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_BLACK
    )));
}

#[test]
fn slash_noteheads_use_smufl_glyphs_for_each_duration() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [
                {"time": {"count": 4, "unit": 4}},
                {},
                {"time": {"count": 4, "unit": 2}}
            ]},
            "parts": [{"measures": [
                {"sequences": [{"content": [
                    {"duration": {"base": "whole"},   "notes": [{"pitch": {"step": "B", "octave": 4}, "notehead": {"shape": "slash"}}]}
                ]}]},
                {"sequences": [{"content": [
                    {"duration": {"base": "half"},    "notes": [{"pitch": {"step": "B", "octave": 4}, "notehead": {"shape": "slash"}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 4}, "notehead": {"shape": "slash"}}]},
                    {"duration": {"base": "eighth"},  "notes": [{"pitch": {"step": "B", "octave": 4}, "notehead": {"shape": "slash"}}]},
                    {"duration": {"base": "eighth"},  "notes": [{"pitch": {"step": "B", "octave": 4}, "notehead": {"shape": "slash"}}]}
                ]}]},
                {"sequences": [{"content": [
                    {"duration": {"base": "breve"},   "notes": [{"pitch": {"step": "B", "octave": 4}, "notehead": {"shape": "slash"}}]}
                ]}]}
            ]}]
        }"#,
    )
    .unwrap();

    let display_list = layout_score(&score, 0, &LayoutConfig::default());
    let noteheads: Vec<u32> = display_list
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, .. } => Some(*codepoint),
            _ => None,
        })
        .filter(|codepoint| smufl::is_notehead(*codepoint))
        .collect();

    // Literal SMuFL codepoints, because the engine's constants are under test.
    assert_eq!(
        noteheads,
        [
            0xE102, // noteheadSlashWhiteWhole
            0xE103, // noteheadSlashWhiteHalf
            0xE101, // noteheadSlashHorizontalEnds
            0xE101, // noteheadSlashHorizontalEnds
            0xE101, // noteheadSlashHorizontalEnds
            0xE10A, // noteheadSlashWhiteDoubleWhole
        ]
    );
}

#[test]
fn slash_notehead_geometry_matches_bravura_metadata() {
    let metadata: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../assets/fonts/bravura_metadata.json"
    ))
    .unwrap();
    let point = |value: &serde_json::Value| {
        (
            value[0].as_f64().unwrap(),
            -value[1].as_f64().unwrap(), // SMuFL's Y axis points up.
        )
    };

    for (codepoint, name) in [
        (0xE101, "noteheadSlashHorizontalEnds"),
        (0xE102, "noteheadSlashWhiteWhole"),
        (0xE103, "noteheadSlashWhiteHalf"),
        (0xE10A, "noteheadSlashWhiteDoubleWhole"),
    ] {
        let bbox = &metadata["glyphBBoxes"][name];
        let (left, bottom) = point(&bbox["bBoxSW"]);
        let (right, top) = point(&bbox["bBoxNE"]);
        assert_eq!(
            smufl::glyph_bbox(codepoint),
            (left, top, right - left, bottom - top),
            "{name}"
        );

        let anchors = &metadata["glyphsWithAnchors"][name];
        if anchors["stemUpSE"].is_array() {
            let actual = smufl::stem_anchors(codepoint);
            assert_eq!(actual.up_se, point(&anchors["stemUpSE"]), "{name}");
            assert_eq!(actual.down_nw, point(&anchors["stemDownNW"]), "{name}");
        }
    }
}

#[test]
fn v57_noteheads_render_each_duration_on_pitched_and_kit_notes() {
    for (shape, expected) in [
        ("circled", [0xE0E4, 0xE0E5, 0xE0E6, 0xE0E7]),
        ("slashed", [0xE0CF, 0xE0D1, 0xE0D3, 0xE0D5]),
        ("backSlashed", [0xE0D0, 0xE0D2, 0xE0D4, 0xE0D6]),
    ] {
        for kit in [false, true] {
            let measures: Vec<_> = ["quarter", "half", "whole", "breve"]
                .iter()
                .map(|base| {
                    let mut event = serde_json::json!({ "duration": { "base": base } });
                    if kit {
                        event["kitNotes"] = serde_json::json!([{ "kitComponent": "drum" }]);
                    } else {
                        event["notes"] = serde_json::json!([{
                            "pitch": { "step": "B", "octave": 4 },
                            "notehead": { "shape": shape }
                        }]);
                    }
                    serde_json::json!({ "sequences": [{ "content": [event] }] })
                })
                .collect();
            let document = serde_json::json!({
                "mnx": { "version": 1 },
                "global": { "measures": [{}, {}, {}, {}] },
                "parts": [{
                    "kit": { "drum": { "staffPosition": 0, "notehead": { "shape": shape } } },
                    "measures": measures
                }]
            });
            let score = parse_mnx(&document.to_string()).unwrap();
            let display_list = layout_score(&score, 0, &LayoutConfig::default());
            let actual: Vec<_> = display_list
                .commands
                .iter()
                .filter_map(|command| match command {
                    RenderCommand::DrawGlyph { codepoint, .. }
                        if smufl::is_notehead(*codepoint) =>
                    {
                        Some(*codepoint)
                    }
                    _ => None,
                })
                .collect();
            assert_eq!(actual, expected, "{shape}, kit={kit}");
        }
    }
}

#[test]
fn v57_notehead_geometry_matches_bravura_metadata() {
    let metadata: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../assets/fonts/bravura_metadata.json"
    ))
    .unwrap();
    for (codepoint, name) in [
        (0xE0E4, "noteheadCircledBlack"),
        (0xE0E5, "noteheadCircledHalf"),
        (0xE0E6, "noteheadCircledWhole"),
        (0xE0E7, "noteheadCircledDoubleWhole"),
        (0xE0CF, "noteheadSlashedBlack1"),
        (0xE0D0, "noteheadSlashedBlack2"),
        (0xE0D1, "noteheadSlashedHalf1"),
        (0xE0D2, "noteheadSlashedHalf2"),
        (0xE0D3, "noteheadSlashedWhole1"),
        (0xE0D4, "noteheadSlashedWhole2"),
        (0xE0D5, "noteheadSlashedDoubleWhole1"),
        (0xE0D6, "noteheadSlashedDoubleWhole2"),
    ] {
        let bbox = &metadata["glyphBBoxes"][name];
        let sw = (
            bbox["bBoxSW"][0].as_f64().unwrap(),
            bbox["bBoxSW"][1].as_f64().unwrap(),
        );
        let ne = (
            bbox["bBoxNE"][0].as_f64().unwrap(),
            bbox["bBoxNE"][1].as_f64().unwrap(),
        );
        let actual = smufl::glyph_bbox(codepoint);
        for (value, expected) in [
            (actual.0, sw.0),
            (actual.1, -ne.1),
            (actual.2, ne.0 - sw.0),
            (actual.3, ne.1 - sw.1),
        ] {
            assert!((value - expected).abs() < 1e-9, "{name}");
        }
        let anchors = &metadata["glyphsWithAnchors"][name];
        if anchors["stemUpSE"].is_array() {
            let actual = smufl::stem_anchors(codepoint);
            assert_eq!(
                actual.up_se,
                (
                    anchors["stemUpSE"][0].as_f64().unwrap(),
                    -anchors["stemUpSE"][1].as_f64().unwrap()
                ),
                "{name}"
            );
            assert_eq!(
                actual.down_nw,
                (
                    anchors["stemDownNW"][0].as_f64().unwrap(),
                    -anchors["stemDownNW"][1].as_f64().unwrap()
                ),
                "{name}"
            );
        }
        let origin = anchors["noteheadOrigin"][0].as_f64().unwrap_or(0.0);
        assert_eq!(smufl::notehead_origin(codepoint), origin, "{name}");
        assert_eq!(smufl::smufl_name_to_codepoint(name), Some(codepoint));
    }
}

#[test]
fn beamed_slash_stems_attach_where_unbeamed_ones_do() {
    let slash = |id: &str, base: &str, step: &str| {
        format!(
            r#"{{"id": "{id}", "duration": {{"base": "{base}"}}, "notes": [{{"pitch": {{"step": "{step}", "octave": 4}}, "notehead": {{"shape": "slash"}}}}]}}"#
        )
    };
    let content = [
        slash("down", "quarter", "B"),
        slash("down1", "eighth", "B"),
        slash("down2", "eighth", "B"),
        slash("up", "quarter", "E"),
        slash("up1", "eighth", "E"),
        slash("up2", "eighth", "E"),
    ]
    .join(",");
    let score = parse_mnx(&format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
            "parts": [{{"measures": [{{
                "beams": [{{"events": ["down1", "down2"]}}, {{"events": ["up1", "up2"]}}],
                "sequences": [{{"content": [{content}]}}]
            }}]}}]
        }}"#
    ))
    .unwrap();

    let config = LayoutConfig::default();
    let display_list = layout_score(&score, 0, &config);
    let noteheads: Vec<(f64, f64)> = display_list
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } if smufl::is_notehead(*codepoint) => Some((*x, *y)),
            _ => None,
        })
        .collect();
    let stems: Vec<(f64, f64, f64)> = display_list
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine { x1, y1, x2, y2, .. } if x1 == x2 => {
                Some((*x1, y1.min(*y2), y1.max(*y2)))
            }
            _ => None,
        })
        .collect();
    assert_eq!(noteheads.len(), 6);
    // Where each stem meets its notehead, relative to the notehead.
    let attachments: Vec<(f64, f64)> = noteheads
        .iter()
        .enumerate()
        .map(|(index, &(x, y))| {
            let stem_up = index >= 3;
            // An up-stem is on the notehead's right, a down-stem on its left.
            let side = if stem_up {
                0.0..3.0 * config.sp
            } else {
                -config.sp..config.sp
            };
            let (stem_x, top, bottom) = stems
                .iter()
                .copied()
                .find(|&(stem_x, top, bottom)| {
                    side.contains(&(stem_x - x)) && top <= y + config.sp && bottom >= y - config.sp
                })
                .unwrap();
            (stem_x - x, if stem_up { bottom } else { top } - y)
        })
        .collect();

    for (unbeamed, beamed) in [(0, 1), (0, 2), (3, 4), (3, 5)] {
        let (a, b) = (attachments[unbeamed], attachments[beamed]);
        assert!(
            (a.0 - b.0).abs() < 1e-6 && (a.1 - b.1).abs() < 1e-6,
            "note {beamed}: {b:?}, unbeamed: {a:?}"
        );
    }
}
