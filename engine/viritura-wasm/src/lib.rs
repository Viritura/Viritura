// wasm-bindgen generates code containing `unsafe` blocks; allow at crate root.
#![allow(unsafe_code)]

use std::sync::atomic::{AtomicBool, Ordering};
use viritura_engine::layout::cache::{DirtyRegion, LayoutCache, RangeScope};
use viritura_engine::layout::{
    compute_slur_preview as compute_engine_slur_preview, layout_full_score,
    layout_full_score_cached, layout_score, layout_score_cached, layout_with_mnx_scores,
    layout_with_mnx_scores_cached, LayoutConfig, SlurPreviewInput,
};
use viritura_engine::model::{PartMeasure, Score, SequenceContent};
use viritura_engine::parse::parse_mnx;
use viritura_engine::promote::{promote_global_measure_json, promote_part_measure_json};
use viritura_engine::reconcile::{reconcile_score, reconcile_score_range};
use viritura_engine::render::svg::{display_list_to_svg_pages, SvgExportConfig};
use viritura_engine::render::DisplayList;
use wasm_bindgen::prelude::*;

/// Recursively collect slur target event ids referenced by events in `content`
/// (descending into tuplet/tremolo/grace containers).
fn collect_slur_targets(content: &[SequenceContent], out: &mut Vec<String>) {
    for item in content {
        match item {
            SequenceContent::Event(ev) => {
                if let Some(slurs) = &ev.slurs {
                    out.extend(slurs.iter().map(|s| s.target.clone()));
                }
            }
            SequenceContent::Tuplet(t) => collect_slur_targets(&t.content, out),
            SequenceContent::MultiNoteTremolo(t) => {
                for ev in &t.content {
                    if let Some(slurs) = &ev.slurs {
                        out.extend(slurs.iter().map(|s| s.target.clone()));
                    }
                }
            }
            SequenceContent::Grace(g) => {
                for ev in &g.content {
                    if let Some(slurs) = &ev.slurs {
                        out.extend(slurs.iter().map(|s| s.target.clone()));
                    }
                }
            }
            SequenceContent::Space(_) | SequenceContent::Other(_) => {}
        }
    }
}

/// Find the index of the measure (within `measures`) containing an event
/// with id `target_id` (descending into tuplet/tremolo/grace containers).
fn find_event_measure_index(measures: &[PartMeasure], target_id: &str) -> Option<usize> {
    fn content_has_id(content: &[SequenceContent], target_id: &str) -> bool {
        content.iter().any(|item| match item {
            SequenceContent::Event(ev) => ev.id.as_deref() == Some(target_id),
            SequenceContent::Tuplet(t) => content_has_id(&t.content, target_id),
            SequenceContent::MultiNoteTremolo(t) => t
                .content
                .iter()
                .any(|ev| ev.id.as_deref() == Some(target_id)),
            SequenceContent::Grace(g) => g
                .content
                .iter()
                .any(|ev| ev.id.as_deref() == Some(target_id)),
            SequenceContent::Space(_) | SequenceContent::Other(_) => false,
        })
    }
    measures.iter().position(|m| {
        m.sequences
            .iter()
            .any(|seq| content_has_id(&seq.content, target_id))
    })
}

#[cfg(test)]
mod slur_dirty_range_tests {
    use super::*;

    fn two_measure_score_with_cross_measure_slur() -> Score {
        let json = r#"{
            "mnx": {"version": 1},
            "global": {"measures": [{"time": {"count": 4, "unit": 4}}, {}]},
            "parts": [{"measures": [
                {"sequences": [{"content": [
                    {"duration": {"base": "whole"}, "id": "ev-src",
                     "slurs": [{"target": "ev-tgt"}],
                     "notes": [{"pitch": {"step": "C", "octave": 4}}]}
                ]}]},
                {"sequences": [{"content": [
                    {"duration": {"base": "whole"}, "id": "ev-tgt",
                     "notes": [{"pitch": {"step": "D", "octave": 4}}]}
                ]}]}
            ]}]
        }"#;
        parse_mnx(json).expect("parse")
    }

    #[test]
    fn collect_slur_targets_finds_cross_measure_target() {
        let score = two_measure_score_with_cross_measure_slur();
        let mut ids = Vec::new();
        for seq in &score.parts[0].measures[0].sequences {
            collect_slur_targets(&seq.content, &mut ids);
        }
        assert_eq!(ids, vec!["ev-tgt".to_string()]);
    }

    #[test]
    fn find_event_measure_index_locates_target_in_later_measure() {
        let score = two_measure_score_with_cross_measure_slur();
        let idx = find_event_measure_index(&score.parts[0].measures, "ev-tgt");
        assert_eq!(idx, Some(1));
    }

    #[test]
    fn find_event_measure_index_returns_none_for_unknown_id() {
        let score = two_measure_score_with_cross_measure_slur();
        let idx = find_event_measure_index(&score.parts[0].measures, "nonexistent");
        assert_eq!(idx, None);
    }

    #[test]
    fn source_only_patch_renders_three_measure_slur_immediately() {
        let json = r#"{
            "mnx": {"version": 1},
            "global": {"measures": [
                {"time": {"count": 4, "unit": 4}}, {}, {}, {}
            ]},
            "parts": [{"id": "P1", "name": "Flute", "measures": [
                {"sequences": [{"content": [{"id": "source", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "C", "octave": 4}}]}]}]},
                {"sequences": [{"content": [{"id": "middle-1", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "D", "octave": 4}}]}]}]},
                {"sequences": [{"content": [{"id": "middle-2", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "E", "octave": 4}}]}]}]},
                {"sequences": [{"content": [{"id": "target", "duration": {"base": "whole"}, "notes": [{"pitch": {"step": "F", "octave": 4}}]}]}]}
            ]}],
            "layouts": [{"id": "full", "content": [{"type": "staff", "sources": [{"part": "P1"}]}]}],
            "scores": [{"name": "Full Score", "layout": "full"}]
        }"#;
        let patch = r#"{
            "partMeasures": {"0": {"0": {
                "sequences": [{"content": [{
                    "id": "source", "duration": {"base": "whole"},
                    "notes": [{"pitch": {"step": "C", "octave": 4}}],
                    "slurs": [{"target": "target"}]
                }]}]
            }}}
        }"#;

        let mut engine = LayoutEngine::default();
        engine
            .compute_full_score_layout_cached_dl(json, 10.0, 160.0, None, Some(0))
            .expect("initial cached layout");
        let display_list = engine
            .apply_patch_and_layout_display_list(patch, 10.0, 160.0, None, Some(0))
            .expect("source-only slur patch");

        assert!(
            display_list
                .element_ids
                .iter()
                .any(|id| id.as_deref() == Some("slur/source/target")),
            "The first incremental frame must render the three-measure slur"
        );
    }
}

/// Global flag controlling whether layout passes emit `LayoutDebugInfo`
/// on the resulting `DisplayList`. Toggled from JS via `set_emit_layout_debug`.
/// Defaults to false so production builds skip the work.
static EMIT_LAYOUT_DEBUG: AtomicBool = AtomicBool::new(false);

/// Phase Q: global flag controlling whether the patch-frame entry records
/// sub-tick timings into `LayoutEngine.last_timings`. Defaults to false so
/// production builds skip the wall-clock probes. Toggled from JS via
/// `set_wasm_timing`.
static WASM_TIMING_ENABLED: AtomicBool = AtomicBool::new(false);

/// Toggle the layout debug sidecar globally. When enabled, every layout
/// invocation emits a `layoutDebug` field on the returned DisplayList that
/// the editor's spacing overlay consumes.
#[wasm_bindgen]
pub fn set_emit_layout_debug(enabled: bool) {
    EMIT_LAYOUT_DEBUG.store(enabled, Ordering::Relaxed);
}

/// Read the current value of the layout debug toggle.
#[wasm_bindgen]
pub fn get_emit_layout_debug() -> bool {
    EMIT_LAYOUT_DEBUG.load(Ordering::Relaxed)
}

/// Phase Q: toggle wall-clock timing of the patch-frame entry. When enabled,
/// `LayoutEngine.take_timings_json()` returns a JSON breakdown after each
/// patch call. Off in production.
#[wasm_bindgen]
pub fn set_wasm_timing(enabled: bool) {
    WASM_TIMING_ENABLED.store(enabled, Ordering::Relaxed);
    // Phase Q+: also flip the engine-internal collector so the auto_flow
    // pass's `tick!` calls push their splits into a thread-local Vec the
    // patch-frame wrapper drains into the same JSON.
    viritura_engine::timing::set_enabled(enabled);
}

/// Chunk width (layout px) used to split the single horizon mega-system into
/// retention-sized chunks. A few screen-widths wide: small enough that a
/// single-measure edit only re-renders one chunk (re-engaging per-system
/// render retention + viewport culling), large enough that chunk bookkeeping
/// stays negligible.
///
/// Stitched chunking is a **pure performance transform** — byte-identical to
/// the single-system galley (oracle: `stitched_horizon_chunks_are_byte_identical`,
/// strict bit-equality across all fixtures). The earlier vertical-seam
/// misalignment concern was resolved by `chunked_global_offsets` in
/// `auto_flow.rs`, which computes ONE inter-staff offset vector from the union
/// of every chunk's measures so chunks stay collinear across seams.
const HORIZON_CHUNK_WIDTH: f64 = 3000.0;

/// Build a LayoutConfig from the given spatium, page_width, and optional JSON page setup.
/// The page_setup_json string, when provided, has: { page_height, page_margin_top, page_margin_bottom, page_margin_left, page_margin_right }
/// All values are in spatium (mm) — the caller converts mm to spatium before passing.
fn build_config(spatium: f64, page_width: f64, page_setup_json: Option<&str>) -> LayoutConfig {
    let mut config = LayoutConfig {
        sp: spatium,
        page_width: if page_width > 0.0 {
            Some(page_width)
        } else {
            None
        },
        // Horizon mode (page_width <= 0): split the single mega-system into
        // retention-sized chunks so per-system render retention + viewport
        // culling re-engage. Byte-identical to the single-system galley (the
        // earlier seam-misalignment concern is resolved by
        // `chunked_global_offsets`). Plain horizon was ONE monolithic system,
        // so any edit re-rendered the whole galley — chunking is Lever 0.
        horizon_chunk_width: if page_width > 0.0 {
            None
        } else {
            Some(HORIZON_CHUNK_WIDTH)
        },
        emit_layout_debug: EMIT_LAYOUT_DEBUG.load(Ordering::Relaxed),
        ..LayoutConfig::default()
    };

    if let Some(json_str) = page_setup_json {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(h) = v.get("page_height").and_then(|x| x.as_f64()) {
                config.page_height = h;
            }
            if let Some(mt) = v.get("page_margin_top").and_then(|x| x.as_f64()) {
                config.page_margin_top = mt;
            }
            if let Some(mb) = v.get("page_margin_bottom").and_then(|x| x.as_f64()) {
                config.page_margin_bottom = mb;
            }
            if let Some(ml) = v.get("page_margin_left").and_then(|x| x.as_f64()) {
                config.page_margin_left = ml;
            }
            if let Some(mr) = v.get("page_margin_right").and_then(|x| x.as_f64()) {
                config.page_margin_right = mr;
            }
            // Optional auto page-turn configuration. Absent / malformed leaves
            // the default (disabled) so existing callers are untouched.
            if let Some(pt) = v.get("page_turns") {
                if let Ok(parsed) = serde_json::from_value(pt.clone()) {
                    config.page_turns = parsed;
                }
            }
        }
    }

    config
}

/// Returns the engine version string.
#[wasm_bindgen]
pub fn engine_version() -> String {
    viritura_engine::version().to_string()
}

/// Compute one live slur drag preview with the same graver as final layout.
#[wasm_bindgen]
pub fn compute_slur_preview(preview_json: &str) -> Result<String, JsValue> {
    let input: SlurPreviewInput = serde_json::from_str(preview_json)
        .map_err(|e| JsValue::from_str(&format!("Slur preview parse error: {}", e)))?;
    serde_json::to_string(&compute_engine_slur_preview(&input))
        .map_err(|e| JsValue::from_str(&format!("Slur preview serialization error: {}", e)))
}

/// Layout a score from MNX JSON and return a DisplayList as JSON.
#[wasm_bindgen]
pub fn compute_layout(
    mnx_json: &str,
    part_index: usize,
    spatium: f64,
    page_width: f64,
    page_setup_json: Option<String>,
) -> Result<String, JsValue> {
    let mut score =
        parse_mnx(mnx_json).map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
    reconcile_score(&mut score);

    let config = build_config(spatium, page_width, page_setup_json.as_deref());

    let display_list = layout_score(&score, part_index, &config);

    serde_json::to_string(&display_list)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Layout a score from MNX JSON and return a binary display list as Float32Array.
#[wasm_bindgen]
pub fn compute_layout_binary(
    mnx_json: &str,
    part_index: usize,
    spatium: f64,
    page_width: f64,
    page_setup_json: Option<String>,
) -> Result<js_sys::Float32Array, JsValue> {
    let mut score =
        parse_mnx(mnx_json).map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
    reconcile_score(&mut score);

    let config = build_config(spatium, page_width, page_setup_json.as_deref());

    let display_list = layout_score(&score, part_index, &config);
    let binary = display_list.to_binary();

    Ok(js_sys::Float32Array::from(binary.as_slice()))
}

/// Parse an MNX JSON string and return score metadata as JSON.
#[wasm_bindgen]
pub fn get_score_info(mnx_json: &str) -> Result<String, JsValue> {
    let score =
        parse_mnx(mnx_json).map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;

    let info = serde_json::json!({
        "partCount": score.parts.len(),
        "partNames": score.parts.iter().map(|p| p.name.clone()).collect::<Vec<_>>(),
        "measureCount": score.global.measures.len(),
        "layoutCount": score.layouts.len(),
        "scoreCount": score.scores.len(),
        "scoreNames": score.scores.iter().map(|s| s.name.clone().unwrap_or_default()).collect::<Vec<_>>(),
    });

    serde_json::to_string(&info)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Layout all parts of a score stacked vertically and return a DisplayList as JSON.
#[wasm_bindgen]
pub fn compute_full_score_layout(
    mnx_json: &str,
    spatium: f64,
    page_width: f64,
    page_setup_json: Option<String>,
) -> Result<String, JsValue> {
    let mut score =
        parse_mnx(mnx_json).map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
    reconcile_score(&mut score);

    let config = build_config(spatium, page_width, page_setup_json.as_deref());

    let display_list = if !score.layouts.is_empty() && !score.scores.is_empty() {
        layout_with_mnx_scores(&score, &config, 0)
    } else {
        layout_full_score(&score, &config)
    };

    serde_json::to_string(&display_list)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Layout a score using a specific MNX score definition index.
#[wasm_bindgen]
pub fn compute_mnx_score_layout(
    mnx_json: &str,
    spatium: f64,
    page_width: f64,
    score_index: usize,
    page_setup_json: Option<String>,
) -> Result<String, JsValue> {
    let mut score =
        parse_mnx(mnx_json).map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
    reconcile_score(&mut score);

    let config = build_config(spatium, page_width, page_setup_json.as_deref());

    let display_list = layout_with_mnx_scores(&score, &config, score_index);

    serde_json::to_string(&display_list)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Layout all parts of a score and return a binary display list as Float32Array.
#[wasm_bindgen]
pub fn compute_full_score_layout_binary(
    mnx_json: &str,
    spatium: f64,
    page_width: f64,
    page_setup_json: Option<String>,
) -> Result<js_sys::Float32Array, JsValue> {
    let mut score =
        parse_mnx(mnx_json).map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
    reconcile_score(&mut score);

    let config = build_config(spatium, page_width, page_setup_json.as_deref());

    let display_list = if !score.layouts.is_empty() && !score.scores.is_empty() {
        layout_with_mnx_scores(&score, &config, 0)
    } else {
        layout_full_score(&score, &config)
    };
    let binary = display_list.to_binary();

    Ok(js_sys::Float32Array::from(binary.as_slice()))
}

/// Layout a score using a specific MNX score definition and return a binary display list.
#[wasm_bindgen]
pub fn compute_mnx_score_layout_binary(
    mnx_json: &str,
    spatium: f64,
    page_width: f64,
    score_index: usize,
    page_setup_json: Option<String>,
) -> Result<js_sys::Float32Array, JsValue> {
    let mut score =
        parse_mnx(mnx_json).map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
    reconcile_score(&mut score);

    let config = build_config(spatium, page_width, page_setup_json.as_deref());

    let display_list = layout_with_mnx_scores(&score, &config, score_index);
    let binary = display_list.to_binary();

    Ok(js_sys::Float32Array::from(binary.as_slice()))
}

/// Convert a DisplayList (JSON) to per-page SVG strings using font data for glyph outlines.
///
/// Returns a JSON array: `[{pageNumber, svg, widthMm, heightMm}, ...]`
///
/// * `display_list_json` — serialized DisplayList from any `compute_*` function.
/// * `bravura_data` — raw bytes of Bravura.otf (SMuFL music font).
/// * `text_font_data` — raw bytes of a text font (e.g. BravuraText.otf). Pass empty for fallback.
/// * `spatium_mm`, `sp_pixels` — coordinate conversion factors.
/// * `page_width_mm`, `page_height_mm` — output page dimensions.
#[wasm_bindgen]
pub fn export_svg(
    display_list_json: &str,
    bravura_data: &[u8],
    text_font_data: &[u8],
    spatium_mm: f64,
    sp_pixels: f64,
    page_width_mm: f64,
    page_height_mm: f64,
) -> Result<String, JsValue> {
    let dl: viritura_engine::render::DisplayList = serde_json::from_str(display_list_json)
        .map_err(|e| JsValue::from_str(&format!("DisplayList parse error: {e}")))?;

    let cfg = SvgExportConfig {
        spatium_mm,
        sp_pixels,
        page_width_mm,
        page_height_mm,
    };

    let text_data = if text_font_data.is_empty() {
        None
    } else {
        Some(text_font_data)
    };

    let pages = display_list_to_svg_pages(&dl, bravura_data, text_data, &cfg)
        .map_err(|e| JsValue::from_str(&e))?;

    let json_pages: Vec<serde_json::Value> = pages
        .iter()
        .map(|p| {
            serde_json::json!({
                "pageNumber": p.page_number,
                "svg": p.svg,
                "widthMm": p.width_mm,
                "heightMm": p.height_mm,
            })
        })
        .collect();

    serde_json::to_string(&json_pages)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {e}")))
}

// ═══════════════════════════════════════════
// Stateful layout engine with measure-level cache
// ═══════════════════════════════════════════

/// Stateful layout engine that persists a measure-level cache and the
/// parsed Score model across calls. Supports patch-based updates that
/// only re-parse changed measures, skipping full MNX parse on edits.
#[wasm_bindgen]
pub struct LayoutEngine {
    cache: LayoutCache,
    /// Retained score model — updated incrementally via apply_patch.
    score: Option<Score>,
    /// Phase Q: JSON timing breakdown of the most recent
    /// `apply_patch_and_layout_patch_frame_binary` call. Populated only when
    /// `WASM_TIMING_ENABLED` is on; consumed by `take_timings_json`.
    last_timings: Option<String>,
    /// Encoded bytes and frame kind from the most recent incremental binary
    /// response, exposed through `layout_metrics_json` for browser profiling.
    last_frame_bytes: usize,
    last_frame_was_patch: bool,
}

impl Default for LayoutEngine {
    fn default() -> Self {
        let mut cache = LayoutCache::new();
        // Phase L: ship `scoped_precompute` ON by default. After Phases J + K
        // cut the other costs the natural_widths content-hash bypass on
        // measures outside the dirty range is now a non-trivial share of the
        // remaining patch wasmCall (Rhapsody). Stays a strict-subset perf
        // optimization with a content-hash-based correctness invariant — no
        // risk of stale data.
        // Phase O: ship `scoped_resolve` ON by default too. The original Phase A
        // soft-fail was caused by per-call clone of the ~16K-measure cached
        // suffix (deep clone of ResolvedMeasure with its Vec<Sequence>). Phase O
        // refactored the scoped path to move the prior Vec in by value and
        // overwrite the dirty range in place — prefix and suffix are now
        // zero-cost. With that fix the convergence early-exit pays for itself.
        cache.set_range_scope(RangeScope {
            scoped_resolve: true,
            scoped_precompute: true,
            ..Default::default()
        });
        Self {
            cache,
            score: None,
            last_timings: None,
            last_frame_bytes: 0,
            last_frame_was_patch: false,
        }
    }
}

impl LayoutEngine {
    fn apply_patch_and_layout_display_list(
        &mut self,
        patch_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<DisplayList, JsValue> {
        let score = match self.score.as_mut() {
            Some(s) => s,
            None => return Err(JsValue::from_str("No score retained. Call compute_layout_cached or compute_full_score_layout_cached first.")),
        };

        // Phase Q: optional sub-tick inside the layout entry. Captures
        // patch-parse, reconcile, and layout splits into `self.last_timings`
        // when `WASM_TIMING_ENABLED`. Use Date::now (millisecond resolution)
        // — Performance APIs aren't directly available without web-sys.
        let timing = WASM_TIMING_ENABLED.load(Ordering::Relaxed);
        let mut splits: Vec<(&'static str, f64)> = Vec::new();
        let mut t_last = if timing { js_sys::Date::now() } else { 0.0 };

        let patch: serde_json::Value = serde_json::from_str(patch_json)
            .map_err(|e| JsValue::from_str(&format!("Patch parse error: {}", e)))?;

        let mut changed_start: Option<usize> = None;
        let mut changed_end: Option<usize> = None;
        let mut has_global_measure_patch = false;
        let mut has_time_signature_settings_patch = false;
        let mut affected_parts = vec![false; score.parts.len()];

        if let Some(settings_json) = patch.get("timeSignatures") {
            let settings = serde_json::from_value(settings_json.clone()).map_err(|e| {
                JsValue::from_str(&format!("Time signature settings parse error: {}", e))
            })?;
            score.set_time_signature_styles(settings);
            has_time_signature_settings_patch = true;
        }

        if let Some(gm_patches) = patch.get("globalMeasures").and_then(|v| v.as_object()) {
            has_global_measure_patch = !gm_patches.is_empty();
            for (idx_str, gm_json) in gm_patches {
                let idx: usize = idx_str.parse().map_err(|_| {
                    JsValue::from_str(&format!("Invalid global measure index: {}", idx_str))
                })?;
                if idx < score.global.measures.len() {
                    let gm = promote_global_measure_json(gm_json).map_err(|e| {
                        JsValue::from_str(&format!("Global measure {} parse error: {}", idx, e))
                    })?;
                    score.global.measures[idx] = gm;
                    changed_start = Some(changed_start.map_or(idx, |s| s.min(idx)));
                    changed_end = Some(changed_end.map_or(idx, |e| e.max(idx)));
                }
            }
        }

        if let Some(pm_patches) = patch.get("partMeasures").and_then(|v| v.as_object()) {
            for (pi_str, measures) in pm_patches {
                let pi: usize = pi_str
                    .parse()
                    .map_err(|_| JsValue::from_str(&format!("Invalid part index: {}", pi_str)))?;
                if pi < score.parts.len() {
                    if let Some(measure_patches) = measures.as_object() {
                        for (mi_str, pm_json) in measure_patches {
                            let mi: usize = mi_str.parse().map_err(|_| {
                                JsValue::from_str(&format!("Invalid measure index: {}", mi_str))
                            })?;
                            if mi < score.parts[pi].measures.len() {
                                let old_repeat_span = score.parts[pi].measures[mi]
                                    .measure_repeat
                                    .as_ref()
                                    .map_or(1, |repeat| repeat.number.max(1));
                                // A slur's target may live in a DIFFERENT measure than the one
                                // being patched. Collect targets from both the OLD content
                                // (being replaced) and the NEW content, so a slur added,
                                // retargeted, or removed here also widens the dirty range to
                                // cover its target's measure — otherwise that measure's cached
                                // layout segment never learns about the (dis)connected curve.
                                let mut slur_target_ids: Vec<String> = Vec::new();
                                for seq in &score.parts[pi].measures[mi].sequences {
                                    collect_slur_targets(&seq.content, &mut slur_target_ids);
                                }
                                let pm = promote_part_measure_json(pm_json).map_err(|e| {
                                    JsValue::from_str(&format!(
                                        "Part {} measure {} parse error: {}",
                                        pi, mi, e
                                    ))
                                })?;
                                for seq in &pm.sequences {
                                    collect_slur_targets(&seq.content, &mut slur_target_ids);
                                }
                                let new_repeat_span = pm
                                    .measure_repeat
                                    .as_ref()
                                    .map_or(1, |repeat| repeat.number.max(1));
                                score.parts[pi].measures[mi] = pm;
                                affected_parts[pi] = true;
                                changed_start = Some(changed_start.map_or(mi, |s| s.min(mi)));
                                let repeat_end =
                                    (mi + old_repeat_span.max(new_repeat_span) as usize - 1)
                                        .min(score.parts[pi].measures.len() - 1);
                                changed_end =
                                    Some(changed_end.map_or(repeat_end, |e| e.max(repeat_end)));
                                for target_id in &slur_target_ids {
                                    if let Some(target_mi) = find_event_measure_index(
                                        &score.parts[pi].measures,
                                        target_id,
                                    ) {
                                        changed_start = Some(
                                            changed_start.map_or(target_mi, |s| s.min(target_mi)),
                                        );
                                        changed_end = Some(
                                            changed_end.map_or(target_mi, |e| e.max(target_mi)),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if has_global_measure_patch {
            reconcile_score(score);
        } else if let (Some(start), Some(end)) = (changed_start, changed_end) {
            reconcile_score_range(score, start, end);
        }

        if timing {
            let now = js_sys::Date::now();
            splits.push(("parse+promote+reconcile", now - t_last));
            t_last = now;
        }

        // P1: plumb the dirty range to the cache for the range-scoped front-half
        // passes (Phases A–D). A `globalMeasures` patch can reflow every
        // following system (time/key/barline changes), so it forces `None` to
        // bail back to the full path. Otherwise carry the inclusive
        // `[changed_start, changed_end]` so scoped passes can early-exit; the
        // `|dirty| > K` guard is applied downstream in
        // [`LayoutCache::effective_dirty_range`].
        let dirty_region = if has_global_measure_patch {
            None
        } else if has_time_signature_settings_patch {
            let meter_indices: Vec<usize> = score
                .global
                .measures
                .iter()
                .enumerate()
                .filter_map(|(index, measure)| measure.time.as_ref().map(|_| index))
                .collect();
            let active_score = score.scores.get(score_index.unwrap_or(0));
            let uses_auto_flow = !score.layouts.is_empty()
                && !score.scores.is_empty()
                && active_score.is_some_and(|definition| {
                    definition.pages.iter().all(|page| page.systems.is_empty())
                });
            if uses_auto_flow {
                self.cache
                    .prepare_time_signature_settings_change(&meter_indices);
            }
            let start = meter_indices.first().copied().unwrap_or(0);
            let end = meter_indices.last().copied().unwrap_or(start);
            // A coalesced part-measure edit still needs musical resolution.
            // With settings alone, resolved score content is unchanged and can
            // be retained wholesale.
            changed_start
                .is_none()
                .then(|| DirtyRegion::time_signature_settings(start, end))
        } else {
            match (changed_start, changed_end) {
                (Some(s), Some(e)) => Some(DirtyRegion::local_part_measures(s, e, affected_parts)),
                _ => None,
            }
        };
        self.cache.set_pending_dirty_region(dirty_region);

        let config = build_config(spatium, page_width, page_setup_json.as_deref());

        let display_list = if !score.layouts.is_empty() && !score.scores.is_empty() {
            layout_with_mnx_scores_cached(
                score,
                &config,
                score_index.unwrap_or(0),
                Some(&mut self.cache),
            )
        } else if score.parts.len() > 1 {
            layout_full_score_cached(score, &config, Some(&mut self.cache))
        } else {
            layout_score_cached(score, 0, &config, Some(&mut self.cache))
        };

        if timing {
            let now = js_sys::Date::now();
            splits.push(("layout", now - t_last));
            // Phase Q+: drain the engine-internal `tick!` splits so the JSON
            // includes both the wasm-wrapper outer splits AND the per-pass
            // engine sub-splits (resolve_staves, natural_widths, precompute,
            // render loop, cross_system_*, restore, ...).
            let inner_splits = viritura_engine::timing::take_collected_splits();
            // Serialize the breakdown into a JSON fragment for the wrapper
            // (apply_patch_and_layout_patch_frame_binary) to merge into its
            // own outer JSON. Stored on self for the caller to retrieve.
            // Format: { "outer": {"label": ms, ...}, "engine": {"label": ms, ...} }
            let mut s = String::from("{\"outer\":{");
            for (i, (label, ms)) in splits.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                s.push_str(&format!("\"{}\":{:.3}", label, ms));
            }
            s.push_str("},\"engine\":{");
            for (i, (label, ms)) in inner_splits.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                // Trim leading whitespace from the engine labels (some are
                // prefixed with "  " to nest under the parent in stderr output).
                let trimmed = label.trim();
                s.push_str(&format!("\"{}\":{:.3}", trimmed, ms));
            }
            s.push_str("}}");
            self.last_timings = Some(s);
        }

        Ok(display_list)
    }
}

#[wasm_bindgen]
impl LayoutEngine {
    /// Create a new layout engine with an empty cache.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Phase Q: take the most recent patch-frame timing breakdown as a JSON
    /// string and clear it. Returns `None` if `set_wasm_timing(true)` was
    /// not called before the layout, or if no patch call has run since the
    /// last take.
    pub fn take_timings_json(&mut self) -> Option<String> {
        self.last_timings.take()
    }

    /// Deterministic engagement counters for the most recent layout pass.
    /// Timing remains in `take_timings_json`; this payload intentionally holds
    /// counts/bytes that are stable enough for CI correctness gates.
    pub fn layout_metrics_json(&self) -> String {
        serde_json::json!({
            "resolvedCells": self.cache.last_resolved_span(),
            "resolvedFullCells": self.cache.last_resolved_full_span(),
            "widthCells": self.cache.last_width_span(),
            "widthFullCells": self.cache.last_width_full_span(),
            "freshSystems": self.cache.last_patch_fresh_systems(),
            "reusedSystems": self.cache.last_patch_reused_systems(),
            "staffContentReuses": self.cache.staff_content_reuses(),
            "staffContentReuseRuns": self.cache.staff_content_reuse_runs(),
            "staffAuxReuses": self.cache.staff_aux_reuses(),
            "systemMeasureReuses": self.cache.system_measure_reuse_hits(),
            "spannerBoundsFull": self.cache.last_spanner_bounds_full(),
            "spannerBounds": self.cache.last_spanner_bounds(),
            "mmrPlanReused": self.cache.last_mmr_plan_reused(),
            "frameBytes": self.last_frame_bytes,
            "patchFrame": self.last_frame_was_patch,
            "horizonChunksReused": self.cache.last_horizon_chunks_reused(),
            "horizonStaffExtentsReused": self.cache.last_horizon_staff_extents_reused(),
            "horizonTieMapsReused": self.cache.last_horizon_tie_maps_reused(),
            "cacheHits": self.cache.last_hits(),
            "cacheMisses": self.cache.last_misses(),
        })
        .to_string()
    }

    /// Lever 2 step 4 (B-full): enable/disable the per-system wholesale
    /// layout-reuse store. Off by default — the live app keeps the shipped
    /// per-measure-retention path until the editor perf test confirms the
    /// patch-path win. When on, a clean system is moved back in wholesale on
    /// each edit (skipping the per-measure HashMap churn + cross-staff fix).
    /// Byte-identical to the off path (proven by the engine oracle).
    pub fn set_system_layout_reuse(&mut self, enabled: bool) {
        self.cache.set_system_layout_reuse_enabled(enabled);
    }

    /// Layout a single part with cache. Returns DisplayList JSON.
    /// Parses the full MNX JSON and retains the Score internally.
    pub fn compute_layout_cached(
        &mut self,
        mnx_json: &str,
        part_index: usize,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
    ) -> Result<String, JsValue> {
        let mut score = parse_mnx(mnx_json)
            .map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
        reconcile_score(&mut score);

        let config = build_config(spatium, page_width, page_setup_json.as_deref());
        let display_list = layout_score_cached(&score, part_index, &config, Some(&mut self.cache));
        self.score = Some(score);

        serde_json::to_string(&display_list)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Layout all parts (full score) with cache. Returns DisplayList JSON.
    /// Parses the full MNX JSON and retains the Score internally.
    pub fn compute_full_score_layout_cached(
        &mut self,
        mnx_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<String, JsValue> {
        let display_list = self.compute_full_score_layout_cached_dl(
            mnx_json,
            spatium,
            page_width,
            page_setup_json,
            score_index,
        )?;

        serde_json::to_string(&display_list)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Binary sibling of [`Self::compute_full_score_layout_cached`]. Returns the
    /// packed `Float32Array` so the worker can `transfer` it to the main thread
    /// zero-copy, avoiding a multi-megabyte JSON serialize + structured-clone +
    /// `JSON.parse` of the full display list on initial load of large scores.
    pub fn compute_full_score_layout_cached_binary(
        &mut self,
        mnx_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<js_sys::Float32Array, JsValue> {
        let display_list = self.compute_full_score_layout_cached_dl(
            mnx_json,
            spatium,
            page_width,
            page_setup_json,
            score_index,
        )?;
        let binary = display_list.to_binary();
        self.last_frame_bytes = binary.len() * std::mem::size_of::<f32>();
        self.last_frame_was_patch = false;
        Ok(js_sys::Float32Array::from(binary.as_slice()))
    }

    fn compute_full_score_layout_cached_dl(
        &mut self,
        mnx_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<DisplayList, JsValue> {
        let mut score = parse_mnx(mnx_json)
            .map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
        reconcile_score(&mut score);

        let config = build_config(spatium, page_width, page_setup_json.as_deref());

        let display_list = if !score.layouts.is_empty() && !score.scores.is_empty() {
            layout_with_mnx_scores_cached(
                &score,
                &config,
                score_index.unwrap_or(0),
                Some(&mut self.cache),
            )
        } else {
            layout_full_score_cached(&score, &config, Some(&mut self.cache))
        };

        self.score = Some(score);

        Ok(display_list)
    }

    /// Re-layout the already-retained Score for a (possibly different) score
    /// view / config WITHOUT re-parsing the MNX JSON. Returns DisplayList JSON.
    ///
    /// This is the fast path for switching score views (layouts) on large
    /// scores: the parsed + reconciled Score is reused and the measure-level
    /// cache absorbs unchanged horizontal spacing, so only the system assembly
    /// for the new view is recomputed. Errors if no score is retained, in which
    /// case the caller must fall back to `compute_full_score_layout_cached`.
    pub fn relayout_retained_score_cached(
        &mut self,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<String, JsValue> {
        let display_list = self.relayout_retained_score_display_list(
            spatium,
            page_width,
            page_setup_json,
            score_index,
        )?;

        serde_json::to_string(&display_list)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Binary sibling of [`Self::relayout_retained_score_cached`]. Returns the
    /// packed `Float32Array` so the worker can `transfer` it to the main thread
    /// zero-copy (avoiding a Comlink structured-clone of the display list).
    pub fn relayout_retained_score_cached_binary(
        &mut self,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<js_sys::Float32Array, JsValue> {
        let display_list = self.relayout_retained_score_display_list(
            spatium,
            page_width,
            page_setup_json,
            score_index,
        )?;
        let binary = display_list.to_binary();
        Ok(js_sys::Float32Array::from(binary.as_slice()))
    }

    fn relayout_retained_score_display_list(
        &mut self,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<DisplayList, JsValue> {
        let score = self
            .score
            .as_ref()
            .ok_or_else(|| JsValue::from_str("No score retained."))?;

        let config = build_config(spatium, page_width, page_setup_json.as_deref());

        let display_list = if !score.layouts.is_empty() && !score.scores.is_empty() {
            layout_with_mnx_scores_cached(
                score,
                &config,
                score_index.unwrap_or(0),
                Some(&mut self.cache),
            )
        } else if score.parts.len() > 1 {
            layout_full_score_cached(score, &config, Some(&mut self.cache))
        } else {
            layout_score_cached(score, 0, &config, Some(&mut self.cache))
        };

        Ok(display_list)
    }

    /// Apply a measure/root-settings patch and re-layout incrementally.
    ///
    /// The patch JSON format:
    /// ```json
    /// {
    ///   "globalMeasures": { "3": { ... GlobalMeasure JSON ... } },
    ///   "partMeasures": { "0": { "3": { ... PartMeasure JSON ... } } },
    ///   "timeSignatures": { "score": { "scale": 1.5 } }
    /// }
    /// ```
    ///
    /// Only the specified measures are re-parsed and replaced in the retained
    /// Score model. The layout cache handles skipping unchanged measures.
    /// Falls back to full parse if no score is retained.
    pub fn apply_patch_and_layout(
        &mut self,
        patch_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<String, JsValue> {
        let display_list = self.apply_patch_and_layout_display_list(
            patch_json,
            spatium,
            page_width,
            page_setup_json,
            score_index,
        )?;

        serde_json::to_string(&display_list)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Apply a measure-level patch and return a binary display list.
    pub fn apply_patch_and_layout_binary(
        &mut self,
        patch_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<js_sys::Float32Array, JsValue> {
        let display_list = self.apply_patch_and_layout_display_list(
            patch_json,
            spatium,
            page_width,
            page_setup_json,
            score_index,
        )?;
        let binary = display_list.to_binary();
        Ok(js_sys::Float32Array::from(binary.as_slice()))
    }

    /// Apply a measure-level patch and return a PATCH-FRAME delta when the
    /// incremental path is available, else a full binary display list.
    ///
    /// The returned `Float32Array` is tagged at element 0:
    ///   - `0.0` → full frame: the remainder is `DisplayList::to_binary()`.
    ///   - `1.0` → patch frame: the remainder is the packed patch (changed
    ///     systems + per-system shifts). The client reassembles against its
    ///     retained per-system segment array.
    ///
    /// Only the auto-flow (paginated) layout path emits patch frames; all other
    /// paths (explicit pages, single-page) return a full frame transparently.
    pub fn apply_patch_and_layout_patch_frame_binary(
        &mut self,
        patch_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<js_sys::Float32Array, JsValue> {
        self.cache.set_patch_frame_enabled(true);

        let result = self.apply_patch_and_layout_display_list(
            patch_json,
            spatium,
            page_width,
            page_setup_json,
            score_index,
        );
        let pending = self.cache.take_pending_patch_binary();
        self.cache.set_patch_frame_enabled(false);

        let display_list = result?;

        let mut out: Vec<f32> = Vec::new();
        let was_patch = pending.is_some();
        if let Some(patch_bin) = pending {
            out.reserve(patch_bin.len() + 1);
            out.push(1.0);
            out.extend_from_slice(&patch_bin);
        } else {
            let full = display_list.to_binary();
            out.reserve(full.len() + 1);
            out.push(0.0);
            out.extend_from_slice(&full);
        }
        self.last_frame_bytes = out.len() * std::mem::size_of::<f32>();
        self.last_frame_was_patch = was_patch;
        Ok(js_sys::Float32Array::from(out.as_slice()))
    }
    /// Use when structural changes occur (parts added/removed, etc.).
    pub fn full_layout(
        &mut self,
        mnx_json: &str,
        spatium: f64,
        page_width: f64,
        page_setup_json: Option<String>,
        score_index: Option<usize>,
    ) -> Result<String, JsValue> {
        let mut score = parse_mnx(mnx_json)
            .map_err(|e| JsValue::from_str(&format!("MNX parse error: {}", e)))?;
        reconcile_score(&mut score);

        let config = build_config(spatium, page_width, page_setup_json.as_deref());

        // Invalidate cache on structural change
        self.cache.invalidate();

        let display_list = if !score.layouts.is_empty() && !score.scores.is_empty() {
            layout_with_mnx_scores(&score, &config, score_index.unwrap_or(0))
        } else if score.parts.len() > 1 {
            layout_full_score(&score, &config)
        } else {
            layout_score(&score, 0, &config)
        };

        self.score = Some(score);

        serde_json::to_string(&display_list)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    /// Invalidate the entire layout cache (e.g. after a config change).
    pub fn invalidate_cache(&mut self) {
        self.cache.invalidate();
    }

    /// Get cache stats from the last layout pass: [hits, misses].
    pub fn cache_stats(&self) -> Vec<usize> {
        vec![self.cache.last_hits(), self.cache.last_misses()]
    }

    /// Check if a score is retained (patch API is available).
    pub fn has_retained_score(&self) -> bool {
        self.score.is_some()
    }
}
