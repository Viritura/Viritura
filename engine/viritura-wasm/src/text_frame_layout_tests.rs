use super::*;

const SCORE: &str = r#"{
    "mnx": {"version": 1},
    "global": {"measures": [{"id": "m0", "time": {"count": 4, "unit": 4}}]},
    "parts": [{"id": "p0", "measures": [{"sequences": [{"content": [
        {"type": "event", "id": "e0", "duration": {"base": "whole"},
         "notes": [{"pitch": {"step": "C", "octave": 5}}]}
    ]}]}]}],
    "scores": [{"name": "Full", "_x": {"viritura": {"textFrames": [{
        "id": "f0",
        "locator": {"type": "page", "pageIndex": 0},
        "placement": {"anchor": "top-left", "offset": {"x": 0, "y": 0}},
        "width": {"unit": "staffSpaces", "value": 30},
        "content": [{"text": "FALLBACKFRAME"}]
    }]}}}]
}"#;

fn assert_frame(dl: &DisplayList, visible: bool) {
    assert_eq!(
        dl.commands.iter().any(|command| matches!(
            command,
            viritura_engine::render::RenderCommand::DrawText { text, .. }
                if text == "FALLBACKFRAME"
        )),
        visible
    );
}

#[test]
fn no_layout_text_frames_survive_stateless_and_retained_dispatch() {
    for (width, visible) in [(800.0, true), (0.0, false)] {
        let json = compute_full_score_layout(SCORE, 12.0, width, None).unwrap();
        assert_eq!(json.contains("FALLBACKFRAME"), visible);

        let mut engine = LayoutEngine::default();
        assert_frame(
            &engine
                .compute_full_score_layout_cached_dl(SCORE, 12.0, width, None, None)
                .unwrap(),
            visible,
        );
        assert_frame(
            &engine
                .relayout_retained_score_display_list(12.0, width, None, None)
                .unwrap(),
            visible,
        );
        assert_frame(
            &engine
                .apply_patch_and_layout_display_list("{}", 12.0, width, None, None)
                .unwrap(),
            visible,
        );
        let json = engine.full_layout(SCORE, 12.0, width, None, None).unwrap();
        assert_eq!(json.contains("FALLBACKFRAME"), visible);
    }
}
