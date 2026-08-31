export type PlaygroundViewMode = "horizon" | "page";
export type PagePresetId = "a4" | "letter";

interface PagePreset {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
}

export const pagePresets: Record<PagePresetId, PagePreset> = {
  a4: { width: 800, height: 800 * (297 / 210), margin: 800 * (15 / 210) },
  letter: { width: 800, height: 800 * (11 / 8.5), margin: 800 * (0.6 / 8.5) },
};

export const staffSizes: Record<string, number> = { small: 7, medium: 8, large: 9 };
