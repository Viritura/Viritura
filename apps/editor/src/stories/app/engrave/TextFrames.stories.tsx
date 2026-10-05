import { useEffect, type CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseMnx } from "@viritura/format";
import { ScoreCanvas } from "../../../components/ScoreCanvas";
import { HorizonTextFrames, TextFramesPanel } from "../../../components/textFrames";
import { NotationInspector } from "../../../components/NotationInspector";
import { DocumentProvider, useDocumentActions, useDocumentStore } from "../../../store/DocumentContext";
import { useSelectionActions, useSelectionStore } from "../../../store/selectionStore";
import { ERASING_STAFF_TEXT_MNX, TEXT_FRAME_MNX } from "../../storyFixtures/textFrameScore";

const ROOT_STYLE: CSSProperties = { display: "flex", height: "100vh", width: "100%" };
const CANVAS_STYLE: CSSProperties = { flex: 1, minWidth: 0, position: "relative", overflow: "hidden" };
const PANEL_STYLE: CSSProperties = {
  width: 340,
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid var(--border)",
  background: "var(--surface)",
  overflow: "auto",
};

function TextFrameHarness({ horizon, staffText = false }: { horizon: boolean; staffText?: boolean }) {
  const { loadScore } = useDocumentActions();
  const { selectElement } = useSelectionActions();
  const loaded = useDocumentStore((state) => state.score !== null);
  useEffect(() => {
    const score = staffText ? parseMnx(JSON.parse(ERASING_STAFF_TEXT_MNX)) : parseMnx(structuredClone(TEXT_FRAME_MNX));
    if (staffText) {
      const expression = score.parts[0]?.measures[0]?.expressions?.[0];
      if (!expression) throw new Error("Staff text story requires an expression");
      expression.text = [
        { text: "Play freely\nThen resume ", style: { fontStyle: "italic" } },
        { glyphs: ["dynamicPP"] },
      ];
    }
    loadScore(score, "text-frames.mnx");
    if (staffText) selectElement("p0/m0/expr0");
    else if (horizon) {
      // Preselect measure 5 so the contextual list shows the event-located frame.
      useSelectionStore.setState({
        selection: {
          kind: "measure",
          startPartIndex: 0,
          endPartIndex: 0,
          startStaffIndex: 0,
          endStaffIndex: 0,
          startMeasure: 4,
          endMeasure: 4,
        },
      });
    }
  }, [loadScore, horizon, staffText, selectElement]);
  return (
    <div style={ROOT_STYLE}>
      <div style={CANVAS_STYLE}>
        {loaded && (
          <ScoreCanvas
            keepLayoutBackendAlive
            viewMode={horizon ? "horizon" : "page"}
            initialZoom={1}
            fitToWidth={horizon}
          />
        )}
      </div>
      <div style={PANEL_STYLE}>
        {loaded &&
          (staffText ? (
            <NotationInspector horizonTextFrames={horizon} />
          ) : horizon ? (
            <HorizonTextFrames />
          ) : (
            <TextFramesPanel />
          ))}
      </div>
    </div>
  );
}

function TextFrameStory({ horizon, staffText }: { horizon: boolean; staffText?: boolean }) {
  return (
    <DocumentProvider>
      <TextFrameHarness horizon={horizon} staffText={staffText} />
    </DocumentProvider>
  );
}

/**
 * Existing text-frame editing. Select, retype, move (arrow keys on a selected
 * row, or the offset fields), resize, re-layer, and delete frames; every edit
 * is one undoable document update and re-engraves the page view.
 */
const meta: Meta<typeof TextFrameStory> = {
  title: "App/Engrave Mode/Text Frames",
  component: TextFrameStory,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof TextFrameStory>;

/** Page view with the existing-frame list and editor (as in Engrave's Properties tab). */
export const PageViewEditing: Story = { args: { horizon: false }, name: "Page view editing" };

/**
 * Horizon view hides page-placed frames; the contextual list shows frames that
 * follow the selected measure (here measure 5's event frame) plus page-index frames.
 */
export const HorizonHiddenFrames: Story = { args: { horizon: true }, name: "Horizon hidden-frame lists" };

export const StaffTextProperties: Story = {
  args: { horizon: true, staffText: true },
  name: "Multiline staff text Properties",
};
