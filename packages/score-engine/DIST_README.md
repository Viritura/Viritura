# Viritura score engine — standalone build

Prebuilt, dependency-free ES modules for rendering [MNX](https://w3c.github.io/mnx/docs/) music notation in the browser.

| File                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `score-engine.js`        | Rendering kernel: layout, ink-only Canvas paint, SVG, geometry, timeline    |
| `score-engine.worker.js` | Module worker used by `engine.createLayoutWorker()`                         |
| `score-viewer.js`        | Framework-free viewer (`mountScore`): pages, zoom, scrolling, playhead      |
| `*.d.ts`, `types/`       | TypeScript declarations                                                     |
| `wasm/`, `fonts/`        | Engine binary, Bravura and Libertinus Serif (must stay next to the bundles) |
| `manifest.json`          | Package and engine versions, commit, file sizes and SHA-256 hashes          |
| `examples/`              | Runnable embed example                                                      |

Serve the directory over HTTP (ES modules and `fetch` don't work from `file://`) and open `examples/vanilla.html`.

## Call-and-forget viewer

```html
<div id="score" style="height: 80vh"></div>
<script type="module">
  import { mountScore } from "./score-viewer.js";
  const mnx = await fetch("./my-score.mnx").then((r) => r.text());
  const viewer = mountScore(document.getElementById("score"), mnx, { zoom: "fit-width" });
  // viewer.update(otherMnx); viewer.setOptions({ viewMode: "horizon", ink: "#eee", pageBackground: "#222" });
  // viewer.destroy();
</script>
```

## Engine only

The engine paints ink only, under whatever transform you set; paper, zoom and scrolling are yours.

```js
import { loadEngine } from "./score-engine.js";

const engine = await loadEngine(); // finds wasm/ and fonts/ next to score-engine.js
const dl = engine.layout(mnx, { pageWidth: 800 });
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, canvas.width, canvas.height);
engine.paint(ctx, dl, { page: 0 });

engine.info(mnx).parts; // [{ id, index, name }] — ids are MNX part ids, or "#<n>" when absent
engine.playhead(dl, { beat: 12 }); // { page, x, y, height, systemIndex }
await engine.toSvg(dl, { page: 0 }); // standalone SVG, text as outlines
```

If the files are served from a different location than the bundle (for example a rewritten webview URL), pass `loadEngine({ assetBaseUrl })`. Pass `textFont: false` to skip Libertinus Serif and use the page's own `serif` font.

## Stability

The API is pre-1.0 and may change between releases; pin to a specific release and check `manifest.json`. Licensing: see `LICENSE` and `THIRD_PARTY_NOTICES.md` (fonts are under the SIL Open Font License, `LICENSES/OFL-1.1.txt`).
