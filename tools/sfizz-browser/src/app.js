import {
  SfizzAudioWorkletPlayer,
  buildFileIndex,
  buildSamplePlan,
  formatBytes,
  formatDecibels,
  readDirectoryHandle,
} from "./index.js";

const elements = {
  articulationSelect: document.querySelector("#articulationSelect"),
  cc1Input: document.querySelector("#cc1Input"),
  cc11Input: document.querySelector("#cc11Input"),
  directoryButton: document.querySelector("#directoryButton"),
  durationInput: document.querySelector("#durationInput"),
  folderInput: document.querySelector("#folderInput"),
  gainInput: document.querySelector("#gainInput"),
  libraryStatus: document.querySelector("#libraryStatus"),
  loadPatchButton: document.querySelector("#loadPatchButton"),
  memoryLimitSelect: document.querySelector("#memoryLimitSelect"),
  meterFill: document.querySelector("#meterFill"),
  noteInput: document.querySelector("#noteInput"),
  panicButton: document.querySelector("#panicButton"),
  patchSelect: document.querySelector("#patchSelect"),
  patchStatus: document.querySelector("#patchStatus"),
  playNoteButton: document.querySelector("#playNoteButton"),
  playPhraseButton: document.querySelector("#playPhraseButton"),
  renderStatus: document.querySelector("#renderStatus"),
  velocityInput: document.querySelector("#velocityInput"),
};

const state = {
  fileIndex: null,
  isIndexing: false,
  isLoading: false,
  loadToken: 0,
  loadedPatch: null,
  loadedPlan: null,
  player: null,
};

window.sfizzBrowserState = {
  currentRequestId: 0,
  errors: [],
  lastIndex: null,
  lastLoad: null,
  lastPanic: null,
  lastRender: null,
  livePeak: 0,
  loadDetails: null,
  metricsHistory: [],
};

state.player = new SfizzAudioWorkletPlayer({
  meterElement: elements.meterFill,
  onError: (error) => reportError(elements.renderStatus, error),
  onMetrics: handleMetrics,
});
window.sfizzBrowserTest = Object.freeze({
  reloadCurrentPatch: reloadCurrentPatchForTest,
});

elements.directoryButton.addEventListener("click", chooseDirectory);
elements.folderInput.addEventListener("change", () => indexFiles([...elements.folderInput.files]));
elements.loadPatchButton.addEventListener("click", loadSelectedPatch);
elements.playNoteButton.addEventListener("click", () => playFromBuilder(buildNoteEvents));
elements.playPhraseButton.addEventListener("click", () => playFromBuilder(buildPhraseEvents));
elements.panicButton.addEventListener("click", panic);
elements.gainInput.addEventListener("input", () => safelySetGain());
elements.cc1Input.addEventListener("input", () => sendLiveCc(1, elements.cc1Input));
elements.cc11Input.addEventListener("input", () => sendLiveCc(11, elements.cc11Input));
window.addEventListener("blur", panic);
window.addEventListener("pointercancel", panic);

updateControls();

async function chooseDirectory() {
  if (state.isLoading || state.isIndexing) {
    return;
  }
  try {
    if (!window.showDirectoryPicker) {
      elements.folderInput.click();
      return;
    }
    const handle = await window.showDirectoryPicker({ mode: "read" });
    await indexFiles(await readDirectoryHandle(handle));
  } catch (error) {
    if (error?.name !== "AbortError") {
      reportError(elements.libraryStatus, error);
    }
  }
}

async function indexFiles(files) {
  if (state.isLoading || state.isIndexing) {
    return;
  }
  state.isIndexing = true;
  updateControls();
  try {
    state.fileIndex = buildFileIndex(files);
    state.loadedPatch = null;
    state.loadedPlan = null;
    await state.player.close();
    populatePatchSelect(state.fileIndex.sfzPaths);
    const suffix = chooseDefaultPatch(state.fileIndex.sfzPaths);
    if (suffix) {
      elements.patchSelect.value = suffix;
    }
    window.sfizzBrowserState.lastIndex = {
      sfzCount: state.fileIndex.sfzPaths.length,
      summary: state.fileIndex.summary,
      wavBytes: state.fileIndex.wavBytes,
      wavCount: state.fileIndex.wavCount,
    };
    setStatus(elements.libraryStatus, `Indexed local folder: ${state.fileIndex.summary}`, "success");
    setStatus(elements.patchStatus, "Choose an SFZ patch and load it.", "");
    setStatus(elements.renderStatus, "Load a patch before playback.", "");
  } catch (error) {
    state.fileIndex = null;
    state.loadedPatch = null;
    state.loadedPlan = null;
    reportError(elements.libraryStatus, error);
  } finally {
    state.isIndexing = false;
    updateControls();
  }
}

function populatePatchSelect(paths) {
  elements.patchSelect.replaceChildren(
    ...paths.map((sfzPath) => {
      const option = document.createElement("option");
      option.value = sfzPath;
      option.textContent = sfzPath;
      return option;
    }),
  );
}

function chooseDefaultPatch(paths) {
  return (
    paths.find((path) => path.endsWith("Glockenspiel.sfz")) ??
    paths.find((path) => path.endsWith("PiccoloSus.sfz")) ??
    paths[0]
  );
}

async function loadSelectedPatch() {
  if (state.isLoading) {
    return;
  }
  const loadToken = state.loadToken + 1;
  state.loadToken = loadToken;
  state.isLoading = true;
  state.loadedPatch = null;
  state.loadedPlan = null;
  window.sfizzBrowserState.lastLoad = null;
  window.sfizzBrowserState.lastRender = null;
  window.sfizzBrowserState.metricsHistory = [];
  updateControls();
  setStatus(elements.patchStatus, "Loading selected patch in a fresh AudioWorklet context.", "");
  try {
    await state.player.panic();
    if (!state.fileIndex) {
      throw new Error("No local VSCO folder has been indexed.");
    }
    const sfzPath = elements.patchSelect.value;
    const sfzEntry = state.fileIndex.byPath.get(sfzPath);
    if (!sfzEntry) {
      throw new Error("Selected SFZ patch is no longer available in the indexed folder.");
    }
    const sfzText = await sfzEntry.file.text();
    const plan = buildSamplePlan({
      filesByPath: state.fileIndex.byLowerPath,
      memoryLimitBytes: readIntegerInRange(elements.memoryLimitSelect, "Raw WAV byte cap", 1, 1024 * 1024 * 1024),
      sfzPath,
      sfzText,
    });
    if (state.loadToken !== loadToken) {
      return;
    }
    const engineResult = await state.player.loadPatch(plan);
    if (state.loadToken !== loadToken) {
      await state.player.close();
      return;
    }
    const load = buildLoadState(sfzPath, plan, engineResult);
    state.loadedPatch = { keyswitches: plan.keyswitches, path: sfzPath };
    state.loadedPlan = plan;
    populateArticulations(plan.keyswitches);
    window.sfizzBrowserState.lastLoad = load;
    window.sfizzBrowserState.loadDetails = load;
    setStatus(elements.patchStatus, formatLoadStatus(load), "success");
    setStatus(
      elements.renderStatus,
      "Patch loaded in sfizz AudioWorklet. Play notes / real-time AudioWorklet.",
      "success",
    );
  } catch (error) {
    state.loadedPatch = null;
    state.loadedPlan = null;
    window.sfizzBrowserState.lastLoad = null;
    await state.player.close();
    reportError(elements.patchStatus, error);
  } finally {
    state.isLoading = false;
    updateControls();
  }
}

async function reloadCurrentPatchForTest(times = 2) {
  if (!Number.isInteger(times) || times < 1 || times > 10) {
    throw new Error("Reload count must be an integer from 1 through 10.");
  }
  if (!state.loadedPlan) {
    throw new Error("Load an SFZ patch before testing same-synth reload.");
  }
  let result = null;
  for (let index = 0; index < times; index += 1) {
    result = await state.player.reloadPatch(state.loadedPlan);
  }
  return result;
}

function buildLoadState(sfzPath, plan, engineResult) {
  return {
    expectedRegions: plan.expectedRegionCount,
    keyswitchCount: plan.keyswitches.length,
    patch: sfzPath,
    sampleBytes: plan.totalBytes,
    sampleCount: plan.samples.length,
    sampleFormats: summarizeSampleFormats(engineResult.wavFormats),
    regions: engineResult.regions,
  };
}

function summarizeSampleFormats(wavFormats) {
  const counts = new Map();
  for (const format of wavFormats) {
    const key = `${format.channels}ch ${format.bitsPerSample}-bit ${format.sampleRate} Hz format ${format.format}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([format, count]) => ({ count, format }));
}

function formatLoadStatus(load) {
  const sampleFormats = load.sampleFormats.map((entry) => `${entry.count} x ${entry.format}`).join("\n");
  return [
    `Loaded ${load.patch}`,
    `${load.sampleCount} validated WAV files (${formatBytes(load.sampleBytes)} raw sample bytes)`,
    `sfizz region count: ${load.regions}/${load.expectedRegions}`,
    `keyswitch articulations: ${load.keyswitchCount}`,
    sampleFormats ? `WAV formats:\n${sampleFormats}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function populateArticulations(keyswitches) {
  const options = [new Option("Patch default", "")];
  for (const keyswitch of keyswitches) {
    const label = keyswitch.isDefault ? `${keyswitch.label} (default)` : keyswitch.label;
    options.push(new Option(label, String(keyswitch.note)));
  }
  elements.articulationSelect.replaceChildren(...options);
  elements.articulationSelect.disabled = keyswitches.length === 0;
  const defaultSwitch = keyswitches.find((keyswitch) => keyswitch.isDefault);
  elements.articulationSelect.value = defaultSwitch ? String(defaultSwitch.note) : "";
}

async function playFromBuilder(buildEvents) {
  try {
    const events = buildEvents();
    if (!state.loadedPatch) {
      throw new Error("Load an SFZ patch before playback.");
    }
    const requestId = await state.player.playEvents(events, readGain());
    window.sfizzBrowserState.currentRequestId = requestId;
    window.sfizzBrowserState.lastRender = {
      activeMs: 0,
      frames: 0,
      peak: 0,
      requestId,
      rms: 0,
      windowPeak: 0,
      windowRms: 0,
    };
    setStatus(elements.renderStatus, `Playing request ${requestId} through live sfizz AudioWorklet.`, "success");
  } catch (error) {
    reportError(elements.renderStatus, error);
  }
}

async function panic() {
  try {
    const result = await state.player.panic();
    window.sfizzBrowserState.lastPanic = { ...result, requestId: window.sfizzBrowserState.currentRequestId };
    if (window.sfizzBrowserState.lastRender) {
      window.sfizzBrowserState.lastRender = {
        ...window.sfizzBrowserState.lastRender,
        activeVoices: 0,
        pendingEvents: 0,
        windowPeak: 0,
        windowRms: 0,
      };
    }
    window.sfizzBrowserState.livePeak = 0;
    setStatus(elements.renderStatus, "Panic sent to AudioWorklet: voices and pending events cleared.", "success");
  } catch (error) {
    reportError(elements.renderStatus, error);
  }
}

function buildNoteEvents() {
  const note = readIntegerInRange(elements.noteInput, "MIDI note", 0, 127);
  const velocity = readIntegerInRange(elements.velocityInput, "Velocity", 1, 127) / 127;
  const duration = readNumberInRange(elements.durationInput, "Tone length", 0.05, 5);
  return withPerformanceSetup([
    { note, time: 0.05, type: "noteOn", velocity },
    { note, time: 0.05 + duration, type: "noteOff", velocity: 0 },
  ]);
}

function buildPhraseEvents() {
  const baseNote = readIntegerInRange(elements.noteInput, "MIDI note", 0, 127);
  const velocity = readIntegerInRange(elements.velocityInput, "Velocity", 1, 127) / 127;
  const duration = Math.max(0.25, readNumberInRange(elements.durationInput, "Tone length", 0.05, 5) * 0.65);
  const notes = [baseNote, baseNote + 4, baseNote + 7, baseNote + 12].filter((note) => note <= 127);
  const noteEvents = notes.flatMap((note, index) => {
    const start = 0.08 + index * (duration + 0.08);
    return [
      { note, time: start, type: "noteOn", velocity },
      { note, time: start + duration, type: "noteOff", velocity: 0 },
    ];
  });
  return withPerformanceSetup(noteEvents);
}

function withPerformanceSetup(noteEvents) {
  const setup = [
    { number: 1, time: 0, type: "cc", value: readCc(elements.cc1Input, "CC1") / 127 },
    { number: 11, time: 0, type: "cc", value: readCc(elements.cc11Input, "CC11") / 127 },
  ];
  const keyswitch = elements.articulationSelect.value ?? "";
  const defaultSwitch = state.loadedPatch?.keyswitches.find((entry) => entry.isDefault);
  const selectedSwitch = keyswitch || (defaultSwitch ? String(defaultSwitch.note) : "");
  if (selectedSwitch) {
    const note = parseBoundedInteger(selectedSwitch, "Articulation keyswitch", 0, 127);
    setup.push({ note, time: 0.01, type: "noteOn", velocity: 1 });
    setup.push({ note, time: 0.04, type: "noteOff", velocity: 0 });
  }
  return [...setup, ...noteEvents];
}

function handleMetrics(metrics) {
  if (metrics.source === "analyser") {
    window.sfizzBrowserState.livePeak = metrics.analyserPeak;
    return;
  }
  window.sfizzBrowserState.lastRender = metrics;
  window.sfizzBrowserState.currentRequestId = metrics.requestId;
  window.sfizzBrowserState.metricsHistory.push(metrics);
  if (window.sfizzBrowserState.metricsHistory.length > 200) {
    window.sfizzBrowserState.metricsHistory.shift();
  }
  setStatus(
    elements.renderStatus,
    `Live sfizz AudioWorklet request ${metrics.requestId}: peak ${formatDecibels(metrics.peak)}, RMS ${formatDecibels(
      metrics.rms,
    )}, active ${metrics.activeMs.toFixed(0)} ms, pending ${metrics.pendingEvents}.`,
    metrics.rms > 0.0001 ? "success" : "",
  );
}

function safelySetGain() {
  try {
    state.player.setGain(readGain());
  } catch (error) {
    reportError(elements.renderStatus, error);
  }
}

async function sendLiveCc(number, input) {
  if (!state.loadedPatch || state.isLoading) {
    return;
  }
  try {
    await state.player.sendCc(number, readCc(input, `CC${number}`) / 127);
  } catch (error) {
    reportError(elements.renderStatus, error);
  }
}

function updateControls() {
  const hasPatches = Boolean(state.fileIndex?.sfzPaths.length);
  const loading = state.isLoading || state.isIndexing;
  elements.directoryButton.disabled = loading;
  elements.folderInput.disabled = loading;
  elements.memoryLimitSelect.disabled = loading;
  elements.loadPatchButton.disabled = loading || !hasPatches;
  elements.patchSelect.disabled = loading || !hasPatches;
  elements.playNoteButton.disabled = loading || !state.loadedPatch;
  elements.playPhraseButton.disabled = loading || !state.loadedPatch;
  elements.panicButton.disabled = loading && !state.loadedPatch;
}

function readGain() {
  return readNumberInRange(elements.gainInput, "Master gain", 0, 0.6);
}

function readCc(input, label) {
  return readIntegerInRange(input, label, 0, 127);
}

function readIntegerInRange(input, label, min, max) {
  return parseBoundedInteger(input.value, label, min, max);
}

function parseBoundedInteger(raw, label, min, max) {
  if (!/^-?\d+$/.test(String(raw).trim())) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function readNumberInRange(input, label, min, max) {
  const value = Number.parseFloat(input.value);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function setStatus(element, message, kind) {
  element.textContent = message;
  if (kind) {
    element.dataset.kind = kind;
  } else {
    delete element.dataset.kind;
  }
}

function reportError(element, error) {
  const message = error instanceof Error ? error.message : String(error);
  window.sfizzBrowserState.errors.push(message);
  console.error(error);
  setStatus(element, message, "error");
}
