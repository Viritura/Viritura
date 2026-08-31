// Auto-generated from tests.rs — test_skyline
// 5 test(s)

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::model::*;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

// ═══════════════════════════════════════════
// Skyline collision avoidance tests
// ═══════════════════════════════════════════
#[test]
fn test_skyline_accidental_placement_single() {
    // Single accidental should be placed just left of the notehead
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find sharp accidental glyph
    let acc_glyphs: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ACCIDENTAL_SHARP)
    }).collect();
    assert_eq!(acc_glyphs.len(), 1, "Expected exactly 1 sharp accidental");

    // Find notehead glyph (whole note)
    let note_glyphs: Vec<_> = dl.commands.iter().filter(|cmd| {
        matches!(cmd, RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::NOTEHEAD_WHOLE)
    }).collect();
    assert!(!note_glyphs.is_empty(), "Expected at least 1 notehead");

    // Accidental should be to the left of the notehead
    if let (RenderCommand::DrawGlyph { x: acc_x, .. }, RenderCommand::DrawGlyph { x: note_x, .. }) =
        (acc_glyphs[0], note_glyphs[0])
    {
        assert!(*acc_x < *note_x, "Accidental should be left of notehead");
    }
}

#[test]
fn test_skyline_accidental_chord_stacking() {
    // Chord with multiple accidentals: verify they don't overlap horizontally
    // C#4 + E#4 + G#4 — three sharps close together
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [
            {"pitch": {"step": "C", "octave": 4, "alter": 1}},
            {"pitch": {"step": "E", "octave": 4, "alter": 1}},
            {"pitch": {"step": "G", "octave": 4, "alter": 1}}
        ]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find all sharp accidentals
    let acc_glyphs: Vec<(f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = cmd
            {
                if *codepoint == smufl::ACCIDENTAL_SHARP {
                    return Some((*x, *y));
                }
            }
            None
        })
        .collect();
    assert_eq!(acc_glyphs.len(), 3, "Expected 3 sharp accidentals");

    // Verify that accidentals don't overlap: for each pair, either
    // they are at different x positions or different y positions (with enough gap)
    let sp = config.sp;
    let sharp_w = smufl::accidental_width(1) * sp;
    for i in 0..acc_glyphs.len() {
        for j in (i + 1)..acc_glyphs.len() {
            let (x1, y1) = acc_glyphs[i];
            let (x2, y2) = acc_glyphs[j];
            // If y positions are close (within one staff space), x positions
            // must be separated by at least the accidental width
            if (y1 - y2).abs() < sp {
                assert!((x1 - x2).abs() >= sharp_w * 0.9,
                    "Accidentals at similar y ({:.1}, {:.1}) should not overlap horizontally (x1={:.1}, x2={:.1}, width={:.1})",
                    y1, y2, x1, x2, sharp_w);
            }
        }
    }
}

#[test]
fn test_mixed_chord_accidentals_keep_visible_ink_gap() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [{
                "duration": {"base": "quarter"},
                "notes": [
                    {"pitch": {"step": "C", "octave": 4, "alter": 0}, "accidentalDisplay": {"show": true}},
                    {"pitch": {"step": "D", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}},
                    {"pitch": {"step": "E", "octave": 4, "alter": 0}, "accidentalDisplay": {"show": true}}
                ]
            }]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let mut accidentals = Vec::new();
    for command in &dl.commands {
        if let RenderCommand::DrawGlyph {
            x, y, codepoint, ..
        } = command
        {
            let alter = match *codepoint {
                smufl::ACCIDENTAL_NATURAL => 0,
                smufl::ACCIDENTAL_SHARP => 1,
                _ => continue,
            };
            let width = smufl::accidental_width(alter) * config.sp;
            accidentals.push((*x, *x + width, *y));
        }
    }
    assert_eq!(accidentals.len(), 3);
    accidentals.sort_by(|left, right| left.2.total_cmp(&right.2));

    for pair in accidentals.windows(2) {
        let (left, right, _) = pair[0];
        let (other_left, other_right, _) = pair[1];
        let gap = if right <= other_left {
            other_left - right
        } else if other_right <= left {
            left - other_right
        } else {
            -1.0
        };
        assert!(
            gap >= 0.09 * config.sp,
            "adjacent accidentals need a visible horizontal gap, got {:.3}sp",
            gap / config.sp
        );
    }
}

#[test]
fn test_skyline_accidental_no_fan_out_reuses_columns() {
    // A stack of thirds (F#4 + A#4 + C#5) puts each accidental within vertical
    // reach of its immediate neighbor but NOT the one two notes away. A naive
    // greedy leftward stack processed top-to-bottom fans these into a diagonal
    // staircase of three distinct columns. Outside-in alternating placement
    // packs them into two columns: the top and bottom accidentals share the
    // inner column and the middle one tucks into the outer column. This test
    // guards against regressing to the fan-out.
    //
    // The chord sits fully WITHIN the staff (F4=pos7, A4=pos5, C5=pos3) so no
    // ledger lines are involved — this isolates the column-reuse logic from the
    // separate ledger-clearance behavior exercised by
    // `test_skyline_accidental_clears_ledger_line`.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [
            {"pitch": {"step": "F", "octave": 4, "alter": 1}},
            {"pitch": {"step": "A", "octave": 4, "alter": 1}},
            {"pitch": {"step": "C", "octave": 5, "alter": 1}}
        ]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let sharp_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { x, codepoint, .. } = cmd {
                if *codepoint == smufl::ACCIDENTAL_SHARP {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert_eq!(sharp_xs.len(), 3, "Expected 3 sharp accidentals");

    // Count distinct x columns (cluster x values within a quarter-space).
    let mut columns: Vec<f64> = Vec::new();
    for &x in &sharp_xs {
        if !columns.iter().any(|c| (c - x).abs() < 0.25 * sp) {
            columns.push(x);
        }
    }
    assert_eq!(
        columns.len(),
        2,
        "Thirds-stacked accidentals should pack into 2 columns (no fan-out), \
         got {} distinct x positions: {:?}",
        columns.len(),
        sharp_xs
    );
}

#[test]
fn test_skyline_accidental_clears_ledger_line() {
    // A sharp on a note that sits on a ledger line (C4 in treble = first ledger
    // below the staff) must shift left so the ledger line does not cut through
    // the glyph. The ledger is part of the chord obstacle shape that
    // accidentals kern against; sharps/naturals may tuck into it by up to
    // 0.10sp but otherwise clear it. Without ledger awareness the sharp
    // overlapped the ledger by ~0.2sp.
    let with_ledger = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [
            {"pitch": {"step": "C", "octave": 4, "alter": 1}}
        ]}]}]}]}]
    }"#;
    // Same note one octave up (C5) sits inside the staff — no ledger, so its
    // sharp sits at the normal accidental-to-notehead gap. The ledgered sharp
    // must be at least as far from its notehead as the un-ledgered one.
    let no_ledger = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [
            {"pitch": {"step": "C", "octave": 5, "alter": 1}}
        ]}]}]}]}]
    }"#;
    let config = LayoutConfig::default();
    let sp = config.sp;

    let gap_for = |json: &str| -> f64 {
        let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
        let note_x = dl
            .commands
            .iter()
            .find_map(|c| match c {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if *codepoint == smufl::NOTEHEAD_WHOLE =>
                {
                    Some(*x)
                }
                _ => None,
            })
            .unwrap();
        let acc_right = dl
            .commands
            .iter()
            .find_map(|c| match c {
                RenderCommand::DrawGlyph { x, codepoint, .. }
                    if *codepoint == smufl::ACCIDENTAL_SHARP =>
                {
                    Some(*x + smufl::accidental_width(1) * sp)
                }
                _ => None,
            })
            .unwrap();
        note_x - acc_right
    };

    let ledger_gap = gap_for(with_ledger);
    let plain_gap = gap_for(no_ledger);

    // The ledgered sharp must sit further from its notehead than the plain one
    // (it has to clear the ledger that extends left of the notehead).
    assert!(
        ledger_gap > plain_gap + 0.1 * sp,
        "Sharp on a ledgered note should clear the ledger (gap {:.3}sp) and sit \
         further left than a non-ledgered sharp (gap {:.3}sp)",
        ledger_gap / sp,
        plain_gap / sp,
    );
}

#[test]
fn test_skyline_accidental_kerning_far_apart() {
    // Accidentals far apart vertically should share horizontal column.
    // Bb2 + F#5 — far apart, accidentals should both be close to noteheads
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [
            {"pitch": {"step": "B", "octave": 2, "alter": -1}},
            {"pitch": {"step": "F", "octave": 5, "alter": 1}}
        ]}]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let sp = config.sp;
    let acc_glyphs: Vec<(f64, f64, u32)> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph {
                x, y, codepoint, ..
            } = cmd
            {
                if *codepoint == smufl::ACCIDENTAL_FLAT || *codepoint == smufl::ACCIDENTAL_SHARP {
                    return Some((*x, *y, *codepoint));
                }
            }
            None
        })
        .collect();
    assert_eq!(acc_glyphs.len(), 2, "Expected 2 accidentals (flat + sharp)");

    // Both accidentals should be in the first column (close to noteheads)
    // since they're far enough apart vertically to share the same column
    let note_glyphs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { x, codepoint, .. } = cmd {
                if *codepoint == smufl::NOTEHEAD_WHOLE {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert!(!note_glyphs.is_empty());
    let note_x = note_glyphs[0];

    // Both accidentals should be within ~2 sp of the notehead (first column)
    for (ax, _ay, _cp) in &acc_glyphs {
        let dist = note_x - ax;
        assert!(
            dist < 2.5 * sp,
            "Far-apart accidental should be in first column (dist={:.1}, max={:.1})",
            dist,
            2.5 * sp
        );
    }
}

#[test]
fn test_skyline_column_spacing_with_accidentals() {
    // Two events: quarter C4, then quarter F#4
    // The F#4 accidental should not overlap with the C4 notehead
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find quarter noteheads in order
    let noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { x, codepoint, .. } = cmd {
                if *codepoint == smufl::NOTEHEAD_BLACK {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert!(noteheads.len() >= 4, "Expected at least 4 noteheads");

    // Find the sharp accidental
    let acc_x: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawGlyph { x, codepoint, .. } = cmd {
                if *codepoint == smufl::ACCIDENTAL_SHARP {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert_eq!(acc_x.len(), 1, "Expected 1 sharp accidental");

    // The accidental should not overlap with the first notehead's right edge
    let sp = config.sp;
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let first_note_right = noteheads[0] + notehead_w;
    assert!(
        acc_x[0] >= first_note_right - 0.1 * sp,
        "Accidental on F#4 ({:.1}) should not overlap first notehead right edge ({:.1})",
        acc_x[0],
        first_note_right
    );
}

#[test]
fn test_skyline_min_content_width() {
    use crate::layout::measure::skyline_min_content_width;

    // Build a sequence with two events: quarter C4, quarter Bb4
    // The skyline should compute a reasonable minimum width
    let sequences = vec![Sequence {
        content: vec![
            SequenceContent::Event(Event {
                duration: Duration {
                    base: NoteValueBase::Quarter,
                    dots: None,
                },
                notes: Some(vec![Note {
                    pitch: Pitch {
                        step: "C".into(),
                        octave: 4,
                        alter: None,
                    },
                    accidental_display: None,
                    written: None,
                    id: None,
                    ties: None,
                    staff: None,
                    kit_component: None,
                    perform: None,
                    source_part_index: None,
                    source_note_index: None,
                    source_event_id: None,
                }]),
                rest: None,
                id: None,
                staff: None,
                slurs: None,
                glissandos: None,
                markings: None,
                fermata: None,
                lyrics: None,
                stem_direction: None,
                orient: None,
            }),
            SequenceContent::Event(Event {
                duration: Duration {
                    base: NoteValueBase::Quarter,
                    dots: None,
                },
                notes: Some(vec![Note {
                    pitch: Pitch {
                        step: "B".into(),
                        octave: 4,
                        alter: Some(-1),
                    },
                    accidental_display: None,
                    written: None,
                    id: None,
                    ties: None,
                    staff: None,
                    kit_component: None,
                    perform: None,
                    source_part_index: None,
                    source_note_index: None,
                    source_event_id: None,
                }]),
                rest: None,
                id: None,
                staff: None,
                slurs: None,
                glissandos: None,
                markings: None,
                fermata: None,
                lyrics: None,
                stem_direction: None,
                orient: None,
            }),
        ],
        full_measure: None,
        staff: None,
        voice: None,
        orient: None,
        forced_stem_up: None,
        source_part_index: None,
        source_seq_index: None,
    }];
    let key = KeySignature {
        fifths: 0,
        ..Default::default()
    };
    let config = LayoutConfig::default();
    let sp = config.sp;
    let total_beats = 4.0;

    let min_w = skyline_min_content_width(&sequences, total_beats, &key, &config, sp, 1.0);
    // Should be positive and reasonable
    assert!(min_w > 0.0, "Skyline min width should be positive");
    // Should be at least the combined notehead + accidental + gap width
    let notehead_w = config.notehead_rx * 2.0 * sp;
    let acc_w = smufl::accidental_width(-1) * sp;
    assert!(
        min_w > notehead_w + acc_w,
        "Min width ({:.1}) should exceed notehead+accidental ({:.1})",
        min_w,
        notehead_w + acc_w
    );
}

#[test]
fn test_skyline_reserves_full_stacked_accidental_column() {
    // A chord with several accidentals whose vertical extents overlap cascades
    // them into multiple horizontal columns, which protrude farther left than
    // any single accidental glyph. The skyline minimum-content-width must
    // reserve the FULL stacked column — reserving only one accidental's width
    // lets the leftmost accidental overflow into the previous notehead when the
    // measure is compressed toward this minimum.
    use crate::layout::measure::skyline_min_content_width;

    fn note(step: &str, octave: i32, alter: i32) -> Note {
        Note {
            pitch: Pitch {
                step: step.into(),
                octave,
                alter: Some(alter),
            },
            accidental_display: Some(AccidentalDisplay {
                show: true,
                force: None,
                enclosure: None,
            }),
            written: None,
            id: None,
            ties: None,
            staff: None,
            kit_component: None,
            perform: None,
            source_part_index: None,
            source_note_index: None,
            source_event_id: None,
        }
    }

    fn quarter(notes: Vec<Note>) -> SequenceContent {
        SequenceContent::Event(Event {
            duration: Duration {
                base: NoteValueBase::Quarter,
                dots: None,
            },
            notes: Some(notes),
            rest: None,
            id: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        })
    }

    fn seq(second_event: SequenceContent) -> Vec<Sequence> {
        vec![Sequence {
            content: vec![quarter(vec![note("C", 4, 1)]), second_event],
            full_measure: None,
            staff: None,
            voice: None,
            orient: None,
            forced_stem_up: None,
            source_part_index: None,
            source_seq_index: None,
        }]
    }

    let key = KeySignature {
        fifths: 0,
        ..Default::default()
    };
    let config = LayoutConfig::default();
    let sp = config.sp;

    // Second event carries a single accidental.
    let single = seq(quarter(vec![note("C", 5, 1)]));
    // Second event is a tight cluster whose three accidentals must stack into
    // separate columns (C#5 / Db5 / E#5).
    let cluster = seq(quarter(vec![
        note("C", 5, 1),
        note("D", 5, -1),
        note("E", 5, 1),
    ]));

    let min_single = skyline_min_content_width(&single, 4.0, &key, &config, sp, 1.0);
    let min_cluster = skyline_min_content_width(&cluster, 4.0, &key, &config, sp, 1.0);

    // The stacked column is meaningfully wider than a single accidental, so the
    // reserved minimum must grow. (Before the fix both used a single
    // accidental's width and were equal.)
    assert!(
        min_cluster > min_single + 0.5 * sp,
        "stacked-accidental minimum width ({:.1}) must exceed the single-accidental minimum ({:.1}) by more than 0.5 sp",
        min_cluster,
        min_single
    );
}

#[test]
fn test_skyline_min_does_not_globally_inflate_for_one_tight_pair() {
    // A single tight collision pair (a wide accidental cluster at ONE onset of
    // an otherwise plain run of eighths) must add only its LOCAL width deficit
    // to the measure minimum — not scale the whole measure up by the inverse of
    // that gap's small width-fraction. The old `needed / frac_diff` model did
    // the latter: a ~3sp cluster on a 0.5-beat gap (≈1/8 of the measure's log
    // width) demanded ≈8×3sp ≈ 24sp+ of TOTAL width, ballooning every other
    // (empty) gap ~6× under the proportional stretch. Regression for that.
    use crate::layout::measure::skyline_min_content_width;

    fn note(step: &str, octave: i32, alter: i32) -> Note {
        Note {
            pitch: Pitch {
                step: step.into(),
                octave,
                alter: Some(alter),
            },
            accidental_display: Some(AccidentalDisplay {
                show: true,
                force: None,
                enclosure: None,
            }),
            written: None,
            id: None,
            ties: None,
            staff: None,
            kit_component: None,
            perform: None,
            source_part_index: None,
            source_note_index: None,
            source_event_id: None,
        }
    }
    fn plain_note(step: &str, octave: i32) -> Note {
        Note {
            pitch: Pitch {
                step: step.into(),
                octave,
                alter: None,
            },
            accidental_display: None,
            written: None,
            id: None,
            ties: None,
            staff: None,
            kit_component: None,
            perform: None,
            source_part_index: None,
            source_note_index: None,
            source_event_id: None,
        }
    }
    fn eighth(notes: Vec<Note>) -> SequenceContent {
        SequenceContent::Event(Event {
            duration: Duration {
                base: NoteValueBase::Eighth,
                dots: None,
            },
            notes: Some(notes),
            rest: None,
            id: None,
            staff: None,
            slurs: None,
            glissandos: None,
            markings: None,
            fermata: None,
            lyrics: None,
            stem_direction: None,
            orient: None,
        })
    }

    let key = KeySignature {
        fifths: 0,
        ..Default::default()
    };
    let config = LayoutConfig::default();
    let sp = config.sp;

    // Eight eighths fill 4/4. Onset 4 carries a 3-accidental cluster; the rest
    // are plain single noteheads.
    let cluster = vec![note("C", 5, 1), note("D", 5, -1), note("E", 5, 1)];
    let mut content: Vec<SequenceContent> = Vec::new();
    for i in 0..8 {
        if i == 4 {
            content.push(eighth(cluster.clone()));
        } else {
            content.push(eighth(vec![plain_note("F", 4)]));
        }
    }
    let sequences = vec![Sequence {
        content,
        full_measure: None,
        staff: None,
        voice: None,
        orient: None,
        forced_stem_up: None,
        source_part_index: None,
        source_seq_index: None,
    }];

    let min_w = skyline_min_content_width(&sequences, 4.0, &key, &config, sp, 1.0);

    // Bound: the eight gaps each get max(eighth-spring, collision). One gap
    // holds the cluster (~a few sp extra); the other seven are plain. A safe
    // upper bound is the eighth-spring sum plus a generous cluster allowance —
    // well under the old blow-up, which exceeded ~40sp. We assert < 25sp.
    let notehead_w = config.notehead_rx * 2.0 * sp;
    assert!(
        min_w > notehead_w,
        "min width must be positive/meaningful, got {min_w:.1}"
    );
    assert!(
        min_w < 25.0 * sp,
        "a single tight pair must not globally inflate the measure: min_w={:.1}px = {:.1}sp",
        min_w,
        min_w / sp
    );
}
