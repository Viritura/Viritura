import { findChild, findChildren } from "../xmlHelpers";
import type { MnxEvent } from "../types";

export interface OpenLyricExtender {
  sourceEvent: MnxEvent;
  lineId: string;
}

export function applyLyricExtendMarkers(
  note: Element,
  event: MnxEvent,
  voice: string,
  openExtenders: Map<string, OpenLyricExtender>,
): void {
  for (const lyric of findChildren(note, "lyric")) {
    const number = lyric.getAttribute("number") ?? lyric.getAttribute("name") ?? "1";
    const lineId = `line-${number}`;
    const key = `${voice}\u001f${lineId}`;
    const action = findChild(lyric, "extend")?.getAttribute("type");
    if (action === "start") {
      const line = event.lyrics?.lines?.[lineId];
      if (!line) continue;
      line.extender = { show: true };
      openExtenders.set(key, { sourceEvent: event, lineId });
      continue;
    }
    if (action === "stop") {
      const open = openExtenders.get(key);
      if (!open) continue;
      const line = open.sourceEvent.lyrics?.lines?.[open.lineId];
      if (line?.extender && event.id) line.extender.target = event.id;
      openExtenders.delete(key);
    }
  }
}
