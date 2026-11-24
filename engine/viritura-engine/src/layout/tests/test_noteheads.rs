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
                    "_x": {"viritura": {"notehead": "diamond"}}
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
