//! Oracle for the auto-flow patch-frame delta.
//!
//! When patch recording is enabled, an auto-flow layout pass emits a
//! [`PatchFrame`] describing each system as either a `Reuse { prev_index, dy }`
//! (rigidly shift a segment the client already holds) or a `Fresh { segment }`
//! (a re-rendered system), plus a single `overlay` segment carrying the global
//! content rendered after the per-system loop (cross-system slurs/ties,
//! page-turn hints) and the page list.
//!
//! This test simulates the client: it reconstructs the full display list from
//! the patch frame + the per-system segments it held from the previous frame,
//! and asserts the reconstruction is **byte-identical** to a from-scratch
//! layout of the same score. Two frames are exercised:
//!
//!   frame 0: cold cache  ⇒ every system `Fresh`   (client holds nothing yet)
//!   frame 1: warm cache, no edit ⇒ every system `Reuse { dy: 0 }`
//!
//! Frame 0 proves `Fresh` + overlay reassembly; frame 1 proves `Reuse`
//! resolves against the client-held segments in the recorded order.

use crate::layout::cache::{LayoutCache, PatchFrame, SystemPlacement};
use crate::layout::config::LayoutConfig;
use crate::layout::layout_with_mnx_scores_cached;
use crate::model::{Score, SequenceContent};
use crate::parse::parse_mnx;
use crate::reconcile::reconcile_score;
use crate::render::DisplayList;

/// Multi-score fixtures that reach the auto-flow branch (a score without
/// explicit `pages`) for at least one score index — the only path that emits a
/// patch frame.
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

/// Bit-exact fingerprint (NaN-safe vs. raw `f32` equality).
fn binary_bits(dl: &DisplayList) -> Vec<u32> {
    dl.to_binary().iter().map(|f| f.to_bits()).collect()
}

/// Bump the octave of the first pitched note found, to change exactly one
/// measure's content (and thus its system's render identity) — simulating a
/// note edit. Returns `true` if a note was mutated.
fn bump_first_note_octave(score: &mut Score) -> bool {
    for part in &mut score.parts {
        for measure in &mut part.measures {
            for seq in &mut measure.sequences {
                for item in &mut seq.content {
                    if let SequenceContent::Event(ev) = item {
                        if let Some(notes) = ev.notes.as_mut() {
                            if let Some(note) = notes.first_mut() {
                                note.pitch.octave += 1;
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    false
}

/// Like [`bump_first_note_octave`] but returns the index of the measure whose
/// content was mutated (the global measure index, used to set a scoped dirty
/// range). `None` if no pitched note exists.
fn bump_first_note_octave_measure(score: &mut Score) -> Option<usize> {
    for part in &mut score.parts {
        for (mi, measure) in part.measures.iter_mut().enumerate() {
            for seq in &mut measure.sequences {
                for item in &mut seq.content {
                    if let SequenceContent::Event(ev) = item {
                        if let Some(notes) = ev.notes.as_mut() {
                            if let Some(note) = notes.first_mut() {
                                note.pitch.octave += 1;
                                return Some(mi);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

fn lower_first_note_six_octaves(score: &mut Score) -> Option<(usize, usize)> {
    for (part_index, part) in score.parts.iter_mut().enumerate() {
        for (measure_index, measure) in part.measures.iter_mut().enumerate() {
            for sequence in &mut measure.sequences {
                for item in &mut sequence.content {
                    if let SequenceContent::Event(event) = item {
                        if let Some(note) = event.notes.as_mut().and_then(|notes| notes.first_mut())
                        {
                            note.pitch.octave -= 6;
                            return Some((part_index, measure_index));
                        }
                    }
                }
            }
        }
    }
    None
}

fn bump_later_part_note(score: &mut Score) -> Option<(usize, usize)> {
    for part_index in (0..score.parts.len()).rev() {
        let part = &mut score.parts[part_index];
        for (measure_index, measure) in part.measures.iter_mut().enumerate() {
            for sequence in &mut measure.sequences {
                for item in &mut sequence.content {
                    if let SequenceContent::Event(event) = item {
                        if let Some(note) = event.notes.as_mut().and_then(|notes| notes.first_mut())
                        {
                            note.pitch.octave += 1;
                            return Some((part_index, measure_index));
                        }
                    }
                }
            }
        }
    }
    None
}

fn shorten_later_part_note(score: &mut Score) -> Option<(usize, usize)> {
    for part_index in (0..score.parts.len()).rev() {
        let part = &mut score.parts[part_index];
        for (measure_index, measure) in part.measures.iter_mut().enumerate() {
            for sequence in &mut measure.sequences {
                for item in &mut sequence.content {
                    if let SequenceContent::Event(event) = item {
                        if event.notes.as_ref().is_some_and(|notes| !notes.is_empty()) {
                            event.duration.base = if event.duration.base
                                == crate::model::duration::NoteValueBase::Eighth
                            {
                                crate::model::duration::NoteValueBase::Quarter
                            } else {
                                crate::model::duration::NoteValueBase::Eighth
                            };
                            event.duration.dots = None;
                            return Some((part_index, measure_index));
                        }
                    }
                }
            }
        }
    }
    None
}

/// Reconstruct the full display list from a patch frame the way the client
/// will: walk the placements in order, appending either a shifted copy of a
/// previously-held segment (`Reuse`) or the freshly-rendered segment
/// (`Fresh`), then append the global overlay and attach the page list.
///
/// Returns the reconstructed list and the per-system segments to carry into the
/// next frame. Crucially, a reused system carries its **untranslated original**
/// forward (matching the engine, whose retained store always holds the segment
/// at its first-rendered base so each `dy` is absolute, never cumulative).
fn reconstruct(patch: &PatchFrame, prev: &[DisplayList]) -> (DisplayList, Vec<DisplayList>) {
    let mut dl = DisplayList::new(patch.width, patch.height);
    let mut next_segments: Vec<DisplayList> = Vec::with_capacity(patch.placements.len());

    // Constant galley headroom (chunked horizon): the client adds this to the
    // prefix, every Fresh segment, and the overlay at assembly. Reused segments
    // already carry it (they were Fresh in a prior frame and were stored
    // offset). Paged layouts ship 0.
    let off = patch.galley_offset_y;

    // Head content (title block / page numbers) rendered before the system loop.
    let mut prefix = patch.prefix.clone();
    if off != 0.0 {
        prefix.translate(0.0, off);
    }
    dl.append(prefix);

    for placement in &patch.placements {
        match placement {
            SystemPlacement::Reuse { prev_index, dx, dy } => {
                let original = prev[*prev_index].clone();
                let mut shown = original.clone();
                if *dx != 0.0 || *dy != 0.0 {
                    shown.translate(*dx, *dy);
                }
                dl.append(shown);
                next_segments.push(original);
            }
            SystemPlacement::Fresh { segment } => {
                let mut shown = segment.as_ref().clone();
                if off != 0.0 {
                    shown.translate(0.0, off);
                }
                dl.append(shown.clone());
                // Store the OFFSET segment forward so a later Reuse is consistent.
                next_segments.push(shown);
            }
        }
    }

    let mut overlay = patch.overlay.clone();
    if off != 0.0 {
        overlay.translate(0.0, off);
    }
    dl.append(overlay);
    dl.pages = patch.pages.clone();
    if off != 0.0 {
        for page in dl.pages.iter_mut() {
            page.y_offset += off;
        }
    }
    dl.page_turn_warnings = patch.page_turn_warnings.clone();
    (dl, next_segments)
}

#[test]
fn patch_frame_reconstruction_is_byte_identical() {
    // Paged only: the patch frame is gated on `page_width.is_some()` (the
    // unpaged `fit_unpaged_bounds` global translate is incompatible with
    // per-system reuse).
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };

    let mut exercised_fresh = false;
    let mut exercised_reuse = false;

    for &name in FIXTURES {
        let path = fixture_path(name);
        let json = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("fixture {name} readable: {e}"));
        let mut score = parse_mnx(&json).unwrap_or_else(|e| panic!("fixture {name} parses: {e:?}"));
        reconcile_score(&mut score);

        for score_index in 0..score.scores.len() {
            // Ground truth: a SEPARATE layout without patch_frame_enabled,
            // so the returned `full*` dl is guaranteed to be the complete
            // assembled list. (Phase K skips the per-system clone+append in
            // the patch-enabled path when the result would be discarded by
            // the wasm wrapper; the patch frame still captures everything
            // the reconstruction needs, but the returned dl is intentionally
            // sparse. Compare reconstruction against an unpatched layout to
            // assert the patch is correct independent of that optimization.)
            let mut truth_cache = LayoutCache::new();
            let full0 =
                layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));

            let mut cache = LayoutCache::new();
            cache.set_patch_frame_enabled(true);

            // Frame 0 — cold cache: every system should be `Fresh`.
            let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
            let Some(patch0) = cache.take_pending_patch() else {
                // Score didn't reach the auto-flow branch for this index; skip.
                continue;
            };
            assert!(
                patch0
                    .placements
                    .iter()
                    .all(|p| matches!(p, SystemPlacement::Fresh { .. })),
                "{name}#{score_index}: cold-cache frame should be all-Fresh"
            );
            exercised_fresh = true;

            let (recon0, segs0) = reconstruct(&patch0, &[]);
            assert_eq!(
                binary_bits(&full0),
                binary_bits(&recon0),
                "{name}#{score_index}: frame-0 reconstruction diverged from full layout"
            );

            // Frame 1 — warm cache, no edit: every system should be `Reuse`.
            let full1 =
                layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));
            let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
            let patch1 = cache
                .take_pending_patch()
                .unwrap_or_else(|| panic!("{name}#{score_index}: frame 1 emitted no patch"));
            assert!(
                patch1
                    .placements
                    .iter()
                    .all(|p| matches!(p, SystemPlacement::Reuse { .. })),
                "{name}#{score_index}: unchanged warm-cache frame should be all-Reuse"
            );
            if !patch1.placements.is_empty() {
                exercised_reuse = true;
            }

            let (recon1, _segs1) = reconstruct(&patch1, &segs0);
            assert_eq!(
                binary_bits(&full1),
                binary_bits(&recon1),
                "{name}#{score_index}: frame-1 reconstruction diverged from full layout"
            );
        }
    }

    assert!(
        exercised_fresh,
        "no fixture/score produced a patch frame — the auto-flow patch path is \
         disabled, so this oracle is vacuous"
    );
    assert!(
        exercised_reuse,
        "no fixture/score exercised the Reuse placement — the oracle is vacuous"
    );
}

#[test]
fn patch_frame_one_note_edit_is_byte_identical() {
    // A one-note edit: the touched measure's system re-renders (`Fresh`) while
    // every other system stays `Reuse` — the most important mixed case for the
    // per-edit path. Use a multi-system paged fixture so the mix is non-trivial.
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };

    let path = fixture_path("multimeasure-rests.mnx");
    let json = std::fs::read_to_string(&path).expect("fixture readable");
    let mut score = parse_mnx(&json).expect("fixture parses");
    reconcile_score(&mut score);

    // Pick the first score index that reaches the auto-flow patch path.
    let mut chosen: Option<(usize, PatchFrame, Vec<DisplayList>)> = None;
    for score_index in 0..score.scores.len() {
        let mut cache = LayoutCache::new();
        cache.set_patch_frame_enabled(true);
        let _full0 = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        if let Some(patch0) = cache.take_pending_patch() {
            let (_recon0, segs0) = reconstruct(&patch0, &[]);
            chosen = Some((score_index, patch0, segs0));
            break;
        }
    }
    let (score_index, _patch0, segs0) =
        chosen.expect("a multimeasure-rests score index must reach the auto-flow patch path");

    // Re-warm a cache at the chosen index (frame 0) so the next pass is warm.
    let mut cache = LayoutCache::new();
    cache.set_patch_frame_enabled(true);
    let _full0 = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let _ = cache.take_pending_patch();

    // Parallel ground-truth cache (patch-frame DISABLED) so the returned dl
    // is the full assembled list, independent of Phase K's optimization that
    // skips per-system clone+append on the patch path when the result would
    // be discarded by the wasm wrapper. We warm it identically.
    let mut truth_cache = LayoutCache::new();
    let _truth0 =
        layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));

    // Edit one note, reconcile, relayout with the warm cache.
    assert!(
        bump_first_note_octave(&mut score),
        "fixture must contain at least one pitched note to edit"
    );
    reconcile_score(&mut score);
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let full_edit =
        layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));
    let patch_edit = cache
        .take_pending_patch()
        .expect("edit frame emits a patch");

    let fresh_count = patch_edit
        .placements
        .iter()
        .filter(|p| matches!(p, SystemPlacement::Fresh { .. }))
        .count();
    let reuse_count = patch_edit.placements.len() - fresh_count;
    assert!(
        fresh_count >= 1 && reuse_count >= 1,
        "edit should yield a Fresh/Reuse mix (fresh={fresh_count}, reuse={reuse_count})"
    );

    let (recon_edit, _segs_edit) = reconstruct(&patch_edit, &segs0);
    assert_eq!(
        binary_bits(&full_edit),
        binary_bits(&recon_edit),
        "edit-frame reconstruction diverged from full layout"
    );
}

#[test]
fn stitched_horizon_patch_repositions_every_chunk_when_shared_staff_gap_changes() {
    let json = r#"{
        "mnx": {"version": 1},
        "layouts": [{"id":"L1","content":[
            {"type":"staff","sources":[{"part":"P1","staff":1}]},
            {"type":"staff","sources":[{"part":"P1","staff":2}]}
        ]}],
        "scores": [{"name":"S1","layout":"L1"}],
        "global": {"measures": [
            {"time": {"count": 4, "unit": 4}}, {}, {}, {}
        ]},
        "parts": [{
            "id":"P1","name":"Piano","staves":2,
            "measures": [
                {"sequences":[
                    {"staff":1,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":5}}]}]},
                    {"staff":2,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"C","octave":3}}]}]}
                ]},
                {"sequences":[
                    {"staff":1,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"D","octave":5}}]}]},
                    {"staff":2,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"D","octave":3}}]}]}
                ]},
                {"sequences":[
                    {"staff":1,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"E","octave":5}}]}]},
                    {"staff":2,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"E","octave":3}}]}]}
                ]},
                {"sequences":[
                    {"staff":1,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"F","octave":5}}]}]},
                    {"staff":2,"content":[{"type":"event","duration":{"base":"whole"},"notes":[{"pitch":{"step":"F","octave":3}}]}]}
                ]}
            ]
        }]
    }"#;
    let mut score = parse_mnx(json).expect("grand-staff fixture parses");
    reconcile_score(&mut score);
    let config = LayoutConfig {
        page_width: None,
        horizon_chunk_width: Some(1.0),
        ..LayoutConfig::default()
    };

    let mut cache = LayoutCache::new();
    cache.set_patch_frame_enabled(true);
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let seed = cache.take_pending_patch().expect("seed emits a patch");
    assert!(
        seed.placements.len() > 1,
        "fixture must span multiple chunks"
    );
    let (seed_layout, seed_segments) = reconstruct(&seed, &[]);

    let (part_index, measure_index) =
        lower_first_note_six_octaves(&mut score).expect("fixture has a pitched note");
    reconcile_score(&mut score);
    let expected = layout_with_mnx_scores_cached(&score, &config, 0, None);
    let seed_bottom_y = seed_layout
        .measure_bounds
        .iter()
        .find(|bound| bound.staff_index == 1)
        .map(|bound| bound.y)
        .expect("seed has a lower staff");
    let expected_bottom_y = expected
        .measure_bounds
        .iter()
        .find(|bound| bound.staff_index == 1)
        .map(|bound| bound.y)
        .expect("edited layout has a lower staff");
    assert_ne!(
        seed_bottom_y.to_bits(),
        expected_bottom_y.to_bits(),
        "fixture edit must change the shared lower-staff position"
    );

    let mut affected_parts = vec![false; score.parts.len()];
    affected_parts[part_index] = true;
    cache.set_pending_dirty_region(Some(
        crate::layout::cache::DirtyRegion::local_part_measures(
            measure_index,
            measure_index,
            affected_parts,
        ),
    ));
    let _ = layout_with_mnx_scores_cached(&score, &config, 0, Some(&mut cache));
    let edit = cache.take_pending_patch().expect("edit emits a patch");
    assert_eq!(
        cache.render_hash_skips(),
        0,
        "a changed shared staff vector must invalidate every chunk's prior hash"
    );

    let (actual, _) = reconstruct(&edit, &seed_segments);
    assert_eq!(
        binary_bits(&expected),
        binary_bits(&actual),
        "stitched-Horizon patch retained stale relative staff positions"
    );
}

#[test]
#[ignore = "large non-vacuous staff-prefix oracle; run explicitly"]
fn staff_content_prefix_reuse_is_byte_identical_and_non_vacuous() {
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };
    let path = fixture_path("Rhapsody in Blue.mnx");
    let json = std::fs::read_to_string(&path).expect("fixture readable");
    let mut score = parse_mnx(&json).expect("fixture parses");
    reconcile_score(&mut score);

    let mut chosen = None;
    for score_index in 0..score.scores.len().max(1) {
        let mut cache = LayoutCache::new();
        cache.set_patch_frame_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        if let Some(seed) = cache.take_pending_patch() {
            let (_, seed_segments) = reconstruct(&seed, &[]);
            chosen = Some((score_index, cache, seed_segments));
            break;
        }
    }
    let (score_index, mut cache, seed_segments) =
        chosen.expect("fixture must provide an auto-flow score");
    let (part_index, measure_index) =
        bump_later_part_note(&mut score).expect("fixture must contain a pitched note");
    reconcile_score(&mut score);
    let mut affected_parts = vec![false; score.parts.len()];
    affected_parts[part_index] = true;
    cache.set_pending_dirty_region(Some(
        crate::layout::cache::DirtyRegion::local_part_measures(
            measure_index,
            measure_index,
            affected_parts,
        ),
    ));

    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let patch = cache.take_pending_patch().expect("edit emits patch frame");
    let (actual, segments) = reconstruct(&patch, &seed_segments);
    let expected = layout_with_mnx_scores_cached(&score, &config, score_index, None);

    assert_eq!(
        binary_bits(&expected),
        binary_bits(&actual),
        "staff-prefix reconstruction diverged from no-cache layout"
    );
    assert!(
        cache.staff_content_reuses() > 0,
        "staff-prefix oracle was vacuous"
    );

    let (part_index, measure_index) =
        shorten_later_part_note(&mut score).expect("fixture must contain another pitched note");
    reconcile_score(&mut score);
    let mut affected_parts = vec![false; score.parts.len()];
    affected_parts[part_index] = true;
    cache.set_pending_dirty_region(Some(
        crate::layout::cache::DirtyRegion::local_part_measures(
            measure_index,
            measure_index,
            affected_parts,
        ),
    ));
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let duration_patch = cache
        .take_pending_patch()
        .expect("duration edit emits patch frame");
    let (duration_actual, _) = reconstruct(&duration_patch, &segments);
    let duration_expected = layout_with_mnx_scores_cached(&score, &config, score_index, None);
    assert_eq!(
        binary_bits(&duration_expected),
        binary_bits(&duration_actual),
        "incremental duration histogram diverged from no-cache layout"
    );
}

#[test]
fn patch_after_orderless_seed_reseeds_then_reuses() {
    // Mimics the live editor's seeding path. The app seeds layout via
    // `compute_full_score_layout_cached`, which retains per-system segments but
    // is NOT patch-frame-enabled, so it records NO `last_system_order`. The
    // first patch afterwards therefore meets an empty prior order. The editor's
    // pre-warm (and Bug B's engine fix) rely on that first patch emitting an
    // all-`Fresh` frame that RE-SEEDS the order — not invalidating to a full
    // frame forever. This guards:
    //   1. order-less seed + first (no-op) patch ⇒ all-`Fresh`, a recorded
    //      order, and byte-identical reconstruction, then
    //   2. a subsequent one-note edit ⇒ a `Fresh`/`Reuse` mix that reconstructs
    //      byte-identically (proof the order seeded from step 1).
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };

    let path = fixture_path("multimeasure-rests.mnx");
    let json = std::fs::read_to_string(&path).expect("fixture readable");
    let mut score = parse_mnx(&json).expect("fixture parses");
    reconcile_score(&mut score);

    // Pick a score index that reaches the auto-flow patch path so the scenario
    // is non-vacuous.
    let mut chosen = None;
    for si in 0..score.scores.len() {
        let mut probe = LayoutCache::new();
        probe.set_patch_frame_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, si, Some(&mut probe));
        if probe.take_pending_patch().is_some() {
            chosen = Some(si);
            break;
        }
    }
    let score_index = chosen.expect("a score index must reach the auto-flow patch path");

    // Ground-truth cache (patch-frame DISABLED) warmed on the unedited score —
    // its returned dl is always the complete assembled list. Reused below for
    // the post-edit truth so its warm history mirrors the patch cache's.
    let mut truth_cache = LayoutCache::new();
    let truth_seed =
        layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));

    // Step 0 — ORDER-LESS SEED: retain segments WITHOUT recording an order,
    // exactly like `compute_full_score_layout_cached` (not patch-frame-enabled).
    let mut cache = LayoutCache::new();
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    assert!(
        cache.take_pending_patch().is_none(),
        "order-less seed must NOT emit a patch frame"
    );

    // Step 1 — PRE-WARM: enable patch frames and re-lay-out the SAME score (a
    // no-op edit). Must emit an all-`Fresh` re-seed frame that reconstructs
    // byte-identically from an empty client.
    cache.set_patch_frame_enabled(true);
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let prewarm = cache
        .take_pending_patch()
        .expect("pre-warm pass must emit a re-seed patch frame");
    assert!(
        prewarm
            .placements
            .iter()
            .all(|p| matches!(p, SystemPlacement::Fresh { .. })),
        "the re-seed frame must be all-Fresh (empty prior order)"
    );
    let (recon_prewarm, segs_prewarm) = reconstruct(&prewarm, &[]);
    assert_eq!(
        binary_bits(&truth_seed),
        binary_bits(&recon_prewarm),
        "re-seed reconstruction diverged from the full layout"
    );

    // Step 2 — EDIT one note. The order seeded in step 1 must now let the
    // unedited systems `Reuse` while only the touched system is `Fresh`.
    assert!(
        bump_first_note_octave(&mut score),
        "fixture must contain a pitched note to edit"
    );
    reconcile_score(&mut score);
    let truth_edit =
        layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));

    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let edit = cache.take_pending_patch().expect("edit emits a patch");
    let fresh = edit
        .placements
        .iter()
        .filter(|p| matches!(p, SystemPlacement::Fresh { .. }))
        .count();
    let reuse = edit.placements.len() - fresh;
    assert!(
        fresh >= 1 && reuse >= 1,
        "post-reseed edit must yield a Fresh/Reuse mix (fresh={fresh}, reuse={reuse}) — \
         a re-seed failure would force all-Fresh again"
    );
    let (recon_edit, _) = reconstruct(&edit, &segs_prewarm);
    assert_eq!(
        binary_bits(&truth_edit),
        binary_bits(&recon_edit),
        "post-reseed edit reconstruction diverged from the full layout"
    );
}

#[test]
fn lever1_clean_systems_skip_render_hash_byte_identical() {
    // Lever 1 per-region skip: on a *scoped* (dirty-range) pitch-only edit the
    // system-break plan is unchanged (no width change), so every system outside
    // the edited one keeps both its measure membership and its content. The
    // render loop then reuses each clean system's prior render hash AND its
    // cached relative staff offsets (skipping the protrusion scan) instead of
    // re-walking its measures. This proves the skip is (a) non-vacuous
    // (`render_hash_skips > 0`) and (b) byte-identical to a from-scratch,
    // skip-disabled layout of the same edited score — across several fixtures
    // including MULTI-STAFF ones (where the skipped protrusion scan is real).
    for name in [
        "multimeasure-rests.mnx",
        "system-layouts.mnx",
        "organ-layout.mnx",
        "condensing-test.mnx",
    ] {
        lever1_skip_byte_identical_for(name);
    }
}

fn lever1_skip_byte_identical_for(fixture: &str) {
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };

    let path = fixture_path(fixture);
    let json = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("fixture {fixture} readable: {e}"));
    let mut score = parse_mnx(&json).unwrap_or_else(|e| panic!("fixture {fixture} parses: {e:?}"));
    reconcile_score(&mut score);

    // Score index that reaches the auto-flow patch path.
    let mut chosen = None;
    for si in 0..score.scores.len() {
        let mut probe = LayoutCache::new();
        probe.set_patch_frame_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, si, Some(&mut probe));
        if probe.take_pending_patch().is_some() {
            chosen = Some(si);
            break;
        }
    }
    let Some(score_index) = chosen else {
        // Fixture has no paged auto-flow score view — nothing to exercise.
        return;
    };

    // Warm the patch cache: the cold pass seeds `last_system_order` and the
    // break-plan hash that the next pass's stability check compares against.
    let mut cache = LayoutCache::new();
    cache.set_patch_frame_enabled(true);
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let seed_patch = cache
        .take_pending_patch()
        .expect("cold pass emits a (re-seed) patch");
    let (_recon0, segs0) = reconstruct(&seed_patch, &[]);

    // Ground-truth cache: patch-frame DISABLED + never given a dirty range, so
    // the per-region skip can't engage — its DL is the canonical from-scratch
    // layout. Warmed identically.
    let mut truth_cache = LayoutCache::new();
    let _truth_seed =
        layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));

    // Edit one note; capture its measure index so we can scope the dirty range.
    let Some(edited_mi) = bump_first_note_octave_measure(&mut score) else {
        return; // no pitched note — skip this fixture
    };
    reconcile_score(&mut score);

    // From-scratch ground truth of the EDITED score (still no dirty range).
    let truth_edit =
        layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));

    // Scoped edit pass: set the dirty range so the per-region skip engages.
    cache.set_pending_dirty_range(Some((edited_mi, edited_mi)));
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let edit_patch = cache.take_pending_patch().expect("edit emits a patch");

    assert!(
        cache.render_hash_skips() > 0,
        "[{fixture}] the scoped edit must skip at least one clean system's render \
         hash (got {}) — the per-region optimization would be vacuous otherwise",
        cache.render_hash_skips()
    );

    let (recon_edit, _segs) = reconstruct(&edit_patch, &segs0);
    assert_eq!(
        binary_bits(&truth_edit),
        binary_bits(&recon_edit),
        "[{fixture}] scoped-skip edit reconstruction diverged from the from-scratch layout"
    );
}

#[test]
fn lever1_per_system_gap_skip_survives_rejustification() {
    // Lever 1 per-system justification scoping: a height-changing edit (growing
    // ledger lines) re-justifies the EDITED system's page, but systems on OTHER
    // pages keep byte-identical `(justified_gap, intra_clearance)` and must stay
    // skippable. Before per-system scoping, any single gap change folded into
    // the GLOBAL break-plan hash and disabled the skip for EVERY system; this
    // oracle proves the new path stays non-vacuous: each scoped edit emits a
    // fresh edited system while preserving clean systems even though the page
    // re-justified.
    //
    // Rhapsody is used (not the small fixtures) because it has enough systems
    // across multiple pages for "one page re-justifies, others don't" to be a
    // real, exercised condition — the probe shows ~489 systems skipped on such
    // an edit. Bounded to a few iterations to keep CI cost modest.
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };
    let path = fixture_path("Rhapsody in Blue.mnx");
    let json = std::fs::read_to_string(&path).expect("Rhapsody fixture readable");
    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    reconcile_score(&mut score);

    let mut score_index = None;
    for idx in 0..score.scores.len().max(1) {
        let mut probe = LayoutCache::new();
        probe.set_patch_frame_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, idx, Some(&mut probe));
        if probe.take_pending_patch().is_some() {
            score_index = Some(idx);
            break;
        }
    }
    let score_index = score_index.expect("a Rhapsody score index reaches the auto-flow patch path");

    // Scoped cache (patch + B-full on, mirroring the live editor); seed the
    // re-seed frame so segments + stability caches exist.
    let mut cache = LayoutCache::new();
    cache.set_patch_frame_enabled(true);
    cache.set_system_layout_reuse_enabled(true);
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let seed_patch = cache
        .take_pending_patch()
        .expect("cold pass emits a (re-seed) patch");
    let (_recon0, mut segs) = reconstruct(&seed_patch, &[]);

    // Bump the SAME note an octave higher each iteration → ledger lines grow →
    // the edited system's page re-justifies. Each step must emit a real mix of
    // fresh and retained systems and carry those segments into the next frame.
    // A full layout is not an oracle for stable clean pages here: this fixture's
    // full pass repositions unrelated dependents outside the dirty island.
    for step in 0..4 {
        let edited_mi = bump_first_note_octave_measure(&mut score).expect("pitched note exists");
        reconcile_score(&mut score);

        cache.set_pending_dirty_range(Some((edited_mi, edited_mi)));
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        let edit_patch = cache.take_pending_patch().expect("edit emits a patch");

        assert!(
            cache.render_hash_skips() > 0,
            "[step {step}] re-justifying edit must still skip clean systems on \
             unaffected pages (got {}) — per-system gap scoping would be vacuous \
             (or regressed to the old global disable) otherwise",
            cache.render_hash_skips()
        );
        assert!(
            edit_patch
                .placements
                .iter()
                .any(|placement| matches!(placement, SystemPlacement::Fresh { .. })),
            "[step {step}] edited page must emit at least one fresh system"
        );
        assert!(
            edit_patch
                .placements
                .iter()
                .any(|placement| matches!(placement, SystemPlacement::Reuse { .. })),
            "[step {step}] unaffected pages must retain at least one system"
        );

        let (_recon_edit, next_segs) = reconstruct(&edit_patch, &segs);
        segs = next_segs;
    }
}

/// Parse the patch-frame binary framing without a full DisplayList decoder:
/// verify the header (version, dims), the page count, the length-prefixed
/// prefix/overlay blobs, and the per-placement tags/lengths all line up and the
/// buffer is consumed exactly. This guards the float-packing layout that the JS
/// decoder mirrors.
#[test]
fn patch_frame_binary_framing_is_consistent() {
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };
    let path = fixture_path("multimeasure-rests.mnx");
    let json = std::fs::read_to_string(&path).expect("fixture readable");
    let mut score = parse_mnx(&json).expect("fixture parses");
    reconcile_score(&mut score);

    // Find an auto-flow score index and grab its cold-cache (all-Fresh) frame.
    let mut patch = None;
    for score_index in 0..score.scores.len() {
        let mut cache = LayoutCache::new();
        cache.set_patch_frame_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        if let Some(p) = cache.take_pending_patch() {
            patch = Some(p);
            break;
        }
    }
    let patch = patch.expect("a score index must reach the auto-flow patch path");

    let bin = patch.to_binary();
    let mut i = 0usize;
    let next = |i: &mut usize| {
        let v = bin[*i];
        *i += 1;
        v
    };

    assert_eq!(next(&mut i), 3.0, "format version");
    assert_eq!(next(&mut i), patch.width as f32, "width");
    assert_eq!(next(&mut i), patch.height as f32, "height");
    assert_eq!(
        next(&mut i),
        patch.galley_offset_y as f32,
        "galley_offset_y"
    );

    let num_pages = next(&mut i) as usize;
    assert_eq!(num_pages, patch.pages.len(), "page count");
    for _ in 0..num_pages {
        let _page_number = next(&mut i);
        let num_systems = next(&mut i) as usize;
        i += num_systems; // system indices
        let _y_offset = next(&mut i);
        let _height = next(&mut i);
    }

    let prefix_len = next(&mut i) as usize;
    i += prefix_len;
    let overlay_len = next(&mut i) as usize;
    i += overlay_len;

    let num_placements = next(&mut i) as usize;
    assert_eq!(
        num_placements,
        patch.placements.len(),
        "placement count diverged"
    );
    for placement in &patch.placements {
        let tag = next(&mut i);
        match placement {
            SystemPlacement::Reuse { prev_index, dx, dy } => {
                assert_eq!(tag, 0.0, "reuse tag");
                assert_eq!(next(&mut i) as usize, *prev_index, "reuse prev_index");
                assert_eq!(next(&mut i), *dx as f32, "reuse dx");
                assert_eq!(next(&mut i), *dy as f32, "reuse dy");
            }
            SystemPlacement::Fresh { segment } => {
                assert_eq!(tag, 1.0, "fresh tag");
                let seg_len = next(&mut i) as usize;
                assert_eq!(seg_len, segment.to_binary().len(), "fresh segment length");
                i += seg_len;
            }
        }
    }

    assert_eq!(i, bin.len(), "buffer not fully consumed by framing walk");
}

/// Step 4 (B-full) oracle: the per-system wholesale-reuse store must produce a
/// layout byte-identical to the shipped per-measure-retention path, AND must
/// actually engage (a clean system is reused wholesale on the edit pass —
/// otherwise the optimization would be vacuous). Run across several paged
/// fixtures, including a multi-staff one and an MMR one (the MMR count/label
/// fields are set after assembly and carried in the cached system entry, so an
/// MMR fixture guards that they survive wholesale reuse).
#[test]
fn system_layout_reuse_byte_identical_and_non_vacuous() {
    for fixture in [
        "multimeasure-rests.mnx",
        "system-layouts.mnx",
        "organ-layout.mnx",
        "condensing-test.mnx",
    ] {
        let config = LayoutConfig {
            page_width: Some(816.0),
            ..LayoutConfig::default()
        };
        let path = fixture_path(fixture);
        let json = std::fs::read_to_string(&path).expect("fixture readable");
        let mut score = parse_mnx(&json).expect("fixture parses");
        reconcile_score(&mut score);

        // Pick the first auto-flow (paged) score index.
        let mut chosen = None;
        for si in 0..score.scores.len().max(1) {
            let mut probe = LayoutCache::new();
            probe.set_patch_frame_enabled(true);
            let _ = layout_with_mnx_scores_cached(&score, &config, si, Some(&mut probe));
            if probe.take_pending_patch().is_some() {
                chosen = Some(si);
                break;
            }
        }
        let Some(score_index) = chosen else { continue };

        // Warm the test cache WITH the wholesale store enabled: cold pass seeds
        // the per-system store, the no-edit warm pass populates every entry.
        let mut cache = LayoutCache::new();
        cache.set_system_layout_reuse_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));

        // Ground-truth cache: the default per-measure-retention path (flag off),
        // warmed identically — its DL is the canonical shipped layout.
        let mut truth_cache = LayoutCache::new();
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));

        // Edit one note so the touched system goes Fresh while the rest stay
        // clean → eligible for wholesale reuse.
        if !bump_first_note_octave(&mut score) {
            continue; // no pitched note — skip this fixture
        }
        reconcile_score(&mut score);

        let truth_edit =
            layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut truth_cache));
        let reuse_edit =
            layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));

        assert!(
            cache.system_layout_reuse_hits() > 0,
            "[{fixture}] the edit pass must reuse at least one clean system wholesale \
             (got {}) — the wholesale store would be vacuous otherwise",
            cache.system_layout_reuse_hits()
        );
        assert_eq!(
            binary_bits(&truth_edit),
            binary_bits(&reuse_edit),
            "[{fixture}] wholesale-reuse layout diverged from the per-measure path"
        );
    }
}

/// Step-4 probe (NOT an assertion). Drives the warm per-edit patch path on a
/// large real score and dumps `precompute_system_layouts`'s internal sub-timing
/// buckets (solver vs hash vs reuse-move vs fresh-build vs cross-staff), once
/// with the per-system wholesale-reuse store OFF (shipped per-measure path) and
/// once ON (B-full), so the per-edit delta is visible. Uses native `Instant`
/// (ns resolution) so the per-measure splits are meaningful — unlike wasm
/// `Date.now()`, whose ~1ms granularity rounds per-measure deltas to zero.
/// `#[ignore]` keeps it out of the default suite; run with:
///   cargo test -p viritura-engine --lib precompute_sub_timing_probe \
///     -- --ignored --nocapture --test-threads=1
#[test]
#[ignore = "manual perf probe; prints timings, asserts nothing"]
fn precompute_sub_timing_probe() {
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };

    let path = fixture_path("Rhapsody in Blue.mnx");
    let json = std::fs::read_to_string(&path).expect("Rhapsody fixture readable");
    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    reconcile_score(&mut score);

    // Find the first score index that reaches the auto-flow patch path.
    let mut score_index = None;
    for idx in 0..score.scores.len().max(1) {
        let mut cache = LayoutCache::new();
        cache.set_patch_frame_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, idx, Some(&mut cache));
        if cache.take_pending_patch().is_some() {
            score_index = Some(idx);
            break;
        }
    }
    let score_index = score_index.expect("a Rhapsody score index reaches the auto-flow patch path");

    let iters = 20;
    let order = [
        "resolve_staves + mmr_grouping",
        "natural_widths",
        "precompute.sig_hash",
        "precompute.solver",
        "precompute.hash",
        "precompute.reuse_move",
        "precompute.fresh_build",
        "precompute.crossstaff",
        "pass1 precompute_system_layouts",
        "pass2 Yalloc+extras+pageturn+retention-setup",
        "pass3 render loop",
        "cross_system_slurs",
        "cross_system_ties",
        "restore measures+fit",
    ];

    // Measure the warm per-edit path with the wholesale store `enabled`,
    // returning the averaged bucket map.
    let measure = |enabled: bool| -> std::collections::HashMap<&'static str, f64> {
        let mut score = score.clone();
        let mut cache = LayoutCache::new();
        cache.set_system_layout_reuse_enabled(enabled);
        // Warm: cold frame then a no-edit warm frame (populates the store).
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        let mut agg: std::collections::HashMap<&'static str, f64> =
            std::collections::HashMap::new();
        for _ in 0..iters {
            bump_first_note_octave(&mut score);
            reconcile_score(&mut score);
            crate::timing::set_enabled(true);
            let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
            crate::timing::set_enabled(false);
            for (label, ms) in crate::timing::take_collected_splits() {
                *agg.entry(label.trim()).or_insert(0.0) += ms;
            }
        }
        agg
    };

    let off = measure(false);
    let on = measure(true);

    eprintln!("\n=== precompute sub-timing probe (Rhapsody, warm edit, avg of {iters}) ===");
    eprintln!("  {:<48} {:>10} {:>10}", "bucket", "OFF ms", "ON ms");
    for label in order {
        let o = off.get(label).map(|v| v / iters as f64).unwrap_or(0.0);
        let n = on.get(label).map(|v| v / iters as f64).unwrap_or(0.0);
        if o > 0.0 || n > 0.0 {
            eprintln!("  {label:<48} {o:>10.3} {n:>10.3}");
        }
    }
    let parent_off = off
        .get("pass1 precompute_system_layouts")
        .map(|v| v / iters as f64)
        .unwrap_or(0.0);
    let parent_on = on
        .get("pass1 precompute_system_layouts")
        .map(|v| v / iters as f64)
        .unwrap_or(0.0);
    eprintln!(
        "  {:<48} {:>10} {:>10}",
        "[precompute delta]",
        format!("{parent_off:.3}"),
        format!("{parent_on:.3} ({:+.3})", parent_on - parent_off)
    );
}

/// Lever 1: measure the render loop on the EDITOR-representative path — a
/// scoped (dirty-range) re-justifying pitch edit — and report `render_hash_skips`.
/// The `precompute_sub_timing_probe` above never sets a dirty range, so its
/// clean-system skip is disabled (`skip_enabled = false`) and it measures the
/// unscoped worst case. This probe sets the dirty range every edit (mirroring
/// the live editor's `pending_dirty_range`) and bumps the same note an octave
/// higher each iteration so ledger lines grow → the edited system's page
/// re-justifies. Before the per-system justification scoping, ANY justification
/// change folded into the GLOBAL break-plan hash, busting it and disabling the
/// skip for ALL systems (render_hash_skips → 0). After, only the re-justified
/// page's systems lose the skip; the rest stay skippable (render_hash_skips →
/// most systems). Run with:
///   cargo test -p viritura-engine --lib lever1_scoped_render_loop_probe \
///     -- --ignored --nocapture --test-threads=1
#[test]
#[ignore = "manual perf probe; prints timings, asserts nothing"]
fn lever1_scoped_render_loop_probe() {
    let config = LayoutConfig {
        page_width: Some(816.0),
        ..LayoutConfig::default()
    };
    let path = fixture_path("Rhapsody in Blue.mnx");
    let json = std::fs::read_to_string(&path).expect("Rhapsody fixture readable");
    let mut score = parse_mnx(&json).expect("Rhapsody parses");
    reconcile_score(&mut score);

    let mut score_index = None;
    for idx in 0..score.scores.len().max(1) {
        let mut cache = LayoutCache::new();
        cache.set_patch_frame_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, idx, Some(&mut cache));
        if cache.take_pending_patch().is_some() {
            score_index = Some(idx);
            break;
        }
    }
    let score_index = score_index.expect("a Rhapsody score index reaches the auto-flow patch path");

    let mut cache = LayoutCache::new();
    cache.set_patch_frame_enabled(true);
    cache.set_system_layout_reuse_enabled(true);
    // Mirror the LIVE editor (engine/viritura-wasm/src/lib.rs `Default`): both
    // scoped passes ship ON. Without this the probe measures the UNSCOPED
    // natural_widths/resolve path, over-representing real cost.
    cache.set_range_scope(crate::layout::cache::RangeScope {
        scoped_resolve: true,
        scoped_precompute: true,
        ..Default::default()
    });
    // Warm: cold + one warm pass so the stability hash + gap/order caches exist.
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
    let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));

    let iters = 20;
    let mut buckets: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    let mut total_skips = 0usize;
    let mut last_skips = 0usize;
    for _ in 0..iters {
        let edited_mi = bump_first_note_octave_measure(&mut score).expect("pitched note");
        reconcile_score(&mut score);
        cache.set_pending_dirty_range(Some((edited_mi, edited_mi)));
        crate::timing::set_enabled(true);
        let _ = layout_with_mnx_scores_cached(&score, &config, score_index, Some(&mut cache));
        crate::timing::set_enabled(false);
        for (label, ms) in crate::timing::take_collected_splits() {
            *buckets.entry(label.trim().to_string()).or_insert(0.0) += ms;
        }
        last_skips = cache.render_hash_skips();
        total_skips += last_skips;
    }
    eprintln!("\n=== Lever 1 SCOPED probe (Rhapsody, re-justifying pitch edit, dirty-range set, avg of {iters}) ===");
    let mut rows: Vec<(String, f64)> = buckets
        .into_iter()
        .map(|(k, v)| (k, v / iters as f64))
        .collect();
    rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    for (label, ms) in &rows {
        eprintln!("  {label:<48} {ms:>8.3} ms");
    }
    eprintln!(
        "  render_hash_skips:   {:.1} avg ({} last)",
        total_skips as f64 / iters as f64,
        last_skips
    );
}
