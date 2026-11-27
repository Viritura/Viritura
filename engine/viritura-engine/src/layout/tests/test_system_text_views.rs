use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores;
use crate::parse::parse_mnx;
use crate::render::*;
use serde_json::{json, Value};

fn system_text_views_fixture() -> Value {
    let text = json!([
        {
            "id": "above",
            "text": [{ "text": "Shared above" }],
            "position": { "fraction": [0, 1] },
            "placement": "above"
        },
        {
            "id": "below",
            "text": [{ "text": "Shared below" }],
            "position": { "fraction": [1, 2] },
            "placement": "below"
        }
    ]);
    let part = |id: &str, content: Value| {
        json!({
            "id": id,
            "measures": [{
                "sequences": [{ "content": [content] }]
            }]
        })
    };
    json!({
        "mnx": { "version": 1 },
        "global": { "measures": [{
            "id": "m0",
            "time": { "count": 4, "unit": 4 },
            "_x": { "viritura": { "systemText": text } }
        }] },
        "parts": [
            part("P1", json!({
                "id": "p1-event",
                "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 4 } }]
            })),
            part("P2", json!({
                "id": "p2-event",
                "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "G", "octave": 4 } }]
            })),
            part("P3", json!({
                "duration": { "base": "whole" },
                "rest": {}
            }))
        ],
        "layouts": [
            { "id": "full", "content": [
                { "type": "staff", "sources": [{ "part": "P1" }] },
                { "type": "staff", "sources": [{ "part": "P2" }] }
            ] },
            { "id": "part", "content": [
                { "type": "staff", "sources": [{ "part": "P2" }] }
            ] },
            { "id": "condensed", "content": [
                { "type": "staff", "sources": [{ "part": "P1" }, { "part": "P2" }] }
            ] },
            { "id": "hidden", "content": [
                { "type": "staff", "sources": [{ "part": "P1" }] },
                { "type": "staff", "sources": [{ "part": "P3" }] }
            ] }
        ],
        "scores": [
            { "name": "Full", "layout": "full" },
            { "name": "Part", "layout": "part" },
            { "name": "Condensed", "layout": "condensed" },
            {
                "name": "Hidden empty staff",
                "layout": "hidden",
                "_x": { "viritura": { "autoHideEmptyParts": ["P3"] } }
            }
        ]
    })
}

fn system_text_count(display: &DisplayList, id: &str) -> usize {
    display
        .element_bboxes
        .iter()
        .filter(|bbox| bbox.element_id == format!("m0/systemText/{id}"))
        .count()
}

#[test]
fn system_text_renders_once_in_full_part_condensed_and_hidden_staff_views() {
    let score = parse_mnx(&system_text_views_fixture().to_string()).unwrap();
    let config = LayoutConfig {
        page_width: Some(1200.0),
        ..LayoutConfig::default()
    };

    for score_index in 0..3 {
        let display = layout_with_mnx_scores(&score, &config, score_index);
        assert_eq!(
            system_text_count(&display, "above"),
            1,
            "score {score_index}"
        );
        assert_eq!(
            system_text_count(&display, "below"),
            1,
            "score {score_index}"
        );
    }

    let condensed = layout_with_mnx_scores(&score, &config, 2);
    assert_eq!(
        condensed.measure_bounds[0].source_part_indices,
        [0, 1],
        "the test view must actually condense both source parts"
    );

    let hidden = layout_with_mnx_scores(&score, &config, 3);
    assert!(!hidden
        .measure_bounds
        .iter()
        .any(|bounds| bounds.part_index == 2));
    assert_eq!(system_text_count(&hidden, "above"), 1);
    assert_eq!(system_text_count(&hidden, "below"), 1);
}

#[test]
fn system_text_follows_its_measure_when_system_breaks_reflow() {
    let measures: Vec<Value> = (0..4)
        .map(|index| {
            let mut measure = json!({
                "id": format!("m{index}"),
                "time": { "count": 4, "unit": 4 }
            });
            if index == 3 {
                measure["_x"] = json!({ "viritura": { "systemText": [{
                    "id": "reflow",
                    "text": [{ "text": "Follow measure" }],
                    "position": { "fraction": [0, 1] },
                    "placement": "above"
                }] } });
            }
            measure
        })
        .collect();
    let events: Vec<Value> = (0..4)
        .map(|index| {
            json!({
                "id": format!("event{index}"),
                "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 4 } }]
            })
        })
        .collect();
    let source = |break_at: Option<&str>| {
        let mut value = json!({
            "mnx": { "version": 1 },
            "global": { "measures": measures.clone() },
            "parts": [{ "id": "P1", "measures": events.iter().map(|event| json!({
                "sequences": [{ "content": [event.clone()] }]
            })).collect::<Vec<_>>() }],
            "layouts": [{ "id": "L", "content": [
                { "type": "staff", "sources": [{ "part": "P1" }] }
            ] }],
            "scores": [{ "name": "Full", "layout": "L" }]
        });
        if let Some(measure) = break_at {
            value["scores"][0]["_x"] = json!({ "viritura": {
                "layoutBreaks": [{ "measure": measure, "kind": "system" }]
            } });
        }
        value
    };
    let score_before = parse_mnx(&source(None).to_string()).unwrap();
    let score_after = parse_mnx(&source(Some("m2")).to_string()).unwrap();
    let config = LayoutConfig {
        page_width: Some(2000.0),
        ..LayoutConfig::default()
    };
    let before = layout_with_mnx_scores(&score_before, &config, 0);
    let after = layout_with_mnx_scores(&score_after, &config, 0);
    let measure_system = |display: &DisplayList| {
        display
            .measure_bounds
            .iter()
            .find(|bounds| bounds.index == 3)
            .unwrap()
            .system_index
    };
    assert_eq!(measure_system(&before), 0);
    assert_eq!(measure_system(&after), 1);

    let text_y = |display: &DisplayList| {
        display
            .element_bboxes
            .iter()
            .find(|bbox| bbox.element_id == "m3/systemText/reflow")
            .unwrap()
            .bbox
            .y
    };
    assert!(text_y(&after) > text_y(&before));
}
