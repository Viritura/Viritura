// Full pipeline verification: all 71 MNX files parse and render correctly.
//
// Loads every .mnx file from packages/format/fixtures/mnx/ at runtime,
// parses each with parse_mnx(), runs through layout_with_mnx_scores
// (falls back to layout_full_score for simple scores), and asserts
// the DisplayList is non-empty with positive dimensions.

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

#[test]
fn pipeline_all_71_mnx_files_parse_and_render() {
    let dir = scores_dir();
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("Cannot read scores dir {}: {e}", dir.display()))
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("mnx") {
                Some(path)
            } else {
                None
            }
        })
        .collect();
    files.sort();

    assert!(
        files.len() >= 71,
        "Expected at least 71 MNX files in {}, found {}",
        dir.display(),
        files.len()
    );

    let config = LayoutConfig {
        page_width: Some(800.0),
        ..LayoutConfig::default()
    };

    let mut failures: Vec<String> = Vec::new();

    for path in &files {
        let file_name = path.file_name().unwrap().to_string_lossy();
        let json = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("Cannot read {file_name}: {e}"));

        // Parse
        let score = match parse_mnx(&json) {
            Ok(s) => s,
            Err(e) => {
                failures.push(format!("{file_name}: parse failed: {e}"));
                continue;
            }
        };

        // Render each score definition (or the implicit single score)
        let score_count = if score.scores.is_empty() {
            1
        } else {
            score.scores.len()
        };
        for score_idx in 0..score_count {
            let dl = layout_with_mnx_scores(&score, &config, score_idx);
            if dl.commands.is_empty() {
                failures.push(format!(
                    "{file_name} (score {score_idx}): produced no render commands"
                ));
            }
            if dl.width <= 0.0 {
                failures.push(format!(
                    "{file_name} (score {score_idx}): width={}, expected > 0",
                    dl.width
                ));
            }
            if dl.height <= 0.0 {
                failures.push(format!(
                    "{file_name} (score {score_idx}): height={}, expected > 0",
                    dl.height
                ));
            }
        }
    }

    if !failures.is_empty() {
        panic!(
            "{} pipeline failure(s):\n  {}",
            failures.len(),
            failures.join("\n  ")
        );
    }
}

#[test]
fn test_grand_staff_clefs_per_system() {
    // Test that a grand staff score (2 staves) renders clefs on every system, not just the first.
    use crate::layout::layout_score;
    use crate::layout::mnx_layout::layout_with_mnx_scores;
    use crate::render::smufl::smufl;

    let dir = scores_dir();
    let path = dir.join("grand-staff.mnx");
    let json = std::fs::read_to_string(&path).unwrap();
    let score = parse_mnx(&json).unwrap();

    assert!(score.parts[0].staves >= 2, "Expected grand staff");

    let config = LayoutConfig {
        page_width: Some(500.0),
        ..LayoutConfig::default()
    };

    // Test both layout paths
    let dl_score = layout_score(&score, 0, &config);
    let dl_mnx = layout_with_mnx_scores(&score, &config, 0);

    let g_clef_cp = smufl::G_CLEF;
    let f_clef_cp = smufl::F_CLEF;

    for (name, dl) in [
        ("layout_score", &dl_score),
        ("layout_with_mnx_scores", &dl_mnx),
    ] {
        let g_clefs: Vec<_> = dl.commands.iter().filter(|c| {
            matches!(c, crate::render::RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == g_clef_cp)
        }).collect();
        let f_clefs: Vec<_> = dl.commands.iter().filter(|c| {
            matches!(c, crate::render::RenderCommand::DrawGlyph { codepoint, .. } if *codepoint == f_clef_cp)
        }).collect();

        println!(
            "{name}: G clefs={}, F clefs={}, total cmds={}",
            g_clefs.len(),
            f_clefs.len(),
            dl.commands.len()
        );
        assert!(
            g_clefs.len() >= 2,
            "{name}: Expected at least 2 G clefs (one per system), got {}",
            g_clefs.len()
        );
        assert!(
            f_clefs.len() >= 2,
            "{name}: Expected at least 2 F clefs (one per system), got {}",
            f_clefs.len()
        );
    }

    // Also test with Chopin converter output if the test file exists
    // (normally not checked in — run debug-chopin-clef.mts to generate)
}
