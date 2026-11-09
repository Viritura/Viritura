use super::*;
use serde_json::json;

#[test]
fn clef_changes_refresh_inherited_notes_after_paste() {
    let note = json!({
        "id": "source",
        "duration": {"base": "whole"},
        "notes": [{"pitch": {"step": "C", "octave": 4}}]
    });
    let mut document = json!({
        "mnx": {"version": 1},
        "global": {"measures": [
            {"id": "m0", "time": {"count": 4, "unit": 4}},
            {"id": "m1"}, {"id": "m2"}
        ]},
        "parts": [{"id": "piano", "staves": 2, "measures": [
            {
                "clefs": [
                    {"staff": 1, "clef": {"sign": "G", "staffPosition": -2}},
                    {"staff": 2, "clef": {"sign": "F", "staffPosition": 2}}
                ],
                "sequences": [
                    {"staff": 1, "content": [note]},
                    {"staff": 2, "content": [], "fullMeasure": {}}
                ]
            },
            {"sequences": [
                {"staff": 1, "content": [], "fullMeasure": {}},
                {"staff": 2, "content": [], "fullMeasure": {}}
            ]},
            {"sequences": [
                {"staff": 1, "content": [], "fullMeasure": {}},
                {"staff": 2, "content": [], "fullMeasure": {}}
            ]}
        ]}],
        "layouts": [{"id": "layout", "content": [
            {"type": "staff", "sources": [{"part": "piano", "staff": 1}]},
            {"type": "staff", "sources": [{"part": "piano", "staff": 2}]}
        ]}],
        "scores": [{"name": "Piano", "layout": "layout"}]
    });
    let piano = document["parts"][0].clone();
    document["parts"] = json!([]);
    for (index, id) in ["treble", "bass"].iter().enumerate() {
        let mut part = piano.clone();
        part["id"] = json!(id);
        part["staves"] = json!(1);
        for measure in part["measures"].as_array_mut().unwrap() {
            let mut sequence = measure["sequences"][index].clone();
            sequence.as_object_mut().unwrap().remove("staff");
            measure["sequences"] = json!([sequence]);
            if let Some(clefs) = measure.get_mut("clefs") {
                let mut clef = clefs[index].clone();
                clef.as_object_mut().unwrap().remove("staff");
                *clefs = json!([clef]);
            }
        }
        document["parts"].as_array_mut().unwrap().push(part);
    }
    document["layouts"][0]["content"] = json!([
        {"type": "staff", "sources": [{"part": "treble"}]},
        {"type": "staff", "sources": [{"part": "bass"}]}
    ]);
    document["parts"][1]["measures"][2]["sequences"][0] = json!({"content": [{"id": "following", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]});
    for (width, scoped_resolve) in [0.0, 160.0, 800.0]
        .into_iter()
        .flat_map(|width| [true, false].map(|scoped| (width, scoped)))
    {
        let mut engine = LayoutEngine::default();
        engine.cache.set_range_scope(RangeScope {
            scoped_resolve,
            scoped_precompute: true,
            ..Default::default()
        });
        engine
            .compute_full_score_layout_cached_dl(&document.to_string(), 10.0, width, None, Some(0))
            .expect("initial layout");
        let mut pasted = note.clone();
        pasted["id"] = json!("pasted");
        document["parts"][1]["measures"][1]["sequences"][0] = json!({"content": [pasted]});
        document["parts"][1]["measures"][1]["clefs"] =
            json!([{"clef": {"sign": "G", "staffPosition": -2}}]);
        let patch = json!({"partMeasures": {"1": {"1": document["parts"][1]["measures"][1]}}});
        let warm = engine
            .apply_patch_and_layout_display_list(&patch.to_string(), 10.0, width, None, Some(0))
            .expect("paste layout");
        let cold = LayoutEngine::default()
            .compute_full_score_layout_cached_dl(&document.to_string(), 10.0, width, None, Some(0))
            .expect("cold layout");
        let relative_y = |display: &DisplayList, id: &str, measure_index: usize| {
            let event = display
                .element_bboxes
                .iter()
                .find(|entry| entry.element_id.ends_with(id))
                .expect("pasted event");
            let staff = display
                .measure_bounds
                .iter()
                .find(|bound| bound.index == measure_index && bound.staff_index == 1)
                .expect("destination staff");
            event.bbox.y - staff.y
        };
        assert_eq!(
            relative_y(&warm, "/pasted", 1),
            relative_y(&cold, "/pasted", 1)
        );
        assert_eq!(
            relative_y(&warm, "/following", 2),
            relative_y(&cold, "/following", 2)
        );
        document["parts"][1]["measures"][1]["sequences"][0] =
            json!({"content": [], "fullMeasure": {}});
        document["parts"][1]["measures"][1]
            .as_object_mut()
            .unwrap()
            .remove("clefs");
        let removal = json!({"partMeasures": {"1": {"1": document["parts"][1]["measures"][1]}}});
        let restored = engine
            .apply_patch_and_layout_display_list(&removal.to_string(), 10.0, width, None, Some(0))
            .expect("remove pasted clef");
        let restored_cold = LayoutEngine::default()
            .compute_full_score_layout_cached_dl(&document.to_string(), 10.0, width, None, Some(0))
            .expect("cold layout after removing clef");
        assert_eq!(
            relative_y(&restored, "/following", 2),
            relative_y(&restored_cold, "/following", 2)
        );
    }
}
