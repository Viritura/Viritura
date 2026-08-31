// summarize-rhapsody.cjs — per-iter cost breakdown from the cpuprofile.
// Aggregates "self time" into 6 buckets so we can see what % of each
// per-edit ms goes where. Tied to PATCH_ITERS = 12 in profile-rhapsody.ts.
const fs = require("node:fs");
const PROFILE = process.argv[2] ?? "tmp/profiles/rhapsody.cpuprofile";
const ITERS = Number(process.argv[3] ?? "12");

const prof = JSON.parse(fs.readFileSync(PROFILE, "utf-8"));
const nodeById = new Map(prof.nodes.map((n) => [n.id, n]));

const selfUs = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  selfUs.set(prof.samples[i], (selfUs.get(prof.samples[i]) ?? 0) + (prof.timeDeltas[i] ?? 0));
}

const buckets = {
  "wasm.layout (auto_flow & helpers)": 0,
  "wasm.cross_system (slurs/ties)": 0,
  "wasm.render_annotations (highest_point, ...)": 0,
  "wasm.precompute / spacing": 0,
  "wasm.alloc (dlmalloc, drop_in_place)": 0,
  "wasm.clone (String/Vec/Event)": 0,
  "wasm.hashbrown + hash::sip (HashMap ops)": 0,
  "wasm.other Rust": 0,
  "js.patchFrame (appendSegment, decodeFrame)": 0,
  "js.deltaSerializer": 0,
  "js.inspector overhead (post/sample)": 0,
  "v8 internals (GC, idle, program)": 0,
  other: 0,
};

const tag = (name, url) => {
  if (/inspector|node:inspector|Profiler/.test(name) || name === "post") {
    return "js.inspector overhead (post/sample)";
  }
  if (name === "(garbage collector)" || name === "(idle)" || name === "(program)" || name === "(root)") {
    return "v8 internals (GC, idle, program)";
  }
  if (url && url.includes(".wasm")) {
    if (/cross_system|render_cross_system|GlobalSlurEvent|GlobalTieNote/i.test(name)) {
      return "wasm.cross_system (slurs/ties)";
    }
    if (/render_annotations|highest_point|compute_above|compute_below|lowest_point/i.test(name)) {
      return "wasm.render_annotations (highest_point, ...)";
    }
    if (
      /precompute|compute_natural|compute_system_spacing|LogSpacing|build_merged|collect_durations|compute_prefix_width/i.test(
        name,
      )
    ) {
      return "wasm.precompute / spacing";
    }
    if (/dlmalloc|drop_in_place|__rdl_alloc|__rdl_dealloc|__rdl_realloc/i.test(name)) {
      return "wasm.alloc (dlmalloc, drop_in_place)";
    }
    if (/clone::Clone|<alloc::string::String|<alloc::vec::Vec|Event as core::clone/i.test(name)) {
      return "wasm.clone (String/Vec/Event)";
    }
    if (/hashbrown|hash::sip|hash::Hasher|HashMap|HashSet/i.test(name)) {
      return "wasm.hashbrown + hash::sip (HashMap ops)";
    }
    if (
      /layout_auto_flow|layout_with_mnx|layout_score_cached|layout_measure|render_system_staves|render_system_contents|reconcile|extract_overlay|render_page_turn/i.test(
        name,
      )
    ) {
      return "wasm.layout (auto_flow & helpers)";
    }
    return "wasm.other Rust";
  }
  if (url && url.includes("patchFrame")) return "js.patchFrame (appendSegment, decodeFrame)";
  if (url && url.includes("deltaSerializer")) return "js.deltaSerializer";
  return "other";
};

for (const [id, us] of selfUs) {
  const n = nodeById.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  const b = tag(cf.functionName || "", cf.url || "");
  buckets[b] = (buckets[b] ?? 0) + us;
}

const total = Object.values(buckets).reduce((a, b) => a + b, 0);
const totalMs = total / 1000;
const workOnly =
  total - (buckets["js.inspector overhead (post/sample)"] ?? 0) - (buckets["v8 internals (GC, idle, program)"] ?? 0);

console.log(`Total sampled: ${totalMs.toFixed(0)} ms over ${ITERS} iters = ${(totalMs / ITERS).toFixed(1)} ms/iter`);
console.log(`Work-only (excl. inspector + v8): ${(workOnly / 1000 / ITERS).toFixed(1)} ms/iter`);
console.log("");
console.log("bucket".padEnd(50) + "    total ms   pct    per-iter ms");
const rows = Object.entries(buckets)
  .filter(([, v]) => v > 0)
  .sort((a, b) => b[1] - a[1]);
for (const [k, us] of rows) {
  const pct = total ? ((us * 100) / total).toFixed(1) : "0.0";
  console.log(
    `${k.padEnd(50)}  ${(us / 1000).toFixed(0).padStart(7)} ms  ${pct.padStart(5)}%  ${(us / 1000 / ITERS).toFixed(1).padStart(7)} ms`,
  );
}
