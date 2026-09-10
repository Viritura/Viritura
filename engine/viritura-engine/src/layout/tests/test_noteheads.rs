use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::parse::parse_mnx;
use crate::render::smufl::smufl;
use crate::render::RenderCommand;

#[test]
fn pitched_notehead_override_renders_requested_shape() {
    let score = parse_mnx(
        r#"{
            "mnx": {"version": 1},
            "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
            "parts": [{"measures": [{"sequences": [{"content": [{
                "duration": {"base": "quarter"},
                "notes": [{
                    "pitch": {"step": "C", "octave": 4},
                    "_x": {"viritura": {"notehead": "diamond"}}
                }]
            }]}]}]}]
        }"#,
    )
    .unwrap();

    let display_list = layout_score(&score, 0, &LayoutConfig::default());
    assert!(display_list.commands.iter().any(|command| matches!(
        command,
        RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_DIAMOND_BLACK
    )));
    assert!(!display_list.commands.iter().any(|command| matches!(
        command,
        RenderCommand::DrawGlyph { codepoint, .. }
            if *codepoint == smufl::NOTEHEAD_BLACK
    )));
}
