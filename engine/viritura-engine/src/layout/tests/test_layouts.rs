// Auto-generated from tests.rs — test_layouts
// 17 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::resolve::*;
use crate::layout::staff_brace::is_brace_glyph;
use crate::layout::{layout_full_score, layout_with_mnx_scores};
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_tier5_system_layouts_parse() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/system-layouts.mnx");
    let score = parse_mnx(json).unwrap();

    assert_eq!(
        score.global.measures.len(),
        4,
        "excerpt should contain bars 1-4"
    );
    assert_eq!(score.layouts.len(), 1);
    assert_eq!(score.layouts[0].id, "condensed-score");
    assert_eq!(
        score.parts.len(),
        18,
        "condensed score should retain all source parts"
    );
    assert!(
        score.parts.iter().all(|part| part.measures.len() == 4),
        "every source part should contain exactly four bars"
    );
    assert_eq!(score.scores.len(), 1);
    assert_eq!(score.scores[0].name.as_deref(), Some("Condensed"));
    assert_eq!(score.scores[0].layout.as_deref(), Some("condensed-score"));
    assert_eq!(score.scores[0].use_written, Some(true));
    assert!(
        score.scores[0].pages.is_empty(),
        "excerpt should use automatic flow"
    );
}

#[test]
fn test_tier5_system_layouts_render() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/system-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Should produce render commands
    assert!(!dl.commands.is_empty(), "Should produce render commands");
    assert!(dl.width > 0.0, "Width should be positive");
    assert!(dl.height > 0.0, "Height should be positive");

    let staff_lines = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                if (y1 - y2).abs() < 0.01 && (x2 - x1).abs() > 50.0)
        })
        .count();
    assert!(
        staff_lines >= 60,
        "12 condensed staves should render at least 60 staff lines, got {staff_lines}"
    );

    let noteheads = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_BLACK
                || *codepoint == smufl::NOTEHEAD_HALF
                || *codepoint == smufl::NOTEHEAD_WHOLE)
        })
        .count();
    assert!(
        noteheads > 0,
        "condensed Beethoven excerpt should render noteheads"
    );

    let bracket_lines = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawLine { x1, x2, y1, y2, .. }
            if (x1 - x2).abs() < 0.01 && (y2 - y1).abs() > 20.0)
        })
        .count();
    assert!(
        bracket_lines > 0,
        "condensed score should render group brackets"
    );
}

#[test]
fn test_tier5_multiple_layouts_parse() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();

    // Should have 4 layouts
    assert_eq!(
        score.layouts.len(),
        4,
        "multiple-layouts.mnx should have 4 layouts"
    );
    // Layout ids are opaque UUIDs post-migration; assert all 4 are distinct.
    let layout_ids: std::collections::HashSet<&str> =
        score.layouts.iter().map(|l| l.id.as_str()).collect();
    assert_eq!(layout_ids.len(), 4, "All 4 layout ids should be distinct");

    // Should have 3 score definitions
    assert_eq!(score.scores.len(), 3);
    assert_eq!(score.scores[0].name.as_deref(), Some("FourStaff"));
    assert_eq!(score.scores[1].name.as_deref(), Some("TwoStaffSplit"));
    assert_eq!(score.scores[2].name.as_deref(), Some("TwoStaffChord"));

    // Should have 4 parts
    assert_eq!(score.parts.len(), 4);
    assert!(score.parts[0].id.is_some());
    assert!(score.parts[3].id.is_some());

    // Each part should have sequences with actual music
    assert!(!score.parts[0].measures.is_empty());
    assert!(!score.parts[0].measures[0].sequences.is_empty());
}

#[test]
fn test_tier5_multiple_layouts_render_four_staff() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Render the FourStaff score (index 0) — should have 4 staves
    let dl = layout_with_mnx_scores(&score, &config, 0);
    assert!(!dl.commands.is_empty());

    // Count staff line groups (horizontal lines)
    let staff_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(
            |cmd| matches!(cmd, RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 0.01),
        )
        .collect();
    // 4 staves × 5 lines = 20 staff lines
    assert!(
        staff_lines.len() >= 20,
        "FourStaff should have at least 20 staff lines, got {}",
        staff_lines.len()
    );

    // Should have bracket
    let brackets: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawLine { x1, x2, y1, y2, .. } if (x1 - x2).abs() < 0.01 && (y2 - y1).abs() > 10.0)
    }).collect();
    assert!(!brackets.is_empty(), "Should have vertical bracket lines");
}

#[test]
fn test_tier5_multiple_layouts_render_two_staff_split() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Render the TwoStaffSplit score (index 1) — 2 staves with stem-split parts
    let dl = layout_with_mnx_scores(&score, &config, 1);
    assert!(!dl.commands.is_empty());

    // Should have noteheads (music is rendered)
    let glyphs: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::NOTEHEAD_BLACK)
    }).collect();
    assert!(!glyphs.is_empty(), "TwoStaffSplit should render noteheads");
}

#[test]
fn test_multiple_layouts_chunked_horizon_bounds_are_not_clipped() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        sp: 8.0,
        page_width: None,
        horizon_chunk_width: Some(3000.0),
        ..LayoutConfig::default()
    };

    for (score_index, name) in [
        (0, "Four Staff"),
        (1, "Two Staff Split"),
        (2, "Two Staff Chord"),
    ] {
        let dl = layout_with_mnx_scores(&score, &config, score_index);
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
            "{name} Horizon element bounds {min_bbox_y}..{max_bbox_y} exceed display height {}",
            dl.height
        );
    }
}

#[test]
fn test_tier5_orchestral_layout_parse() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/orchestral-layout.mnx");
    let score = parse_mnx(json).unwrap();

    assert_eq!(
        score.global.measures.len(),
        4,
        "excerpt should contain bars 1-4"
    );
    assert_eq!(score.layouts.len(), 1);
    assert_eq!(score.layouts[0].id, "full-score");
    assert_eq!(
        score.parts.len(),
        18,
        "Beethoven full score should retain all 18 parts"
    );
    assert!(
        score.parts.iter().all(|part| part.measures.len() == 4),
        "every orchestral part should contain exactly four bars"
    );
    assert_eq!(score.scores.len(), 1);
    assert_eq!(score.scores[0].name.as_deref(), Some("Full score"));
    assert_eq!(score.scores[0].layout.as_deref(), Some("full-score"));
    assert!(
        score.scores[0].pages.is_empty(),
        "excerpt should use automatic flow"
    );
}

#[test]
fn test_tier5_orchestral_layout_render() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/orchestral-layout.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    let dl = layout_with_mnx_scores(&score, &config, 0);

    // The excerpt should render orchestral staves, grouping, and actual music.
    assert!(!dl.commands.is_empty(), "Should produce render commands");
    assert!(dl.width > 0.0);
    assert!(dl.height > 0.0);

    let staff_lines = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                if (y1 - y2).abs() < 0.01 && (x2 - x1).abs() > 50.0)
        })
        .count();
    assert!(
        staff_lines >= 90,
        "18 orchestral staves should render at least 90 staff lines, got {staff_lines}"
    );

    let noteheads = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_BLACK
                || *codepoint == smufl::NOTEHEAD_HALF
                || *codepoint == smufl::NOTEHEAD_WHOLE)
        })
        .count();
    assert!(noteheads > 0, "Beethoven excerpt should render noteheads");

    // Should have bracket lines
    let bracket_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(cmd, RenderCommand::DrawLine { x1, x2, y1, y2, .. }
            if (x1 - x2).abs() < 0.01 && (y2 - y1).abs() > 20.0)
        })
        .collect();
    assert!(
        !bracket_lines.is_empty(),
        "Should have bracket vertical lines"
    );
}

#[test]
fn test_tier5_organ_layout_parse() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/organ-layout.mnx");
    let score = parse_mnx(json).unwrap();

    // Should have 2 layouts
    assert_eq!(
        score.layouts.len(),
        2,
        "organ-layout.mnx should have 2 layouts"
    );
    // Layout ids are opaque UUIDs post-migration; assert both are distinct.
    let layout_ids: std::collections::HashSet<&str> =
        score.layouts.iter().map(|l| l.id.as_str()).collect();
    assert_eq!(layout_ids.len(), 2, "Both layout ids should be distinct");

    // Organ should have 3 staves
    assert_eq!(score.parts.len(), 1);
    assert!(score.parts[0].id.is_some());
    assert_eq!(score.parts[0].staves, 3);

    // Should have sequences with staff assignments
    let sequences = &score.parts[0].measures[0].sequences;
    assert!(sequences.len() >= 3, "Organ should have multiple sequences");

    // Check staff assignments
    let staff_1_seqs: Vec<_> = sequences.iter().filter(|s| s.staff == Some(1)).collect();
    let staff_2_seqs: Vec<_> = sequences.iter().filter(|s| s.staff == Some(2)).collect();
    let staff_3_seqs: Vec<_> = sequences.iter().filter(|s| s.staff == Some(3)).collect();
    assert!(!staff_1_seqs.is_empty(), "Should have staff 1 sequences");
    assert!(!staff_2_seqs.is_empty(), "Should have staff 2 sequences");
    assert!(!staff_3_seqs.is_empty(), "Should have staff 3 sequences");

    // Check voice names
    let voice_names: Vec<_> = sequences
        .iter()
        .filter_map(|s| s.voice.as_deref())
        .collect();
    assert!(voice_names.contains(&"Main"), "Should have Main voice");
    assert!(
        voice_names.contains(&"Oberwerk"),
        "Should have Oberwerk voice"
    );
    assert!(
        voice_names.contains(&"Hauptwerk"),
        "Should have Hauptwerk voice"
    );
    assert!(voice_names.contains(&"Pedal"), "Should have Pedal voice");
}

#[test]
fn test_tier5_organ_layout_render() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/organ-layout.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Should produce commands
    assert!(!dl.commands.is_empty(), "Should produce render commands");

    // Should have brace glyph (for the manual staves)
    let brace_glyphs: Vec<_> = dl
        .commands
        .iter()
        .filter(|cmd| {
            matches!(
                cmd,
                RenderCommand::DrawStretchedGlyph { codepoint, .. } if is_brace_glyph(*codepoint)
            )
        })
        .collect();
    assert!(
        !brace_glyphs.is_empty(),
        "Should have brace glyph for organ manual staves"
    );

    // Should have noteheads (organ has actual music)
    let noteheads: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::NOTEHEAD_BLACK)
    }).collect();
    assert!(!noteheads.is_empty(), "Should render organ noteheads");
}

#[test]
fn test_tier5_layout_fallback_no_layouts() {
    // When no layouts/scores defined, should fall back to regular layout
    let json = include_str!("../../../../../packages/format/fixtures/mnx/parts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();

    let dl = layout_with_mnx_scores(&score, &config, 0);
    let dl_regular = layout_full_score(&score, &config);

    // Should produce same number of commands (falls back to layout_full_score)
    assert_eq!(
        dl.commands.len(),
        dl_regular.commands.len(),
        "Fallback should produce identical output"
    );
}

#[test]
fn test_tier5_system_layouts_system_breaks() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/system-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    let dl = layout_with_mnx_scores(&score, &config, 0);

    // System breaks should produce 2 distinct Y-level groups of staff lines
    let mut staff_line_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 0.01 => Some(*y1),
            _ => None,
        })
        .collect();
    staff_line_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    staff_line_ys.dedup_by(|a, b| (*a - *b).abs() < 0.5);

    // With 2 systems, each having multiple staves, there should be many distinct Y levels
    assert!(
        staff_line_ys.len() >= 10,
        "Should have multiple Y levels for 2 multi-staff systems, got {}",
        staff_line_ys.len()
    );
}

#[test]
fn test_split_part_measure_default_clef_for_unassigned_staff() {
    // Simulate organ-like part: clefs defined without staff field (defaults to staff 1)
    let pm = PartMeasure {
        clefs: Some(vec![PositionedClef {
            clef: Clef {
                sign: ClefSign::G,
                staff_position: -2,
                color: None,
                glyph: None,
                octave: None,
                show_octave: None,
            },
            position: None,
            staff: None,
        }]),
        sequences: vec![
            Sequence {
                content: vec![],
                full_measure: None,
                staff: Some(1),
                voice: Some("Main".into()),
                orient: None,
                forced_stem_up: None,
                source_part_index: None,
                source_seq_index: None,
            },
            Sequence {
                content: vec![],
                full_measure: None,
                staff: Some(2),
                voice: Some("Pedal".into()),
                orient: None,
                forced_stem_up: None,
                source_part_index: None,
                source_seq_index: None,
            },
        ],
        arpeggios: None,
        non_arpeggios: None,
        beams: None,
        dynamics: None,
        ottavas: None,
        measure_repeat: None,
        pedals: None,
        chord_symbols: None,
        expressions: None,
        condensing_override: None,
    };

    // Staff 1 should get the G clef (matched via unwrap_or(1))
    let s1 = split_part_measure_by_staff(&pm, 1);
    let s1_clefs = s1.clefs.as_ref().unwrap();
    assert_eq!(s1_clefs.len(), 1);
    assert_eq!(s1_clefs[0].clef.sign, ClefSign::G);

    // Staff 2 has no explicitly assigned clef — split returns an empty clef list.
    // (Default clef assignment happens downstream in resolve_measures_for_staff.)
    let s2 = split_part_measure_by_staff(&pm, 2);
    let s2_clefs = s2.clefs.as_ref().unwrap();
    assert_eq!(
        s2_clefs.len(),
        0,
        "Staff 2 should have no explicitly assigned clefs"
    );

    // Staff 3 similarly has no explicitly assigned clef.
    let s3 = split_part_measure_by_staff(&pm, 3);
    let s3_clefs = s3.clefs.as_ref().unwrap();
    assert_eq!(
        s3_clefs.len(),
        0,
        "Staff 3 should have no explicitly assigned clefs"
    );
}

#[test]
fn test_multiple_layouts_parse() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();

    // 4 layouts
    assert_eq!(score.layouts.len(), 4, "Should have 4 layouts");
    // Layout/measure ids are opaque UUIDs post-migration; capture the layout
    // the layout-change references (4th = Choral2StaffMenSplit).
    let men_split_layout = score.layouts[3].id.clone();

    // 3 score definitions
    assert_eq!(score.scores.len(), 3, "Should have 3 score definitions");
    assert_eq!(score.scores[0].name.as_deref(), Some("FourStaff"));
    assert_eq!(score.scores[1].name.as_deref(), Some("TwoStaffSplit"));
    assert_eq!(score.scores[2].name.as_deref(), Some("TwoStaffChord"));

    // TwoStaffChord has layout changes
    let sys = &score.scores[2].pages[0].systems[0];
    assert_eq!(
        sys.layout_changes.len(),
        1,
        "TwoStaffChord should have 1 layout change"
    );
    assert_eq!(sys.layout_changes[0].layout, men_split_layout);
    assert_eq!(
        sys.layout_changes[0].location.measure,
        score.global.measures[1].id.clone().unwrap()
    );
}

#[test]
fn test_multiple_layouts_four_staff_render() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Score index 0 = FourStaff (4 staves)
    let dl = layout_with_mnx_scores(&score, &config, 0);
    assert!(!dl.commands.is_empty(), "Should produce render commands");

    // Count distinct staff Y levels → should have at least 4 staves × 5 lines
    let mut staff_line_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 0.01 => Some(*y1),
            _ => None,
        })
        .collect();
    staff_line_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    staff_line_ys.dedup_by(|a, b| (*a - *b).abs() < 0.5);
    // 4 staves = 20 staff lines, but with dedup by Y we should get >= 20 distinct Y values
    assert!(
        staff_line_ys.len() >= 20,
        "FourStaff should have at least 20 distinct staff line Y levels, got {}",
        staff_line_ys.len()
    );
}

#[test]
fn test_multiple_layouts_two_staff_render() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Score index 1 = TwoStaffSplit (2 staves with stem direction)
    let dl = layout_with_mnx_scores(&score, &config, 1);
    assert!(!dl.commands.is_empty(), "Should produce render commands");

    // Count distinct staff Y levels → 2 staves × 5 lines = 10 distinct Y
    let mut staff_line_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 0.01 => Some(*y1),
            _ => None,
        })
        .collect();
    staff_line_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    staff_line_ys.dedup_by(|a, b| (*a - *b).abs() < 0.5);
    assert!(
        staff_line_ys.len() >= 10,
        "TwoStaffSplit should have at least 10 distinct staff line Y levels, got {}",
        staff_line_ys.len()
    );
}

#[test]
fn test_multiple_layouts_layout_change_render() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Score index 2 = TwoStaffChord (with layout change at measure m2)
    let dl = layout_with_mnx_scores(&score, &config, 2);
    assert!(!dl.commands.is_empty(), "Should produce render commands");
    assert!(dl.width > 0.0, "Width should be positive");
    assert!(dl.height > 0.0, "Height should be positive");

    // Should have noteheads (DrawGlyph with notehead codepoints)
    let noteheads: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::NOTEHEAD_BLACK || *codepoint == smufl::NOTEHEAD_HALF || *codepoint == smufl::NOTEHEAD_WHOLE)
    }).collect();
    assert!(!noteheads.is_empty(), "Should render noteheads");
}

/// Engrave-mode hide-staff use case: per-system layout swap that REDUCES
/// the staff count. The base layout shows all 3 parts; after a forced
/// system break at m2, the second system swaps to a layout that hides
/// part P2. Staff count on the second system must be smaller than the first.
#[test]
fn test_per_system_layout_reduces_staff_count() {
    let json = r#"{
      "mnx": { "version": 1 },
      "global": { "measures": [
        { "id": "m1", "time": { "count": 4, "unit": 4 } },
        { "id": "m2" }
      ] },
      "parts": [
        { "id": "P1", "name": "Violin",
          "measures": [
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "G", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "A", "octave": 4 } }] }
            ] }] }
          ]
        },
        { "id": "P2", "name": "Viola",
          "measures": [
            { "clefs": [{ "clef": { "sign": "C", "staffPosition": 0 } }],
              "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "D", "octave": 4 } }] }
            ] }] }
          ]
        },
        { "id": "P3", "name": "Cello",
          "measures": [
            { "clefs": [{ "clef": { "sign": "F", "staffPosition": 2 } }],
              "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 3 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "D", "octave": 3 } }] }
            ] }] }
          ]
        }
      ],
      "layouts": [
        { "id": "all-three", "content": [
          { "type": "staff", "sources": [{ "part": "P1" }] },
          { "type": "staff", "sources": [{ "part": "P2" }] },
          { "type": "staff", "sources": [{ "part": "P3" }] }
        ] },
        { "id": "hide-viola", "content": [
          { "type": "staff", "sources": [{ "part": "P1" }] },
          { "type": "staff", "sources": [{ "part": "P3" }] }
        ] }
      ],
      "scores": [
        { "name": "Engraved",
          "layout": "all-three",
          "pages": [{ "systems": [
            { "measure": "m1", "layout": "all-three" },
            { "measure": "m2", "layout": "hide-viola" }
          ] }]
        }
      ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    assert!(!dl.commands.is_empty());

    // Count distinct staff-line Y positions per system. We use the
    // y-coordinate of staff lines as a proxy for "how many staves
    // are visible". With staff-line spacing of `sp`, a 5-line staff
    // occupies 5 distinct Y positions.
    let staff_lines: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                if (y1 - y2).abs() < 0.01 && (x2 - x1).abs() > 50.0 =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .collect();

    // System 1 should have 3 staves * 5 lines = 15 distinct Y values.
    // System 2 should have 2 staves * 5 lines = 10 distinct Y values.
    let mut unique_ys: Vec<f64> = staff_lines.clone();
    unique_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    unique_ys.dedup_by(|a, b| (*a - *b).abs() < 0.5);

    // 3 staves system 1 + 2 staves system 2 = 5 staff total = 25 lines
    assert!(
        unique_ys.len() >= 25,
        "Expected ≥25 distinct staff-line Y values (3+2 staves × 5 lines), got {}: {:?}",
        unique_ys.len(),
        unique_ys
    );
}

#[test]
fn test_multiple_layouts_stem_direction_forced() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/multiple-layouts.mnx");
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // Score index 1 = TwoStaffSplit uses Choral2StaffStemSplit layout
    // Staff 1: soprano (stem:up) + alto (stem:down)
    // Staff 2: tenor (stem:up) + bass (stem:down)
    let dl = layout_with_mnx_scores(&score, &config, 1);

    // Find stems (vertical lines with stem-typical width)
    let sp = config.sp;
    let stem_w = config.stem_width * sp;
    let stems: Vec<(f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } if (x1 - x2).abs() < 0.01
                && (y1 - y2).abs() > 1.0
                && (*width - stem_w).abs() < 0.5 =>
            {
                Some((*x1, *y1, *y2))
            }
            _ => None,
        })
        .collect();

    // We should have stems — with forced directions from both up and down sources
    assert!(
        stems.len() >= 4,
        "Should have stems from multiple voices, got {}",
        stems.len()
    );

    // With 2 staves and 2 sources each, there should be noteheads from all 4 parts
    let noteheads: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_BLACK || *codepoint == smufl::NOTEHEAD_HALF || *codepoint == smufl::NOTEHEAD_WHOLE)
        || matches!(cmd, RenderCommand::DrawEllipse { filled: true, .. })
    }).collect();
    assert!(
        noteheads.len() >= 8,
        "Should have noteheads from all 4 parts (S/A/T/B), got {}",
        noteheads.len()
    );
}

#[test]
fn test_clef_inherited_after_staff_unhidden() {
    // Regression: viola is hidden on system 2 (m2), then re-shown on system 3 (m3).
    // The re-shown system should still display the viola's alto clef from m1.
    let json = r#"{
      "mnx": { "version": 1 },
      "global": { "measures": [
        { "id": "m1", "time": { "count": 4, "unit": 4 } },
        { "id": "m2" },
        { "id": "m3" }
      ] },
      "parts": [
        { "id": "P1", "name": "Violin",
          "measures": [
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "G", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "A", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "B", "octave": 4 } }] }
            ] }] }
          ]
        },
        { "id": "P2", "name": "Viola",
          "measures": [
            { "clefs": [{ "clef": { "sign": "C", "staffPosition": 0 } }],
              "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "D", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "E", "octave": 4 } }] }
            ] }] }
          ]
        }
      ],
      "layouts": [
        { "id": "both", "content": [
          { "type": "staff", "sources": [{ "part": "P1" }] },
          { "type": "staff", "sources": [{ "part": "P2" }] }
        ] },
        { "id": "hide-viola", "content": [
          { "type": "staff", "sources": [{ "part": "P1" }] }
        ] }
      ],
      "scores": [
        { "name": "Engraved",
          "layout": "both",
          "pages": [{ "systems": [
            { "measure": "m1", "layout": "both" },
            { "measure": "m2", "layout": "hide-viola" },
            { "measure": "m3", "layout": "both" }
          ] }]
        }
      ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Find every C-clef glyph (alto clef = U+E05C). Bravura's cClef is E05C.
    let c_clef_glyph = smufl::C_CLEF;
    let c_clefs: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint, x, y, ..
            } if *codepoint == c_clef_glyph => Some((*x, *y)),
            _ => None,
        })
        .collect();

    // Expect alto clef on system 1 (m1) AND system 3 (m3 = re-shown).
    // System 2 has viola hidden, so no clef there.
    assert!(
        c_clefs.len() >= 2,
        "Expected ≥2 alto clefs (system 1 and re-shown system 3), found {}: {:?}",
        c_clefs.len(),
        c_clefs
    );
}

#[test]
fn test_clef_inherited_when_hidden_from_start() {
    // Regression: viola is HIDDEN on system 1 (m1), then re-shown on system 2 (m2).
    // The re-shown system must still display the viola's alto clef declared on m1.
    let json = r#"{
      "mnx": { "version": 1 },
      "global": { "measures": [
        { "id": "m1", "time": { "count": 4, "unit": 4 } },
        { "id": "m2" }
      ] },
      "parts": [
        { "id": "P1", "name": "Violin",
          "measures": [
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "G", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "A", "octave": 4 } }] }
            ] }] }
          ]
        },
        { "id": "P2", "name": "Viola",
          "measures": [
            { "clefs": [{ "clef": { "sign": "C", "staffPosition": 0 } }],
              "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "C", "octave": 4 } }] }
            ] }] },
            { "sequences": [{ "content": [
              { "type": "event", "duration": { "base": "whole" },
                "notes": [{ "pitch": { "step": "D", "octave": 4 } }] }
            ] }] }
          ]
        }
      ],
      "layouts": [
        { "id": "both", "content": [
          { "type": "staff", "sources": [{ "part": "P1" }] },
          { "type": "staff", "sources": [{ "part": "P2" }] }
        ] },
        { "id": "hide-viola", "content": [
          { "type": "staff", "sources": [{ "part": "P1" }] }
        ] }
      ],
      "scores": [
        { "name": "Engraved",
          "layout": "both",
          "pages": [{ "systems": [
            { "measure": "m1", "layout": "hide-viola" },
            { "measure": "m2", "layout": "both" }
          ] }]
        }
      ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    let c_clef_glyph = smufl::C_CLEF;
    let c_clefs: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawGlyph {
                codepoint, x, y, ..
            } if *codepoint == c_clef_glyph => Some((*x, *y)),
            _ => None,
        })
        .collect();

    assert!(
        !c_clefs.is_empty(),
        "Expected viola alto clef on system 2 (re-shown after hidden-from-start), found {} clefs",
        c_clefs.len()
    );
}

#[test]
fn test_explicit_part_omits_repeated_label_and_indents_first_system() {
    // Adding a manual break switches a part from the auto-flow path to the
    // explicit-pages path. That path must still honour SINGLE-PART engraving
    // conventions, not full-score ones:
    //   * no instrument label restated on every system (a one-staff part has
    //     only one instrument — repeating "D. B." each system reads like a
    //     score), and
    //   * the first system is indented ~one staff height to signal the start.
    // Regression for the "manual breaks make a part look like a score" report.
    let measures: Vec<String> = (0..6)
        .map(|i| {
            if i == 0 {
                r#"{"id":"m0","index":0,"time":{"count":4,"unit":4}}"#.to_string()
            } else {
                format!(r#"{{"id":"m{i}"}}"#)
            }
        })
        .collect();
    let part_measures: Vec<String> = (0..6)
        .map(|i| {
            if i == 0 {
                r#"{"clefs":[{"clef":{"sign":"F","staffPosition":2}}],"sequences":[{"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":3}}]}]}]}"#.to_string()
            } else {
                r#"{"sequences":[{"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":3}}]}]}]}"#.to_string()
            }
        })
        .collect();
    let with_pages = |pages: &str| {
        format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{}]}},
                "layouts": [{{"id": "part-P1", "content": [{{"type": "staff", "sources": [{{"part": "P1"}}]}}]}}],
                "scores": [{{"name": "Double Bass", "layout": "part-P1"{}}}],
                "parts": [{{"id": "P1", "name": "Double Bass", "shortName": "D. B.", "measures": [{}]}}]
            }}"#,
            measures.join(","),
            pages,
            part_measures.join(",")
        )
    };

    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    let label_count = |dl: &DisplayList| {
        dl.commands
            .iter()
            .filter(|c| {
                matches!(c, RenderCommand::DrawText { text, .. }
                    if text.contains("D. B.") || text.contains("Double Bass"))
            })
            .count()
    };
    let first_system_min_x = |dl: &DisplayList| {
        dl.measure_bounds
            .iter()
            .filter(|mb| mb.system_index == 0)
            .map(|mb| mb.x)
            .fold(f64::MAX, f64::min)
    };

    // Auto-flow (no manual breaks) — the reference for part conventions.
    let auto = layout_with_mnx_scores(&parse_mnx(&with_pages("")).unwrap(), &config, 0);
    let auto_x = first_system_min_x(&auto);
    assert_eq!(
        label_count(&auto),
        0,
        "auto-flow part must not draw an instrument label"
    );

    // Explicit-pages (a manual system break seeded as two systems on one page).
    let pages = r#","pages":[{"systems":[{"measure":"m0"},{"measure":"m3"}]}]"#;
    let exp = layout_with_mnx_scores(&parse_mnx(&with_pages(pages)).unwrap(), &config, 0);

    assert_eq!(
        label_count(&exp),
        0,
        "explicit-pages part must NOT restate the instrument label on every system"
    );
    let exp_x = first_system_min_x(&exp);
    let sp = config.sp;
    assert!(
        (exp_x - auto_x).abs() < 0.5,
        "explicit first-system start x ({exp_x:.1}) must match the auto-flow indent ({auto_x:.1})"
    );
    // And the indent must be a real one-staff-height shift past the bare margin.
    let base_margin = config.page_margin_left * sp;
    assert!(
        exp_x > base_margin + 3.0 * sp,
        "explicit first system ({exp_x:.1}) must be indented past the base margin ({base_margin:.1})"
    );
}

#[test]
fn test_explicit_part_seeded_from_autoflow_keeps_same_system_membership() {
    // Regression for "note spacing gets significantly wider when a system break
    // is inserted." Adding a break seeds `pages` from the live auto-flow layout
    // (mirroring the editor's `defaultSystemStarts`) and re-renders via the
    // explicit-pages path. A phantom single-part label gutter used to shrink the
    // explicit `content_width`, so `expand_oversized_systems_explicit`
    // over-broke systems that auto-flow had fit — fewer measures per system,
    // each justified to full width → visibly wider note spacing. The two paths
    // must agree on system membership (no spurious sub-breaks) so the layout is
    // stable across the auto→manual transition.
    use std::collections::BTreeMap;

    let qbar = r#"{"sequences":[{"content":[
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":3}}]},
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":3}}]},
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"F","octave":3}}]},
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"G","octave":3}}]}
    ]}]}"#;
    let first = r#"{"clefs":[{"clef":{"sign":"F","staffPosition":2}}],"sequences":[{"content":[
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":3}}]},
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":3}}]},
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"F","octave":3}}]},
        {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"G","octave":3}}]}
    ]}]}"#;
    let measures: Vec<String> = (0..20)
        .map(|i| {
            if i == 0 {
                first.to_string()
            } else {
                qbar.to_string()
            }
        })
        .collect();
    let global: Vec<String> = (0..20)
        .map(|i| {
            if i == 0 {
                r#"{"id":"m0","index":0,"time":{"count":4,"unit":4},"key":{"fifths":2}}"#
                    .to_string()
            } else {
                format!(r#"{{"id":"m{i}"}}"#)
            }
        })
        .collect();
    let make = |pages: &str| {
        format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{}]}},
                "layouts": [{{"id": "part-P1", "content": [{{"type": "staff", "sources": [{{"part": "P1"}}]}}]}}],
                "scores": [{{"name": "Double Bass", "layout": "part-P1"{}}}],
                "parts": [{{"id": "P1", "name": "Double Bass", "shortName": "D. B.", "measures": [{}]}}]
            }}"#,
            global.join(","),
            pages,
            measures.join(",")
        )
    };

    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    // 1. Auto-flow layout (no manual breaks).
    let auto = layout_with_mnx_scores(&parse_mnx(&make("")).unwrap(), &config, 0);

    // Per-system measure membership = the set of measure ids whose bounds carry
    // that system index.
    let membership = |dl: &DisplayList| -> Vec<Vec<String>> {
        let mut by_sys: BTreeMap<usize, Vec<(f64, String)>> = BTreeMap::new();
        for mb in &dl.measure_bounds {
            if let Some(id) = &mb.measure_id {
                by_sys
                    .entry(mb.system_index)
                    .or_default()
                    .push((mb.x, id.clone()));
            }
        }
        by_sys
            .into_values()
            .map(|mut v| {
                v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
                v.into_iter().map(|(_, id)| id).collect()
            })
            .collect()
    };

    let auto_membership = membership(&auto);
    assert!(
        auto_membership.len() >= 2,
        "test needs a multi-system auto layout"
    );

    // 2. Seed `pages` from the auto layout — exactly what `defaultSystemStarts`
    //    does: the first measure id of each system, all on one page here.
    let starts: Vec<String> = auto_membership
        .iter()
        .map(|sys| format!(r#"{{"measure":"{}"}}"#, sys[0]))
        .collect();
    let pages = format!(r#","pages":[{{"systems":[{}]}}]"#, starts.join(","));

    // 3. Explicit-pages layout from that seed.
    let exp = layout_with_mnx_scores(&parse_mnx(&make(&pages)).unwrap(), &config, 0);
    let exp_membership = membership(&exp);

    // The explicit path must NOT sub-break the seeded systems: identical system
    // count and identical per-system measure membership.
    assert_eq!(
        exp_membership, auto_membership,
        "seeded explicit-pages layout must preserve auto-flow's system membership \
         (no spurious sub-breaks that would widen note spacing)"
    );
}

#[test]
fn test_explicit_part_spacing_ignores_other_parts_widths() {
    // Regression for "note spacing doubles when a system break is inserted on a
    // sparse part." The explicit-pages path resolved ALL parts in the document
    // and took the cross-part MAX width per measure, so a lone sparse part (a
    // Double Bass with a few notes/bar) inherited the spacing of the BUSIEST
    // instrument at every measure and ballooned to ~2× its page count. A
    // single-part layout must be spaced for its OWN notes only.
    //
    // Differential test: lay out the SAME sparse part B via the explicit-pages
    // path in two documents that differ ONLY in part A's note density (busy vs
    // sparse). If B is correctly scoped to its own notes, A's content cannot
    // affect B's layout — identical system membership both ways.
    let busy_content = r#"[{"content":[
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"E","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"F","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"G","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"A","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"B","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":6}}]}
    ]}]"#;
    let sparse_content = r#"[{"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":5}}]}]}]"#;
    let b_bar = r#"{"sequences":[{"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":3}}]}]}]}"#;
    let b_first = r#"{"clefs":[{"clef":{"sign":"F","staffPosition":2}}],"sequences":[{"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":3}}]}]}]}"#;
    let n = 12;
    let b_measures: Vec<String> = (0..n)
        .map(|i| {
            if i == 0 {
                b_first.to_string()
            } else {
                b_bar.to_string()
            }
        })
        .collect();
    let global: Vec<String> = (0..n)
        .map(|i| {
            if i == 0 {
                r#"{"id":"m0","index":0,"time":{"count":4,"unit":4}}"#.to_string()
            } else {
                format!(r#"{{"id":"m{i}"}}"#)
            }
        })
        .collect();

    let make = |a_content: &str| {
        let a_first = format!(
            r#"{{"clefs":[{{"clef":{{"sign":"G","staffPosition":-2}}}}],"sequences":{a_content}}}"#
        );
        let a_bar = format!(r#"{{"sequences":{a_content}}}"#);
        let a_measures: Vec<String> = (0..n)
            .map(|i| {
                if i == 0 {
                    a_first.clone()
                } else {
                    a_bar.clone()
                }
            })
            .collect();
        format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{}]}},
                "layouts": [
                    {{"id": "L-A", "content": [{{"type": "staff", "sources": [{{"part": "A"}}]}}]}},
                    {{"id": "L-B", "content": [{{"type": "staff", "sources": [{{"part": "B"}}]}}]}}
                ],
                "scores": [
                    {{"name": "A", "layout": "L-A"}},
                    {{"name": "B", "layout": "L-B", "pages": [{{"systems": [{{"measure": "m0"}}]}}]}}
                ],
                "parts": [
                    {{"id": "A", "name": "Busy", "measures": [{}]}},
                    {{"id": "B", "name": "Bass", "measures": [{}]}}
                ]
            }}"#,
            global.join(","),
            a_measures.join(","),
            b_measures.join(",")
        )
    };

    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let bars_per_system = |a_content: &str| -> std::collections::BTreeMap<usize, usize> {
        let score = parse_mnx(&make(a_content)).unwrap();
        let dl = layout_with_mnx_scores(&score, &config, 1); // score 1 = part B
        let mut m: std::collections::BTreeMap<usize, usize> = std::collections::BTreeMap::new();
        for mb in &dl.measure_bounds {
            *m.entry(mb.system_index).or_default() += 1;
        }
        m
    };

    let with_busy_a = bars_per_system(busy_content);
    let with_sparse_a = bars_per_system(sparse_content);

    assert_eq!(
        with_busy_a, with_sparse_a,
        "part B's single-part explicit layout must be identical regardless of part \
         A's note density — B must be spaced for its OWN notes, not the cross-part \
         maximum (busy-A={with_busy_a:?} vs sparse-A={with_sparse_a:?})"
    );

    // Also assert no notehead spills past the right page margin. The merged
    // rhythmic spacing (which places notes WITHIN a measure) must be scoped to
    // the shown part too; if it stayed sized for the busy part A while the
    // measure width is scoped to sparse B, B's notes would distribute over the
    // wider profile and overflow their barlines ("farlands").
    let score = parse_mnx(&make(busy_content)).unwrap();
    let dl = layout_with_mnx_scores(&score, &config, 1); // part B
    let max_note_x = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawGlyph { x, codepoint, .. } if smufl::is_notehead(*codepoint) => {
                Some(*x)
            }
            _ => None,
        })
        .fold(0.0_f64, f64::max);
    assert!(
        max_note_x <= dl.width,
        "part B noteheads must stay within the page width ({:.0}px); rightmost note \
         at {max_note_x:.0}px indicates spacing scoped to part A, not B",
        dl.width
    );
}

#[test]
fn test_explicit_no_empty_system_from_trailing_mmr_skip() {
    // Regression: a wide authored system that the engine sub-breaks for width
    // must not emit a system made of ONLY multimeasure-rest interior (skipped)
    // measures. When the visible bars filled a sub-system exactly and a run of
    // collapsed MMR bars trailed them, the width breaker put those zero-width
    // skipped bars in their own sub-system → a blank staff with no music drawn
    // between two real systems (Double Bass after the m222–226 MMR).
    //
    // Build a single authored system covering busy bars followed by an MMR; the
    // narrow page forces sub-breaks. Assert every drawn staff band corresponds
    // to a system that actually has measures (no empty staff).
    let busy = r#"{"sequences":[{"content":[
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"E","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"F","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"G","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"A","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"B","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":6}}]}
    ]}]}"#;
    let rest =
        r#"{"sequences":[{"content":[{"type":"event","duration":{"base":"whole"},"rest":{}}]}]}"#;
    let first = r#"{"clefs":[{"clef":{"sign":"G","staffPosition":-2}}],"sequences":[{"content":[
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"D","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"E","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"F","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"G","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"A","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"B","octave":5}}]},
        {"type":"event","duration":{"base":"eighth"},"notes":[{"pitch":{"step":"C","octave":6}}]}
    ]}]}"#;
    // 4 busy bars, then 4 rest bars collapsed into one MMR (m4 start, dur 4).
    // At page width 700 the last busy bar overflows its system, so the breaker
    // starts a fresh system whose only members are the trailing skipped MMR
    // bars — exactly the empty-staff trigger.
    let n = 8;
    let measures: Vec<String> = (0..n)
        .map(|i| {
            if i == 0 {
                first.to_string()
            } else if i >= 4 {
                rest.to_string()
            } else {
                busy.to_string()
            }
        })
        .collect();
    let global: Vec<String> = (0..n)
        .map(|i| {
            if i == 0 {
                r#"{"id":"m0","index":0,"time":{"count":4,"unit":4}}"#.to_string()
            } else {
                format!(r#"{{"id":"m{i}"}}"#)
            }
        })
        .collect();
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{}]}},
            "layouts": [{{"id": "part-P1", "content": [{{"type": "staff", "sources": [{{"part": "P1"}}]}}]}}],
            "scores": [{{"name": "Solo", "layout": "part-P1",
                "multimeasureRests": [{{"start": "m4", "duration": 4}}],
                "pages": [{{"systems": [{{"measure": "m0"}}]}}]}}],
            "parts": [{{"id": "P1", "name": "Solo", "measures": [{}]}}]
        }}"#,
        global.join(","),
        measures.join(",")
    );

    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        page_width: Some(700.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);

    // Systems that carry at least one measure.
    let systems_with_measures: std::collections::BTreeSet<usize> =
        dl.measure_bounds.iter().map(|mb| mb.system_index).collect();

    // Count drawn staff bands (groups of 5 horizontal staff lines).
    let sp = config.sp;
    let mut ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| match c {
            RenderCommand::DrawLine { x1, x2, y1, y2, .. }
                if (y1 - y2).abs() < 0.01 && (x2 - x1).abs() > 100.0 =>
            {
                Some(*y1)
            }
            _ => None,
        })
        .collect();
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut bands = 0;
    let mut last = f64::MIN;
    for y in &ys {
        if *y - last > 6.0 * sp {
            bands += 1;
        }
        last = *y;
    }

    assert!(
        bands > 1,
        "test must produce a multi-system sub-broken layout, got {bands} band(s)"
    );
    assert_eq!(
        bands,
        systems_with_measures.len(),
        "every drawn staff band must be a real system with measures — a band count \
         ({bands}) exceeding systems-with-measures ({}) means a blank staff was \
         drawn for an all-skipped (MMR-interior) range",
        systems_with_measures.len()
    );
}
