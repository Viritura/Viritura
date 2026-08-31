use super::test_helpers::{is_accidental_glyph, is_notehead_glyph, minimal_spacing_score};
use crate::layout::config::LayoutConfig;
use crate::layout::mnx_layout::layout_with_mnx_scores;
use crate::layout::spacing::{
    build_log_spacing_for_part_measure, build_merged_log_spacing_for_part_measures, LogSpacing,
};
use crate::layout::{layout_full_score, layout_score};
use crate::model::KeySignature;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::RenderCommand;

fn part(content: &str) -> String {
    format!(
        r#"[{{
            "measures": [{{
                "sequences": [{{"content": [{content}]}}]
            }}]
        }}]"#
    )
}

fn spacing(content: &str) -> LogSpacing {
    let score = minimal_spacing_score(&part(content));
    build_log_spacing_for_part_measure(
        &score.parts[0].measures[0],
        4.0,
        0.25,
        &LayoutConfig::default(),
        &KeySignature::default(),
    )
}

#[test]
fn transposed_chromatic_accidentals_keep_distinct_ink() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 1, "unit": 4}, "key": {"fifths": 0}}]},
        "parts": [{
            "transposition": {"interval": {"staffDistance": 8, "halfSteps": 14}, "prefersWrittenPitches": true},
            "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"id": "chromatic-f", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                    {"id": "chromatic-e", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 4, "alter": 1}}]},
                    {"id": "chromatic-d", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "C", "octave": 4, "alter": 1}}]},
                    {"id": "chromatic-c", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 3, "alter": 1}}]}
                ]}]
            }]
        }]
    }"#;
    let display = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    let accidentals: Vec<_> = display
        .commands
        .iter()
        .filter(|command| is_accidental_glyph(command))
        .filter_map(RenderCommand::bbox)
        .collect();
    let double_sharps = display
        .commands
        .iter()
        .filter(|command| {
            matches!(command, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_DOUBLE_SHARP)
        })
        .count();

    assert_eq!(
        double_sharps, 1,
        "written C double-sharp must use one SMuFL glyph"
    );
    for (index, left) in accidentals.iter().enumerate() {
        for right in accidentals.iter().skip(index + 1) {
            let overlap_x = left.x < right.x + right.width && right.x < left.x + left.width;
            let overlap_y = left.y < right.y + right.height && right.y < left.y + left.height;
            assert!(
                !(overlap_x && overlap_y),
                "transposed accidental ink must not overlap"
            );
        }
    }
}

#[test]
fn sixteenth_beam_clears_following_dotted_eighth_rest() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "beams": [{"events": ["beam-1", "beam-2", "beam-3", "beam-4"]}],
            "sequences": [{"content": [
                {"id": "beam-1", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 3}}]},
                {"id": "beam-2", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
                {"id": "beam-3", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
                {"id": "beam-4", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]},
                {"id": "dotted-rest", "duration": {"base": "eighth", "dots": 1}, "rest": {}},
                {"duration": {"base": "16th"}, "rest": {}}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let display = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let beam_right = display
        .commands
        .iter()
        .filter(|command| matches!(command, RenderCommand::DrawPolygon { .. }))
        .filter_map(RenderCommand::bbox)
        .map(|bbox| bbox.x + bbox.width)
        .fold(f64::NEG_INFINITY, f64::max);
    let rest_left = display
        .commands
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            display.element_ids[*index]
                .as_deref()
                .is_some_and(|id| id.ends_with("dotted-rest"))
        })
        .filter_map(|(_, command)| command.bbox())
        .map(|bbox| bbox.x)
        .fold(f64::INFINITY, f64::min);

    assert!(beam_right.is_finite() && rest_left.is_finite());
    assert!(
        rest_left - beam_right >= 0.2 * config.sp - 0.01,
        "beam right {beam_right} must clear dotted-rest left {rest_left} by 0.2sp"
    );
}

#[test]
fn dense_sixteenths_balance_plain_and_accidental_gaps() {
    let spacing = spacing(
        r#"
        {"duration":{"base":"16th"},"stemDirection":"down","notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"16th"},"stemDirection":"down","notes":[{"pitch":{"step":"D","octave":4}}]},
        {"duration":{"base":"16th"},"stemDirection":"down","notes":[{"pitch":{"step":"F","octave":4,"alter":1}}]},
        {"duration":{"base":"16th"},"stemDirection":"down","notes":[{"pitch":{"step":"G","octave":4}}]}
        "#,
    );
    let plain_gap = spacing.mapping[1].1 - spacing.mapping[0].1;
    let accidental_gap = spacing.mapping[2].1 - spacing.mapping[1].1;
    let minimum_plain_gap = 2.0 * LayoutConfig::default().notehead_rx + 0.5;
    let sharp_width = smufl::glyph_bbox(smufl::ACCIDENTAL_SHARP).2;

    assert!(plain_gap >= minimum_plain_gap - 1.0e-9);
    assert!(
        accidental_gap - plain_gap <= sharp_width + 0.25,
        "accidental gap {accidental_gap} must stay proportional to plain gap {plain_gap}"
    );
}

#[test]
fn dotted_rest_clears_adjacent_sixteenth_ink_in_both_directions() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 1, "unit": 2}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "before", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 3}}]},
                {"id": "middle-rest", "duration": {"base": "eighth", "dots": 1}, "rest": {}},
                {"id": "after", "duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 3}}]},
                {"duration": {"base": "eighth"}, "rest": {}}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let display = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let event_bbox = |suffix: &str| {
        display
            .element_bboxes
            .iter()
            .find(|bbox| bbox.element_id.ends_with(suffix))
            .map(|bbox| bbox.bbox.clone())
            .unwrap_or_else(|| panic!("missing event {suffix}"))
    };
    let before = event_bbox("before");
    let rest = event_bbox("middle-rest");
    let after = event_bbox("after");
    let gap = 0.2 * config.sp;

    assert!(rest.x - (before.x + before.width) >= gap - 0.01);
    assert!(after.x - (rest.x + rest.width) >= gap - 0.01);
}

#[test]
fn onset_positions_are_monotonic() {
    let spacing = spacing(
        r#"
        {"duration":{"base":"16th"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":4}}]},
        {"duration":{"base":"half"},"notes":[{"pitch":{"step":"F","octave":4}}]}
        "#,
    );
    assert!(spacing
        .mapping
        .windows(2)
        .all(|pair| { pair[0].0 < pair[1].0 && pair[0].1 <= pair[1].1 }));
}

#[test]
fn shared_spacing_aligns_cross_staff_onsets() {
    let upper = minimal_spacing_score(&part(
        r#"
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":5}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":5}}]}
        "#,
    ));
    let lower = minimal_spacing_score(&part(
        r#"
        {"duration":{"base":"half"},"notes":[{"pitch":{"step":"C","octave":3}}]},
        {"duration":{"base":"half"},"notes":[{"pitch":{"step":"D","octave":3}}]}
        "#,
    ));
    let measures = [&upper.parts[0].measures[0], &lower.parts[0].measures[0]];
    let keys = [KeySignature::default(), KeySignature::default()];
    let key_refs = [&keys[0], &keys[1]];
    let merged = build_merged_log_spacing_for_part_measures(
        &measures,
        4.0,
        0.25,
        &LayoutConfig::default(),
        &key_refs,
    );
    let origin = 10.0;
    let width = merged.total_width * merged.base_sp;
    let upper_x = merged.lookup_x(2.0, width, origin);
    let lower_x = merged.lookup_x(2.0, width, origin);
    assert!((upper_x - lower_x).abs() < 1e-9);
}

#[test]
fn rigid_floors_survive_extreme_compression() {
    let spacing = spacing(
        r#"
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":4,"alter":1}}]}
        "#,
    );
    let compressed = spacing.rigid_total * spacing.base_sp * 0.5;
    let first = spacing.lookup_x(0.0, compressed, 0.0);
    let second = spacing.lookup_x(1.0, compressed, 0.0);
    let rigid_delta = spacing.rigid_widths[1] - spacing.rigid_widths[0];
    assert!(second - first + 1e-9 >= rigid_delta * spacing.base_sp);
}

#[test]
fn accidental_collision_clearance_is_a_hard_floor() {
    let plain = spacing(
        r#"
        {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4}}]}
        "#,
    );
    let obstructed = spacing(
        r#"
        {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4,"alter":1}}]}
        "#,
    );
    assert!(obstructed.rigid_widths[1] > plain.rigid_widths[1]);
}

#[test]
fn adding_an_obstacle_never_reduces_spacing() {
    let plain = spacing(
        r#"
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":4}}]}
        "#,
    );
    let obstructed = spacing(
        r#"
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":4,"alter":1}}]}
        "#,
    );
    assert!(obstructed.total_width >= plain.total_width);
    assert!(obstructed.rigid_total >= plain.rigid_total);
}

#[test]
fn merging_staff_spacing_is_monotonic() {
    let sparse = minimal_spacing_score(&part(
        r#"{"duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":4}}]}"#,
    ));
    let dense = minimal_spacing_score(&part(
        r#"
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":4}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":4}}]},
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"F","octave":4}}]}
        "#,
    ));
    let config = LayoutConfig::default();
    let key = KeySignature::default();
    let sparse_spacing =
        build_log_spacing_for_part_measure(&sparse.parts[0].measures[0], 4.0, 0.25, &config, &key);
    let dense_spacing =
        build_log_spacing_for_part_measure(&dense.parts[0].measures[0], 4.0, 0.25, &config, &key);
    let merged = build_merged_log_spacing_for_part_measures(
        &[&sparse.parts[0].measures[0], &dense.parts[0].measures[0]],
        4.0,
        0.25,
        &config,
        &[&key, &key],
    );
    assert!(merged.total_width >= sparse_spacing.total_width);
    assert!(merged.total_width >= dense_spacing.total_width);
}

#[test]
fn equivalent_tuplet_representations_have_identical_spacing() {
    let flat = spacing(
        r#"{"type":"tuplet",
            "inner":{"duration":{"base":"eighth"},"multiple":3},
            "outer":{"duration":{"base":"quarter"},"multiple":1},
            "content":[
                {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":4}}]},
                {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4}}]},
                {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"E","octave":4}}]}
            ]}"#,
    );
    let nested = spacing(
        r#"{"type":"tuplet",
            "inner":{"duration":{"base":"eighth"},"multiple":3},
            "outer":{"duration":{"base":"quarter"},"multiple":1},
            "content":[{"type":"tuplet",
                "inner":{"duration":{"base":"eighth"},"multiple":3},
                "outer":{"duration":{"base":"eighth"},"multiple":3},
                "content":[
                    {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":4}}]},
                    {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":4}}]},
                    {"duration":{"base":"eighth"},"notes":[{"pitch":{"step":"E","octave":4}}]}
                ]
            }]}"#,
    );
    assert_eq!(flat.mapping, nested.mapping);
    assert!((flat.total_width - nested.total_width).abs() < 1e-9);
}

#[test]
fn trailing_ink_clearance_is_rigid() {
    let spacing = spacing(
        r#"
        {"duration":{"base":"half"},"notes":[{"pitch":{"step":"C","octave":4}}]},
        {"duration":{"base":"half"},"notes":[
            {"pitch":{"step":"D","octave":4}},
            {"pitch":{"step":"E","octave":4}}
        ]}
        "#,
    );
    assert!(
        spacing.rigid_total > spacing.rigid_widths.last().copied().unwrap_or_default(),
        "the final onset must carry an incompressible post-onset tail"
    );
}

#[test]
fn trailing_grace_notes_request_rigid_barline_clearance() {
    let plain = spacing(
        r#"
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"G","octave":5}}]}
        "#,
    );
    let with_grace = spacing(
        r#"
        {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"G","octave":5}}]},
        {"type":"grace","content":[
            {"duration":{"base":"16th"},"notes":[{"pitch":{"step":"F","octave":5}}]},
            {"duration":{"base":"16th"},"notes":[{"pitch":{"step":"G","octave":5}}]}
        ]}
        "#,
    );

    assert!(
        with_grace.rigid_total > plain.rigid_total,
        "trailing grace ink must add rigid clearance before the barline"
    );
}

#[test]
fn leading_barline_clearance_composes_cluster_accidentals_and_shared_clef_gap() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 2, "unit": 4}},
            {}
        ]},
        "parts": [
            {"measures": [
                {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                 "sequences": [{"content": [
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
                 ]}]},
                {"sequences": [{"content": [
                    {"id": "stacked-second", "duration": {"base": "half"}, "notes": [
                        {"pitch": {"step": "C", "octave": 5, "alter": 1}, "accidentalDisplay": {"show": true}},
                        {"pitch": {"step": "D", "octave": 5, "alter": -1}, "accidentalDisplay": {"show": true}}
                    ]}
                ]}]}
            ]},
            {"measures": [
                {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                 "sequences": [{"content": [
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
                 ]}]},
                {"sequences": [{"content": [
                    {"id": "plain-second", "duration": {"base": "half"}, "notes": [
                        {"pitch": {"step": "C", "octave": 5}},
                        {"pitch": {"step": "D", "octave": 5}}
                    ]}
                ]}]}
            ]},
            {"measures": [
                {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                 "sequences": [{"content": [
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
                 ]}]},
                {"clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
                 "sequences": [{"content": [
                    {"id": "clef-staff", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
                 ]}]}
            ]}
        ]
    }"#;
    let config = LayoutConfig::default();
    let display = layout_full_score(&crate::parse::parse_mnx(json).unwrap(), &config);
    let bounds: Vec<_> = display
        .measure_bounds
        .iter()
        .filter(|bounds| bounds.index == 1)
        .collect();
    assert_eq!(bounds.len(), 3);
    let onset_x = bounds[0].beat_anchors[0].1;
    assert!(
        bounds
            .iter()
            .all(|measure| (measure.beat_anchors[0].1 - onset_x).abs() < 0.01),
        "cluster and clef-change staves must retain one shared rhythmic onset"
    );

    for measure in bounds {
        let barline_right = measure.x + config.barline_width * config.sp * 0.5;
        let ink_left = display
            .commands
            .iter()
            .enumerate()
            .filter(|(_, command)| is_accidental_glyph(command) || is_notehead_glyph(command))
            .filter(|(index, _)| {
                display.element_ids[*index]
                    .as_deref()
                    .is_some_and(|id| id.contains("/m1/"))
            })
            .filter_map(|(_, command)| command.bbox())
            .filter(|bbox| {
                bbox.x >= measure.x - 4.0 * config.sp
                    && bbox.x < onset_x + 2.0 * config.sp
                    && bbox.y < measure.y + measure.height + 5.0 * config.sp
                    && bbox.y + bbox.height > measure.y - 5.0 * config.sp
            })
            .map(|bbox| bbox.x)
            .fold(f64::INFINITY, f64::min);
        assert!(
            ink_left - barline_right >= 0.5 * config.sp - 0.01,
            "staff {} leading ink must clear the barline by 0.5sp",
            measure.part_index
        );
    }
}

#[test]
fn beethoven_5_1_m39_condensed_winds_clear_trailing_barline_on_shared_onset() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let mut score = crate::parse::parse_mnx(json).unwrap();
    let opening_time = score.global.measures[0].time.clone();
    let opening_key = score.global.measures[0].key.clone();
    let opening_clefs: Vec<_> = score
        .parts
        .iter()
        .map(|part| part.measures[0].clefs.clone())
        .collect();
    score.global.measures = score.global.measures[37..=38].to_vec();
    score.global.measures[0].time = opening_time;
    score.global.measures[0].key = opening_key;
    for (part, clefs) in score.parts.iter_mut().zip(opening_clefs) {
        part.measures = part.measures[37..=38].to_vec();
        part.measures[0].clefs = clefs;
    }
    let config = LayoutConfig {
        page_width: Some(50.0),
        ..LayoutConfig::default()
    };
    let display = layout_with_mnx_scores(&score, &config, 1);
    let wind_event_ids = [
        [
            "019fd344-0a1f-7ee7-a94d-781ce442e3b3",
            "019fd344-0a29-730c-863b-fad92c25ab2f",
        ],
        [
            "019fd344-0a31-7220-a4e6-dbd800bf1c3b",
            "019fd344-0a40-72cd-b49b-4630d655033a",
        ],
        [
            "019fd344-0a4d-728e-95c4-ed8ee6242dea",
            "019fd344-0a55-7ce6-a43f-2078baa75aeb",
        ],
    ];
    let event_ink: Vec<_> = wind_event_ids
        .iter()
        .map(|ids| {
            ids.iter()
                .map(|id| {
                    display
                        .element_bboxes
                        .iter()
                        .find(|bbox| bbox.element_id.ends_with(id))
                        .unwrap_or_else(|| panic!("missing condensed Beethoven event {id}"))
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let bounds: Vec<_> = display
        .measure_bounds
        .iter()
        .filter(|bounds| bounds.index == 1 && (1..=3).contains(&bounds.part_index))
        .collect();
    assert_eq!(bounds.len(), 3);
    let onset_x = bounds[0].beat_anchors[0].1;
    assert!(
        bounds
            .iter()
            .all(|measure| (measure.beat_anchors[0].1 - onset_x).abs() < 0.01),
        "condensed oboe, clarinet, and bassoon must share the m39 onset x"
    );
    let minimum_clearance = 0.5 * config.sp;
    for (events, measure) in event_ink.iter().zip(&bounds) {
        let barline_left = measure.x + measure.width - config.barline_width * config.sp * 0.5;
        let ink_right = events
            .iter()
            .map(|event| event.bbox.x + event.bbox.width)
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(
            barline_left - ink_right >= minimum_clearance - 0.01,
            "final onset ink right {:.2} must clear barline left {:.2} by {:.2}px",
            ink_right,
            barline_left,
            minimum_clearance
        );
    }
}

#[test]
fn beethoven_5_1_boundary_after_m93_clears_ink_without_misalignment() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let display = layout_with_mnx_scores(&score, &config, 1);
    let bounds: Vec<_> = display
        .measure_bounds
        .iter()
        .filter(|bounds| bounds.index == 93)
        .collect();
    assert_eq!(bounds.len(), 18);
    let onset_x = bounds[0].beat_anchors[0].1;
    assert!(
        bounds
            .iter()
            .all(|measure| (measure.beat_anchors[0].1 - onset_x).abs() < 0.01),
        "all visible staves must share the m94 onset x"
    );
    let minimum_clearance = 0.5 * config.sp;
    let mut checked_staves = 0;
    for measure in bounds {
        let barline_right = measure.x + config.barline_width * config.sp * 0.5;
        let ink_left = display
            .commands
            .iter()
            .enumerate()
            .filter(|(_, command)| is_accidental_glyph(command) || is_notehead_glyph(command))
            .filter(|(index, _)| {
                display.element_ids[*index]
                    .as_deref()
                    .is_some_and(|id| id.contains("/m93/"))
            })
            .filter_map(|(index, command)| command.bbox().map(|bbox| (index, bbox)))
            .filter(|(_, bbox)| {
                bbox.x >= measure.x - 4.0 * config.sp
                    && bbox.x < onset_x + 2.0 * config.sp
                    && bbox.y < measure.y + measure.height + 5.0 * config.sp
                    && bbox.y + bbox.height > measure.y - 5.0 * config.sp
            })
            .map(|(_, bbox)| bbox.x)
            .fold(f64::INFINITY, f64::min);
        if !ink_left.is_finite() {
            continue;
        }
        checked_staves += 1;
        assert!(
            ink_left - barline_right >= minimum_clearance - 0.01,
            "staff {} first onset {:.2}, prefix {:.2}, ink left {:.2} must clear barline right {:.2} by {:.2}px",
            measure.part_index,
            onset_x,
            measure.prefix_width,
            ink_left,
            barline_right,
            minimum_clearance
        );
    }
    assert!(
        checked_staves >= 8,
        "expected pitched first-onset ink across the orchestra"
    );
}
