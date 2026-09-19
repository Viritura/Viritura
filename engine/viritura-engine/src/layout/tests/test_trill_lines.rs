use crate::layout::{layout_score, LayoutConfig};
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::RenderCommand;

fn layout_trill(show_symbol: bool, target: &str) -> crate::render::DisplayList {
    let json = format!(
        r#"{{
            "mnx": {{"version": 1}},
            "global": {{"measures": [{{"time": {{"count": 4, "unit": 4}}}}]}},
            "parts": [{{"measures": [{{
                "clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}],
                "sequences": [{{"content": [
                    {{"id": "trill-start", "duration": {{"base": "quarter"}},
                     "markings": {{"_x": {{"viritura": {{"trill": {{
                         "showSymbol": {show_symbol},
                         "extension": {{"target": "{target}", "targetEdge": "end"}}
                     }}}}}}}},
                     "notes": [{{"pitch": {{"step": "E", "octave": 5}}}}]}},
                    {{"id": "trill-end", "duration": {{"base": "dotted-half"}},
                     "notes": [{{"pitch": {{"step": "D", "octave": 5}}}}]}}
                ]}}]
            }}]}}]
        }}"#
    );
    let score = parse_mnx(&json).unwrap();
    layout_score(&score, 0, &LayoutConfig::default())
}

#[test]
fn renders_trill_symbol_and_extension() {
    let display_list = layout_trill(true, "trill-start");
    let trill_symbols = display_list
        .commands
        .iter()
        .filter(|command| {
            matches!(
                command,
                RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ORNAMENT_TRILL
            )
        })
        .count();
    let wiggles = display_list
        .commands
        .iter()
        .filter(|command| {
            matches!(
                command,
                RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::WIGGLE_TRILL
            )
        })
        .count();

    assert_eq!(trill_symbols, 1);
    assert!(wiggles > 0, "Expected a repeated trill-extension line");
    assert!(display_list
        .element_ids
        .iter()
        .flatten()
        .any(|id| id == "trill-line/trill-start/trill-start"));
    let hitbox = display_list
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "trill-line/trill-start/trill-start")
        .expect("Expected an engine hitbox for the complete trill extension");
    assert!(hitbox.bbox.width > smufl::WIGGLE_TRILL_SEGMENT_WIDTH);
    assert!(hitbox.bbox.height > 0.0);
}

#[test]
fn renders_extension_without_initial_symbol() {
    let display_list = layout_trill(false, "trill-start");
    assert!(!display_list.commands.iter().any(|command| {
        matches!(
            command,
            RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::ORNAMENT_TRILL
        )
    }));
    assert!(display_list.commands.iter().any(|command| {
        matches!(
            command,
            RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::WIGGLE_TRILL
        )
    }));
}

#[test]
fn skips_unresolved_trill_extension_target() {
    let display_list = layout_trill(true, "missing");
    assert!(!display_list.commands.iter().any(|command| {
        matches!(
            command,
            RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == smufl::WIGGLE_TRILL
        )
    }));
}
