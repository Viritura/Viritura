import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , modulePath, fixturePath, expectedCommit] = process.argv;
if (!modulePath || !fixturePath || !expectedCommit) {
  throw new Error("usage: node smoke.mjs <denigma.js> <input.musx> <expected-commit>");
}

const createModule = (await import(pathToFileURL(resolve(modulePath)).href)).default;
const module = await createModule();
const DENIGMA_FORMAT_MNX = 1;
const actualCommit = module.UTF8ToString(module._denigma_commit()).replace(/-dirty$/, "");
if (!expectedCommit.startsWith(actualCommit)) {
  throw new Error(`Denigma module reports commit ${actualCommit}, expected ${expectedCommit}.`);
}
const input = await readFile(resolve(fixturePath));
const inputPointer = module._denigma_malloc(input.byteLength);
const name = new TextEncoder().encode("smoke.musx\0");
const namePointer = module._denigma_malloc(name.byteLength);

try {
  module.HEAPU8.set(input, inputPointer);
  module.HEAPU8.set(name, namePointer);
  const result = module._denigma_convert(
    inputPointer,
    input.byteLength,
    namePointer,
    DENIGMA_FORMAT_MNX,
    1,
    0,
    0,
    0,
    -1,
    0,
    0,
    0,
  );
  if (!result) throw new Error("Denigma returned no result.");
  try {
    const diagnostics = [];
    const diagnosticCount = module._denigma_result_diagnostic_count(result);
    for (let index = 0; index < diagnosticCount; index += 1) {
      diagnostics.push(module.UTF8ToString(module._denigma_result_diagnostic_message(result, index)));
    }
    if (module._denigma_result_success(result) !== 1) {
      throw new Error(diagnostics.join("\n") || "Denigma conversion failed.");
    }
    const outputCount = module._denigma_result_output_count(result);
    if (outputCount !== 1) throw new Error(`Denigma produced ${outputCount} outputs; expected one MNX document.`);
    const outputPointer = module._denigma_result_output_data(result, 0);
    const outputSize = module._denigma_result_output_size(result, 0);
    const output = new TextDecoder().decode(module.HEAPU8.slice(outputPointer, outputPointer + outputSize));
    const parsed = JSON.parse(output);
    if (!parsed.global || !Array.isArray(parsed.parts)) {
      throw new Error("Denigma output is not an MNX document.");
    }
    if (JSON.stringify(parsed).includes("-dirty")) {
      throw new Error("Denigma output reports a dirty source checkout.");
    }
    console.log(`Converted ${input.byteLength} MUSX bytes to ${outputSize} MNX bytes.`);
  } finally {
    module._denigma_result_destroy(result);
  }
} finally {
  module._denigma_free(inputPointer);
  module._denigma_free(namePointer);
}
