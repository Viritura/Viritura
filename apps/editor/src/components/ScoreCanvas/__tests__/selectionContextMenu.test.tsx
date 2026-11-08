import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpatialIndex } from "@viritura/renderer";
import { openWriteSelectionContextMenu } from "../selectionContextMenu";
import { pointerToMeasure, pointerToMeasureStaff, findNearbyElement } from "../hitTesting";
import { resetSelectionStore, useSelectionActions, useSelectionStore } from "../../../store/selectionStore";

vi.mock("../engineCoordinates", () => ({ screenToEngine: () => ({ scoreX: 50, scoreY: 20 }) }));
vi.mock("../hitTesting", () => ({
  pointerToMeasure: vi.fn(),
  pointerToMeasureStaff: vi.fn(),
  findNearbyElement: vi.fn(),
}));

beforeEach(() => {
  resetSelectionStore();
  vi.clearAllMocks();
  const point = { partIndex: 0, staffIndex: 0, measureIndex: 1, localStaffIndex: 0 };
  vi.mocked(pointerToMeasure).mockReturnValue(point);
  vi.mocked(pointerToMeasureStaff).mockReturnValue(point);
  vi.mocked(findNearbyElement).mockReturnValue(null);
});
afterEach(cleanup);

function harness(hitId: string | null = null) {
  const spatialIndex = new SpatialIndex([]);
  vi.spyOn(spatialIndex, "hitTest").mockReturnValue(hitId);
  const selectElement = vi.fn();
  const setContextMenu = vi.fn();
  const buildItems = vi.fn(() => [{ label: "Delete Selected Bars", action: vi.fn() }]);
  function Canvas() {
    const actions = useSelectionActions();
    return (
      <canvas
        data-testid="canvas"
        onContextMenu={(event) =>
          openWriteSelectionContextMenu(event, {
            canvasRef: { current: event.currentTarget },
            spatialIndexRef: { current: spatialIndex },
            displayListRef: { current: null },
            selectedIds: null,
            viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
            viewMode: "horizon",
            selectElement,
            selectMeasure: actions.selectMeasure,
            buildSelectionMenuItemsRef: { current: buildItems },
            setContextMenu,
          })
        }
      />
    );
  }
  render(<Canvas />);
  return { selectElement, setContextMenu, buildItems };
}

describe("bar selection context menu", () => {
  it.each([null, "p0/m1/s0/event"])("preserves a bar range when right-clicking inside it: %s", (hitId) => {
    useSelectionStore.setState({
      selection: {
        kind: "measure",
        startMeasure: 2,
        endMeasure: 0,
        startPartIndex: 0,
        endPartIndex: 0,
        startStaffIndex: 0,
        endStaffIndex: 0,
      },
    });
    const { selectElement, buildItems } = harness(hitId);
    fireEvent.contextMenu(screen.getByTestId("canvas"));
    expect(selectElement).not.toHaveBeenCalled();
    expect(useSelectionStore.getState().selection).toMatchObject({ startMeasure: 2, endMeasure: 0 });
    expect(buildItems).toHaveBeenCalledWith({ hasSelection: true });
  });

  it("selects an empty bar before building its context menu", () => {
    const { buildItems, setContextMenu } = harness();
    fireEvent.contextMenu(screen.getByTestId("canvas"));
    expect(useSelectionStore.getState().selection).toMatchObject({ kind: "measure", startMeasure: 1, endMeasure: 1 });
    expect(buildItems).toHaveBeenCalledWith({ hasSelection: true });
    expect(setContextMenu).toHaveBeenCalledOnce();
  });

  it("still selects an unselected note outside a bar selection", () => {
    const { selectElement } = harness("p0/m1/s0/event");
    fireEvent.contextMenu(screen.getByTestId("canvas"));
    expect(selectElement).toHaveBeenCalledWith("p0/m1/s0/event", expect.objectContaining({ measureIndex: 1 }));
  });

  it("preserves an element range when right-clicking empty staff space", () => {
    const selection = {
      kind: "range",
      startElementId: "p0/m0/s0/start",
      endElementId: "p0/m1/s0/end",
    } as const;
    useSelectionStore.setState({ selection });
    const { selectElement, buildItems } = harness();
    fireEvent.contextMenu(screen.getByTestId("canvas"));
    expect(useSelectionStore.getState().selection).toEqual(selection);
    expect(selectElement).not.toHaveBeenCalled();
    expect(buildItems).toHaveBeenCalledWith({ hasSelection: true });
  });
});
