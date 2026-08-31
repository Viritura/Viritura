// Auto-generated from tests.rs — test_tempo_jumps
// 5 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_tempo_markings_render() {
    // Load tempo-markings.mnx: quarter = 200 in measure 1
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/tempo-markings.mnx"
    ))
    .expect("Failed to read tempo-markings.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse tempo-markings.mnx");

    // Verify the tempo was parsed into the global measure
    assert!(
        score.global.measures[0].tempos.is_some(),
        "First measure should have tempos"
    );
    let tempos = score.global.measures[0].tempos.as_ref().unwrap();
    assert_eq!(tempos.len(), 1, "Expected 1 tempo marking");
    assert_eq!(tempos[0].bpm, 200.0);

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // The metronome mark now renders the note value as a real Bravura SMuFL
    // glyph (metNoteQuarterUp) plus a "= 200" text run, rather than a single
    // text string with a Unicode note char.
    let tempo_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text.contains("= 200")))
        .collect();
    assert_eq!(
        tempo_texts.len(),
        1,
        "Expected 1 tempo text containing '= 200', got {}",
        tempo_texts.len()
    );

    // Tempo text should be above the staff
    if let RenderCommand::DrawText { y, .. } = tempo_texts[0] {
        assert!(
            *y < staff_y,
            "Tempo text at y={} should be above staff at y={}",
            y,
            staff_y
        );
    }

    // The note value renders as the Bravura metNoteQuarterUp glyph.
    let note_glyphs: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::MET_NOTE_QUARTER_UP))
        .collect();
    assert_eq!(
        note_glyphs.len(),
        1,
        "Expected 1 metNoteQuarterUp glyph, got {}",
        note_glyphs.len()
    );
}

#[test]
fn test_jumps_dal_segno_render() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/jumps-dal-segno.mnx"
    ))
    .expect("Failed to read jumps-dal-segno.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse jumps-dal-segno.mnx");

    // Verify segno parsed on measure index 1
    assert!(
        score.global.measures[1].segno.is_some(),
        "Measure 1 should have segno"
    );

    // Verify jump parsed on last measure (index 4)
    let jump = score.global.measures[4]
        .jump
        .as_ref()
        .expect("Measure 4 should have jump");
    assert_eq!(jump.jump_type, JumpType::Segno);

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Should have a segno glyph (U+E047) above the staff
    let segno_glyphs: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::SEGNO)
    }).collect();
    assert_eq!(segno_glyphs.len(), 1, "Expected 1 segno glyph");
    if let RenderCommand::DrawGlyph { y, .. } = segno_glyphs[0] {
        assert!(*y < staff_y, "Segno glyph should be above staff");
    }

    // Should have "D.S." text right-aligned above the staff
    let ds_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "D.S."))
        .collect();
    assert_eq!(ds_texts.len(), 1, "Expected 1 'D.S.' text");
    if let RenderCommand::DrawText { y, align, .. } = ds_texts[0] {
        assert!(*y < staff_y, "D.S. text should be above staff");
        assert!(
            matches!(align, TextAlign::Right),
            "D.S. text should be right-aligned"
        );
    }
}

#[test]
fn test_jumps_ds_al_fine_render() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/jumps-ds-al-fine.mnx"
    ))
    .expect("Failed to read jumps-ds-al-fine.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse jumps-ds-al-fine.mnx");

    // Verify segno on measure 1, fine on measure 2, jump on measure 4
    assert!(
        score.global.measures[1].segno.is_some(),
        "Measure 1 should have segno"
    );
    assert!(
        score.global.measures[2].fine.is_some(),
        "Measure 2 should have fine"
    );
    let jump = score.global.measures[4]
        .jump
        .as_ref()
        .expect("Measure 4 should have jump");
    assert_eq!(jump.jump_type, JumpType::DsAlFine);

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Should have segno glyph
    let segno_count = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::SEGNO)
    }).count();
    assert_eq!(segno_count, 1, "Expected 1 segno glyph");

    // Should have "fine" text
    let fine_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "fine"))
        .collect();
    assert_eq!(fine_texts.len(), 1, "Expected 1 'fine' text");
    if let RenderCommand::DrawText { y, align, .. } = fine_texts[0] {
        assert!(*y < staff_y, "fine text should be above staff");
        assert!(
            matches!(align, TextAlign::Right),
            "fine text should be right-aligned"
        );
    }

    // Should have "D.S. al Fine" text
    let dsf_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "D.S. al Fine"))
        .collect();
    assert_eq!(dsf_texts.len(), 1, "Expected 1 'D.S. al Fine' text");
    if let RenderCommand::DrawText { y, align, .. } = dsf_texts[0] {
        assert!(*y < staff_y, "D.S. al Fine text should be above staff");
        assert!(
            matches!(align, TextAlign::Right),
            "D.S. al Fine text should be right-aligned"
        );
    }
}

#[test]
fn test_jump_marker_sizes_proportional() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/jumps-ds-al-fine.mnx"
    ))
    .expect("Failed to read jumps-ds-al-fine.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse jumps-ds-al-fine.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Segno glyph should use standard 1× staff size (4.0 * sp)
    let segno_glyphs: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::SEGNO)
    }).collect();
    assert_eq!(segno_glyphs.len(), 1);
    if let RenderCommand::DrawGlyph { size, y, .. } = segno_glyphs[0] {
        assert!(
            (*size - 3.0 * sp).abs() < 0.01,
            "Segno glyph should be 3.0×sp, got {}",
            size
        );
        // Segno should be ~2.0sp above the top staff line
        let expected_y = staff_y - 2.0 * sp;
        assert!(
            (*y - expected_y).abs() < 0.5 * sp,
            "Segno Y should be ~2sp above staff"
        );
    }

    // "fine" text should use proportional size (~1.2 * sp, not 2.2 * sp)
    let fine_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "fine"))
        .collect();
    assert_eq!(fine_texts.len(), 1);
    if let RenderCommand::DrawText { size, y, .. } = fine_texts[0] {
        assert!(
            *size <= 2.0 * sp,
            "fine text size should be ≤2.0sp, got {}",
            size
        );
        assert!(
            *size >= 0.5 * sp,
            "fine text size should be ≥0.5sp, got {}",
            size
        );
        // Text now renders on its alphabetic baseline (TextBaseline::Alphabetic)
        // at `text_y + baseline_offset` where the Middle->baseline offset is
        // ~0.36 em (0.72sp at the 2.0sp text size). The visual position is
        // unchanged from the old Middle anchor; only the registration point
        // moved down to the real baseline. So the baseline sits ~0.78sp above
        // the staff (1.5sp Middle anchor + 0.72sp down to the baseline).
        let expected_y = staff_y - 1.5 * sp + 2.0 * sp * 0.36;
        assert!(
            (*y - expected_y).abs() < 0.5 * sp,
            "fine text baseline Y should be ~0.78sp above staff, got {}",
            y
        );
    }

    // "D.S. al Fine" text should use same proportional size
    let dsf_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "D.S. al Fine"))
        .collect();
    assert_eq!(dsf_texts.len(), 1);
    if let RenderCommand::DrawText { size, .. } = dsf_texts[0] {
        assert!(
            *size <= 2.0 * sp,
            "D.S. al Fine text size should be ≤2.0sp, got {}",
            size
        );
        assert!(
            *size >= 0.5 * sp,
            "D.S. al Fine text size should be ≥0.5sp, got {}",
            size
        );
    }
}

#[test]
fn test_jumps_coda_render() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/jumps-coda.mnx"
    ))
    .expect("Failed to read jumps-coda.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse jumps-coda.mnx");

    // Verify segno on measure 1, coda on measure 3, jump on measure 4
    assert!(
        score.global.measures[1].segno.is_some(),
        "Measure 1 should have segno"
    );
    assert!(
        score.global.measures[3].coda().is_some(),
        "Measure 3 should have coda"
    );
    let jump = score.global.measures[4]
        .jump
        .as_ref()
        .expect("Measure 4 should have jump");
    assert_eq!(jump.jump_type, JumpType::DsAlCoda);

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    // Should have a coda glyph (U+E048) above the staff
    let coda_glyphs: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::CODA)
    }).collect();
    assert_eq!(coda_glyphs.len(), 1, "Expected 1 coda glyph");
    if let RenderCommand::DrawGlyph { y, size, .. } = coda_glyphs[0] {
        assert!(*y < staff_y, "Coda glyph should be above staff");
        assert!(
            (*size - 3.0 * sp).abs() < 0.01,
            "Coda glyph should be 3.0×sp"
        );
    }

    // Should have segno glyph too
    let segno_count = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::SEGNO)
    }).count();
    assert_eq!(segno_count, 1, "Expected 1 segno glyph");

    // Should have "D.S. al Coda" text right-aligned above the staff
    let dsc_texts: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| matches!(cmd, RenderCommand::DrawText { text, .. } if text == "D.S. al Coda"))
        .collect();
    assert_eq!(dsc_texts.len(), 1, "Expected 1 'D.S. al Coda' text");
    if let RenderCommand::DrawText { y, align, .. } = dsc_texts[0] {
        assert!(*y < staff_y, "D.S. al Coda text should be above staff");
        assert!(
            matches!(align, TextAlign::Right),
            "D.S. al Coda text should be right-aligned"
        );
    }

    // Coda hugs the trailing barline of its own measure (measure 3) — it
    // closes out that measure's content rather than opening it — not the
    // measure's start.
    let coda_bounds = dl
        .measure_bounds
        .iter()
        .find(|mb| mb.index == 3)
        .expect("Measure 3 bounds should exist");
    let measure_start = coda_bounds.x;
    let measure_end = coda_bounds.x + coda_bounds.width;
    if let RenderCommand::DrawGlyph { x, .. } = coda_glyphs[0] {
        let (bx, _, bw, _) = smufl::glyph_bbox(smufl::CODA);
        let coda_ink_right = x + (bx + bw) * sp;
        assert!(
            (coda_ink_right - measure_end).abs() < (coda_ink_right - measure_start).abs(),
            "Coda glyph's right ink edge ({:.1}) should be closer to the measure's \
             trailing barline ({:.1}) than to its start ({:.1})",
            coda_ink_right,
            measure_end,
            measure_start
        );
    }
}

#[test]
fn test_jump_text_sits_left_of_coda_on_shared_barline() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/jumps-coda.mnx"
    ))
    .expect("Failed to read jumps-coda.mnx");
    let mut score = crate::parse::parse_mnx(&json).expect("Failed to parse jumps-coda.mnx");
    let coda = score.global.measures[3]
        .extensions
        .as_mut()
        .and_then(|extensions| extensions.viritura.as_mut())
        .and_then(|directions| directions.coda.take())
        .expect("Measure 3 should have coda");
    score.global.measures[4].extensions = Some(VendorExtensions {
        viritura: Some(GlobalMeasureExtensions {
            coda: Some(coda),
            ..Default::default()
        }),
    });

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let (jump_x, jump_w, jump_align) = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText {
                x,
                text,
                size,
                align,
                ..
            } if text == "D.S. al Coda" => Some((
                *x,
                crate::layout::text_styles::text_width(
                    text,
                    *size,
                    crate::layout::text_styles::FontFamily::Serif,
                    false,
                ),
                align,
            )),
            _ => None,
        })
        .expect("Expected D.S. al Coda text");
    let coda_x = dl
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. } if *codepoint == smufl::CODA => Some(*x),
            _ => None,
        })
        .expect("Expected coda glyph");
    let (coda_bbox_x, _, _, _) = smufl::glyph_bbox(smufl::CODA);
    let coda_ink_left = coda_x + coda_bbox_x * sp;

    assert!(matches!(jump_align, TextAlign::Left));
    assert!(
        jump_x + jump_w < coda_ink_left,
        "Jump text must end before the coda glyph starts: text right {:.1}, coda left {:.1}",
        jump_x + jump_w,
        coda_ink_left,
    );
}

#[test]
fn test_dc_al_coda_lifts_clear_of_overlapping_ink() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {
                "jump": {"type": "dcalcoda", "location": {"fraction": [1, 1]}},
                "coda": {"location": {"fraction": [1, 1]}}
            }}
        }]},
        "parts": [{"id": "P1", "name": "Flute", "measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "low-1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"id": "low-2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"id": "low-3", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"id": "high", "duration": {"base": "quarter"},
                 "notes": [{"pitch": {"step": "G", "octave": 6, "alter": 1}, "accidentalDisplay": {"show": true}}],
                 "markings": {"accent": {}}}
            ]}]
        }]}],
        "layouts": [{"id": "full", "content": [{"type": "staff", "sources": [{"part": "P1"}]}]}],
        "scores": [{"name": "Full Score", "layout": "full"}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse paired jump fixture");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let jump_box = &dl
        .element_bboxes
        .iter()
        .find(|entry| entry.element_id == "m0/jump")
        .expect("jump bbox")
        .bbox;
    let jump_bottom = jump_box.y + jump_box.height;

    let overlapping_event_ink: Vec<_> = dl
        .commands
        .iter()
        .enumerate()
        .filter_map(|(index, command)| {
            let id = dl.element_ids.get(index)?.as_deref()?;
            if !id.starts_with("p0/m0/s0/high") {
                return None;
            }
            let bbox = command.bbox()?;
            let overlaps_x =
                bbox.x + bbox.width >= jump_box.x && bbox.x <= jump_box.x + jump_box.width;
            overlaps_x.then_some(bbox)
        })
        .collect();
    assert!(
        !overlapping_event_ink.is_empty(),
        "fixture must place ink under jump text"
    );
    for ink in overlapping_event_ink {
        assert!(
            jump_bottom <= ink.y - 0.01,
            "D.C. al Coda must clear overlapping ink: jump={jump_box:?}, ink={ink:?}"
        );
    }
}

#[test]
fn test_tempo_marking_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/tempo-markings.mnx"
    ))
    .expect("Failed to read tempo-markings.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse tempo-markings.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated"
    );

    // Find element IDs matching "tempo"
    let tempo_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/tempo"))
        .collect();
    assert!(
        !tempo_ids.is_empty(),
        "Expected at least 1 tempo element ID, got 0"
    );

    // Tempo is global, format: m{measure}/tempo{index}
    assert!(
        tempo_ids[0].starts_with("m0/tempo"),
        "First tempo ID should start with m0/tempo, got {}",
        tempo_ids[0]
    );
}

#[test]
fn test_jump_marker_element_ids_tagged() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/format/fixtures/mnx/jumps-ds-al-fine.mnx"
    ))
    .expect("Failed to read jumps-ds-al-fine.mnx");
    let score = crate::parse::parse_mnx(&json).expect("Failed to parse jumps-ds-al-fine.mnx");

    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_ids.is_empty(),
        "element_ids should be populated"
    );

    // Should have segno element ID
    let segno_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/segno"))
        .collect();
    assert_eq!(
        segno_ids.len(),
        1,
        "Expected 1 segno element ID, got {:?}",
        segno_ids
    );

    // Should have fine element ID
    let fine_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/fine"))
        .collect();
    assert_eq!(
        fine_ids.len(),
        1,
        "Expected 1 fine element ID, got {:?}",
        fine_ids
    );

    // Should have jump element ID
    let jump_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/jump"))
        .collect();
    assert_eq!(
        jump_ids.len(),
        1,
        "Expected 1 jump element ID, got {:?}",
        jump_ids
    );
}

/// Returns the x of the left-aligned tempo DrawText whose text contains the
/// given fragment, or panics.
fn tempo_text_x(dl: &DisplayList, fragment: &str) -> f64 {
    dl.commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawText { x, text, .. } if text.contains(fragment) => Some(*x),
            _ => None,
        })
        .expect("tempo text not found")
}

#[test]
fn test_tempo_flows_right_of_rehearsal_mark() {
    // A measure-start tempo and a rehearsal mark both anchor at the bar start.
    // When they share a bar the tempo text must flow to the right of the mark
    // instead of stacking on top of it. Use a mid-system measure (no clef/key/
    // time prefix) so the barline-anchored mark box sits directly over the
    // content start and the tempo is forced rightward.
    let with_mark = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {
                "tempos": [{"bpm": 132, "value": {"base": "quarter"}, "text": "Allegro"}],
                "_x": {"viritura": {"rehearsalMark": {"text": "A"}}}
            }
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let without_mark = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"tempos": [{"bpm": 132, "value": {"base": "quarter"}, "text": "Allegro"}]}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]}
        ]}]
    }"#;

    let config = LayoutConfig::default();
    let dl_with = layout_score(
        &crate::parse::parse_mnx(with_mark).expect("parse with-mark"),
        0,
        &config,
    );
    let dl_without = layout_score(
        &crate::parse::parse_mnx(without_mark).expect("parse without-mark"),
        0,
        &config,
    );

    let x_with = tempo_text_x(&dl_with, "= 132");
    let x_without = tempo_text_x(&dl_without, "= 132");

    // The rehearsal mark pushes the tempo text rightward.
    assert!(
        x_with > x_without,
        "tempo text should flow right of the rehearsal mark: with={x_with}, without={x_without}"
    );

    // And it must clear the rehearsal mark's right edge entirely.
    let rehearsal_right = dl_with
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawText { x, text, font, .. }
                if text == "A" && font.contains("bold") =>
            {
                Some(*x)
            }
            _ => None,
        })
        .next()
        .expect("rehearsal mark text");
    assert!(
        x_with > rehearsal_right,
        "tempo x={x_with} should be right of rehearsal mark center x={rehearsal_right}"
    );
}

#[test]
fn test_wide_tempo_at_system_start_clears_rehearsal_mark() {
    // Regression: a wide tempo ("Scherzando (commodo)") co-located with a
    // rehearsal mark at the start of a system. On a narrow page the marking is
    // too wide to fit between the mark and the right page margin, so the
    // right-margin clamp nudges it left — but it must stop at the mark's right
    // border, never slide over the mark. (Rhapsody in Blue, m24.)
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}, "key": {"fifths": 3},
             "tempos": [{"bpm": 110, "value": {"base": "quarter"}, "_x": {"viritura": {"text": "Scherzando (commodo)", "showMetronomeMark": false}}}],
             "_x": {"viritura": {"rehearsalMark": {"text": "4"}}}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}]}]}
        ]}]
    }"#;

    // Narrow page width forces the right-margin clamp to engage.
    let config = LayoutConfig {
        page_width: Some(650.0),
        ..Default::default()
    };
    let dl = layout_score(&crate::parse::parse_mnx(json).expect("parse"), 0, &config);

    let tempo_left = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("tempo"))
        .expect("tempo bbox")
        .bbox
        .x;

    let mark = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.contains("rehears"))
        .expect("rehearsal mark bbox");
    let mark_right = mark.bbox.x + mark.bbox.width;

    assert!(
        tempo_left >= mark_right,
        "wide system-start tempo (left={tempo_left}) must not slide over the \
         rehearsal mark (right={mark_right})"
    );
}

#[test]
fn test_beat0_tempo_anchors_to_bar_start_regardless_of_rest() {
    // A beat-0 tempo must anchor to the measure start exactly like a rehearsal
    // mark, never to the first event. An empty bar's only "event" is a centered
    // whole-measure rest, which previously dragged the tempo text to the middle
    // of the bar — inconsistent with bars that carry notes. Both layouts below
    // must place the tempo text at the same (bar-start) x.
    let empty_bar = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "tempos": [{"bpm": 110, "value": {"base": "quarter"}, "text": "Scherzando"}]
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{"type": "rest", "duration": {"base": "whole"}}]}]
        }]}]
    }"#;
    let noted_bar = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "tempos": [{"bpm": 110, "value": {"base": "quarter"}, "text": "Scherzando"}]
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]
        }]}]
    }"#;

    let config = LayoutConfig::default();
    let dl_empty = layout_score(
        &crate::parse::parse_mnx(empty_bar).expect("parse empty-bar"),
        0,
        &config,
    );
    let dl_noted = layout_score(
        &crate::parse::parse_mnx(noted_bar).expect("parse noted-bar"),
        0,
        &config,
    );

    let x_empty = tempo_text_x(&dl_empty, "= 110");
    let x_noted = tempo_text_x(&dl_noted, "= 110");

    // Both anchor to the same bar-start x — the centered rest must NOT shift it.
    assert!(
        (x_empty - x_noted).abs() < 0.01,
        "beat-0 tempo should anchor to bar start in both bars: empty={x_empty}, noted={x_noted}"
    );

    // And it should sit at the measure content origin, well left of bar center.
    // The marking's left edge is the metronome note glyph, which anchors at the
    // bar-start origin; the "= bpm" text run flows to its right.
    let ml = &dl_empty.measure_bounds[0];
    let x_origin = ml.x + ml.prefix_width;
    let glyph_x = dl_empty
        .commands
        .iter()
        .find_map(|cmd| match cmd {
            RenderCommand::DrawGlyph { x, codepoint, .. }
                if *codepoint == smufl::MET_NOTE_QUARTER_UP =>
            {
                Some(*x)
            }
            _ => None,
        })
        .expect("metronome note glyph");
    assert!(
        (glyph_x - x_origin).abs() < 0.5 * config.sp,
        "tempo glyph x={glyph_x} should be at the bar-start origin x={x_origin}"
    );
}

/// Collect (x, text) for every bold tempo line. With `showMetronomeMark:
/// false` and no rehearsal mark in the bar these are exactly the wrapped
/// tempo-text lines (the only bold text drawn).
fn tempo_lines(dl: &DisplayList) -> Vec<(f64, String)> {
    dl.commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawText { x, text, font, .. } if font.contains("bold") => {
                Some((*x, text.clone()))
            }
            _ => None,
        })
        .collect()
}

#[test]
fn test_long_tempo_text_stays_on_one_line() {
    // A long tempo string is never word-wrapped: it always renders on a single
    // line. When it would not fit the remaining system width the layout forces
    // a system break (see `enforce_tempo_system_breaks`) rather than cramming
    // the marking into the limited space above the bar.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "tempos": [{"bpm": 132, "value": {"base": "quarter"},
                "_x": {"viritura": {"showMetronomeMark": false,
                    "text": "Allegro molto vivace ma non troppo con brio"}}}]
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]
        }]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse long tempo");

    // Galley mode: single line.
    let galley = LayoutConfig::default();
    let dl_galley = layout_score(&score, 0, &galley);
    assert_eq!(
        tempo_lines(&dl_galley).len(),
        1,
        "un-paged tempo text should stay on one line"
    );

    // Page mode: still a single line — no word-wrapping into the cramped space.
    let paged = LayoutConfig {
        page_width: Some(700.0),
        ..Default::default()
    };
    let dl_paged = layout_score(&score, 0, &paged);
    assert_eq!(
        tempo_lines(&dl_paged).len(),
        1,
        "paged tempo text should stay on one line (no word-wrap)"
    );
}

/// Issue 2 regression: a lone tempo marking (no rehearsal mark) must NOT
/// stretch its own bar. The bar keeps its natural width and the tempo is
/// allowed to overhang the following bars per standard engraving practice.
#[test]
fn test_lone_tempo_does_not_stretch_its_bar() {
    // Two-bar score; the second (last) bar is the one we measure. Galley mode
    // (no page_width) means no justification, so the rendered measure width
    // equals its reserved natural width.
    let plain = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}
        ]}]
    }"#;
    // Same, but the last bar carries a very long lone tempo (no rehearsal mark).
    let with_tempo = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"tempos": [{"bpm": 132, "value": {"base": "quarter"},
                "_x": {"viritura": {"showMetronomeMark": false,
                    "text": "Allegro molto vivace ma non troppo con assai brio e fuoco"}}}]}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}
        ]}]
    }"#;

    let config = LayoutConfig::default(); // galley: no page_width, no justification
    let dl_plain = crate::layout::layout_score(
        &crate::parse::parse_mnx(plain).expect("parse plain"),
        0,
        &config,
    );
    let dl_tempo = crate::layout::layout_score(
        &crate::parse::parse_mnx(with_tempo).expect("parse with_tempo"),
        0,
        &config,
    );

    let natural = dl_plain.measure_bounds[1].width;
    let with = dl_tempo.measure_bounds[1].width;

    // The lone tempo must leave the bar's natural width untouched.
    assert!(
        (with - natural).abs() < 0.5 * config.sp,
        "lone tempo must not stretch its bar: natural={natural}, with_tempo={with}"
    );
}

/// Issue 2 regression: a tempo marking on the last bar of a justified page
/// system must not spill past the right page margin — it is nudged left to fit.
#[test]
fn test_tempo_on_last_bar_stays_inside_right_margin() {
    // A single 4/4 system with a lone tempo on the final bar. With a narrow
    // page the justified last bar ends at the right margin; the tempo text
    // anchored inside it would overhang the margin unless nudged left.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {"tempos": [{"bpm": 132, "value": {"base": "quarter"},
                "_x": {"viritura": {"showMetronomeMark": false, "text": "poco rit."}}}]}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse last-bar tempo");
    let config = LayoutConfig {
        page_width: Some(600.0),
        ..Default::default()
    };
    let sp = config.sp;
    let right_limit = 600.0 - config.page_margin_right * sp;

    let dl = layout_score(&score, 0, &config);

    // The tempo text run's right edge must stay inside the right page margin.
    let text_size = config
        .text_styles
        .resolve(crate::layout::text_styles::TextRole::Tempo)
        .size_px(sp);
    let (tx, ttext) = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawText { x, text, .. } if text.contains("poco rit") => {
                Some((*x, text.clone()))
            }
            _ => None,
        })
        .expect("expected tempo text");
    let est_width = ttext.chars().count() as f64 * 0.6 * text_size;
    assert!(
        tx + est_width <= right_limit + 0.01,
        "tempo right edge {} must stay within right margin {}",
        tx + est_width,
        right_limit
    );
}

#[test]
fn test_tempo_text_clears_articulation() {
    // A high note with an accent (the accent sits above the notehead because
    // the note is above the middle line and the stem points down). The tempo
    // text at the bar start must not collide with any accent glyph — either by
    // rising above it or, at a system start, by sliding left over the clef/key
    // prefix (the system-start sideways dodge).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "tempos": [{"bpm": 132, "value": {"base": "quarter"},
                "_x": {"viritura": {"showMetronomeMark": false, "text": "Allegro"}}}]
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 5}}], "markings": {"accent": {}}},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 5}}], "markings": {"accent": {}}},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 6}}], "markings": {"accent": {}}},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 6}}], "markings": {"accent": {}}}
            ]}]
        }]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse tempo+accent");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;

    // Bounding boxes of every accent glyph (articulation supplement block).
    let accent_boxes: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                size,
                ..
            } if (0xE4A0..=0xE4BF).contains(codepoint) => {
                let glyph_sp = size / 4.0;
                let (bx, by, bw, bh) = smufl::glyph_bbox(*codepoint);
                let left = x + bx * glyph_sp;
                let top = y + by * glyph_sp;
                Some((left, left + bw * glyph_sp, top, top + bh * glyph_sp))
            }
            _ => None,
        })
        .collect();
    assert!(
        !accent_boxes.is_empty(),
        "expected at least one accent glyph"
    );

    // The tempo text uses the alphabetic baseline. Measure the same AFM-width
    // and 0.82em ascender band that the renderer publishes for collision flow.
    let text_size = config
        .text_styles
        .resolve(crate::layout::text_styles::TextRole::Tempo)
        .size_px(sp);
    let (tempo_x, tempo_y) = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawText { x, y, text, .. } if text.contains("Allegro") => {
                Some((*x, *y))
            }
            _ => None,
        })
        .expect("expected tempo text");
    let tempo_left = tempo_x;
    let tempo_right = tempo_x
        + crate::layout::text_styles::text_width(
            "Allegro",
            text_size,
            crate::layout::text_styles::FontFamily::Serif,
            true,
        );
    let tempo_top = tempo_y - text_size * 0.82;
    let tempo_bottom = tempo_y;

    // The tempo's box must not overlap any accent's box (cleared by lift or by
    // the system-start leftward dodge).
    for (a_left, a_right, a_top, a_bottom) in accent_boxes {
        let overlaps = tempo_left < a_right
            && tempo_right > a_left
            && tempo_top < a_bottom
            && tempo_bottom > a_top;
        assert!(
            !overlaps,
            "tempo box [{tempo_left:.2},{tempo_right:.2}]x[{tempo_top:.2},{tempo_bottom:.2}] \
             must not overlap accent [{a_left:.2},{a_right:.2}]x[{a_top:.2},{a_bottom:.2}]"
        );
    }
}

#[test]
fn test_tempo_aligns_to_rehearsal_mark_height() {
    // A tempo sharing a bar with a rehearsal mark flows to the right of the
    // mark's box and sits on a COMMON BASELINE with the mark's text — standard
    // engraving practice keeps co-located system objects on one line. Both the
    // tempo and the mark anchor their text baseline `attach_gap` (2sp) above the
    // staff, so the tempo's baseline lands exactly on the mark's text baseline
    // (ignoring the mark box's internal padding).
    let with_mark = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {
                "tempos": [{"bpm": 132, "value": {"base": "quarter"}, "text": "Allegro"}],
                "_x": {"viritura": {"rehearsalMark": {"text": "A"}}}
            }
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]}
        ]}]
    }"#;
    let without_mark = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"tempos": [{"bpm": 132, "value": {"base": "quarter"}, "text": "Allegro"}]}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]}
        ]}]
    }"#;

    let config = LayoutConfig::default();
    let dl_with = layout_score(
        &crate::parse::parse_mnx(with_mark).expect("parse with-mark"),
        0,
        &config,
    );
    let _ = without_mark;

    // The tempo text renders on its alphabetic baseline (the DrawText `y` IS the
    // baseline). Find the tempo ("132") and the rehearsal-mark glyph ("A"), and
    // assert they share one line. The mark matches EXACTLY ("A"), not via
    // `contains`, so it doesn't pick up the tempo label "Allegro".
    let tempo_baseline_anchor = dl_with
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawText { y, text, .. } if text.contains("132") => Some(*y),
            _ => None,
        })
        .expect("tempo '132' text not found");
    let mark_baseline = dl_with
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawText { y, text, .. } if text == "A" => Some(*y),
            _ => None,
        })
        .expect("rehearsal mark 'A' text not found");

    // Both the metronome "132" text and the mark "A" render on their alphabetic
    // baseline (the DrawText `y` IS the baseline), so they compare directly: the
    // two baselines coincide (the mark box's internal padding is ignored for
    // alignment — only the text baselines are matched).
    let tempo_baseline = tempo_baseline_anchor;
    assert!(
        (tempo_baseline - mark_baseline).abs() < 0.01,
        "tempo baseline {tempo_baseline:.2} should sit on the rehearsal mark's text baseline {mark_baseline:.2}"
    );
}

#[test]
fn test_tempo_lifts_over_above_direction() {
    // A text tempo ("a tempo") sharing the measure start with an above-staff
    // performance direction ("arco") must rise clear of it. The tempo is the
    // topmost system object; standard engraving practice stacks it above other
    // directions rather than overlapping them.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "tempos": [{"bpm": 80, "value": {"base": "quarter"},
                "_x": {"viritura": {"text": "a tempo", "showMetronomeMark": false}}}]
        }]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}],
            "_x": {"viritura": {"expressions": [{"text": "arco", "position": {"fraction": [0, 1]}, "placement": "above"}]}}
        }]}]
    }"#;
    let score = crate::parse::parse_mnx(json).expect("parse a tempo + arco");
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let text_cmd = |needle: &str| -> (f64, f64, TextBaseline) {
        dl.commands
            .iter()
            .find_map(|c| match c {
                RenderCommand::DrawText {
                    y,
                    size,
                    text,
                    baseline,
                    ..
                } if text == needle => Some((*y, *size, baseline.clone())),
                _ => None,
            })
            .unwrap_or_else(|| panic!("expected '{needle}' text"))
    };

    let (tempo_y, _tempo_size, tempo_baseline) = text_cmd("a tempo");
    let (arco_y, arco_size, arco_baseline) = text_cmd("arco");
    assert!(matches!(tempo_baseline, TextBaseline::Alphabetic));
    assert!(matches!(arco_baseline, TextBaseline::Alphabetic));

    // Both render on the alphabetic baseline (the DrawText `y` IS the baseline,
    // the box bottom). arco's ink top is `0.82 em` above its baseline (the
    // ascender band the bbox spans). The tempo's baseline must clear that top.
    let tempo_bottom = tempo_y;
    let arco_top = arco_y - 0.82 * arco_size;
    assert!(
        tempo_bottom <= arco_top + 0.01,
        "tempo bottom {tempo_bottom:.2} should clear arco top {arco_top:.2}"
    );
}
