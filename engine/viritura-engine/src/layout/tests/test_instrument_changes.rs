use crate::layout::measure::layout_measure;
use crate::layout::resolve::{resolve_measures, resolve_measures_for_staff};
use crate::layout::{layout_score, layout_with_mnx_scores, LayoutConfig};
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::{smufl::smufl, DisplayList, RenderCommand};
use serde_json::{json, Value};

fn interval(half_steps: i32, staff_distance: i32) -> Value {
    json!({"interval": {"halfSteps": half_steps, "staffDistance": staff_distance}})
}

fn document() -> Value {
    let measure = json!({"sequences":[{"content":[
        {"duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":4}}]}
    ]}]});
    json!({
        "mnx":{"version":1},
        "global":{"measures":[
            {"id":"m1","time":{"count":4,"unit":4},"key":{"fifths":0}},
            {"id":"m2"}, {"id":"m3"}, {"id":"m4"}
        ]},
        "parts":[{
            "id":"p1","name":"Clarinet","shortName":"Cl.",
            "transposition":interval(2,1),
            "_x":{"viritura":{
                "initialInstrument":"clarinet",
                "instruments":{
                    "clarinet":{"instrumentId":"wind.reed.clarinet","name":"Clarinet","shortName":"Cl.","transposition":interval(2,1)},
                    "flute":{"instrumentId":"wind.flutes.flute","name":"Flute","shortName":"Fl."},
                    "horn":{"instrumentId":"brass.french-horn","name":"Horn","shortName":"Hn.","transposition":interval(7,4)}
                }
            }},
            "measures":[measure.clone(),measure.clone(),measure.clone(),measure]
        }],
        "layouts":[{"id":"score","content":[{"type":"staff","sources":[{"part":"p1"}],"labelref":"name"}]}],
        "scores":[{"name":"Written score","layout":"score","useWritten":true,"pages":[]}]
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

fn glyph_count(display: &DisplayList, glyph: u32) -> usize {
    display
        .commands
        .iter()
        .filter(|command| {
            matches!(command,
        RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == glyph)
        })
        .count()
}

#[test]
fn instrument_changes_resolve_defaults_overrides_and_sounding_invariance() {
    let mut value = document();
    value["parts"][0]["measures"][1]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"instrument":"flute"}]}});
    value["parts"][0]["measures"][2]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"transposition":interval(7,4)}]}});
    let score = parse(&value);
    let before = serde_json::to_value(&score.parts[0]).unwrap();
    let resolved = resolve_measures(&score, 0);
    assert_eq!(
        resolved.iter().map(|m| m.transposition).collect::<Vec<_>>(),
        vec![Some((1, 2)), None, Some((4, 7)), Some((4, 7))]
    );
    assert_eq!(
        resolved
            .iter()
            .map(|m| m.active_key.fifths)
            .collect::<Vec<_>>(),
        vec![2, 0, 1, 1]
    );
    assert_eq!(resolved[1].prev_key.fifths, 2);
    let display = layout_score(&score, 0, &LayoutConfig::default());
    assert!(texts(&display).contains(&"To Flute"));
    assert!(texts(&display).contains(&"in F"));
    assert_eq!(glyph_count(&display, smufl::ACCIDENTAL_NATURAL), 2);
    assert_eq!(serde_json::to_value(&score.parts[0]).unwrap(), before);
    assert_eq!(
        resolved[2].part.sequences[0].content[0]
            .as_event()
            .unwrap()
            .notes()[0]
            .pitch
            .step,
        "C"
    );
}

#[test]
fn instrument_changes_concert_mode_and_written_preference_are_dynamic() {
    let mut value = document();
    value["scores"][0]["useWritten"] = json!(false);
    let mut octave = interval(-12, -7);
    octave["prefersWrittenPitches"] = json!(true);
    value["parts"][0]["measures"][1]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"transposition":octave}]}});
    value["parts"][0]["measures"][2]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"instrument":"flute"}]}});
    let resolved = resolve_measures(&parse(&value), 0);
    assert_eq!(
        resolved.iter().map(|m| m.transposition).collect::<Vec<_>>(),
        vec![None, Some((-7, -12)), None, None]
    );
    assert!(resolved.iter().all(|m| m.active_key.fifths == 0));
}

#[test]
fn instrument_changes_initial_definition_fallback_and_native_precedence() {
    let mut value = document();
    value["parts"][0]
        .as_object_mut()
        .unwrap()
        .remove("transposition");
    assert_eq!(
        resolve_measures(&parse(&value), 0)[0].transposition,
        Some((1, 2))
    );
    value["parts"][0]["transposition"] = interval(7, 4);
    assert_eq!(
        resolve_measures(&parse(&value), 0)[0].transposition,
        Some((4, 7))
    );
}

#[test]
fn instrument_changes_authored_hidden_and_zero_reset_survive_mnx_layout() {
    let mut value = document();
    value["parts"][0]["measures"][1]["_x"] = json!({"viritura":{"instrumentChanges":[{
        "instrument":"horn","transposition":interval(2,1),"instruction":{"text":"Take the other horn"}
    }]}});
    value["parts"][0]["measures"][2]["_x"] = json!({"viritura":{"instrumentChanges":[{
        "transposition":interval(0,0),"instruction":{"hidden":true}
    }]}});
    let score = parse(&value);
    let resolved = resolve_measures(&score, 0);
    assert_eq!(resolved[1].transposition, Some((1, 2)));
    assert_eq!(resolved[2].transposition, Some((0, 0)));
    assert_eq!(resolved[3].active_key.fifths, 0);
    let display = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    let text = texts(&display);
    assert!(text.contains(&"Take the other horn"));
    assert!(!text.contains(&"To Horn"));
    assert!(!text.contains(&"in C"));
    assert_eq!(glyph_count(&display, smufl::ACCIDENTAL_NATURAL), 2);
}

#[test]
fn instrument_changes_multistaff_state_shared_instruction_once() {
    let mut value = document();
    value["parts"][0]["staves"] = json!(2);
    value["parts"][0]["measures"][1]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"instrument":"flute"}]}});
    let score = parse(&value);
    let upper = resolve_measures_for_staff(&score, 0, 1);
    let lower = resolve_measures_for_staff(&score, 0, 2);
    assert_eq!(upper[2].transposition, lower[2].transposition);
    assert!(upper[1]
        .part
        .expressions
        .as_ref()
        .is_some_and(|e| !e.is_empty()));
    assert!(lower[1].part.expressions.is_none());
}

#[test]
fn instrument_changes_fractional_positions_fail_full_parse_and_patch_promotion() {
    let mut value = document();
    for fraction in [[1, 4], [2, 4], [1, 1], [0, 0]] {
        value["parts"][0]["measures"][1]["_x"] = json!({"viritura":{"instrumentChanges":[{
            "position":{"fraction":fraction},"instrument":"flute","instruction":{"hidden":true}
        }]}});
        let error = parse_mnx(&value.to_string()).unwrap_err().to_string();
        assert!(error.contains("bar-start changes only"), "{error}");
        let patch_error =
            crate::promote::promote_part_measure_json(&value["parts"][0]["measures"][1])
                .unwrap_err();
        assert!(matches!(
            patch_error,
            crate::promote::PromoteError::UnsupportedInstrumentChange(_)
        ));
    }
    value["parts"][0]["measures"][1]["_x"] = json!({"viritura":{"instrumentChanges":[{
        "position":{"fraction":[0,8]},"instrument":"flute"
    }]}});
    assert!(resolve_measures(&parse(&value), 0)[1]
        .transposition
        .is_none());
}

#[test]
fn instrument_changes_incompatible_sources_get_independent_written_staves() {
    let mut value = document();
    let mut second = value["parts"][0].clone();
    second["id"] = json!("p2");
    value["parts"].as_array_mut().unwrap().push(second);
    value["layouts"][0]["content"][0]["sources"] = json!([{"part":"p1"},{"part":"p2"}]);
    value["parts"][1]["measures"][1]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"instrument":"flute"}]}});
    let score = parse(&value);
    let display = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);
    // Both C4 voices must remain: source 1 displays D4; source 2 displays C4.
    assert_eq!(glyph_count(&display, smufl::NOTEHEAD_WHOLE), 8);
    assert!(texts(&display).contains(&"To Flute"));
}

#[test]
fn instrument_changes_separation_preserves_legacy_static_source_layout() {
    let mut value = document();
    value["parts"][0].as_object_mut().unwrap().remove("_x");
    let mut second = value["parts"][0].clone();
    second["id"] = json!("p2");
    second.as_object_mut().unwrap().remove("transposition");
    value["parts"].as_array_mut().unwrap().push(second);
    value["layouts"][0]["content"][0]["sources"] = json!([{"part":"p1"},{"part":"p2"}]);
    let staff_count = |value: &Value| {
        let score = parse(value);
        layout_with_mnx_scores(&score, &LayoutConfig::default(), 0)
            .measure_bounds
            .iter()
            .map(|bound| bound.staff_index)
            .collect::<std::collections::HashSet<_>>()
            .len()
    };
    assert_eq!(
        staff_count(&value),
        1,
        "static native intervals must preserve authored staff"
    );
    // A timeline declaration requires independent source engraving even when
    // it is not on the first source and its printed instruction is hidden.
    value["parts"][1]["measures"][1]["_x"] = json!({"viritura":{"instrumentChanges":[{
        "transposition":interval(7,4),"instruction":{"hidden":true}
    }]}});
    assert_eq!(staff_count(&value), 2);
}

#[test]
fn instrument_changes_written_pitches_and_accidentals_follow_active_key() {
    let mut value = document();
    value["parts"][0]["measures"][1]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"transposition":interval(7,4)}]}});
    for index in 0..4 {
        value["parts"][0]["measures"][index]["sequences"] = json!([{"content":[
            {"duration":{"base":"half"},"notes":[{"pitch":{"step":"C","octave":4,"alter":1}}]},
            {"duration":{"base":"half"},"notes":[{"pitch":{"step":"C","octave":4}}]}
        ]}]);
    }
    let score = parse(&value);
    let resolved = resolve_measures(&score, 0);
    let config = LayoutConfig::default();
    for (index, step) in [(0, "D"), (1, "G"), (2, "G"), (3, "G")] {
        let layout = layout_measure(&resolved[index], config.sp, 0.0, &config, None, &[], 1.0);
        let events = &layout.voice_layouts[0].events;
        assert_eq!(events.display_pitches(0)[0].step, step);
        assert_eq!(events.display_pitches(0)[0].alter, Some(1));
        assert_eq!(events.display_pitches(1)[0].alter.unwrap_or(0), 0);
    }
    let display = layout_score(&score, 0, &config);
    // Every bar explicitly sharpens and then restores its D/G.
    assert_eq!(glyph_count(&display, smufl::ACCIDENTAL_NATURAL), 4);
}

fn add_other_staff(value: &mut Value) {
    let mut other = value["parts"][0].clone();
    other["id"] = json!("p2");
    other["name"] = json!("Violin");
    other["shortName"] = json!("Vln.");
    other.as_object_mut().unwrap().remove("_x");
    other.as_object_mut().unwrap().remove("transposition");
    value["parts"].as_array_mut().unwrap().push(other);
    value["layouts"][0]["content"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"staff","sources":[{"part":"p2"}],"labelref":"name"}));
    value["scores"][0]["_x"] = json!({"viritura":{"instrumentNameDisplay":{
        "firstSystem":"full","subsequentSystems":"full"
    }}});
}

#[test]
fn instrument_changes_system_labels_and_explicit_subset_keep_active_identity() {
    let mut value = document();
    add_other_staff(&mut value);
    value["parts"][0]["measures"][1]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"instrument":"horn"}]}});
    value["scores"][0]["pages"] = json!([{"systems":[{"measure":"m1"},{"measure":"m3"}]}]);
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let display = layout_with_mnx_scores(&parse(&value), &config, 0);
    assert!(texts(&display).contains(&"Horn"), "{:?}", texts(&display));
    assert!(texts(&display).contains(&"in F"));
    // An authored excerpt starts after the change and the original key/time.
    value["scores"][0]["pages"] = json!([{"systems":[{"measure":"m3"}]}]);
    let excerpt = layout_with_mnx_scores(&parse(&value), &config, 0);
    assert!(texts(&excerpt).contains(&"Horn"), "{:?}", texts(&excerpt));
    assert!(texts(&excerpt).contains(&"in F"));
    assert!(glyph_count(&excerpt, smufl::ACCIDENTAL_SHARP) >= 1);
}

#[test]
fn instrument_changes_auto_flow_labels_and_cached_edits_match_fresh_layout() {
    let mut value = document();
    add_other_staff(&mut value);
    value["scores"][0]["_x"]["viritura"]["layoutBreaks"] =
        json!([{"measure":"m3","kind":"system"}]);
    value["parts"][0]["measures"][1]["_x"] = json!({"viritura":{"instrumentChanges":[{"instrument":"horn","instruction":{"hidden":true}}]}});
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let mut score = parse(&value);
    let mut cache = crate::layout::cache::LayoutCache::new();
    cache.set_range_scope(crate::layout::cache::RangeScope {
        scoped_resolve: true,
        ..Default::default()
    });
    let display =
        crate::layout::layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    assert!(texts(&display).contains(&"Horn"), "{:?}", texts(&display));
    assert!(texts(&display).contains(&"in F"));
    // Change identity but keep the same interval and hidden instruction: only
    // downstream labels, not notes or signatures, need different retained ink.
    score.parts[0]
        .instrument_extensions
        .instruments
        .get_mut("horn")
        .unwrap()
        .name = Some("Wagner tuba".into());
    cache.set_pending_dirty_region(Some(
        crate::layout::cache::DirtyRegion::local_part_measures(1, 1, vec![true, false]),
    ));
    let cached = crate::layout::layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let fresh = layout_with_mnx_scores(&score, &config, 0);
    assert!(
        texts(&cached).contains(&"Wagner tuba"),
        "{:?}",
        texts(&cached)
    );
    assert!(texts(&cached).contains(&"in F"));
    assert_eq!(
        serde_json::to_value(&cached).unwrap(),
        serde_json::to_value(&fresh).unwrap()
    );
}

#[test]
fn instrument_changes_transposition_label_replaces_old_authored_suffix() {
    let mut value = document();
    value["parts"][0]["_x"]["viritura"]["instruments"]["clarinet"]["name"] =
        json!("Clarinet in B♭");
    value["parts"][0]["measures"][1]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"transposition":interval(7,4)}]}});
    let score = parse(&value);
    let names = crate::layout::page::resolve_part_display_names_at(&score.parts, 1);
    assert_eq!(names[0].display_name, "Clarinet in F");
}

#[test]
fn instrument_changes_hidden_changes_interrupt_multimeasure_rests() {
    let mut value = document();
    for index in 0..4 {
        value["parts"][0]["measures"][index]["sequences"] =
            json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    }
    value["parts"][0]["measures"][2]["_x"] = json!({"viritura":{"instrumentChanges":[{
        "transposition":interval(14,8),"instruction":{"hidden":true}
    }]}});
    let score = parse(&value);
    let resolved = resolve_measures(&score, 0);
    assert_eq!(
        crate::layout::resolve::detect_multimeasure_rest_groups(&resolved),
        vec![(0, 2), (2, 2)]
    );
}
