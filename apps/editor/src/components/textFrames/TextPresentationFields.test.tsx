import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPresentationFields } from "./TextPresentationFields";

afterEach(cleanup);

describe("TextPresentationFields", () => {
  it.each([undefined, false, true])("displays eraseBackground intent %s", (eraseBackground) => {
    render(
      <TextPresentationFields
        id="frame"
        value={eraseBackground === undefined ? {} : { eraseBackground }}
        defaultAlignment="left"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Erase background" })).toHaveProperty(
      "checked",
      eraseBackground ?? false,
    );
  });

  it("emits only boolean presentation intent when toggled", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TextPresentationFields id="frame" value={{}} defaultAlignment="left" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Erase background" }));
    expect(onChange).toHaveBeenLastCalledWith({ eraseBackground: true });
    rerender(
      <TextPresentationFields
        id="frame"
        value={{ eraseBackground: true, padding: 1, border: "solid" }}
        defaultAlignment="left"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Erase background" }));
    expect(onChange).toHaveBeenLastCalledWith({ eraseBackground: false });
  });
});
