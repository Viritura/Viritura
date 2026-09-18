use crate::layout::{compute_note_preview, LayoutConfig, NotePreviewAccidental, NotePreviewInput};
use crate::model::{NoteValueBase, NoteheadShape, StemDirection};
use crate::render::smufl::smufl;
use crate::render::RenderCommand;
use serde_json::json;

fn input(duration: &str) -> NotePreviewInput {
    serde_json::from_value(json!({
        "x": 100.0, "y": 130.0, "staffY": 100.0, "spatium": 10.0,
        "duration": duration
    }))
    .unwrap()
}

fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-9, "{actual} != {expected}");
}

fn glyphs(commands: &[RenderCommand], cp: u32) -> Vec<(f64, f64, f64)> {
    commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawGlyph {
                x,
                y,
                codepoint,
                font,
                size,
                rotation,
                ..
            } if *codepoint == cp => {
                assert_eq!(font, "Bravura");
                close(*rotation, 0.0);
                Some((*x, *y, *size))
            }
            _ => None,
        })
        .collect()
}

fn stem(commands: &[RenderCommand]) -> (f64, f64, f64, f64) {
    let stems: Vec<_> = commands
        .iter()
        .filter_map(|command| match command {
            RenderCommand::DrawLine {
                x1,
                y1,
                x2,
                y2,
                width,
                ..
            } if x1 == x2 => Some((*x1, *y1, *y2, *width)),
            _ => None,
        })
        .collect();
    assert_eq!(stems.len(), 1);
    stems[0]
}

#[test]
fn note_preview_duration_heads_and_stems() {
    for (duration, cp, has_stem) in [
        ("duplexMaxima", smufl::NOTEHEAD_DOUBLE_WHOLE, false),
        ("maxima", smufl::NOTEHEAD_DOUBLE_WHOLE, false),
        ("longa", smufl::NOTEHEAD_DOUBLE_WHOLE, false),
        ("breve", smufl::NOTEHEAD_DOUBLE_WHOLE, false),
        ("whole", smufl::NOTEHEAD_WHOLE, false),
        ("half", smufl::NOTEHEAD_HALF, true),
        ("quarter", smufl::NOTEHEAD_BLACK, true),
    ] {
        let preview = input(duration);
        let commands = compute_note_preview(&preview);
        let heads = glyphs(&commands, cp);
        assert_eq!(heads.len(), 1, "{duration}");
        let origin = if cp == smufl::NOTEHEAD_DOUBLE_WHOLE {
            smufl::NOTEHEAD_DOUBLE_WHOLE_ORIGIN.0 * preview.spatium
        } else {
            0.0
        };
        close(heads[0].0, preview.x - origin);
        close(heads[0].1, preview.y);
        close(heads[0].2, 40.0);
        assert_eq!(commands.len(), if has_stem { 2 } else { 1 });
        if has_stem {
            assert!(stem(&commands).1 < preview.y);
        }
    }
}

#[test]
fn note_preview_automatic_direction_and_override() {
    for (y, override_direction, up) in [
        (125.0, None, true),
        (120.0, None, false),
        (115.0, None, false),
        (130.0, Some(StemDirection::Down), false),
        (110.0, Some(StemDirection::Up), true),
    ] {
        let mut preview = input("quarter");
        preview.y = y;
        preview.stem_direction = override_direction;
        let commands = compute_note_preview(&preview);
        let (x, top, bottom, _) = stem(&commands);
        if up {
            assert!(x > preview.x + 5.0);
            assert!(top < y);
            close(bottom, y + smufl::STEM_UP_SE.1 * preview.spatium);
        } else {
            assert!(x < preview.x + 5.0);
            assert!(bottom > y);
            close(top, y + smufl::STEM_DOWN_NW.1 * preview.spatium);
        }
    }
}

#[test]
fn note_preview_grace_defaults_up_at_every_pitch_and_preserves_overrides() {
    for y in [90.0, 110.0, 120.0, 130.0, 150.0] {
        for (direction, up) in [
            (None, true),
            (Some(StemDirection::Up), true),
            (Some(StemDirection::Down), false),
        ] {
            let mut preview = input("eighth");
            preview.y = y;
            preview.is_grace = true;
            preview.stem_direction = direction;
            let commands = compute_note_preview(&preview);
            let (x, top, bottom, _) = stem(&commands);
            let flag = smufl::flag_glyph(1, up).unwrap();
            assert_eq!(glyphs(&commands, flag).len(), 1);
            if up {
                assert!(x > preview.x + 3.0);
                assert!(top < y);
                close(bottom, y + smufl::STEM_UP_SE.1 * preview.spatium * 0.65);
            } else {
                assert!(x < preview.x + 3.0);
                assert!(bottom > y);
                close(top, y + smufl::STEM_DOWN_NW.1 * preview.spatium * 0.65);
            }
        }
    }
}

#[test]
fn note_preview_directional_flags_through_1024th() {
    for (index, duration) in [
        "eighth", "16th", "32nd", "64th", "128th", "256th", "512th", "1024th",
    ]
    .iter()
    .enumerate()
    {
        for is_grace in [false, true] {
            for up in [false, true] {
                let mut preview = input(duration);
                preview.is_grace = is_grace;
                preview.stem_direction = Some(if up {
                    StemDirection::Up
                } else {
                    StemDirection::Down
                });
                let commands = compute_note_preview(&preview);
                let expected = 0xE240 + index as u32 * 2 + u32::from(!up);
                let flags = glyphs(&commands, expected);
                assert_eq!(flags.len(), 1, "{duration}, grace={is_grace}, up={up}");
                assert_eq!(commands.len(), 3);
                assert_eq!(glyphs(&commands, smufl::NOTEHEAD_BLACK).len(), 1);
                close(flags[0].2, if is_grace { 26.0 } else { 40.0 });
                let (stem_x, top, bottom, _) = stem(&commands);
                close(flags[0].0, stem_x);
                assert!(if up {
                    flags[0].1 < preview.y
                } else {
                    flags[0].1 > preview.y
                });
                let ext = smufl::flag_stem_extension(index as u32 + 1, up)
                    * preview.spatium
                    * if is_grace { 0.65 } else { 1.0 };
                close(
                    if up { top } else { bottom },
                    flags[0].1 + if up { -ext } else { ext },
                );
            }
        }
    }
}

#[test]
fn note_preview_dots_keep_staff_spaces_and_scale_horizontally() {
    for spatium in [4.0, 10.0, 24.0] {
        for is_grace in [false, true] {
            for pos in [-2.0, 3.0, 4.0, 5.0, 10.0] {
                let mut preview = input("quarter");
                preview.spatium = spatium;
                preview.y = preview.staff_y + pos * spatium * 0.5;
                preview.is_grace = is_grace;
                preview.dots = 4;
                let commands = compute_note_preview(&preview);
                let dots = glyphs(&commands, smufl::AUGMENTATION_DOT);
                assert_eq!(dots.len(), 4);
                let ink_sp = spatium * if is_grace { 0.65 } else { 1.0 };
                for (i, &(x, y, size)) in dots.iter().enumerate() {
                    close(
                        x,
                        preview.x
                            + (smufl::notehead_right_extent(smufl::NOTEHEAD_BLACK)
                                + 0.4
                                + i as f64 * 0.5)
                                * ink_sp,
                    );
                    close(
                        y,
                        preview.y - if pos % 2.0 == 0.0 { 0.5 * spatium } else { 0.0 },
                    );
                    close(size, 4.0 * ink_sp);
                }
            }
        }
    }
}

#[test]
fn note_preview_all_accidentals_are_explicit_and_scaled() {
    for (name, expected) in [
        ("sharp", smufl::ACCIDENTAL_SHARP),
        ("flat", smufl::ACCIDENTAL_FLAT),
        ("natural", smufl::ACCIDENTAL_NATURAL),
        ("double-sharp", smufl::ACCIDENTAL_DOUBLE_SHARP),
        ("double-flat", smufl::ACCIDENTAL_DOUBLE_FLAT),
        ("triple-sharp", smufl::ACCIDENTAL_TRIPLE_SHARP),
        ("triple-flat", smufl::ACCIDENTAL_TRIPLE_FLAT),
    ] {
        for is_grace in [false, true] {
            let mut preview = input("half");
            preview.is_grace = is_grace;
            preview.accidental = Some(serde_json::from_value(json!(name)).unwrap());
            let commands = compute_note_preview(&preview);
            let acc = glyphs(&commands, expected);
            assert_eq!(acc.len(), 1);
            assert!(acc[0].0 < preview.x);
            close(acc[0].1, preview.y);
            close(acc[0].2, if is_grace { 26.0 } else { 40.0 });
            assert_eq!(commands.len(), 3);
        }
    }
    assert_eq!(compute_note_preview(&input("half")).len(), 2);
}

#[test]
fn note_preview_ledger_lines_use_real_staff_grid_and_shape_width() {
    let config = LayoutConfig::default();
    for (pos, ys) in [
        (-5.0, vec![90.0, 80.0]),
        (13.0, vec![150.0, 160.0]),
        (-1.0, vec![]),
        (9.0, vec![]),
    ] {
        for is_grace in [false, true] {
            let mut preview = input("quarter");
            preview.y = preview.staff_y + pos * preview.spatium * 0.5;
            preview.is_grace = is_grace;
            preview.notehead = Some(NoteheadShape::Diamond);
            let commands = compute_note_preview(&preview);
            let lines: Vec<_> = commands
                .iter()
                .filter_map(|command| match command {
                    RenderCommand::DrawLine {
                        x1,
                        y1,
                        x2,
                        y2,
                        width,
                        ..
                    } if y1 == y2 => Some((*x1, *y1, *x2, *width)),
                    _ => None,
                })
                .collect();
            assert_eq!(lines.len(), ys.len());
            let ink_sp = preview.spatium * if is_grace { 0.65 } else { 1.0 };
            for ((x1, y, x2, width), expected_y) in lines.iter().zip(&ys) {
                close(*y, *expected_y);
                close(*x1, preview.x - config.ledger_extension * ink_sp);
                close(
                    x2 - x1,
                    (smufl::notehead_width(smufl::NOTEHEAD_DIAMOND_BLACK)
                        + 2.0 * config.ledger_extension)
                        * ink_sp,
                );
                close(*width, config.ledger_line_width * preview.spatium);
            }
        }
    }
}

#[test]
fn note_preview_percussion_shapes_use_their_stem_anchors() {
    for shape in [
        NoteheadShape::Normal,
        NoteheadShape::X,
        NoteheadShape::CircleX,
        NoteheadShape::Diamond,
        NoteheadShape::Slash,
        NoteheadShape::TriangleUp,
        NoteheadShape::TriangleDown,
    ] {
        for duration in ["quarter", "half"] {
            for is_grace in [false, true] {
                for up in [false, true] {
                    let mut preview = input(duration);
                    preview.notehead = Some(shape);
                    preview.is_grace = is_grace;
                    preview.stem_direction = Some(if up {
                        StemDirection::Up
                    } else {
                        StemDirection::Down
                    });
                    let commands = compute_note_preview(&preview);
                    let cp = smufl::shaped_notehead_glyph(Some(&shape), &preview.duration);
                    assert_eq!(glyphs(&commands, cp).len(), 1);
                    let anchors = smufl::stem_anchors(cp);
                    let (x, top, bottom, width) = stem(&commands);
                    let sp = preview.spatium * if is_grace { 0.65 } else { 1.0 };
                    if up {
                        close(x + width * 0.5, preview.x + anchors.up_se.0 * sp);
                        close(bottom, preview.y + anchors.up_se.1 * sp);
                    } else {
                        close(x - width * 0.5, preview.x + anchors.down_nw.0 * sp);
                        close(top, preview.y + anchors.down_nw.1 * sp);
                    }
                }
            }
        }
    }
}

#[test]
fn note_preview_grace_slash_crosses_the_directional_stem() {
    for duration in ["whole", "quarter", "eighth", "1024th"] {
        for is_grace in [false, true] {
            for up in [false, true] {
                let mut preview = input(duration);
                preview.is_grace = is_grace;
                preview.stem_direction = Some(if up {
                    StemDirection::Up
                } else {
                    StemDirection::Down
                });
                let plain = compute_note_preview(&preview);
                preview.slash = true;
                let slashed = compute_note_preview(&preview);
                let should_slash = is_grace && preview.duration.flag_count() > 0;
                assert_eq!(slashed.len(), plain.len() + usize::from(should_slash));
                if should_slash {
                    let (x, top, bottom, width) = stem(&slashed);
                    let RenderCommand::DrawLine {
                        x1,
                        y1,
                        x2,
                        y2,
                        width: slash_width,
                        ..
                    } = slashed.last().unwrap()
                    else {
                        panic!("expected slash");
                    };
                    close((x1 + x2) * 0.5, x);
                    close(x2 - x1, 2.0 * 0.8 * 0.6 * 6.5);
                    close(y1 - y2, 2.0 * 0.6 * 6.5);
                    close(*slash_width, width * 1.5);
                    assert!((y1 + y2) * 0.5 > top);
                    assert!((y1 + y2) * 0.5 < bottom);
                } else {
                    assert_eq!(
                        serde_json::to_value(plain).unwrap(),
                        serde_json::to_value(slashed).unwrap()
                    );
                }
            }
        }
    }
}

#[test]
fn note_preview_rest_durations_dots_and_grace_scale() {
    for (duration, cp) in [
        ("duplexMaxima", smufl::REST_MAXIMA),
        ("maxima", smufl::REST_MAXIMA),
        ("longa", smufl::REST_LONG),
        ("breve", smufl::REST_DOUBLE_WHOLE),
        ("whole", smufl::REST_WHOLE),
        ("half", smufl::REST_HALF),
        ("quarter", smufl::REST_QUARTER),
        ("eighth", smufl::REST_8TH),
        ("16th", smufl::REST_16TH),
        ("32nd", smufl::REST_32ND),
        ("64th", smufl::REST_64TH),
        ("128th", smufl::REST_128TH),
        ("256th", smufl::REST_256TH),
        ("512th", smufl::REST_512TH),
        ("1024th", smufl::REST_1024TH),
    ] {
        for spatium in [5.0, 10.0, 20.0] {
            for is_grace in [false, true] {
                let mut preview = input(duration);
                preview.is_rest = true;
                preview.is_grace = is_grace;
                preview.spatium = spatium;
                preview.dots = 2;
                preview.accidental = Some(NotePreviewAccidental::Sharp);
                preview.notehead = Some(NoteheadShape::X);
                preview.slash = true;
                let commands = compute_note_preview(&preview);
                assert_eq!(commands.len(), 3);
                let rest = glyphs(&commands, cp);
                assert_eq!(rest.len(), 1);
                let sp = spatium * if is_grace { 0.65 } else { 1.0 };
                let y = preview.staff_y
                    + if duration == "whole" {
                        spatium
                    } else {
                        2.0 * spatium
                    };
                close(rest[0].0, preview.x + 0.2 * sp);
                close(rest[0].1, y);
                close(rest[0].2, 4.0 * sp);
                let dots = glyphs(&commands, smufl::AUGMENTATION_DOT);
                let (bbox_x, _, bbox_w, _) = smufl::glyph_bbox(cp);
                for (i, dot) in dots.iter().enumerate() {
                    close(
                        dot.0,
                        rest[0].0 + (bbox_x + bbox_w + 0.3 + i as f64 * 0.35) * sp,
                    );
                    close(dot.1, y - 0.5 * spatium);
                    close(dot.2, 4.0 * sp);
                }
            }
        }
    }
}

#[test]
fn note_preview_serde_defaults_camel_case_and_errors() {
    let minimal = input("breve");
    assert_eq!(minimal.duration, NoteValueBase::Breve);
    assert_eq!(minimal.dots, 0);
    assert!(!minimal.is_grace && !minimal.is_rest && !minimal.slash);
    assert!(minimal.accidental.is_none());
    assert!(minimal.notehead.is_none());
    assert!(minimal.stem_direction.is_none());
    let full = json!({
        "x": 10, "y": 20, "staffY": 0, "spatium": 10, "duration": "duplexMaxima",
        "dots": 2, "isRest": true, "isGrace": true, "slash": true,
        "accidental": "double-flat", "notehead": "triangleDown", "stemDirection": "up"
    });
    let parsed: NotePreviewInput = serde_json::from_value(full.clone()).unwrap();
    assert_eq!(parsed.duration, NoteValueBase::DuplexMaxima);
    assert_eq!(parsed.dots, 2);
    assert!(parsed.is_rest && parsed.is_grace && parsed.slash);
    assert_eq!(parsed.accidental, Some(NotePreviewAccidental::DoubleFlat));
    assert_eq!(parsed.notehead, Some(NoteheadShape::TriangleDown));
    assert_eq!(parsed.stem_direction, Some(StemDirection::Up));
    for (key, bad) in [
        ("duration", json!("duplex")),
        ("duration", json!("Quarter")),
        ("duration", json!(8)),
        ("accidental", json!("doubleSharp")),
        ("accidental", json!("other")),
        ("notehead", json!("triangle-up")),
        ("stemDirection", json!("auto")),
        ("dots", json!(-1)),
        ("dots", json!(1.5)),
        ("dots", json!(4294967296_u64)),
        ("isRest", json!("true")),
        ("x", json!(null)),
    ] {
        let mut invalid = full.clone();
        invalid[key] = bad;
        assert!(
            serde_json::from_value::<NotePreviewInput>(invalid).is_err(),
            "{key}"
        );
    }
    for key in ["x", "y", "staffY", "spatium", "duration"] {
        let mut missing = full.clone();
        missing.as_object_mut().unwrap().remove(key);
        assert!(
            serde_json::from_value::<NotePreviewInput>(missing).is_err(),
            "{key}"
        );
    }
}

#[test]
fn note_preview_short_durations_keep_shared_engraving_fallback() {
    for duration in ["2048th", "4096th"] {
        for is_rest in [false, true] {
            for is_grace in [false, true] {
                for direction in [StemDirection::Up, StemDirection::Down] {
                    let mut preview = input(duration);
                    preview.is_rest = is_rest;
                    preview.is_grace = is_grace;
                    preview.stem_direction = Some(direction);
                    let commands = compute_note_preview(&preview);
                    let cp = if is_rest {
                        smufl::REST_1024TH
                    } else {
                        smufl::NOTEHEAD_BLACK
                    };
                    assert_eq!(glyphs(&commands, cp).len(), 1);
                    assert_eq!(commands.len(), if is_rest { 1 } else { 2 });
                    if !is_rest {
                        let (_, top, bottom, _) = stem(&commands);
                        assert!(top < bottom);
                    }
                }
            }
        }
    }
}

#[test]
fn note_preview_invalid_geometry_is_bounded() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1e100, -1e100] {
        for field in 0..4 {
            let mut preview = input("quarter");
            match field {
                0 => preview.x = value,
                1 => preview.y = value,
                2 => preview.staff_y = value,
                _ => preview.spatium = value,
            }
            assert!(compute_note_preview(&preview).is_empty());
        }
    }
    for spatium in [0.0, -1.0, f64::MIN_POSITIVE, 0.0009, 10_001.0] {
        let mut preview = input("quarter");
        preview.spatium = spatium;
        assert!(compute_note_preview(&preview).is_empty());
    }
    for pos in [-129.0, 129.0, 1e5] {
        let mut preview = input("quarter");
        preview.y = preview.staff_y + pos * preview.spatium * 0.5;
        assert!(compute_note_preview(&preview).is_empty());
    }
    for dots in [5, u32::MAX] {
        let mut preview = input("quarter");
        preview.dots = dots;
        assert!(compute_note_preview(&preview).is_empty());
    }
    for pos in [-128.0, 128.0] {
        let mut preview = input("1024th");
        preview.y = preview.staff_y + pos * preview.spatium * 0.5;
        preview.dots = 4;
        preview.accidental = Some(NotePreviewAccidental::Flat);
        let commands = compute_note_preview(&preview);
        assert!(!commands.is_empty() && commands.len() < 80);
    }
}
