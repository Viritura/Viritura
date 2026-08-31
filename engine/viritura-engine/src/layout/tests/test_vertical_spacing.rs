// Tests for vertical spacing: below/above-staff extras, protrusion measurement,
// and system Y positioning with content-aware heights.

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::page::*;
use crate::parse::parse_mnx;
use crate::render::*;

// ═══════════════════════════════════════════
// lowest_point_in_measure / highest_point_in_measure
// ═══════════════════════════════════════════

/// Notes on ledger lines below the bass clef staff should produce a lowest
/// point well below the staff bottom (4sp).
#[test]
fn test_lowest_point_low_notes_push_below_staff() {
    // Bass clef, very low note (C2) — several ledger lines below
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "F", "staffPosition": 2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 2}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    // The notehead for C2 in bass clef is far below the staff.
    // Find the notehead glyph and verify its Y is well below staff bottom.
    let noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if *codepoint == crate::render::smufl::smufl::NOTEHEAD_WHOLE {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    assert!(!noteheads.is_empty(), "Should have a whole notehead");
    assert!(
        noteheads[0] > staff_bottom + sp,
        "C2 in bass clef should be well below staff bottom: notehead_y={:.1}, staff_bottom={:.1}",
        noteheads[0],
        staff_bottom
    );
}

/// Notes on ledger lines above the treble clef staff should produce a highest
/// point above staff_y.
#[test]
fn test_highest_point_high_notes_push_above_staff() {
    // Treble clef, very high note (C7) — several ledger lines above
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 7}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;

    let noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if *codepoint == crate::render::smufl::smufl::NOTEHEAD_WHOLE {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    assert!(!noteheads.is_empty(), "Should have a whole notehead");
    assert!(
        noteheads[0] < staff_y - 2.0 * sp,
        "C7 in treble clef should be well above staff top: notehead_y={:.1}, staff_y={:.1}",
        noteheads[0],
        staff_y
    );
}

/// Notes within the staff should not extend the lowest/highest points beyond
/// the standard staff bounds.
#[test]
fn test_on_staff_notes_no_protrusion() {
    // B4 in treble clef — middle line, no protrusion
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let sp = config.sp;
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;

    let noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if *codepoint == crate::render::smufl::smufl::NOTEHEAD_WHOLE {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    assert!(!noteheads.is_empty());
    assert!(
        noteheads[0] >= staff_y && noteheads[0] <= staff_bottom,
        "B4 notehead should be within staff bounds: y={:.1}, staff=[{:.1}, {:.1}]",
        noteheads[0],
        staff_y,
        staff_bottom
    );
}

// ═══════════════════════════════════════════
// compute_below_staff_extra_from_layouts
// ═══════════════════════════════════════════

/// A score with dynamics should have below-staff extra of at least 4.5sp.
#[test]
fn test_below_staff_extra_with_dynamics() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
             "dynamics": [{"type": "immediate", "value": "ff", "position": {"fraction": [0, 1]}}],
             "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;

    // Use a page-mode config to get multi-system layout
    let dl = layout_score(&score, 0, &config);

    // Dynamics glyph should appear below the staff
    let dyn_glyphs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                if (0xE520..=0xE54F).contains(codepoint) {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    assert!(!dyn_glyphs.is_empty(), "Should have dynamics glyphs");
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    for &y in &dyn_glyphs {
        assert!(
            y > staff_bottom,
            "Dynamics should be below staff: y={:.1}, bottom={:.1}",
            y,
            staff_bottom
        );
    }
}

/// A score with lyrics should have below-staff extra of at least 5.0sp.
#[test]
fn test_below_staff_extra_with_lyrics() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "lyrics": {"lines": {"1": {"text": "Hel-", "syllabic": "begin"}}}},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}],
                 "lyrics": {"lines": {"1": {"text": "lo", "syllabic": "end"}}}},
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Lyric text should appear below the staff
    let lyric_texts: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText { y, text, font, .. } = cmd {
                if font.contains("serif") && (text == "Hel" || text == "lo" || text == "Hel-") {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    let staff_y = config.margin_top * sp;
    let staff_bottom = staff_y + 4.0 * sp;
    for &y in &lyric_texts {
        assert!(
            y > staff_bottom,
            "Lyrics should be below staff: y={:.1}, bottom={:.1}",
            y,
            staff_bottom
        );
    }
}

/// A score with no dynamics/lyrics/pedals and on-staff notes should have
/// zero below-staff extra.
#[test]
fn test_below_staff_extra_none_for_plain_score() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Staff lines: the first system should have standard height (just the staff)
    let staff_lines: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, .. } = cmd {
                if (y1 - y2).abs() < 0.01 {
                    return Some(*y1);
                }
            }
            None
        })
        .collect();
    assert!(staff_lines.len() >= 5, "Should have at least 5 staff lines");
}

// ═══════════════════════════════════════════
// compute_above_staff_extra
// ═══════════════════════════════════════════

/// A score with tempo markings should produce above-staff extra for tempo text.
#[test]
fn test_above_staff_extra_with_tempo() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "tempos": [{"bpm": 120, "value": {"base": "quarter"}}]
        }]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);
    let staff_y = config.margin_top * sp;

    // Tempo text should appear above the staff
    let tempo_texts: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText { y, text, .. } = cmd {
                if text.contains("120") || text.contains("= ") {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    // Tempo glyphs (metronome note) should also be above the staff
    let tempo_glyphs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { y, codepoint, .. } = cmd {
                // U+E1D5 = metNoteQuarterUp
                if *codepoint == 0xE1D5 {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    let has_tempo_above = tempo_texts
        .iter()
        .chain(tempo_glyphs.iter())
        .any(|&y| y < staff_y);
    assert!(has_tempo_above, "Tempo marking should be above the staff");
}

/// A tempo at the system start, over a multimeasure rest, must reserve only the
/// space it actually uses — NOT extra headroom for the MMR count number, which
/// is centred far from the tempo's x-span. Before the x-aware reservation fix,
/// `compute_above_staff_extra` used a single per-system obstacle scalar (the
/// tallest obstacle anywhere, including the centred MMR number), so the tempo
/// was reserved ~3sp too high and — once the frame pins the bbox top to the
/// page margin — left a visible gap above the tempo ink.
#[test]
fn test_tempo_over_mmr_reserves_tightly() {
    // 8 empty bars (whole rests) → one multimeasure rest with a centred "8",
    // plus a tempo on the first bar. The tempo sits at the system start; the
    // "8" is centred over the MMR, well clear of the tempo's x-span.
    let globals = std::iter::once(
        r#"{"time": {"count": 4, "unit": 4}, "tempos": [{"bpm": 120, "value": {"base": "quarter"}}]}"#,
    )
    .chain(std::iter::repeat_n(r#"{"time": {"count": 4, "unit": 4}}"#, 7))
    .collect::<Vec<_>>()
    .join(",");
    let measures = std::iter::repeat_n(
        r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]}"#,
        8,
    )
    .collect::<Vec<_>>()
    .join(",");
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{globals}]}},
            "parts": [{{"measures": [{measures}]}}]
        }}"#
    );
    let score = parse_mnx(&json).unwrap();
    let config = LayoutConfig {
        multimeasure_rests: true,
        ..LayoutConfig::default()
    };
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);
    let staff_y = config.margin_top * sp;

    // The topmost tempo ink (text top or glyph top), measured above the staff.
    let mut tempo_top_above: f64 = 0.0;
    for cmd in &dl.commands {
        match cmd {
            RenderCommand::DrawText { y, size, text, .. }
                if text.contains("120") || text.contains("= ") =>
            {
                tempo_top_above = tempo_top_above.max(staff_y - (*y - *size * 0.5));
            }
            RenderCommand::DrawGlyph {
                y, size, codepoint, ..
            } if *codepoint == 0xE1D5 => {
                tempo_top_above = tempo_top_above.max(staff_y - (*y - *size * 0.5));
            }
            _ => {}
        }
    }
    assert!(tempo_top_above > 0.0, "tempo should render above the staff");
    // Tight: the tempo sits at its minimum height (~3.7sp), NOT lifted over the
    // centred MMR number (which would push it to ~6sp+). 5sp is a generous
    // ceiling that the pre-fix global-obstacle reservation blew past.
    assert!(
        tempo_top_above < 5.0 * sp,
        "tempo over MMR should reserve tightly, got {:.1}sp above staff",
        tempo_top_above / sp
    );
}

/// A score with a rehearsal mark should produce above-staff extra.
#[test]
fn test_above_staff_extra_with_rehearsal_mark() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"rehearsalMark": {"text": "A"}}}
        }]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);
    let staff_y = config.margin_top * sp;

    // Rehearsal mark text "A" should be above the staff
    let mark_texts: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText { y, text, font, .. } = cmd {
                if text == "A" && font.contains("bold") {
                    return Some(*y);
                }
            }
            None
        })
        .collect();
    assert!(!mark_texts.is_empty(), "Should have rehearsal mark text");
    assert!(
        mark_texts[0] < staff_y,
        "Rehearsal mark should be above staff: y={:.1}, staff_y={:.1}",
        mark_texts[0],
        staff_y
    );
}

// ═══════════════════════════════════════════
// compute_system_y_positions with content heights
// ═══════════════════════════════════════════

/// When system_content_heights is Some, systems with larger content should
/// get more Y space allocated than the default staff height.
#[test]
fn test_system_y_positions_with_content_heights() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let _margin_top = config.page_margin_top * sp;

    let staves_per_system = vec![1_usize; 3];
    let content_heights = vec![staff_h + 5.0 * sp, staff_h, staff_h]; // first system taller
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1, 2],
        y_offset: 0.0,
        height: config.page_height * sp,
    }];

    let (positions_with, _, _) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );
    let (positions_without, _, _) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        None,
        None,
        None,
    );

    // With content heights, system 1 should be pushed further down
    // because system 0 is taller (staff_h + 5sp vs just staff_h)
    assert!(
        positions_with[1] > positions_without[1],
        "System 1 should be further down with taller system 0: with={:.1}, without={:.1}",
        positions_with[1],
        positions_without[1]
    );

    // With vertical centering, the taller content shifts system 0 *up*
    // slightly (less leftover to distribute), so positions_with[0] < positions_without[0].
    assert!(
        positions_with[0] <= positions_without[0] + 0.01,
        "Taller content should not push system 0 lower: with={:.1}, without={:.1}",
        positions_with[0],
        positions_without[0]
    );
}

/// When content heights are None, compute_system_y_positions should fall back
/// to computing from staves_per_system and staff_height.
#[test]
fn test_system_y_positions_none_fallback_matches_default() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;
    let margin_top = config.page_margin_top * sp;

    let staves_per_system = vec![1_usize; 2];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1],
        y_offset: 0.0,
        height: config.page_height * sp,
    }];

    let (positions_none, _gaps_none, _clearances_none) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        None,
        None,
        None,
    );

    // The None path derives each system's height from staves_per_system and
    // staff_height. Passing the equivalent explicit content heights must
    // produce identical positions.
    let content_heights = vec![staff_h; 2];
    let (positions_explicit, _gaps_explicit, _clearances_explicit) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );

    let expected_y0 = margin_top;
    assert!((positions_none[0] - expected_y0).abs() < 0.01);
    assert!((positions_none[1] - positions_explicit[1]).abs() < 0.01);
    let _ = default_gap;
}

/// When pages are sufficiently full with content heights, leftover space
/// should be distributed so systems span from top margin toward bottom margin.
#[test]
fn test_system_y_positions_justified_with_content_heights() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let margin_top = config.page_margin_top * sp;
    let margin_bottom = config.page_margin_bottom * sp;
    let page_h = config.page_height * sp;
    let usable = page_h - margin_top - margin_bottom;
    let default_gap = 7.0 * sp;

    // Create content heights that fill >65% of the page
    let content_h = usable * 0.15; // each system ~480px
    let content_heights = vec![content_h; 5];
    let staves_per_system = vec![1_usize; 5];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1, 2, 3, 4],
        y_offset: 0.0,
        height: page_h,
    }];

    let (positions, _gaps, _clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );

    // Single-staff systems: returned `gaps` are intra-staff (no effect, since
    // there are no intra gaps). Check that the systems span the page using
    // justified inter-system spacing.
    let last_bottom = positions[4] + content_h;
    let bottom_target = margin_top + usable;
    assert!(
        (last_bottom - bottom_target).abs() < 0.01,
        "Last system bottom should reach near page bottom margin: {:.1} vs {:.1}",
        last_bottom,
        bottom_target,
    );

    // Inter-system gaps should be uniform and >= default
    let g0 = positions[1] - (positions[0] + content_h);
    let g1 = positions[2] - (positions[1] + content_h);
    assert!(
        (g0 - g1).abs() < 0.01,
        "Inter-system gaps should be uniform: {:.1} vs {:.1}",
        g0,
        g1
    );
    assert!(
        g0 >= default_gap,
        "Justified inter-system gap should be >= default"
    );

    // All positions monotonically increasing
    for i in 1..positions.len() {
        assert!(positions[i] > positions[i - 1]);
    }
}

// ═══════════════════════════════════════════
// Integration: multi-system vertical spacing
// ═══════════════════════════════════════════

/// A page-mode score with many measures should produce multiple systems
/// with monotonically increasing Y positions.
#[test]
fn test_multi_system_spacing_monotonic() {
    // 8 measures in page mode → will break into multiple systems
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {},
            {},
            {},
            {},
            {},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 6}}]}]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(100.0), // force page mode with narrow width → many systems
        ..Default::default()
    };
    let dl = layout_score(&score, 0, &config);

    // Collect all staff line Y positions (every 5 lines is a staff)
    let staff_line_ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawLine { y1, y2, .. } = cmd {
                if (y1 - y2).abs() < 0.01 {
                    return Some(*y1);
                }
            }
            None
        })
        .collect();

    // Group staff lines into systems: lines within 4sp belong to same staff
    let sp = config.sp;
    let mut system_tops: Vec<f64> = Vec::new();
    let mut sorted_ys = staff_line_ys.clone();
    sorted_ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    sorted_ys.dedup_by(|a, b| (*a - *b).abs() < 0.01);

    for &y in &sorted_ys {
        if system_tops.is_empty() || (y - system_tops.last().unwrap()) > 5.0 * sp {
            system_tops.push(y);
        }
    }

    assert!(
        system_tops.len() >= 2,
        "Should have at least 2 systems, got {}",
        system_tops.len()
    );
    for i in 1..system_tops.len() {
        assert!(
            system_tops[i] > system_tops[i - 1] + 4.0 * sp,
            "System {} top ({:.1}) should be well below system {} top ({:.1})",
            i,
            system_tops[i],
            i - 1,
            system_tops[i - 1]
        );
    }
}

/// Low notes in one system should push the next system further away compared
/// to a score with only on-staff notes.
#[test]
fn test_low_notes_increase_inter_system_gap() {
    // Score A: all notes on the staff (B4)
    let json_normal = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}}, {}, {}, {},
            {}, {}, {}, {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}
        ]}]
    }"#;
    // Score B: low notes (C3 in treble clef — far below the staff, stem down)
    let json_low = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}}, {}, {}, {},
            {}, {}, {}, {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]},
            {"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]}
        ]}]
    }"#;

    let score_normal = parse_mnx(json_normal).unwrap();
    let score_low = parse_mnx(json_low).unwrap();
    // Unpaged (galley) layout: canvas height tracks content height directly.
    // Paged layouts now vertically justify systems to fill the page, so paged
    // canvas height equals the fixed page grid regardless of content — it can
    // no longer be used to detect a change in per-system vertical reservation.
    let config = LayoutConfig::default();

    let dl_normal = layout_score(&score_normal, 0, &config);
    let dl_low = layout_score(&score_low, 0, &config);

    // Low notes enlarge the below-staff reservation, so the galley system —
    // and therefore the whole canvas — is taller than the on-staff version.
    assert!(
        dl_low.height > dl_normal.height,
        "Low notes should produce taller score: low={:.1}, normal={:.1}",
        dl_low.height,
        dl_normal.height
    );
}

/// A dynamic placed under deep notes sits *below* those notes, so it reaches
/// lower than the notes alone. The below-staff reservation must account for
/// this, making a low-note-plus-dynamic score taller than the same low notes
/// without the dynamic.
#[test]
fn test_dynamic_under_low_notes_increases_below_staff_extra() {
    // Eight measures of a very low note (C3 in treble clef, stem down, far
    // below the staff). The dynamic score additionally carries a dynamic in
    // every bar.
    let measure_plain = r#"{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]}"#;
    let measure_first_plain = r#"{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]}"#;
    let measure_dyn = r#"{"dynamics": [{"type": "immediate", "value": "mp", "position": {"fraction": [0, 1]}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]}"#;
    let measure_first_dyn = r#"{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "dynamics": [{"type": "immediate", "value": "mp", "position": {"fraction": [0, 1]}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}]}]}"#;

    let globals = r#"{"time": {"count": 4, "unit": 4}}, {}, {}, {}, {}, {}, {}, {}"#;
    let json_no_dyn = format!(
        r#"{{"mnx": {{"version": 1}}, "global": {{"measures": [{globals}]}}, "parts": [{{"measures": [{measure_first_plain}, {measure_plain}, {measure_plain}, {measure_plain}, {measure_plain}, {measure_plain}, {measure_plain}, {measure_plain}]}}]}}"#
    );
    let json_dyn = format!(
        r#"{{"mnx": {{"version": 1}}, "global": {{"measures": [{globals}]}}, "parts": [{{"measures": [{measure_first_dyn}, {measure_dyn}, {measure_dyn}, {measure_dyn}, {measure_dyn}, {measure_dyn}, {measure_dyn}, {measure_dyn}]}}]}}"#
    );

    let score_no_dyn = parse_mnx(&json_no_dyn).unwrap();
    let score_dyn = parse_mnx(&json_dyn).unwrap();
    // Unpaged (galley) layout: canvas height tracks content height directly.
    // Paged layouts vertically justify to fill the page, so their canvas height
    // is the fixed page grid and cannot reveal a reservation change.
    let config = LayoutConfig::default();

    let dl_no_dyn = layout_score(&score_no_dyn, 0, &config);
    let dl_dyn = layout_score(&score_dyn, 0, &config);

    // The dynamic stacks below the already-low notes, so the dynamic score must
    // be strictly taller than the same low notes without a dynamic.
    assert!(
        dl_dyn.height > dl_no_dyn.height,
        "Dynamic under low notes should add below-staff space: with_dyn={:.1}, no_dyn={:.1}",
        dl_dyn.height,
        dl_no_dyn.height
    );
}

/// Tempo marking in the first measure should push the score total height
/// to be at least as large as a plain score (never smaller).
#[test]
fn test_tempo_marking_does_not_shrink_score() {
    let json_plain = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}]}]
    }"#;
    let json_tempo = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "tempos": [{"bpm": 120, "value": {"base": "quarter"}}]
        }]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}]}]}]}]
    }"#;

    let score_plain = parse_mnx(json_plain).unwrap();
    let score_tempo = parse_mnx(json_tempo).unwrap();
    let config = LayoutConfig::default();

    let dl_plain = layout_score(&score_plain, 0, &config);
    let dl_tempo = layout_score(&score_tempo, 0, &config);

    // Total height should not decrease when adding tempo marking
    assert!(
        dl_tempo.height >= dl_plain.height - 0.01,
        "Score with tempo should be at least as tall: tempo={:.1}, plain={:.1}",
        dl_tempo.height,
        dl_plain.height
    );
}

// ═══════════════════════════════════════════
// Fill threshold behavior
// ═══════════════════════════════════════════

/// A sparse last/only page is left ragged: the systems sit at the top margin
/// with the default gap and the leftover space pools at the bottom. Stretching
/// a nearly-empty final page into the bottom margin looks worse than a ragged
/// tail, so justification is suppressed below the fill threshold.
#[test]
fn test_fill_threshold_sparse_page_stays_ragged() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;
    let margin_top = config.page_margin_top * sp;
    let page_h = config.page_height * sp;

    // 2 small systems: very sparse page (fill ≈ 5.6%) — well below the 65%
    // last-page justify threshold, so the page stays ragged.
    let content_heights = vec![staff_h; 2];
    let staves_per_system = vec![1_usize; 2];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1],
        y_offset: 0.0,
        height: page_h,
    }];

    let (positions, gaps, _clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );

    // Ragged: top-aligned with default gaps, leftover pooled at the bottom.
    let expected_y0 = margin_top;
    assert!((positions[0] - expected_y0).abs() < 0.01);
    assert!((positions[1] - (expected_y0 + staff_h + default_gap)).abs() < 0.01);
    assert!((gaps[0] - default_gap).abs() < 0.01);
}

/// Systems above the 65% fill threshold should be justified to fill the page.
#[test]
fn test_fill_threshold_full_page_justifies() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;
    let margin_top = config.page_margin_top * sp;
    let margin_bottom = config.page_margin_bottom * sp;
    let page_h = config.page_height * sp;
    let usable = page_h - margin_top - margin_bottom;

    let content_h = usable * 0.12;
    let content_heights = vec![content_h; 6];
    let staves_per_system = vec![1_usize; 6];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0, 1, 2, 3, 4, 5],
        y_offset: 0.0,
        height: page_h,
    }];

    let (positions, _gaps, _clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );

    // With single-staff systems, leftover flows entirely into inter-system
    // gaps. Verify the systems span from top margin to ≈ bottom margin.
    let last_bottom = positions[5] + content_h;
    let bottom_target = margin_top + usable;
    assert!(
        (last_bottom - bottom_target).abs() < 0.5,
        "Last system bottom should reach near page bottom margin: {:.1} vs {:.1}",
        last_bottom,
        bottom_target,
    );
    let inter_gap = positions[1] - (positions[0] + content_h);
    assert!(
        inter_gap > default_gap,
        "Justified inter-system gap should exceed default: {:.1} vs {:.1}",
        inter_gap,
        default_gap
    );
}

/// Orchestral case: a single dense system on the page should grow its
/// intra-staff gaps to fill leftover space (the inter-system loop has
/// nothing to spread). Regression test for the half-empty page issue.
#[test]
fn test_single_dense_system_justifies_intra_staff() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;
    let margin_top = config.page_margin_top * sp;
    let margin_bottom = config.page_margin_bottom * sp;
    let page_h = config.page_height * sp;
    let usable = page_h - margin_top - margin_bottom;

    // 17 staves in one system (orchestral score). Natural height with
    // default 7sp intra-gap = 17*staff_h + 16*7sp.
    let n_staves = 17usize;
    let natural = n_staves as f64 * staff_h + (n_staves as f64 - 1.0) * default_gap;
    let staves_per_system = vec![n_staves];
    let content_heights = vec![natural];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0],
        y_offset: 0.0,
        height: page_h,
    }];

    // Sanity: this case must trigger justification (natural > 65% of usable)
    assert!(
        natural / usable >= 0.65,
        "Test setup: natural fill {:.2} should exceed threshold",
        natural / usable
    );

    let (positions, gaps, _clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );

    // Returned `gaps[0]` is the intra-staff gap floor — should grow above default.
    assert!(
        gaps[0] > default_gap,
        "Intra-staff gap should be justified above default: got {:.1}, default={:.1}",
        gaps[0],
        default_gap
    );

    // System starts at top margin
    assert!((positions[0] - margin_top).abs() < 0.01);
}

/// When a single system on a page is taller than the usable page height,
/// the intra-staff gap should squish below the default to help it fit.
/// Regression test for the orchestral overflow case.
#[test]
fn test_overfull_single_system_squishes_intra_staff() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;
    let margin_top = config.page_margin_top * sp;
    let margin_bottom = config.page_margin_bottom * sp;
    let page_h = config.page_height * sp;
    let usable = page_h - margin_top - margin_bottom;

    // Construct a system whose natural height exceeds usable. With default
    // 7sp gaps and 4sp staves, n_staves * staff_h + (n-1)*gap > usable when
    // n_staves * 4sp + (n-1)*7sp > 267sp ⇒ n ≈ 25 staves on A4.
    let n_staves = 30usize;
    let natural = n_staves as f64 * staff_h + (n_staves as f64 - 1.0) * default_gap;
    assert!(
        natural > usable,
        "Test setup: natural {:.0} should exceed usable {:.0}",
        natural,
        usable
    );

    let staves_per_system = vec![n_staves];
    let content_heights = vec![natural];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0],
        y_offset: 0.0,
        height: page_h,
    }];

    let (positions, gaps, clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );

    // Intra-staff gap must shrink below default
    assert!(
        gaps[0] < default_gap,
        "Intra-staff gap should squish below default: got {:.1}, default={:.1}",
        gaps[0],
        default_gap
    );
    // …but never below the configured hard floor
    assert!(
        gaps[0] >= config.min_intra_staff_squish * sp - 0.01,
        "Intra-staff gap should not go below min_intra_staff_squish: got {:.1}, floor={:.1}",
        gaps[0],
        config.min_intra_staff_squish * sp
    );
    // Content-aware clearance should also shrink proportionally
    assert!(
        clearances[0] < config.default_intra_staff_clearance * sp,
        "Clearance should squish: got {:.1}, default={:.1}",
        clearances[0],
        config.default_intra_staff_clearance * sp
    );
    assert!(
        clearances[0] >= config.min_intra_staff_clearance * sp - 0.01,
        "Clearance should not go below min: got {:.1}, floor={:.1}",
        clearances[0],
        config.min_intra_staff_clearance * sp
    );

    // System starts at top margin
    assert!((positions[0] - margin_top).abs() < 0.01);
}

/// When a system fits with room to spare, no squish — clearance and gap
/// stay at their defaults (or grow via spread, but never shrink).
#[test]
fn test_well_fitting_system_no_squish() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let staff_h = 4.0 * sp;
    let default_gap = 7.0 * sp;

    let n_staves = 4usize;
    let natural = n_staves as f64 * staff_h + (n_staves as f64 - 1.0) * default_gap;
    let staves_per_system = vec![n_staves];
    let content_heights = vec![natural];
    let pages = vec![PageLayout {
        page_number: 0,
        system_indices: vec![0],
        y_offset: 0.0,
        height: config.page_height * sp,
    }];

    let (_positions, gaps, clearances) = compute_system_y_positions(
        &staves_per_system,
        staff_h,
        &pages,
        &config,
        0.0,
        Some(&content_heights),
        None,
        None,
    );

    assert!(
        gaps[0] >= default_gap,
        "Gap should not shrink when system fits: got {:.1}",
        gaps[0]
    );
    assert!(
        (clearances[0] - config.default_intra_staff_clearance * sp).abs() < 0.01,
        "Clearance should stay at default when not squishing: got {:.1}",
        clearances[0]
    );
}
