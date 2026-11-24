import type { ActivityView } from "../components/activityRegistry";

/**
 * Activities that are not backed by Write's persistent canvas load on demand,
 * so their code (and the audio/visualization modules they pull in) is neither
 * downloaded nor evaluated until the user opens them. Hovering or focusing an
 * Activity Bar entry starts the download early.
 */
export const activityLoaders = {
  play: () => import("../components/modes/PlayView").then((m) => ({ default: m.PlayView })),
  click: () => import("../click").then((m) => ({ default: m.ClickView })),
  roll: () => import("../components/modes/RollView").then((m) => ({ default: m.RollView })),
  picture: () => import("../components/modes/PictureView").then((m) => ({ default: m.PictureView })),
  review: () => import("../components/modes/ReviewView").then((m) => ({ default: m.ReviewView })),
} as const;

export function preloadActivity(view: ActivityView): void {
  if (!Object.hasOwn(activityLoaders, view)) return;
  activityLoaders[view as keyof typeof activityLoaders]().catch(() => {
    // The lazy component retries and surfaces the failure when actually opened.
  });
}
