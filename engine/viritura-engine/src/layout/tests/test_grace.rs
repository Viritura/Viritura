// Auto-generated from tests.rs — test_grace
// 8 test(s)

use super::test_helpers::*;
use crate::layout::config::LayoutConfig;
use crate::layout::grace::{render_grace_event, GraceRenderContext, GRACE_SCALE};
use crate::layout::measure::*;
use crate::layout::resolve::*;
use crate::layout::types::GraceNoteLayout;
use crate::layout::{layout_full_score, layout_score};
use crate::model::{Duration, Event, KeySignature, Note, NoteValueBase, Pitch};
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::*;

#[test]
fn test_grace_score_renderer_preserves_plain_ink() {
    let config = LayoutConfig::default();
    let sp = 10.0;
    let staff_y = 100.0;
    let x = 80.0;
    let color = "#123456";
    for duration in [NoteValueBase::Half, NoteValueBase::Eighth] {
        for stem_up in [false, true] {
            for beamed in [false, true] {
                let event = Event {
                    duration: Duration {
                        base: duration.clone(),
                        dots: None,
                    },
                    notes: Some(vec![Note {
                        pitch: Pitch {
                            step: "C".into(),
                            octave: 4,
                            alter: None,
                        },
                        ..Note::default()
                    }]),
                    id: None,
                    rest: None,
                    staff: None,
                    slurs: None,
                    glissandos: None,
                    markings: None,
                    fermata: None,
                    lyrics: None,
                    stem_direction: None,
                    orient: None,
                };
                let pos = if stem_up { 10.0 } else { -2.0 };
                let gn = GraceNoteLayout {
                    display_pitches: event.notes().iter().map(|n| n.pitch.clone()).collect(),
                    event,
                    x,
                    note_positions: vec![pos],
                    stem_up,
                    after_main: false,
                    is_slash: true,
                    id: Some("grace".into()),
                    color: Some(color.into()),
                };
                let beamed_ids = if beamed {
                    std::collections::HashSet::from(["grace".into()])
                } else {
                    std::collections::HashSet::new()
                };
                let mut actual = DisplayList::new(0.0, 0.0);
                render_grace_event(
                    &mut actual,
                    &gn,
                    staff_y,
                    sp,
                    &config,
                    &beamed_ids,
                    &mut GraceRenderContext {
                        active_key: &KeySignature::default(),
                        measure_acc: &mut std::collections::HashMap::new(),
                        use_accidental_display: false,
                        kit: None,
                        tie_accidentals: None,
                    },
                    "grace",
                );

                let mut expected = DisplayList::new(0.0, 0.0);
                let note_y = staff_y + pos * sp * 0.5;
                expected.ledger_line(
                    x - config.ledger_extension * sp * GRACE_SCALE,
                    note_y,
                    config.notehead_rx * 2.0 * GRACE_SCALE * sp
                        + 2.0 * config.ledger_extension * sp * GRACE_SCALE,
                    config.ledger_line_width * sp,
                );
                expected.push(RenderCommand::DrawGlyph {
                    x,
                    y: note_y,
                    codepoint: smufl::notehead_glyph(&gn.event.duration.base),
                    font: "Bravura".into(),
                    size: 4.0 * sp * GRACE_SCALE,
                    color: color.into(),
                    rotation: 0.0,
                });
                if !beamed {
                    let flag_count = gn.event.duration.base.flag_count();
                    let stem_length = if flag_count > 0 {
                        config.stem_length.max(
                            smufl::flag_inward_extent(flag_count, stem_up)
                                + config.notehead_ry
                                + 0.25,
                        )
                    } else {
                        config.stem_length
                    };
                    let stem_len = stem_length * sp * GRACE_SCALE;
                    let ext = smufl::flag_stem_extension(flag_count, stem_up) * sp * GRACE_SCALE;
                    let (stem_x, stem_top, stem_bottom, flag_y) = if stem_up {
                        let flag_y = note_y - stem_len;
                        (
                            x + smufl::STEM_UP_SE.0 * sp * GRACE_SCALE
                                - config.stem_width * sp * 0.5,
                            flag_y - ext,
                            note_y + smufl::STEM_UP_SE.1 * sp * GRACE_SCALE,
                            flag_y,
                        )
                    } else {
                        let flag_y = note_y + stem_len;
                        (
                            x + smufl::STEM_DOWN_NW.0 * sp * GRACE_SCALE
                                + config.stem_width * sp * 0.5,
                            note_y + smufl::STEM_DOWN_NW.1 * sp * GRACE_SCALE,
                            flag_y + ext,
                            flag_y,
                        )
                    };
                    expected.stem(stem_x, stem_top, stem_bottom, config.stem_width * sp);
                    if let Some(codepoint) = smufl::flag_glyph(flag_count, stem_up) {
                        expected.push(RenderCommand::DrawGlyph {
                            x: stem_x,
                            y: flag_y,
                            codepoint,
                            font: "Bravura".into(),
                            size: 4.0 * sp * GRACE_SCALE,
                            color: color.into(),
                            rotation: 0.0,
                        });
                    }
                    if flag_count > 0 {
                        let center_y = if stem_up {
                            stem_top + stem_len * 0.35
                        } else {
                            stem_bottom - stem_len * 0.35
                        };
                        let slash_ext = 0.6 * sp * GRACE_SCALE;
                        expected.push(RenderCommand::DrawLine {
                            x1: stem_x - slash_ext * 0.8,
                            y1: center_y + slash_ext,
                            x2: stem_x + slash_ext * 0.8,
                            y2: center_y - slash_ext,
                            width: config.stem_width * sp * 1.5,
                            color: color.into(),
                        });
                    }
                }
                assert_eq!(actual.commands.len(), expected.commands.len());
                for (actual, expected) in actual.commands.iter().zip(&expected.commands) {
                    let actual = serde_json::to_value(actual).unwrap();
                    let expected = serde_json::to_value(expected).unwrap();
                    let actual = actual.as_object().unwrap();
                    let expected = expected.as_object().unwrap();
                    assert_eq!(actual.len(), expected.len());
                    for (field, expected) in expected {
                        let actual = &actual[field];
                        if let (Some(actual), Some(expected)) = (actual.as_f64(), expected.as_f64())
                        {
                            assert!(
                                (actual - expected).abs() < 1e-9,
                                "{duration:?}, stem_up={stem_up}, beamed={beamed}: {field}: {actual} != {expected}"
                            );
                        } else {
                            assert_eq!(actual, expected, "{field}");
                        }
                    }
                }
            }
        }
    }
}

fn grace_regression_document(content: serde_json::Value, fifths: i32) -> serde_json::Value {
    serde_json::json!({
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": fifths}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": content}]
        }]}]
    })
}

fn grace_regression_event(id: &str, step: &str, alter: i32) -> serde_json::Value {
    serde_json::json!({
        "id": id, "duration": {"base": "eighth"},
        "notes": [{"pitch": {"step": step, "octave": 4, "alter": alter}}]
    })
}

fn grace_glyph_positions(dl: &DisplayList, cp: u32, sp: f64) -> Vec<(f64, f64)> {
    dl.commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                codepoint,
                x,
                y,
                size,
                font,
                ..
            } if *codepoint == cp && (*size - 4.0 * sp * GRACE_SCALE).abs() < 1e-9 => {
                assert_eq!(font, "Bravura");
                Some((*x, *y))
            }
            _ => None,
        })
        .collect()
}

fn grace_accidental_codepoints(dl: &DisplayList, sp: f64) -> Vec<u32> {
    dl.commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                codepoint, size, ..
            } if is_accidental_glyph(command) && (*size - 4.0 * sp * GRACE_SCALE).abs() < 1e-9 => {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect()
}

fn grace_collision_score(
    graces: serde_json::Value,
    principal: serde_json::Value,
    after: bool,
) -> crate::model::Score {
    let group = serde_json::json!({"type": "grace", "content": graces});
    let content = if after {
        serde_json::json!([principal, group])
    } else {
        serde_json::json!([group, principal])
    };
    minimal_spacing_score(
        &serde_json::json!([{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": content}]
        }]}])
        .to_string(),
    )
}

fn grace_collision_event(id: &str, alter: i32, dots: u32) -> serde_json::Value {
    serde_json::json!({
        "id": id, "duration": {"base": "eighth", "dots": dots},
        "notes": [{"pitch": {"step": "C", "octave": 5, "alter": alter}}]
    })
}

fn collision_glyph_edges(dl: &DisplayList, event: &str, cp: u32) -> (f64, f64) {
    dl.commands
        .iter()
        .zip(&dl.element_ids)
        .filter_map(|(command, id)| match command {
            RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } if *codepoint == cp
                && id
                    .as_ref()
                    .is_some_and(|id| id.split('/').any(|segment| segment == event)) =>
            {
                let (left, _, width, _) = smufl::glyph_bbox(cp);
                Some((x + left * size / 4.0, x + (left + width) * size / 4.0))
            }
            _ => None,
        })
        .reduce(|a, b| (a.0.min(b.0), a.1.max(b.1)))
        .unwrap_or_else(|| panic!("missing glyph {cp:x} for {event}"))
}

fn grace_flag_spacing_score(stems: [bool; 2], after: bool, beam_mode: &str) -> crate::model::Score {
    let mut first = grace_collision_event("g1", 0, 0);
    let mut second = grace_collision_event("g2", 0, 0);
    first["notes"][0]["pitch"] = serde_json::json!({"step": "B", "octave": 4});
    second["notes"][0]["pitch"] = serde_json::json!({"step": "D", "octave": 5});
    first["orient"] = serde_json::json!(if stems[0] { "above" } else { "below" });
    second["orient"] = serde_json::json!(if stems[1] { "above" } else { "below" });
    if beam_mode == "singleton" {
        // Auto-beaming is enabled, but the quarter breaks the eligible run.
        let unflagged = if stems[0] { &mut second } else { &mut first };
        unflagged["duration"]["base"] = serde_json::json!("quarter");
    }
    let mut principal = grace_collision_event("main", 0, 0);
    principal["duration"]["base"] = serde_json::json!("quarter");
    let group = serde_json::json!({"type": "grace", "slash": false, "content": [first, second]});
    let content = if after {
        serde_json::json!([principal, group])
    } else {
        serde_json::json!([group, principal])
    };
    let mut doc = grace_regression_document(content, 0);
    doc["mnx"]["support"] = serde_json::json!({
        "useBeams": matches!(beam_mode, "none" | "explicit")
    });
    if beam_mode == "explicit" {
        doc["parts"][0]["measures"][0]["beams"] = serde_json::json!([{"events": ["g1", "g2"]}]);
    }
    parse_mnx(&doc.to_string()).unwrap()
}

fn assert_grace_flag_spacing(stems: [bool; 2], beam_mode: &str) {
    for sp in [10.0, 4.0] {
        for after in [false, true] {
            let config = LayoutConfig {
                sp,
                ..LayoutConfig::default()
            };
            let score = grace_flag_spacing_score(stems, after, beam_mode);
            let dl = layout_score(&score, 0, &config);
            let beamed = matches!(beam_mode, "explicit" | "auto");
            let expected_flags = if beamed {
                0
            } else if beam_mode == "singleton" {
                1
            } else {
                2
            };
            assert_eq!(
                dl.commands.iter().filter(|c| is_flag_glyph(c)).count(),
                expected_flags
            );
            let mut edges = [
                collision_glyph_edges(&dl, "g1", smufl::NOTEHEAD_BLACK),
                collision_glyph_edges(&dl, "g2", smufl::NOTEHEAD_BLACK),
            ];
            let first_origin = edges[0].0;
            if !beamed {
                for (index, id) in ["g1", "g2"].iter().enumerate() {
                    if beam_mode == "singleton" && index == usize::from(stems[0]) {
                        continue;
                    }
                    let flag =
                        collision_glyph_edges(&dl, id, smufl::flag_glyph(1, stems[index]).unwrap());
                    edges[index].0 = edges[index].0.min(flag.0);
                    edges[index].1 = edges[index].1.max(flag.1);
                }
            }
            assert!(
                edges[1].0 - edges[0].1 >= 0.099 * sp,
                "grace flag ink overlaps: gap={}sp, stems={stems:?}, mode={beam_mode}, after={after}, sp={sp}",
                (edges[1].0 - edges[0].1) / sp
            );
            let resolved = resolve_measures(&score, 0);
            let spacing = crate::layout::spacing::build_log_spacing_for_resolved_measure(
                &resolved[0],
                4.0,
                0.5,
                &config,
                true,
            );
            let ml = layout_measure(&resolved[0], sp, 0.0, &config, Some(1.0), &[], 0.5);
            let event = &ml.voice_layouts[0].events_vec()[0];
            let graces = &event.grace_notes;
            assert!(graces[1].x - graces[0].x >= 1.6 * sp - 1e-9);
            let shift = graces[0].x - first_origin;
            let left = edges[0].0 + shift;
            let right = edges[1].1 + shift;
            if after {
                let tail = (spacing.rigid_total - spacing.rigid_widths[0]) * sp;
                let buffer = crate::layout::render_barlines::trailing_barline_content_buffer_sp(
                    &resolved[0],
                    &config,
                ) * sp;
                assert!(right + 0.49 * sp <= event.x + tail + buffer);
            } else {
                assert!(left >= ml.x + ml.prefix_width - 1e-9);
                assert!(event.x - left <= spacing.rigid_widths[0] * sp + 1e-9);
                assert!(right < event.x);
            }
        }
    }
}

#[test]
fn test_grace_flag_spacing_up_without_explicit_beam() {
    assert_grace_flag_spacing([true, true], "none");
}

#[test]
fn test_grace_flag_spacing_down_without_explicit_beam() {
    assert_grace_flag_spacing([false, false], "none");
}

#[test]
fn test_grace_flag_spacing_mixed_without_explicit_beam() {
    assert_grace_flag_spacing([true, false], "none");
}

#[test]
fn test_grace_flag_spacing_without_auto_beam_group() {
    assert_grace_flag_spacing([true, true], "singleton");
    assert_grace_flag_spacing([false, false], "singleton");
}

#[test]
fn test_grace_flag_spacing_preserves_explicit_and_auto_beams() {
    for mode in ["explicit", "auto"] {
        assert_grace_flag_spacing([true, true], mode);
        assert_grace_flag_spacing([false, false], mode);
    }
}

fn assert_adjacent_grace_clearance(after: bool, dots: bool) {
    let score = grace_collision_score(
        serde_json::json!([
            grace_collision_event("g1", 0, u32::from(dots)),
            grace_collision_event("g2", i32::from(!dots), 0)
        ]),
        grace_collision_event("main", 0, 0),
        after,
    );
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let left_cp = if dots {
        smufl::AUGMENTATION_DOT
    } else {
        smufl::NOTEHEAD_BLACK
    };
    let right_cp = if dots {
        smufl::NOTEHEAD_BLACK
    } else {
        smufl::ACCIDENTAL_SHARP
    };
    let right = collision_glyph_edges(&dl, "g1", left_cp).1;
    let left = collision_glyph_edges(&dl, "g2", right_cp).0;
    assert!(
        left - right >= 0.29 * config.sp,
        "adjacent grace ink needs 0.3sp clearance: gap={}sp, after={after}, dots={dots}",
        (left - right) / config.sp
    );
}

#[test]
fn test_grace_collision_before_sharp() {
    assert_adjacent_grace_clearance(false, false);
}

#[test]
fn test_grace_collision_after_sharp() {
    assert_adjacent_grace_clearance(true, false);
}

#[test]
fn test_grace_collision_before_dots() {
    assert_adjacent_grace_clearance(false, true);
}

#[test]
fn test_grace_collision_after_dots() {
    assert_adjacent_grace_clearance(true, true);
}

#[test]
fn test_grace_collision_last_dots_clear_principal_natural() {
    let score = grace_collision_score(
        serde_json::json!([grace_collision_event("g1", 1, 3)]),
        grace_collision_event("main", 0, 0),
        false,
    );
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let right = collision_glyph_edges(&dl, "g1", smufl::AUGMENTATION_DOT).1;
    let left = collision_glyph_edges(&dl, "main", smufl::ACCIDENTAL_NATURAL).0;
    assert!(
        left - right >= 0.29 * config.sp,
        "last grace dot/principal natural gap={}sp",
        (left - right) / config.sp
    );
}

#[test]
fn test_grace_collision_after_clears_principal_dots() {
    let score = grace_collision_score(
        serde_json::json!([grace_collision_event("g1", 1, 0)]),
        grace_collision_event("main", 0, 3),
        true,
    );
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);
    let right = collision_glyph_edges(&dl, "main", smufl::AUGMENTATION_DOT).1;
    let left = collision_glyph_edges(&dl, "g1", smufl::ACCIDENTAL_SHARP).0;
    assert!(
        left - right >= 0.29 * config.sp,
        "principal dots/after-grace sharp gap={}sp",
        (left - right) / config.sp
    );
}

fn assert_grace_collision_reservation(after: bool, dots: bool) {
    let config = LayoutConfig::default();
    let spacing = |decorated: bool| {
        let score = grace_collision_score(
            serde_json::json!([
                grace_collision_event("g1", 0, if decorated && dots { 2 } else { 0 }),
                grace_collision_event("g2", i32::from(decorated && !dots), 0)
            ]),
            grace_collision_event("main", 0, 0),
            after,
        );
        let resolved = resolve_measures(&score, 0);
        crate::layout::spacing::build_log_spacing_for_resolved_measure(
            &resolved[0],
            4.0,
            0.5,
            &config,
            true,
        )
    };
    let plain = spacing(false);
    let decorated = spacing(true);
    let (plain_reserved, decorated_reserved) = if after {
        (plain.rigid_total, decorated.rigid_total)
    } else {
        (plain.rigid_widths[0], decorated.rigid_widths[0])
    };
    assert!(
        decorated_reserved > plain_reserved + 0.3,
        "grace ink must enlarge rigid reservation: plain={plain_reserved}, decorated={decorated_reserved}, after={after}, dots={dots}"
    );
}

#[test]
fn test_grace_collision_before_accidental_reservation() {
    assert_grace_collision_reservation(false, false);
}

#[test]
fn test_grace_collision_after_accidental_reservation() {
    assert_grace_collision_reservation(true, false);
}

#[test]
fn test_grace_collision_before_dot_reservation() {
    assert_grace_collision_reservation(false, true);
}

#[test]
fn test_grace_collision_after_dot_reservation() {
    assert_grace_collision_reservation(true, true);
}

#[test]
fn test_grace_collision_natural_cancellation_and_display_directives() {
    let config = LayoutConfig::default();
    for after in [false, true] {
        for enclosure in [false, true] {
            let first = grace_collision_event("g1", 1, 1);
            let mut second = grace_collision_event("g2", 0, 0);
            if enclosure {
                second["notes"][0]["accidentalDisplay"] = serde_json::json!({
                    "show": true, "force": true, "enclosure": {"symbol": "parentheses"}
                });
            }
            let score = grace_collision_score(
                serde_json::json!([first, second]),
                grace_collision_event("main", 0, 0),
                after,
            );
            let dl = layout_full_score(&score, &config);
            let right = collision_glyph_edges(&dl, "g1", smufl::AUGMENTATION_DOT).1;
            let left = collision_glyph_edges(&dl, "g2", smufl::ACCIDENTAL_NATURAL).0;
            let enclosure_width = if enclosure {
                (smufl::accidental_enclosure_width(true) + 0.06) * GRACE_SCALE * config.sp
            } else {
                0.0
            };
            assert!(left - enclosure_width - right >= 0.29 * config.sp);
        }
    }
}

#[test]
fn test_grace_collision_reservation_contains_compressed_ink() {
    let config = LayoutConfig::default();
    for after in [false, true] {
        let score = grace_collision_score(
            serde_json::json!([
                grace_collision_event("g1", 1, 2),
                grace_collision_event("g2", 0, 3)
            ]),
            grace_collision_event("main", 1, 0),
            after,
        );
        let resolved = resolve_measures(&score, 0);
        let spacing = crate::layout::spacing::build_log_spacing_for_resolved_measure(
            &resolved[0],
            4.0,
            0.5,
            &config,
            true,
        );
        let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, Some(1.0), &[], 0.5);
        let event = &ml.voice_layouts[0].events_vec()[0];
        let leftmost = event.grace_notes[0].x
            - if after {
                0.0
            } else {
                (smufl::accidental_width(1) + 0.20) * GRACE_SCALE * config.sp
            };
        let last = event.grace_notes.last().unwrap();
        let (dot_x, _, dot_width, _) = smufl::glyph_bbox(smufl::AUGMENTATION_DOT);
        let rightmost = last.x
            + GRACE_SCALE
                * config.sp
                * (smufl::notehead_right_extent(smufl::NOTEHEAD_BLACK) + 1.4 + dot_x + dot_width);
        if after {
            let tail = (spacing.rigid_total - spacing.rigid_widths[0]) * config.sp;
            let barline_buffer = crate::layout::render_barlines::trailing_barline_content_buffer_sp(
                &resolved[0],
                &config,
            ) * config.sp;
            assert!(rightmost + 0.49 * config.sp <= event.x + tail + barline_buffer);
        } else {
            assert!(leftmost >= ml.x + ml.prefix_width - 1e-9);
            assert!(event.x - leftmost <= spacing.rigid_widths[0] * config.sp + 1e-9);
            assert!(rightmost + 0.29 * config.sp < event.x);
        }
    }
}

#[test]
fn test_grace_collision_transposed_shaped_heads_preserve_source() {
    let config = LayoutConfig::default();
    let mut doc = grace_regression_document(
        serde_json::json!([
            {"type": "grace", "content": [
                {
                    "id": "g1", "duration": {"base": "eighth", "dots": 2},
                    "notes": [{"pitch": {"step": "C", "octave": 5},
                               "_x": {"viritura": {"notehead": "slash"}}}]
                },
                grace_collision_event("g2", 1, 0)
            ]},
            grace_collision_event("main", 0, 0)
        ]),
        0,
    );
    doc["parts"][0]["transposition"] = serde_json::json!({
        "interval": {"halfSteps": 2, "staffDistance": 1},
        "prefersWrittenPitches": true
    });
    let score = parse_mnx(&doc.to_string()).unwrap();
    let source_before = serde_json::to_value(&score).unwrap();
    let dl = layout_full_score(&score, &config);
    let right = collision_glyph_edges(&dl, "g1", smufl::AUGMENTATION_DOT).1;
    let left = collision_glyph_edges(&dl, "g2", smufl::ACCIDENTAL_SHARP).0;
    assert!(left - right >= 0.29 * config.sp);
    assert_eq!(serde_json::to_value(&score).unwrap(), source_before);
}

#[test]
fn test_grace_collision_omitted_clef_reserves_ledger_ink() {
    let config = LayoutConfig::default();
    let mut grace = grace_collision_event("g1", 1, 0);
    grace["notes"][0]["pitch"]["octave"] = serde_json::json!(3);
    let mut score = grace_collision_score(
        serde_json::json!([grace]),
        grace_collision_event("main", 0, 0),
        false,
    );
    score.parts[0].measures[0].clefs = None;
    let resolved = resolve_measures(&score, 0);
    let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, Some(1.0), &[], 0.5);
    let event = &ml.voice_layouts[0].events_vec()[0];
    let left = event.grace_notes[0].x
        - GRACE_SCALE * config.sp * (smufl::accidental_width(1) + 0.20 + config.ledger_extension);
    assert!(
        left >= ml.x + ml.prefix_width - 1e-9,
        "default-clef grace ink crossed content start by {}sp",
        (ml.x + ml.prefix_width - left) / config.sp
    );
}

#[test]
fn test_grace_collision_after_reservation_clears_next_voice_onset() {
    let config = LayoutConfig::default();
    let mut score = grace_collision_score(
        serde_json::json!([
            grace_collision_event("g1", 0, 2),
            grace_collision_event("g2", 1, 2)
        ]),
        grace_collision_event("main", 0, 0),
        true,
    );
    let other = minimal_spacing_score(
        r#"[{"measures":[{"sequences":[{"content":[
            {"duration":{"base":"quarter"},"rest":{}},
            {"duration":{"base":"quarter"},"notes":[{"pitch":{"step":"A","octave":5}}]}
        ]}]}]}]"#,
    );
    score.parts[0].measures[0]
        .sequences
        .push(other.parts[0].measures[0].sequences[0].clone());
    let resolved = resolve_measures(&score, 0);
    let spacing = crate::layout::spacing::build_log_spacing_for_resolved_measure(
        &resolved[0],
        4.0,
        0.5,
        &config,
        true,
    );
    let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], 0.5);
    let event = &ml.voice_layouts[0].events_vec()[0];
    let last = event.grace_notes.last().unwrap();
    let (dot_x, _, dot_width, _) = smufl::glyph_bbox(smufl::AUGMENTATION_DOT);
    let tail = last.x - event.x
        + GRACE_SCALE
            * config.sp
            * (smufl::notehead_right_extent(smufl::NOTEHEAD_BLACK) + 0.9 + dot_x + dot_width);
    let compressed_gap = spacing.lookup_x(1.0, 1.0, 0.0) - spacing.lookup_x(0.0, 1.0, 0.0);
    assert!(compressed_gap >= tail + 0.29 * config.sp);
    assert!(spacing.rigid_total <= spacing.total_width + 1e-9);
}

#[test]
fn test_grace_after_mid_clef_natural_clearance() {
    assert_after_grace_mid_clef_clearance(false);
}

#[test]
fn test_grace_after_mid_clef_compressed_clearance() {
    assert_after_grace_mid_clef_clearance(true);
}

fn assert_after_grace_mid_clef_clearance(compressed: bool) {
    let config = LayoutConfig::default();
    for decorated in [false, true] {
        let mut principal = grace_collision_event("main", 0, 0);
        principal["duration"] = serde_json::json!({"base": "quarter"});
        let mut next = grace_collision_event("next", i32::from(decorated), 0);
        next["notes"][0]["pitch"]["octave"] = serde_json::json!(3);
        let score = minimal_spacing_score(
            &serde_json::json!([{"measures": [{
                "clefs": [
                    {"clef": {"sign": "G", "staffPosition": -2}},
                    {"position": {"fraction": [1, 2]},
                     "clef": {"sign": "F", "staffPosition": 2}}
                ],
                "sequences": [
                    {"content": [principal, {"type": "grace", "content": [
                        grace_collision_event("g1", 0, 0),
                        grace_collision_event("g2", i32::from(decorated), 0),
                        grace_collision_event("g3", 0, if decorated { 2 } else { 0 })
                    ]}]},
                    {"content": [{"type": "space", "duration": [1, 2]}, next]}
                ]
            }]}])
            .to_string(),
        );
        let resolved = resolve_measures(&score, 0);
        let spacing = crate::layout::spacing::build_log_spacing_for_resolved_measure(
            &resolved[0],
            4.0,
            0.5,
            &config,
            true,
        );
        let ml = layout_measure(
            &resolved[0],
            config.sp,
            0.0,
            &config,
            compressed.then_some(1.0),
            &[],
            0.5,
        );
        let principal = &ml.voice_layouts[0].events_vec()[0];
        let last = principal.grace_notes.last().unwrap();
        let head_right = smufl::notehead_right_extent(smufl::NOTEHEAD_BLACK);
        let (dot_x, _, dot_width, _) = smufl::glyph_bbox(smufl::AUGMENTATION_DOT);
        let grace_right = last.x
            + GRACE_SCALE
                * config.sp
                * (head_right
                    + if decorated {
                        0.9 + dot_x + dot_width
                    } else {
                        0.0
                    });
        let clef = &ml.mid_clef_changes[0];
        let column = mid_clef_column_width_sp(&clef.clef) * config.sp;
        if compressed {
            let gap = spacing.lookup_x(2.0, 1.0, 0.0) - spacing.lookup_x(0.0, 1.0, 0.0);
            assert!(
                gap + 1e-9 >= grace_right - principal.x + column,
                "compressed gap {gap} must contain after-grace ink {} plus clef column {column}",
                grace_right - principal.x
            );
        }
        assert!(
            clef.x + 1e-9 >= grace_right,
            "clef column starts at {}sp but after-grace ink ends at {}sp (compressed={compressed}, decorated={decorated})",
            (clef.x - principal.x) / config.sp,
            (grace_right - principal.x) / config.sp
        );
        let next_left = ml.voice_layouts[1].events.x(0)
            - if decorated {
                (smufl::accidental_width(1) + 0.20) * config.sp
            } else {
                0.0
            };
        assert!(clef.x + column <= next_left + 1e-9);
        assert!(spacing.rigid_total <= spacing.total_width + 1e-9);
    }
}

#[test]
fn test_grace_full_score_shapes_dots_and_explicit_accidentals() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    for (shape, duration, cp) in [
        ("diamond", "half", smufl::NOTEHEAD_DIAMOND_HALF),
        ("x", "eighth", smufl::NOTEHEAD_X_BLACK),
    ] {
        let mut grace = grace_regression_event("g", "E", -1);
        grace["duration"] = serde_json::json!({"base": duration, "dots": 2});
        grace["notes"][0]["_x"] = serde_json::json!({"viritura": {"notehead": shape}});
        grace["notes"][0]["accidentalDisplay"] = serde_json::json!({
            "show": true, "force": true, "enclosure": {"symbol": "parentheses"}
        });
        let mut principal = grace_regression_event("main", "E", 0);
        principal["duration"] = serde_json::json!({"base": "whole"});
        let doc = grace_regression_document(
            serde_json::json!([{"type": "grace", "content": [grace]}, principal]),
            0,
        );
        let score = parse_mnx(&doc.to_string()).unwrap();
        let dl = layout_full_score(&score, &config);
        let heads = grace_glyph_positions(&dl, cp, sp);
        assert_eq!(heads.len(), 1, "{shape}");
        let (head_x, head_y) = heads[0];
        let principal_y = dl
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    codepoint, y, size, ..
                } if *codepoint == smufl::NOTEHEAD_WHOLE && (*size - 4.0 * sp).abs() < 1e-9 => {
                    Some(*y)
                }
                _ => None,
            })
            .unwrap();
        assert!(
            (head_y - principal_y).abs() < 1e-9,
            "same pitch, full staff grid"
        );
        let dots = grace_glyph_positions(&dl, smufl::AUGMENTATION_DOT, sp);
        assert_eq!(dots.len(), 2);
        assert!(dots[0].0 > head_x);
        assert!((dots[1].0 - dots[0].0 - 0.5 * sp * GRACE_SCALE).abs() < 1e-9);
        for (_, dot_y) in dots {
            assert!((dot_y - (head_y - 0.5 * sp)).abs() < 1e-9);
        }
        let flats = grace_glyph_positions(&dl, smufl::ACCIDENTAL_FLAT, sp);
        assert_eq!(flats.len(), 1);
        assert!(flats[0].0 < head_x);
        assert!((flats[0].1 - head_y).abs() < 1e-9);
        let left = grace_glyph_positions(&dl, smufl::ACCIDENTAL_PARENS_LEFT, sp);
        let right = grace_glyph_positions(&dl, smufl::ACCIDENTAL_PARENS_RIGHT, sp);
        assert_eq!(left.len(), 1);
        assert_eq!(right.len(), 1);
        assert!(left[0].0 < flats[0].0 && flats[0].0 < right[0].0);
    }
}

#[test]
fn test_grace_full_score_accidental_visibility_directives() {
    for explicit_only in [false, true] {
        let mut hidden = grace_regression_event("hidden", "F", 1);
        hidden["notes"][0]["accidentalDisplay"] = serde_json::json!({"show": false});
        let mut forced = grace_regression_event("forced", "F", 1);
        forced["notes"][0]["accidentalDisplay"] = serde_json::json!({
            "show": true, "force": true, "enclosure": {"symbol": "brackets"}
        });
        let automatic = grace_regression_event("automatic", "G", 1);
        let doc_content = serde_json::json!([
            {"type": "grace", "content": [hidden, forced, automatic]},
            {"duration": {"base": "whole"}, "rest": {}}
        ]);
        let mut doc = grace_regression_document(doc_content, 0);
        doc["mnx"]["support"] = serde_json::json!({"useAccidentalDisplay": explicit_only});
        let score = parse_mnx(&doc.to_string()).unwrap();
        let config = LayoutConfig::default();
        let dl = layout_full_score(&score, &config);
        assert_eq!(
            grace_accidental_codepoints(&dl, config.sp),
            vec![smufl::ACCIDENTAL_SHARP; if explicit_only { 1 } else { 2 }],
            "explicit_only={explicit_only}"
        );
        for cp in [
            smufl::ACCIDENTAL_BRACKET_LEFT,
            smufl::ACCIDENTAL_BRACKET_RIGHT,
        ] {
            assert_eq!(grace_glyph_positions(&dl, cp, config.sp).len(), 1);
        }
    }
}

#[test]
fn test_grace_full_score_automatic_accidentals_match_ordinary_state() {
    let config = LayoutConfig::default();
    let events: Vec<_> = [1, 1, 0, 0, 1, 1]
        .iter()
        .enumerate()
        .map(|(i, alter)| grace_regression_event(&format!("g{i}"), "F", *alter))
        .collect();
    let grace_doc = grace_regression_document(
        serde_json::json!([
            {"type": "grace", "content": events},
            {"duration": {"base": "whole"}, "rest": {}}
        ]),
        1,
    );
    let ordinary_doc = grace_regression_document(serde_json::json!(events), 1);
    let grace_dl = layout_full_score(&parse_mnx(&grace_doc.to_string()).unwrap(), &config);
    let ordinary_dl = layout_full_score(&parse_mnx(&ordinary_doc.to_string()).unwrap(), &config);
    let grace_accidentals = grace_accidental_codepoints(&grace_dl, config.sp);
    // G major supplies the initial F sharp; only cancellation and restoration print.
    assert_eq!(
        grace_accidentals,
        vec![smufl::ACCIDENTAL_NATURAL, smufl::ACCIDENTAL_SHARP]
    );
    let ordinary_accidentals: Vec<_> = ordinary_dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph { codepoint, .. } if is_accidental_glyph(command) => {
                Some(*codepoint)
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        ordinary_accidentals[0],
        smufl::ACCIDENTAL_SHARP,
        "key signature"
    );
    assert_eq!(grace_accidentals, ordinary_accidentals[1..]);
}

#[test]
fn test_grace_full_score_transposition_preserves_source_inside_tuplets() {
    let config = LayoutConfig::default();
    for nested in [false, true] {
        for (step, alter, fifths, force, written_step, written_alter, expected_count) in [
            ("C", 1, 0, false, "D", 1, 1),
            ("C", 1, 2, false, "D", 1, 0),
            ("B", 0, 0, true, "C", 1, 1),
        ] {
            let mut grace = grace_regression_event("g", step, alter);
            if force {
                grace["notes"][0]["accidentalDisplay"] =
                    serde_json::json!({"show": true, "force": true});
            }
            let mut content = serde_json::json!([
                {"type": "grace", "content": [grace]},
                grace_regression_event("main1", "E", 0),
                grace_regression_event("main2", "E", 0),
                grace_regression_event("main3", "E", 0)
            ]);
            if nested {
                content = serde_json::json!([{
                    "type": "tuplet",
                    "outer": {"duration": {"base": "quarter"}, "multiple": 1},
                    "inner": {"duration": {"base": "eighth"}, "multiple": 3},
                    "content": content
                }]);
            }
            let mut doc = grace_regression_document(content, fifths);
            doc["parts"][0]["transposition"] = serde_json::json!({
                "interval": {"halfSteps": 2, "staffDistance": 1},
                "prefersWrittenPitches": true
            });
            let score = parse_mnx(&doc.to_string()).unwrap();
            let source_before = serde_json::to_value(&score).unwrap();
            let resolved = resolve_measures(&score, 0);
            let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
            let shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);
            let ml = layout_measure(&resolved[0], config.sp, 0.0, &config, None, &[], shortest);
            let graces: Vec<_> = ml
                .voice_layouts
                .iter()
                .flat_map(|voice| {
                    voice
                        .events_vec()
                        .into_iter()
                        .flat_map(|event| event.grace_notes.clone())
                })
                .collect();
            assert_eq!(graces.len(), 1, "nested={nested}");
            let gn = &graces[0];
            assert_eq!(gn.event.notes()[0].pitch.step, step);
            assert_eq!(gn.event.notes()[0].pitch.alter.unwrap_or(0), alter);
            assert_eq!(gn.event.notes()[0].pitch.octave, 4);
            assert_eq!(gn.display_pitches.len(), 1);
            assert_eq!(gn.display_pitches[0].step, written_step);
            assert_eq!(gn.display_pitches[0].alter.unwrap_or(0), written_alter);
            assert_eq!(
                gn.display_pitches[0].octave,
                if step == "B" { 5 } else { 4 }
            );
            assert_eq!(gn.note_positions, vec![if step == "B" { 3.0 } else { 9.0 }]);
            let dl = layout_full_score(&score, &config);
            assert_eq!(
                grace_accidental_codepoints(&dl, config.sp),
                vec![smufl::ACCIDENTAL_SHARP; expected_count],
                "nested={nested}, source={step}, fifths={fifths}"
            );
            assert_eq!(
                grace_glyph_positions(&dl, smufl::NOTEHEAD_BLACK, config.sp).len(),
                1
            );
            assert_eq!(serde_json::to_value(&score).unwrap(), source_before);
        }
    }
}

#[test]
fn test_grace_full_score_beamed_diamonds_use_scaled_shape_anchors() {
    let config = LayoutConfig::default();
    let sp = config.sp;
    let events: Vec<_> = ["E", "G"]
        .iter()
        .enumerate()
        .map(|(i, step)| {
            let mut event = grace_regression_event(&format!("g{i}"), step, 0);
            event["notes"][0]["_x"] = serde_json::json!({"viritura": {"notehead": "diamond"}});
            event
        })
        .collect();
    let doc = grace_regression_document(
        serde_json::json!([
            {"type": "grace", "slash": false, "content": events},
            {"duration": {"base": "whole"}, "rest": {}}
        ]),
        0,
    );
    let dl = layout_full_score(&parse_mnx(&doc.to_string()).unwrap(), &config);
    let heads = grace_glyph_positions(&dl, smufl::NOTEHEAD_DIAMOND_BLACK, sp);
    assert_eq!(heads.len(), 2);
    assert!(
        (heads[0].1 - heads[1].1 - sp).abs() < 1e-9,
        "full-size staff grid"
    );
    assert!(!dl.commands.iter().any(is_flag_glyph));
    assert!(dl.commands.iter().any(is_beam_polygon));
    for (x, y) in heads {
        // Bravura's black diamond up-stem anchor is (1, 0), not the oval's corner.
        let stem_x = x + sp * GRACE_SCALE - config.stem_width * sp * 0.5;
        assert!(
            dl.commands.iter().any(|command| matches!(
                command,
                RenderCommand::DrawLine { x1, x2, y1, y2, width, .. }
                    if (*x1 - stem_x).abs() < 1e-9
                        && (*x2 - stem_x).abs() < 1e-9
                        && (*y2 - y).abs() < 1e-9
                        && *y1 < y
                        && (*width - config.stem_width * sp).abs() < 1e-9
            )),
            "beam stem must meet diamond at ({stem_x}, {y})"
        );
    }
}

#[test]
fn test_grace_full_score_kit_shapes_exclude_accidentals() {
    let mut doc = grace_regression_document(
        serde_json::json!([
            {"type": "grace", "content": [
                {"duration": {"base": "eighth"}, "kitNotes": [{"kitComponent": "snare"}]}
            ]},
            {"duration": {"base": "whole"}, "rest": {}}
        ]),
        0,
    );
    doc["parts"][0]["kit"] = serde_json::json!({
        "snare": {"name": "Snare", "staffPosition": 0,
            "_x": {"viritura": {"notehead": "x"}}}
    });
    let config = LayoutConfig::default();
    let score = parse_mnx(&doc.to_string()).unwrap();
    let dl = layout_full_score(&score, &config);
    assert_eq!(
        grace_glyph_positions(&dl, smufl::NOTEHEAD_X_BLACK, config.sp).len(),
        1
    );
    assert!(grace_accidental_codepoints(&dl, config.sp).is_empty());
}

#[test]
fn test_grace_note_layout_and_rendering() {
    // grace-note.mnx: grace B4 (eighth, acciaccatura) + whole C5
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-note.mnx").unwrap();
    let score = parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    // Should have at least one DrawGlyph for grace notehead (reduced size)
    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let grace_glyphs: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawGlyph { size, .. } if (*size - grace_glyph_size).abs() < 0.01)
    }).collect();
    assert!(
        !grace_glyphs.is_empty(),
        "Expected grace note glyphs at reduced size {:.1}, found none",
        grace_glyph_size
    );

    // Grace slurs are only rendered when explicitly defined in MNX.
    // This test does not define explicit slurs, so no beziers expected.
    let beziers: Vec<_> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        0,
        "No auto grace slurs expected (only explicit MNX slurs), got {}",
        beziers.len()
    );

    // Grace note should be positioned left of the main note
    let main_glyph_size = 4.0 * sp;
    let main_glyphs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - main_glyph_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_WHOLE {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    let grace_xs: Vec<f64> = grace_glyphs
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph { x, .. } = c {
                Some(*x)
            } else {
                None
            }
        })
        .collect();
    assert!(!main_glyphs.is_empty(), "Expected main whole-note glyph");
    assert!(!grace_xs.is_empty(), "Expected grace note glyph");
    assert!(
        grace_xs[0] < main_glyphs[0],
        "Grace note x ({:.1}) should be left of main note x ({:.1})",
        grace_xs[0],
        main_glyphs[0]
    );

    // Should have a slash line (DrawLine at an angle) for acciaccatura
    let slash_lines: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                // Slash is a diagonal line (x1 != x2 AND y1 != y2, not horizontal/vertical)
                let dx = (x2 - x1).abs();
                let dy = (y2 - y1).abs();
                dx > 0.1 && dy > 0.1 && dx < 2.0 * sp && dy < 2.0 * sp
            } else {
                false
            }
        })
        .collect();
    assert!(
        !slash_lines.is_empty(),
        "Expected at least one diagonal slash line for acciaccatura"
    );
}

#[test]
fn test_trailing_grace_notes_render_after_main_event() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "alter": 1, "octave": 5}}]},
            {"type": "grace", "content": [
                {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "alter": 1, "octave": 5}}]},
                {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "alter": 1, "octave": 5}}]}
            ]}
        ]}]}]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);
    let grace_size = 4.0 * sp * 0.65;
    let main_size = 4.0 * sp;
    let main_x = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } if (*size - main_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some(*x)
            }
            _ => None,
        })
        .expect("Expected principal quarter-note glyph");
    let grace_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some(*x)
            }
            _ => None,
        })
        .collect();

    assert_eq!(grace_xs.len(), 2, "Expected both trailing grace noteheads");
    assert!(
        grace_xs.iter().all(|x| *x > main_x),
        "Trailing grace noteheads should render after the principal note: main x={main_x}, grace xs={grace_xs:?}"
    );
}

#[test]
fn test_grace_notes_beamed() {
    // grace-notes-beamed.mnx: 3 grace note groups with beam definitions
    // Group 1: grace1+grace2 (2 eighths), Group 2: grace3+4+5 (3), Group 3: grace6+7+8+9 (4)
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;

    // Grace noteheads at reduced size — should have 9 total (2+3+4 grace notes)
    let grace_glyphs: Vec<_> = dl.commands.iter().filter(|c| {
        matches!(c, RenderCommand::DrawGlyph { size, .. } if (*size - grace_glyph_size).abs() < 0.01)
    }).collect();
    assert!(
        grace_glyphs.len() >= 9,
        "Expected at least 9 grace note glyphs, got {}",
        grace_glyphs.len()
    );

    // Beamed grace notes should NOT have flag glyphs
    // Flags use codepoints 0xE240-0xE24F (eighth flag up/down and higher)
    let grace_flags: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { size, codepoint, .. }
            if (*size - grace_glyph_size).abs() < 0.01
            && *codepoint >= 0xE240 && *codepoint <= 0xE24F)
        })
        .collect();
    assert_eq!(
        grace_flags.len(),
        0,
        "Beamed grace notes should have no flag glyphs, got {}",
        grace_flags.len()
    );

    // Should have beam polygons at grace scale
    // Beam thickness at grace scale = 0.5 * sp * 0.65
    let beam_thickness = 0.5 * sp * grace_scale;
    let grace_beams: Vec<_> = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawPolygon { points, color, .. }
            if points.len() == 4
            && ((points[3].1 - points[0].1).abs() - beam_thickness).abs() < 0.1
            && color == "#000000")
        })
        .collect();
    // 3 beam groups → at least 3 primary beams
    assert!(
        grace_beams.len() >= 3,
        "Expected at least 3 grace beam rectangles, got {}",
        grace_beams.len()
    );
}

#[test]
fn test_grace_notes_auto_beam_without_explicit_beams() {
    // Two 16th-note grace notes with no `beams` declared must auto-beam:
    // standard engraving practice beams a run of two or more eighth-or-shorter
    // grace notes. The individual flags must be suppressed and a grace-scale
    // beam polygon emitted (mirrors Rhapsody m138-139 cello/bass grace pairs).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "id": "g1", "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                    {"duration": {"base": "16th"}, "id": "g2", "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]},
                {"duration": {"base": "half"}, "id": "m1", "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = crate::parse::parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;

    // No flag glyphs on the grace notes — they are beamed instead.
    let grace_flags = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawGlyph { size, codepoint, .. }
            if (*size - grace_glyph_size).abs() < 0.01
            && *codepoint >= 0xE240 && *codepoint <= 0xE24F)
        })
        .count();
    assert_eq!(
        grace_flags, 0,
        "Auto-beamed grace notes should have no flag glyphs, got {grace_flags}"
    );

    // A grace-scale beam polygon must be present (two beams for 16th-note pair).
    let beam_thickness = 0.5 * sp * grace_scale;
    let grace_beams = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawPolygon { points, color, .. }
            if points.len() == 4
            && ((points[3].1 - points[0].1).abs() - beam_thickness).abs() < 0.1
            && color == "#000000")
        })
        .count();
    assert!(
        grace_beams >= 2,
        "Expected at least 2 grace beam polygons (16th pair), got {grace_beams}"
    );
}

#[test]
fn test_grace_slur_only_when_explicit_in_mnx() {
    // Grace slurs are only rendered when explicitly defined in MNX.
    // grace-notes-beamed.mnx does NOT have explicit slur definitions,
    // so no grace-to-main slurs should be rendered.
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let slur_count = dl
        .commands
        .iter()
        .filter(|c| matches!(c, RenderCommand::DrawFilledBezier { .. }))
        .count();
    assert_eq!(
        slur_count, 0,
        "No auto grace slurs expected without explicit MNX slur definitions, got {}",
        slur_count
    );
}

#[test]
fn test_grace_note_slur_to_main_renders() {
    // A grace note carrying an explicit slur targeting the following principal
    // note must render a slur. Grace notes live in EventLayout.grace_notes and
    // were previously not addressable as slur endpoints, so nothing was drawn.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "g1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}], "slurs": [{"target": "m1"}]}
                ]},
                {"id": "m1", "duration": {"base": "half"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        1,
        "Expected 1 slur bezier from grace note to main note, got {}",
        beziers.len()
    );

    // The slur should start at the grace note (left) and end at the main note (right).
    if let RenderCommand::DrawFilledBezier { x1, x2, .. } = beziers[0] {
        assert!(
            *x1 < *x2,
            "Grace→main slur should run left→right (x1={} x2={})",
            x1,
            x2
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }

    // The start endpoint must hug the grace note's (shorter) stem, not float a
    // full main-note stem-length above it. Locate the grace notehead glyph and
    // assert the slur's start Y sits within a grace-scaled stem reach of it.
    let sp = config.sp;
    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let grace_head_y = dl
        .commands
        .iter()
        .find_map(|c| match c {
            RenderCommand::DrawGlyph { y, size, .. } if (*size - grace_glyph_size).abs() < 0.01 => {
                Some(*y)
            }
            _ => None,
        })
        .expect("grace notehead glyph not found");
    if let RenderCommand::DrawFilledBezier { y1, .. } = beziers[0] {
        // A full main stem-length anchor would lift the tip ≳ stem_length·sp
        // (≈3.5 sp) above the head; the grace-scaled anchor keeps it under 3 sp.
        let lift = grace_head_y - *y1;
        assert!(
            lift < 3.0 * sp,
            "Grace slur start should hug the grace stem (lift={lift} sp_threshold={})",
            3.0 * sp
        );
        assert!(
            *y1 > grace_head_y,
            "single-voice grace slur should leave the grace notehead below"
        );
    } else {
        panic!("Expected DrawFilledBezier command");
    }
}

#[test]
fn test_upward_grace_slur_springs_from_grace_stem_top() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"type": "grace", "content": [
                {"id": "g", "duration": {"base": "eighth"},
                 "notes": [{"pitch": {"step": "C", "octave": 5}}],
                 "slurs": [{"target": "m"}]}
            ]},
            {"id": "m", "duration": {"base": "quarter"},
             "notes": [{"pitch": {"step": "G", "octave": 5}}]}
        ]}]}]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let grace_size = 4.0 * config.sp * 0.65;
    let (grace_x, grace_y) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                size,
                codepoint,
                ..
            } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some((*x, *y))
            }
            _ => None,
        })
        .expect("grace notehead");
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("slur");
    if let RenderCommand::DrawFilledBezier { x1, y1, .. } = slur {
        assert!(
            *y1 < grace_y - config.sp,
            "steep upward grace slur should start at the grace stem top: tip={y1}, head={grace_y}"
        );
        assert!(
            *x1 > grace_x,
            "grace stem-top endpoint should align with the up-stem side: tip={x1}, head={grace_x}"
        );
    }
}

#[test]
fn test_oboe_octave_grace_slur_auto_direction_uses_above_stem_top() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 2, "unit": 4}}]},
        "parts": [{"measures": [{"sequences": [{"content": [
            {"type": "grace", "slash": true, "content": [
                {"id": "oboe-grace", "duration": {"base": "eighth"},
                 "notes": [{"pitch": {"step": "E", "octave": 4}}],
                 "slurs": [{"target": "oboe-main"}]}
            ]},
            {"id": "oboe-main", "duration": {"base": "eighth"},
             "notes": [{"pitch": {"step": "E", "octave": 5}}]},
            {"duration": {"base": "quarter", "dots": 1}, "rest": {}}
        ]}]}]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let grace_size = 4.0 * config.sp * 0.65;
    let (grace_x, grace_y) = dl
        .commands
        .iter()
        .find_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                size,
                codepoint,
                ..
            } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some((*x, *y))
            }
            _ => None,
        })
        .expect("oboe grace notehead");
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("slur");
    if let RenderCommand::DrawFilledBezier {
        x1,
        y1,
        x2,
        y2,
        ocx1,
        ocy1,
        ocx2,
        ocy2,
        ..
    } = slur
    {
        assert!(
            *y1 < grace_y - config.sp,
            "automatic ascending grace slur must start at stem top"
        );
        assert!(
            *x1 > grace_x,
            "automatic ascending grace slur must align with up-stem side"
        );
        let chord_y = |x: f64| y1 + (y2 - y1) * ((x - x1) / (x2 - x1));
        assert!(
            *ocy1 < chord_y(*ocx1) && *ocy2 < chord_y(*ocx2),
            "lower grace to higher principal must form a cap-shaped arch, not a cup"
        );
    }
}

#[test]
fn test_grace_slur_moves_above_ledger_lines_and_measured_accidentals() {
    for target in [
        r#"{"step":"D","octave":7}"#,
        r#"{"step":"C","octave":5,"alter":1}"#,
    ] {
        let json = format!(
            r#"{{
                "mnx": {{"version": 1}},
                "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
                "parts": [{{"measures": [{{"sequences": [{{"content": [
                    {{"type":"grace","content":[{{"id":"g","duration":{{"base":"eighth"}},"notes":[{{"pitch":{{"step":"C","octave":7}}}}],"slurs":[{{"target":"m"}}]}}]}},
                    {{"id":"m","duration":{{"base":"quarter"}},"notes":[{{"pitch":{target}}}]}}
                ]}}]}}]}}]
            }}"#
        );
        let dl = layout_score(&parse_mnx(&json).unwrap(), 0, &LayoutConfig::default());
        let slur = dl
            .commands
            .iter()
            .find(|command| is_draw_bezier(command))
            .expect("grace slur");
        let grace_size = 4.0 * LayoutConfig::default().sp * 0.65;
        let main_size = 4.0 * LayoutConfig::default().sp;
        let grace_head = dl
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    y, size, codepoint, ..
                } if (*size - grace_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                    Some(*y)
                }
                _ => None,
            })
            .expect("grace notehead");
        let main_head = dl
            .commands
            .iter()
            .find_map(|command| match command {
                RenderCommand::DrawGlyph {
                    y, size, codepoint, ..
                } if (*size - main_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                    Some(*y)
                }
                _ => None,
            })
            .expect("main notehead");
        let (y1, y2) = super::test_helpers::bezier_endpoints_y(slur);
        assert!(
            y1 < grace_head && y2 < main_head,
            "ledger-line or accidental risk should move both tips above their noteheads: y1={y1}, grace={grace_head}, y2={y2}, main={main_head}"
        );
    }
}

#[test]
fn test_grace_slur_defaults_to_uppermost_resolving_note_of_chord() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        {"type": "grace", "content": [
                            {"id": "g", "duration": {"base": "eighth"},
                             "notes": [{"pitch": {"step": "D", "octave": 5}}],
                             "slurs": [{"target": "m"}]}
                        ]},
                        {"id": "m", "duration": {"base": "quarter"}, "notes": [
                            {"pitch": {"step": "C", "octave": 5}},
                            {"pitch": {"step": "E", "octave": 5}}
                        ]}
                    ]
                }]
            }]
        }]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur = dl
        .commands
        .iter()
        .find(|command| is_draw_bezier(command))
        .expect("slur");
    let (_, y2) = super::test_helpers::bezier_endpoints_y(slur);
    let mut main_noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                y, size, codepoint, ..
            } if (*size - 4.0 * config.sp).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK => {
                Some(*y)
            }
            _ => None,
        })
        .collect();
    main_noteheads.sort_by(f64::total_cmp);
    assert_eq!(main_noteheads.len(), 2);
    assert!(
        y2 < (main_noteheads[0] + main_noteheads[1]) * 0.5,
        "grace slur should resolve toward upper chord note: endpoint={y2}, heads={main_noteheads:?}"
    );
}

#[test]
fn test_each_authored_grace_group_keeps_an_independent_slur() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{
            "measures": [{
                "sequences": [{
                    "content": [
                        {"type": "grace", "content": [
                            {"id": "g1", "duration": {"base": "eighth"},
                             "notes": [{"pitch": {"step": "D", "octave": 5}}],
                             "slurs": [{"target": "m1"}]}
                        ]},
                        {"id": "m1", "duration": {"base": "quarter"},
                         "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                        {"type": "grace", "content": [
                            {"id": "g2", "duration": {"base": "eighth"},
                             "notes": [{"pitch": {"step": "F", "octave": 5}}],
                             "slurs": [{"target": "m2"}]}
                        ]},
                        {"id": "m2", "duration": {"base": "quarter"},
                         "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                    ]
                }]
            }]
        }]
    }"#;
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &LayoutConfig::default());
    assert_eq!(
        dl.commands
            .iter()
            .filter(|command| is_draw_bezier(command))
            .count(),
        2,
        "each authored grace group should retain its own slur"
    );
}

#[test]
fn test_grace_slur_targeting_tie_start_stops_at_first_notehead() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "gtg", "duration": {"base": "eighth"},
                     "notes": [{"id": "gtgn", "pitch": {"step": "D", "octave": 5}}],
                     "slurs": [{"target": "gt1"}]}
                ]},
                {"id": "gt1", "duration": {"base": "quarter"},
                 "notes": [{"id": "gtn1", "pitch": {"step": "C", "octave": 5},
                            "ties": [{"target": "gtn2"}]}]},
                {"id": "gt2", "duration": {"base": "quarter"},
                 "notes": [{"id": "gtn2", "pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "half"}, "rest": {}}
            ]}]
        }]}]
    }"#;
    let config = LayoutConfig::default();
    let dl = layout_score(&parse_mnx(json).unwrap(), 0, &config);
    let slur_x2 = dl
        .commands
        .iter()
        .enumerate()
        .find_map(|(index, command)| match command {
            RenderCommand::DrawFilledBezier { x2, .. }
                if dl
                    .element_ids
                    .get(index)
                    .and_then(Option::as_ref)
                    .is_some_and(|id| id.starts_with("slur/")) =>
            {
                Some(*x2)
            }
            _ => None,
        })
        .expect("grace slur");
    let event_notehead_x = |event_id: &str| {
        dl.commands
            .iter()
            .enumerate()
            .find_map(|(index, command)| match command {
                RenderCommand::DrawGlyph { x, size, .. }
                    if (*size - 4.0 * config.sp).abs() < 0.01
                        && dl
                            .element_ids
                            .get(index)
                            .and_then(Option::as_ref)
                            .is_some_and(|id| id.contains(event_id)) =>
                {
                    Some(*x + config.notehead_rx * config.sp)
                }
                _ => None,
            })
            .unwrap_or_else(|| panic!("notehead for {event_id}"))
    };
    let first_x = event_notehead_x("/gt1");
    let chain_end_x = event_notehead_x("/gt2");
    assert!(
        (slur_x2 - first_x).abs() < (slur_x2 - chain_end_x).abs(),
        "grace slur end x={slur_x2:.3} must stop at first tied head x={first_x:.3}, not chain end x={chain_end_x:.3}"
    );
}

#[test]
fn test_main_note_slur_to_grace_renders() {
    // The reverse direction: a principal note slurred to a following grace note.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"id": "m1", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"target": "g1"}]},
                {"type": "grace", "content": [
                    {"id": "g1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"id": "m2", "duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let beziers: Vec<&RenderCommand> = dl.commands.iter().filter(|c| is_draw_bezier(c)).collect();
    assert_eq!(
        beziers.len(),
        1,
        "Expected 1 slur bezier from main note to grace note, got {}",
        beziers.len()
    );
}

#[test]
fn test_grace_to_main_slur_across_measures_same_system() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "g1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}], "slurs": [{"target": "m2"}]}
                ]},
                {"id": "m1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]},
            {"sequences": [{"content": [
                {"id": "m2", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    assert_eq!(
        dl.commands
            .iter()
            .filter(|command| is_draw_bezier(command))
            .count(),
        1,
        "grace-to-main slur should resolve across a barline"
    );
}

#[test]
fn test_main_to_grace_slur_across_measures_same_system() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {"time": {"count": 4, "unit": 4}}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"id": "m1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}], "slurs": [{"target": "g2"}]}
            ]}]},
            {"sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "g2", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"id": "m2", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    assert_eq!(
        dl.commands
            .iter()
            .filter(|command| is_draw_bezier(command))
            .count(),
        1,
        "main-to-grace slur should resolve across a barline"
    );
}

#[test]
fn test_grace_note_always_stem_up_main_stem_up() {
    // Standard engraving practice: grace notes are always stem-up, even when the
    // main note (C4, below middle line) is stem up.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let event = &ml.voice_layouts[0].events_vec()[0];

    assert!(
        event.stem_up,
        "Main note C4 (below middle) should have stem up"
    );
    assert!(
        !event.grace_notes.is_empty(),
        "Event should have grace notes"
    );
    assert!(
        event.grace_notes[0].stem_up,
        "Grace note should always be stem up"
    );
}

#[test]
fn test_grace_note_always_stem_up_main_stem_down() {
    // Standard engraving practice: grace notes are always stem-up, even when the
    // main note (A5, above middle line) is stem down.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let event = &ml.voice_layouts[0].events_vec()[0];

    assert!(
        !event.stem_up,
        "Main note A5 (above middle) should have stem down"
    );
    assert!(
        !event.grace_notes.is_empty(),
        "Event should have grace notes"
    );
    assert!(
        event.grace_notes[0].stem_up,
        "Grace note should always be stem up"
    );
}

#[test]
fn test_grace_note_always_stem_up_in_multivoice() {
    // Grace notes are always stem-up, including in multi-voice contexts.
    // Voice 0 → stem up, voice 1 → stem down; the grace stays up regardless.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [
                {"content": [
                    {"type": "grace", "content": [
                        {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                    ]},
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]},
                {"content": [
                    {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}
            ]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let event = &ml.voice_layouts[0].events_vec()[0];

    assert!(event.stem_up, "Voice 0 should have stem up in multi-voice");
    assert!(
        !event.grace_notes.is_empty(),
        "Event should have grace notes"
    );
    assert!(
        event.grace_notes[0].stem_up,
        "Grace note should always be stem up in multi-voice"
    );
}

#[test]
fn test_grace_beamed_stems_connect_to_beam() {
    // Verify that beamed grace note stems extend to the beam line,
    // not a fixed stem length.
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let beam_thickness = 0.5 * sp * grace_scale;

    // Collect beam polygon Y-ranges (bottom-left Y and top-left Y of each grace beam)
    let grace_beams: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawPolygon { points, .. } = c {
                if points.len() == 4 {
                    let thickness = (points[3].1 - points[0].1).abs();
                    if (thickness - beam_thickness).abs() < 0.15 {
                        // (x_left, y_top_left, x_right, y_top_right) for stem-up beam
                        let y_top = points[0].1.min(points[3].1);
                        let y_bottom = points[0].1.max(points[3].1);
                        return Some((points[0].0, y_top, points[1].0, y_bottom));
                    }
                }
            }
            None
        })
        .collect();
    assert!(!grace_beams.is_empty(), "Expected grace beam polygons");

    // Collect grace notehead X positions (reduced-size glyphs)
    let grace_notehead_xs: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - grace_glyph_size).abs() < 0.01
                    && (*codepoint == smufl::NOTEHEAD_BLACK || *codepoint == smufl::NOTEHEAD_HALF)
                {
                    return Some(*x);
                }
            }
            None
        })
        .collect();
    assert!(
        grace_notehead_xs.len() >= 2,
        "Need at least 2 grace noteheads"
    );

    // Collect all vertical stems (DrawLine with x1 == x2)
    let stems: Vec<(f64, f64, f64, f64)> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawLine { x1, y1, x2, y2, .. } = c {
                if (x1 - x2).abs() < 0.01 {
                    return Some((*x1, y1.min(*y2), *x2, y1.max(*y2)));
                }
            }
            None
        })
        .collect();

    // For each grace beam, verify stems at both ends touch the beam Y range
    for (bx_left, by_top, bx_right, by_bottom) in &grace_beams {
        // Find stems near the beam's left and right X
        let tolerance = config.notehead_rx * 2.0 * sp;
        let stems_near_beam: Vec<&(f64, f64, f64, f64)> = stems
            .iter()
            .filter(|(sx, sy_top, _, sy_bottom)| {
                *sx >= bx_left - tolerance
                    && *sx <= bx_right + tolerance
                    && (*sy_top <= by_bottom + 0.5 && *sy_bottom >= by_top - 0.5)
            })
            .collect();
        // At least 2 stems should touch each beam (one at each end)
        assert!(stems_near_beam.len() >= 2,
            "Expected at least 2 stems touching grace beam at x=[{:.1},{:.1}], y=[{:.1},{:.1}], found {}",
            bx_left, bx_right, by_top, by_bottom, stems_near_beam.len());
    }
}

#[test]
fn test_grace_beamed_no_fixed_length_stems() {
    // Beamed grace notes should NOT have stems drawn at the fixed stem length.
    // Instead, stems should extend to the beam position.
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let dl = layout_score(&score, 0, &config);

    let grace_scale = 0.65;
    let grace_glyph_size = 4.0 * sp * grace_scale;
    let beam_thickness = 0.5 * sp * grace_scale;

    // Count grace beams
    let grace_beam_count = dl
        .commands
        .iter()
        .filter(|c| {
            matches!(c, RenderCommand::DrawPolygon { points, .. }
            if points.len() == 4
            && ((points[3].1 - points[0].1).abs() - beam_thickness).abs() < 0.15)
        })
        .count();
    assert!(
        grace_beam_count >= 3,
        "Expected >= 3 grace beams, got {}",
        grace_beam_count
    );

    // Count grace noteheads
    let _grace_noteheads: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|c| {
            if let RenderCommand::DrawGlyph {
                x, size, codepoint, ..
            } = c
            {
                if (*size - grace_glyph_size).abs() < 0.01 && *codepoint == smufl::NOTEHEAD_BLACK {
                    return Some(*x);
                }
            }
            None
        })
        .collect();

    // Verify beam thickness is consistently scaled at 0.65x
    let expected_beam_thickness = 0.5 * sp * grace_scale;
    for cmd in &dl.commands {
        if let RenderCommand::DrawPolygon { points, .. } = cmd {
            if points.len() == 4 {
                let thickness = (points[3].1 - points[0].1).abs();
                if (thickness - expected_beam_thickness).abs() < 0.15 {
                    // This is a grace beam — verify thickness
                    assert!(
                        (thickness - expected_beam_thickness).abs() < 0.15,
                        "Grace beam thickness {:.3} should be ~{:.3}",
                        thickness,
                        expected_beam_thickness
                    );
                }
            }
        }
    }
}

#[test]
fn test_grace_notes_tagged_with_element_ids() {
    // Grace notes should be tagged with element IDs for hit-testing / selection.
    // Format: p{part}/m{measure}/s{voice}/grace/{id}
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "gr1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Find all element IDs containing "grace"
    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    assert!(
        !grace_ids.is_empty(),
        "Expected grace note element IDs, got none"
    );

    // Should follow the format p0/m0/s0/grace/gr1
    assert!(
        grace_ids.iter().any(|id| id.contains("grace/gr1")),
        "Expected grace ID containing 'grace/gr1', got: {:?}",
        grace_ids
    );
}

#[test]
fn test_grace_notes_tagged_fallback_index() {
    // When grace notes have no explicit ID, fallback to g{index}
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    assert!(
        !grace_ids.is_empty(),
        "Expected grace note element IDs with fallback index"
    );

    // With no explicit id, should use e0
    assert!(
        grace_ids.iter().any(|id| id.contains("grace/e0")),
        "Expected fallback grace ID 'grace/e0', got: {:?}",
        grace_ids
    );
}

#[test]
fn test_grace_notes_tagged_separate_from_main_event() {
    // Grace note commands should have different element IDs from the main event
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"id": "gr1", "duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}
                ]},
                {"id": "ev1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    let main_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/ev1") && !eid.contains("/grace/"))
        .collect();

    assert!(!grace_ids.is_empty(), "Expected grace element IDs");
    assert!(!main_ids.is_empty(), "Expected main event element IDs");

    // Grace and main IDs should be distinct
    for gid in &grace_ids {
        assert!(
            !main_ids.contains(gid),
            "Grace ID {} should differ from main event IDs",
            gid
        );
    }
}

#[test]
fn test_grace_notes_beamed_tagged() {
    // Beamed grace notes should all be tagged
    let mnx = std::fs::read_to_string("../../packages/format/fixtures/mnx/grace-notes-beamed.mnx")
        .expect("grace-notes-beamed.mnx missing");
    let score = crate::parse::parse_mnx(&mnx).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let grace_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|eid| eid.as_ref())
        .filter(|eid| eid.contains("/grace/"))
        .collect();
    // grace-notes-beamed.mnx has 3 grace groups with 2+3+4 = 9 grace events
    // Each grace note should produce at least one tagged command
    assert!(
        grace_ids.len() >= 9,
        "Expected at least 9 tagged grace note commands (one per grace note), got {}",
        grace_ids.len()
    );
}

// ═══════════════════════════════════════════
// Grace note spacing integration tests
// ═══════════════════════════════════════════

#[test]
fn test_grace_notes_do_not_overflow_measure_width() {
    // Grace notes at the start of a measure should be accounted for in the
    // measure's natural width. No event should extend past measure_x + measure_width.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}
                ]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]},
                {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "A", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    // Use natural width (no forced width)
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let measure_end = ml.x + ml.width;

    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            assert!(
                el.x < measure_end,
                "Event at x={:.1} exceeds measure end {:.1}",
                el.x,
                measure_end
            );
            for gn in &el.grace_notes {
                assert!(
                    gn.x >= ml.x,
                    "Grace note at x={:.1} is before measure start {:.1}",
                    gn.x,
                    ml.x
                );
            }
        }
    }
}

#[test]
fn test_grace_spacing_preserves_cross_staff_alignment() {
    // Two staves: one with grace notes, one without.
    // Both should share the same beat→x mapping so events at the same beat align.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"name": "Staff1", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"type": "grace", "content": [
                        {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                    ]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]}]
            }],
            "staves": 1},
            {"name": "Staff2", "measures": [{
                "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
                "sequences": [{"content": [
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]},
                    {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]},
                    {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}
                ]}]
            }],
            "staves": 1}
        ]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_full_score(&score, &config);
    let main_glyph_size = 4.0 * config.sp;
    let mut all_noteheads: Vec<(f64, f64)> = Vec::new(); // (x, y)
    for cmd in &dl.commands {
        if let RenderCommand::DrawGlyph {
            x,
            y,
            size,
            codepoint,
            ..
        } = cmd
        {
            if (*size - main_glyph_size).abs() < 0.01
                && (*codepoint == smufl::NOTEHEAD_BLACK
                    || *codepoint == smufl::NOTEHEAD_HALF
                    || *codepoint == smufl::NOTEHEAD_WHOLE)
            {
                all_noteheads.push((*x, *y));
            }
        }
    }

    assert!(
        all_noteheads.len() >= 6,
        "Expected at least 6 noteheads (3 per staff), got {}",
        all_noteheads.len()
    );

    // Split into two groups by Y: staff 1 (lower Y) and staff 2 (higher Y)
    all_noteheads.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    let mid_y = (all_noteheads.first().unwrap().1 + all_noteheads.last().unwrap().1) / 2.0;
    let staff1_xs: Vec<f64> = all_noteheads
        .iter()
        .filter(|(_, y)| *y < mid_y)
        .map(|(x, _)| *x)
        .collect();
    let staff2_xs: Vec<f64> = all_noteheads
        .iter()
        .filter(|(_, y)| *y > mid_y)
        .map(|(x, _)| *x)
        .collect();

    assert!(
        staff1_xs.len() >= 3,
        "Staff 1 should have >= 3 noteheads, got {}",
        staff1_xs.len()
    );
    assert!(
        staff2_xs.len() >= 3,
        "Staff 2 should have >= 3 noteheads, got {}",
        staff2_xs.len()
    );

    // Sort by x within each staff
    let mut s1 = staff1_xs.clone();
    s1.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut s2 = staff2_xs.clone();
    s2.sort_by(|a, b| a.partial_cmp(b).unwrap());

    // The beat-1 event (second notehead) and beat-2 event (third notehead) should
    // align vertically between staves within a small tolerance.
    // Staff 1's beat-1 note is the 2nd note (index 1), staff 2's is also index 1.
    let tolerance = 3.0; // pixels — tolerance for stem/layout differences
    let s1_beat1 = s1[1];
    let s2_beat1 = s2[1];
    assert!(
        (s1_beat1 - s2_beat1).abs() < tolerance,
        "Beat 1 notes should align: staff1 x={:.1}, staff2 x={:.1}, diff={:.1}",
        s1_beat1,
        s2_beat1,
        (s1_beat1 - s2_beat1).abs()
    );

    let s1_beat2 = s1[2];
    let s2_beat2 = s2[2];
    assert!(
        (s1_beat2 - s2_beat2).abs() < tolerance,
        "Beat 2 notes should align: staff1 x={:.1}, staff2 x={:.1}, diff={:.1}",
        s1_beat2,
        s2_beat2,
        (s1_beat2 - s2_beat2).abs()
    );
}

#[test]
fn test_grace_notes_left_of_main_event_after_spacing() {
    // After the spacing-map-based layout, grace notes should still be positioned
    // to the left of their main event.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);

    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            for gn in &el.grace_notes {
                assert!(
                    gn.x < el.x,
                    "Grace note at x={:.1} should be left of main event at x={:.1}",
                    gn.x,
                    el.x
                );
            }
        }
    }
}

#[test]
fn test_grace_spacing_with_forced_width_no_overflow() {
    // When a forced width is applied (system justification), grace notes should
    // still fit within the measure — the proportional scaling should handle it.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 5}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    // Use a forced width slightly larger than natural
    let natural = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let forced_w = natural.width * 1.2;
    let ml = layout_measure(
        &resolved[0],
        sp,
        0.0,
        &config,
        Some(forced_w),
        &[],
        common_shortest,
    );
    let measure_end = ml.x + ml.width;

    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            assert!(
                el.x < measure_end,
                "Event at x={:.1} exceeds forced measure end {:.1}",
                el.x,
                measure_end
            );
        }
    }
}

#[test]
fn test_measure_start_grace_does_not_cross_barline_under_compression() {
    // A grace note on the FIRST beat of a measure reserves a fixed pixel band to
    // the left of its main event. That reservation must be RIGID: under heavy
    // horizontal compression the elastic duration springs collapse, and if the
    // grace reservation compressed with them the fixed-width grace glyphs would
    // overflow left of the measure content — visually spilling over the
    // preceding barline. The grace notehead must stay at or right of the
    // measure's content start (left barline + prefix).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "G", "octave": 2}}]},
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "A", "octave": 2}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "B", "octave": 2}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);

    // Compress hard: half the natural width.
    let natural = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);
    let forced_w = natural.width * 0.5;
    let ml = layout_measure(
        &resolved[0],
        sp,
        0.0,
        &config,
        Some(forced_w),
        &[],
        common_shortest,
    );

    let content_start = ml.x + ml.prefix_width;
    let mut found_grace = false;
    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            for gn in &el.grace_notes {
                found_grace = true;
                assert!(
                    gn.x >= content_start - 0.01,
                    "Measure-start grace at x={:.1} crossed the content start {:.1} (over the barline)",
                    gn.x,
                    content_start
                );
            }
        }
    }
    assert!(found_grace, "Expected at least one grace note");
}

#[test]
fn test_grace_notes_clear_main_event_accidental() {
    // A grace note in front of a main note that carries an accidental must be
    // placed left of that accidental's column, not overlapping it. The main
    // note here is a flat (not in C major), forcing a flat glyph to the left of
    // its notehead.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
                ]},
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 5, "alter": -1}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);

    let el = &ml.voice_layouts[0].events_vec()[0];
    assert_eq!(el.grace_notes.len(), 1, "Expected one grace note");
    let grace_scale = 0.65;
    let grace_nw = config.notehead_rx * 2.0 * grace_scale * sp;
    let grace_right_edge = el.grace_notes[0].x + grace_nw;

    // The accidental column extends left of the notehead (el.x). The grace
    // note's right edge must stay left of the accidental's left edge.
    let acc_extent = el
        .event
        .notes
        .as_ref()
        .map(|notes| {
            crate::layout::spacing::event_accidental_extent_sp(
                notes,
                &resolved[0].active_key,
                &mut std::collections::HashMap::new(),
                None,
                0.0,
                None,
            ) * sp
        })
        .unwrap_or(0.0);
    assert!(
        acc_extent > 0.0,
        "Expected the flat to produce an accidental column"
    );
    let acc_left_edge = el.x - 0.12 * sp - acc_extent;
    assert!(
        grace_right_edge <= acc_left_edge + 0.01 * sp,
        "Grace right edge ({:.2}) should clear accidental left edge ({:.2})",
        grace_right_edge,
        acc_left_edge
    );
}

#[test]
fn test_grace_before_tuplet_reserves_space_no_barline_overflow() {
    // Regression: a grace note immediately before a TUPLET (e.g. an acciaccatura
    // before a triplet) must reserve horizontal space just like a grace before a
    // bare event. The grace attaches to the tuplet's first inner note; if the
    // spacing collector drops the pending grace count at the tuplet boundary,
    // the tuplet's first note isn't pushed right and the grace spills left over
    // the barline. Here the grace sits at the very start of the measure, so its
    // notehead must stay at/right of the measure content start. This mirrors the
    // Rhapsody-in-Blue measure before rehearsal 15 (grace before a triplet).
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 1}}]},
        "parts": [{"measures": [{
            "clefs": [{"clef": {"sign": "F", "staffPosition": 2}}],
            "sequences": [{"content": [
                {"type": "grace", "content": [
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "A", "octave": 2}}]},
                    {"duration": {"base": "16th"}, "notes": [{"pitch": {"step": "B", "octave": 2}}]}
                ]},
                {"type": "tuplet", "outer": {"duration": {"base": "quarter"}, "multiple": 1}, "inner": {"duration": {"base": "eighth"}, "multiple": 3}, "content": [
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]},
                    {"duration": {"base": "eighth"}, "notes": [{"pitch": {"step": "E", "octave": 3}}]}
                ]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "G", "octave": 3}}]},
                {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "A", "octave": 3}}]}
            ]}]
        }]}]
    }"#;

    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let sp = config.sp;
    let resolved = resolve_measures(&score, 0);
    let durations = crate::layout::spacing::collect_all_event_durations(&resolved);
    let common_shortest = crate::layout::spacing::detect_common_shortest_duration(&durations);
    let ml = layout_measure(&resolved[0], sp, 0.0, &config, None, &[], common_shortest);

    let content_start = ml.x + ml.prefix_width;
    let mut found = false;
    for vl in &ml.voice_layouts {
        for el in &vl.events_vec() {
            for gn in &el.grace_notes {
                found = true;
                assert!(
                    gn.x >= content_start - 0.01,
                    "Grace before triplet at x={:.1} crossed the content start {:.1} (over the barline)",
                    gn.x,
                    content_start
                );
            }
        }
    }
    assert!(found, "Expected the grace note to be laid out");
}
