use super::*;
use serde_json::{json, Value};

fn measure(settings: Option<Value>) -> Value {
    let mut measure = json!({
        "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}]}]
    });
    if let Some(settings) = settings {
        measure["_x"] = json!({"viritura": {"harpPedals": settings}});
    }
    measure
}

const NATURAL: [(&str, i8); 7] = [
    ("D", 0),
    ("C", 0),
    ("B", 0),
    ("E", 0),
    ("F", 0),
    ("G", 0),
    ("A", 0),
];

fn tuning(c: i8) -> Value {
    let mut tuning = serde_json::Map::new();
    for (letter, alter) in NATURAL {
        tuning.insert(letter.into(), json!(if letter == "C" { c } else { alter }));
    }
    Value::Object(tuning)
}

fn late_accidentals(display: &DisplayList) -> usize {
    use viritura_engine::render::{smufl::smufl, RenderCommand};
    display
        .commands
        .iter()
        .zip(&display.element_ids)
        .filter(|(command, tag)| {
            tag.as_deref() == Some("harpPedal/late")
                && matches!(
                    command,
                    RenderCommand::DrawGlyph { codepoint, .. }
                        if (smufl::ACCIDENTAL_FLAT..=smufl::ACCIDENTAL_SHARP).contains(codepoint)
                )
        })
        .count()
}

#[test]
fn editing_a_pedal_setting_refreshes_a_later_changes_marking() {
    let early = |c: i8| {
        measure(Some(json!([{
            "id": "early", "position": {"fraction": [0, 1]}, "tuning": tuning(c)
        }])))
    };
    let mut measures = vec![early(0)];
    measures.extend((0..10).map(|_| measure(None)));
    measures.push(measure(Some(json!([{
        "id": "late", "position": {"fraction": [0, 1]}, "display": "changes", "tuning": tuning(1)
    }]))));
    let mut globals = vec![json!({"time": {"count": 4, "unit": 4}})];
    globals.extend((1..measures.len()).map(|_| json!({})));
    let document = json!({
        "mnx": {"version": 1},
        "global": {"measures": globals},
        "parts": [{"id": "harp", "measures": measures}],
        "layouts": [{"id": "layout", "content": [{"type": "staff", "sources": [{"part": "harp"}]}]}],
        "scores": [{"name": "Score", "layout": "layout"}]
    });
    let patch = json!({"partMeasures": {"0": {"0": early(1)}}});

    let mut engine = LayoutEngine::default();
    let initial = engine
        .compute_full_score_layout_cached_dl(&document.to_string(), 10.0, 200.0, None, Some(0))
        .expect("initial layout");
    assert_eq!(late_accidentals(&initial), 1, "only C moves");
    let patched = engine
        .apply_patch_and_layout_display_list(&patch.to_string(), 10.0, 200.0, None, Some(0))
        .expect("pedal patch");
    assert_eq!(
        late_accidentals(&patched),
        7,
        "nothing moves any more, so all seven names are written"
    );
}

#[test]
fn editing_placement_moves_an_unscoped_marking_between_staves() {
    let harp_measure = |placement: &str| {
        let mut measure = measure(Some(json!([{
            "id": "pedal", "position": {"fraction": [0, 1]},
            "tuning": tuning(0), "placement": placement
        }])));
        measure["sequences"] = json!([
            {"staff": 1, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]},
            {"staff": 2, "content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}
        ]);
        measure
    };
    let document = json!({
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"id": "harp", "staves": 2, "measures": [harp_measure("below")]}],
        "layouts": [{"id": "layout", "content": [{
            "type": "group", "symbol": "brace", "content": [
                {"type": "staff", "sources": [{"part": "harp", "staff": 1}]},
                {"type": "staff", "sources": [{"part": "harp", "staff": 2}]}
            ]
        }]}],
        "scores": [{"name": "Score", "layout": "layout"}]
    });
    let position = |display: &DisplayList| {
        let mut staff_ys: Vec<_> = display
            .measure_bounds
            .iter()
            .filter(|bounds| bounds.index == 0)
            .map(|bounds| bounds.y)
            .collect();
        staff_ys.sort_by(f64::total_cmp);
        staff_ys.dedup_by(|a, b| (*a - *b).abs() < 0.01);
        assert_eq!(staff_ys.len(), 2);
        let bbox = &display
            .element_bboxes
            .iter()
            .find(|bbox| bbox.element_id == "harpPedal/pedal")
            .unwrap()
            .bbox;
        (staff_ys[0], staff_ys[1], bbox.y, bbox.y + bbox.height)
    };

    let mut engine = LayoutEngine::default();
    let initial = engine
        .compute_full_score_layout_cached_dl(&document.to_string(), 10.0, 200.0, None, Some(0))
        .expect("initial layout");
    let (_, lower, initial_top, _) = position(&initial);
    assert!(
        initial_top > lower + 40.0,
        "the initial marking is below the lower staff"
    );

    let patch = json!({"partMeasures": {"0": {"0": harp_measure("above")}}});
    let patched = engine
        .apply_patch_and_layout_display_list(&patch.to_string(), 10.0, 200.0, None, Some(0))
        .expect("placement patch");
    let (upper, _, _, patched_bottom) = position(&patched);
    assert!(
        patched_bottom < upper,
        "the patched marking is above the upper staff"
    );
    assert_eq!(
        patched
            .commands
            .iter()
            .zip(&patched.element_ids)
            .filter(|(command, id)| {
                id.as_deref() == Some("harpPedal/pedal")
                    && matches!(
                        command,
                        viritura_engine::render::RenderCommand::DrawGlyph { codepoint, .. }
                            if *codepoint == viritura_engine::render::smufl::smufl::HARP_PEDAL_DIVIDER
                    )
            })
            .count(),
        1,
        "the old staff must not retain a duplicate"
    );
}
