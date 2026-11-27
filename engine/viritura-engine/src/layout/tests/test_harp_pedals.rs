use crate::layout::{layout_score, LayoutConfig};
use crate::parse::parse_mnx;
use crate::render::{smufl::smufl, RenderCommand};
use serde_json::{json, Value};

fn document() -> Value {
    json!({
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "id": "harp", "name": "Harp", "staves": 2,
            "measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}, "staff": 1},
                    {"clef": {"sign": "F", "staffPosition": 2}, "staff": 2}
                ],
                "sequences": [
                    {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
                    {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
                ],
                "_x": {"viritura": {"harpPedals": [{
                    "id": "hp", "position": {"fraction": [0, 1]},
                    "tuning": {"D": -1, "C": 0, "B": 1, "E": 0, "F": 1, "G": -1, "A": 0},
                    "source": "calculated"
                }]}}
            }]
        }]
    })
}

#[test]
fn harp_pedals_render_in_foot_order_once_with_joined_glyphs_and_selection_bounds() {
    let score = parse_mnx(&document().to_string()).unwrap();
    let setting = &score.parts[0].measures[0].harp_pedals.as_ref().unwrap()[0];
    assert_eq!(setting.position.fraction, (0, 1));
    assert_eq!(
        setting.source,
        Some(crate::model::HarpPedalSource::Calculated)
    );
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let glyphs: Vec<_> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                font,
                ..
            } if (smufl::HARP_PEDAL_RAISED..=smufl::HARP_PEDAL_DIVIDER).contains(codepoint) => {
                Some((*x, *y, *codepoint, *size, font))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        glyphs.iter().map(|g| g.2).collect::<Vec<_>>(),
        vec![
            smufl::HARP_PEDAL_RAISED,
            smufl::HARP_PEDAL_CENTERED,
            smufl::HARP_PEDAL_LOWERED,
            smufl::HARP_PEDAL_DIVIDER,
            smufl::HARP_PEDAL_CENTERED,
            smufl::HARP_PEDAL_LOWERED,
            smufl::HARP_PEDAL_RAISED,
            smufl::HARP_PEDAL_CENTERED,
        ]
    );
    for pair in glyphs.windows(2) {
        assert!((pair[1].0 - pair[0].0 - pair[0].3 / 4.0).abs() < 1e-6);
        assert!((pair[1].1 - pair[0].1).abs() < 1e-6);
    }
    let bounds = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "harpPedal/hp")
        .unwrap();
    for &(x, y, codepoint, size, font) in &glyphs {
        assert_eq!(font, "Bravura");
        let (bx, by, bw, bh) = smufl::glyph_bbox(codepoint);
        let scale = size / 4.0;
        assert!(y + by * scale >= bounds.bbox.y - 1e-6);
        assert!(y + (by + bh) * scale <= bounds.bbox.y + bounds.bbox.height + 1e-6);
        assert!(x + (bx + bw) * scale <= bounds.bbox.x + bounds.bbox.width + 0.01 * config.sp);
    }
}

#[test]
fn harp_pedals_follow_presentation_staff_and_rhythmic_position() {
    let mut input = document();
    input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["placement"] =
        json!("below");
    let mut score = parse_mnx(&input.to_string()).unwrap();
    let lower = layout_score(&score, 0, &LayoutConfig::default());
    input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["staff"] = json!(1);
    score = parse_mnx(&input.to_string()).unwrap();
    let upper = layout_score(&score, 0, &LayoutConfig::default());
    let y = |dl: &crate::render::DisplayList| {
        dl.commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph { y, codepoint, .. }
                    if *codepoint == smufl::HARP_PEDAL_DIVIDER =>
                {
                    Some(*y)
                }
                _ => None,
            })
            .unwrap()
    };
    assert!(y(&upper) < y(&lower));
    input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["position"] =
        json!({"fraction": [1, 2]});
    let later = layout_score(
        &parse_mnx(&input.to_string()).unwrap(),
        0,
        &LayoutConfig::default(),
    );
    let x = |dl: &crate::render::DisplayList| {
        dl.commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if *codepoint == smufl::HARP_PEDAL_DIVIDER =>
                {
                    Some(*x)
                }
                _ => None,
            })
            .unwrap()
    };
    assert!(x(&later) > x(&upper));
}

#[test]
fn harp_pedals_support_above_between_below_and_manual_offsets() {
    let input = document();
    let layout_y = |placement: &str, offset: [f64; 2]| {
        let mut input = input.clone();
        input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["placement"] =
            json!(placement);
        input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["staff"] = json!(1);
        input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["manualOffset"] =
            json!(offset);
        input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["avoidCollisions"] =
            json!(false);
        let score = parse_mnx(&input.to_string()).unwrap();
        let dl = layout_score(&score, 0, &LayoutConfig::default());
        dl.commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph { y, codepoint, .. }
                    if *codepoint == smufl::HARP_PEDAL_DIVIDER =>
                {
                    Some(*y)
                }
                _ => None,
            })
            .unwrap()
    };
    let above = layout_y("above", [0.0, 0.0]);
    let between = layout_y("between", [0.0, 0.0]);
    let below = layout_y("below", [0.0, 0.0]);
    let offset = layout_y("between", [0.0, 1.0]);
    assert!(above != between && between != below && above != below);
    assert!((offset - (between - LayoutConfig::default().sp)).abs() < 1e-6);
    assert_eq!(
        layout_y("auto", [0.0, 0.0]),
        between,
        "auto should use the inter-staff lane"
    );
}

#[test]
fn unscoped_harp_pedal_placement_uses_the_outer_or_between_staves() {
    let config = LayoutConfig::default();
    for display in ["diagram", "names", "changes"] {
        let mut input = document();
        let template = input["parts"][0]["measures"][0].clone();
        let measures: Vec<_> = ["above", "between", "below"]
            .into_iter()
            .map(|placement| {
                let mut measure = template.clone();
                let setting = &mut measure["_x"]["viritura"]["harpPedals"][0];
                setting["id"] = json!(placement);
                setting["placement"] = json!(placement);
                setting["display"] = json!(display);
                measure
            })
            .collect();
        input["parts"][0]["measures"] = json!(measures);
        input["global"]["measures"] = json!([{"time": {"count": 4, "unit": 4}}, {}, {}]);
        let score = parse_mnx(&input.to_string()).unwrap();

        for dl in [
            layout_score(&score, 0, &config),
            crate::layout::layout_full_score(&score, &config),
        ] {
            let mut staff_ys: Vec<_> = dl
                .measure_bounds
                .iter()
                .filter(|bounds| bounds.index == 0)
                .map(|bounds| bounds.y)
                .collect();
            staff_ys.sort_by(f64::total_cmp);
            staff_ys.dedup_by(|a, b| (*a - *b).abs() < 0.01);
            assert_eq!(staff_ys.len(), 2);
            let bbox = |placement: &str| {
                &dl.element_bboxes
                    .iter()
                    .find(|bbox| bbox.element_id == format!("harpPedal/{placement}"))
                    .unwrap()
                    .bbox
            };
            let above = bbox("above");
            let between = bbox("between");
            let below = bbox("below");
            assert!(
                above.y + above.height < staff_ys[0],
                "{display} above should be above the upper staff"
            );
            assert!(
                between.y >= staff_ys[0] + 4.0 * config.sp
                    && between.y + between.height <= staff_ys[1],
                "{display} between should be between the staves"
            );
            assert!(
                below.y > staff_ys[1] + 4.0 * config.sp,
                "{display} below should be below the lower staff"
            );
        }
    }
}

#[test]
fn explicitly_scoped_harp_pedal_above_uses_its_selected_staff() {
    let mut input = document();
    let setting = &mut input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0];
    setting["placement"] = json!("above");
    setting["staff"] = json!(2);
    let score = parse_mnx(&input.to_string()).unwrap();
    let config = LayoutConfig::default();
    for dl in [
        layout_score(&score, 0, &config),
        crate::layout::layout_full_score(&score, &config),
    ] {
        let mut staff_ys: Vec<_> = dl
            .measure_bounds
            .iter()
            .filter(|bounds| bounds.index == 0)
            .map(|bounds| bounds.y)
            .collect();
        staff_ys.sort_by(f64::total_cmp);
        staff_ys.dedup_by(|a, b| (*a - *b).abs() < 0.01);
        assert_eq!(staff_ys.len(), 2);
        let bbox = &dl
            .element_bboxes
            .iter()
            .find(|bbox| bbox.element_id == "harpPedal/hp")
            .unwrap()
            .bbox;
        assert!(bbox.y + bbox.height > staff_ys[0] + 4.0 * config.sp);
        assert!(bbox.y + bbox.height < staff_ys[1]);
    }
}

#[test]
fn harp_pedals_center_between_staves_on_the_horizontal_bar() {
    let mut input = document();
    let template = input["parts"][0]["measures"][0].clone();
    let mut measures = Vec::new();
    for (index, alter) in [-1, 0, 1].into_iter().enumerate() {
        let mut measure = template.clone();
        let setting = &mut measure["_x"]["viritura"]["harpPedals"][0];
        setting["id"] = json!(format!("hp{index}"));
        setting["tuning"] = json!({
            "D": alter, "C": alter, "B": alter, "E": alter,
            "F": alter, "G": alter, "A": alter
        });
        if index == 1 {
            setting["placement"] = json!("auto");
            setting["staff"] = json!(1);
        } else if index == 2 {
            setting["placement"] = json!("between");
            setting["staff"] = json!(2);
            measure["dynamics"] = json!([{
                "id": "below", "type": "immediate", "value": "p",
                "position": {"fraction": [0, 1]}, "placement": "below", "staff": 2
            }]);
        }
        measures.push(measure);
    }
    input["parts"][0]["measures"] = json!(measures);
    input["global"]["measures"] = json!([{"time": {"count": 4, "unit": 4}}, {}, {}]);
    let score = parse_mnx(&input.to_string()).unwrap();
    let config = LayoutConfig::default();
    for dl in [
        layout_score(&score, 0, &config),
        crate::layout::layout_full_score(&score, &config),
    ] {
        let mut staff_ys: Vec<_> = dl
            .measure_bounds
            .iter()
            .filter(|bounds| bounds.index == 0)
            .map(|bounds| bounds.y)
            .collect();
        staff_ys.sort_by(f64::total_cmp);
        staff_ys.dedup_by(|a, b| (*a - *b).abs() < 0.01);
        assert_eq!(staff_ys.len(), 2);
        let gap_center = (staff_ys[0] + 4.0 * config.sp + staff_ys[1]) * 0.5;
        let (_, divider_top, _, divider_height) = smufl::glyph_bbox(smufl::HARP_PEDAL_DIVIDER);
        let bars: Vec<_> = dl
            .commands
            .iter()
            .filter_map(|command| match command {
                RenderCommand::DrawGlyph {
                    y, size, codepoint, ..
                } if *codepoint == smufl::HARP_PEDAL_DIVIDER => {
                    Some(y + (divider_top + divider_height * 0.5) * size / 4.0)
                }
                _ => None,
            })
            .collect();
        assert_eq!(bars.len(), 3);
        for bar_y in bars {
            assert!(
                (bar_y - gap_center).abs() < 1e-6,
                "pedal bar at {bar_y} must align with staff gap center {gap_center}"
            );
        }
    }
}

#[test]
fn full_written_harp_pedals_erase_background_behind_their_printed_marking() {
    for (display, erase) in [("diagram", false), ("names", true), ("changes", false)] {
        let mut input = document();
        input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["display"] =
            json!(display);
        let score = parse_mnx(&input.to_string()).unwrap();
        let dl = crate::layout::layout_full_score(&score, &LayoutConfig::default());
        let mask_index = dl.commands.iter().enumerate().find_map(|(index, command)| {
            (matches!(command, RenderCommand::EraseRect { .. })
                && dl.element_ids[index].as_deref() == Some("harpPedal/hp"))
            .then_some(index)
        });
        if !erase {
            assert!(
                mask_index.is_none(),
                "{display} should not erase its background"
            );
            continue;
        }
        let mask_index = mask_index.expect("full written pedals should erase their background");
        let RenderCommand::EraseRect { x, y, w, h } = dl.commands[mask_index] else {
            unreachable!();
        };
        let bounds = &dl
            .element_bboxes
            .iter()
            .find(|bbox| bbox.element_id == "harpPedal/hp")
            .unwrap()
            .bbox;
        assert_eq!(
            (x, y, w, h),
            (bounds.x, bounds.y, bounds.width, bounds.height)
        );
        assert!(dl.commands.iter().enumerate().any(|(index, command)| {
            index > mask_index
                && dl.element_ids[index].as_deref() == Some("harpPedal/hp")
                && matches!(command, RenderCommand::DrawGlyph { .. })
        }));
        assert!(
            dl.commands
                .iter()
                .enumerate()
                .filter(|(_, command)| matches!(command, RenderCommand::DrawLine { .. }))
                .all(|(index, _)| index < mask_index),
            "staff lines and barlines must be behind the harp marking"
        );
    }
}

fn pedal_names(dl: &crate::render::DisplayList, id: &str) -> Vec<String> {
    let mut names = Vec::new();
    for (command, element_id) in dl.commands.iter().zip(&dl.element_ids) {
        if element_id.as_deref() != Some(id) {
            continue;
        }
        match command {
            RenderCommand::DrawText { text, .. }
                if text.trim_start_matches([' ', '|']).len() == 1
                    && text.trim_start_matches([' ', '|']).as_bytes()[0].is_ascii_uppercase() =>
            {
                names.push(text.clone());
            }
            RenderCommand::DrawGlyph { codepoint, .. }
                if matches!(
                    *codepoint,
                    smufl::ACCIDENTAL_FLAT | smufl::ACCIDENTAL_NATURAL | smufl::ACCIDENTAL_SHARP
                ) && !names.is_empty() =>
            {
                let symbol = match *codepoint {
                    smufl::ACCIDENTAL_FLAT => 'b',
                    smufl::ACCIDENTAL_NATURAL => 'n',
                    _ => '#',
                };
                names.last_mut().unwrap().push(symbol);
            }
            _ => {}
        }
    }
    names
}

#[test]
fn harp_pedals_can_print_all_names_or_only_changes_from_the_preceding_setting() {
    let mut input = document();
    input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["display"] = json!("names");
    let names = pedal_names(
        &layout_score(
            &parse_mnx(&input.to_string()).unwrap(),
            0,
            &LayoutConfig::default(),
        ),
        "harpPedal/hp",
    );
    assert_eq!(names, ["Db", "Cn", "B#", "| En", "F#", "Gb", "An"]);

    let first = input["parts"][0]["measures"][0].clone();
    let mut second = first.clone();
    second["_x"]["viritura"]["harpPedals"] = json!([{
        "id": "hp2", "position": {"fraction": [0, 1]}, "display": "changes",
        "tuning": {"D": -1, "C": 1, "B": 1, "E": 0, "F": 0, "G": -1, "A": 0}
    }]);
    let mut empty = first.clone();
    empty.as_object_mut().unwrap().remove("_x");
    input["parts"][0]["measures"] = json!([first, empty, second]);
    input["global"]["measures"] = json!([{"time": {"count": 4, "unit": 4}}, {}, {}]);
    let names = pedal_names(
        &layout_score(
            &parse_mnx(&input.to_string()).unwrap(),
            0,
            &LayoutConfig::default(),
        ),
        "harpPedal/hp2",
    );
    assert_eq!(
        names,
        ["C#", "Fn"],
        "changes compare against the latest earlier setting"
    );

    // A no-op change, or a first setting, falls back to all seven names.
    input["parts"][0]["measures"][2]["_x"]["viritura"]["harpPedals"][0]["tuning"] =
        input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["tuning"].clone();
    input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["display"] =
        json!("changes");
    let dl = layout_score(
        &parse_mnx(&input.to_string()).unwrap(),
        0,
        &LayoutConfig::default(),
    );
    assert_eq!(pedal_names(&dl, "harpPedal/hp").len(), 7);
    assert_eq!(pedal_names(&dl, "harpPedal/hp2").len(), 7);
}

#[test]
fn harp_pedals_reject_bad_tuning_positions_and_ids_without_silent_loss() {
    for replacement in [
        json!({"id": "hp", "position": {"fraction": [0, 1]}, "tuning": {"C": 0}}),
        json!({"id": "hp", "position": {"fraction": [0, 0]}, "tuning": {"D": 0, "C": 0, "B": 0, "E": 0, "F": 0, "G": 0, "A": 0}}),
        json!({"id": "hp", "position": {"fraction": [0, 1], "graceIndex": 0}, "tuning": {"D": 0, "C": 0, "B": 0, "E": 0, "F": 0, "G": 0, "A": 0}}),
    ] {
        let mut input = document();
        input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"] = json!([replacement]);
        assert!(parse_mnx(&input.to_string()).is_err());
    }
    let mut input = document();
    let setting = input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0].clone();
    input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"] =
        json!([setting.clone(), setting]);
    assert!(parse_mnx(&input.to_string()).is_err());
    let mut input = document();
    input["parts"][0]["measures"][0]["_x"]["viritura"]["harpPedals"][0]["staff"] = json!(3);
    assert!(parse_mnx(&input.to_string()).is_err());
    let mut input = document();
    let measure = input["parts"][0]["measures"][0].clone();
    input["parts"][0]["measures"] = json!([measure.clone(), measure]);
    input["global"]["measures"] = json!([{"time": {"count": 4, "unit": 4}}, {}]);
    assert!(parse_mnx(&input.to_string()).is_err());
}

#[test]
fn harp_pedal_changes_are_not_hidden_inside_collapsed_rest_ranges() {
    let mut input = document();
    input["parts"][0]["staves"] = json!(1);
    let mut marked = input["parts"][0]["measures"][0].clone();
    marked["sequences"] = json!([{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]);
    let mut unmarked = marked.clone();
    unmarked.as_object_mut().unwrap().remove("_x");
    input["parts"][0]["measures"] = json!([
        unmarked.clone(),
        unmarked.clone(),
        marked,
        unmarked.clone(),
        unmarked
    ]);
    input["global"]["measures"] = json!([{"time": {"count": 4, "unit": 4}}, {}, {}, {}, {}]);
    let score = parse_mnx(&input.to_string()).unwrap();
    let resolved = crate::layout::resolve::resolve_measures(&score, 0);
    assert_eq!(
        crate::layout::resolve::detect_multimeasure_rest_groups(&resolved),
        vec![(0, 2), (3, 2)]
    );
}
