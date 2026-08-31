// Reproduce the editor's cached+chunked horizon path and dump raw per-staff
// barline x for the rehearsal-2..3 clef-change measures (idx 17..22).
use std::collections::BTreeMap;
use viritura_engine::layout::cache::LayoutCache;
use viritura_engine::layout::config::LayoutConfig;
use viritura_engine::layout::layout_with_mnx_scores_cached;
use viritura_engine::parse::parse_mnx;
use viritura_engine::reconcile::reconcile_score;
use viritura_engine::render::RenderCommand;

fn dump(dl: &viritura_engine::render::DisplayList, label: &str) {
    println!("===== {label} =====");
    // Scan EVERY measure for cross-staff barline disagreement.
    let mut worst: Vec<(usize, f64)> = Vec::new();
    for probe in 0..600usize {
        let want = format!("m{probe}/barline");
        let mut segs: Vec<(f64, f64)> = Vec::new();
        for (i, cmd) in dl.commands.iter().enumerate() {
            if dl.element_ids.get(i).and_then(|o| o.as_deref()) != Some(want.as_str()) {
                continue;
            }
            if let RenderCommand::DrawLine { x1, x2, y1, y2, .. } = cmd {
                if (x1 - x2).abs() < 0.5 && (y2 - y1).abs() > 5.0 {
                    segs.push((y1.min(*y2), *x1));
                }
            }
        }
        if segs.is_empty() {
            continue;
        }
        let mut by_staff: BTreeMap<i64, Vec<f64>> = BTreeMap::new();
        for (y, x) in &segs {
            by_staff
                .entry((y / 30.0).round() as i64)
                .or_default()
                .push(*x);
        }
        let lefts: Vec<f64> = by_staff
            .values()
            .map(|xs| xs.iter().cloned().fold(f64::INFINITY, f64::min))
            .collect();
        let xmin = lefts.iter().cloned().fold(f64::INFINITY, f64::min);
        let xmax = lefts.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let spread = xmax - xmin;
        if spread > 1.0 {
            worst.push((probe, spread));
        }
    }
    if worst.is_empty() {
        println!("  ALL measures aligned (0 with cross-staff spread > 1px)");
    } else {
        worst.sort_by(|a, b| b.1.total_cmp(&a.1));
        println!("  {} misaligned measures; worst:", worst.len());
        for (m, s) in worst.iter().take(15) {
            println!("    m{m}: spread={s:.1}px");
        }
    }
}

fn main() {
    let json = std::fs::read_to_string("../packages/format/fixtures/mnx/Rhapsody in Blue.mnx")
        .expect("read");
    let mut score = parse_mnx(&json).expect("parse");
    reconcile_score(&mut score);

    let cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(1400.0),
        ..LayoutConfig::default()
    };
    let mut cache = LayoutCache::new();
    let dl = layout_with_mnx_scores_cached(&score, &cfg, 0, Some(&mut cache));
    dump(&dl, "chunked+cached (editor horizon)");

    let cfg2 = LayoutConfig {
        page_width: None,
        horizon_chunk_width: None,
        ..LayoutConfig::default()
    };
    let dl2 = layout_with_mnx_scores_cached(&score, &cfg2, 0, None);
    dump(&dl2, "non-chunked");
}
