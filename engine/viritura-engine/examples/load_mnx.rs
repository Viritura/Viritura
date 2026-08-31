//! Headless MNX loader — mirrors the WASM `compute_full_score_layout` path
//! (`parse_mnx` → `reconcile_score` → layout) so a converted score can be
//! validated exactly the way Viritura's engine loads it, without a browser.
//!
//! Usage: `cargo run -p viritura-engine --example load_mnx -- <path-to.mnx>`
//! Exits 0 on success, 1 on any parse/layout error or panic.

use std::path::PathBuf;
use std::process::ExitCode;

use viritura_engine::layout::{layout_full_score, layout_with_mnx_scores, LayoutConfig};
use viritura_engine::parse::parse_mnx;
use viritura_engine::reconcile::reconcile_score;

fn main() -> ExitCode {
    let path = match std::env::args().nth(1) {
        Some(p) => PathBuf::from(p),
        None => {
            eprintln!("usage: load_mnx <path-to.mnx>");
            return ExitCode::FAILURE;
        }
    };

    let json = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("ERROR reading {}: {e}", path.display());
            return ExitCode::FAILURE;
        }
    };

    // Parse (promote walker) — the stage that raised "missing field `name`".
    let mut score = match parse_mnx(&json) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("PARSE ERROR: {e}");
            return ExitCode::FAILURE;
        }
    };
    reconcile_score(&mut score);

    let config = LayoutConfig {
        sp: 7.0,
        page_width: None,
        ..LayoutConfig::default()
    };

    // Lay out every MNX score definition (full score, condensed, each part) so
    // a layout panic in any view is caught, not just score 0.
    let score_count = score.scores.len().max(1);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if !score.layouts.is_empty() && !score.scores.is_empty() {
            for i in 0..score_count {
                let dl = layout_with_mnx_scores(&score, &config, i);
                eprintln!("  score[{i}] ok: {} command(s)", dl.commands.len());
            }
        } else {
            let dl = layout_full_score(&score, &config);
            eprintln!("  full-score ok: {} command(s)", dl.commands.len());
        }
    }));

    match result {
        Ok(()) => {
            eprintln!(
                "OK: {} part(s), {} measure(s), {} score view(s) laid out cleanly",
                score.parts.len(),
                score.global.measures.len(),
                score_count
            );
            ExitCode::SUCCESS
        }
        Err(_) => {
            eprintln!("LAYOUT PANIC while laying out one of the score views");
            ExitCode::FAILURE
        }
    }
}
