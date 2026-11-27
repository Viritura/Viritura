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
