use super::*;

#[test]
fn modifier_equality_keys_track_named_harmonic_degrees() {
    for (text, expected) in [
        ("Cadd79omit5/E", vec![0, 2, 4, 10]),
        ("Cmaj7add9", vec![0, 2, 4, 7, 11]),
        ("Cadd2", vec![0, 2, 4, 7]),
        ("Cadd4", vec![0, 4, 5, 7]),
        ("Cadd6", vec![0, 4, 7, 9]),
        ("Cadd7", vec![0, 4, 7, 10]),
        ("Cadd9", vec![0, 2, 4, 7]),
        ("Cadd11", vec![0, 4, 5, 7]),
        ("Cadd13", vec![0, 4, 7, 9]),
        ("Cadd791113", vec![0, 2, 4, 5, 7, 9, 10]),
        ("Cmaj7add7", vec![0, 4, 7, 10, 11]),
        ("Cmaj7add7omit7", vec![0, 4, 7]),
        ("Cdimomit5", vec![0, 3]),
        ("Caugomit5", vec![0, 4]),
        ("Cdim7no7", vec![0, 3, 6]),
        ("Cmaj7no7", vec![0, 4, 7]),
        ("Cø7omit5omit7", vec![0, 3]),
        ("Cmno3", vec![0, 7]),
        ("Csus2omit2", vec![0, 7]),
        ("Csus4omit4", vec![0, 7]),
        ("C6omit6", vec![0, 4, 7]),
        ("C13omit9omit11omit13", vec![0, 4, 7, 10]),
        ("Cno1", vec![4, 7]),
        ("Cno1no3no5", vec![]),
        ("Cno135", vec![0, 4]),
        ("Csus2add9omit2", vec![0, 2, 7]),
        ("Csus4add11omit4", vec![0, 5, 7]),
        ("C6add13omit6", vec![0, 4, 7, 9]),
        ("Comit5add9", vec![0, 2, 4]),
    ] {
        let harmony = Harmony::from_text(text).unwrap_or_else(|| panic!("{text}"));
        let key = harmony.key().unwrap();
        let actual: Vec<_> = (0..12)
            .filter(|interval| key.2 & (1 << interval) != 0)
            .collect();
        assert_eq!(actual, expected, "{text}");
        assert_eq!(key.0, 0, "root remains the harmonic anchor: {text}");
        assert_eq!(key.1, if text.ends_with("/E") { 4 } else { 0 });
    }
}

#[test]
fn modifier_grammar_normalizes_operations_without_implied_extensions() {
    for (suffix, label) in [
        ("add79omit5", "add7add9omit5"),
        ("(add7,9,no5)", "add7add9omit5"),
        ("add(7,9)omit5", "add7add9omit5"),
        ("(add7, 9, no5)", "add7add9omit5"),
        ("7 (add9, omit5)", "add9omit5"),
        ("7(add9,omit5)", "add9omit5"),
        ("add791113", "add7add9add11add13"),
        ("add2,4,6,7,9,11,13", "add2add4add6add7add9add11add13"),
        (
            "no1,2,3,4,5,6,7,9,11,13",
            "omit1omit2omit3omit4omit5omit6omit7omit9omit11omit13",
        ),
        ("omit5,add9,add7,add9", "add7add9omit5"),
    ] {
        let (_, modifiers) = parse_suffix(suffix).unwrap();
        assert_eq!(modifiers.label(), label, "{suffix}");
    }

    for suffix in ["add6", "(add6)", "add(6)"] {
        let (quality, modifiers) = parse_suffix(suffix).unwrap();
        assert_eq!(quality.kind, ChordQuality::Major);
        assert_eq!(quality.extension, Some(6));
        assert!(modifiers.label().is_empty());
    }
    for suffix in ["sus47", "7sus4"] {
        let (quality, _) = parse_suffix(suffix).unwrap();
        assert_eq!(quality.kind, ChordQuality::Suspended4);
        assert_eq!(quality.extension, Some(7));
    }
}

#[test]
fn chord_modifiers_reject_conflicting_degree_identities_on_equal_base_pitches() {
    let chord: ChordSymbol = serde_json::from_value(serde_json::json!({
        "position": {"fraction": [0, 1]},
        "root": {"step": "C"}, "quality": "diminished", "extension": 6,
        "kindText": "dim7omit7"
    }))
    .unwrap();
    assert!(semantic_display(&chord).is_none());
    let compatible = ChordSymbol {
        kind_text: Some("dim7omit5".into()),
        ..chord
    };
    assert!(semantic_display(&compatible).is_some());
}
