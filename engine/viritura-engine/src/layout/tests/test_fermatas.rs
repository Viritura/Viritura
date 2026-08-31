// Fermata layout tests — covers MNX-native fermata semantics (post v15):
// `symbol` (visual shape) is independent of `duration` (pause length).

use crate::layout::config::LayoutConfig;
use crate::layout::{layout_full_score, layout_score};
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

/// Wrap a single sequence of events in a minimal MNX score.
fn score_with_events(events_json: &str) -> String {
    format!(
        r#"{{
        "mnx": {{"version": 1}},
        "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
        "parts": [{{"measures": [{{
            "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
            "sequences": [{{"content": [{events}]}}]
        }}]}}]
    }}"#,
        events = events_json
    )
}

#[test]
fn test_endpoint_fermata_clears_full_slur_span() {
    let json = score_with_events(
        r#"
            {"id": "fs1", "duration": {"base": "quarter"}, "stemDirection": "down",
             "notes": [{"pitch": {"step": "C", "octave": 6}}],
             "fermata": {}, "slurs": [{"target": "fs3", "side": "up"}]},
            {"id": "fs2", "duration": {"base": "quarter"}, "stemDirection": "down",
             "notes": [{"pitch": {"step": "G", "octave": 5}}]},
            {"id": "fs3", "duration": {"base": "quarter"}, "stemDirection": "down",
             "notes": [{"pitch": {"step": "C", "octave": 5}}]},
            {"duration": {"base": "quarter"}, "rest": {}}
        "#,
    );
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_full_score(&parse_mnx(&json).unwrap(), &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("slur");
    let (slur_left, slur_right) = match slur {
        RenderCommand::DrawFilledBezier { x1, x2, .. } => (x1.min(*x2), x1.max(*x2)),
        _ => unreachable!(),
    };
    let (fermata_left, fermata_right, fermata_bottom) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint: smufl::FERMATA_ABOVE,
                size,
                ..
            } => {
                let scale = *size / 4.0;
                let (bbox_x, bbox_y, bbox_w, bbox_h) = smufl::glyph_bbox(smufl::FERMATA_ABOVE);
                Some((
                    *x + bbox_x * scale,
                    *x + (bbox_x + bbox_w) * scale,
                    *y + (bbox_y + bbox_h) * scale,
                ))
            }
            _ => None,
        })
        .expect("above fermata");
    let overlap_left = fermata_left.max(slur_left);
    let overlap_right = fermata_right.min(slur_right);
    assert!(
        overlap_left < overlap_right,
        "fermata must overlap slur in X"
    );

    let mut highest_slur_edge = f64::INFINITY;
    for sample in 0..=16 {
        let x = overlap_left + (overlap_right - overlap_left) * sample as f64 / 16.0;
        highest_slur_edge =
            highest_slur_edge.min(super::test_helpers::bezier_outer_y_at_x(slur, x));
    }
    assert!(
        fermata_bottom <= highest_slur_edge - 0.3 * sp,
        "fermata bottom={fermata_bottom:.3} must clear the full slur span edge={highest_slur_edge:.3}"
    );
    let fermata_bbox = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id.ends_with("/fermata"))
        .expect("fermata selection bbox");
    assert!(
        (fermata_bbox.bbox.y + fermata_bbox.bbox.height - fermata_bottom).abs() < 1.0e-6,
        "selection bbox must follow the shifted fermata command"
    );
    let fermata_shape = dl
        .element_shapes
        .iter()
        .find(|shape| shape.element_id.ends_with("/fermata"))
        .and_then(|shape| shape.bbox(&dl.commands))
        .expect("fermata collision shape");
    assert!(
        (fermata_shape.y + fermata_shape.height - fermata_bottom).abs() < 1.0e-6,
        "collision shape must follow the shifted fermata command"
    );
}

#[test]
fn test_fermata_clears_overlapping_tie_without_losing_attachment() {
    let json = score_with_events(
        r#"
            {"id": "ft1", "duration": {"base": "half"}, "stemDirection": "down",
             "notes": [{"id": "ftn1", "pitch": {"step": "E", "octave": 5},
                        "ties": [{"target": "ftn2", "side": "up"}]}],
             "fermata": {}},
            {"id": "ft2", "duration": {"base": "half"}, "stemDirection": "down",
             "notes": [{"id": "ftn2", "pitch": {"step": "E", "octave": 5}}]}
        "#,
    );
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_full_score(&parse_mnx(&json).unwrap(), &config);
    let tie = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(idx, command)| {
            (dl.element_ids.get(idx).and_then(Option::as_ref) == Some(&"tie/ftn1/ftn2".into()))
                .then_some(command)
        })
        .expect("above tie");
    let (tie_left, tie_right) = match tie {
        RenderCommand::DrawFilledBezier { x1, x2, .. } => (x1.min(*x2), x1.max(*x2)),
        _ => unreachable!(),
    };
    let (fermata_left, fermata_right, fermata_bottom) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint: smufl::FERMATA_ABOVE,
                size,
                ..
            } => {
                let scale = *size / 4.0;
                let (bbox_x, bbox_y, bbox_w, bbox_h) = smufl::glyph_bbox(smufl::FERMATA_ABOVE);
                Some((
                    *x + bbox_x * scale,
                    *x + (bbox_x + bbox_w) * scale,
                    *y + (bbox_y + bbox_h) * scale,
                ))
            }
            _ => None,
        })
        .expect("above fermata");
    let overlap_left = fermata_left.max(tie_left);
    let overlap_right = fermata_right.min(tie_right);
    assert!(
        overlap_left < overlap_right,
        "fermata must overlap tie horizontally"
    );
    let mut highest_tie_edge = f64::INFINITY;
    for sample in 0..=16 {
        let x = overlap_left + (overlap_right - overlap_left) * sample as f64 / 16.0;
        highest_tie_edge = highest_tie_edge.min(super::test_helpers::bezier_outer_y_at_x(tie, x));
    }
    assert!(
        fermata_bottom <= highest_tie_edge - 0.3 * sp,
        "fermata bottom={fermata_bottom:.3} must clear tie edge={highest_tie_edge:.3}"
    );
}

#[test]
fn test_below_endpoint_fermata_clears_full_slur_span() {
    let json = score_with_events(
        r#"
            {"id": "fb1", "duration": {"base": "quarter"}, "stemDirection": "up",
             "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "fermata": {"orient": "below"},
             "slurs": [{"target": "fb3", "side": "down"}]},
            {"id": "fb2", "duration": {"base": "quarter"}, "stemDirection": "up",
             "notes": [{"pitch": {"step": "G", "octave": 4}}]},
            {"id": "fb3", "duration": {"base": "quarter"}, "stemDirection": "up",
             "notes": [{"pitch": {"step": "C", "octave": 5}}]},
            {"duration": {"base": "quarter"}, "rest": {}}
        "#,
    );
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&parse_mnx(&json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| matches!(command, RenderCommand::DrawFilledBezier { .. }))
        .expect("slur");
    let (slur_left, slur_right) = match slur {
        RenderCommand::DrawFilledBezier { x1, x2, .. } => (x1.min(*x2), x1.max(*x2)),
        _ => unreachable!(),
    };
    let (fermata_left, fermata_right, fermata_top) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint: smufl::FERMATA_BELOW,
                size,
                ..
            } => {
                let scale = *size / 4.0;
                let (bbox_x, bbox_y, bbox_w, _) = smufl::glyph_bbox(smufl::FERMATA_BELOW);
                Some((
                    *x + bbox_x * scale,
                    *x + (bbox_x + bbox_w) * scale,
                    *y + bbox_y * scale,
                ))
            }
            _ => None,
        })
        .expect("below fermata");
    let overlap_left = fermata_left.max(slur_left);
    let overlap_right = fermata_right.min(slur_right);
    assert!(
        overlap_left < overlap_right,
        "fermata must overlap slur in X"
    );

    let mut lowest_slur_edge = f64::NEG_INFINITY;
    for sample in 0..=16 {
        let x = overlap_left + (overlap_right - overlap_left) * sample as f64 / 16.0;
        lowest_slur_edge = lowest_slur_edge.max(super::test_helpers::bezier_outer_y_at_x(slur, x));
    }
    assert!(
        fermata_top >= lowest_slur_edge + 0.3 * sp,
        "fermata top={fermata_top:.3} must clear the full slur span edge={lowest_slur_edge:.3}"
    );
}

#[test]
fn test_fermata_renders_from_mnx_file() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/fermatas.mnx"
    );
    let json = std::fs::read_to_string(path).unwrap();
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // All fermata above-staff codepoints (Bravura range U+E4C0–U+E4CD).
    let fermata_codepoints = [
        smufl::FERMATA_ABOVE,
        smufl::FERMATA_BELOW,
        smufl::FERMATA_VERY_SHORT_ABOVE,
        smufl::FERMATA_VERY_SHORT_BELOW,
        smufl::FERMATA_SHORT_ABOVE,
        smufl::FERMATA_SHORT_BELOW,
        smufl::FERMATA_LONG_ABOVE,
        smufl::FERMATA_LONG_BELOW,
        smufl::FERMATA_VERY_LONG_ABOVE,
        smufl::FERMATA_VERY_LONG_BELOW,
        smufl::FERMATA_LONG_HENZE_ABOVE,
        smufl::FERMATA_LONG_HENZE_BELOW,
        smufl::FERMATA_SHORT_HENZE_ABOVE,
        smufl::FERMATA_SHORT_HENZE_BELOW,
        smufl::CURLEW_SIGN,
    ];
    let cps: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. }
                if fermata_codepoints.contains(codepoint) =>
            {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    assert!(
        !cps.is_empty(),
        "fermatas.mnx should render at least one fermata glyph"
    );
    assert!(
        cps.contains(&smufl::FERMATA_ABOVE),
        "Should include the normal fermata"
    );
}

#[test]
fn test_fermata_above_staff() {
    let json = score_with_events(
        r#"
        {"duration": {"base": "quarter"}, "fermata": {},
         "notes": [{"pitch": {"step": "E", "octave": 5}}]},
        {"duration": {"base": "dotted-half"},
         "notes": [{"pitch": {"step": "D", "octave": 5}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let fermata_y = dl.commands.iter().find_map(|cmd| match cmd {
        RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::FERMATA_ABOVE => {
            Some(*y)
        }
        _ => None,
    });

    assert!(fermata_y.is_some(), "Should render a fermata glyph");
    let staff_y = config.margin_top * sp;
    assert!(
        fermata_y.unwrap() < staff_y,
        "Fermata (y={:.1}) should be above top staff line (y={:.1})",
        fermata_y.unwrap(),
        staff_y
    );
}

#[test]
fn test_fermata_symbol_parsing() {
    // Native MNX fermata symbol values (no longer `_x.viritura`).
    let json = score_with_events(
        r#"
        {"duration": {"base": "quarter"}, "fermata": {"symbol": "angled"},
         "notes": [{"pitch": {"step": "C", "octave": 5}}]},
        {"duration": {"base": "quarter"}, "fermata": {"symbol": "square"},
         "notes": [{"pitch": {"step": "D", "octave": 5}}]},
        {"duration": {"base": "half"}, "fermata": {"symbol": "doubleDot"},
         "notes": [{"pitch": {"step": "E", "octave": 5}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let codepoints: Vec<u32> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. } if (0xE4C0..=0xE4CD).contains(codepoint) => {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();

    assert_eq!(
        codepoints.len(),
        3,
        "Expected 3 fermata glyphs, got {:?}",
        codepoints
    );
    // Per MNX spec: angled → fermataShort (E4C4), square → fermataLong (E4C6),
    // doubleDot → fermataLongHenze (E4CA).
    assert_eq!(
        codepoints[0],
        smufl::FERMATA_SHORT_ABOVE,
        "angled → fermataShort"
    );
    assert_eq!(
        codepoints[1],
        smufl::FERMATA_LONG_ABOVE,
        "square → fermataLong"
    );
    assert_eq!(
        codepoints[2],
        smufl::FERMATA_LONG_HENZE_ABOVE,
        "doubleDot → fermataLongHenze"
    );
}

#[test]
fn test_fermata_default_is_normal() {
    // A fermata with no symbol should default to normal (U+E4C0).
    let json = score_with_events(
        r#"
        {"duration": {"base": "quarter"}, "fermata": {},
         "notes": [{"pitch": {"step": "C", "octave": 5}}]},
        {"duration": {"base": "dotted-half"},
         "notes": [{"pitch": {"step": "D", "octave": 5}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_normal = dl.commands.iter().any(|cmd| {
        matches!(
            cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::FERMATA_ABOVE
        )
    });

    assert!(
        has_normal,
        "Default fermata should render as normal fermata glyph (U+E4C0)"
    );
}

#[test]
fn test_fermata_on_rest() {
    let json = score_with_events(
        r#"
        {"duration": {"base": "half"}, "fermata": {},
         "rest": {}},
        {"duration": {"base": "half"},
         "notes": [{"pitch": {"step": "D", "octave": 5}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_fermata = dl.commands.iter().any(|cmd| {
        matches!(
            cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::FERMATA_ABOVE
        )
    });

    assert!(has_fermata, "Fermata should render above a rest");
}

#[test]
fn test_full_measure_rest_and_fermata_share_ink_center() {
    let json = score_with_events(
        r#"
        {"id": "bar-rest", "duration": {"base": "whole"}, "fermata": {},
         "rest": {}}
    "#,
    );
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&parse_mnx(&json).unwrap(), 0, &config);

    let ink_center = |wanted: u32| {
        dl.commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    x, codepoint, size, ..
                } if *codepoint == wanted => {
                    let scale = *size / 4.0;
                    let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(*codepoint);
                    Some(*x + (bbox_x + bbox_w * 0.5) * scale)
                }
                _ => None,
            })
            .expect("expected glyph")
    };
    let rest_center = ink_center(smufl::REST_WHOLE);
    let fermata_center = ink_center(smufl::FERMATA_ABOVE);

    assert!(
        (rest_center - fermata_center).abs() < 0.01 * sp,
        "bar-rest ink center {rest_center:.3} and attached fermata center \
         {fermata_center:.3} must share the event anchor"
    );
}

#[test]
fn test_horizon_tempo_clears_fermata_across_following_bar() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 2, "unit": 4}, "tempos": [{
                "bpm": 108,
                "value": {"base": "half"},
                "_x": {"viritura": {"text": "Allegro con brio"}}
            }]},
            {},
            {}
        ]},
        "parts": [{"measures": [
            {
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "half"}, "rest": {}}
                ]}]
            },
            {"sequences": [{"content": [
                {"id": "held-rest", "duration": {"base": "half"}, "rest": {}, "fermata": {}}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "eighth"}, "stemDirection": "up",
                 "notes": [{"pitch": {"step": "G", "octave": 6}}]},
                {"duration": {"base": "dotted-quarter"}, "rest": {}}
            ]}]}
        ]}]
    }"#;
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(90.0),
        ..LayoutConfig::default()
    };
    let sp = config.sp;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let tempo = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "m0/tempo0")
        .expect("tempo bbox")
        .bbox
        .clone();
    let tempo_ink_bottom = dl
        .element_ids
        .iter()
        .enumerate()
        .filter(|(_, id)| id.as_deref() == Some("m0/tempo0"))
        .filter_map(|(index, _)| match &dl.commands[index] {
            command @ RenderCommand::DrawGlyph { .. } => {
                command.bbox().map(|bbox| bbox.y + bbox.height)
            }
            RenderCommand::DrawText {
                y, baseline, size, ..
            } => Some(match baseline {
                TextBaseline::Top => *y + *size,
                TextBaseline::Middle => *y + *size * 0.5,
                TextBaseline::Bottom | TextBaseline::Alphabetic => *y,
            }),
            _ => None,
        })
        .max_by(f64::total_cmp)
        .expect("tempo ink");
    let fermata = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint: smufl::FERMATA_ABOVE,
                size,
                ..
            } => {
                let scale = *size / 4.0;
                let (bbox_x, bbox_y, bbox_w, bbox_h) = smufl::glyph_bbox(smufl::FERMATA_ABOVE);
                Some(BoundingBox::new(
                    *x + bbox_x * scale,
                    *y + bbox_y * scale,
                    bbox_w * scale,
                    bbox_h * scale,
                ))
            }
            _ => None,
        })
        .expect("following-bar fermata");
    assert!(
        tempo.x < fermata.x + fermata.width && fermata.x < tempo.x + tempo.width,
        "fixture must make the opening tempo span the following-bar fermata: \
         tempo={tempo:?}, fermata={fermata:?}"
    );
    let clearance = config
        .placement
        .resolve(crate::layout::ElementKind::Tempo)
        .padding
        .vertical
        * sp;
    assert!(
        tempo_ink_bottom <= fermata.y - clearance + 0.01,
        "tempo ink bottom {tempo_ink_bottom:.3} must clear following-bar fermata top {:.3} \
         by {clearance:.3}px in stitched horizon mode",
        fermata.y
    );
}

#[test]
fn test_fermata_clears_high_note_above_staff() {
    // High note (G6) sits well above the top staff line. Fermata should be
    // pushed up so it clears the notehead with the configured clearance,
    // not just sit at the default `fermata_above_staff` from the staff line.
    let json = score_with_events(
        r#"
        {"duration": {"base": "whole"}, "fermata": {},
         "notes": [{"pitch": {"step": "G", "octave": 6}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let fermata_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::FERMATA_ABOVE => {
                Some(*y)
            }
            _ => None,
        })
        .expect("Should render a fermata glyph");

    let staff_y = config.margin_top * sp;
    let default_fy = staff_y - config.fermata_above_staff * sp;
    assert!(
        fermata_y < default_fy - 0.5,
        "Fermata (y={:.2}) on a high note should be pushed above the default y={:.2}",
        fermata_y,
        default_fy
    );
}

#[test]
fn test_fermata_uses_default_when_note_inside_staff() {
    // B4 sits on the middle staff line; fermata should use the default
    // distance above the top staff line, not be pushed further up.
    let json = score_with_events(
        r#"
        {"duration": {"base": "whole"}, "fermata": {},
         "notes": [{"pitch": {"step": "B", "octave": 4}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let fermata_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::FERMATA_ABOVE => {
                Some(*y)
            }
            _ => None,
        })
        .expect("Should render a fermata glyph");

    let staff_y = config.margin_top * sp;
    let default_fy = staff_y - config.fermata_above_staff * sp;
    assert!(
        (fermata_y - default_fy).abs() < 0.01,
        "Fermata (y={:.2}) on a notehead inside the staff should use default y={:.2}",
        fermata_y,
        default_fy
    );
}

#[test]
fn test_fermata_below_clears_low_note() {
    // Low note in voice 2 with stem-down: orient:below should push the
    // fermata further below than the default to clear the notehead.
    let json = score_with_events(
        r#"
        {"duration": {"base": "whole"}, "fermata": {"orient": "below"},
         "notes": [{"pitch": {"step": "C", "octave": 3}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let fermata_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::FERMATA_BELOW => {
                Some(*y)
            }
            _ => None,
        })
        .expect("Should render a below fermata glyph");

    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    let default_fy = staff_bottom + config.fermata_above_staff * sp;
    assert!(
        fermata_y > default_fy + 0.5,
        "Below fermata (y={:.2}) on a low note should be pushed below the default y={:.2}",
        fermata_y,
        default_fy
    );
}

#[test]
fn test_fermata_explicit_orient_below() {
    // `orient: "below"` should force the fermata under the staff,
    // even on a single-voice high note that would otherwise go above.
    let json = score_with_events(
        r#"
        {"duration": {"base": "whole"}, "fermata": {"orient": "below"},
         "notes": [{"pitch": {"step": "G", "octave": 5}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let has_below = dl.commands.iter().any(|cmd| {
        matches!(
            cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::FERMATA_BELOW
        )
    });

    assert!(has_below, "orient:below should render the BELOW glyph");
}

#[test]
fn test_fermata_on_low_note_sits_one_space_above_staff() {
    // Rhapsody Violin I m14: a whole note Db4 (below the treble staff) carries a
    // fermata. With no notes/stem reaching above the staff, the fermata should
    // sit at its default placement — the glyph baseline (bottom of the curve)
    // ~1sp above the top staff line — not floating 2sp+ high.
    let json = score_with_events(
        r#"
        {"duration": {"base": "whole"}, "fermata": {},
         "notes": [{"pitch": {"step": "D", "octave": 4, "alter": -1}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let fermata_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::FERMATA_ABOVE => {
                Some(*y)
            }
            _ => None,
        })
        .expect("Should render an above fermata glyph");

    let staff_y = config.margin_top * sp;
    let default_fy = staff_y - config.fermata_above_staff * sp;
    // The low note doesn't push the fermata higher, so it stays at the default.
    assert!(
        (fermata_y - default_fy).abs() < 0.01,
        "Low-note fermata (y={:.2}) should sit at the default 1sp above the \
         staff line (y={:.2})",
        fermata_y,
        default_fy
    );
    // And the default must be exactly 1sp above the top line (standard practice),
    // not the old 2sp.
    assert!(
        (staff_y - fermata_y - sp).abs() < 0.01,
        "Fermata baseline should be 1sp above the top staff line; got {:.2}sp",
        (staff_y - fermata_y) / sp
    );
}

#[test]
fn test_fermata_tagged_with_element_id() {
    let json = score_with_events(
        r#"
        {"duration": {"base": "whole"}, "fermata": {},
         "notes": [{"pitch": {"step": "B", "octave": 4}}]}
    "#,
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let fermata_id = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(i, cmd)| match cmd {
            RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::FERMATA_ABOVE => {
                dl.element_ids.get(i).and_then(|opt| opt.as_deref())
            }
            _ => None,
        });

    assert!(
        fermata_id.is_some(),
        "Fermata glyph should have an element ID tag"
    );
    let id = fermata_id.unwrap();
    assert!(
        id.ends_with("/ferm"),
        "Fermata element ID should end with /ferm, got '{}'",
        id
    );
    assert!(
        id.starts_with("p0/m0/s0/"),
        "Fermata element ID should start with p0/m0/s0/, got '{}'",
        id
    );
}

#[test]
fn test_fermata_spacing_no_overlap() {
    // 8 quarter notes each with a fermata (8/4 time) — the pathological case
    // from the screenshot. Fermata glyph (w≈2.408 sp) centered on the notehead
    // must not visually overlap between adjacent events.
    let note = r#"{"duration": {"base": "quarter"}, "fermata": {}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}"#;
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

    // Collect x positions of all fermata glyphs (DrawGlyph x = glyph left edge)
    let fermata_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, x, .. } if *codepoint == smufl::FERMATA_ABOVE => {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(fermata_xs.len(), 8, "Should render 8 fermata glyphs");

    // Fermata half-width in pixels = glyph_w (sp units) * sp * glyph_size_factor.
    // render_fermatas uses glyph_size = 4*sp; glyph_bbox w is in sp units at that size.
    let (_, _, fw, _) = smufl::glyph_bbox(smufl::FERMATA_ABOVE);
    let half_w_px = fw * sp * 0.5; // glyph bbox is normalised to 1sp = 1 unit, scaled by sp

    for i in 0..fermata_xs.len() - 1 {
        // right edge of fermata i = left edge + full width
        let right_edge = fermata_xs[i] + fw * sp;
        let next_left = fermata_xs[i + 1];
        assert!(
            right_edge <= next_left + half_w_px * 0.01, // tiny float tolerance
            "Fermata {} right edge ({:.1}px) overlaps fermata {} left ({:.1}px)",
            i,
            right_edge,
            i + 1,
            next_left,
        );
    }
}

/// Top edge (smallest screen y) of a glyph, via its Bravura bbox. `size` is the
/// render size; glyph_bbox is normalised to 4 units per render size.
fn glyph_top_edge(y: f64, codepoint: u32, size: f64) -> f64 {
    let scale = size / 4.0;
    let (_, by, _, _) = smufl::glyph_bbox(codepoint);
    y + by * scale
}

#[test]
fn test_fermata_sits_above_trill_on_same_note() {
    // A note carrying both a trill and a fermata: the fermata must sit outside
    // (above) the trill — standard engraving practice places the fermata
    // furthest from the staff.
    let json = score_with_events(
        r#"
        {"duration": {"base": "half"}, "fermata": {},
         "markings": {"_x": {"viritura": {"trill": {}}}},
         "notes": [{"pitch": {"step": "G", "octave": 4}}]},
        {"duration": {"base": "half"},
         "notes": [{"pitch": {"step": "D", "octave": 5}}]}
    "#,
    );
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let glyph_size = 4.0 * sp;
    let dl = layout_score(&score, 0, &config);

    let fermata_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::FERMATA_ABOVE => {
                Some(*y)
            }
            _ => None,
        })
        .expect("should render a fermata");
    let trill_y = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::ORNAMENT_TRILL =>
            {
                Some(*y)
            }
            _ => None,
        })
        .expect("should render a trill");

    let fermata_top = glyph_top_edge(fermata_y, smufl::FERMATA_ABOVE, glyph_size);
    let trill_top = glyph_top_edge(trill_y, smufl::ORNAMENT_TRILL, glyph_size);
    assert!(
        fermata_top < trill_top,
        "fermata top ({fermata_top:.1}) should be above the trill top ({trill_top:.1})"
    );
}

#[test]
fn test_fermata_sits_above_accent_on_same_note() {
    // A note carrying both an accent articulation and a fermata: the fermata
    // must sit above the accent. The high note forces a down-stem, so the
    // accent is engraved above the notehead (where it can collide with the
    // fermata).
    let json = score_with_events(
        r#"
        {"duration": {"base": "half"}, "fermata": {},
         "markings": {"accent": {}},
         "notes": [{"pitch": {"step": "E", "octave": 5}}]},
        {"duration": {"base": "half"},
         "notes": [{"pitch": {"step": "D", "octave": 5}}]}
    "#,
    );
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let glyph_size = 4.0 * sp;
    let dl = layout_score(&score, 0, &config);

    let fermata_top = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. } if *codepoint == smufl::FERMATA_ABOVE => {
                Some(glyph_top_edge(*y, *codepoint, glyph_size))
            }
            _ => None,
        })
        .expect("should render a fermata");
    // Accent above glyph = U+E4A0; its bottom edge must clear below the fermata.
    let accent_top = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { codepoint, y, .. }
                if *codepoint == smufl::ARTIC_ACCENT_ABOVE =>
            {
                Some(glyph_top_edge(*y, *codepoint, glyph_size))
            }
            _ => None,
        })
        .expect("should render an accent");
    assert!(
        fermata_top < accent_top,
        "fermata top ({fermata_top:.1}) should be above the accent top ({accent_top:.1})"
    );
}
