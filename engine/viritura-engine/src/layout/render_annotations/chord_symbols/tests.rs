use super::*;
use serde_json::json;

fn chord(fields: serde_json::Value) -> ChordSymbol {
    let mut value = json!({"position": {"fraction": [1, 4]}});
    value
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    serde_json::from_value(value).unwrap()
}

fn text_runs(chord: &ChordSymbol) -> String {
    chord_symbol_runs(chord, ChordSymbolStyle::default(), 10.0)
        .0
        .into_iter()
        .filter_map(|run| match run {
            ChordRun::Text { text, .. } => Some(text),
            ChordRun::Glyph { .. } => None,
        })
        .collect()
}

#[test]
fn modifier_chords_use_canonical_semantic_runs() {
    for (raw, expected) in [
        ("Cadd79omit5/E", "Cadd7add9omit5/E"),
        ("C(add7,9,no5)", "Cadd7add9omit5"),
        ("Cadd(7,9)omit5", "Cadd7add9omit5"),
        ("C7(add9,omit5)", "C7add9omit5"),
        ("Cadd791113", "Cadd7add9add11add13"),
        ("Cadd6", "C6"),
        ("Csus47", "C7sus4"),
        ("Cno1", "Comit1"),
    ] {
        let symbol = chord(json!({"rawText": raw}));
        assert_eq!(text_runs(&symbol), expected, "{raw}");
        assert_eq!(symbol.raw_text.as_deref(), Some(raw));
    }
}

#[test]
fn modified_structured_chords_preserve_storage_and_style() {
    let fields = json!({
        "root": {"step": "C"}, "quality": "major", "extension": 7,
        "rawText": " Cmaj7(add9,no5)/E ", "kindText": "maj7(add9,no5)",
        "bass": {"step": "E"}
    });
    let symbol = chord(fields.clone());
    let original = symbol.clone();
    let written = chord_symbol_for_display(&symbol, Some((1, 2)));
    assert_eq!(text_runs(&written), "D7add9omit5/F");
    let commands = rendered_chord_commands(fields);
    assert!(commands.iter().any(|command| matches!(command,
        RenderCommand::DrawGlyph { codepoint, font, .. }
        if *codepoint == smufl::CHORD_MAJOR_SEVENTH && font == "Bravura")));
    for number in ["7", "9", "5"] {
        assert!(commands.iter().any(|command| matches!(command,
            RenderCommand::DrawText { text, size, .. }
            if text == number && *size < CHORD_FONT_SIZE_SP * LayoutConfig::default().sp)));
    }
    for number in ["7", "9", "5"] {
        let (runs, _, _) = chord_symbol_runs(&symbol, Default::default(), 10.0);
        assert!(runs.iter().any(|run| matches!(run,
            ChordRun::Text { text, baseline_offset, .. }
            if text == number && *baseline_offset < 0.0)));
    }
    let baseline_style = ChordSymbolStyle {
        major_seventh: MajorSeventhStyle::Maj,
        extensions: ChordExtensionPosition::Baseline,
        ..Default::default()
    };
    let (runs, _, _) = chord_symbol_runs(&symbol, baseline_style, 10.0);
    assert!(
        matches!(&runs[..], [ChordRun::Text { text, baseline_offset, size, .. }]
        if text == "Cmaj7add9omit5/E" && *baseline_offset == 0.0 && *size == 24.0)
    );
    let (runs, _, _) = chord_symbol_runs(&written, Default::default(), 10.0);
    assert!(runs
        .iter()
        .any(|run| matches!(run, ChordRun::Glyph { codepoint, .. }
        if Some(*codepoint) == smufl::chord_accidental_glyph(1))));
    assert_eq!(symbol, original);
}

#[test]
fn raw_only_modified_slash_harmony_transposes_semantically() {
    let symbol = chord(json!({"rawText": "  C(add7,9,no5)/E  "}));
    let original = symbol.clone();
    let written = chord_symbol_for_display(&symbol, Some((1, 2)));
    assert_eq!(written.raw_text.as_deref(), Some("  D(add7,9,no5)/F#  "));
    assert_eq!(text_runs(&written), "Dadd7add9omit5/F");
    assert_eq!(symbol, original);
    assert!(written.root.is_none());
}

#[test]
fn malformed_modifiers_and_inconsistent_bases_remain_literal() {
    for raw in [
        "Cadd",
        "Cno",
        "Cadd1",
        "Cadd3",
        "Cadd5",
        "Cadd8",
        "Comit8",
        "Cadd(7,9",
        "Cadd7)",
        "C((add9))",
        "Cadd()",
        "C(add9,)",
        "C(add9,,no5)",
        "C,add9",
        "Cadd,9",
        "Cadd9,",
        "C7(9)",
        "C79",
        "C7b9",
        "Cadd9unknown",
        "C(add9)()",
        "Cadd(no5)",
    ] {
        let symbol = chord(json!({"rawText": raw}));
        assert!(
            display_interpretation::semantic_display(&symbol).is_none(),
            "{raw}"
        );
        assert_eq!(text_runs(&symbol), raw);
    }
    for fields in [
        json!({"root": {"step": "C"}, "quality": "other", "kindText": "add9", "rawText": "Cadd9"}),
        json!({"root": {"step": "C"}, "quality": "minor", "kindText": "add9", "rawText": "Cadd9"}),
        json!({"root": {"step": "C"}, "quality": "major", "kindText": "7omit7", "rawText": "C"}),
        json!({"root": {"step": "C"}, "quality": "major", "kindText": "add9", "rawText": "Cadd13"}),
    ] {
        let symbol = chord(fields);
        assert!(display_interpretation::semantic_display(&symbol).is_none());
        assert_eq!(text_runs(&symbol), symbol.raw_text.unwrap());
    }
}

#[test]
fn modified_kind_text_checks_final_harmony_not_just_base() {
    for (quality, extension, kind, raw) in [
        ("major", None, "add79omit5", "C(add7,9,no5)/E"),
        ("major", Some(7), "maj7add9", "CM7add9/E"),
        ("major", None, "add7", "C7/E"),
        ("diminished", Some(7), "dim7omit7", "Cdim/E"),
        ("augmented", None, "augomit5", "Cadd7omit5omit7/E"),
    ] {
        let symbol = chord(json!({
            "root": {"step": "C"}, "quality": quality, "extension": extension,
            "kindText": kind, "rawText": raw, "bass": {"step": "E"}
        }));
        assert!(
            display_interpretation::semantic_display(&symbol).is_some(),
            "{kind}: {raw}"
        );
    }
}

#[test]
fn raw_text_provenance_does_not_override_house_style() {
    let symbol = chord(json!({
        "root": {"step": "C"}, "quality": "major", "extension": 7,
        "rawText": "  Cmaj7  ", "kindText": "maj7"
    }));
    let style = ChordSymbolStyle {
        major_seventh: MajorSeventhStyle::Triangle,
        ..Default::default()
    };
    let (runs, width, ascent) = chord_symbol_runs(&symbol, style, 10.0);
    assert_eq!(runs.len(), 3);
    assert!(
        matches!(&runs[0], ChordRun::Text {text, baseline_offset, ..}
        if text == "C" && *baseline_offset == 0.0)
    );
    assert!(matches!(&runs[1], ChordRun::Glyph {codepoint, ..}
        if *codepoint == smufl::CHORD_MAJOR_SEVENTH));
    assert!(
        matches!(&runs[2], ChordRun::Text {text, size, baseline_offset, ..}
        if text == "7" && *size < 24.0 && *baseline_offset < 0.0)
    );
    assert_eq!(
        chord_symbol_dimensions(&symbol, style, 10.0),
        (width, ascent)
    );
    let mut without_provenance = symbol.clone();
    without_provenance.raw_text = None;
    without_provenance.kind_text = None;
    assert_eq!(
        chord_symbol_dimensions(&without_provenance, style, 10.0),
        (width, ascent)
    );
}

fn rendered_chord_commands(fields: serde_json::Value) -> Vec<RenderCommand> {
    let symbol = chord(fields);
    let value = json!({
        "mnx": {"version": 1},
        "global": {"measures": [{
            "time": {"count": 4, "unit": 4},
            "_x": {"viritura": {"chordSymbols": [symbol]}}
        }]},
        "parts": [{"measures": [{
            "sequences": [{"content": [{"duration": {"base": "whole"}, "rest": {}}]}]
        }]}]
    });
    let score = crate::parse::parse_mnx_strict_value(&value).unwrap();
    let permissive = crate::parse::parse_mnx(&value.to_string()).unwrap();
    for parsed in [&score, &permissive] {
        assert_eq!(
            parsed.global.measures[0].chord_symbols().unwrap(),
            std::slice::from_ref(&symbol)
        );
    }
    let dl = crate::layout::layout_score(&score, 0, &LayoutConfig::default());
    assert_eq!(
        score.global.measures[0].chord_symbols().unwrap(),
        std::slice::from_ref(&symbol)
    );
    dl.commands
        .into_iter()
        .zip(dl.element_ids)
        .filter_map(|(command, id)| (id.as_deref() == Some("m0/chord0")).then_some(command))
        .collect()
}

#[test]
fn supported_chords_with_authored_spelling_draw_quality_glyphs_and_superscripts() {
    for (quality, raw, kind, glyph) in [
        ("major", "Cmaj7", "maj7", smufl::CHORD_MAJOR_SEVENTH),
        ("major", "CMaj7", "Maj7", smufl::CHORD_MAJOR_SEVENTH),
        ("major", "CMa7", "Ma7", smufl::CHORD_MAJOR_SEVENTH),
        ("major", "CΔ7", "Δ7", smufl::CHORD_MAJOR_SEVENTH),
        ("major", "CΔ", "Δ", smufl::CHORD_MAJOR_SEVENTH),
        ("major", "CM7", "M7", smufl::CHORD_MAJOR_SEVENTH),
        ("diminished", "Cdim7", "dim7", smufl::CHORD_DIMINISHED),
        ("diminished", "C°7", "°7", smufl::CHORD_DIMINISHED),
        ("half-diminished", "Cø7", "ø7", smufl::CHORD_HALF_DIMINISHED),
        ("half-diminished", "Cø", "ø", smufl::CHORD_HALF_DIMINISHED),
        ("half-diminished", "C07", "07", smufl::CHORD_HALF_DIMINISHED),
        (
            "half-diminished",
            "Cm7b5",
            "m7b5",
            smufl::CHORD_HALF_DIMINISHED,
        ),
    ] {
        for raw_text in [None, Some(raw)] {
            let mut fields = json!({
                "root": {"step": "C"}, "quality": quality, "extension": 7, "kindText": kind
            });
            if let Some(raw) = raw_text {
                fields["rawText"] = json!(raw);
            }
            let commands = rendered_chord_commands(fields);
            assert_eq!(commands.len(), 3, "{raw}");
            let (root_y, root_size) = match &commands[0] {
                RenderCommand::DrawText {
                    text,
                    y,
                    size,
                    color,
                    ..
                } => {
                    assert_eq!(text, "C");
                    assert_eq!(color, "#000000");
                    (*y, *size)
                }
                other => panic!("expected root text, got {other:?}"),
            };
            assert!(matches!(&commands[1],
                RenderCommand::DrawGlyph { codepoint, font, color, .. }
                if *codepoint == glyph && font == "Bravura" && color == "#000000"));
            assert!(matches!(&commands[2],
                RenderCommand::DrawText { text, y, size, color, .. }
                if text == "7" && *y < root_y && *size < root_size && color == "#000000"));
        }
    }
}

#[test]
fn equivalent_kind_text_aliases_keep_structured_dimensions() {
    for (quality, kind) in [
        ("major", "MAJ7"),
        ("minor", "Min7"),
        ("minor", "-7"),
        ("dominant", "7"),
        ("diminished", "Dim7"),
        ("augmented", "Aug7"),
        ("augmented", "+7"),
        ("half-diminished", "M7B5"),
        ("minor-major", "mMaj7"),
        ("minor-major", "minMa"),
        ("minor-major", "-Δ7"),
        ("suspended2", "7SUS2"),
        ("suspended4", "7Sus"),
    ] {
        let symbol = chord(json!({
            "root": {"step": "C"}, "quality": quality, "extension": 7, "kindText": kind
        }));
        let mut canonical = symbol.clone();
        canonical.kind_text = None;
        assert_eq!(
            chord_symbol_dimensions(&symbol, Default::default(), 10.0),
            chord_symbol_dimensions(&canonical, Default::default(), 10.0),
            "{quality}: {kind}"
        );
    }
}

#[test]
fn unsupported_chords_retain_verbatim_raw_text_in_black_exports() {
    for fields in [
        json!({"rawText": "  H#?!  "}),
        json!({
            "root": {"step": "C"}, "quality": "other",
            "kindText": "7(b9)", "rawText": "  C7(b9)  "
        }),
        json!({
            "root": {"step": "C"}, "quality": "dominant", "extension": 7,
            "kindText": "7(b9)", "rawText": "  C7(b9)  "
        }),
    ] {
        let commands = rendered_chord_commands(fields.clone());
        assert_eq!(commands.len(), 1);
        assert!(
            matches!(&commands[0], RenderCommand::DrawText { text, color, size, .. }
            if text == fields["rawText"].as_str().unwrap()
                && color == "#000000" && *size == CHORD_FONT_SIZE_SP * LayoutConfig::default().sp)
        );
    }
}

#[test]
fn unsupported_kind_text_without_raw_text_is_not_discarded() {
    for quality in ["major", "dominant", "other"] {
        let commands = rendered_chord_commands(json!({
            "root": {"step": "C"}, "quality": quality, "extension": 7,
            "kindText": "mystery"
        }));
        assert_eq!(commands.len(), 1);
        assert!(
            matches!(&commands[0], RenderCommand::DrawText { text, color, .. }
            if text == "Cmystery" && color == "#000000")
        );
    }
}

#[test]
fn raw_only_supported_spelling_uses_semantic_house_style() {
    for (raw, root, quality) in [
        ("CM7", "C", "major"),
        ("Ddim7", "D", "diminished"),
        ("Cø", "C", "half-diminished"),
        ("CmMa", "C", "minor-major"),
        ("C7sus", "C", "suspended4"),
    ] {
        assert_eq!(
            serde_json::to_value(rendered_chord_commands(json!({"rawText": raw}))).unwrap(),
            serde_json::to_value(rendered_chord_commands(json!({
                "root": {"step": root}, "quality": quality, "extension": 7
            })))
            .unwrap(),
            "{raw}"
        );
    }
}

#[test]
fn raw_quality_grammar_uses_style_without_rewriting_authored_data() {
    for (suffix, quality, extension) in [
        ("", "major", None),
        ("M", "major", None),
        ("Ma6", "major", Some(6)),
        ("△", "major", Some(7)),
        ("MAJ13", "major", Some(13)),
        ("Min9", "minor", Some(9)),
        ("-11", "minor", Some(11)),
        ("13", "dominant", Some(13)),
        ("°", "diminished", None),
        ("Dim6", "diminished", Some(6)),
        ("o7", "diminished", Some(7)),
        ("AUG9", "augmented", Some(9)),
        ("+", "augmented", None),
        ("0", "half-diminished", Some(7)),
        ("ø11", "half-diminished", Some(11)),
        ("M7B5", "half-diminished", Some(7)),
        ("minMA", "minor-major", Some(7)),
        ("-δ9", "minor-major", Some(9)),
        ("sus", "suspended4", None),
        ("11SUS4", "suspended4", Some(11)),
        ("sus2", "suspended2", None),
        ("6sus2", "suspended2", Some(6)),
        ("5", "power", None),
    ] {
        let raw = chord(json!({"rawText": format!("b♭{suffix}/d")}));
        let original = raw.clone();
        let expected = chord(json!({
            "root": {"step": "B", "alter": -1}, "quality": quality,
            "extension": extension, "bass": {"step": "D"}
        }));
        for style in [
            ChordSymbolStyle::default(),
            ChordSymbolStyle {
                root_case: ChordRootCase::LowercaseMinor,
                major_seventh: MajorSeventhStyle::CapitalM,
                minor: MinorStyle::Minus,
                diminished: DiminishedStyle::Dim,
                half_diminished: HalfDiminishedStyle::MinorFlatFive,
                augmented: AugmentedStyle::Aug,
                extensions: ChordExtensionPosition::Baseline,
            },
        ] {
            assert_eq!(
                chord_symbol_dimensions(&raw, style, 10.0),
                chord_symbol_dimensions(&expected, style, 10.0),
                "{suffix}"
            );
        }
        assert_eq!(raw, original);
    }
    for text in [
        "C7alt", "Cm(maj7)", "C6/9", "Cδ7", "CmAj7", "C♮7", "C7/E/G", "C7 /E",
    ] {
        let raw = chord(json!({"rawText": text}));
        let (runs, _, _) = chord_symbol_runs(&raw, Default::default(), 10.0);
        assert_eq!(runs.len(), 1, "{text}");
        assert_eq!(text_runs(&raw), text);
    }
}

#[test]
fn transposed_raw_only_harmony_is_styled_without_changing_storage() {
    let symbol = chord(json!({"rawText": "  CM7/E  "}));
    let original = symbol.clone();
    let written = chord_symbol_for_display(&symbol, Some((1, 2)));
    let expected = chord(json!({
        "root": {"step": "D"}, "quality": "major", "extension": 7,
        "bass": {"step": "F", "alter": 1}
    }));
    assert_eq!(text_runs(&written), "D7/F");
    assert_eq!(
        chord_symbol_dimensions(&written, Default::default(), 10.0),
        chord_symbol_dimensions(&expected, Default::default(), 10.0)
    );
    assert_eq!(symbol, original);
    assert_eq!(written.root, None);
}

#[test]
fn transposition_does_not_promote_unsupported_authored_syntax() {
    let symbol = chord(json!({"rawText": "E♮7"}));
    let original = symbol.clone();
    let written = chord_symbol_for_display(&symbol, Some((1, 2)));
    let (runs, _, _) = chord_symbol_runs(&written, Default::default(), 10.0);
    assert_eq!(runs.len(), 1);
    assert!(matches!(&runs[0], ChordRun::Text {text, ..} if text == "F♯7"));
    assert_eq!(symbol, original);
}

#[test]
fn semantic_raw_only_large_accidentals_are_not_discarded() {
    let symbol = chord(json!({"rawText": "B##7/Ebb"}));
    let written = chord_symbol_for_display(&symbol, Some((1, 2)));
    assert_eq!(written.raw_text.as_deref(), Some("C###7/Fb"));
    let (runs, _, _) = chord_symbol_runs(&written, Default::default(), 10.0);
    let glyphs: Vec<_> = runs
        .iter()
        .filter_map(|run| match run {
            ChordRun::Glyph { codepoint, .. } => Some(*codepoint),
            ChordRun::Text { .. } => None,
        })
        .collect();
    assert_eq!(
        glyphs,
        [
            smufl::chord_accidental_glyph(2).unwrap(),
            smufl::chord_accidental_glyph(1).unwrap(),
            smufl::chord_accidental_glyph(-1).unwrap(),
        ]
    );
    let extreme = chord(json!({"root": {"step": "C", "alter": -2147483648}}));
    assert_eq!(text_runs(&extreme), "C(-2147483648)");
}

#[test]
fn harmonic_equivalence_not_spelling_controls_authored_aliases() {
    for (fields, canonical) in [
        (
            json!({"root": {"step": "C"}, "rawText": "B#/Dbb"}),
            json!({"root": {"step": "C"}}),
        ),
        (
            json!({"root": {"step": "C"}, "quality": "diminished", "extension": 7,
                "kindText": "dim6", "rawText": "Cdim6"}),
            json!({"root": {"step": "C"}, "quality": "diminished", "extension": 7}),
        ),
        (
            json!({"root": {"step": "C"}, "quality": "dominant", "extension": 6,
                "kindText": "6", "rawText": "C6"}),
            json!({"root": {"step": "C"}, "quality": "dominant", "extension": 6}),
        ),
    ] {
        assert_eq!(
            serde_json::to_value(rendered_chord_commands(fields)).unwrap(),
            serde_json::to_value(rendered_chord_commands(canonical)).unwrap()
        );
    }
}

#[test]
fn implicit_seventh_kind_aliases_use_semantic_house_style() {
    for (quality, kind) in [
        ("dominant", "7"),
        ("half-diminished", "m7b5"),
        ("half-diminished", "ø"),
        ("minor-major", "minMa"),
    ] {
        assert_eq!(
            serde_json::to_value(rendered_chord_commands(json!({
                "root": {"step": "C"}, "quality": quality, "kindText": kind
            })))
            .unwrap(),
            serde_json::to_value(rendered_chord_commands(json!({
                "root": {"step": "C"}, "quality": quality, "extension": 7
            })))
            .unwrap(),
            "{quality}: {kind}"
        );
    }
}

#[test]
fn contradictory_or_unsupported_authored_metadata_remains_literal() {
    for fields in [
        json!({"root": {"step": "C"}, "quality": "dominant", "extension": 7, "rawText": "C7alt"}),
        json!({"root": {"step": "C"}, "rawText": "Cm"}),
        json!({"root": {"step": "C"}, "rawText": "D"}),
        json!({"root": {"step": "C"}, "rawText": "C/E"}),
        json!({"root": {"step": "C"}, "quality": "major", "extension": 7, "kindText": "m7", "rawText": "CM7"}),
        json!({"root": {"step": "C"}, "quality": "dominant", "kindText": "", "rawText": "C7"}),
        json!({"rawText": "CM7", "quality": "major"}),
        json!({"rawText": "CM7", "kindText": "M7"}),
        json!({"rawText": "CM7", "extension": 7}),
        json!({"rawText": "CM7", "bass": {"step": "E"}}),
    ] {
        let commands = rendered_chord_commands(fields.clone());
        assert_eq!(commands.len(), 1, "{fields}");
        assert!(
            matches!(&commands[0],
            RenderCommand::DrawText {text, color, ..}
            if Some(text.as_str()) == fields["rawText"].as_str() && color == "#000000"),
            "{fields}"
        );
    }
}

#[test]
fn explicit_chord_text_override_stays_literal() {
    for text in ["Custom harmony", "Cmaj7", ""] {
        let commands = rendered_chord_commands(json!({
            "root": {"step": "C"}, "quality": "major", "extension": 7,
            "kindText": "maj7", "rawText": "Cmaj7", "textOverride": text
        }));
        assert_eq!(commands.len(), 1);
        assert!(
            matches!(&commands[0], RenderCommand::DrawText { text: actual, color, size, .. }
            if actual == text && color == "#000000"
                && *size == CHORD_FONT_SIZE_SP * LayoutConfig::default().sp)
        );
    }
    for fields in [
        json!({"rawText": "CM7", "textOverride": "CM7"}),
        json!({"rawText": "C7alt", "textOverride": "Custom"}),
        json!({"root": {"step": "C"}, "kindText": "mystery", "textOverride": ""}),
    ] {
        let commands = rendered_chord_commands(fields.clone());
        assert_eq!(commands.len(), 1);
        assert!(matches!(&commands[0],
            RenderCommand::DrawText {text, color, ..}
            if Some(text.as_str()) == fields["textOverride"].as_str() && color == "#000000"));
    }
}

#[test]
fn no_chord_declarations_retain_literal_text_in_black_exports() {
    for text in ["NC", "N.C.", "N.C", "  nc  ", " n.c. "] {
        let commands = rendered_chord_commands(json!({"rawText": text}));
        assert_eq!(commands.len(), 1);
        assert!(
            matches!(&commands[0], RenderCommand::DrawText { text: actual, color, .. }
            if actual == text && color == "#000000")
        );
    }
}

#[test]
fn text_override_precedes_raw_text_and_structured_fields() {
    let symbol = chord(json!({
        "root": {"step": "C"}, "quality": "major",
        "rawText": "C", "textOverride": "N.C."
    }));
    assert_eq!(text_runs(&symbol), "N.C.");
}

#[test]
fn raw_only_opaque_nc_and_empty_text_never_invent_a_root() {
    for text in ["N.C.", "NC", "  nc  ", "free harmony", "C???", "Banana", ""] {
        let symbol = chord(json!({"rawText": text}));
        let projected = chord_symbol_for_display(&symbol, Some((1, 2)));
        assert_eq!(projected.raw_text.as_deref(), Some(text));
        assert_eq!(projected.root, None);
        assert_eq!(projected.quality, None);
        assert_eq!(text_runs(&projected), text);
    }
    let symbol = chord(json!({"quality": "minor", "bass": {"step": "E"}}));
    let (runs, width, ascent) = chord_symbol_runs(&symbol, Default::default(), 10.0);
    assert!(runs.is_empty());
    assert_eq!((width, ascent), (0.0, 0.0));
}

#[test]
fn structured_symbols_keep_smufl_and_optional_quality_behavior() {
    let symbol = chord(json!({"root": {"step": "F", "alter": 1}}));
    let (runs, _, _) = chord_symbol_runs(&symbol, Default::default(), 10.0);
    assert_eq!(text_runs(&symbol), "F");
    assert!(runs
        .iter()
        .any(|run| matches!(run, ChordRun::Glyph {codepoint, ..}
        if Some(*codepoint) == smufl::chord_accidental_glyph(1))));
    let symbol = chord(json!({"root": {"step": "D"}, "quality": "minor"}));
    let style = ChordSymbolStyle {
        root_case: ChordRootCase::LowercaseMinor,
        minor: MinorStyle::None,
        ..Default::default()
    };
    let (runs, _, _) = chord_symbol_runs(&symbol, style, 10.0);
    assert!(matches!(&runs[0], ChordRun::Text {text, ..} if text == "d"));
}

#[test]
fn source_interval_transposes_root_and_bass_without_mutating_canonical_event() {
    let mut symbol = chord(json!({
        "root": {"step": "B", "alter": -1}, "quality": "major",
        "bass": {"step": "D"}, "rawText": "Bb/D"
    }));
    symbol.source_index = Some(7);
    symbol.source_part_index = Some(3);
    let canonical = symbol.clone();
    let written = chord_symbol_for_display(&symbol, Some((1, 2)));
    assert_eq!(
        written.root,
        Some(ChordRoot {
            step: "C".into(),
            alter: None
        })
    );
    assert_eq!(
        written.bass,
        Some(ChordRoot {
            step: "E".into(),
            alter: None
        })
    );
    assert_eq!(written.raw_text.as_deref(), Some("C/E"));
    assert_eq!(written.source_index, Some(7));
    assert_eq!(written.source_part_index, Some(3));
    assert_eq!(written.position, symbol.position);
    assert_eq!(symbol, canonical);
    assert_eq!(chord_symbol_for_display(&symbol, None), canonical);
    assert_eq!(chord_symbol_for_display(&symbol, Some((0, 0))), canonical);
}

#[test]
fn diatonic_interval_controls_enharmonic_spelling_in_both_directions() {
    for (interval, step, alter) in [
        ((1, 1), "D", Some(-1)),
        ((0, 1), "C", Some(1)),
        ((-1, -2), "B", Some(-1)),
        ((-7, -12), "C", None),
        ((5, 9), "A", None),
        ((4, 7), "G", None),
    ] {
        let symbol = chord(json!({"root": {"step": "C"}}));
        let written = chord_symbol_for_display(&symbol, Some(interval));
        assert_eq!(
            written.root,
            Some(ChordRoot {
                step: step.into(),
                alter
            })
        );
    }
}

#[test]
fn transposed_text_keeps_case_whitespace_suffix_and_accidental_alphabet() {
    for (input, expected) in [
        ("  c♭maj7 / g♭  ", "  d♭maj7 / a♭  "),
        ("C7(#9,b13)/E", "D7(#9,b13)/F#"),
        ("CΔ7", "DΔ7"),
        ("Cma7/E", "Dma7/F#"),
        ("CmMa7", "DmMa7"),
        ("C6/9", "D6/9"),
        ("C6/9/E", "D6/9/F#"),
        ("Cm6/9", "Dm6/9"),
        ("Cm6/9/E", "Dm6/9/F#"),
        ("C𝄫7", "D𝄫7"),
        ("Cx7", "Dx7"),
        ("C♮7", "D♮7"),
    ] {
        let symbol = chord(json!({"rawText": input, "textOverride": input}));
        let written = chord_symbol_for_display(&symbol, Some((1, 2)));
        assert_eq!(written.raw_text.as_deref(), Some(expected), "{input}");
        assert_eq!(written.text_override.as_deref(), Some(expected), "{input}");
        assert_eq!(written.quality, None);
    }
}

#[test]
fn malformed_and_opaque_text_remains_unchanged_even_with_structured_root() {
    for input in ["C mystery/E", "C7/H", "C7/E/G", "C?/E", "C7/E?", "N.C."] {
        let symbol = chord(json!({"root": {"step": "C"}, "rawText": input}));
        let written = chord_symbol_for_display(&symbol, Some((1, 2)));
        assert_eq!(written.raw_text.as_deref(), Some(input));
        assert_eq!(written.root.as_ref().unwrap().step, "D");
    }
}

#[test]
fn invalid_structured_roots_are_not_guessed_as_c() {
    for step in ["H", "", "CC", "c"] {
        let symbol = chord(json!({"root": {"step": step}, "bass": {"step": step}}));
        assert_eq!(chord_symbol_for_display(&symbol, Some((1, 2))), symbol);
    }
}

#[test]
fn extreme_intervals_do_not_overflow_or_expand_authored_text() {
    let symbol = chord(json!({
        "root": {"step": "C", "alter": 2147483647}, "rawText": "C7"
    }));
    let written = chord_symbol_for_display(&symbol, Some((i32::MIN, i32::MAX)));
    assert_eq!(written, symbol);
}
