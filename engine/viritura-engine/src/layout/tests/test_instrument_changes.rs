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

fn set_reminder(value: &mut Value, measure: usize, reminder: Value, instruction: Value) {
    value["parts"][0]["measures"][measure]["_x"] = json!({"viritura":{"instrumentChanges":[{
        "instrument":"flute", "instruction":instruction, "reminder":reminder
    }]}});
}

fn sounding_then_rest(value: &mut Value, measure: usize) {
    value["parts"][0]["measures"][measure]["sequences"] = json!([{"content":[
        {"duration":{"base":"quarter","dots":1},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"half"},"rest":{}},
        {"duration":{"base":"eighth"},"rest":{}}
    ]}]);
}

fn has_reminder(measure: &PartMeasure) -> bool {
    reminder_expression(measure).is_some()
}

fn reminder_expression(measure: &PartMeasure) -> Option<&TextExpression> {
    measure
        .expressions
        .iter()
        .flatten()
        .find(|expression| expression.instrument_reminder)
}

#[test]
fn instrument_changes_reminders_anchor_sounding_note_and_are_independent() {
    let mut value = document();
    sounding_then_rest(&mut value, 0);
    set_reminder(
        &mut value,
        1,
        json!({}),
        json!({"hidden":true,"text":"Do not print"}),
    );
    let score = parse(&value);
    let resolved = resolve_measures(&score, 0);
    let expression = reminder_expression(&resolved[0].part).unwrap();
    assert_eq!(expression.position.fraction, (0, 1));
    assert_eq!(expression.text.plain_text(), "To Flute");
    assert!(resolved[1].part.expressions.is_none());
    for display in [
        layout_score(&score, 0, &LayoutConfig::default()),
        layout_with_mnx_scores(&score, &LayoutConfig::default(), 0),
    ] {
        assert_eq!(
            texts(&display)
                .iter()
                .filter(|text| **text == "To Flute")
                .count(),
            1
        );
        assert!(!texts(&display).contains(&"Do not print"));
    }
    set_reminder(
        &mut value,
        1,
        json!({"hidden":true}),
        json!({"text":"Change now"}),
    );
    let resolved = resolve_measures(&parse(&value), 0);
    assert!(!has_reminder(&resolved[0].part));
    assert_eq!(
        resolved[1].part.expressions.as_ref().unwrap()[0]
            .text
            .plain_text(),
        "Change now"
    );
}

#[test]
fn instrument_changes_reminder_ink_follows_last_note_not_surrounding_rests() {
    let mut value = document();
    value["parts"][0]["measures"][0]["sequences"] = json!([
        {"voice":"1","content":[
            {"duration":{"base":"quarter"},"rest":{}},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":4}}]},
            {"duration":{"base":"half"},"rest":{}}
        ]},
        {"voice":"2","content":[{"duration":{"base":"whole"},"rest":{}}]}
    ]);
    set_reminder(
        &mut value,
        1,
        json!({"text":"To clarinet in A"}),
        json!({"hidden":true}),
    );
    let score = parse(&value);
    let resolved = resolve_measures(&score, 0);
    let expression = resolved[0]
        .part
        .expressions
        .as_ref()
        .unwrap()
        .iter()
        .find(|expression| expression.instrument_reminder)
        .unwrap();
    assert_eq!(expression.position.fraction, (1, 4));
    let config = LayoutConfig::default();
    let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);
    let events = &ml.voice_layouts[0].events;
    let note_x = events.x(1);
    let rest_x = events.x(2);
    let mut dl = DisplayList::new(800.0, 200.0);
    crate::layout::render_annotations::render_text_expressions(
        &mut dl,
        &ml,
        100.0,
        config.sp,
        &config,
        &[],
        &[],
        None,
    );
    let text_x = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawText { text, x, .. } if text == "To clarinet in A" => Some(*x),
            _ => None,
        })
        .unwrap();
    assert!((text_x - note_x - 1.68 * config.sp).abs() < 1e-6);
    assert!(text_x > note_x && text_x < rest_x);
}

#[test]
fn instrument_changes_default_reminder_precedes_long_rest_passage_unless_hidden() {
    let mut value = document();
    sounding_then_rest(&mut value, 0);
    for index in 1..3 {
        value["parts"][0]["measures"][index]["sequences"] =
            json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    }
    value["parts"][0]["measures"][3]["_x"] = json!({"viritura":{"instrumentChanges":[{
        "transposition":interval(3,2)
    }]}});
    let score = parse(&value);
    let resolved = resolve_measures(&score, 0);
    let reminder = resolved[0]
        .part
        .expressions
        .as_ref()
        .unwrap()
        .iter()
        .find(|expression| expression.instrument_reminder)
        .unwrap();
    assert_eq!(reminder.position.fraction, (0, 1));
    assert_eq!(reminder.text.plain_text(), "in A");
    assert!(resolved[3]
        .part
        .expressions
        .as_ref()
        .unwrap()
        .iter()
        .any(
            |expression| !expression.instrument_reminder && expression.text.plain_text() == "in A"
        ));
    value["parts"][0]["measures"][3]["_x"]["viritura"]["instrumentChanges"][0]["reminder"] =
        json!({"hidden":true});
    let resolved = resolve_measures(&parse(&value), 0);
    assert!(!has_reminder(&resolved[0].part));
}

#[test]
fn instrument_changes_initial_label_clears_stems_after_opening_rest() {
    let mut value = document();
    value["parts"][0]["measures"][0]["sequences"] = json!([{"content":[
        {"duration":{"base":"eighth"},"rest":{}},
        {"duration":{"base":"eighth"},"stemDirection":"up","notes":[{"pitch":{"step":"D","octave":5}}]},
        {"duration":{"base":"half","dots":1},"rest":{}}
    ]}]);
    value["parts"][0]["measures"][3]["_x"] =
        json!({"viritura":{"instrumentChanges":[{"transposition":interval(3,2)}]}});
    let score = parse(&value);
    let mut resolved = resolve_measures(&score, 0);
    resolved[0]
        .part
        .expressions
        .as_mut()
        .unwrap()
        .retain(|expression| !expression.instrument_reminder);
    let config = LayoutConfig::default();
    let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 1.0);
    let events = &ml.voice_layouts[0].events;
    assert!(events.stem_up(1));
    let top_position = events
        .note_positions(1)
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let stem_tip = 100.0 + top_position * config.sp * 0.5 - config.stem_length * config.sp;
    let mut dl = DisplayList::new(800.0, 200.0);
    crate::layout::render_annotations::render_text_expressions(
        &mut dl,
        &ml,
        100.0,
        config.sp,
        &config,
        &[],
        &[],
        None,
    );
    let baseline = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawText { text, y, .. } if text == "Clarinet in B♭" => Some(*y),
            _ => None,
        })
        .unwrap();
    assert!(
        baseline < stem_tip - 0.1 * config.sp,
        "initial text must clear following stem: {baseline} versus {stem_tip}"
    );
}

#[test]
fn instrument_changes_reminders_require_a_sounding_anchor_and_a_gap() {
    let mut value = document();
    set_reminder(&mut value, 1, json!({}), json!({"hidden":true}));
    assert!(resolve_measures(&parse(&value), 0)
        .iter()
        .all(|m| !has_reminder(&m.part)));
    value["parts"][0]["measures"][0]["sequences"] =
        json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    assert!(resolve_measures(&parse(&value), 0)
        .iter()
        .all(|m| !has_reminder(&m.part)));
    set_reminder(&mut value, 0, json!({}), json!({"hidden":true}));
    assert!(!has_reminder(&resolve_measures(&parse(&value), 0)[0].part));
}

#[test]
fn instrument_changes_reminders_use_latest_polyphonic_release_and_tie_continuations() {
    let mut value = document();
    value["parts"][0]["measures"][0]["sequences"] = json!([
        {"voice":"1","content":[
            {"duration":{"base":"quarter"},"notes":[{"id":"a","pitch":{"step":"C","octave":4},"ties":[{"target":"b"}]}]},
            {"duration":{"base":"half","dots":1},"rest":{}}
        ]},
        {"voice":"2","content":[
            {"duration":{"base":"half","dots":1},"notes":[{"pitch":{"step":"E","octave":4}}]},
            {"duration":{"base":"quarter"},"rest":{}}
        ]}
    ]);
    value["parts"][0]["measures"][1]["sequences"] = json!([{"content":[
        {"duration":{"base":"half"},"notes":[{"id":"b","pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"half"},"rest":{}}
    ]}]);
    set_reminder(
        &mut value,
        2,
        json!({"text":"Ready"}),
        json!({"hidden":true}),
    );
    let resolved = resolve_measures(&parse(&value), 0);
    assert!(!has_reminder(&resolved[0].part));
    let expression = reminder_expression(&resolved[1].part).unwrap();
    assert_eq!(expression.position.fraction, (0, 1));
    assert_eq!(expression.text.plain_text(), "Ready");
    // A tie extending beyond the declaration leaves no safe advance gap.
    value["parts"][0]["measures"][1]["sequences"][0]["content"][0]["notes"][0]["ties"] =
        json!([{"target":"c"}]);
    value["parts"][0]["measures"][2]["sequences"][0]["content"][0]["notes"][0]["id"] = json!("c");
    assert!(!has_reminder(&resolve_measures(&parse(&value), 0)[1].part));
}

#[test]
fn instrument_changes_reminders_resolve_tuplets_and_boundary_releases() {
    let mut value = document();
    value["parts"][0]["measures"][0]["sequences"] = json!([{"content":[
        {"type":"tuplet","inner":{"duration":{"base":"eighth"},"multiple":3},
         "outer":{"duration":{"base":"eighth"},"multiple":2},"content":[
            {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":4}}]},
            {"duration":{"base":"quarter"},"rest":{}}
         ]},
        {"duration":{"base":"half","dots":1},"rest":{}}
    ]}]);
    set_reminder(&mut value, 1, json!({}), json!({"hidden":true}));
    assert_eq!(
        reminder_expression(&resolve_measures(&parse(&value), 0)[0].part)
            .unwrap()
            .position
            .fraction,
        (0, 1)
    );
    value["parts"][0]["measures"][0]["sequences"] =
        document()["parts"][0]["measures"][0]["sequences"].clone();
    value["parts"][0]["measures"][1]["sequences"] =
        json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    value["parts"][0]["measures"][1]
        .as_object_mut()
        .unwrap()
        .remove("_x");
    set_reminder(&mut value, 3, json!({}), json!({"hidden":true}));
    value["parts"][0]["measures"][2]["sequences"] =
        json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    assert_eq!(
        reminder_expression(&resolve_measures(&parse(&value), 0)[0].part)
            .unwrap()
            .position
            .fraction,
        (0, 1)
    );
}

#[test]
fn instrument_changes_pitch_based_transposition_defaults_preserve_spelling_and_octaves() {
    let mut value = document();
    for (half_steps, staff_distance, expected) in [
        (9, 5, "in E♭"),
        (1, 1, "in B"),
        (-1, 0, "in C♯"),
        (-12, -7, "sounds C5 for written C4"),
        (12, 7, "sounds C3 for written C4"),
    ] {
        value["parts"][0]["measures"][1]["_x"] = json!({"viritura":{"instrumentChanges":[{
            "transposition":interval(half_steps,staff_distance)
        }]}});
        assert_eq!(
            resolve_measures(&parse(&value), 0)[1]
                .part
                .expressions
                .as_ref()
                .unwrap()[0]
                .text
                .plain_text(),
            expected
        );
    }
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
    assert_eq!(names[0].display_name, "Clarinet in B♭\nClarinet in F");
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

#[test]
fn instrument_changes_reminder_anchor_interrupts_multimeasure_rests() {
    let mut value = document();
    for index in 1..4 {
        value["parts"][0]["measures"][index]["sequences"] =
            json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    }
    set_reminder(&mut value, 3, json!({}), json!({"hidden":true}));
    let resolved = resolve_measures(&parse(&value), 0);
    assert!(resolved[0].part.expressions.is_some());
    assert!(!crate::layout::resolve::starts_new_mmr_group(&resolved, 2));
    let config = LayoutConfig {
        multimeasure_rests: true,
        ..LayoutConfig::default()
    };
    assert!(texts(&layout_with_mnx_scores(&parse(&value), &config, 0)).contains(&"To Flute"));
}

#[test]
fn instrument_changes_reminders_render_once_on_grand_staff_and_explicit_excerpts() {
    let mut value = document();
    sounding_then_rest(&mut value, 0);
    value["parts"][0]["staves"] = json!(2);
    value["parts"][0]["measures"][0]["sequences"]
        .as_array_mut()
        .unwrap()
        .push(json!({"staff":2,"content":[
            {"duration":{"base":"half","dots":1},"notes":[{"pitch":{"step":"C","octave":3}}]},
            {"duration":{"base":"quarter"},"rest":{}}
        ]}));
    set_reminder(
        &mut value,
        1,
        json!({"text":"Get flute"}),
        json!({"hidden":true}),
    );
    let score = parse(&value);
    let upper = resolve_measures_for_staff(&score, 0, 1);
    let lower = resolve_measures_for_staff(&score, 0, 2);
    assert_eq!(
        lower[0]
            .part
            .expressions
            .as_ref()
            .unwrap()
            .iter()
            .find(|expression| expression.instrument_reminder)
            .unwrap()
            .position
            .fraction,
        (0, 1)
    );
    assert!(!upper[0]
        .part
        .expressions
        .as_ref()
        .is_some_and(|expressions| expressions
            .iter()
            .any(|expression| expression.instrument_reminder)));
    assert_eq!(
        texts(&layout_score(&score, 0, &LayoutConfig::default()))
            .iter()
            .filter(|text| **text == "Get flute")
            .count(),
        1
    );
    value["layouts"][0]["content"] = json!([{"type":"group","symbol":"brace","content":[
        {"type":"staff","sources":[{"part":"p1","staff":1}]},
        {"type":"staff","sources":[{"part":"p1","staff":2}]}
    ]}]);
    value["scores"][0]["pages"] = json!([{"systems":[{"measure":"m1"}]}]);
    assert_eq!(
        texts(&layout_with_mnx_scores(
            &parse(&value),
            &LayoutConfig::default(),
            0
        ))
        .iter()
        .filter(|text| **text == "Get flute")
        .count(),
        1
    );
    value["scores"][0]["pages"] = json!([{"systems":[{"measure":"m2"}]}]);
    assert!(!texts(&layout_with_mnx_scores(
        &parse(&value),
        &LayoutConfig::default(),
        0
    ))
    .contains(&"Get flute"));
}

#[test]
fn instrument_changes_reminders_do_not_change_authored_expression_rest_boundaries() {
    let mut value = document();
    for index in 0..4 {
        value["parts"][0]["measures"][index]["sequences"] =
            json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    }
    value["parts"][0]["measures"][1]["_x"] = json!({"viritura":{"expressions":[{
        "text":[{"text":"dolce"}], "position":{"fraction":[0,1]}
    }]}});
    let resolved = resolve_measures(&parse(&value), 0);
    assert!(!resolved[1].part.expressions.as_ref().unwrap()[0].instrument_reminder);
    assert_eq!(
        crate::layout::resolve::detect_multimeasure_rest_groups(&resolved),
        vec![(0, 4)]
    );
    assert!(!crate::layout::resolve::starts_new_mmr_group(&resolved, 1));
    assert!(!crate::layout::resolve::starts_new_mmr_group(&resolved, 2));
}

#[test]
fn instrument_changes_cached_reminder_edits_and_release_moves_match_fresh_layout() {
    let mut value = document();
    add_other_staff(&mut value);
    sounding_then_rest(&mut value, 0);
    set_reminder(
        &mut value,
        2,
        json!({"text":"Prepare"}),
        json!({"hidden":true}),
    );
    // Rest until the declaration, so an earlier measure supplies the anchor.
    value["parts"][0]["measures"][1]["sequences"] =
        json!([{"content":[{"duration":{"base":"whole"},"rest":{}}]}]);
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let mut cache = crate::layout::cache::LayoutCache::new();
    cache.set_range_scope(crate::layout::cache::RangeScope {
        scoped_resolve: true,
        ..Default::default()
    });
    let mut score = parse(&value);
    crate::layout::layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    score.parts[0].measures[2]
        .instrument_changes
        .as_mut()
        .unwrap()[0]
        .reminder
        .as_mut()
        .unwrap()
        .text = Some("Take flute".into());
    cache.set_pending_dirty_region(Some(
        crate::layout::cache::DirtyRegion::local_part_measures(2, 2, vec![true, false]),
    ));
    let cached = crate::layout::layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    assert!(texts(&cached).contains(&"Take flute"));
    assert_eq!(
        serde_json::to_value(cached).unwrap(),
        serde_json::to_value(layout_with_mnx_scores(&score, &config, 0)).unwrap()
    );
    value["parts"][0]["measures"][1]["sequences"] = json!([{"content":[
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":4}}]},
        {"duration":{"base":"half","dots":1},"rest":{}}
    ]}]);
    score.parts[0].measures[1] = parse(&value).parts[0].measures[1].clone();
    cache.set_pending_dirty_region(Some(
        crate::layout::cache::DirtyRegion::local_part_measures(1, 1, vec![true, false]),
    ));
    let cached = crate::layout::layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let resolved = resolve_measures(&score, 0);
    assert!(!has_reminder(&resolved[0].part));
    assert_eq!(
        reminder_expression(&resolved[1].part)
            .unwrap()
            .position
            .fraction,
        (0, 1)
    );
    assert_eq!(
        serde_json::to_value(cached).unwrap(),
        serde_json::to_value(layout_with_mnx_scores(&score, &config, 0)).unwrap()
    );
}
