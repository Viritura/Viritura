import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppearancePanel } from "../components/SettingsDialog/panels/AppearancePanel";
import { closeDialog, useDialogStore } from "../store/dialogStore";

afterEach(() => {
  cleanup();
  closeDialog("calibration");
});

describe("AppearancePanel", () => {
  it("opens display calibration from Settings", () => {
    render(<AppearancePanel />);

    fireEvent.click(screen.getByRole("button", { name: "Display calibration" }));

    expect(useDialogStore.getState().open.calibration).toBe(true);
  });
});
