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
fn raw_text_preserves_authored_formatting_instead_of_house_style() {
    let symbol = chord(json!({
        "root": {"step": "C"}, "quality": "major", "extension": 7,
        "rawText": "  Cmaj7 (add 9)  "
    }));
    let style = ChordSymbolStyle {
        major_seventh: MajorSeventhStyle::Triangle,
        ..Default::default()
    };
    let (runs, width, ascent) = chord_symbol_runs(&symbol, style, 10.0);
    assert_eq!(runs.len(), 1);
    assert!(
        matches!(&runs[0], ChordRun::Text {text, baseline_offset, ..}
        if text == "  Cmaj7 (add 9)  " && *baseline_offset == 0.0)
    );
    assert_eq!(
        width,
        text_styles::text_width("  Cmaj7 (add 9)  ", 24.0, FontFamily::Serif, false)
    );
    assert_eq!(
        chord_symbol_dimensions(&symbol, style, 10.0),
        (width, ascent)
    );
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
