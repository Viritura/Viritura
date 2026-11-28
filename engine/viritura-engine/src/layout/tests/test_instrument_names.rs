use crate::layout::page::{
    initial_instrument_instruction, resolve_part_display_names_at,
    resolve_required_part_display_names,
};
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
            {"type":"staff","sources":[{"part":"p1"}],"labelRef":{"ref":"auto"}},
            {"type":"staff","sources":[{"part":"p2"}],"labelRef":{"ref":"auto"}}
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

fn part_header_document(authored: bool) -> Value {
    let mut value = document();
    change(&mut value, 1, json!({"transposition":interval(3,2)}));
    let mut second = value["parts"][0].clone();
    second["id"] = json!("p2");
    value["parts"][1] = second;
    value["layouts"][0]["content"] = json!([{
        "type":"staff","sources":[{"part":"p1"}],"labelRef":{"ref":"auto"}
    }]);
    value["scores"][0]["name"] = json!("Clarinet in B\u{266d} 1");
    if !authored {
        value["scores"][0].as_object_mut().unwrap().remove("pages");
    }
    value
}

#[test]
fn instrument_names_part_header_resolves_required_tunings_and_keeps_custom_titles() {
    use crate::layout::page::resolve_part_score_name;
    use crate::model::layout::PageSetupRole;

    let score = parse(&part_header_document(false));
    let resolve = |name: Option<&str>, parts: &[crate::model::Part], shown: &[usize], role| {
        let mut definition = score.scores[0].clone();
        definition.name = name.map(str::to_string);
        definition.page_setup_role = role;
        resolve_part_score_name(&definition, parts, shown)
    };
    for name in [
        None,
        Some("Clarinet"),
        Some("Clarinet 1"),
        Some("Clarinet in B\u{266d} 1"),
    ] {
        assert_eq!(
            resolve(name, &score.parts, &[0], None).as_deref(),
            Some("Clarinet in B\u{266d} 1\nClarinet in A 1"),
        );
    }
    assert_eq!(
        resolve(Some("Reeds player"), &score.parts, &[0], None).as_deref(),
        Some("Reeds player"),
    );
    assert_eq!(resolve(Some("Score"), &score.parts, &[0, 1], None), None);
    assert_eq!(resolve(Some("Score"), &score.parts, &[], None), None);
    assert_eq!(
        resolve(
            Some("Score"),
            &score.parts,
            &[0],
            Some(PageSetupRole::Score)
        ),
        None
    );
    assert_eq!(
        resolve(
            Some("Combined part"),
            &score.parts,
            &[0, 1],
            Some(PageSetupRole::Part)
        )
        .as_deref(),
        Some("Combined part")
    );
    let mut static_value = document();
    static_value["parts"][0]["name"] = json!("Clarinet 1");
    static_value["parts"][0]
        .as_object_mut()
        .unwrap()
        .remove("_x");
    let static_score = parse(&static_value);
    assert_eq!(
        resolve(Some("Clarinet 1"), &static_score.parts, &[0], None).as_deref(),
        Some("Clarinet in B\u{266d} 1"),
    );
}

#[test]
fn instrument_names_solo_part_uses_header_without_repeating_staff_labels() {
    for authored in [false, true] {
        let mut value = document();
        value["parts"].as_array_mut().unwrap().truncate(1);
        value["parts"][0]["staves"] = json!(2);
        value["layouts"][0]["content"] = json!([{
            "type":"group", "symbol":"brace", "label":"Clarinet",
            "content":[
                {"type":"staff","sources":[{"part":"p1","staff":1,"labelRef":{"ref":"auto"}}]},
                {"type":"staff","sources":[{"part":"p1","staff":2,"labelRef":{"ref":"auto"}}]}
            ]
        }]);
        value["scores"][0]["name"] = json!("Clarinet");
        value["scores"][0]["_x"] = json!({"viritura":{
            "pageSetupRole":"part",
            "instrumentNameDisplay":{"firstSystem":"hidden","subsequentSystems":"hidden"}
        }});
        if !authored {
            value["scores"][0].as_object_mut().unwrap().remove("pages");
        }
        let config = LayoutConfig {
            page_width: Some(800.0),
            ..LayoutConfig::default()
        };
        let display = layout_with_mnx_scores(&parse(&value), &config, 0);
        let labels: Vec<_> = texts(&display)
            .into_iter()
            .filter(|text| text.starts_with("Clarinet") || *text == "Cl.")
            .collect();
        assert_eq!(labels, ["Clarinet in B\u{266d}"], "authored={authored}");

        value["scores"][0]["_x"]["viritura"]["pageSetupRole"] = json!("score");
        let score_display = layout_with_mnx_scores(&parse(&value), &config, 0);
        assert!(
            !texts(&score_display)
                .iter()
                .any(|text| text.starts_with("Clarinet") || *text == "Cl."),
            "full-score roles must not gain a part header, authored={authored}"
        );
    }
}

#[test]
fn instrument_names_group_policy_uses_one_configured_name_per_system() {
    let mut value = document();
    value["parts"].as_array_mut().unwrap().truncate(1);
    value["parts"][0]["name"] = json!("Piano");
    value["parts"][0]["shortName"] = json!("Pno.");
    value["parts"][0]["staves"] = json!(2);
    value["parts"][0].as_object_mut().unwrap().remove("_x");
    value["parts"][0]
        .as_object_mut()
        .unwrap()
        .remove("transposition");
    value["layouts"][0]["content"] = json!([{
        "type":"group", "symbol":"brace", "label":"Keyboard",
        "content":[
            {"type":"staff","sources":[{"part":"p1","staff":1}],"labelRef":{"ref":"auto"}},
            {"type":"staff","sources":[{"part":"p1","staff":2}],"labelRef":{"ref":"auto"}}
        ]
    }]);
    value["scores"][0]["_x"] = json!({"viritura":{
        "pageSetupRole":"score",
        "instrumentNameDisplay":{"firstSystem":"full","subsequentSystems":"short"}
    }});
    let display = layout_with_mnx_scores(&parse(&value), &LayoutConfig::default(), 0);
    let labels: Vec<_> = texts(&display)
        .into_iter()
        .filter(|text| ["Piano", "Pno.", "Keyboard"].contains(text))
        .collect();
    assert_eq!(labels, ["Piano", "Pno."]);
}

#[test]
fn instrument_names_part_header_is_multiline_on_authored_inline_and_title_pages() {
    use crate::layout::page::part_score_name_height;
    use crate::layout::page_turn::TitlePagePolicy;

    for (authored, credits, cover) in [
        (true, false, false),
        (false, false, false),
        (false, true, false),
        (false, true, true),
    ] {
        let mut value = part_header_document(authored);
        if cover {
            value["global"]["measures"] = json!((0..24)
                .map(|index| {
                    if index == 0 {
                        value["global"]["measures"][0].clone()
                    } else {
                        json!({"id":format!("m{}", index + 1)})
                    }
                })
                .collect::<Vec<_>>());
            for part in value["parts"].as_array_mut().unwrap() {
                let measures = part["measures"].as_array_mut().unwrap();
                measures.resize(24, measures[3].clone());
            }
        }
        if credits {
            value["_x"] = json!({"viritura":{"metadata":{"title":"Custom work title"}}});
        }
        let score = parse(&value);
        let mut config = LayoutConfig {
            page_width: Some(1000.0),
            emit_layout_debug: true,
            ..LayoutConfig::default()
        };
        config.page_turns.enabled = cover;
        config.page_turns.title_page = if cover {
            TitlePagePolicy::Always
        } else {
            TitlePagePolicy::Never
        };
        let display = layout_with_mnx_scores(&score, &config, 0);
        let header: Vec<_> = display
            .commands
            .iter()
            .filter_map(|command| match command {
                RenderCommand::DrawText { x, y, text, .. }
                    if (*x - (config.page_margin_left + 0.6) * config.sp).abs() < 0.01 =>
                {
                    Some((*y, text.as_str()))
                }
                _ => None,
            })
            .collect();
        assert_eq!(
            header.len(),
            2,
            "authored={authored}, cover={cover}: {header:?}"
        );
        assert_eq!(header[0].1, "Clarinet in B\u{266d} 1");
        assert_eq!(header[1].1, "Clarinet in A 1");
        assert!(header[1].0 > header[0].0);
        assert!(header
            .iter()
            .all(|(y, text)| *y < config.page_height * config.sp && !text.contains('\n')));
        if credits {
            assert!(texts(&display).contains(&"Custom work title"));
        }
        let first_system = &display.layout_debug.as_ref().unwrap().systems[0];
        if cover {
            assert!(first_system.staff_top_y > config.page_height * config.sp);
        } else {
            let reserved =
                part_score_name_height(Some("Clarinet in B\u{266d} 1\nClarinet in A 1"), &config);
            assert!(first_system.staff_top_y >= config.page_margin_top * config.sp + reserved);
        }
    }
}

#[test]
fn instrument_names_piccolo_flute_part_header_omits_redundant_concert_tuning() {
    for (authored, explicit_zero, flute_first) in [
        (false, false, false),
        (true, false, false),
        (false, true, false),
        (false, false, true),
    ] {
        let mut value = document();
        let initial = if flute_first { "fl" } else { "picc" };
        value["parts"][0]["name"] = json!(if flute_first { "Flute" } else { "Piccolo" });
        value["parts"][0]["shortName"] = json!(if flute_first { "Fl." } else { "Picc." });
        value["parts"][0]["transposition"] = if flute_first {
            interval(0, 0)
        } else {
            interval(-12, -7)
        };
        value["parts"][0]["_x"]["viritura"] = json!({
            "initialInstrument":initial,
            "instruments":{
                "picc":{"instrumentId":"wind.flutes.flute.piccolo","name":"Piccolo",
                    "shortName":"Picc.","transposition":interval(-12,-7)},
                "fl":{"instrumentId":"wind.flutes.flute","name":"Flute","shortName":"Fl."}
            }
        });
        if explicit_zero {
            value["parts"][0]["_x"]["viritura"]["instruments"]["fl"]["transposition"] =
                interval(0, 0);
        }
        change(
            &mut value,
            1,
            json!({"instrument":if flute_first { "picc" } else { "fl" }}),
        );
        value["layouts"][0]["content"] = json!([{
            "type":"staff","sources":[{"part":"p1"}],"labelRef":{"ref":"auto"}
        }]);
        value["scores"][0]["name"] = value["parts"][0]["name"].clone();
        if !authored {
            value["scores"][0].as_object_mut().unwrap().remove("pages");
        }
        let score = parse(&value);
        let expected = if flute_first {
            ["Flute", "Piccolo"]
        } else {
            ["Piccolo", "Flute"]
        };
        assert_eq!(
            resolve_required_part_display_names(&score.parts)[0].display_name,
            expected.join("\n")
        );
        let config = LayoutConfig {
            page_width: Some(1000.0),
            ..LayoutConfig::default()
        };
        let display = layout_with_mnx_scores(&score, &config, 0);
        let header: Vec<_> = display
            .commands
            .iter()
            .filter_map(|command| match command {
                RenderCommand::DrawText { x, text, .. }
                    if (*x - (config.page_margin_left + 0.6) * config.sp).abs() < 0.01 =>
                {
                    Some(text.as_str())
                }
                _ => None,
            })
            .collect();
        assert_eq!(header, expected);
    }
}

#[test]
fn instrument_names_authored_concert_tuning_is_preserved() {
    let mut value = document();
    value["parts"][0]["_x"]["viritura"]["instruments"]["fl"]["name"] = json!("Flute in C");
    value["parts"][0]["_x"]["viritura"]["instruments"]["fl"]["shortName"] = json!("Fl. in C");
    change(&mut value, 1, json!({"instrument":"fl"}));
    let score = parse(&value);
    let names = resolve_part_display_names_at(&score.parts, 1);
    assert_eq!(names[0].display_name, "Flute in C");
    assert_eq!(names[0].display_short_name, "Fl. in C");
}

#[test]
fn instrument_names_custom_part_header_and_layout_label_are_preserved() {
    for authored in [false, true] {
        let mut value = part_header_document(authored);
        value["scores"][0]["name"] = json!("Reeds player");
        value["scores"][0]["_x"] = json!({"viritura":{"instrumentNameDisplay":{
            "firstSystem":"full","subsequentSystems":"full"
        }}});
        value["layouts"][0]["content"][0]
            .as_object_mut()
            .unwrap()
            .remove("labelRef");
        value["layouts"][0]["content"][0]["label"] = json!("Custom staff");
        let second_staff = value["layouts"][0]["content"][0].clone();
        value["layouts"][0]["content"]
            .as_array_mut()
            .unwrap()
            .push(second_staff);
        let config = LayoutConfig {
            page_width: Some(1000.0),
            ..LayoutConfig::default()
        };
        let display = layout_with_mnx_scores(&parse(&value), &config, 0);
        let ink = texts(&display);
        assert!(ink.contains(&"Reeds player"));
        assert!(ink.contains(&"Custom staff"));
        assert!(!ink.contains(&"Reeds player in B\u{266d}"));
    }
}

#[test]
fn instrument_names_staff_labels_use_first_bar_state_while_frontmatter_lists_all_states() {
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
    let required = resolve_required_part_display_names(&score.parts);
    assert_eq!(required[0].display_name, "Clarinet in B\u{266d}\nFlute");
    for (index, full, short) in [
        (0, "Clarinet in B\u{266d}", "Cl. in B\u{266d}"),
        (1, "Flute", "Fl."),
        (3, "Clarinet in B\u{266d}", "Cl. in B\u{266d}"),
    ] {
        let names = resolve_part_display_names_at(&score.parts, index);
        assert_eq!(names[0].display_name, full);
        assert_eq!(names[0].display_short_name, short);
    }
    let resolved = resolve_measures(&score, 0);
    let expressions = resolved[0].part.expressions.as_ref().unwrap();
    assert_eq!(expressions.len(), 1);
    assert_eq!(expressions[0].text.plain_text(), "Cl. in B\u{266d}");
    assert_eq!(expressions[0].position.fraction, (0, 1));
    let display = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    let ink = texts(&display);
    for text in ["Clarinet", "Cl.", "in B\u{266d}"] {
        assert!(ink.contains(&text), "{text}: {ink:?}");
    }
    assert!(!ink.contains(&"Flute"));
    assert!(!ink.contains(&"Fl."));
    assert!(!ink.contains(&"Horn"));
    for display in [
        layout_score(&score, 0, &LayoutConfig::default()),
        crate::layout::full_score::layout_full_score(&score, &LayoutConfig::default()),
    ] {
        assert!(texts(&display).contains(&"Cl. in B\u{266d}"));
    }
}

#[test]
fn instrument_names_render_only_system_start_state_on_authored_pages_and_auto_breaks() {
    for authored in [true, false] {
        for policy in ["full", "short"] {
            let mut value = document();
            change(
                &mut value,
                1,
                json!({"instrument":"fl","instruction":{"hidden":true}}),
            );
            change(
                &mut value,
                3,
                json!({"transposition":interval(7,4),"instruction":{"hidden":true}}),
            );
            value["scores"][0]["_x"] = json!({"viritura":{
                "instrumentNameDisplay":{"firstSystem":policy,"subsequentSystems":policy},
                "layoutBreaks":[{"measure":"m3","kind":"system"}]
            }});
            if authored {
                value["scores"][0]["pages"] = json!([
                    {"systems":[{"measure":"m1"}]},
                    {"systems":[{"measure":"m3"}]}
                ]);
            } else {
                value["scores"][0].as_object_mut().unwrap().remove("pages");
            }
            let display = layout_with_mnx_scores(
                &parse(&value),
                &LayoutConfig {
                    page_width: Some(800.0),
                    ..LayoutConfig::default()
                },
                0,
            );
            let ink = texts(&display);
            let (clarinet, flute) = if policy == "full" {
                ("Clarinet", "Flute")
            } else {
                ("Cl.", "Fl.")
            };
            assert_eq!(
                ink.iter().filter(|text| **text == clarinet).count(),
                1,
                "{ink:?}"
            );
            assert_eq!(
                ink.iter().filter(|text| **text == flute).count(),
                1,
                "{ink:?}"
            );
            assert!(!ink.contains(&"in C"), "{ink:?}");
            assert!(
                !ink.contains(&"in F"),
                "mid-system change must not change staff label: {ink:?}"
            );
            assert!(!ink.iter().any(|text| text.contains('\n')), "{ink:?}");
        }
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
        Some("Cl. in B\u{266d}".into())
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
        "Flute"
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
    for (name, initial, changes, expected, initial_short) in [
        (
            "Horn",
            interval(2, 1),
            vec![interval(14, 8), interval(2, 1)],
            "Horn in B\u{266d} alto\nHorn in B\u{266d} basso",
            "Hn. in B\u{266d} alto",
        ),
        (
            "Clarinet",
            interval(-3, -2),
            vec![interval(9, 5), interval(-3, -2)],
            "Clarinet in E\u{266d} piccolo\nClarinet in E\u{266d} alto",
            "Cl. in E\u{266d} piccolo",
        ),
        (
            "Flute",
            interval(0, 0),
            vec![interval(-12, -7), interval(0, 0)],
            "Flute in C (sounds C4 for written C4)\nFlute in C (sounds C5 for written C4)",
            "Fl. in C (sounds C4 for written C4)",
        ),
    ] {
        let mut value = document();
        value["parts"][0].as_object_mut().unwrap().remove("_x");
        value["parts"][0]
            .as_object_mut()
            .unwrap()
            .remove("shortName");
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
            resolve_required_part_display_names(&score.parts)[0].display_name,
            expected
        );
        assert_eq!(
            initial_instrument_instruction(&score.parts[0]).as_deref(),
            Some(initial_short)
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
        assert!(ink.contains(&if policy == "full" { "Flute" } else { "Fl." }));
        assert!(ink.contains(&"Cl. in B\u{266d}"));
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
fn instrument_names_number_plain_and_doubling_catalog_instruments_together() {
    let mut value = document();
    change(&mut value, 1, json!({"instrument":"fl"}));
    let mut plain = value["parts"][0].clone();
    plain["id"] = json!("p2");
    plain["_x"] = json!({"viritura":{"instrumentId":"wind.reed.clarinet"}});
    plain["measures"][1].as_object_mut().unwrap().remove("_x");
    value["parts"][1] = plain;
    let score = parse(&value);
    let names = resolve_part_display_names_at(&score.parts, 0);
    assert_eq!(names[0].number, Some(1));
    assert_eq!(names[1].number, Some(2));
    let names = resolve_part_display_names_at(&score.parts, 1);
    assert_eq!(names[0].number, None);
    assert_eq!(names[1].number, None);
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
    let names = resolve_part_display_names_at(&score.parts, 1);
    assert_eq!(names[0].display_name, "Flute 1");
    assert_eq!(names[0].display_short_name, "Fl. 1");
    assert_eq!(names[1].display_short_name, "Fl. 2");
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
    let names = resolve_required_part_display_names(&score.parts);
    assert_eq!(
        names[0].display_name,
        "Horn in B\u{266d} alto\nHorn in B\u{266d} basso"
    );
    assert_eq!(
        names[0].display_short_name,
        "Hn. in B\u{266d} alto\nHn. in B\u{266d} basso"
    );
    assert_eq!(
        resolve_part_display_names_at(&score.parts, 1)[0].display_short_name,
        "Hn. in B\u{266d} basso"
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
            {"part":"p1","labelRef":{"ref":"shortName"}},
            {"part":"p2","labelRef":{"ref":"shortName"}}
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
