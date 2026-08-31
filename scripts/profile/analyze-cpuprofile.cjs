// analyze-cpuprofile-q.cjs — quick aggregator for V8 .cpuprofile JSON.
// Usage: node tmp/analyze-cpuprofile-q.cjs <path> [topN]
const fs = require("node:fs");
const path = require("node:path");

const [, , file, topNRaw] = process.argv;
if (!file) {
  console.error("usage: node analyze-cpuprofile-q.cjs <path> [topN]");
  process.exit(2);
}
const topN = Number(topNRaw ?? "30");

const prof = JSON.parse(fs.readFileSync(file, "utf-8"));
const nodeById = new Map(prof.nodes.map((n) => [n.id, n]));

const selfUs = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i];
  const dt = prof.timeDeltas[i] ?? 0;
  selfUs.set(id, (selfUs.get(id) ?? 0) + dt);
}
const total = [...selfUs.values()].reduce((a, b) => a + b, 0);

const rows = [];
for (const [id, us] of selfUs) {
  const n = nodeById.get(id);
  if (!n) continue;
  const cf = n.callFrame;
  rows.push({
    id,
    us,
    ms: us / 1000,
    name: cf.functionName || "(anonymous)",
    url: cf.url || "",
    line: cf.lineNumber,
  });
}

const v8Buckets = { "(idle)": 0, "(program)": 0, "(garbage collector)": 0, "(root)": 0 };
const filtered = [];
for (const r of rows) {
  if (Object.prototype.hasOwnProperty.call(v8Buckets, r.name)) {
    v8Buckets[r.name] += r.us;
    continue;
  }
  filtered.push(r);
}
filtered.sort((a, b) => b.us - a.us);

console.log(`Profile: ${path.basename(file)}`);
console.log(`Total sampled time: ${(total / 1000).toFixed(0)} ms`);
console.log("");
console.log("V8 buckets:");
for (const [k, us] of Object.entries(v8Buckets)) {
  const pct = total ? ((us * 100) / total).toFixed(1) : "0.0";
  console.log(`  ${k.padEnd(25)} ${(us / 1000).toFixed(0).padStart(6)} ms  (${pct}%)`);
}
console.log("");
console.log(`Top ${topN} functions by self time (all frames):`);
for (let i = 0; i < Math.min(topN, filtered.length); i++) {
  const r = filtered[i];
  const pct = total ? ((r.us * 100) / total).toFixed(1) : "0.0";
  const src = r.url ? `${path.basename(r.url)}:${r.line}` : "";
  const name = r.name.length > 80 ? r.name.slice(0, 77) + "..." : r.name;
  console.log(
    `  ${String(i + 1).padStart(3)}. ${r.ms.toFixed(0).padStart(6)} ms ${pct.padStart(5)}%  ${name.padEnd(80)}  ${src}`,
  );
}

const wasmRows = filtered.filter(
  (r) => r.url.endsWith(".wasm") || /\$/.test(r.name) || /::/.test(r.name) || r.name.startsWith("wasm-function"),
);
const wasmTotal = wasmRows.reduce((a, r) => a + r.us, 0);
console.log("");
console.log(
  `WASM-classified self time: ${(wasmTotal / 1000).toFixed(0)} ms (${total ? ((wasmTotal * 100) / total).toFixed(1) : "0.0"}%)`,
);
console.log(`Top 30 WASM frames:`);
wasmRows.sort((a, b) => b.us - a.us);
for (let i = 0; i < Math.min(30, wasmRows.length); i++) {
  const r = wasmRows[i];
  const pct = total ? ((r.us * 100) / total).toFixed(1) : "0.0";
  const name = r.name.length > 100 ? r.name.slice(0, 97) + "..." : r.name;
  console.log(`  ${String(i + 1).padStart(3)}. ${r.ms.toFixed(0).padStart(6)} ms ${pct.padStart(5)}%  ${name}`);
}
