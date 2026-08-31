// Integration coverage for the opt-in auto page-turn pagination path.
//
// These tests drive real MNX fixtures through the full layout pipeline with
// `page_turns.enabled = true`, exercising the model-extraction and optimizer
// wiring end-to-end (not just the synthetic unit tests in the page_turn
// module). They assert the enabled path never panics and still produces a
// valid, non-empty DisplayList for every fixture.

use crate::layout::config::LayoutConfig;
use crate::layout::mnx_layout::layout_with_mnx_scores;
use crate::parse::parse_mnx;
use std::path::PathBuf;
fn scores_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .join("..")
        .join("..")
        .join("packages")
        .join("format")
        .join("fixtures")
        .join("mnx")
}

fn mnx_files() -> Vec<PathBuf> {
    let dir = scores_dir();
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("Cannot read scores dir {}: {e}", dir.display()))
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            (path.extension().and_then(|e| e.to_str()) == Some("mnx")).then_some(path)
        })
        .collect();
    files.sort();
    files
}

/// With page turns enabled, every fixture must still lay out without panicking
/// and yield a non-empty DisplayList.
#[test]
fn page_turns_enabled_lays_out_all_fixtures() {
    let mut config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    config.page_turns.enabled = true;

    let mut failures: Vec<String> = Vec::new();
    for path in mnx_files() {
        let file_name = path.file_name().unwrap().to_string_lossy().to_string();
        let json = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("Cannot read {file_name}: {e}"));
        let score = match parse_mnx(&json) {
            Ok(s) => s,
            Err(e) => {
                failures.push(format!("{file_name}: parse failed: {e}"));
                continue;
            }
        };
        let score_count = if score.scores.is_empty() {
            1
        } else {
            score.scores.len()
        };
        for score_idx in 0..score_count {
            let dl = layout_with_mnx_scores(&score, &config, score_idx);
            if dl.commands.is_empty() {
                failures.push(format!(
                    "{file_name} (score {score_idx}): no render commands"
                ));
            }
            if dl.width <= 0.0 || dl.height <= 0.0 {
                failures.push(format!(
                    "{file_name} (score {score_idx}): non-positive dimensions"
                ));
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} page-turn failure(s):\n  {}",
        failures.len(),
        failures.join("\n  ")
    );
}

/// The enabled path must be a strict superset of the default packer's behavior:
/// since forced starts only ADD breaks (and the packer still breaks on
/// overflow), an enabled layout must never have FEWER pages than the disabled
/// one for the same score.
#[test]
fn page_turns_never_reduce_page_count() {
    let disabled = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };
    let mut enabled = disabled.clone();
    enabled.page_turns.enabled = true;

    for path in mnx_files() {
        let file_name = path.file_name().unwrap().to_string_lossy().to_string();
        let json = std::fs::read_to_string(&path).unwrap();
        let Ok(score) = parse_mnx(&json) else {
            continue;
        };
        let dl_off = layout_with_mnx_scores(&score, &disabled, 0);
        let dl_on = layout_with_mnx_scores(&score, &enabled, 0);
        assert!(
            dl_on.pages.len() >= dl_off.pages.len(),
            "{file_name}: enabled page count {} < disabled {}",
            dl_on.pages.len(),
            dl_off.pages.len()
        );
    }
}

/// Regression: a page that ENDS on a collapsed multimeasure rest, followed by
/// a page that opens with NOTES, must not emit a courtesy "N bars rest" hint
/// that counts the bars hidden inside that trailing MMR.
///
/// This is the end-to-end companion to
/// [`crate::layout::page_turn::tests`]'s unit coverage of
/// `system_measure_range`. The bug read the turn boundary at the *start*
/// measure of a system's last visible block; for a collapsed MMR that counted
/// the still-on-this-page interior rests (a 3-bar MMR at the foot produced a
/// bogus "⊢2⊣" even though the next page opened with notes).
///
/// The fixture has exactly one run of whole-bar rests (a single 3-bar MMR)
/// sandwiched between melody, so the only musically-correct nonzero hint is
/// `⊢3⊣` (a page OPENING with the whole MMR). Any emitted count of 1 or 2
/// means the boundary landed inside the MMR — the bug.
#[test]
fn page_turn_hint_never_counts_into_a_trailing_mmr() {
    fn quarter(step: &str) -> String {
        format!(
            "{{\"duration\":{{\"base\":\"quarter\"}},\"notes\":[{{\"pitch\":{{\"step\":\"{step}\",\"octave\":5}}}}]}}"
        )
    }

    fn melody() -> String {
        let c = [quarter("C"), quarter("D"), quarter("E"), quarter("F")].join(",");
        format!("{{\"sequences\":[{{\"content\":[{c}]}}]}}")
    }
    fn whole_rest() -> String {
        "{\"sequences\":[{\"content\":[{\"duration\":{\"base\":\"whole\"}}]}]}".to_string()
    }

    // 18 measures: melody[0..=6], 3-bar MMR[7..=9], melody[10..=17].
    let mmr_start = 7usize;
    let mmr_len = 3usize;
    let total = 18usize;
    let global: Vec<String> = (0..total)
        .map(|i| {
            if i == 0 {
                "{\"id\":\"m1\",\"time\":{\"count\":4,\"unit\":4},\"key\":{\"fifths\":0}}"
                    .to_string()
            } else {
                format!("{{\"id\":\"m{}\"}}", i + 1)
            }
        })
        .collect();

    let mut measures: Vec<String> = Vec::new();
    measures.push(format!(
        "{{\"clefs\":[{{\"clef\":{{\"sign\":\"G\",\"staffPosition\":-2}}}}],\"sequences\":[{{\"content\":[{}]}}]}}",
        [quarter("C"), quarter("D"), quarter("E"), quarter("F")].join(",")
    ));
    for i in 1..total {
        if (mmr_start..mmr_start + mmr_len).contains(&i) {
            measures.push(whole_rest());
        } else {
            measures.push(melody());
        }
    }

    let json = format!(
        "{{\"mnx\":{{\"version\":1}},\"global\":{{\"measures\":[{}]}},\"parts\":[{{\"id\":\"vn\",\"name\":\"Violin\",\"measures\":[{}]}}]}}",
        global.join(","),
        measures.join(",")
    );
    let score = parse_mnx(&json).expect("fixture parses");

    // Sweep page geometry so a variety of pagination boundaries are exercised;
    // the invariant must hold for every one of them.
    for &page_w in &[260.0_f64, 520.0, 900.0] {
        for &page_h in &[20.0_f64, 28.0, 34.0, 42.0, 55.0] {
            let mut config = LayoutConfig {
                page_width: Some(page_w),
                page_height: page_h,
                multimeasure_rests: true,
                ..LayoutConfig::default()
            };
            config.page_turns.enabled = true;

            let dl = layout_with_mnx_scores(&score, &config, 0);
            for cmd in &dl.commands {
                if let crate::render::RenderCommand::DrawText { text, .. } = cmd {
                    if let Some(rest) = text.strip_prefix('\u{22A2}') {
                        let digits: String =
                            rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                        let n: usize = digits.parse().unwrap_or(0);
                        assert!(
                            n == 0 || n == mmr_len,
                            "page {page_w}x{page_h}: hint counted {n} bars, but the only rest \
                             run is a {mmr_len}-bar MMR — a count of 1 or 2 means the turn \
                             boundary landed inside the trailing MMR (the bug)"
                        );
                    }
                }
            }
        }
    }
}

fn system_count(dl: &crate::render::DisplayList) -> usize {
    dl.measure_bounds
        .iter()
        .map(|bound| bound.system_index)
        .max()
        .map_or(0, |index| index + 1)
}

#[test]
fn page_turns_leave_full_scores_and_authored_pagination_unchanged() {
    fn assert_unchanged(json: &str, score_index: usize) {
        let score = parse_mnx(json).expect("fixture parses");
        let disabled = LayoutConfig {
            page_width: Some(800.0),
            ..LayoutConfig::default()
        };
        let mut enabled = disabled.clone();
        enabled.page_turns.enabled = true;
        let before = layout_with_mnx_scores(&score, &disabled, score_index);
        let after = layout_with_mnx_scores(&score, &enabled, score_index);

        assert_eq!(
            serde_json::to_value(after).expect("display list serializes"),
            serde_json::to_value(before).expect("display list serializes")
        );
    }

    assert_unchanged(
        include_str!("../../../../../packages/format/fixtures/mnx/parts.mnx"),
        0,
    );
    assert_unchanged(
        include_str!("../../../../../packages/format/fixtures/mnx/system-layouts.mnx"),
        0,
    );
}

#[test]
fn beethoven_flute_bassoons_and_violins_keep_dense_natural_casting() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let score = parse_mnx(json).expect("Beethoven fixture parses");
    let sp = 1.625 * 12.0;
    let base = LayoutConfig {
        sp,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        ..LayoutConfig::default()
    };
    let mut planned_config = base.clone();
    planned_config.page_turns.enabled = true;
    planned_config.page_turns.allow_intentional_blanks = false;

    for score_index in [2, 8, 9, 15, 16] {
        let greedy = layout_with_mnx_scores(&score, &base, score_index);
        let planned = layout_with_mnx_scores(&score, &planned_config, score_index);
        assert_eq!(
            system_count(&planned),
            system_count(&greedy),
            "{} must retain its natural system count",
            score.scores[score_index].name.as_deref().unwrap_or("part")
        );
        assert!(planned.pages.iter().all(|page| {
            page.system_indices.is_empty()
                || page.system_indices.len() > 1
                || page.page_number + 1 == planned.pages.len()
        }));
    }

    let flute = &score.scores[2];
    let longest_rest = flute
        .multimeasure_rests
        .iter()
        .max_by_key(|range| range.duration)
        .expect("Flute 1 has collapsed rests");
    let rest_start = score
        .global
        .measures
        .iter()
        .position(|measure| measure.id.as_deref() == Some(longest_rest.start.as_str()))
        .expect("Flute MMR start is global");
    let flute_layout = layout_with_mnx_scores(&score, &planned_config, 2);
    let rest_system = flute_layout
        .measure_bounds
        .iter()
        .find(|bound| bound.index == rest_start)
        .map(|bound| bound.system_index)
        .expect("Flute MMR is visible");
    let rest_page = flute_layout
        .pages
        .iter()
        .position(|page| page.system_indices.contains(&rest_system))
        .expect("Flute MMR belongs to a page");
    assert_eq!(
        flute_layout.pages[rest_page].system_indices.last(),
        Some(&rest_system),
        "Flute 1's longest visible MMR should remain at the outgoing page foot"
    );
}

#[test]
fn beethoven_bassoon_one_keeps_mmr_before_page_break() {
    let score = parse_mnx(include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    ))
    .expect("fixture parses");
    let mut config = LayoutConfig {
        sp: 1.625 * 12.0,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        ..LayoutConfig::default()
    };
    config.page_turns.enabled = true;
    config.page_turns.allow_intentional_blanks = false;
    let layout = layout_with_mnx_scores(&score, &config, 8);
    let rest = score.scores[8]
        .multimeasure_rests
        .iter()
        .find(|rest| rest.duration == 10)
        .expect("Bassoon 1 has the target MMR");
    let rest_start = score
        .global
        .measures
        .iter()
        .position(|measure| measure.id.as_deref() == Some(rest.start.as_str()))
        .expect("MMR start is global");
    let after_rest = rest_start + rest.duration as usize;
    let rest_system = layout
        .measure_bounds
        .iter()
        .find(|bound| bound.index == rest_start)
        .map(|bound| bound.system_index)
        .expect("MMR has a visible measure bound");
    let after_rest_system = layout
        .measure_bounds
        .iter()
        .find(|bound| bound.index == after_rest)
        .map(|bound| bound.system_index)
        .expect("music after the MMR is visible");
    let rest_page = layout
        .pages
        .iter()
        .position(|page| page.system_indices.contains(&rest_system))
        .expect("MMR belongs to a page");
    assert_eq!(
        rest_page, 2,
        "the long Bassoon 1 rest should end printed page 3"
    );
    assert_eq!(
        layout.pages[rest_page].system_indices.last(),
        Some(&rest_system),
        "the MMR system must sit at the outgoing page foot"
    );
    assert_eq!(
        layout.pages[rest_page + 1].system_indices.first(),
        Some(&after_rest_system),
        "music after the MMR must begin the incoming page"
    );
}

#[test]
fn beethoven_oboe_two_leaves_sparse_space_on_final_page() {
    let score = parse_mnx(include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    ))
    .expect("fixture parses");
    let mut config = LayoutConfig {
        sp: 1.625 * 12.0,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        ..LayoutConfig::default()
    };
    config.page_turns.enabled = true;
    config.page_turns.allow_intentional_blanks = false;
    let layout = layout_with_mnx_scores(&score, &config, 5);
    let final_page = layout.pages.last().expect("Oboe 2 has pages");
    let penultimate = &layout.pages[layout.pages.len() - 2];
    assert!(
        penultimate.system_indices.len() > final_page.system_indices.len(),
        "Oboe 2 should leave the sparse space on its final page ({} vs {} systems)",
        penultimate.system_indices.len(),
        final_page.system_indices.len()
    );
}

#[test]
fn beethoven_dense_strings_turn_after_printed_mmrs() {
    let score = parse_mnx(include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    ))
    .expect("fixture parses");
    for score_index in [15, 16, 17] {
        let mut config = LayoutConfig {
            sp: 1.625 * 12.0,
            page_width: Some(210.0 * 12.0),
            page_height: 297.0 / 1.625,
            page_margin_top: 15.0 / 1.625,
            page_margin_bottom: 15.0 / 1.625,
            page_margin_left: 15.0 / 1.625,
            page_margin_right: 15.0 / 1.625,
            ..LayoutConfig::default()
        };
        config.page_turns.enabled = true;
        config.page_turns.allow_intentional_blanks = false;
        let layout = layout_with_mnx_scores(&score, &config, score_index);
        let definition = &score.scores[score_index];
        let measure_index = |id: &str| {
            score
                .global
                .measures
                .iter()
                .position(|measure| measure.id.as_deref() == Some(id))
                .expect("MMR start is global")
        };
        let system_at = |measure: usize| {
            layout
                .measure_bounds
                .iter()
                .find(|bound| bound.index == measure)
                .map(|bound| bound.system_index)
                .expect("MMR has a visible bound")
        };
        assert_eq!(
            layout.pages.len(),
            5,
            "dense strings use five physical pages"
        );
        if score_index == 17 {
            assert!(
                layout
                    .pages
                    .first()
                    .is_some_and(|page| page.system_indices.is_empty()),
                "Viola should use a title page to eliminate first-page sparsity"
            );
            let turn_rest = definition
                .multimeasure_rests
                .iter()
                .find(|rest| rest.duration == 7)
                .expect("Viola has the target seven-bar MMR");
            assert_eq!(
                layout.pages[2].system_indices.last(),
                Some(&system_at(measure_index(&turn_rest.start))),
                "Viola's first physical turn must follow the MMR near measure 279"
            );
            assert!(
                layout
                    .pages
                    .iter()
                    .skip(1)
                    .all(|page| page.system_indices.len() >= 10),
                "Viola's title plan should keep every music page naturally dense"
            );
            continue;
        }
        assert!(
            layout
                .pages
                .first()
                .is_some_and(|page| !page.system_indices.is_empty()),
            "violins omit the title page"
        );
        let early_rest = definition
            .multimeasure_rests
            .iter()
            .filter(|rest| rest.duration == 4)
            .filter_map(|rest| {
                let start = measure_index(&rest.start);
                (start < 70).then_some(start)
            })
            .max()
            .expect("string part has an early four-bar MMR");
        assert_eq!(
            layout.pages[0].system_indices.last(),
            Some(&system_at(early_rest)),
            "page 1 must end on the early four-bar MMR"
        );

        let later_rest_systems: Vec<_> = definition
            .multimeasure_rests
            .iter()
            .filter(|rest| rest.duration == 4)
            .filter_map(|rest| {
                let start = measure_index(&rest.start);
                (302..=318).contains(&start).then(|| system_at(start))
            })
            .collect();
        assert!(
            layout.pages[2]
                .system_indices
                .last()
                .is_some_and(|system| later_rest_systems.contains(system)),
            "page 3 must end on a four-bar MMR between measures 303 and 322"
        );
        assert!(
            layout.pages[3].system_indices.len() > layout.pages[4].system_indices.len(),
            "page 4 should keep natural density and leave final-page sparsity on page 5"
        );
    }
}

#[test]
fn beethoven_every_part_keeps_acceptable_physical_turns() {
    let score = parse_mnx(include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    ))
    .expect("fixture parses");
    let sp = 1.625 * 12.0;
    let mut config = LayoutConfig {
        sp,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        ..LayoutConfig::default()
    };
    config.page_turns.enabled = true;
    config.page_turns.allow_intentional_blanks = false;

    let mut failures = Vec::new();
    for score_index in 2..score.scores.len() {
        let definition = &score.scores[score_index];
        let name = definition.name.as_deref().unwrap_or("unnamed part");
        let layout = layout_with_mnx_scores(&score, &config, score_index);
        let Some(warnings) = layout.page_turn_warnings.as_ref() else {
            failures.push(format!("{name}: page-turn planning did not run"));
            continue;
        };

        let mut visible: Vec<_> = layout
            .measure_bounds
            .iter()
            .map(|bound| bound.index)
            .collect();
        visible.sort_unstable();
        visible.dedup();
        let acceptable_mmr_boundaries: Vec<_> = visible
            .windows(2)
            .filter_map(|pair| (pair[1] >= pair[0] + 4).then_some(pair[1] - 1))
            .collect();
        for warning in warnings {
            let accepted_printed_mmr = matches!(warning.kind.as_str(), "tight" | "impossible")
                && acceptable_mmr_boundaries.contains(&warning.boundary_measure);
            if !accepted_printed_mmr {
                failures.push(format!(
                    "{name}: {} turn after measure {} ({:.2}s)",
                    warning.kind,
                    warning.boundary_measure + 1,
                    warning.turn_seconds
                ));
            }
        }
    }

    assert!(
        failures.is_empty(),
        "Beethoven part-turn regressions:\n  {}",
        failures.join("\n  ")
    );
}

#[test]
fn beethoven_cello_dense_turn_pages_remain_vertically_justified() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let score = parse_mnx(json).expect("Beethoven fixture parses");
    let sp = 1.625 * 12.0;
    let mut config = LayoutConfig {
        sp,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        emit_layout_debug: true,
        ..LayoutConfig::default()
    };
    config.page_turns.enabled = true;
    config.page_turns.allow_intentional_blanks = false;

    let layout = layout_with_mnx_scores(&score, &config, 18);
    assert_eq!(
        layout.pages.len(),
        5,
        "Cello should use a title plus four music pages"
    );
    assert!(
        layout
            .pages
            .first()
            .is_some_and(|page| page.system_indices.is_empty()),
        "Cello should use the title page to shift turn parity"
    );
    let turn_rest = score.scores[18]
        .multimeasure_rests
        .iter()
        .find(|rest| rest.duration == 8)
        .expect("Cello has the target MMR");
    let rest_start = score
        .global
        .measures
        .iter()
        .position(|measure| measure.id.as_deref() == Some(turn_rest.start.as_str()))
        .expect("MMR start is global");
    let rest_system = layout
        .measure_bounds
        .iter()
        .find(|bound| bound.index == rest_start)
        .map(|bound| bound.system_index)
        .expect("MMR has a visible bound");
    assert_eq!(
        layout.pages[2].system_indices.last(),
        Some(&rest_system),
        "Cello's first physical turn must follow the MMR near measure 280"
    );
    assert_eq!(
        layout.pages[3].system_indices.first(),
        Some(&(rest_system + 1)),
        "music after the Cello MMR must begin the incoming page"
    );
    assert!(
        layout
            .pages
            .iter()
            .skip(1)
            .all(|page| !page.system_indices.is_empty()),
        "all Cello music pages must contain systems"
    );
    let debug = layout.layout_debug.as_ref().expect("layout debug enabled");
    let usable = (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;

    for (page_index, page) in layout.pages.iter().enumerate() {
        if page_index + 1 == layout.pages.len() || page.system_indices.len() < 2 {
            continue;
        }
        let page_systems: Vec<_> = debug
            .systems
            .iter()
            .filter(|system| system.page_index == page_index)
            .collect();
        let first = page_systems.first().expect("music page has systems");
        let last = page_systems.last().expect("music page has systems");
        let final_fill = (last.bbox_bottom_y - first.bbox_top_y) / usable;
        if final_fill >= config.page_turns.min_fill_fraction {
            assert!(
                final_fill >= 0.97,
                "Cello page {page_index} is {final_fill:.3} full but does not reach the bottom margin"
            );
        }
    }
}

/// Beethoven 5, movement I is the production-scale regression for global part
/// casting. Clarinet 2's 33-bar MMR must stay on the outgoing turn page, with a
/// title page shifting the first physical turn after two dense music pages.
#[test]
fn beethoven_clarinet_two_keeps_long_mmr_before_dense_turn() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let score = parse_mnx(json).expect("Beethoven fixture parses");
    let score_index = 7;
    let definition = &score.scores[score_index];
    let long_mmr = definition
        .multimeasure_rests
        .iter()
        .find(|range| range.duration == 33)
        .expect("Clarinet 2 has the target 33-bar MMR");
    let mmr_start = score
        .global
        .measures
        .iter()
        .position(|measure| measure.id.as_deref() == Some(long_mmr.start.as_str()))
        .expect("MMR start is a global measure");

    // Match the editor's A4 part setup (Rastral 3, 1.625 mm spatium).
    let sp = 1.625 * 12.0;
    let mut config = LayoutConfig {
        sp,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        emit_layout_debug: true,
        ..LayoutConfig::default()
    };
    let greedy = layout_with_mnx_scores(&score, &config, score_index);
    config.page_turns.enabled = true;
    config.page_turns.allow_intentional_blanks = false;
    let planned = layout_with_mnx_scores(&score, &config, score_index);

    assert_eq!(
        system_count(&planned),
        system_count(&greedy),
        "global alternatives must preserve the natural baseline system count"
    );
    let mmr_system = planned
        .measure_bounds
        .iter()
        .find(|bound| bound.index == mmr_start)
        .map(|bound| bound.system_index)
        .expect("collapsed MMR has a visible measure bound");
    assert!(
        mmr_system < 30,
        "the original system near 21 must not become a synthetic system {mmr_system}"
    );
    let mmr_page = planned
        .pages
        .iter()
        .position(|page| page.system_indices.contains(&mmr_system))
        .expect("MMR system belongs to a page");

    assert!(
        planned
            .pages
            .first()
            .is_some_and(|page| page.system_indices.is_empty()),
        "Auto should elect the title page when it shifts the long-rest turn onto the physical boundary"
    );
    assert_eq!(
        mmr_page, 2,
        "title page + two music pages should put the MMR at the first physical turn"
    );
    assert_eq!(
        planned.pages[mmr_page].system_indices.last(),
        Some(&mmr_system),
        "the full visible MMR must remain at the outgoing page foot"
    );
    assert_eq!(
        planned.pages[mmr_page + 1].system_indices.first(),
        Some(&(mmr_system + 1)),
        "the system following the MMR must open the incoming page"
    );
    let first_spread_counts = (
        planned.pages[1].system_indices.len(),
        planned.pages[2].system_indices.len(),
    );
    assert!(
        first_spread_counts.0.abs_diff(first_spread_counts.1) <= 1,
        "the first spread should balance its systems, got {first_spread_counts:?}"
    );

    let debug = planned.layout_debug.as_ref().expect("layout debug enabled");
    let usable = (config.page_height - config.page_margin_top - config.page_margin_bottom) * sp;
    for (page_index, page) in planned.pages.iter().enumerate() {
        if page_index + 1 == planned.pages.len() || page.system_indices.is_empty() {
            continue;
        }
        let page_systems: Vec<_> = debug
            .systems
            .iter()
            .filter(|system| system.page_index == page_index)
            .collect();
        let first = page_systems.first().expect("music page has systems");
        let last = page_systems.last().expect("music page has systems");
        let fill = (last.bbox_bottom_y - first.bbox_top_y) / usable;
        if fill < 0.65 {
            assert!(
                fill >= 0.5,
                "non-final music page {page_index} fill {fill:.3} is too sparse for a partial-page fallback"
            );
            assert!(
                page_systems.iter().all(|system| {
                    system
                        .inter_system_gap_to_next
                        .as_ref()
                        .is_none_or(|gap| !gap.justified)
                }),
                "sub-floor music page {page_index} must remain ragged rather than stretch its systems"
            );
        } else if fill < config.page_turns.min_fill_fraction {
            assert!(
                fill >= 0.98,
                "near-floor music page {page_index} fill {fill:.3} should still vertically justify"
            );
        }
    }
}

/// The joint natural-casting DP (`natural_geometry::run_joint_dp`) must pick
/// the same page/system membership every time for identical inputs. It once
/// stored DP layer states in a `HashMap`, whose iteration order is randomized
/// per process; tied-cost candidates then resolved arbitrarily, so the same
/// score could paginate differently across reloads. `StateKey` now derives
/// `Ord` and layers use a `BTreeMap` so tie-breaking is input-derived only.
#[test]
fn beethoven_flute_two_pagination_is_deterministic() {
    let json = include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    );
    let score = parse_mnx(json).expect("Beethoven fixture parses");
    let sp = 1.625 * 12.0;
    let mut config = LayoutConfig {
        sp,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        ..LayoutConfig::default()
    };
    config.page_turns.enabled = true;
    config.page_turns.allow_intentional_blanks = false;

    let score_index = 3; // Flute 2
    let first: Vec<Vec<usize>> = layout_with_mnx_scores(&score, &config, score_index)
        .pages
        .iter()
        .map(|page| page.system_indices.clone())
        .collect();
    for _ in 0..9 {
        let repeat: Vec<Vec<usize>> = layout_with_mnx_scores(&score, &config, score_index)
            .pages
            .iter()
            .map(|page| page.system_indices.clone())
            .collect();
        assert_eq!(
            repeat, first,
            "Flute 2 pagination must be identical across repeated runs of the same score"
        );
    }
}

#[test]
fn beethoven_flute_two_uses_viable_balanced_turn() {
    let score = parse_mnx(include_str!(
        "../../../../../packages/format/fixtures/mnx/beethoven-symphony-5-movement-1.mnx"
    ))
    .expect("fixture parses");
    let sp = 1.625 * 12.0;
    let mut config = LayoutConfig {
        sp,
        page_width: Some(210.0 * 12.0),
        page_height: 297.0 / 1.625,
        page_margin_top: 15.0 / 1.625,
        page_margin_bottom: 15.0 / 1.625,
        page_margin_left: 15.0 / 1.625,
        page_margin_right: 15.0 / 1.625,
        ..LayoutConfig::default()
    };
    config.page_turns.enabled = true;
    config.page_turns.allow_intentional_blanks = false;
    let layout = layout_with_mnx_scores(&score, &config, 3);
    let part_index = 1;
    let mut visible: Vec<_> = layout
        .measure_bounds
        .iter()
        .map(|bound| bound.index)
        .collect();
    visible.sort_unstable();
    visible.dedup();
    let windows = crate::layout::page_turn::analyze_turn_windows_for_visible_blocks(
        &score.global.measures,
        &score.parts[part_index].measures,
        &visible,
        &config.page_turns,
    );
    let rest = score.scores[3]
        .multimeasure_rests
        .iter()
        .find(|rest| rest.duration == 20)
        .expect("Flute 2 has the page-1 20-bar MMR");
    let rest_start = score
        .global
        .measures
        .iter()
        .position(|measure| measure.id.as_deref() == Some(rest.start.as_str()))
        .expect("MMR start is global");
    let rest_system = layout
        .measure_bounds
        .iter()
        .find(|bound| bound.index == rest_start)
        .map(|bound| bound.system_index)
        .expect("MMR has a visible bound");
    assert_eq!(
        layout.pages.len(),
        3,
        "Flute 2 should use three music pages"
    );
    assert!(
        layout
            .pages
            .first()
            .is_some_and(|page| !page.system_indices.is_empty()),
        "Flute 2 should not use a dedicated title page"
    );
    let outgoing = &layout.pages[0];
    assert_eq!(
        outgoing.system_indices.last(),
        Some(&rest_system),
        "Flute 2 must turn at the best-fitting MMR after page 1"
    );
    assert_eq!(
        layout.pages[1].system_indices.first(),
        Some(&(rest_system + 1)),
        "music after the long MMR must begin the incoming page"
    );
    let boundary = rest_start + rest.duration as usize - 1;
    let window = &windows[boundary];
    assert!(
        matches!(
            window.quality,
            crate::layout::page_turn::TurnQuality::Comfortable
                | crate::layout::page_turn::TurnQuality::Vs
        ),
        "Flute 2 must use a viable physical turn, got {:?}",
        window.quality
    );
    assert!(
        window.turn_seconds >= config.page_turns.min_acceptable_secs,
        "Flute 2 turn {:.2}s is below the configured threshold",
        window.turn_seconds
    );
    assert!(
        layout.pages[1].system_indices.len() > layout.pages[2].system_indices.len(),
        "Flute 2 should flow the remaining music naturally, leaving the final page sparse"
    );
}
