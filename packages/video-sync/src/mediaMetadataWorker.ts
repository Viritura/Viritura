/**
 * MediaInfo metadata worker.
 *
 * MediaInfo is deliberately isolated here: its WASM and generated loader are
 * fetched only after a picture is attached, and parsing never blocks timeline
 * interaction. The selected Blob stays local; MediaInfo asks for byte ranges
 * and each request is served with `Blob.slice`.
 */

import mediaInfoFactory from "mediainfo.js";
import mediaInfoWasmUrl from "mediainfo.js/MediaInfoModule.wasm?url";
import { normalizeMediaInfo, type MediaMetadataWorkerRequest, type MediaMetadataWorkerResponse } from "./mediaMetadata";

self.onmessage = async (event: MessageEvent<MediaMetadataWorkerRequest>) => {
  let response: MediaMetadataWorkerResponse;
  try {
    const mediaInfo = await mediaInfoFactory({
      format: "object",
      full: true,
      locateFile: () => mediaInfoWasmUrl,
    });
    try {
      const result = await mediaInfo.analyzeData(
        event.data.blob.size,
        async (size, offset) => new Uint8Array(await event.data.blob.slice(offset, offset + size).arrayBuffer()),
      );
      response = { kind: "success", metadata: normalizeMediaInfo(result) };
    } finally {
      mediaInfo.close();
    }
  } catch (error) {
    response = {
      kind: "error",
      message: error instanceof Error ? error.message : "Media metadata could not be read.",
    };
  }
  self.postMessage(response);
};
