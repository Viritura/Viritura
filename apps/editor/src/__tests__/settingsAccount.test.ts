import { beforeEach, describe, expect, it } from "vitest";
import { availableCategories } from "../components/SettingsDialog/settingsCategories";
import {
  closeSettings,
  openSettings,
  useSettingsCategoryStore,
} from "../components/SettingsDialog/settingsCategoryStore";

describe("account settings", () => {
  beforeEach(() => {
    useSettingsCategoryStore.setState({
      open: false,
      activeCategoryId: "appearance",
      returnToStartCenterOnClose: false,
    });
  });

  it("registers Account as the first General settings category", () => {
    const categories = availableCategories();
    expect(categories[0]?.id).toBe("account");
    expect(categories[0]?.group).toBe("General");
  });

  it("deep-links directly to Account settings", () => {
    openSettings("account");
    expect(useSettingsCategoryStore.getState()).toMatchObject({
      open: true,
      activeCategoryId: "account",
    });

    closeSettings();
    expect(useSettingsCategoryStore.getState().open).toBe(false);
  });

  it("remembers when closing should return to the Start Center", () => {
    openSettings("account", { returnToStartCenterOnClose: true });

    expect(closeSettings()).toBe(true);
    expect(useSettingsCategoryStore.getState()).toMatchObject({
      open: false,
      returnToStartCenterOnClose: false,
    });
  });
});
