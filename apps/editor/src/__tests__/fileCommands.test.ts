import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateMnxJson,
  isFileSystemAccessSupported,
  fileSave,
  fileSaveAs,
  fileDownload,
} from "../commands/fileCommands";

const VALID_MNX = JSON.stringify({
  global: {
    measures: [{ time: { count: 4, unit: 4 } }],
  },
  parts: [
    {
      measures: [
        {
          sequences: [
            {
              content: [
                {
                  type: "event",
                  duration: { base: "quarter" },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe("validateMnxJson", () => {
  it("accepts valid MNX JSON", () => {
    expect(validateMnxJson(VALID_MNX)).toBeNull();
  });

  it("rejects invalid JSON", () => {
    expect(validateMnxJson("not json at all")).toBe("File does not contain valid JSON");
  });

  it("rejects JSON array", () => {
    expect(validateMnxJson("[1, 2, 3]")).toBe("File does not contain a valid JSON object");
  });

  it("rejects JSON primitive", () => {
    expect(validateMnxJson('"hello"')).toBe("File does not contain a valid JSON object");
  });

  it("rejects object without global property", () => {
    expect(validateMnxJson('{"parts": []}')).toBe("Not a valid MNX file: missing 'global' property");
  });

  it("rejects object without parts array", () => {
    expect(validateMnxJson('{"global": {"measures": []}}')).toBe("Not a valid MNX file: missing 'parts' array");
  });

  it("rejects object with non-array parts", () => {
    expect(validateMnxJson('{"global": {"measures": []}, "parts": "notarray"}')).toBe(
      "Not a valid MNX file: missing 'parts' array",
    );
  });

  it("accepts minimal valid MNX structure", () => {
    const minimal = JSON.stringify({ global: { measures: [] }, parts: [] });
    expect(validateMnxJson(minimal)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// Save / Export tests
// ═══════════════════════════════════════════

describe("isFileSystemAccessSupported", () => {
  it("returns false when showSaveFilePicker is not on window", () => {
    expect(isFileSystemAccessSupported()).toBe(false);
  });
});

describe("fileDownload", () => {
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clickSpy = vi.fn();
    const fakeAnchor = { href: "", download: "", click: clickSpy };
    vi.spyOn(document, "createElement").mockReturnValue(fakeAnchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);
    URL.createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("creates a download link and clicks it", () => {
    fileDownload('{"mnx":{"version":1}}', "test-score.mnx");
    expect(document.createElement).toHaveBeenCalledWith("a");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("sets the correct filename", () => {
    const fakeAnchor = { href: "", download: "", click: vi.fn() };
    vi.mocked(document.createElement).mockReturnValue(fakeAnchor as unknown as HTMLAnchorElement);
    fileDownload("{}", "my-score.mnx");
    expect(fakeAnchor.download).toBe("my-score.mnx");
  });
});

describe("fileSave", () => {
  it("calls writeToHandle when handle is provided", async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const mockHandle = {
      name: "test.mnx",
      createWritable: vi.fn().mockResolvedValue({
        write: writeSpy,
        close: closeSpy,
      }),
    } as unknown as FileSystemFileHandle;

    const result = await fileSave('{"test":true}', mockHandle);
    expect(result).toBe(mockHandle);
    expect(writeSpy).toHaveBeenCalledWith('{"test":true}');
    expect(closeSpy).toHaveBeenCalled();
  });

  it("triggers fileSaveAs when no handle exists (falls back to download)", async () => {
    const clickSpy = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: clickSpy,
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);
    URL.createObjectURL = vi.fn().mockReturnValue("blob:url");
    URL.revokeObjectURL = vi.fn();

    const result = await fileSave("{}", null);
    expect(result).toBeNull();
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe("fileSaveAs", () => {
  it("falls back to download when File System Access API unavailable", async () => {
    const clickSpy = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: clickSpy,
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);
    URL.createObjectURL = vi.fn().mockReturnValue("blob:url");
    URL.revokeObjectURL = vi.fn();

    const result = await fileSaveAs("{}", "score.mnx");
    expect(result).toBeNull();
    expect(clickSpy).toHaveBeenCalled();
  });
});
