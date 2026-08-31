// Integration tests for element tagging (element_ids and element_bboxes)

use crate::layout::config::LayoutConfig;
use crate::layout::{layout_full_score, layout_score, layout_with_mnx_scores};
use crate::model::SequenceContent;
use crate::parse::parse_mnx;
use crate::render::*;
use std::collections::HashSet;

// ═══════════════════════════════════════
// Element ID format tests
// ═══════════════════════════════════════

#[test]
fn test_tag_clef_id_format() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let clef = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id == "p0/m0/clef");
    assert!(
        clef.is_some(),
        "Clef bbox should have exact ID 'p0/m0/clef'"
    );
}

#[test]
fn test_tag_time_signature_id_format() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Time sig bbox ID has no part prefix (global element)
    let time = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id == "m0/time");
    assert!(
        time.is_some(),
        "Time sig bbox should have exact ID 'm0/time'"
    );
}

#[test]
fn test_tag_event_id_format_generated() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Events without explicit IDs get auto-generated IDs: p{part}/m{measure}/s{seq}/__auto_m{m}_v{v}_e{idx}
    // Each event also gets a per-notehead sub-bbox (e.g. .../n0)
    let event_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.starts_with("p0/m0/s0/") && !eb.element_id.contains("/n"))
        .collect();
    assert_eq!(
        event_bboxes.len(),
        4,
        "Expected 4 event bboxes with prefix 'p0/m0/s0/' (excluding /n sub-bboxes), got: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
}

#[test]
fn test_condensed_chord_noteheads_keep_each_source_event_path() {
    let json = include_str!("../../../../../packages/format/fixtures/mnx/condensing-test.mnx");
    let mut score = parse_mnx(json).unwrap();
    for (part_idx, part) in score.parts.iter_mut().enumerate() {
        let mut event_index = 0;
        for sequence in &mut part.measures[2].sequences {
            for content in &mut sequence.content {
                if let SequenceContent::Event(event) = content {
                    event.id = Some(format!("source-{part_idx}-event-{event_index}"));
                    event_index += 1;
                }
            }
        }
    }

    let dl = layout_with_mnx_scores(&score, &LayoutConfig::default(), 3);
    let notehead_ids: HashSet<&str> = dl
        .element_bboxes
        .iter()
        .filter(|bbox| bbox.element_id.contains("/m2/") && bbox.element_id.contains("/n"))
        .map(|bbox| bbox.element_id.as_str())
        .collect();
    let tagged_notehead_ids: HashSet<&str> = dl
        .element_ids
        .iter()
        .filter_map(Option::as_deref)
        .filter(|id| id.contains("/m2/") && id.contains("/n"))
        .collect();

    assert!(
        notehead_ids.contains("p0/m2/s0/source-0-event-0/n0"),
        "first source notehead path missing: {notehead_ids:?}"
    );
    assert!(
        notehead_ids.contains("p1/m2/s0/source-1-event-0/n0"),
        "second source notehead path missing: {notehead_ids:?}"
    );
    assert!(
        tagged_notehead_ids.contains("p0/m2/s0/source-0-event-0/n0")
            && tagged_notehead_ids.contains("p1/m2/s0/source-1-event-0/n0"),
        "rendered noteheads and hit boxes must share source paths: {tagged_notehead_ids:?}"
    );
}

#[test]
fn test_condensed_directions_use_source_part_ids() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"id": "measure-1", "time": {"count": 4, "unit": 4}}]},
        "layouts": [{
            "id": "condensed",
            "content": [
                {"type": "staff", "sources": [{"part": "part-1"}, {"part": "part-2"}]},
                {"type": "staff", "sources": [{"part": "part-3"}, {"part": "part-4"}]}
            ]
        }],
        "scores": [{"name": "Condensed", "layout": "condensed"}],
        "parts": [
            {"id": "part-1", "measures": [{"sequences": [{"content": [
                {"id": "event-1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]}]},
            {"id": "part-2", "measures": [{"sequences": [{"content": [
                {"id": "event-2", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]}]}]},
            {"id": "part-3", "measures": [{
                "dynamics": [
                    {"id": "source-dynamic", "type": "immediate", "position": {"fraction": [0, 1]}, "value": "p"},
                    {"id": "source-hairpin", "type": "gradual", "position": {"fraction": [0, 1]},
                     "end": {"measure": "measure-1", "position": {"fraction": [1, 1]}},
                     "wedgeType": "increasing", "visuallyContinues": "source-dynamic"}
                ],
                "_x": {"viritura": {"expressions": [
                    {"text": "cresc.", "position": {"fraction": [0, 1]}}
                ]}},
                "sequences": [{"content": [
                    {"id": "event-3", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "G", "octave": 5}}]}
                ]}]
            }]},
            {"id": "part-4", "measures": [{
                "dynamics": [
                    {"id": "peer-dynamic", "type": "immediate", "position": {"fraction": [0, 1]}, "value": "p"},
                    {"id": "peer-hairpin", "type": "gradual", "position": {"fraction": [0, 1]},
                     "end": {"measure": "measure-1", "position": {"fraction": [1, 1]}},
                     "wedgeType": "increasing", "visuallyContinues": "peer-dynamic"}
                ],
                "sequences": [{"content": [
                    {"id": "event-4", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 5}}]}
                ]}]
            }]}
        ]
    }"#;
    let score = parse_mnx(json).unwrap();
    let dl = layout_with_mnx_scores(&score, &LayoutConfig::default(), 0);

    assert!(dl
        .element_bboxes
        .iter()
        .any(|bbox| bbox.element_id == "p2/m0/dynsource-dynamic"));
    assert!(dl
        .element_bboxes
        .iter()
        .any(|bbox| bbox.element_id == "p2/m0/hairpinsource-hairpin"));
    assert!(dl
        .element_bboxes
        .iter()
        .any(|bbox| bbox.element_id == "p2/m0/expr0"));
}

#[test]
fn test_expression_sits_beside_colocated_dynamic_on_same_baseline() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{
            "dynamics": [{"id": "dynamic-p", "type": "immediate", "position": {"fraction": [0, 1]}, "value": "p"}],
            "_x": {"viritura": {"expressions": [
                {"text": "dolce", "position": {"fraction": [0, 1]}}
            ]}},
            "sequences": [{"content": [
                {"id": "event-1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let dl = layout_score(&score, 0, &LayoutConfig::default());
    let dynamic = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "p0/m0/dyndynamic-p")
        .unwrap();
    let expression = dl
        .element_bboxes
        .iter()
        .find(|bbox| bbox.element_id == "p0/m0/expr0")
        .unwrap_or_else(|| {
            panic!(
                "expression bbox missing: {:?}",
                dl.element_bboxes
                    .iter()
                    .map(|bbox| &bbox.element_id)
                    .collect::<Vec<_>>()
            )
        });

    assert!(expression.bbox.x > dynamic.bbox.x + dynamic.bbox.width);
    let tagged_y = |id: &str| {
        dl.commands
            .iter()
            .zip(&dl.element_ids)
            .find_map(|(command, element_id)| {
                if element_id.as_deref() != Some(id) {
                    return None;
                }
                match command {
                    RenderCommand::DrawGlyph { y, .. } | RenderCommand::DrawText { y, .. } => {
                        Some(*y)
                    }
                    _ => None,
                }
            })
            .unwrap()
    };
    assert!((tagged_y("p0/m0/expr0") - tagged_y("p0/m0/dyndynamic-p")).abs() < 0.1);
}

// ═══════════════════════════════════════
// element_ids parallel alignment tests
// ═══════════════════════════════════════

#[test]
fn test_tag_element_ids_parallel_to_commands() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // element_ids must be same length as commands (when tagging is active)
    if !dl.element_ids.is_empty() {
        assert_eq!(
            dl.element_ids.len(),
            dl.commands.len(),
            "element_ids ({}) must be parallel to commands ({})",
            dl.element_ids.len(),
            dl.commands.len()
        );
    }
}

#[test]
fn test_tag_backfill_none_for_staff_lines() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    if !dl.element_ids.is_empty() {
        // Staff lines (first 5 commands) should be tagged None (rendered before any element tagging)
        let first_tagged = dl.element_ids.iter().position(|id| id.is_some());
        assert!(
            first_tagged.is_some(),
            "Should have at least one tagged command"
        );
        let idx = first_tagged.unwrap();
        // All commands before the first tagged one should be None
        for i in 0..idx {
            assert!(
                dl.element_ids[i].is_none(),
                "Command {} before first tag at {} should be None",
                i,
                idx
            );
        }
    }
}

// ═══════════════════════════════════════
// All commands for an event share same ID
// ═══════════════════════════════════════

#[test]
fn test_tag_all_event_commands_share_id() {
    // A quarter note with accidental: produces notehead glyph + stem + accidental glyph
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}, "accidentalDisplay": {"show": true}}]},
            {"duration": {"base": "quarter"}, "rest": {}},
            {"duration": {"base": "half"}, "rest": {}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    if !dl.element_ids.is_empty() {
        // Find the first event ID matching p0/m0/s0/ prefix. An event ID has
        // exactly four segments; anything longer is a sub-element (/n0, /acc0).
        let event_id = dl
            .element_ids
            .iter()
            .filter_map(|id| id.as_ref())
            .find(|id| id.starts_with("p0/m0/s0/") && id.split('/').count() == 4)
            .expect("Should have at least one event tagged with p0/m0/s0/ prefix")
            .clone();
        // Count commands tagged with either the event ID or a sub-ID of it
        let tagged_indices: Vec<usize> = dl
            .element_ids
            .iter()
            .enumerate()
            .filter(|(_, id)| match id.as_deref() {
                Some(s) => s == event_id || s.starts_with(&format!("{}/", event_id)),
                None => false,
            })
            .map(|(i, _)| i)
            .collect();

        // Should have multiple commands (notehead + stem + accidental at minimum)
        assert!(
            tagged_indices.len() >= 2,
            "Event '{}' should tag multiple commands (notehead, stem, accidental), got {}",
            event_id,
            tagged_indices.len()
        );

        // All tagged commands should be contiguous
        for w in tagged_indices.windows(2) {
            assert_eq!(
                w[1],
                w[0] + 1,
                "Event commands should be contiguous: indices {:?}",
                tagged_indices
            );
        }
    }
}

// ═══════════════════════════════════════
// Accidental sub-element tagging
// ═══════════════════════════════════════

#[test]
fn test_tag_accidental_gets_own_id_per_note() {
    // A chord whose second note is altered, plus a later single altered note.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [
                {"pitch": {"step": "C", "octave": 4}},
                {"pitch": {"step": "E", "octave": 4, "alter": 1}}
            ]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 5, "alter": -1}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let accidental_ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/acc"))
        .collect();

    // The chord's sharp names note index 1; the later flat is a single note, so
    // it names index 0. Indices track the note, not the order of placement.
    assert!(
        accidental_ids.iter().any(|id| id.ends_with("/acc1")),
        "chord's altered second note should tag /acc1, got {:?}",
        accidental_ids
    );
    assert!(
        accidental_ids.iter().any(|id| id.ends_with("/acc0")),
        "single altered note should tag /acc0, got {:?}",
        accidental_ids
    );
}

#[test]
fn test_tag_accidental_is_not_part_of_its_notehead() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4, "alter": 1}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let accidental = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .find(|id| id.contains("/acc"))
        .expect("altered note should emit an accidental");

    // Selection resolves descendant ids, so an accidental nested under its
    // notehead would be swept back into note selection.
    assert!(
        !accidental.contains("/n0/"),
        "accidental '{}' must be a sibling of the notehead, not a child",
        accidental
    );
    assert!(
        dl.element_bboxes
            .iter()
            .any(|eb| eb.element_id == *accidental && eb.bbox.width > 0.0),
        "accidental '{}' should publish a bbox for hit-testing",
        accidental
    );
}

// ═══════════════════════════════════════
// Articulation sub-element tagging
// ═══════════════════════════════════════

#[test]
fn test_tag_articulation_named_by_marking() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"staccato": {}, "stress": {}}},
            {"duration": {"base": "half"}, "rest": {}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/art-"))
        .collect();

    assert!(
        ids.iter().any(|id| id.ends_with("/art-staccato")),
        "expected a staccato tagged by name, got {:?}",
        ids
    );
    assert!(
        ids.iter().any(|id| id.ends_with("/art-stress")),
        "expected a stress tagged by name, got {:?}",
        ids
    );
}

#[test]
fn test_tag_articulation_combo_names_both_markings() {
    // accent + staccato collapse into one ligature glyph, so the id names both.
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"accent": {}, "staccato": {}}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let ids: Vec<&String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.as_ref())
        .filter(|id| id.contains("/art-"))
        .collect();

    assert_eq!(ids.len(), 1, "combo should emit one glyph, got {:?}", ids);
    assert!(
        ids[0].ends_with("/art-accent.staccato"),
        "combo id should name both markings, got {:?}",
        ids
    );
}

#[test]
fn test_tag_articulation_id_is_stable_under_slur() {
    // A slur moves marcato from the staff-anchored pass to the close-to-note
    // pass. Under positional ids that renumbered the event's articulations;
    // named ids must not move.
    let with_slur = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "half"}, "id": "a", "notes": [{"pitch": {"step": "C", "octave": 4}}],
             "markings": {"strongAccent": {}, "staccatissimo": {}},
             "slurs": [{"target": "b"}]},
            {"duration": {"base": "half"}, "id": "b", "notes": [{"pitch": {"step": "E", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let without_slur = with_slur.replace(r#","slurs": [{"target": "b"}]"#, "");

    let names_for = |json: &str| -> Vec<String> {
        let score = parse_mnx(json).unwrap();
        let dl = layout_score(&score, 0, &LayoutConfig::default());
        let mut names: Vec<String> = dl
            .element_ids
            .iter()
            .filter_map(|id| id.as_ref())
            .filter(|id| id.contains("/art-"))
            .cloned()
            .collect();
        names.sort();
        names
    };

    assert_eq!(
        names_for(with_slur),
        names_for(&without_slur),
        "articulation ids must not depend on slur participation"
    );
}

// ═══════════════════════════════════════
// Multi-measure ID correctness
// ═══════════════════════════════════════

#[test]
fn test_tag_multi_measure_indices() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}},
            {},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Each measure should have an event bbox with correct measure index (prefix p0/m{}/s0/)
    for m in 0..3 {
        let prefix = format!("p0/m{}/s0/", m);
        let found = dl
            .element_bboxes
            .iter()
            .any(|eb| eb.element_id.starts_with(&prefix));
        assert!(
            found,
            "Expected event bbox with prefix '{}' in measure {}, got: {:?}",
            prefix,
            m,
            dl.element_bboxes
                .iter()
                .map(|eb| &eb.element_id)
                .collect::<Vec<_>>()
        );
    }

    // Measures 1 and 2 should have barline bboxes
    for m in 1..3 {
        let expected_id = format!("m{}/barline", m);
        let found = dl
            .element_bboxes
            .iter()
            .any(|eb| eb.element_id == expected_id);
        assert!(
            found,
            "Expected barline bbox '{}' for measure {}",
            expected_id, m
        );
    }
}

// ═══════════════════════════════════════
// Multi-voice event IDs
// ═══════════════════════════════════════

#[test]
fn test_tag_multi_voice_event_ids() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [
            {"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 5}}]}
            ]},
            {"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}
        ]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Voice 0 event: s0/..., Voice 1 event: s1/...
    let voice1 = dl
        .element_bboxes
        .iter()
        .any(|eb| eb.element_id.starts_with("p0/m0/s0/"));
    let voice2 = dl
        .element_bboxes
        .iter()
        .any(|eb| eb.element_id.starts_with("p0/m0/s1/"));
    assert!(
        voice1,
        "Voice 0 event should have prefix 'p0/m0/s0/', got: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
    assert!(
        voice2,
        "Voice 1 event should have prefix 'p0/m0/s1/', got: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
}

// ═══════════════════════════════════════
// Key signature tagging
// ═══════════════════════════════════════

#[test]
fn test_tag_key_signature_bbox() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let key = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id == "p0/m0/key");
    assert!(
        key.is_some(),
        "Key signature should have bbox with ID 'p0/m0/key', got: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
    let key = key.unwrap();
    assert!(
        key.bbox.width > 0.0,
        "Key sig bbox should have positive width"
    );
    assert!(
        key.bbox.height > 0.0,
        "Key sig bbox should have positive height"
    );
}

#[test]
fn test_tag_key_signature_element_ids() {
    // Verify render_measure tags key signature commands with correct ID
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}, "key": {"fifths": 2}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    if !dl.element_ids.is_empty() {
        let has_key_tag = dl
            .element_ids
            .iter()
            .any(|id| id.as_deref() == Some("p0/m0/key"));
        assert!(
            has_key_tag,
            "render_measure should tag key signature commands with 'p0/m0/key'"
        );
    }
}

/// Every accidental of a key signature — including the continuation signatures
/// restated at each system start — must be tagged with the signature's element
/// id and enclosed by its hitbox. Otherwise a click lands on the barline and
/// the selection highlight re-inks only the leftmost accidental.
#[test]
fn key_signature_hitbox_covers_every_restated_accidental() {
    let mut global = String::from(r#"{"time": {"count": 4, "unit": 4}, "key": {"fifths": 4}}"#);
    let mut part = String::from(
        r#"{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}]}]}"#,
    );
    for _ in 0..23 {
        global.push_str(r#",{}"#);
        part.push_str(
            r#",{"sequences": [{"content": [{"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}]}]}"#,
        );
    }
    let json = format!(
        r#"{{"mnx": {{"version": 1}}, "global": {{"measures": [{global}]}}, "parts": [{{"measures": [{part}]}}]}}"#
    );

    let score = parse_mnx(&json).unwrap();
    // Narrow page so the measures wrap onto several systems, each restating
    // the signature.
    let config = LayoutConfig {
        page_width: Some(400.0),
        page_margin_left: 0.0,
        page_margin_right: 0.0,
        ..Default::default()
    };
    let dl = layout_score(&score, 0, &config);

    // Collect the drawn accidentals per key-signature element.
    let mut per_key: std::collections::HashMap<String, Vec<(f64, f64)>> =
        std::collections::HashMap::new();
    for (i, cmd) in dl.commands.iter().enumerate() {
        let Some(Some(id)) = dl.element_ids.get(i) else {
            continue;
        };
        if !id.ends_with("/key") {
            continue;
        }
        if let RenderCommand::DrawGlyph { x, y, .. } = cmd {
            per_key.entry(id.clone()).or_default().push((*x, *y));
        }
    }

    assert!(
        per_key.len() > 1,
        "expected continuation key signatures on later systems, got {:?}",
        per_key.keys().collect::<Vec<_>>()
    );

    for (id, glyphs) in &per_key {
        assert_eq!(
            glyphs.len(),
            4,
            "all four sharps of {id} should carry the signature's element id"
        );
        let bboxes: Vec<_> = dl
            .element_bboxes
            .iter()
            .filter(|eb| &eb.element_id == id)
            .collect();
        assert!(!bboxes.is_empty(), "{id} should have a selection hitbox");
        for (gx, gy) in glyphs {
            assert!(
                bboxes.iter().any(|eb| {
                    *gx >= eb.bbox.x
                        && *gx <= eb.bbox.x + eb.bbox.width
                        && *gy >= eb.bbox.y
                        && *gy <= eb.bbox.y + eb.bbox.height
                }),
                "accidental at ({gx}, {gy}) lies outside the hitbox of {id}: {:?}",
                bboxes.iter().map(|eb| &eb.bbox).collect::<Vec<_>>()
            );
        }
    }
}

// ═══════════════════════════════════════
// Dynamics bboxes
// ═══════════════════════════════════════
#[test]
fn test_tag_dynamics_bbox() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}],
            "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
            ]}],
            "dynamics": [{"type": "immediate", "value": "f", "position": {"fraction": [0, 1]}}]
        }]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let dyn_bbox = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id.starts_with("p0/m0/dyn"));
    assert!(
        dyn_bbox.is_some(),
        "Dynamics should have a stable group-id bbox, got: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
    let dyn_bbox = dyn_bbox.unwrap();
    assert!(
        dyn_bbox.bbox.width > 0.0,
        "Dynamics bbox should have positive width"
    );
}

// ═══════════════════════════════════════
// Rest event tagging
// ═══════════════════════════════════════

#[test]
fn test_tag_rest_event_id_format() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "rest": {}},
            {"duration": {"base": "quarter"}, "rest": {}},
            {"duration": {"base": "half"}, "rest": {}}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Rests should get event bboxes with s0/ prefix
    let rest_bboxes: Vec<_> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.starts_with("p0/m0/s0/"))
        .collect();
    assert_eq!(
        rest_bboxes.len(),
        3,
        "Expected 3 rest event bboxes with prefix 'p0/m0/s0/', got: {:?}",
        dl.element_bboxes
            .iter()
            .map(|eb| &eb.element_id)
            .collect::<Vec<_>>()
    );
}

// ═══════════════════════════════════════
// Clef command tagging via element_ids
// ═══════════════════════════════════════

#[test]
fn test_tag_clef_command_tagged() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    if !dl.element_ids.is_empty() {
        let has_clef_tag = dl
            .element_ids
            .iter()
            .any(|id| id.as_deref() == Some("p0/m0/clef"));
        assert!(
            has_clef_tag,
            "Clef command should be tagged with 'p0/m0/clef'"
        );
    }
}

#[test]
fn test_tag_time_command_tagged() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    if !dl.element_ids.is_empty() {
        // render_measure tags time sig as "m{}/time" (no part prefix)
        let has_time_tag = dl
            .element_ids
            .iter()
            .any(|id| id.as_deref() == Some("m0/time"));
        assert!(
            has_time_tag,
            "Time sig command should be tagged with 'm0/time'"
        );
    }
}

// ═══════════════════════════════════════
// Full score tagging across parts
// ═══════════════════════════════════════

#[test]
fn test_tag_full_score_multi_part() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [
            {"name": "Violin", "measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]}]},
            {"name": "Cello", "measures": [{"clefs": [{"clef": {"sign": "F", "staffPosition": 2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
            ]}]}]}
        ]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_full_score(&score, &config);

    // layout_full_score tags commands via render_measure (element_ids).
    // Verify both parts have tagged commands.
    if !dl.element_ids.is_empty() {
        let p0_clef = dl
            .element_ids
            .iter()
            .any(|id| id.as_deref() == Some("p0/m0/clef"));
        let p0_event = dl
            .element_ids
            .iter()
            .any(|id| id.as_deref().is_some_and(|s| s.starts_with("p0/m0/s0/")));
        assert!(p0_clef, "Part 0 clef should be tagged in full score");
        assert!(p0_event, "Part 0 event should be tagged in full score");

        let p1_clef = dl
            .element_ids
            .iter()
            .any(|id| id.as_deref() == Some("p1/m0/clef"));
        let p1_event = dl
            .element_ids
            .iter()
            .any(|id| id.as_deref().is_some_and(|s| s.starts_with("p1/m0/s0/")));
        assert!(
            p1_clef,
            "Part 1 clef should be tagged in full score, got: {:?}",
            dl.element_ids
                .iter()
                .filter_map(|id| id.as_ref())
                .collect::<Vec<_>>()
        );
        assert!(p1_event, "Part 1 event should be tagged in full score");
    }
}

// ═══════════════════════════════════════
// No duplicate element IDs in bboxes
// ═══════════════════════════════════════

#[test]
fn test_tag_no_duplicate_bbox_ids() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let mut seen = HashSet::new();
    for eb in &dl.element_bboxes {
        assert!(
            seen.insert(&eb.element_id),
            "Duplicate element bbox ID: '{}'",
            eb.element_id
        );
    }
}

// ═══════════════════════════════════════
// All bboxes have valid dimensions
// ═══════════════════════════════════════

#[test]
fn test_tag_all_bboxes_positive_dimensions() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [
            {"time": {"count": 3, "unit": 4}, "key": {"fifths": -3}},
            {}
        ]},
        "parts": [{"measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "E", "octave": 4}}, {"pitch": {"step": "G", "octave": 4}}]},
                {"duration": {"base": "quarter"}, "rest": {}}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "half", "dots": 1}, "notes": [{"pitch": {"step": "C", "octave": 5}}]}
            ]}]}
        ]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    assert!(
        !dl.element_bboxes.is_empty(),
        "Should produce element bboxes"
    );
    for eb in &dl.element_bboxes {
        assert!(
            eb.bbox.width > 0.0,
            "bbox '{}' should have positive width, got {}",
            eb.element_id,
            eb.bbox.width
        );
        assert!(
            eb.bbox.height > 0.0,
            "bbox '{}' should have positive height, got {}",
            eb.element_id,
            eb.bbox.height
        );
    }
}

// ═══════════════════════════════════════
// Tag consistency between element_ids and element_bboxes
// ═══════════════════════════════════════

#[test]
fn test_tag_event_ids_match_bboxes() {
    // Verify that events tagged in element_ids also appear in element_bboxes
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]},
            {"duration": {"base": "quarter"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]},
            {"duration": {"base": "half"}, "notes": [{"pitch": {"step": "G", "octave": 4}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    // Collect unique event IDs from element_ids (tagged commands)
    let tagged_event_ids: HashSet<String> = dl
        .element_ids
        .iter()
        .filter_map(|id| id.clone())
        .filter(|id| id.contains("/s0/"))
        .collect();

    // Collect event IDs from element_bboxes
    let bbox_event_ids: HashSet<String> = dl
        .element_bboxes
        .iter()
        .filter(|eb| eb.element_id.contains("/s0/"))
        .map(|eb| eb.element_id.clone())
        .collect();

    // Both should have the same count of events
    assert_eq!(
        tagged_event_ids.len(),
        bbox_event_ids.len(),
        "Tagged event count ({}) should match bbox event count ({})\nTagged: {:?}\nBboxes: {:?}",
        tagged_event_ids.len(),
        bbox_event_ids.len(),
        tagged_event_ids,
        bbox_event_ids
    );
}

// ═══════════════════════════════════════
// DisplayList push_tagged / tag_command unit tests
// ═══════════════════════════════════════

#[test]
fn test_tag_push_tagged_backfills() {
    let mut dl = DisplayList::new(100.0, 100.0);

    // Push some untagged commands first
    dl.push(RenderCommand::DrawLine {
        x1: 0.0,
        y1: 0.0,
        x2: 10.0,
        y2: 10.0,
        width: 1.0,
        color: "#000000".into(),
    });
    dl.push(RenderCommand::DrawLine {
        x1: 0.0,
        y1: 0.0,
        x2: 20.0,
        y2: 20.0,
        width: 1.0,
        color: "#000000".into(),
    });

    // element_ids should be empty before first tag
    assert!(
        dl.element_ids.is_empty(),
        "element_ids should be empty before first tag"
    );

    // push_tagged should backfill
    dl.push_tagged(
        RenderCommand::DrawGlyph {
            x: 10.0,
            y: 20.0,
            codepoint: 0xE050,
            font: "Bravura".into(),
            size: 48.0,
            color: "#000000".into(),
            rotation: 0.0,
        },
        "test/glyph".into(),
    );

    assert_eq!(
        dl.element_ids.len(),
        3,
        "Should have 3 entries after backfill + push"
    );
    assert_eq!(dl.element_ids[0], None);
    assert_eq!(dl.element_ids[1], None);
    assert_eq!(dl.element_ids[2], Some("test/glyph".into()));
}

#[test]
fn test_tag_tag_command_backfills() {
    let mut dl = DisplayList::new(100.0, 100.0);

    dl.push(RenderCommand::DrawLine {
        x1: 0.0,
        y1: 0.0,
        x2: 10.0,
        y2: 10.0,
        width: 1.0,
        color: "#000000".into(),
    });
    dl.push(RenderCommand::DrawGlyph {
        x: 10.0,
        y: 20.0,
        codepoint: 0xE050,
        font: "Bravura".into(),
        size: 48.0,
        color: "#000000".into(),
        rotation: 0.0,
    });

    assert!(
        dl.element_ids.is_empty(),
        "element_ids empty before first tag_command"
    );

    dl.tag_command(1, "test/tagged".into());

    assert_eq!(
        dl.element_ids.len(),
        2,
        "Should backfill to match commands length"
    );
    assert_eq!(dl.element_ids[0], None);
    assert_eq!(dl.element_ids[1], Some("test/tagged".into()));
}

#[test]
fn test_tag_push_after_tagged_appends_none() {
    let mut dl = DisplayList::new(100.0, 100.0);

    dl.push_tagged(
        RenderCommand::DrawGlyph {
            x: 0.0,
            y: 0.0,
            codepoint: 0xE050,
            font: "Bravura".into(),
            size: 48.0,
            color: "#000000".into(),
            rotation: 0.0,
        },
        "first".into(),
    );

    // Regular push after tagging should append None
    dl.push(RenderCommand::DrawLine {
        x1: 0.0,
        y1: 0.0,
        x2: 10.0,
        y2: 10.0,
        width: 1.0,
        color: "#000000".into(),
    });

    assert_eq!(dl.element_ids.len(), 2);
    assert_eq!(dl.element_ids[0], Some("first".into()));
    assert_eq!(dl.element_ids[1], None);
}

// ═══════════════════════════════════════
// F-clef tagging
// ═══════════════════════════════════════

#[test]
fn test_tag_f_clef_bbox() {
    let json = r#"{
        "mnx": {"version": 1},
        "global": {"measures": [{"time": {"count": 4, "unit": 4}}]},
        "parts": [{"measures": [{"clefs": [{"clef": {"sign": "F", "staffPosition": 2}}], "sequences": [{"content": [
            {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
        ]}]}]}]
    }"#;
    let score = parse_mnx(json).unwrap();
    let config = LayoutConfig::default();
    let dl = layout_score(&score, 0, &config);

    let clef = dl
        .element_bboxes
        .iter()
        .find(|eb| eb.element_id == "p0/m0/clef");
    assert!(
        clef.is_some(),
        "F-clef should have bbox with ID 'p0/m0/clef'"
    );
    let clef = clef.unwrap();
    assert!(clef.bbox.width > 0.0);
    assert!(clef.bbox.height > 0.0);
}

// ═══════════════════════════════════════
// Barline connectors between staves
// ═══════════════════════════════════════

/// Two parts, two measures — so the boundary barline at measure 1 runs across
/// both staves and the gap between them.
const TWO_STAFF_TWO_BAR: &str = r#"{
    "mnx": {"version": 1},
    "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
    "parts": [
        {"name": "Violin", "measures": [
            {"clefs": [{"clef": {"sign": "G", "staffPosition": -2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "A", "octave": 4}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "B", "octave": 4}}]}
            ]}]}
        ]},
        {"name": "Cello", "measures": [
            {"clefs": [{"clef": {"sign": "F", "staffPosition": 2}}], "sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 3}}]}
            ]}]},
            {"sequences": [{"content": [
                {"duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 3}}]}
            ]}]}
        ]}
    ]
}"#;

/// Vertical extent of a barline-ish command.
fn command_y_span(cmd: &RenderCommand) -> Option<(f64, f64)> {
    match cmd {
        RenderCommand::DrawLine { y1, y2, .. } => Some((y1.min(*y2), y1.max(*y2))),
        RenderCommand::DrawRect { y, h, .. } => Some((*y, y + h)),
        _ => None,
    }
}

/// Assert that `spans` cover one uninterrupted vertical run — no hole between
/// the highest top and the lowest bottom.
fn assert_continuous(mut spans: Vec<(f64, f64)>, what: &str) {
    assert!(!spans.is_empty(), "{what}: nothing to check");
    spans.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    let mut reach = spans[0].1;
    for &(top, bottom) in &spans[1..] {
        assert!(
            top <= reach + 0.01,
            "{what}: gap between y={reach:.1} and y={top:.1}"
        );
        reach = reach.max(bottom);
    }
}

/// A barline is one object from the top staff to the bottom, and the runs
/// between staves belong to it as much as the runs on them. Untagged
/// connectors would leave the selection highlight striped — lit across each
/// staff, dark in every gap.
#[test]
fn barline_connectors_are_tagged_as_part_of_the_barline() {
    let score = parse_mnx(TWO_STAFF_TWO_BAR).unwrap();
    let config = LayoutConfig::default();
    for (path, dl) in [
        ("full score", layout_full_score(&score, &config)),
        ("mnx layout", layout_with_mnx_scores(&score, &config, 0)),
    ] {
        let spans: Vec<(f64, f64)> = dl
            .commands
            .iter()
            .enumerate()
            .filter(|(i, _)| {
                dl.element_ids.get(*i).and_then(|id| id.as_deref()) == Some("m1/barline")
            })
            .filter_map(|(_, cmd)| command_y_span(cmd))
            .collect();

        assert!(
            spans.len() > 2,
            "{path}: expected a run per staff plus the connector between them, got {}",
            spans.len()
        );
        assert_continuous(spans, path);
    }
}

/// …and the gap is clickable. On a tall system the run between two staves is
/// often the easiest part of a barline to aim at, since nothing else is drawn
/// there; without a hit region over it the click falls through to the page.
#[test]
fn barline_hit_region_covers_the_gap_between_staves() {
    let score = parse_mnx(TWO_STAFF_TWO_BAR).unwrap();
    let config = LayoutConfig::default();
    for (path, dl) in [
        ("full score", layout_full_score(&score, &config)),
        ("mnx layout", layout_with_mnx_scores(&score, &config, 0)),
    ] {
        let gap_middle = inter_staff_gap_middle(&dl);
        let covers_gap = dl.element_bboxes.iter().any(|eb| {
            eb.element_id == "m1/barline"
                && eb.bbox.y <= gap_middle
                && eb.bbox.y + eb.bbox.height >= gap_middle
        });
        assert!(
            covers_gap,
            "{path}: no barline hit region covers y={gap_middle:.1}, between the staves"
        );
    }
}

/// Y midway between the bottom line of the first staff and the top line of the
/// second, found from the staff lines themselves.
fn inter_staff_gap_middle(dl: &DisplayList) -> f64 {
    let mut ys: Vec<f64> = dl
        .commands
        .iter()
        .filter_map(|cmd| match cmd {
            RenderCommand::DrawLine { y1, y2, .. } if (y1 - y2).abs() < 0.01 => Some(*y1),
            _ => None,
        })
        .collect();
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    ys.dedup_by(|a, b| (*a - *b).abs() < 0.5);
    assert!(ys.len() >= 10, "expected two staves' worth of staff lines");
    // Lines 0–4 are the first staff, 5–9 the second.
    (ys[4] + ys[5]) * 0.5
}
