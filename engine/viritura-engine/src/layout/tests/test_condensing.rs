// Condensing tests — multi-source staff rendering with divisi and merge modes.
//
// Test MNX has 4 measures:
//   m0: Both flutes play C-D-E-F (identical → A2)
//   m1: Flute 1 plays half notes, Flute 2 plays quarters (different rhythm → Divisi)
//   m2: Same rhythm, different pitches (→ Amalgamate)
//   m3: Both rest (→ AllRest)
//
// Scores:
//   0 = Full Score (2 staves)
//   1 = Condensed (divisi) — explicit stem up/down
//   2 = Condensed (no stems) — chord merge fallback
//   3 = Condensed (auto) — multiple sources, uses merge mode analysis

use crate::layout::cache::LayoutCache;
use crate::layout::config::LayoutConfig;
use crate::layout::{layout_with_mnx_scores, layout_with_mnx_scores_cached};
use crate::model::{StaffMeter, StaffMeterChange, StaffMeterSynchronization};
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

fn default_config() -> LayoutConfig {
    LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    }
}

fn load_condensing_test() -> crate::model::Score {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/condensing-test.mnx");
    parse_mnx(json).unwrap()
}

fn count_noteheads(dl: &DisplayList) -> usize {
    dl.commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_BLACK
                || *codepoint == smufl::NOTEHEAD_HALF
                || *codepoint == smufl::NOTEHEAD_WHOLE)
        })
        .count()
}

fn count_stems(dl: &DisplayList, config: &LayoutConfig) -> usize {
    let sp = config.sp;
    let stem_w = config.stem_width * sp;
    dl.commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawLine { x1, x2, y1, y2, width, .. }
            if (x1 - x2).abs() < 0.01 && (y1 - y2).abs() > 1.0 && (*width - stem_w).abs() < 0.5)
        })
        .count()
}

fn count_fermatas(dl: &DisplayList) -> usize {
    dl.commands
        .iter()
        .filter(|cmd| {
            matches!(
                cmd,
                RenderCommand::DrawGlyph { codepoint, .. } if (0xE4C0..=0xE4CD).contains(codepoint)
            )
        })
        .count()
}

fn count_measure_fermatas(dl: &DisplayList, measure_index: usize) -> usize {
    let measure_token = format!("/m{measure_index}/");
    dl.commands
        .iter()
        .zip(&dl.element_ids)
        .filter(|(command, element_id)| {
            matches!(
                command,
                RenderCommand::DrawGlyph { codepoint, .. } if (0xE4C0..=0xE4CD).contains(codepoint)
            ) && element_id
                .as_deref()
                .is_some_and(|id| id.contains(&measure_token) && id.ends_with("/ferm"))
        })
        .count()
}

fn find_text_labels(dl: &DisplayList) -> Vec<String> {
    dl.commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText { text, .. } = cmd {
                Some(text.clone())
            } else {
                None
            }
        })
        .collect()
}

// ────── Full Score tests ──────

#[test]
fn test_full_score_renders_two_staves() {
    let score = load_condensing_test();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 0);
    assert!(!dl.commands.is_empty());
    let nh = count_noteheads(&dl);
    // 4 measures × 2 parts, m0: 4+4=8, m1: 2+4=6, m2: 4+4=8, m3: 0+0=0 → 22
    assert!(
        nh >= 20,
        "Full score should have at least 20 noteheads, got {}",
        nh
    );
}

// ────── Explicit divisi tests ──────

#[test]
fn test_condensed_divisi_renders_on_one_staff() {
    let score = load_condensing_test();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 1);
    assert!(!dl.commands.is_empty());
    let nh = count_noteheads(&dl);
    // With shared noteheads for unison positions, fewer glyphs are rendered.
    assert!(
        nh >= 16,
        "Condensed divisi should have at least 16 noteheads, got {}",
        nh
    );
}

#[test]
fn test_condensed_divisi_has_stems() {
    let score = load_condensing_test();
    let config = default_config();
    let dl_full = layout_with_mnx_scores(&score, &config, 0);
    let dl_divisi = layout_with_mnx_scores(&score, &config, 1);
    let stems_full = count_stems(&dl_full, &config);
    let stems_divisi = count_stems(&dl_divisi, &config);
    assert!(stems_full > 0, "Full score should have stems");
    assert!(stems_divisi > 0, "Condensed divisi should have stems");
}

// ────── Chord merge tests ──────

#[test]
fn test_condensed_no_stems_uses_chord_merge() {
    let score = load_condensing_test();
    let config = default_config();
    let dl_divisi = layout_with_mnx_scores(&score, &config, 1);
    let dl_chorded = layout_with_mnx_scores(&score, &config, 2);
    let stems_divisi = count_stems(&dl_divisi, &config);
    let stems_chorded = count_stems(&dl_chorded, &config);
    // Chord merge has fewer stems (notes merged) than divisi (separate voices)
    assert!(
        stems_chorded < stems_divisi,
        "Chord merge ({}) should have fewer stems than divisi ({})",
        stems_chorded,
        stems_divisi
    );
}

// ────── Auto condensing (merge mode analysis) tests ──────

#[test]
fn test_condensed_auto_renders_without_panic() {
    let score = load_condensing_test();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 3);
    assert!(
        !dl.commands.is_empty(),
        "Auto condensing should produce render commands"
    );
}

#[test]
fn condensed_measure_bounds_include_silent_sources_in_explicit_and_auto_layouts() {
    let mut score = load_condensing_test();
    let rests = score.parts[1].measures[3].sequences.clone();
    for measure in &mut score.parts[1].measures {
        measure.sequences.clone_from(&rests);
    }
    for auto_flow in [false, true] {
        for score_index in 1..4 {
            if auto_flow {
                score.scores[score_index].layout = Some(score.layouts[score_index].id.clone());
                score.scores[score_index].pages.clear();
            }
            let dl = layout_with_mnx_scores(&score, &default_config(), score_index);
            assert!(!dl.measure_bounds.is_empty());
            assert!(dl.measure_bounds.iter().any(|bounds| bounds.index == 3));
            for bounds in &dl.measure_bounds {
                assert_eq!(bounds.part_index, 0);
                assert_eq!(bounds.source_part_indices, vec![0, 1]);
            }
        }
    }
}

#[test]
fn condensed_source_identity_survives_json_and_binary_transport() {
    let score = load_condensing_test();
    let dl = layout_with_mnx_scores(&score, &default_config(), 3);
    assert!(!dl.measure_bounds.is_empty());
    let json = serde_json::to_value(&dl).unwrap();
    assert_eq!(
        json["measure_bounds"][0]["source_part_indices"],
        serde_json::json!([0, 1])
    );
    let roundtrip: DisplayList = serde_json::from_value(json).unwrap();
    assert_eq!(roundtrip.measure_bounds[0].source_part_indices, vec![0, 1]);

    let mut legacy = dl.clone();
    for bounds in &mut legacy.measure_bounds {
        bounds.source_part_indices.clear();
    }
    let legacy_json = serde_json::to_value(&legacy).unwrap();
    assert!(legacy_json["measure_bounds"][0]
        .get("source_part_indices")
        .is_none());
    let legacy_roundtrip: DisplayList = serde_json::from_value(legacy_json).unwrap();
    assert!(legacy_roundtrip.measure_bounds[0]
        .source_part_indices
        .is_empty());

    let binary = dl.to_binary();
    let legacy_binary = legacy.to_binary();
    assert_eq!(
        binary[..legacy_binary.len()]
            .iter()
            .map(|f| f.to_bits())
            .collect::<Vec<_>>(),
        legacy_binary
            .iter()
            .map(|f| f.to_bits())
            .collect::<Vec<_>>()
    );
    let mut expected = vec![dl.measure_bounds.len() as f32];
    if dl.selection_groups.is_empty() {
        expected.insert(0, 0.0);
    }
    for index in 0..dl.measure_bounds.len() {
        expected.extend([index as f32, 2.0, 0.0, 1.0]);
    }
    assert_eq!(&binary[legacy_binary.len()..], expected);
}

#[test]
fn explicit_layout_changes_preserve_per_measure_source_identity() {
    use serde_json::json;

    for (initial_sources, changed_sources) in [
        (vec![0, 1], vec![0, 2]),
        (vec![0], vec![2]),
        (vec![0, 1], vec![2]),
        (vec![0], vec![2, 1]),
    ] {
        let part_ids = ["flute", "cello", "oboe"];
        let layout = |id: &str, sources: &[usize]| {
            json!({
                "id": id,
                "content": [{
                    "type": "staff",
                    "sources": sources.iter().map(|&index| json!({
                        "part": part_ids[index]
                    })).collect::<Vec<_>>()
                }]
            })
        };
        let parts: Vec<_> = part_ids
            .iter()
            .enumerate()
            .map(|(index, id)| {
                json!({
                    "id": id,
                    "measures": (0..3).map(|_| json!({
                        "sequences": [{"content": [{
                            "type": "event",
                            "duration": {"base": "whole"},
                            "notes": [{"pitch": {
                                "step": (["C", "E", "G"][index]), "octave": 4
                            }}]
                        }]}]
                    })).collect::<Vec<_>>()
                })
            })
            .collect();
        let score = parse_mnx(
            &json!({
                "mnx": {"version": 1},
                "global": {"measures": [
                    {"id": "m0", "time": {"count": 4, "unit": 4}},
                    {"id": "m1"}, {"id": "m2"}
                ]},
                "parts": parts,
                "layouts": [
                    layout("initial", &initial_sources),
                    layout("changed", &changed_sources)
                ],
                "scores": [{"name": "Changing sources", "pages": [{"systems": [{
                    "measure": "m0",
                    "layout": "initial",
                    "layoutChanges": [{
                        "layout": "changed",
                        "location": {"measure": "m1", "position": {"fraction": [0, 1]}}
                    }]
                }]}]}]
            })
            .to_string(),
        )
        .unwrap();
        let config = LayoutConfig {
            page_width: Some(3_000.0),
            ..default_config()
        };
        let stateless = layout_with_mnx_scores(&score, &config, 0);
        let mut cache = LayoutCache::new();
        cache.set_patch_frame_enabled(true);
        for dl in [
            stateless.clone(),
            layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache)),
            layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache)),
        ] {
            assert!(
                dl.element_ids
                    .iter()
                    .flatten()
                    .any(|id| id.starts_with("p2/m1/s0/") && id.ends_with("/n0")),
                "{initial_sources:?} -> {changed_sources:?}"
            );
            if changed_sources == [0, 2] {
                assert!(dl
                    .element_ids
                    .iter()
                    .any(|id| id.as_deref() == Some("p2/m1/s0/e0/n0")));
            }
            assert_eq!(dl.measure_bounds.len(), 3);
            for bounds in &dl.measure_bounds {
                let sources = if bounds.index == 0 {
                    &initial_sources
                } else {
                    &changed_sources
                };
                assert_eq!(bounds.system_index, 0);
                assert_eq!(bounds.staff_index, 0);
                assert_eq!(bounds.part_index, sources[0]);
                assert_eq!(
                    bounds.source_part_indices,
                    if sources.len() > 1 { &sources[..] } else { &[] }
                );
            }
            let roundtrip: DisplayList =
                serde_json::from_value(serde_json::to_value(&dl).unwrap()).unwrap();
            assert_eq!(
                serde_json::to_value(&roundtrip.measure_bounds).unwrap(),
                serde_json::to_value(&dl.measure_bounds).unwrap()
            );
            let bits = |display_list: &DisplayList| {
                display_list
                    .to_binary()
                    .iter()
                    .map(|value| value.to_bits())
                    .collect::<Vec<_>>()
            };
            assert_eq!(bits(&dl), bits(&stateless));
            let mut legacy = dl.clone();
            let mut expected = Vec::new();
            let mut count = 0;
            for (index, bounds) in legacy.measure_bounds.iter_mut().enumerate() {
                if !bounds.source_part_indices.is_empty() {
                    count += 1;
                    expected.extend([index as f32, bounds.source_part_indices.len() as f32]);
                    expected.extend(bounds.source_part_indices.iter().map(|&part| part as f32));
                    bounds.source_part_indices.clear();
                }
            }
            if count > 0 {
                expected.insert(0, count as f32);
                if dl.selection_groups.is_empty() {
                    expected.insert(0, 0.0);
                }
            }
            assert_eq!(&dl.to_binary()[legacy.to_binary().len()..], expected);
        }
        assert!(
            cache.take_pending_patch().is_none(),
            "explicit pages use full frames"
        );
    }
}

#[test]
fn test_condensed_auto_has_noteheads() {
    let score = load_condensing_test();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 3);
    let nh = count_noteheads(&dl);
    // m0 (Unison): 4 noteheads (merged unison), m1 (Divisi): 2+4=6, m2 (Amalg): 4+4=8, m3: 0
    assert!(
        nh >= 14,
        "Auto condensing should have at least 14 noteheads, got {}",
        nh
    );
}

#[test]
fn incompatible_staff_local_meters_render_on_distinct_staves_with_their_own_timing() {
    let mut score = load_condensing_test();
    let config = default_config();
    score.parts[0].measures[0].staff_meters = Some(vec![StaffMeterChange::Set {
        staff: 1,
        meter: StaffMeter {
            count: 6,
            unit: 8,
            beat_structure: None,
        },
        synchronization: StaffMeterSynchronization::FitMeasure,
    }]);
    score.scores[3].layout = Some(score.layouts[3].id.clone());
    score.scores[3].pages.clear();

    let mut cache = LayoutCache::new();
    cache.set_range_scope(crate::layout::cache::RangeScope {
        scoped_resolve: true,
        ..Default::default()
    });
    let with_local_meter = layout_with_mnx_scores_cached(&score, &config, 3, Some(&mut cache));
    let glyphs: Vec<(u32, f64)> = with_local_meter
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, y, .. } => Some((*codepoint, *y)),
            _ => None,
        })
        .collect();
    let six_y = glyphs
        .iter()
        .find_map(|(codepoint, y)| (*codepoint == smufl::TIME_SIG_6).then_some(*y))
        .expect("the local 6/8 signature must be retained");
    let eight_y = glyphs
        .iter()
        .find_map(|(codepoint, y)| (*codepoint == smufl::TIME_SIG_8).then_some(*y))
        .expect("the local 6/8 signature denominator must be retained");
    assert!(
        (six_y - eight_y).abs() > 1.0,
        "6/8 numerator and denominator must occupy one staff's stacked signature"
    );
    assert_eq!(
        cache.resolved_staff_count(),
        2,
        "incompatible source meters must produce separate layout staves"
    );
    let local_meter = cache
        .resolved_staff_meter(0, 0)
        .expect("the first source retains its local meter");
    assert_eq!(local_meter.time_signature.count, 6);
    assert_eq!(local_meter.time_signature.unit, 8);
    assert_eq!(
        local_meter.ratio_to_global,
        crate::model::staff_meter::Fraction::new(4, 3),
        "the local source must retain its fitMeasure timing ratio"
    );
    assert!(cache.resolved_staff_meter(1, 0).is_none());
    for part_index in 0..2 {
        let bounds: Vec<_> = with_local_meter
            .measure_bounds
            .iter()
            .filter(|bounds| bounds.staff_index == part_index)
            .collect();
        assert!(!bounds.is_empty());
        assert!(bounds.iter().all(|bounds| {
            bounds.part_index == part_index && bounds.source_part_indices.is_empty()
        }));
    }
}

#[test]
fn manual_divisi_with_incompatible_staff_meters_uses_distinct_layout_staves() {
    let mut score = load_condensing_test();
    let config = default_config();
    score.parts[0].measures[0].staff_meters = Some(vec![StaffMeterChange::Set {
        staff: 1,
        meter: StaffMeter {
            count: 6,
            unit: 8,
            beat_structure: None,
        },
        synchronization: StaffMeterSynchronization::FitMeasure,
    }]);

    let display_list = layout_with_mnx_scores(&score, &config, 1);
    let time_signature_y = |codepoint| {
        display_list
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    codepoint: actual,
                    y,
                    ..
                } if *actual == codepoint => Some(*y),
                _ => None,
            })
    };
    let local_y = time_signature_y(smufl::TIME_SIG_6)
        .expect("the first manual-divisi source retains its local 6/8 signature");
    let global_y = time_signature_y(smufl::TIME_SIG_4)
        .expect("the second manual-divisi source retains the global 4/4 signature");
    assert!(
        (local_y - global_y).abs() > 4.0 * config.sp,
        "incompatible manual-divisi meters must render on distinct layout staves"
    );
}

#[test]
fn identical_staff_local_meters_remain_condensable_and_render_the_common_signature() {
    let mut score = load_condensing_test();
    for part in &mut score.parts {
        part.measures[0].staff_meters = Some(vec![StaffMeterChange::Set {
            staff: 1,
            meter: StaffMeter {
                count: 6,
                unit: 8,
                beat_structure: None,
            },
            synchronization: StaffMeterSynchronization::FitMeasure,
        }]);
    }

    let display_list = layout_with_mnx_scores(&score, &default_config(), 3);
    let glyphs: Vec<u32> = display_list
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, .. } => Some(*codepoint),
            _ => None,
        })
        .collect();
    assert!(glyphs.contains(&smufl::TIME_SIG_6));
    assert!(glyphs.contains(&smufl::TIME_SIG_8));
}

#[test]
fn test_condensed_amalgamate_shares_fermatas() {
    let mut value: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../packages/format/fixtures/mnx/condensing-test.mnx"
    ))
    .unwrap();
    for part in value["parts"].as_array_mut().expect("parts") {
        for event in part["measures"][2]["sequences"][0]["content"]
            .as_array_mut()
            .expect("events")
        {
            event["fermata"] = serde_json::json!({"symbol": "square"});
        }
    }
    let score = parse_mnx(&serde_json::to_string(&value).unwrap()).unwrap();
    let dl = layout_with_mnx_scores(&score, &default_config(), 3);

    assert_eq!(
        count_fermatas(&dl),
        4,
        "each amalgamated onset should render one shared fermata"
    );
}

#[test]
fn test_beethoven_condensed_opening_shares_rest_fermatas() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let score = parse_mnx(json).unwrap();
    let dl = layout_with_mnx_scores(&score, &default_config(), 0);

    assert_eq!(
        count_measure_fermatas(&dl, 1),
        12,
        "each condensed staff should render one shared opening fermata"
    );
}

#[test]
fn test_condensed_auto_produces_player_labels() {
    let score = load_condensing_test();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 3);
    let labels = find_text_labels(&dl);
    // Should contain "a 2" label for measure 0 (identical notes)
    assert!(
        labels.iter().any(|l| l == "a 2"),
        "Auto condensing should produce 'a 2' label, found: {:?}",
        labels
    );
}

#[test]
fn test_condensing_player_label_clears_actual_notehead_ink() {
    let mut value: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../packages/format/fixtures/mnx/condensing-test.mnx"
    ))
    .unwrap();
    let parts = value["parts"].as_array_mut().expect("parts");
    for part in parts {
        part["measures"][0]["sequences"][0]["content"] = serde_json::json!([{
            "duration": {"base": "whole"},
            "notes": [{"pitch": {"step": "C", "octave": 6}}]
        }]);
    }
    let score = parse_mnx(&serde_json::to_string(&value).unwrap()).unwrap();
    let config = default_config();
    let sp = config.sp;
    let dl = layout_with_mnx_scores(&score, &config, 3);
    let (label_x, label_bottom, label_width) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawText {
                x, y, text, size, ..
            } if text == "a 2" => Some((
                *x,
                *y,
                crate::layout::text_styles::text_width(
                    text,
                    *size,
                    crate::layout::text_styles::FontFamily::Serif,
                    false,
                ),
            )),
            _ => None,
        })
        .expect("a 2 player label");
    let nearest_ink_top = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } if smufl::is_notehead(*codepoint) => {
                let scale = *size / 4.0;
                let (bbox_x, bbox_y, bbox_w, _) = smufl::glyph_bbox(*codepoint);
                let left = *x + bbox_x * scale;
                let right = left + bbox_w * scale;
                (right >= label_x && left <= label_x + label_width).then_some(*y + bbox_y * scale)
            }
            _ => None,
        })
        .min_by(f64::total_cmp)
        .expect("notehead ink below player label");

    assert!(
        label_bottom <= nearest_ink_top - 0.5 * sp + 0.01,
        "player-label bottom {label_bottom:.3} must clear nearest notehead ink top \
         {nearest_ink_top:.3} by at least 0.5sp"
    );
}

#[test]
fn test_condensed_auto_unison_uses_single_voice() {
    // m0 = Unison mode: identical notes → chord merge into single voice
    // m1 = Divisi: different rhythms → separate voices (more stems)
    // Compare stems: auto condensing m0 should behave like chord merge,
    // while m1 should behave like divisi.
    let score = load_condensing_test();
    let config = default_config();
    let dl_auto = layout_with_mnx_scores(&score, &config, 3);
    let dl_divisi = layout_with_mnx_scores(&score, &config, 1);
    let stems_auto = count_stems(&dl_auto, &config);
    let stems_divisi = count_stems(&dl_divisi, &config);

    // Auto should have fewer stems than full divisi because m0 merges into single voice
    assert!(
        stems_auto < stems_divisi,
        "Auto condensing ({}) should have fewer stems than full divisi ({})",
        stems_auto,
        stems_divisi
    );
}

#[test]
fn test_condensed_auto_all_scores_render() {
    let score = load_condensing_test();
    let config = default_config();
    for score_idx in 0..4 {
        let dl = layout_with_mnx_scores(&score, &config, score_idx);
        let nh = count_noteheads(&dl);
        assert!(
            nh > 0,
            "Score index {} should have noteheads, got 0",
            score_idx
        );
    }
}

#[test]
fn test_condensed_clarinet_label_includes_in() {
    // Beethoven 5 finale Condensed Score: Clarinets in B♭ should show "in B♭" on the label
    let json = include_str!("../../../../../packages/format/fixtures/mnx/beethoven-5-finale.mnx");
    let score = parse_mnx(json).unwrap();
    let config = default_config();
    // Score index 1 = Condensed Score
    let dl = layout_with_mnx_scores(&score, &config, 1);
    let labels: Vec<String> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText { text, .. } = cmd {
                if text.contains("in B") {
                    Some(text.clone())
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();
    assert!(
        !labels.is_empty(),
        "Condensed score should have labels containing 'in B♭'"
    );
}

// ────── Two-column condensed label tests ──────

/// Helper: extract all DrawText commands with their x, y, and text content.
fn find_text_commands(dl: &DisplayList) -> Vec<(f64, f64, String)> {
    dl.commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText { x, y, text, .. } = cmd {
                Some((*x, *y, text.clone()))
            } else {
                None
            }
        })
        .collect()
}

#[test]
fn test_condensed_non_transposing_two_column_label() {
    // Non-transposing condensed staves (e.g. Bassoon 1,2) should render:
    //   - Name ("Bassoon") as a DrawText at one x position
    //   - Numbers ("1", "2") as separate DrawText commands at a different (rightward) x
    let json = include_str!("../../../../../packages/format/fixtures/mnx/beethoven-5-finale.mnx");
    let score = parse_mnx(json).unwrap();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 1);
    let texts = find_text_commands(&dl);

    // Find "Bassoon" label and its number companions "1" and "2"
    let bassoon = texts.iter().find(|(_, _, t)| t == "Bassoon");
    assert!(
        bassoon.is_some(),
        "Should have a 'Bassoon' label. Labels found: {:?}",
        texts.iter().map(|(_, _, t)| t.as_str()).collect::<Vec<_>>()
    );

    let (bsn_x, bsn_y, _) = bassoon.unwrap();

    // Find number labels near the Bassoon label (within a few spatia vertically)
    let sp = config.sp;
    let nearby_nums: Vec<&(f64, f64, String)> = texts
        .iter()
        .filter(|(_, y, t)| (t == "1" || t == "2") && (y - bsn_y).abs() < 4.0 * sp)
        .collect();

    assert!(
        nearby_nums.len() >= 2,
        "Should have at least 2 number labels near Bassoon, got {}: {:?}",
        nearby_nums.len(),
        nearby_nums
    );

    // Numbers should be at a different x than the name (separate column)
    for (nx, _, nt) in &nearby_nums {
        assert!(
            (nx - bsn_x).abs() > 0.5 * sp,
            "Number '{}' (x={:.1}) should be in a different column than 'Bassoon' (x={:.1})",
            nt,
            nx,
            bsn_x
        );
    }
}

#[test]
fn test_condensed_non_transposing_numbers_vertically_centered() {
    // The numbers column should be vertically centered on the staff,
    // i.e. "1" and "2" should be equidistant from the name's y position.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/beethoven-5-finale.mnx");
    let score = parse_mnx(json).unwrap();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 1);
    let texts = find_text_commands(&dl);

    let bassoon = texts.iter().find(|(_, _, t)| t == "Bassoon");
    assert!(bassoon.is_some());
    let (_, bsn_y, _) = bassoon.unwrap();

    let sp = config.sp;
    let num1: Vec<&(f64, f64, String)> = texts
        .iter()
        .filter(|(_, y, t)| t == "1" && (y - bsn_y).abs() < 4.0 * sp)
        .collect();
    let num2: Vec<&(f64, f64, String)> = texts
        .iter()
        .filter(|(_, y, t)| t == "2" && (y - bsn_y).abs() < 4.0 * sp)
        .collect();

    assert!(!num1.is_empty(), "Should find '1' near Bassoon");
    assert!(!num2.is_empty(), "Should find '2' near Bassoon");

    let (_, y1, _) = num1[0];
    let (_, y2, _) = num2[0];
    let center = (y1 + y2) / 2.0;

    // The center of "1" and "2" should be close to the Bassoon label's y
    assert!(
        (center - bsn_y).abs() < 1.0 * sp,
        "Number center ({:.1}) should match Bassoon center ({:.1})",
        center,
        bsn_y
    );
}

#[test]
fn test_condensed_transposing_inline_numbers() {
    // Transposing instruments (e.g. Clarinet in B♭) should have numbers
    // inline with text, NOT in a separate column.
    let json = include_str!("../../../../../packages/format/fixtures/mnx/beethoven-5-finale.mnx");
    let score = parse_mnx(json).unwrap();
    let config = default_config();
    let dl = layout_with_mnx_scores(&score, &config, 1);
    let texts = find_text_commands(&dl);

    // "Clarinet 1" should exist as a single text element (number inline)
    let cl1 = texts.iter().find(|(_, _, t)| t == "Clarinet 1");
    assert!(
        cl1.is_some(),
        "Transposing condensed should have 'Clarinet 1' inline. Found: {:?}",
        texts
            .iter()
            .filter(|(_, _, t)| t.contains("Clar") || t.contains("cl"))
            .map(|(_, _, t)| t.as_str())
            .collect::<Vec<_>>()
    );

    // "in B♭ 2" should also exist inline
    let cl2 = texts
        .iter()
        .find(|(_, _, t)| t.contains("in B") && t.contains("2"));
    assert!(
        cl2.is_some(),
        "Transposing condensed should have 'in B♭ 2' inline"
    );
}
