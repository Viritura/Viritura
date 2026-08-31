// Manual timing probe (run with `--ignored --nocapture`) that splits the
// per-edit WASM back-half into its two O(N) halves: the layout pass vs. the
// `to_binary` encode. This decides whether the incremental-display-list Phase 1
// should segment the *encode* (medium effort) or the *layout* (large effort).
//
// Not a correctness gate — `#[ignore]` so it never runs in CI. Invoke with:
//   cargo test -p viritura-engine --lib perf_split_rhapsody -- --ignored --nocapture

use crate::layout::cache::LayoutCache;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores_cached;
use crate::model::{Score, SequenceContent};
use crate::parse::parse_mnx;
use crate::reconcile::reconcile_score;
use std::time::Instant;

/// Measure indices that contain at least one directly-authored pitched event.
/// The scoped perf probe samples only from this set so every requested dirty
/// range is valid and every iteration performs a real one-measure edit.
fn pitched_measure_indices(score: &Score) -> Vec<usize> {
    let measure_count = score
        .parts
        .iter()
        .map(|part| part.measures.len())
        .max()
        .unwrap_or(0);
    (0..measure_count)
        .filter(|&mi| {
            score.parts.iter().any(|part| {
                part.measures.get(mi).is_some_and(|measure| {
                    measure.sequences.iter().any(|seq| {
                        seq.content.iter().any(|item| {
                            matches!(item, SequenceContent::Event(ev) if ev.notes.as_ref().is_some_and(|notes| !notes.is_empty()))
                        })
                    })
                })
            })
        })
        .collect()
}

/// Change one pitched note in exactly `measure_index`, returning the changed
/// part index (or `None` only if the fixture no longer matches
/// [`pitched_measure_indices`]'s assumptions).
fn bump_first_note_in_measure(score: &mut Score, measure_index: usize) -> Option<usize> {
    for (part_index, part) in score.parts.iter_mut().enumerate() {
        let Some(measure) = part.measures.get_mut(measure_index) else {
            continue;
        };
        for seq in &mut measure.sequences {
            for item in &mut seq.content {
                if let SequenceContent::Event(ev) = item {
                    if let Some(note) = ev.notes.as_mut().and_then(|notes| notes.first_mut()) {
                        note.pitch.octave += 1;
                        return Some(part_index);
                    }
                }
            }
        }
    }
    None
}

#[test]
#[ignore = "manual perf probe; run with --ignored --nocapture"]
fn perf_split_rhapsody_layout_vs_encode() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root resolvable")
        .join("packages/format/fixtures/mnx/Rhapsody in Blue.mnx");
    let json = std::fs::read_to_string(&path).expect("Rhapsody fixture readable");

    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    reconcile_score(&mut score);

    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };

    // Warm the measure-level cache exactly as the per-edit path would have it.
    let mut cache = LayoutCache::new();
    let warm = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    eprintln!(
        "commands={} bboxes={} slurs={} pages={}",
        warm.commands.len(),
        warm.element_bboxes.len(),
        warm.slur_geometries.len(),
        warm.pages.len()
    );

    const ITERS: u32 = 8;

    let mut layout_ms = Vec::with_capacity(ITERS as usize);
    for _ in 0..ITERS {
        let t = Instant::now();
        let dl = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
        layout_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(&dl);
    }

    let mut encode_ms = Vec::with_capacity(ITERS as usize);
    let mut float_count = 0usize;
    for _ in 0..ITERS {
        let t = Instant::now();
        let bin = warm.to_binary();
        encode_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        float_count = bin.len();
        std::hint::black_box(&bin);
    }

    let p50 = |v: &mut Vec<f64>| {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v[v.len() / 2]
    };
    let layout_p50 = p50(&mut layout_ms);
    let encode_p50 = p50(&mut encode_ms);

    eprintln!("layout (warm cache) p50: {:.1} ms", layout_p50);
    eprintln!("to_binary encode    p50: {:.1} ms", encode_p50);
    eprintln!(
        "binary floats: {} ({:.1} MB)",
        float_count,
        (float_count * 4) as f64 / 1_048_576.0
    );
    eprintln!(
        "encode share of (layout+encode): {:.0}%",
        100.0 * encode_p50 / (layout_p50 + encode_p50)
    );
}

/// Phase A scoped perf probe. Engages `RangeScope::scoped_resolve = true` so
/// the range-scoped resolve path can early-exit at carried-state convergence.
/// Simulates a real edit pattern: parse + warm layout with the live cache
/// defaults, then 20 real one-note edits distributed across valid pitched
/// measures. Each edit sets `pending_dirty_range = Some((mi,mi))` before
/// relayout. Run with:
///   cargo test --release -p viritura-engine --lib perf_split_rhapsody_scoped \
///     -- --ignored --nocapture
///
/// Compare `layout (warm cache + scoped)` here against the baseline
/// `perf_split_rhapsody_layout_vs_encode`'s `layout (warm cache)` p50 to read
/// off Phase A's `phaseA-E` drop.
#[test]
#[ignore = "manual perf probe; run with --ignored --nocapture"]
fn perf_split_rhapsody_scoped() {
    use crate::layout::cache::RangeScope;

    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root resolvable")
        .join("packages/format/fixtures/mnx/Rhapsody in Blue.mnx");
    let json = std::fs::read_to_string(&path).expect("Rhapsody fixture readable");

    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    crate::reconcile::reconcile_score(&mut score);

    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };

    // Mirror the live WASM engine: scoped resolve + precompute, B-full
    // wholesale system reuse, and patch-frame assembly are all enabled.
    let mut cache = LayoutCache::new();
    cache.set_range_scope(RangeScope {
        scoped_resolve: true,
        scoped_precompute: true,
        ..Default::default()
    });
    cache.set_system_layout_reuse_enabled(true);
    cache.set_patch_frame_enabled(true);
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let _ = cache.take_pending_patch();
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let _ = cache.take_pending_patch();

    const ITERS: usize = 20;
    let candidates = pitched_measure_indices(&score);
    assert!(
        candidates.len() >= ITERS,
        "Rhapsody must provide enough pitched measures"
    );
    let mut layout_ms = Vec::with_capacity(ITERS);
    let mut spans: Vec<(usize, usize)> = Vec::with_capacity(ITERS);
    let mut width_spans: Vec<(usize, usize)> = Vec::with_capacity(ITERS);
    let mut sampled_measures = Vec::with_capacity(ITERS);
    let mut sampled_parts = Vec::with_capacity(ITERS);
    let mut staff_content_reuses = Vec::with_capacity(ITERS);
    let mut mmr_plan_reuses = Vec::with_capacity(ITERS);
    for i in 0..ITERS {
        // Evenly sample valid pitched measures from the beginning through the
        // end of the score. The previous probe used 0,100,…,700; indices 600
        // and 700 were out of range and manufactured a full-scope fallback.
        let slot = i * (candidates.len() - 1) / (ITERS - 1);
        let mi = candidates[slot];
        let part_index = bump_first_note_in_measure(&mut score, mi)
            .expect("candidate measure must contain a pitched event");
        reconcile_score(&mut score);
        let mut affected_parts = vec![false; score.parts.len()];
        affected_parts[part_index] = true;
        cache.set_pending_dirty_region(Some(
            crate::layout::cache::DirtyRegion::local_part_measures(mi, mi, affected_parts),
        ));
        let t = Instant::now();
        let dl = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
        layout_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        spans.push((cache.last_resolved_span(), cache.last_resolved_full_span()));
        width_spans.push((cache.last_width_span(), cache.last_width_full_span()));
        sampled_measures.push(mi);
        sampled_parts.push(part_index);
        staff_content_reuses.push(cache.staff_content_reuses());
        mmr_plan_reuses.push(cache.last_mmr_plan_reused());
        let _ = cache.take_pending_patch();
        std::hint::black_box(&dl);
    }

    let p50 = |v: &mut Vec<f64>| {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        v[v.len() / 2]
    };
    let layout_p50 = p50(&mut layout_ms);

    eprintln!("layout (warm cache + scoped) p50: {:.1} ms", layout_p50);
    eprintln!("sampled valid measures: {:?}", sampled_measures);
    eprintln!("sampled changed parts:  {:?}", sampled_parts);
    eprintln!(
        "staff-content prefix reuses per iter: {:?}",
        staff_content_reuses
    );
    eprintln!("MMR plan reuses per iter: {:?}", mmr_plan_reuses);
    eprintln!("resolved span (scoped vs full) per iter: {:?}", spans);
    eprintln!("width span (scoped vs full) per iter:    {:?}", width_spans);
    let avg_span: f64 = spans.iter().map(|(s, _)| *s as f64).sum::<f64>() / spans.len() as f64;
    let avg_full: f64 = spans.iter().map(|(_, f)| *f as f64).sum::<f64>() / spans.len() as f64;
    eprintln!(
        "avg span: {:.0} / {:.0} ({:.1}% of full)",
        avg_span,
        avg_full,
        100.0 * avg_span / avg_full
    );
}
