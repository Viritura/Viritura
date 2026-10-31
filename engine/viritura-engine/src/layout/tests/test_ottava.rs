// Auto-generated from tests.rs — test_ottava
// 4 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::{layout_score, layout_with_mnx_scores};
use crate::render::*;
use std::collections::HashSet;

fn piano_ottava_score(value: i32, end_measure: usize) -> crate::model::Score {
    let upper = serde_json::json!({
        "staff": 1,
        "content": (0..4).map(|_| serde_json::json!({
            "duration": {"base": "quarter"},
            "notes": (["C", "E", "G", "B"].map(|step| serde_json::json!({
                "pitch": {"step": step, "octave": 5}
            })))
        })).collect::<Vec<_>>()
    });
    let lower = serde_json::json!({
        "staff": 2,
        "content": (0..4).map(|_| serde_json::json!({
            "duration": {"base": "quarter"},
            "notes": [{"pitch": {"step": "C", "octave": 3}}]
        })).collect::<Vec<_>>()
    });
    let mut measures = vec![serde_json::json!({"sequences": [upper, lower]}); 24];
    measures[0]["clefs"] = serde_json::json!([
        {"staff": 1, "clef": {"sign": "G", "staffPosition": -2}},
        {"staff": 2, "clef": {"sign": "F", "staffPosition": 2}}
    ]);
    measures[1]["ottavas"] = serde_json::json!([{
        "value": value,
        "staff": 2,
        "position": {"fraction": [0, 1]},
        "end": {"measure": format!("m{}", end_measure + 1), "position": {"fraction": [1, 1]}}
    }]);
    let mut global = (1..=24)
        .map(|index| serde_json::json!({"id": format!("m{index}")}))
        .collect::<Vec<_>>();
    global[0]["time"] = serde_json::json!({"count": 4, "unit": 4});
    let json = serde_json::json!({
        "mnx": {"version": 1},
        "global": {"measures": global},
        "parts": [{"id": "piano", "name": "Piano", "staves": 2, "measures": measures}],
        "layouts": [{"id": "piano-layout", "content": [
            {"type": "staff", "sources": [{"part": "piano", "staff": 1}]},
            {"type": "staff", "sources": [{"part": "piano", "staff": 2}]}
        ]}],
        "scores": [{"name": "Piano", "layout": "piano-layout"}]
    });
    let mut score = crate::parse::parse_mnx(&json.to_string()).unwrap();
    crate::reconcile::reconcile_score(&mut score);
    score
}

fn ottava_commands(display: &DisplayList) -> Vec<&RenderCommand> {
    display
        .commands
        .iter()
        .zip(&display.element_ids)
        .filter_map(|(command, id)| (id.as_deref() == Some("p0/m1/ottava0")).then_some(command))
        .collect()
}

#[test]
fn test_authored_measure_cache_updates_ottava_pitch_geometry_after_endpoint_edits() {
    use crate::layout::cache::LayoutCache;
    use crate::layout::layout_with_mnx_scores_cached;
    use crate::model::{PageDefinition, SystemDefinition};

    let mut score = piano_ottava_score(-1, 7);
    score.scores[0].pages = vec![PageDefinition {
        systems: vec![SystemDefinition {
            layout: Some("piano-layout".into()),
            measure: "m1".into(),
            layout_changes: Vec::new(),
        }],
    }];
    for page_width in [None, Some(500.0)] {
        let config = LayoutConfig {
            page_width,
            ..LayoutConfig::default()
        };
        let mut cache = LayoutCache::new();
        layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
        for (end, value) in [("m18", -1), ("m6", 1), ("m12", -2)] {
            let ottava = &mut score.parts[0].measures[1].ottavas.as_mut().unwrap()[0];
            ottava.end.measure = end.into();
            ottava.value = value;
            let expected = layout_with_mnx_scores(&score, &config, 0);
            let actual = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
            assert!(
                expected
                    .to_binary()
                    .iter()
                    .map(|number| number.to_bits())
                    .eq(actual.to_binary().iter().map(|number| number.to_bits())),
                "authored cached geometry must follow ottava endpoint {end} and value {value}"
            );
        }
    }
}

#[test]
fn test_ottava_paged_fragments_are_dashed_and_clear_notes() {
    use crate::model::{Placement, SequenceContent};

    for (value, placement) in [
        (-2, None),
        (-1, None),
        (1, None),
        (2, None),
        (-1, Some(Placement::Above)),
        (1, Some(Placement::Below)),
        (1, Some(Placement::Auto)),
    ] {
        let above = match placement {
            Some(Placement::Above) => true,
            Some(Placement::Below) => false,
            _ => value > 0,
        };
        let mut score = piano_ottava_score(value, 7);
        score.parts[0].measures[1].ottavas.as_mut().unwrap()[0].placement = placement;
        for measure in &mut score.parts[0].measures {
            for item in &mut measure.sequences[1].content {
                if let SequenceContent::Event(event) = item {
                    for note in event.notes.as_mut().unwrap() {
                        note.pitch.octave = (if above { 6 } else { 1.max(-value) }) + value;
                    }
                }
            }
        }
        let config = LayoutConfig {
            page_width: Some(500.0),
            ..LayoutConfig::default()
        };
        let display = layout_with_mnx_scores(&score, &config, 0);
        let mut systems = std::collections::BTreeMap::new();
        for bound in display
            .measure_bounds
            .iter()
            .filter(|bound| bound.staff_index == 1 && (1..=7).contains(&bound.index))
        {
            let entry = systems.entry(bound.system_index).or_insert((
                bound.y,
                f64::INFINITY,
                f64::NEG_INFINITY,
            ));
            let prefix = format!("p0/m{}/s1/", bound.index);
            for shape in &display.element_shapes {
                if matches!(shape.kind, ElementKind::Notehead | ElementKind::Stem)
                    && shape.element_id.starts_with(&prefix)
                {
                    let bbox = shape.bbox(&display.commands).unwrap();
                    entry.1 = entry.1.min(bbox.y);
                    entry.2 = entry.2.max(bbox.y + bbox.height);
                }
            }
        }
        assert!(systems.len() >= 3, "the range must span multiple systems");
        assert!(systems
            .values()
            .all(|(_, top, bottom)| top.is_finite() && bottom.is_finite()));
        let mut rendered_systems = HashSet::new();
        let commands = ottava_commands(&display);
        for command in &commands {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = command {
                if y1 != y2 {
                    continue;
                }
                assert!(
                    x2 - x1 <= 0.8 * config.sp + 1e-8,
                    "every paged ottava fragment must use the standard dash length"
                );
                let (&system, &(_, top, bottom)) = systems
                    .iter()
                    .min_by(|(_, left), (_, right)| {
                        (left.0 - y1).abs().total_cmp(&(right.0 - y1).abs())
                    })
                    .unwrap();
                if above {
                    assert!(
                        *y1 <= top - config.sp,
                        "8va line must clear note and stem ink"
                    );
                } else {
                    assert!(
                        *y1 >= bottom + config.sp,
                        "8vb line must clear note and stem ink"
                    );
                }
                rendered_systems.insert(system);
            }
        }
        assert_eq!(rendered_systems.len(), systems.len());
        assert_eq!(
            commands
                .iter()
                .filter(|command| matches!(command, RenderCommand::DrawGlyph { .. }))
                .count(),
            1
        );
        assert_eq!(
            commands
                .iter()
                .filter(
                    |command| matches!(command, RenderCommand::DrawLine { x1, x2, .. } if x1 == x2)
                )
                .count(),
            1
        );
    }
}

#[test]
fn test_ottava_paged_retention_updates_continuation_placement_and_endpoint() {
    use super::test_patch_frame::reconstruct;
    use crate::layout::cache::{DirtyRegion, LayoutCache};
    use crate::layout::layout_with_mnx_scores_cached;
    use crate::model::Placement;

    let mut score = piano_ottava_score(-1, 7);
    let config = LayoutConfig {
        page_width: Some(500.0),
        ..LayoutConfig::default()
    };
    let mut cache = LayoutCache::new();
    cache.set_patch_frame_enabled(true);
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let seed = cache.take_pending_patch().expect("seed must emit a patch");
    let (_, mut segments) = reconstruct(&seed, &[]);
    assert!(segments.len() > 3);

    for (placement, end_measure) in [
        (Some(Placement::Above), "m8"),
        (Some(Placement::Below), "m18"),
        (None, "m6"),
    ] {
        let ottava = &mut score.parts[0].measures[1].ottavas.as_mut().unwrap()[0];
        ottava.placement = placement;
        ottava.end.measure = end_measure.into();
        let expected = layout_with_mnx_scores(&score, &config, 0);
        cache.set_pending_dirty_region(Some(DirtyRegion::local_part_measures(1, 1, vec![true])));
        let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
        let patch = cache.take_pending_patch().expect("edit must emit a patch");
        let (actual, next_segments) = reconstruct(&patch, &segments);
        assert_eq!(
            serde_json::to_value(ottava_commands(&actual)).unwrap(),
            serde_json::to_value(ottava_commands(&expected)).unwrap(),
            "paged continuations must update when their source changes in another system"
        );
        assert_eq!(
            serde_json::to_value(
                actual
                    .element_bboxes
                    .iter()
                    .filter(|bbox| bbox.element_id == "p0/m1/ottava0")
                    .collect::<Vec<_>>()
            )
            .unwrap(),
            serde_json::to_value(
                expected
                    .element_bboxes
                    .iter()
                    .filter(|bbox| bbox.element_id == "p0/m1/ottava0")
                    .collect::<Vec<_>>()
            )
            .unwrap(),
            "every continuation must retain its selectable bounds"
        );
        segments = next_segments;
    }
    let expected = layout_with_mnx_scores(&score, &config, 0);
    for _ in 0..2 {
        let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
        let patch = cache
            .take_pending_patch()
            .expect("repeat must emit a patch");
        assert!(cache.last_patch_reused_systems() > 0);
        let (actual, next_segments) = reconstruct(&patch, &segments);
        assert_eq!(
            serde_json::to_value(ottava_commands(&actual)).unwrap(),
            serde_json::to_value(ottava_commands(&expected)).unwrap()
        );
        segments = next_segments;
    }
}

#[test]
fn test_ottava_horizon_range_survives_extending_past_chunk_seam() {
    use super::test_patch_frame::reconstruct;
    use crate::layout::cache::{DirtyRegion, LayoutCache, SystemPlacement};
    use crate::layout::layout_with_mnx_scores_cached;

    for value in [-2, -1, 1, 2] {
        let mut score = piano_ottava_score(value, 6);
        let single_config = LayoutConfig {
            page_width: None,
            horizon_chunk_width: None,
            emit_layout_debug: true,
            ..LayoutConfig::default()
        };
        let short_oracle = layout_with_mnx_scores(&score, &single_config, 0);
        // Horizon partitioning reserves 15% breathing room over natural widths.
        let chunk_width = short_oracle.layout_debug.as_ref().unwrap().systems[0]
            .measure_spacings
            .iter()
            .take(7)
            .map(|measure| measure.natural_width * 1.15)
            .sum::<f64>()
            + 0.01;
        let chunk_config = LayoutConfig {
            horizon_chunk_width: Some(chunk_width),
            emit_layout_debug: true,
            ..single_config.clone()
        };
        let short = layout_with_mnx_scores(&score, &chunk_config, 0);
        let systems = &short.layout_debug.as_ref().unwrap().systems;
        assert!(
            systems.len() >= 3,
            "fixture must have reusable later chunks"
        );
        assert_eq!(
            systems[0].measure_spacings.last().unwrap().measure_index,
            6,
            "the first chunk must end at bar 7"
        );
        assert_eq!(
            serde_json::to_value(ottava_commands(&short)).unwrap(),
            serde_json::to_value(ottava_commands(&short_oracle)).unwrap(),
            "bar 2-7 ottava must match the unchunked layout"
        );
        let mut cache = LayoutCache::new();
        cache.set_patch_frame_enabled(true);
        let patch_config = LayoutConfig {
            emit_layout_debug: false,
            ..chunk_config.clone()
        };
        let _ = layout_with_mnx_scores_cached(&score, &patch_config, 0, Some(&mut cache));
        let seed = cache.take_pending_patch().expect("seed must emit a patch");
        let (_, seed_segments) = reconstruct(&seed, &[]);

        score.parts[0].measures[1].ottavas.as_mut().unwrap()[0]
            .end
            .measure = "m8".into();
        let oracle = layout_with_mnx_scores(&score, &single_config, 0);
        let commands = ottava_commands(&oracle);
        assert_eq!(
            commands
                .iter()
                .filter(|command| matches!(command, RenderCommand::DrawGlyph { .. }))
                .count(),
            1
        );
        assert_eq!(
            commands
                .iter()
                .filter(
                    |command| matches!(command, RenderCommand::DrawLine { x1, x2, .. } if x1 == x2)
                )
                .count(),
            1,
            "only the final endpoint gets a hook"
        );
        assert!(commands.len() > 3, "the oracle must emit horizontal dashes");
        let crossed = layout_with_mnx_scores(&score, &chunk_config, 0);
        assert!(crossed
            .measure_bounds
            .iter()
            .all(|bound| bound.system_index == 0));
        assert_eq!(
            serde_json::to_value(ottava_commands(&crossed)).unwrap(),
            serde_json::to_value(ottava_commands(&oracle)).unwrap(),
            "bar 2-8 ottava must not disappear or split at a Horizon chunk seam (value {value})"
        );
        assert_eq!(
            crossed
                .element_bboxes
                .iter()
                .filter(|bbox| bbox.element_id == "p0/m1/ottava0")
                .count(),
            1,
            "the continuous ottava must retain one selectable bounding box"
        );
        cache.set_pending_dirty_region(Some(DirtyRegion::local_part_measures(1, 7, vec![true])));
        let _ = layout_with_mnx_scores_cached(&score, &patch_config, 0, Some(&mut cache));
        let patch = cache.take_pending_patch().expect("edit must emit a patch");
        assert!(cache.last_patch_reused_systems() > 0);
        let (reconstructed, segments) = reconstruct(&patch, &seed_segments);
        assert_eq!(
            serde_json::to_value(ottava_commands(&reconstructed)).unwrap(),
            serde_json::to_value(ottava_commands(&oracle)).unwrap(),
            "the cross-chunk ottava must survive retained-system patch rendering"
        );

        score.parts[0].measures[1].ottavas.as_mut().unwrap()[0]
            .position
            .fraction = (1, 4);
        let shifted_oracle = layout_with_mnx_scores(&score, &single_config, 0);
        cache.set_pending_dirty_region(Some(DirtyRegion::local_part_measures(1, 1, vec![true])));
        let _ = layout_with_mnx_scores_cached(&score, &patch_config, 0, Some(&mut cache));
        let shifted = cache
            .take_pending_patch()
            .expect("start edit must emit a patch");
        assert!(
            matches!(&shifted.placements[1], SystemPlacement::Reuse { .. }),
            "the chunk containing bar 8 must actually be retained"
        );
        let (reconstructed, mut segments) = reconstruct(&shifted, &segments);
        assert_eq!(
            serde_json::to_value(ottava_commands(&reconstructed)).unwrap(),
            serde_json::to_value(ottava_commands(&shifted_oracle)).unwrap(),
            "ottava geometry must resolve an endpoint in a retained chunk"
        );
        for repeat in 0..2 {
            let _ = layout_with_mnx_scores_cached(&score, &patch_config, 0, Some(&mut cache));
            let repeated = cache
                .take_pending_patch()
                .expect("repeat must emit a patch");
            if repeat == 1 {
                assert_eq!(cache.last_patch_fresh_systems(), 0);
            }
            let (reconstructed, next_segments) = reconstruct(&repeated, &segments);
            assert_eq!(
                serde_json::to_value(ottava_commands(&reconstructed)).unwrap(),
                serde_json::to_value(ottava_commands(&shifted_oracle)).unwrap(),
                "retained frames must preserve the cached ottava overlay"
            );
            segments = next_segments;
        }
    }
}

#[test]
fn test_ottava_chunked_horizon_bounds_are_not_clipped() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig {
        sp: 8.0,
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let min_bbox_y = dl
        .element_bboxes
        .iter()
        .map(|element| element.bbox.y)
        .fold(f64::INFINITY, f64::min);
    let max_bbox_y = dl
        .element_bboxes
        .iter()
        .map(|element| element.bbox.y + element.bbox.height)
        .fold(f64::NEG_INFINITY, f64::max);

    assert!(
        min_bbox_y >= 0.0 && max_bbox_y <= dl.height,
        "ottava Horizon element bounds {min_bbox_y}..{max_bbox_y} exceed display height {}",
        dl.height
    );
}

#[test]
fn test_ottava_8va_render() {
    use crate::render::smufl::smufl;

    // Load ottavas-8va.mnx: 8va marking spanning from m1 beat 1/2 to m2 beat 1/2
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Should have a DrawGlyph with the 8va SMuFL codepoint above the staff
    let glyph_cmds: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::OTTAVA_ALTA)
    }).collect();
    assert_eq!(
        glyph_cmds.len(),
        1,
        "Expected exactly 1 ottava alta glyph, got {}",
        glyph_cmds.len()
    );

    // The glyph should be above the top staff line
    if let RenderCommand::DrawGlyph { y, .. } = glyph_cmds[0] {
        assert!(
            *y < staff_y,
            "8va glyph at y={} should be above staff at y={}",
            y,
            staff_y
        );
    }

    // Should have dashed lines (multiple short horizontal segments above staff)
    let dash_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, x1, x2, .. } = cmd {
                // Horizontal lines above staff (not staff lines, not barlines)
                let is_horizontal = (*y1 - *y2).abs() < 0.01;
                let above_staff = *y1 < staff_y;
                let short_segment = (*x2 - *x1).abs() < 2.0 * sp;
                is_horizontal && above_staff && short_segment
            } else {
                false
            }
        })
        .collect();
    assert!(
        dash_lines.len() >= 2,
        "Expected at least 2 dash segments, got {}",
        dash_lines.len()
    );

    // Should have a vertical hook line at the end
    let hook_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = cmd {
                let is_vertical = (*x1 - *x2).abs() < 0.01;
                let above_staff = *y1 < staff_y || *y2 < staff_y;
                let short = (*y2 - *y1).abs() < 1.5 * sp;
                is_vertical && above_staff && short
            } else {
                false
            }
        })
        .collect();
    assert!(
        !hook_lines.is_empty(),
        "Expected at least 1 vertical hook line, got {}",
        hook_lines.len()
    );
}

#[test]
fn test_ottava_explicit_placement_below() {
    use crate::model::Placement;
    use crate::render::smufl::smufl;

    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let mut score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");
    score.parts[0].measures[0].ottavas.as_mut().unwrap()[0].placement = Some(Placement::Below);

    let config = LayoutConfig::default();
    let staff_bottom = (config.margin_top + 4.0) * config.sp;
    let dl = layout_score(&score, 0, &config);
    let glyph_y = dl.commands.iter().find_map(|command| match command {
        RenderCommand::DrawGlyph {
            y,
            codepoint: smufl::OTTAVA_ALTA,
            ..
        } => Some(*y),
        _ => None,
    });

    assert!(
        glyph_y.is_some_and(|y| y > staff_bottom),
        "explicit below ottava should render below the staff"
    );
}

#[test]
fn test_ottava_8va_display_transposition() {
    // Verify that notes under an 8va marking are displayed one octave lower
    // than their sounding pitch. The MNX file has C7 (sounding) under 8va,
    // which should display as C6 on the staff.
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Treble clef: G4 is reference, line_from_bottom=1
    // C6 diatonic=42, clef_ref=32, pos_from_clef_line=10, pos_from_top=(4-1)*2-10=6-10=-4
    // C7 diatonic=49, clef_ref=32, pos_from_clef_line=17, pos_from_top=6-17=-11
    // Under 8va, C7 should display as C6 (pos_from_top=-4)
    let c6_y = staff_y + (-4.0) * sp * 0.5; // C6 position
    let c7_y = staff_y + (-11.0) * sp * 0.5; // C7 position (without transposition)

    // Collect all noteheads (DrawGlyph with notehead codepoints)
    let noteheads: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = cmd
            {
                // Notehead codepoints: U+E0A2 (filled), U+E0A3 (half), U+E0A4 (whole)
                if *codepoint == 0xE0A2 || *codepoint == 0xE0A3 || *codepoint == 0xE0A4 {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();

    // Notes under 8va should NOT be at C7 position (very high up)
    for (_, y) in &noteheads {
        assert!(
            *y > c7_y + sp,
            "Note at y={:.1} is too high — near C7 position ({:.1}). \
             Ottava display transposition may not be applied.",
            y,
            c7_y
        );
    }

    // The third note (C7 sounding → C6 display) should be near C6 position
    // C6 is 2 ledger lines above staff: y = staff_y + (-4.0) * 0.5 * sp
    assert!(noteheads.len() >= 3, "Expected at least 3 noteheads");
    let third_note_y = noteheads[2].1;
    assert!(
        (third_note_y - c6_y).abs() < 1.0 * sp,
        "Third note (C7 under 8va) at y={:.1} should be near C6 display position ({:.1})",
        third_note_y,
        c6_y
    );
}

#[test]
fn test_ottava_collision_avoidance() {
    use crate::render::smufl::smufl;

    // Load ottavas-8va.mnx: notes under 8va may have high positions
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Find the ottava glyph
    let ottava_glyph: Vec<_> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if *codepoint == smufl::OTTAVA_ALTA {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    assert_eq!(
        ottava_glyph.len(),
        1,
        "Expected exactly 1 ottava alta glyph"
    );

    let ottava_y = ottava_glyph[0];

    // Find the highest notehead (smallest Y value)
    let min_note_y = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if *codepoint == 0xE0A2 || *codepoint == 0xE0A3 || *codepoint == 0xE0A4 {
                    return Some(*y);
                }
            }
            None
        })
        .fold(f64::INFINITY, f64::min);

    // The ottava line should be above the highest note
    assert!(
        ottava_y < min_note_y,
        "Ottava Y ({:.1}) should be above highest note Y ({:.1})",
        ottava_y,
        min_note_y
    );

    // The ottava line should be above the staff
    assert!(
        ottava_y < staff_y,
        "Ottava Y ({:.1}) should be above staff Y ({:.1})",
        ottava_y,
        staff_y
    );
}

#[test]
fn test_ottava_smufl_glyph_values() {
    use crate::render::smufl::smufl;

    // Verify the ottava glyph lookup returns correct codepoints and widths
    let (cp, w) = smufl::ottava_glyph(1);
    assert_eq!(cp, 0xE511, "8va should use ottavaAlta codepoint");
    assert!((w - 3.54).abs() < 0.01, "8va width should be ~3.54sp");

    let (cp, w) = smufl::ottava_glyph(2);
    assert_eq!(cp, 0xE515, "15ma should use quindicesimaAlta codepoint");
    assert!((w - 5.26).abs() < 0.01, "15ma width should be ~5.26sp");

    let (cp, w) = smufl::ottava_glyph(-1);
    assert_eq!(cp, 0xE51C, "8vb should use ottavaBassaVb codepoint");
    assert!((w - 3.184).abs() < 0.01, "8vb width should be ~3.184sp");

    let (cp, w) = smufl::ottava_glyph(-2);
    assert_eq!(cp, 0xE51D, "15mb should use quindicesimaBassaMb codepoint");
    assert!((w - 4.924).abs() < 0.01, "15mb width should be ~4.924sp");

    let (cp, w) = smufl::ottava_glyph(3);
    assert_eq!(cp, 0xE518, "22ma should use ventiduesimaAlta codepoint");
    assert!((w - 5.712).abs() < 0.01, "22ma width should be ~5.712sp");

    let (cp, w) = smufl::ottava_glyph(-3);
    assert_eq!(cp, 0xE51E, "22mb should use ventiduesimaBassaMb codepoint");
    assert!((w - 5.34).abs() < 0.01, "22mb width should be ~5.34sp");
}

#[test]
fn test_ottava_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/ottavas-8va.mnx"
    ))
    .expect("Failed to read ottavas-8va.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse ottavas-8va.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Ottava should be tagged with element IDs like "p0/m0/ottava0"
    let ottava_ids: Vec<_> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/ottava"))
        .collect();
    assert!(
        !ottava_ids.is_empty(),
        "Ottava render commands should have element IDs"
    );

    // Verify format: p{N}/m{N}/ottava{N}
    for id in &ottava_ids {
        assert!(
            id.starts_with("p"),
            "Ottava ID should start with 'p': {}",
            id
        );
        assert!(id.contains("/m"), "Ottava ID should contain '/m': {}", id);
        assert!(
            id.contains("/ottava"),
            "Ottava ID should contain '/ottava': {}",
            id
        );
    }

    // All commands for one ottava should share the same ID
    // (glyph + dashes + hook)
    let unique: HashSet<_> = ottava_ids.iter().collect();
    assert_eq!(
        unique.len(),
        1,
        "All commands for a single ottava should share the same element ID, got {:?}",
        unique
    );

    // Should have at least 3 tagged commands (glyph + at least 1 dash + hook)
    assert!(
        ottava_ids.len() >= 3,
        "Expected at least 3 tagged ottava commands, got {}",
        ottava_ids.len()
    );
}
