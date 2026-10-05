import { useState } from "react";
import type { Score, TextFrame } from "@viritura/core";
import { FormField, Select } from "@viritura/ui";
import type { TextFrameEditing } from "./useTextFrameEditing";
import { textFrameLocatorMeasureIndex } from "../../score/textFrameMutations";
import { CommitNumberField } from "./CommitNumberField";
import styles from "./TextFrames.module.css";

export function PageLocatorFields({
  score,
  frame,
  actions,
}: {
  score: Score;
  frame: TextFrame;
  actions: Pick<TextFrameEditing, "setLocator" | "followMeasure">;
}) {
  const [choosingMeasure, setChoosingMeasure] = useState(false);
  const musical = choosingMeasure || frame.locator.type !== "page";
  const measureIndex = textFrameLocatorMeasureIndex(score, frame.locator);
  return (
    <>
      <FormField label="Page selection">
        <Select
          aria-label="Page selection"
          value={musical ? "music" : "page"}
          options={[
            { value: "music", label: "Follow measure / event" },
            { value: "page", label: "Fixed page" },
          ]}
          onValueChange={(value) => {
            if (value === "page") {
              setChoosingMeasure(false);
              if (frame.locator.type !== "page") actions.setLocator(frame.id, { type: "page", pageIndex: 0 });
            } else {
              const savedIndex = frame.staffAttachment
                ? score.global.measures.findIndex((measure) => measure.id === frame.staffAttachment?.measureId)
                : -1;
              if (frame.locator.type === "page" && savedIndex >= 0) actions.followMeasure(frame.id, savedIndex);
              else setChoosingMeasure(true);
            }
          }}
        />
      </FormField>
      {musical ? (
        <>
          <FormField label="Following measure">
            <Select
              aria-label="Following measure"
              value={measureIndex === null ? "" : String(measureIndex)}
              placeholder="Choose a measure"
              options={score.global.measures.map((_measure, index) => ({
                value: String(index),
                label: `Measure ${index + 1}`,
              }))}
              onValueChange={(value) => {
                actions.followMeasure(frame.id, Number(value));
                setChoosingMeasure(false);
              }}
            />
          </FormField>
          <p className={styles.help}>
            {frame.locator.type === "event"
              ? "Follows the event's page. Choosing a measure replaces the event locator."
              : "The measure chooses the page, not a position on the staff."}
          </p>
        </>
      ) : (
        <FormField label="Page number" htmlFor={`text-frame-${frame.id}-page`}>
          <CommitNumberField
            id={`text-frame-${frame.id}-page`}
            value={frame.locator.type === "page" ? frame.locator.pageIndex + 1 : 1}
            step={1}
            min={1}
            onCommit={(value) => actions.setLocator(frame.id, { type: "page", pageIndex: Math.round(value) - 1 })}
          />
        </FormField>
      )}
    </>
  );
}
