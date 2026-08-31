//! Oracle for the auto-flow render-segment retention store.
//!
//! Retention reuses a previously-rendered system segment (rigidly shifted by
//! Δy) instead of re-rendering when its render-identity hash is unchanged. This
//! test proves that reuse is *byte-identical* to a from-scratch render: for a
//! range of multi-score fixtures it compares three layouts of the same score —
//!
//!   d: no cache at all          (every system rendered)
//!   a: fresh cache, pass 1       (every system rendered + segments retained)
//!   b: same cache, pass 2        (every system reused from the retained store)
//!
//! and asserts the binary display lists (which round-trip commands, element
//! ids, bboxes, slur geometries, measure bounds, and pages) are bit-identical.
//! At least one fixture/score must engage the retention store, otherwise the
//! fast path is silently disabled and the oracle is vacuous.

use crate::layout::cache::LayoutCache;
use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores_cached;
use crate::parse::parse_mnx;
use crate::reconcile::reconcile_score;
use crate::render::DisplayList;

/// Multi-score fixtures that reach the auto-flow branch (a score without
/// explicit `pages`) for at least one score index. Kept small so the oracle
/// stays fast; Rhapsody is covered by the ignored perf probe.
const FIXTURES: &[&str] = &[
    "condensing-test.mnx",
    "multimeasure-rests.mnx",
    "system-layouts.mnx",
    "part-transposition.mnx",
    "organ-layout.mnx",
    "multiple-layouts.mnx",
];

fn fixture_path(name: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root resolvable")
        .join("packages/format/fixtures/mnx")
        .join(name)
}

/// Bit-exact fingerprint of a rendered display list (NaN-safe vs. raw `f32`
/// equality).
#[test]
fn repeated_layouts_of_one_score_are_identical() {
    // Laying out the same score twice must give the same answer. That sounds
    // tautological, but nothing enforces it: `HashMap` iteration order is
    // unspecified, and Rust's `RandomState` re-seeds for *every map created*,
    // so a map iterated anywhere in layout permutes between successive calls
    // within a single process. Any `min_by`/`max_by` over such a map then
    // resolves ties differently and the geometry moves.
    //
    // This is the oracle behind the warm-vs-cold retention tests: those
    // compare two layouts for byte equality, so they inherit every source of
    // nondeterminism and fail intermittently for reasons that have nothing to
    // do with caching. Checking repeatability directly localizes the fault.
    let json = std::fs::read_to_string(fixture_path("Rhapsody in Blue.mnx"))
        .expect("Rhapsody fixture readable");
    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    reconcile_score(&mut score);
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(10_000.0),
        ..LayoutConfig::default()
    };

    let baseline = layout_with_mnx_scores_cached(&score, &config, 0, None);
    for run in 1..6 {
        let again = layout_with_mnx_scores_cached(&score, &config, 0, None);
        assert_same(
            &format!("Rhapsody layout repeatability (run {run})"),
            &baseline,
            &again,
        );
    }
}

fn binary_bits(dl: &DisplayList) -> Vec<u32> {
    dl.to_binary().iter().map(|f| f.to_bits()).collect()
}

/// Canonicalize a display list by merging abutting, collinear, untagged
/// horizontal lines (same y, width, color, with `x2 == next.x1`) into a single
/// span. Stitched-horizon chunking is *expected* to split each full-galley
/// staff line into one segment per chunk; those segments abut exactly at the
/// seams and re-merge to the identical span. Applying the same merge to BOTH
/// the single-system and chunked layouts means any over-merge (e.g. two
/// coincidentally-abutting ledger lines) happens identically in both and
/// cancels — the merge can neither fabricate nor delete coverage, so equality
/// of the canonical forms holds iff the staff-line coverage AND every other
/// command match. `element_ids` are merged in lockstep (the dropped slots are
/// always `None`, since staff lines are untagged) so the binary comparison
/// stays index-aligned.
fn canonical_merge(dl: &DisplayList) -> DisplayList {
    use crate::render::RenderCommand;
    use std::collections::HashMap;

    let mut out = dl.clone();
    out.element_ids.resize(out.commands.len(), None);

    let mut cmds: Vec<RenderCommand> = Vec::with_capacity(out.commands.len());
    let mut ids: Vec<Option<String>> = Vec::with_capacity(out.commands.len());
    // (y.to_bits, width.to_bits, color) -> index in `cmds` of the last emitted
    // untagged horizontal line with that key.
    let mut last_h: HashMap<(u64, u64, String), usize> = HashMap::new();

    for (cmd, id) in out.commands.iter().zip(out.element_ids.iter()) {
        if let RenderCommand::DrawLine {
            x1,
            y1,
            x2,
            y2,
            width,
            color,
        } = cmd
        {
            if y1 == y2 && id.is_none() {
                let key = (y1.to_bits(), width.to_bits(), color.clone());
                if let Some(&pi) = last_h.get(&key) {
                    if let RenderCommand::DrawLine { x2: px2, .. } = &mut cmds[pi] {
                        if (*px2 - x1).abs() < 1e-9 {
                            *px2 = *x2;
                            continue;
                        }
                    }
                }
                cmds.push(cmd.clone());
                ids.push(id.clone());
                last_h.insert(key, cmds.len() - 1);
                continue;
            }
        }
        cmds.push(cmd.clone());
        ids.push(id.clone());
    }

    out.commands = cmds;
    out.element_ids = ids;
    out
}

fn assert_same(label: &str, lhs: &DisplayList, rhs: &DisplayList) {
    assert_eq!(
        lhs.width.to_bits(),
        rhs.width.to_bits(),
        "{label}: width diverged"
    );
    assert_eq!(
        lhs.height.to_bits(),
        rhs.height.to_bits(),
        "{label}: height diverged ({} vs {})",
        lhs.height,
        rhs.height
    );
    assert_eq!(
        lhs.commands.len(),
        rhs.commands.len(),
        "{label}: command count diverged"
    );
    assert_eq!(
        lhs.element_ids.len(),
        rhs.element_ids.len(),
        "{label}: element_ids count diverged"
    );
    assert_eq!(
        lhs.element_bboxes.len(),
        rhs.element_bboxes.len(),
        "{label}: element_bboxes count diverged"
    );
    assert_eq!(
        lhs.element_shapes.len(),
        rhs.element_shapes.len(),
        "{label}: element_shapes count diverged"
    );
    assert_eq!(
        lhs.slur_geometries.len(),
        rhs.slur_geometries.len(),
        "{label}: slur_geometries count diverged"
    );
    assert_eq!(
        lhs.measure_bounds.len(),
        rhs.measure_bounds.len(),
        "{label}: measure_bounds count diverged"
    );
    assert_eq!(
        lhs.pages.len(),
        rhs.pages.len(),
        "{label}: page count diverged"
    );
    // Bit-exact comparison, so name the first divergence rather than just
    // reporting that one happened — "the display list differs" gives nothing
    // to work from when the two paths are thousands of commands long.
    if binary_bits(lhs) != binary_bits(rhs) {
        let first = lhs
            .commands
            .iter()
            .zip(rhs.commands.iter())
            .enumerate()
            .find(|(_, (a, b))| format!("{a:?}") != format!("{b:?}"));
        match first {
            Some((index, (a, b))) => {
                let id = lhs
                    .element_ids
                    .get(index)
                    .and_then(Option::as_deref)
                    .unwrap_or("<none>");
                panic!(
                    "{label}: binary display list diverged at command {index} \
                     (element {id})\n  warm: {a:?}\n  cold: {b:?}"
                );
            }
            None => panic!(
                "{label}: binary display list diverged, but every command \
                 formats identically — divergence is in sub-formatting float \
                 bits or in a non-command section"
            ),
        }
    }
}

#[test]
fn retained_segments_reuse_is_byte_identical() {
    // Exercise both the paged path (multi-system, per-system segment reuse) and
    // the horizon path (one mega-system, page_width=None) so the move-based
    // per-measure retention store is engaged in both layouts.
    let configs = [
        LayoutConfig {
            page_width: Some(816.0),
            ..LayoutConfig::default()
        },
        LayoutConfig {
            page_width: None,
            ..LayoutConfig::default()
        },
    ];

    let mut engaged_retention = false;
    let mut engaged_measure_retention = false;

    for config in &configs {
        for &name in FIXTURES {
            let path = fixture_path(name);
            let json = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("fixture {name} readable: {e}"));
            let mut score =
                parse_mnx(&json).unwrap_or_else(|e| panic!("fixture {name} parses: {e:?}"));
            reconcile_score(&mut score);

            for score_index in 0..score.scores.len() {
                // d: no cache — every system rendered from scratch.
                let no_cache = layout_with_mnx_scores_cached(&score, config, score_index, None);

                // a/b: shared cache — pass 1 populates the retention stores, pass
                // 2 reuses every unchanged system + measure.
                let mut cache = LayoutCache::new();
                let warm =
                    layout_with_mnx_scores_cached(&score, config, score_index, Some(&mut cache));
                if cache.retained_segment_count() > 0 {
                    engaged_retention = true;
                }
                if cache.retained_measure_count() > 0 {
                    engaged_measure_retention = true;
                }
                let reused =
                    layout_with_mnx_scores_cached(&score, config, score_index, Some(&mut cache));

                let paged = config.page_width.is_some();
                let label = format!("{name}#{score_index} (paged={paged})");
                assert_same(&format!("{label} no-cache vs warm"), &no_cache, &warm);
                assert_same(&format!("{label} warm vs reused"), &warm, &reused);
            }
        }
    }

    assert!(
        engaged_retention,
        "no fixture/score engaged the retention store — the fast path is disabled, \
         so this oracle is vacuous"
    );
    assert!(
        engaged_measure_retention,
        "no fixture/score engaged the per-measure layout retention store — the \
         move-based reuse fast path is disabled, so this oracle is vacuous"
    );
}

/// Byte-identity oracle specifically for the **cross-system spanner** retention
/// path (`RetainedSlurData` → `splice_retained_slur_data` → cross-system slur /
/// tie overlay). The six default fixtures above don't reliably produce slurs
/// or ties that span a system break, so that path — exactly where the
/// `GlobalSlurEvent` / `GlobalTieNote` retention lives, and where any id
/// representation change (`Rc<str>`, u32 interning) takes effect — was vacuous
/// in the main oracle. Here we build a long single part of slurred **and** tied
/// whole notes on a narrow page so it wraps onto many systems, guaranteeing
/// many spanners cross a system break, then assert the three-way byte identity
/// (no-cache == warm == reused) with non-vacuous guards that cross-system slur
/// AND tie halves were actually emitted.
#[test]
fn cross_system_spanner_retention_is_byte_identical() {
    let mut global = String::new();
    let mut part = String::new();
    const N: usize = 24;
    for i in 0..N {
        let slur = if i + 1 < N {
            format!(r#", "slurs": [{{"target": "ev{}"}}]"#, i + 1)
        } else {
            String::new()
        };
        let tie = if i + 1 < N {
            format!(r#", "ties": [{{"target": "t{}"}}]"#, i + 1)
        } else {
            String::new()
        };
        let note = format!(
            r#"{{"id": "ev{i}", "duration": {{"base": "whole"}}, "notes": [{{"id": "t{i}", "pitch": {{"step": "C", "octave": 5}}{tie}}}]{slur}}}"#
        );
        if i == 0 {
            global.push_str(r#"{"id": "m0", "time": {"count": 4, "unit": 4}}"#);
            part.push_str(&format!(
                r#"{{"clefs": [{{"clef": {{"sign": "G", "staffPosition": -2}}}}], "sequences": [{{"content": [{note}]}}]}}"#
            ));
        } else {
            global.push_str(",{}");
            part.push_str(&format!(r#",{{"sequences": [{{"content": [{note}]}}]}}"#));
        }
    }
    // Include `parts` id + `layouts` + a `scores` entry whose top-level
    // `layout` (and NO explicit `pages`/`systems`) selects the auto-flow path
    // (`all_systems.is_empty()` in `layout_with_mnx_scores_cached`); a bare
    // mnx/global/parts score falls back to the un-cached `layout_full_score`,
    // which never engages the retention store. The 24 measures auto-flow
    // across systems under the narrow page.
    let json = format!(
        r#"{{"mnx": {{"version": 1}}, "global": {{"measures": [{global}]}}, "parts": [{{"id": "p0", "measures": [{part}]}}], "layouts": [{{"id": "L0", "content": [{{"type": "staff", "sources": [{{"part": "p0"}}]}}]}}], "scores": [{{"name": "S", "layout": "L0"}}]}}"#
    );
    let mut score = parse_mnx(&json).expect("generated cross-system fixture parses");
    reconcile_score(&mut score);

    // Narrow page so the 24 whole-note measures wrap onto several systems.
    let config = LayoutConfig {
        page_width: Some(450.0),
        ..LayoutConfig::default()
    };

    // d: no cache. a: warm (retain). b: reused (splice retained slur/tie data).
    let no_cache = layout_with_mnx_scores_cached(&score, &config, 0, None);
    let mut cache = LayoutCache::new();
    let warm = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    assert!(
        cache.retained_segment_count() > 0,
        "cross-system fixture must engage the retention store"
    );
    let reused = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));

    // Non-vacuous: the reused layout must actually carry cross-system slur AND
    // tie halves (`/lh` + `/rh`), the spanner geometry whose ids run through
    // the retained `GlobalSlurEvent` / `GlobalTieNote`.
    let count_halves = |dl: &DisplayList, prefix: &str| -> usize {
        dl.element_ids
            .iter()
            .filter(|id| {
                id.as_deref().is_some_and(|s| {
                    s.starts_with(prefix) && (s.ends_with("/lh") || s.ends_with("/rh"))
                })
            })
            .count()
    };
    assert!(
        count_halves(&reused, "slur/") > 0,
        "fixture must emit cross-system slur halves (oracle would be vacuous otherwise)"
    );
    assert!(
        count_halves(&reused, "tie/") > 0,
        "fixture must emit cross-system tie halves (oracle would be vacuous otherwise)"
    );

    assert_same("cross-system no-cache vs warm", &no_cache, &warm);
    assert_same("cross-system warm vs reused", &warm, &reused);
}

/// Diagnostic probe: compare single-system vs chunked horizon on Rhapsody
/// (real piano music with varying vertical content) and report the first
/// diverging command + its y, to localize whether the misalignment is
/// horizontal (x) or vertical (y). Run with:
///   cargo test -p viritura-engine --lib diag_rhapsody_chunk_divergence -- --ignored --nocapture
#[test]
#[ignore = "manual divergence probe; run with --ignored --nocapture"]
fn diag_rhapsody_chunk_divergence() {
    use crate::render::RenderCommand;
    let path = fixture_path("Rhapsody in Blue.mnx");
    let json = std::fs::read_to_string(&path).expect("Rhapsody readable");
    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    reconcile_score(&mut score);

    let single_cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: None,
        ..LayoutConfig::default()
    };
    let chunked_cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(10000.0),
        ..LayoutConfig::default()
    };
    let score_index = 0;
    let single = canonical_merge(&layout_with_mnx_scores_cached(
        &score,
        &single_cfg,
        score_index,
        None,
    ));
    let chunked = canonical_merge(&layout_with_mnx_scores_cached(
        &score,
        &chunked_cfg,
        score_index,
        None,
    ));

    println!(
        "single: cmds={} bbox={} pages={} | chunked: cmds={} bbox={} pages={}",
        single.commands.len(),
        single.element_bboxes.len(),
        single.pages.len(),
        chunked.commands.len(),
        chunked.element_bboxes.len(),
        chunked.pages.len(),
    );

    fn cmd_y(c: &RenderCommand) -> Option<f64> {
        match c {
            RenderCommand::DrawLine { y1, .. } => Some(*y1),
            RenderCommand::DrawGlyph { y, .. } => Some(*y),
            RenderCommand::DrawText { y, .. } => Some(*y),
            RenderCommand::DrawRect { y, .. } => Some(*y),
            _ => None,
        }
    }

    let n = single.commands.len().min(chunked.commands.len());
    let mut shown = 0;
    for i in 0..n {
        let a = &single.commands[i];
        let b = &chunked.commands[i];
        if format!("{a:?}") != format!("{b:?}") {
            let dy = match (cmd_y(a), cmd_y(b)) {
                (Some(ya), Some(yb)) => format!("Δy={:.3}", yb - ya),
                _ => "Δy=?".to_string(),
            };
            println!("DIFF @cmd {i} {dy}\n  single={a:?}\n  chunk ={b:?}");
            shown += 1;
            if shown >= 10 {
                break;
            }
        }
    }
    if shown == 0 {
        println!("no command divergence in the common prefix (len diff only)");
    }

    // ── Multiset comparison (order-independent) ──
    // Per-chunk spanner emission reorders commands relative to single-system's
    // end-of-galley emission, so the ordered prefix diverges even when the SET
    // of rendered primitives is identical. Round each f64 to absorb float jitter
    // from x-translation, then diff the multisets to find genuinely missing/extra
    // commands (vs harmless reordering).
    fn norm(c: &RenderCommand) -> String {
        // Format then collapse long decimals to 3 dp so translated-but-equal
        // commands compare equal.
        let s = format!("{c:?}");
        let re_pieces: Vec<String> = s
            .split([' ', ','])
            .map(|tok| {
                if let Ok(v) = tok.trim_end_matches(['{', '}', ':']).parse::<f64>() {
                    format!("{:.3}", v)
                } else {
                    tok.to_string()
                }
            })
            .collect();
        re_pieces.join(" ")
    }

    use std::collections::HashMap;
    let mut single_ms: HashMap<String, i64> = HashMap::new();
    let mut chunk_ms: HashMap<String, i64> = HashMap::new();
    for c in &single.commands {
        *single_ms.entry(norm(c)).or_default() += 1;
    }
    for c in &chunked.commands {
        *chunk_ms.entry(norm(c)).or_default() += 1;
    }
    let mut only_single = 0i64;
    let mut only_chunk = 0i64;
    let mut shown_ms = 0;
    let mut keys: Vec<&String> = single_ms.keys().chain(chunk_ms.keys()).collect();
    keys.sort();
    keys.dedup();
    for k in keys {
        let a = *single_ms.get(k).unwrap_or(&0);
        let b = *chunk_ms.get(k).unwrap_or(&0);
        if a != b {
            if a > b {
                only_single += a - b;
            } else {
                only_chunk += b - a;
            }
            if shown_ms < 12 {
                println!("MULTISET DIFF single×{a} chunk×{b}: {k}");
                shown_ms += 1;
            }
        }
    }
    println!(
        "multiset: commands only-in-single={only_single} only-in-chunked={only_chunk} \
         (0/0 ⇒ identical set, divergence is pure reordering)"
    );
}

/// Oracle for stitched-horizon chunking (Phase 7a′).
///
/// In an un-paged ("horizon") view, setting `horizon_chunk_width` splits the
/// single mega-system into independently-retainable chunks placed at
/// continuous-x / shared-y with all seam furniture (system-start barline,
/// brackets/braces, staff labels, courtesy clefs) suppressed. This MUST be a
/// pure performance transform: the rendered galley has to be **byte-identical**
/// to the single-system horizon layout. This test compares, for each fixture ×
/// score, the binary display list of:
///
///   single: page_width=None, horizon_chunk_width=None  (one mega-system)
///   chunked: page_width=None, horizon_chunk_width=Some(W)  (stitched chunks)
///
/// and asserts they are bit-identical. To avoid vacuity, at least one fixture
/// must actually split into >1 chunk AND re-engage the per-system retention
/// store (the entire reason the feature exists).
#[test]
fn stitched_horizon_chunks_are_byte_identical() {
    // Narrow chunk width so wide fixtures split into several chunks.
    const CHUNK_W: f64 = 360.0;

    let single_cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: None,
        ..LayoutConfig::default()
    };
    let chunked_cfg = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(CHUNK_W),
        ..LayoutConfig::default()
    };

    let mut engaged_chunking = false;

    for &name in FIXTURES {
        let path = fixture_path(name);
        let json = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("fixture {name} readable: {e}"));
        let mut score = parse_mnx(&json).unwrap_or_else(|e| panic!("fixture {name} parses: {e:?}"));
        reconcile_score(&mut score);

        for score_index in 0..score.scores.len() {
            let single = layout_with_mnx_scores_cached(&score, &single_cfg, score_index, None);

            let mut cache = LayoutCache::new();
            let chunked =
                layout_with_mnx_scores_cached(&score, &chunked_cfg, score_index, Some(&mut cache));
            // >1 retained segment ⇒ the galley split into multiple chunks and
            // per-system retention re-engaged.
            if cache.retained_segment_count() > 1 {
                engaged_chunking = true;
            }

            let label = format!("{name}#{score_index} single-vs-chunked");
            assert_same(
                &label,
                &canonical_merge(&single),
                &canonical_merge(&chunked),
            );
        }
    }

    assert!(
        engaged_chunking,
        "no fixture/score split into >1 stitched chunk — chunking never engaged, \
         so this oracle is vacuous"
    );
}

#[test]
fn stitched_horizon_width_edit_keeps_stable_chunk_suffix() {
    use crate::layout::cache::{DirtyRegion, LayoutCache, RangeScope};
    use crate::model::SequenceContent;
    use crate::reconcile::{reconcile_score, reconcile_score_range};

    let json = std::fs::read_to_string(fixture_path("Rhapsody in Blue.mnx"))
        .expect("Rhapsody fixture readable");
    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    reconcile_score(&mut score);
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(10_000.0),
        ..LayoutConfig::default()
    };

    let mut cache = LayoutCache::new();
    cache.set_range_scope(RangeScope {
        scoped_resolve: true,
        scoped_precompute: true,
        ..Default::default()
    });
    cache.set_patch_frame_enabled(true);
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let _ = cache.take_pending_patch();

    let mut edited = None;
    'parts: for (part_index, part) in score.parts.iter_mut().enumerate() {
        for (measure_index, measure) in part.measures.iter_mut().enumerate() {
            for sequence in &mut measure.sequences {
                for item in &mut sequence.content {
                    if let SequenceContent::Event(event) = item {
                        if let Some(note) = event.notes.as_mut().and_then(|notes| notes.first_mut())
                        {
                            // Force a visibly wider accidental column rather
                            // than relying on a pitch move to change width.
                            note.pitch.alter = Some(3);
                            edited = Some((part_index, measure_index));
                            break 'parts;
                        }
                    }
                }
            }
        }
    }
    let (part_index, measure_index) = edited.expect("Rhapsody has a pitched event");
    reconcile_score_range(&mut score, measure_index, measure_index);
    let mut affected_parts = vec![false; score.parts.len()];
    affected_parts[part_index] = true;
    cache.set_pending_dirty_region(Some(DirtyRegion::local_part_measures(
        measure_index,
        measure_index,
        affected_parts,
    )));

    let _patch_layout = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    assert!(
        cache.last_horizon_chunks_reused(),
        "local width edit should retain the established chunk partition"
    );
    assert!(
        cache.last_patch_fresh_systems() > 0,
        "edited chunk must be transmitted fresh"
    );
    assert!(
        cache.last_patch_reused_systems() > 0,
        "stable partition must reuse at least one downstream chunk (fresh={}, reused={}, hash_skips={})",
        cache.last_patch_fresh_systems(),
        cache.last_patch_reused_systems(),
        cache.render_hash_skips(),
    );

    // Repeat through a non-patch cache so the returned display list includes
    // every reused chunk and can be compared directly.
    let mut identity_score = parse_mnx(&json).expect("Rhapsody reparses");
    reconcile_score(&mut identity_score);
    let mut identity_cache = LayoutCache::new();
    identity_cache.set_range_scope(RangeScope {
        scoped_resolve: true,
        scoped_precompute: true,
        ..Default::default()
    });
    let _ = layout_with_mnx_scores_cached(&identity_score, &config, 0, Some(&mut identity_cache));
    let target_measure = &mut identity_score.parts[part_index].measures[measure_index];
    let target_note = target_measure
        .sequences
        .iter_mut()
        .flat_map(|sequence| sequence.content.iter_mut())
        .find_map(|item| match item {
            SequenceContent::Event(event) => {
                event.notes.as_mut().and_then(|notes| notes.first_mut())
            }
            _ => None,
        })
        .expect("same pitched event exists after reparse");
    target_note.pitch.alter = Some(3);
    reconcile_score_range(&mut identity_score, measure_index, measure_index);
    let mut identity_parts = vec![false; identity_score.parts.len()];
    identity_parts[part_index] = true;
    identity_cache.set_pending_dirty_region(Some(DirtyRegion::local_part_measures(
        measure_index,
        measure_index,
        identity_parts,
    )));
    let warm =
        layout_with_mnx_scores_cached(&identity_score, &config, 0, Some(&mut identity_cache));
    assert!(identity_cache.last_horizon_chunks_reused());

    // A cold edited layout may choose different cumulative-width seams. Seams
    // are furniture-free, so both partitions must flatten to the same galley.
    let cold = layout_with_mnx_scores_cached(&identity_score, &config, 0, None);
    let warm_canonical = canonical_merge(&warm);
    let cold_canonical = canonical_merge(&cold);
    if binary_bits(&warm_canonical) != binary_bits(&cold_canonical) {
        let warm_binary = warm_canonical.to_binary();
        let cold_binary = cold_canonical.to_binary();
        if let Some((index, (warm_value, cold_value))) = warm_binary
            .iter()
            .zip(cold_binary.iter())
            .enumerate()
            .find(|(_, (left, right))| left.to_bits() != right.to_bits())
        {
            eprintln!(
                "first packed difference at {index}: stable={warm_value} ({:08x}) cold={cold_value} ({:08x})",
                warm_value.to_bits(),
                cold_value.to_bits(),
            );
        }
        if let Some((index, (warm_command, cold_command))) = warm_canonical
            .commands
            .iter()
            .zip(cold_canonical.commands.iter())
            .enumerate()
            .find(|(_, (left, right))| format!("{left:?}") != format!("{right:?}"))
        {
            eprintln!(
                "first stable/cold command difference at {index}:\n  stable={warm_command:?}\n  cold={cold_command:?}"
            );
        }
    }
    assert_same(
        "Rhapsody stable-horizon warm edit vs cold edited layout",
        &warm_canonical,
        &cold_canonical,
    );
}

#[test]
fn system_membership_reconverges_across_shifted_ordinals() {
    use crate::layout::cache::LayoutCache;

    let mut cache = LayoutCache::new();
    assert_eq!(
        cache.update_system_membership(&[vec![0, 1], vec![2, 3], vec![4, 5]]),
        vec![None, None, None]
    );
    assert_eq!(
        cache.update_system_membership(&[vec![0], vec![1], vec![2, 3], vec![4, 5]]),
        vec![None, None, Some(1), Some(2)]
    );
    assert_eq!(cache.membership_reconvergence_reuses(), 2);
}

/// P0 precondition oracle for the range-scoped incremental-layout migration
/// (see `docs/plans/incremental-display-list.md` §3 Phase 0).
///
/// Every range-scoped pass (Phases A–E) must preserve one invariant: laying out
/// a score *after an edit, reusing a warm cache* is **byte-identical** to laying
/// it out from a cold cache. This test establishes that invariant on the
/// *current* (full, unscoped) path under a real single-measure edit, so that
/// once the scoped passes land, any convergence bug surfaces here as a red test
/// rather than a rendering glitch. It is the gate every later phase reuses.
///
///   cold:  parse → edit → layout(fresh cache)            ← ground truth
///   warm:  parse → layout(cache) → edit → layout(cache)  ← retention under edit
///
/// The edit raises the first pitched note's octave in the first part-measure
/// that has one (an octave shift never changes duration, so it is
/// reconcile-safe, and it always moves a glyph, so it perturbs the rendered
/// bytes). To avoid vacuity, at least one fixture/score must actually apply an
/// edit AND reuse ≥1 retained segment across it.
#[test]
fn edit_then_warm_reuse_is_byte_identical() {
    use crate::model::SequenceContent;
    use crate::reconcile::reconcile_score_range;

    // Raise the octave of the first pitched note found, returning the global
    // measure index that changed (the dirty range is `[mi, mi]`). `None` when
    // the score has no pitched note to perturb.
    fn apply_octave_edit(score: &mut crate::model::Score) -> Option<(usize, usize)> {
        for (part_index, part) in score.parts.iter_mut().enumerate() {
            for (mi, measure) in part.measures.iter_mut().enumerate() {
                for seq in &mut measure.sequences {
                    for item in &mut seq.content {
                        if let SequenceContent::Event(ev) = item {
                            if let Some(notes) = ev.notes.as_mut() {
                                if let Some(note) = notes.first_mut() {
                                    note.pitch.octave += 1;
                                    return Some((part_index, mi));
                                }
                            }
                        }
                    }
                }
            }
        }
        None
    }

    let configs = [
        LayoutConfig {
            page_width: Some(816.0),
            ..LayoutConfig::default()
        },
        LayoutConfig {
            page_width: None,
            ..LayoutConfig::default()
        },
    ];

    let mut engaged_edit = false;
    let mut engaged_reuse_across_edit = false;
    let mut engaged_scoped_resolve = false;
    let mut engaged_scoped_precompute = false;
    let mut engaged_system_spacing_reuse = false;

    for config in &configs {
        for &name in FIXTURES {
            let path = fixture_path(name);
            let json = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("fixture {name} readable: {e}"));

            for score_index in 0..parse_mnx(&json)
                .unwrap_or_else(|e| panic!("fixture {name} parses: {e:?}"))
                .scores
                .len()
            {
                // cold: fresh parse, edit, lay out with a cold cache.
                let mut cold_score = parse_mnx(&json).expect("parse");
                reconcile_score(&mut cold_score);
                let Some((part_index, mi)) = apply_octave_edit(&mut cold_score) else {
                    continue; // no pitched note in this score — skip
                };
                reconcile_score_range(&mut cold_score, mi, mi);
                let cold = layout_with_mnx_scores_cached(&cold_score, config, score_index, None);

                // warm: parse, lay out once to warm the retention stores, THEN
                // apply the same edit and lay out again reusing the cache.
                let mut warm_score = parse_mnx(&json).expect("parse");
                reconcile_score(&mut warm_score);
                let mut cache = LayoutCache::new();
                // Phase A: flip scoped_resolve before the FIRST layout so the
                // resolve pass populates its cache. With the toggle off, the
                // resolve pass does not write the cache (preserves the
                // toggle-off perf characteristics on today's full path), so a
                // subsequent toggle-on relayout would have nothing to scope.
                // Phase C: also flip scoped_precompute so natural_widths can
                // engage its trust-the-cache fast path on the relayout.
                cache.set_range_scope(crate::layout::cache::RangeScope {
                    scoped_resolve: true,
                    scoped_precompute: true,
                    ..Default::default()
                });
                let _ = layout_with_mnx_scores_cached(
                    &warm_score,
                    config,
                    score_index,
                    Some(&mut cache),
                );
                let edited = apply_octave_edit(&mut warm_score);
                assert_eq!(
                    edited,
                    Some((part_index, mi)),
                    "{name}#{score_index}: edit located the same measure"
                );
                reconcile_score_range(&mut warm_score, mi, mi);
                // P1: simulate what wasm `apply_patch_and_layout_*` does — set
                // the dirty range on the cache before layout. The pass must
                // consume it (it's `Some` after we set, `None` after layout)
                // and the layout output must still be byte-identical to cold
                // (proving P1 plumbing introduces no behavior change). The
                // scoped_resolve toggle (set above for the warm pass) carries
                // forward into this relayout — the scoped path now finds the
                // prior cache and engages.
                let mut affected_parts = vec![false; warm_score.parts.len()];
                affected_parts[part_index] = true;
                cache.set_pending_dirty_region(Some(
                    crate::layout::cache::DirtyRegion::local_part_measures(mi, mi, affected_parts),
                ));
                let warm = layout_with_mnx_scores_cached(
                    &warm_score,
                    config,
                    score_index,
                    Some(&mut cache),
                );
                assert!(
                    cache.take_pending_dirty_range().is_none(),
                    "{name}#{score_index}: layout did not consume pending_dirty_range"
                );
                engaged_edit = true;
                if cache.retained_segment_count() > 0 {
                    engaged_reuse_across_edit = true;
                }
                // Non-vacuous Phase A guard: at least one fixture must have
                // had its scoped resolve actually fire — `last_resolved_span`
                // strictly less than `last_resolved_full_span` proves we
                // splice-from-cache instead of full-resolving every measure.
                if cache.last_resolved_full_span() > 0
                    && cache.last_resolved_span() < cache.last_resolved_full_span()
                {
                    engaged_scoped_resolve = true;
                }
                // Non-vacuous Phase C guard: at least one fixture must have
                // hit the trust-the-cache fast path (skipping the per-measure
                // content hash on outside-range measures).
                if cache.unchecked_hits() > 0 {
                    engaged_scoped_precompute = true;
                }
                // Non-vacuous Phase G/H guard: at least one fixture must have
                // hit the cached `compute_system_spacing` fast path. Unlike the
                // Phase A/C toggles, Phase G/H is unconditional (always on
                // when a prior pass populated the cache and content didn't
                // change for the system).
                if cache.system_spacing_reuse_hits() > 0 {
                    engaged_system_spacing_reuse = true;
                }

                let paged = config.page_width.is_some();
                let label = format!("{name}#{score_index} (paged={paged}) cold-edit vs warm-edit");
                assert_same(&label, &cold, &warm);
            }
        }
    }

    assert!(
        engaged_edit,
        "no fixture/score had a pitched note to edit — the edit oracle is vacuous"
    );
    assert!(
        engaged_reuse_across_edit,
        "no fixture/score reused a retained segment across the edit — the \
         retention-under-edit path is untested, so this oracle is vacuous"
    );
    assert!(
        engaged_scoped_resolve,
        "no non-condensed fixture engaged Phase A's range-scoped resolve — \
         either every fixture is condensing (cannot scope), or the cache+toggle \
         path failed to fire, so the oracle does not prove Phase A's win"
    );
    assert!(
        engaged_scoped_precompute,
        "no fixture engaged Phase C's trust-the-cache fast path in \
         compute_natural_measure_widths — the unchecked_hits counter never \
         incremented, so the oracle does not prove Phase C's win"
    );
    assert!(
        engaged_system_spacing_reuse,
        "no fixture engaged Phase G/H's cached compute_system_spacing fast \
         path — the system_spacing_reuse_hits counter never incremented, so \
         the oracle does not prove Phase G/H's win"
    );
}

/// Phase F fallback proof: a dirty range that exceeds `K` must NOT engage the
/// scoped resolve path. With `scoped_resolve` on but the simulated patch
/// covering many measures (well over `DEFAULT_RANGE_SCOPE_K`), the cache should
/// fall back to a full resolve — `last_resolved_span == last_resolved_full_span`.
#[test]
fn phase_f_dirty_over_k_bails_to_full() {
    use crate::layout::cache::{LayoutCache, RangeScope, DEFAULT_RANGE_SCOPE_K};
    use crate::layout::layout_with_mnx_scores_cached;
    use crate::reconcile::reconcile_score;

    // Pick a fixture with at least DEFAULT_RANGE_SCOPE_K + 2 measures and
    // pitched content to perturb. `system-layouts.mnx` has plenty.
    let path = fixture_path("system-layouts.mnx");
    let json = std::fs::read_to_string(&path).expect("readable");
    let mut score = parse_mnx(&json).expect("parses");
    reconcile_score(&mut score);
    let measure_count = score.global.measures.len();
    if measure_count <= DEFAULT_RANGE_SCOPE_K + 1 {
        // Fixture not large enough — skip rather than mis-assert.
        return;
    }

    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };
    let mut cache = LayoutCache::new();
    cache.set_range_scope(RangeScope {
        scoped_resolve: true,
        ..Default::default()
    });
    // Warm pass populates the resolve cache.
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));

    // Simulate a patch whose dirty range spans MORE than K measures.
    let oversized_end = (DEFAULT_RANGE_SCOPE_K + 1).min(measure_count - 1);
    cache.set_pending_dirty_range(Some((0, oversized_end)));
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));

    let full_span = cache.last_resolved_full_span();
    let resolved_span = cache.last_resolved_span();
    assert!(
        full_span > 0,
        "fixture must have at least one staff × measure"
    );
    assert_eq!(
        resolved_span, full_span,
        "|dirty| > K should have forced a full resolve, but span={} != full={}",
        resolved_span, full_span
    );
}

/// Phase F fallback proof: a `globalMeasures` patch (simulated by setting
/// `pending_dirty_range = None`) must force the full path. The wasm
/// `apply_patch_and_layout_*` already enforces this; this test pins the
/// invariant at the engine layer (a `None` range with `scoped_resolve` on
/// must NOT engage the scoped path).
#[test]
fn phase_f_global_measures_none_range_bails_to_full() {
    use crate::layout::cache::{LayoutCache, RangeScope};
    use crate::layout::layout_with_mnx_scores_cached;
    use crate::reconcile::reconcile_score;

    let path = fixture_path("system-layouts.mnx");
    let json = std::fs::read_to_string(&path).expect("readable");
    let mut score = parse_mnx(&json).expect("parses");
    reconcile_score(&mut score);

    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };
    let mut cache = LayoutCache::new();
    cache.set_range_scope(RangeScope {
        scoped_resolve: true,
        ..Default::default()
    });
    // Warm pass.
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));

    // Explicitly leave pending_dirty_range as None (the wasm bail for
    // globalMeasures patches sets it to None).
    cache.set_pending_dirty_range(None);
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));

    let full = cache.last_resolved_full_span();
    let span = cache.last_resolved_span();
    assert_eq!(
        span, full,
        "None range should have forced a full resolve, but span={} != full={}",
        span, full
    );
}

/// P1 unit test for the `|dirty| > K` guard implemented by
/// [`LayoutCache::effective_dirty_range`]. Every scoped pass (Phases A–D) calls
/// this helper to decide whether to engage or bail to the full path.
#[test]
fn effective_dirty_range_applies_k_guard_and_bounds() {
    use crate::layout::cache::LayoutCache;

    // None in → None out (no range info, fall back to full).
    assert_eq!(LayoutCache::effective_dirty_range(None, 100, 16), None);

    // Empty score → None (no measures to scope).
    assert_eq!(
        LayoutCache::effective_dirty_range(Some((0, 0)), 0, 16),
        None
    );

    // In-range single-measure span ⇒ engaged.
    assert_eq!(
        LayoutCache::effective_dirty_range(Some((5, 5)), 100, 16),
        Some((5, 5))
    );

    // Span exactly at K ⇒ engaged (inclusive).
    assert_eq!(
        LayoutCache::effective_dirty_range(Some((0, 15)), 100, 16),
        Some((0, 15))
    );

    // Span just over K ⇒ bail (None).
    assert_eq!(
        LayoutCache::effective_dirty_range(Some((0, 16)), 100, 16),
        None
    );

    // `end` past total-1 ⇒ clamps, span checked after clamp.
    assert_eq!(
        LayoutCache::effective_dirty_range(Some((90, 200)), 100, 16),
        Some((90, 99))
    );

    // `start` past total-1 ⇒ None (no measures to scope).
    assert_eq!(
        LayoutCache::effective_dirty_range(Some((100, 105)), 100, 16),
        None
    );
}
