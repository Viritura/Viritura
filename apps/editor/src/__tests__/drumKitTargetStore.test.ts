import { beforeEach, describe, expect, it } from "vitest";
import {
  advanceDrumKitReview,
  clearDrumKitTarget,
  openPercussionReviewForParts,
  useDrumKitTargetStore,
} from "../store/drumKitTargetStore";
import { closeDialog, useDialogStore } from "../store/dialogStore";

beforeEach(() => {
  clearDrumKitTarget();
  closeDialog("drumKit");
});

describe("percussion import review queue", () => {
  it("opens and advances every ambiguous percussion part", () => {
    openPercussionReviewForParts([2, 5, 7], ["first", "second", "third"]);
    expect(useDialogStore.getState().open.drumKit).toBe(true);
    expect(useDrumKitTargetStore.getState()).toMatchObject({
      partIndex: 2,
      reviewQueue: [5, 7],
      reviewReason: "first",
    });

    expect(advanceDrumKitReview()).toBe(true);
    expect(useDrumKitTargetStore.getState()).toMatchObject({ partIndex: 5, reviewQueue: [7], reviewReason: "second" });
    expect(advanceDrumKitReview()).toBe(true);
    expect(useDrumKitTargetStore.getState()).toMatchObject({ partIndex: 7, reviewQueue: [], reviewReason: "third" });
    expect(advanceDrumKitReview()).toBe(false);
  });
});
