// Repro test for AmalgamateUnisonTrail story:
// fl1: C5,D5,E5,F5  fl2: A4,B4,E5,F5  → Amalgamate with trailing unison from beat 2.
// Expected: an "a 2" label at beat 2.

use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores;
use crate::parse::parse_mnx;
use crate::render::*;

#[test]
fn amalgamate_with_trailing_unison_emits_a2_label() {
    let json = r#"{
      "mnx": {"version": 1},
      "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 0}}]},
      "parts": [
        {"id": "fl1", "name": "Flute 1", "shortName": "Fl.1",
         "measures": [{"sequences": [{"content": [
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"C","octave":5}}]},
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"D","octave":5}}]},
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":5}}]},
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"F","octave":5}}]}
         ]}]}]},
        {"id": "fl2", "name": "Flute 2", "shortName": "Fl.2",
         "measures": [{"sequences": [{"content": [
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"A","octave":4}}]},
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"B","octave":4}}]},
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"E","octave":5}}]},
           {"type":"event","duration":{"base":"quarter"},"notes":[{"pitch":{"step":"F","octave":5}}]}
         ]}]}]}
      ],
      "layouts": [{"id":"cond","content":[{"type":"staff","label":"Fl. 1.2","sources":[{"part":"fl1"},{"part":"fl2"}]}]}],
      "scores": [{"name":"Condensed","pages":[{"systems":[{"measure":"0","layout":"cond"}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let dl = layout_with_mnx_scores(&score, &config, 0);
    let labels: Vec<String> = dl
        .commands
        .iter()
        .filter_map(|cmd| {
            if let RenderCommand::DrawText { text, .. } = cmd {
                Some(text.clone())
            } else {
                None
            }
        })
        .collect();
    eprintln!("All text labels: {:?}", labels);
    assert!(
        labels.iter().any(|l| l == "a 2"),
        "Expected 'a 2' label for trailing-unison amalgamate, found labels: {:?}",
        labels
    );
}
