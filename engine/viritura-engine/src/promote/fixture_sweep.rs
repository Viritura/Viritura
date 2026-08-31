//! Drift test: `promote_root` must succeed for every MNX fixture.
//!
//! After chunk 11 (model::* dropped Deserialize), there is no "direct
//! deserialize" path to compare against — `promote_root` is the single
//! source of truth.

use std::fs;
use std::path::PathBuf;

use crate::promote::root::promote_root;

fn fixtures_dir() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop(); // -> engine/
    p.pop(); // -> repo root
    p.push("packages/format/fixtures/mnx");
    p
}

#[test]
fn promote_succeeds_for_all_fixtures() {
    let dir = fixtures_dir();
    let entries = fs::read_dir(&dir).expect("read scores dir");
    let mut tried = 0usize;
    let mut failures: Vec<(String, String)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("mnx") {
            continue;
        }
        tried += 1;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                failures.push((name, format!("read: {e}")));
                continue;
            }
        };
        let value: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(e) => {
                failures.push((name, format!("json parse: {e}")));
                continue;
            }
        };
        if let Err(e) = promote_root(value) {
            failures.push((name, format!("promote: {e:?}")));
        }
    }

    assert!(tried > 0, "no fixtures discovered at {}", dir.display());
    assert!(
        failures.is_empty(),
        "promote_root failed for {}/{} fixtures:\n{}",
        failures.len(),
        tried,
        failures
            .iter()
            .map(|(n, e)| format!("  {n}: {e}"))
            .collect::<Vec<_>>()
            .join("\n")
    );
}
