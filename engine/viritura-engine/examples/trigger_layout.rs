// Layout Rhapsody to trigger VIRITURA_SPACE_DEBUG instrumentation.
use viritura_engine::layout::config::LayoutConfig;
use viritura_engine::layout::layout_with_mnx_scores_cached;
use viritura_engine::parse::parse_mnx;
use viritura_engine::reconcile::reconcile_score;

fn main() {
    let json = std::fs::read_to_string("../packages/format/fixtures/mnx/Rhapsody in Blue.mnx")
        .expect("read");
    let mut score = parse_mnx(&json).expect("parse");
    reconcile_score(&mut score);
    let cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: None,
        ..LayoutConfig::default()
    };
    let _ = layout_with_mnx_scores_cached(&score, &cfg, 0, None);
}
