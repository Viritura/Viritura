import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

export const MUSICXML_MIME = "application/vnd.recordare.musicxml+xml";
export const MXL_MIME = "application/vnd.recordare.musicxml";

export async function packMusicXml(xml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", MXL_MIME, { compression: "STORE" });
  zip.file("score.musicxml", xml, { compression: "DEFLATE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="score.musicxml" media-type="${MUSICXML_MIME}"/></rootfiles></container>`,
    { compression: "DEFLATE" },
  );
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function unpackMusicXml(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const manifest = zip.file("META-INF/container.xml");
  if (manifest) {
    const document = new DOMParser({
      onError: (_level, message) => {
        throw new Error(`Invalid MXL manifest: ${message}`);
      },
    }).parseFromString(await manifest.async("string"), "application/xml");
    if (document.documentElement?.localName !== "container") throw new Error("Invalid MXL container manifest.");
    const roots = Array.from(document.getElementsByTagNameNS("*", "rootfile"));
    if (roots.length) {
      const root = roots.find(
        (entry) => !entry.getAttribute("media-type") || entry.getAttribute("media-type") === MUSICXML_MIME,
      );
      const path = root?.getAttribute("full-path");
      if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes(".."))
        throw new Error("The MXL manifest has no valid MusicXML root file.");
      const file = zip.file(path);
      if (!file) throw new Error(`The MXL root file "${path}" is missing.`);
      return file.async("string");
    }
  }
  const candidates = Object.values(zip.files).filter(
    (file) => !file.dir && !file.name.startsWith("META-INF/") && /\.(?:xml|musicxml)$/iu.test(file.name),
  );
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "The MXL archive has multiple score files but no root-file manifest."
        : "No XML file found in .mxl archive",
    );
  return candidates[0]!.async("string");
}
