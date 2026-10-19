use std::fs;
use std::path::{Path, PathBuf};

use crate::layout::config::LayoutConfig;
use crate::layout::layout_score;
use crate::layout::mnx_layout::layout_with_mnx_scores;
use crate::parse::parse_mnx;
use crate::render::DisplayList;

fn bundled_scores() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let mut paths: Vec<_> = fs::read_dir(root.join("packages/format/fixtures/mnx"))
        .expect("read bundled fixture directory")
        .map(|entry| entry.expect("read bundled fixture entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "mnx"))
        .collect();
    paths.push(root.join("examples/score-viewer-react-minimal/public/sample.mnx"));
    paths.sort();
    paths
}

fn assert_rendered(display: &DisplayList, path: &Path, view: &str, index: usize) {
    assert!(
        display.width.is_finite() && display.width > 0.0,
        "{}: {view} {index} has invalid width",
        path.display()
    );
    assert!(
        display.height.is_finite() && display.height > 0.0,
        "{}: {view} {index} has invalid height",
        path.display()
    );
    assert!(
        !display.commands.is_empty(),
        "{}: {view} {index} has no render commands",
        path.display()
    );
}

#[test]
fn all_bundled_mnx_scores_parse_and_render_in_every_view() {
    let paths = bundled_scores();
    assert!(!paths.is_empty(), "no bundled MNX scores found");
    let config = LayoutConfig::default();
    for path in paths {
        let json =
            fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let score =
            parse_mnx(&json).unwrap_or_else(|error| panic!("{}: {error:?}", path.display()));
        for part in 0..score.parts.len() {
            assert_rendered(&layout_score(&score, part, &config), &path, "part", part);
        }
        for view in 0..score.scores.len() {
            assert_rendered(
                &layout_with_mnx_scores(&score, &config, view),
                &path,
                "score",
                view,
            );
        }
    }
}
