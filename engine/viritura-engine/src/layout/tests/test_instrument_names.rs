use crate::layout::page::{initial_instrument_instruction, resolve_part_display_names_at};
use crate::layout::resolve::resolve_measures;
use crate::layout::{layout_score, layout_with_mnx_scores, LayoutConfig};
use crate::model::Score;
use crate::parse::parse_mnx;
use crate::render::{DisplayList, RenderCommand};
use serde_json::{json, Value};

fn interval(half_steps: i32, staff_distance: i32) -> Value {
    json!({"interval":{"halfSteps":half_steps,"staffDistance":staff_distance}})
}

fn document() -> Value {
    let measure = json!({"sequences":[{"content":[
        {"duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":4}}]}
    ]}]});
    json!({
        "mnx":{"version":1},
        "global":{"measures":[
            {"id":"m1","time":{"count":4,"unit":4}},{"id":"m2"},{"id":"m3"},{"id":"m4"}
        ]},
        "parts":[
            {"id":"p1","name":"Clarinet","shortName":"Cl.","transposition":interval(2,1),
             "_x":{"viritura":{"initialInstrument":"cl","instruments":{
                "cl":{"instrumentId":"wind.reed.clarinet","name":"Clarinet","shortName":"Cl.","transposition":interval(2,1)},
                "alias":{"instrumentId":"wind.reed.clarinet","name":"Clarinet","shortName":"Cl.","transposition":interval(2,1)},
                "fl":{"instrumentId":"wind.flutes.flute","name":"Flute","shortName":"Fl."},
                "unused":{"instrumentId":"brass.french-horn","name":"Horn","transposition":interval(7,4)}
             }}},
             "measures":[measure.clone(),measure.clone(),measure.clone(),measure.clone()]},
            {"id":"p2","name":"Violin","shortName":"Vln.",
             "measures":[measure.clone(),measure.clone(),measure.clone(),measure]}
        ],
        "layouts":[{"id":"score","content":[
            {"type":"staff","sources":[{"part":"p1"}],"labelref":"name"},
            {"type":"staff","sources":[{"part":"p2"}],"labelref":"name"}
        ]}],
        "scores":[{"name":"Score","layout":"score","pages":[{"systems":[{"measure":"m1"},{"measure":"m3"}]}]}]
    })
}

fn parse(value: &Value) -> Score {
    parse_mnx(&value.to_string()).unwrap()
}

fn texts(display: &DisplayList) -> Vec<&str> {
    display
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawText { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn change(value: &mut Value, index: usize, declaration: Value) {
    value["parts"][0]["measures"][index]["_x"] =
        json!({"viritura":{"instrumentChanges":[declaration]}});
}

#[test]
fn instrument_names_list_effective_states_once_on_every_system() {
    let mut value = document();
    change(
        &mut value,
        1,
        json!({"instrument":"fl","instruction":{"hidden":true}}),
    );
    change(
        &mut value,
        2,
        json!({"instrument":"alias","instruction":{"hidden":true}}),
    );
    let score = parse(&value);
    for index in [0, 1, 3] {
        let names = resolve_part_display_names_at(&score.parts, index);
        assert_eq!(names[0].display_name, "Clarinet in B\u{266d}\nFlute in C");
        assert_eq!(names[0].display_short_name, "Cl. in B\u{266d}\nFl. in C");
    }
    let resolved = resolve_measures(&score, 0);
    let expressions = resolved[0].part.expressions.as_ref().unwrap();
    assert_eq!(expressions.len(), 1);
    assert_eq!(expressions[0].text.plain_text(), "Clarinet in B\u{266d}");
    assert_eq!(expressions[0].position.fraction, (0, 1));
    let display = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    let ink = texts(&display);
    for text in ["Clarinet", "Flute", "Cl.", "Fl.", "in B\u{266d}", "in C"] {
        assert!(ink.contains(&text), "{text}: {ink:?}");
    }
    assert!(!ink.contains(&"Horn"));
    for display in [
        layout_score(&score, 0, &LayoutConfig::default()),
        crate::layout::full_score::layout_full_score(&score, &LayoutConfig::default()),
    ] {
        assert!(texts(&display).contains(&"Clarinet in B\u{266d}"));
    }
}

#[test]
fn instrument_names_initial_label_requires_a_real_change_and_respects_first_bar_declaration() {
    let mut value = document();
    assert_eq!(
        initial_instrument_instruction(&parse(&value).parts[0]),
        None
    );
    change(&mut value, 1, json!({"instrument":"alias","reminder":{}}));
    assert_eq!(
        initial_instrument_instruction(&parse(&value).parts[0]),
        None
    );
    change(&mut value, 2, json!({"instrument":"fl"}));
    assert_eq!(
        initial_instrument_instruction(&parse(&value).parts[0]),
        Some("Clarinet in B\u{266d}".into())
    );
    change(&mut value, 0, json!({"instrument":"cl"}));
    assert_eq!(
        initial_instrument_instruction(&parse(&value).parts[0]),
        None
    );
    change(&mut value, 0, json!({"instrument":"fl"}));
    let score = parse(&value);
    assert_eq!(
        resolve_part_display_names_at(&score.parts, 0)[0].display_name,
        "Flute in C\nClarinet in B\u{266d}"
    );
    assert_eq!(
        resolve_measures(&score, 0)[0]
            .part
            .expressions
            .as_ref()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn instrument_names_octave_tunings_are_musically_distinct() {
    for (name, initial, changes, expected) in [
        (
            "Horn",
            interval(2, 1),
            vec![interval(14, 8), interval(2, 1)],
            "Horn in B\u{266d} alto\nHorn in B\u{266d} basso",
        ),
        (
            "Clarinet",
            interval(-3, -2),
            vec![interval(9, 5), interval(-3, -2)],
            "Clarinet in E\u{266d} piccolo\nClarinet in E\u{266d} alto",
        ),
        (
            "Flute",
            interval(0, 0),
            vec![interval(-12, -7), interval(0, 0)],
            "Flute in C (sounds C4 for written C4)\nFlute in C (sounds C5 for written C4)",
        ),
    ] {
        let mut value = document();
        value["parts"][0].as_object_mut().unwrap().remove("_x");
        value["parts"][0]["name"] = json!(name);
        value["parts"][0]["transposition"] = initial;
        for (index, transposition) in changes.into_iter().enumerate() {
            change(
                &mut value,
                index + 1,
                json!({"transposition":transposition}),
            );
        }
        let score = parse(&value);
        assert_eq!(
            resolve_part_display_names_at(&score.parts, 3)[0].display_name,
            expected
        );
        assert_eq!(
            initial_instrument_instruction(&score.parts[0]).as_deref(),
            expected.lines().next()
        );
    }
}

#[test]
fn instrument_names_keep_authored_layout_labels_under_every_policy() {
    let mut value = document();
    change(
        &mut value,
        1,
        json!({"instrument":"fl","instruction":{"hidden":true}}),
    );
    value["layouts"][0]["content"][0]["label"] = json!("Reeds player");
    for policy in ["full", "short"] {
        value["scores"][0]["_x"] = json!({"viritura":{"instrumentNameDisplay":{
            "firstSystem":policy,"subsequentSystems":policy
        }}});
        let display = layout_with_mnx_scores(&parse(&value), &LayoutConfig::default(), 0);
        let ink = texts(&display);
        assert_eq!(
            ink.iter().filter(|text| **text == "Reeds player").count(),
            2
        );
        assert!(!ink.contains(&"Flute"));
        assert!(!ink.contains(&"Fl."));
        assert!(ink.contains(&"Clarinet in B\u{266d}"));
    }
}

#[test]
fn instrument_names_native_static_labels_are_unchanged() {
    let mut value = document();
    value["parts"][0].as_object_mut().unwrap().remove("_x");
    let score = parse(&value);
    let names = resolve_part_display_names_at(&score.parts, 0);
    assert_eq!(names[0].display_name, "Clarinet in B\u{266d}");
    assert_eq!(names[0].display_short_name, "Cl. in B\u{266d}");
    assert!(resolve_measures(&score, 0)[0].part.expressions.is_none());
    assert_eq!(initial_instrument_instruction(&score.parts[0]), None);
}

#[test]
fn instrument_names_new_identity_gets_its_own_abbreviation_and_player_number() {
    let mut value = document();
    value["parts"][0]["_x"]["viritura"]["instruments"]["fl"]
        .as_object_mut()
        .unwrap()
        .remove("shortName");
    change(&mut value, 1, json!({"instrument":"fl"}));
    let mut other = value["parts"][0].clone();
    other["id"] = json!("p2");
    value["parts"][1] = other;
    let score = parse(&value);
    let names = resolve_part_display_names_at(&score.parts, 0);
    assert_eq!(
        names[0].display_name,
        "Clarinet in B\u{266d} 1\nFlute in C 1"
    );
    assert_eq!(
        names[0].display_short_name,
        "Cl. in B\u{266d} 1\nFl. in C 1"
    );
    assert_eq!(
        names[1].display_short_name,
        "Cl. in B\u{266d} 2\nFl. in C 2"
    );
}

#[test]
fn instrument_names_rewrite_authored_tuning_and_register_in_both_names() {
    let mut value = document();
    value["parts"][0]["_x"]["viritura"]["instruments"]["cl"]["name"] =
        json!("Horn in B\u{266d} alto");
    value["parts"][0]["_x"]["viritura"]["instruments"]["cl"]["shortName"] =
        json!("Hn. in B\u{266d} alto");
    change(&mut value, 1, json!({"transposition":interval(14,8)}));
    let score = parse(&value);
    let names = resolve_part_display_names_at(&score.parts, 0);
    assert_eq!(
        names[0].display_name,
        "Horn in B\u{266d} alto\nHorn in B\u{266d} basso"
    );
    assert_eq!(
        names[0].display_short_name,
        "Hn. in B\u{266d} alto\nHn. in B\u{266d} basso"
    );
}

#[test]
fn instrument_names_split_sources_keep_each_players_labels() {
    let mut value = document();
    change(
        &mut value,
        1,
        json!({"instrument":"fl","instruction":{"hidden":true}}),
    );
    value["layouts"][0]["content"] = json!([{
        "type":"staff","sources":[
            {"part":"p1","labelref":"shortName"},{"part":"p2"}
        ]
    }]);
    let score = parse(&value);
    let display = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    let ink = texts(&display);
    for text in ["Cl.", "Fl.", "Vln."] {
        assert!(ink.contains(&text), "{text}: {ink:?}");
    }
    assert!(!ink.contains(&"Clarinet"));
}
