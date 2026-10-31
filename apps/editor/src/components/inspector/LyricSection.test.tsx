import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LyricSection } from "./LyricSection";

afterEach(cleanup);

it("shows an actionable invalid endpoint without hiding its stored identifier", () => {
  const props = {
    text: "Ah",
    syllabicType: "whole" as const,
    lineId: "1",
    lineOptions: [{ value: "1", label: "Verse 1" }],
    extenderMode: "show" as const,
    extenderTarget: "deleted-target",
    extenderTargetOptions: [
      { value: "", label: "Infer endpoint" },
      { value: "deleted-target", label: "Unavailable endpoint · deleted-target" },
    ],
    extenderDiagnostic: "The endpoint no longer exists in this score. Choose another endpoint or clear it.",
    onTextChange: vi.fn(),
    onSyllabicTypeChange: vi.fn(),
    onLineChange: vi.fn(),
    onExtenderModeChange: vi.fn(),
    onExtenderTargetChange: vi.fn(),
  };
  const view = render(<LyricSection {...props} />);
  expect(screen.getByRole("status").textContent).toContain("Choose another endpoint or clear it");
  expect(screen.getByText("Unavailable endpoint · deleted-target")).toBeTruthy();
  expect(props.onExtenderTargetChange).not.toHaveBeenCalled();
  view.rerender(<LyricSection {...props} extenderMode="hide" extenderDiagnostic={undefined} />);
  expect(screen.queryByRole("status")).toBeNull();
});
