import { afterEach, describe, expect, it } from "vitest";
import { buildShareUrl, clearLiveRoomIdFromUrl, parseLiveRoomIdFromUrl, setLiveRoomIdInUrl } from "./liveUrl";

const ROOM_ID = "abc23456def789gh";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("live room URLs", () => {
  it("prefers the fragment capability and accepts legacy query links", () => {
    expect(parseLiveRoomIdFromUrl(`https://app.viritura.com/#live=${ROOM_ID}`)).toBe(ROOM_ID);
    expect(parseLiveRoomIdFromUrl(`https://app.viritura.com/?live=${ROOM_ID}`)).toBe(ROOM_ID);
  });

  it("writes the capability only to the fragment", () => {
    window.history.replaceState({}, "", `/?live=${ROOM_ID}&mode=edit#panel=files`);

    setLiveRoomIdInUrl(ROOM_ID);

    expect(window.location.search).toBe("?mode=edit");
    expect(new URLSearchParams(window.location.hash.slice(1)).get("live")).toBe(ROOM_ID);
    expect(buildShareUrl(ROOM_ID)).not.toContain(`?live=${ROOM_ID}`);
  });

  it("removes both fragment and legacy query forms", () => {
    window.history.replaceState({}, "", `/?live=${ROOM_ID}#live=${ROOM_ID}&panel=files`);

    clearLiveRoomIdFromUrl();

    expect(new URLSearchParams(window.location.search).get("live")).toBeNull();
    expect(new URLSearchParams(window.location.hash.slice(1)).get("live")).toBeNull();
    expect(new URLSearchParams(window.location.hash.slice(1)).get("panel")).toBe("files");
  });
});
