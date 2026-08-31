import { create } from "zustand";

interface SettingsCategoryState {
  open: boolean;
  activeCategoryId: string;
  returnToStartCenterOnClose: boolean;
  setOpen: (open: boolean) => void;
  setActiveCategory: (id: string) => void;
}

/**
 * Which settings category is showing.
 *
 * Module-level rather than `useState` inside the dialog so the dialog reopens
 * on the category you left. A `setActiveSettingsCategory` helper for
 * deep-linking from elsewhere (a menu item like "Audio Settings…") belongs
 * here too, but is deliberately absent until something needs it.
 */
export const useSettingsCategoryStore = create<SettingsCategoryState>((set) => ({
  open: false,
  activeCategoryId: "appearance",
  returnToStartCenterOnClose: false,
  setOpen: (open) => set({ open }),
  setActiveCategory: (id) => set({ activeCategoryId: id }),
}));

interface OpenSettingsOptions {
  returnToStartCenterOnClose?: boolean;
}

export function openSettings(categoryId?: string, options?: OpenSettingsOptions): void {
  useSettingsCategoryStore.setState((state) => ({
    open: true,
    activeCategoryId: categoryId ?? state.activeCategoryId,
    returnToStartCenterOnClose: options?.returnToStartCenterOnClose ?? false,
  }));
}

export function closeSettings(): boolean {
  const { returnToStartCenterOnClose } = useSettingsCategoryStore.getState();
  useSettingsCategoryStore.setState({ open: false, returnToStartCenterOnClose: false });
  return returnToStartCenterOnClose;
}

export function toggleSettings(): void {
  useSettingsCategoryStore.setState((state) => ({
    open: !state.open,
    returnToStartCenterOnClose: false,
  }));
}
