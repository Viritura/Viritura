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

use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores;
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
